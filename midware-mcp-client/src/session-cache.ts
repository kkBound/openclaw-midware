/**
 * 用户会话缓存管理 - LRU缓存 + 过期刷新
 */

import { createHash } from "node:crypto";
import { logger, maskToken } from "./logger.js";
import { SessionCache, PluginConfig } from "./types.js";
import { McpServiceClient } from "./mcp-client.js";

/** 定时清理间隔（5分钟） */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

export class SessionCacheManager {
  /** LRU缓存（Map保持插入顺序，delete+set实现LRU） */
  private cache = new Map<string, SessionCache>();
  private config: PluginConfig;
  private mcpClient: McpServiceClient;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  /** 正在刷新中的key集合，防止重复刷新 */
  private refreshing = new Set<string>();

  constructor(config: PluginConfig, mcpClient: McpServiceClient) {
    this.config = config;
    this.mcpClient = mcpClient;
    logger.info("mcp-client", "sessionCache", "init", undefined, `maxSize=${config.maxCacheSize} ttl=${config.sessionCacheTtl}s refreshBuffer=${config.sessionRefreshBuffer}s`);
  }

  /**
   * 启动定时清理任务
   */
  startCleanup(): void {
    if (this.cleanupTimer) {
      logger.debug("mcp-client", "sessionCache", "cleanup_already_running", undefined);
      return;
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanupExpired();
    }, CLEANUP_INTERVAL_MS);

    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }

    logger.info("mcp-client", "sessionCache", "cleanup_started", undefined, `interval=${CLEANUP_INTERVAL_MS}ms (${CLEANUP_INTERVAL_MS / 1000 / 60}min)`);
  }

  /**
   * 停止定时清理任务
   */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
      logger.info("mcp-client", "sessionCache", "cleanup_stopped", undefined);
    } else {
      logger.debug("mcp-client", "sessionCache", "cleanup_not_running", undefined);
    }
  }

  /**
   * 获取用户会话（带缓存）
   * user_token 仍作为缓存 key 的来源
   * 向 service 传递时使用 agent_token 和 job_number
   */
  async getUserSession(userToken: string, agentToken: string, jobNumber: string): Promise<SessionCache> {
    const cacheKey = this.hashUserToken(userToken);
    const now = Date.now();
    const refreshBufferMs = this.config.sessionRefreshBuffer * 1000;

    logger.debug("mcp-client", "sessionCache", "getUserSession_start", undefined, `key=${cacheKey.substring(0, 16)}... now=${now} cache_size=${this.cache.size} refreshBuffer_ms=${refreshBufferMs}`);

    // 1. 查缓存
    const cached = this.cache.get(cacheKey);

    if (cached) {
      const remainingMs = cached.expires_at - now;
      const refreshThresholdMs = cached.expires_at - refreshBufferMs;

      logger.debug("mcp-client", "sessionCache", "cache_lookup_hit", undefined, `key=${cacheKey.substring(0, 16)}... expires_at=${cached.expires_at} (${new Date(cached.expires_at).toISOString()}) remaining_ms=${remainingMs} refresh_threshold_ms=${refreshThresholdMs} session_token=${maskToken(cached.session_token)}`);

      // 已过期 → 删除，重新获取
      if (now >= cached.expires_at) {
        logger.info("mcp-client", "sessionCache", "cache_expired", undefined, `key=${cacheKey.substring(0, 16)}... expired_since_ms=${now - cached.expires_at} session_token=${maskToken(cached.session_token)}`);
        this.cache.delete(cacheKey);
      } else if (now >= refreshThresholdMs) {
        // 即将过期 → 异步刷新，本次返回旧数据
        logger.info("mcp-client", "sessionCache", "cache_near_expiry", undefined, `key=${cacheKey.substring(0, 16)}... remaining_ms=${remainingMs} refresh_buffer_ms=${refreshBufferMs} triggering_async_refresh session_token=${maskToken(cached.session_token)}`);
        this.refreshAsync(userToken, agentToken, jobNumber, cacheKey);
        logger.debug("mcp-client", "sessionCache", "returning_stale_cache", undefined, `key=${cacheKey.substring(0, 16)}... session_token=${maskToken(cached.session_token)}`);
        return cached;
      } else {
        // 未过期 → 直接返回（LRU: 移到末尾）
        logger.debug("mcp-client", "sessionCache", "cache_hit_valid", undefined, `key=${cacheKey.substring(0, 16)}... remaining_ms=${remainingMs} (${(remainingMs / 1000).toFixed(0)}s) session_token=${maskToken(cached.session_token)}`);
        this.cache.delete(cacheKey);
        this.cache.set(cacheKey, cached);
        logger.debug("mcp-client", "sessionCache", "lru_moved_to_end", undefined, `key=${cacheKey.substring(0, 16)}...`);
        return cached;
      }
    } else {
      logger.debug("mcp-client", "sessionCache", "cache_lookup_miss", undefined, `key=${cacheKey.substring(0, 16)}... cache_size=${this.cache.size}`);
    }

    // 2. 缓存未命中 → 同步调用 mcp-service
    logger.info("mcp-client", "sessionCache", "fetching_from_service", undefined, `key=${cacheKey.substring(0, 16)}...`);
    const session = await this.fetchFromService(agentToken, jobNumber, cacheKey);
    this.put(cacheKey, session);

    logger.info("mcp-client", "sessionCache", "getUserSession_complete", undefined, `key=${cacheKey.substring(0, 16)}... session_token=${maskToken(session.session_token)} cache_size=${this.cache.size}`);
    return session;
  }

  /**
   * 获取缓存中的 session_token（如果有效）
   */
  getCachedSessionToken(userToken: string): string | null {
    const cacheKey = this.hashUserToken(userToken);
    const cached = this.cache.get(cacheKey);
    const now = Date.now();

    if (cached) {
      const remainingMs = cached.expires_at - now;
      if (now < cached.expires_at) {
        logger.debug("mcp-client", "sessionCache", "getCachedSessionToken_hit", undefined, `key=${cacheKey.substring(0, 16)}... session_token=${maskToken(cached.session_token)} remaining_ms=${remainingMs}`);
        return cached.session_token;
      } else {
        logger.debug("mcp-client", "sessionCache", "getCachedSessionToken_expired", undefined, `key=${cacheKey.substring(0, 16)}... expired_since_ms=${now - cached.expires_at}`);
      }
    } else {
      logger.debug("mcp-client", "sessionCache", "getCachedSessionToken_miss", undefined, `key=${cacheKey.substring(0, 16)}...`);
    }

    return null;
  }

  /**
   * 删除指定用户的缓存（用于登出等场景）
   */
  invalidate(userToken: string): void {
    const cacheKey = this.hashUserToken(userToken);
    if (this.cache.delete(cacheKey)) {
      logger.info("mcp-client", "sessionCache", "invalidated", undefined, `key=${cacheKey.substring(0, 16)}... cache_size=${this.cache.size}`);
    } else {
      logger.debug("mcp-client", "sessionCache", "invalidate_noop", undefined, `key=${cacheKey.substring(0, 16)}... not_in_cache`);
    }
  }

  /**
   * 清空所有缓存
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.refreshing.clear();
    logger.info("mcp-client", "sessionCache", "cleared", undefined, `count=${size}`);
  }

  /**
   * 获取缓存统计
   */
  getStats(): { size: number; maxSize: number; refreshingCount: number } {
    return {
      size: this.cache.size,
      maxSize: this.config.maxCacheSize,
      refreshingCount: this.refreshing.size,
    };
  }

  /**
   * 获取所有缓存条目的调试信息（不含敏感数据）
   */
  getDebugInfo(): Array<{ keyPrefix: string; sessionTokenMasked: string; expiresAt: number; remainingMs: number; apiDocsCount: number }> {
    const now = Date.now();
    const result: Array<{ keyPrefix: string; sessionTokenMasked: string; expiresAt: number; remainingMs: number; apiDocsCount: number }> = [];

    for (const [key, session] of this.cache) {
      result.push({
        keyPrefix: key.substring(0, 16) + "...",
        sessionTokenMasked: maskToken(session.session_token),
        expiresAt: session.expires_at,
        remainingMs: session.expires_at - now,
        apiDocsCount: session.api_docs.length,
      });
    }

    return result;
  }

  // ===== 私有方法 =====

  /**
   * 计算 user_token 的 SHA-256 哈希（仍用 user_token 作为缓存 key）
   */
  private hashUserToken(userToken: string): string {
    const hash = createHash("sha256").update(userToken).digest("hex");
    logger.debug("mcp-client", "sessionCache", "hashUserToken", undefined, `user_token=${maskToken(userToken)} hash=${hash.substring(0, 16)}...`);
    return hash;
  }

  /**
   * 从 mcp-service 获取用户会话数据
   * 向 service 传递 agent_token 和 job_number
   */
  private async fetchFromService(agentToken: string, jobNumber: string, cacheKey: string): Promise<SessionCache> {
    const startTime = Date.now();

    logger.info("mcp-client", "sessionCache", "fetchFromService_start", undefined, `key=${cacheKey.substring(0, 16)}... agent_token=${maskToken(agentToken)} job_number=${jobNumber}`);

    const result = await this.mcpClient.callGetUserDocsAndSession(agentToken, jobNumber);

    const ttl = result.expires_in || this.config.sessionCacheTtl;
    const now = Date.now();
    const session: SessionCache = {
      api_docs: result.api_docs,
      session_token: result.session_token,
      expires_at: now + ttl * 1000,
      user_token_hash: cacheKey,
      accountGbId: result.accountGbId,
      merchantId: result.merchantId,
    };

    const duration = Date.now() - startTime;
    logger.info("mcp-client", "sessionCache", "fetchFromService_success", duration, `key=${cacheKey.substring(0, 16)}... session_token=${maskToken(session.session_token)} ttl=${ttl}s expires_at=${new Date(session.expires_at).toISOString()} api_docs_count=${session.api_docs.length} accountGbId=${session.accountGbId} merchantId=${session.merchantId}`);

    return session;
  }

  /**
   * 异步刷新缓存（不阻塞当前请求）
   */
  private async refreshAsync(userToken: string, agentToken: string, jobNumber: string, cacheKey: string): Promise<void> {
    if (this.refreshing.has(cacheKey)) {
      logger.debug("mcp-client", "sessionCache", "refreshAsync_skip_duplicate", undefined, `key=${cacheKey.substring(0, 16)}... already_refreshing`);
      return;
    }

    this.refreshing.add(cacheKey);
    logger.info("mcp-client", "sessionCache", "refreshAsync_start", undefined, `key=${cacheKey.substring(0, 16)}... refreshing_count=${this.refreshing.size}`);

    try {
      const session = await this.fetchFromService(agentToken, jobNumber, cacheKey);
      this.put(cacheKey, session);

      logger.info("mcp-client", "sessionCache", "refreshAsync_success", undefined, `key=${cacheKey.substring(0, 16)}... new_session_token=${maskToken(session.session_token)} new_expires_at=${new Date(session.expires_at).toISOString()}`);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const errName = error instanceof Error ? error.name : "Unknown";
      logger.warn("mcp-client", "sessionCache", "refreshAsync_failed", undefined, `key=${cacheKey.substring(0, 16)}... error_name=${errName} error=${errMsg} (stale_cache_will_be_used_until_expiry)`);
    } finally {
      this.refreshing.delete(cacheKey);
      logger.debug("mcp-client", "sessionCache", "refreshAsync_finally", undefined, `key=${cacheKey.substring(0, 16)}... refreshing_count=${this.refreshing.size}`);
    }
  }

  /**
   * 写入缓存（LRU淘汰）
   */
  private put(key: string, session: SessionCache): void {
    logger.debug("mcp-client", "sessionCache", "put_start", undefined, `key=${key.substring(0, 16)}... cache_size=${this.cache.size} max_size=${this.config.maxCacheSize} session_token=${maskToken(session.session_token)}`);

    if (this.cache.size >= this.config.maxCacheSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
        logger.info("mcp-client", "sessionCache", "lru_evicted", undefined, `evicted_key=${oldestKey.substring(0, 16)}... new_key=${key.substring(0, 16)}... cache_size=${this.cache.size}`);
      }
    }

    if (this.cache.has(key)) {
      logger.debug("mcp-client", "sessionCache", "put_overwrite", undefined, `key=${key.substring(0, 16)}... old_expires_at existed`);
      this.cache.delete(key);
    }

    this.cache.set(key, session);
    logger.debug("mcp-client", "sessionCache", "put_done", undefined, `key=${key.substring(0, 16)}... cache_size=${this.cache.size} session_token=${maskToken(session.session_token)} expires_at=${new Date(session.expires_at).toISOString()}`);
  }

  /**
   * 清理过期缓存
   */
  private cleanupExpired(): void {
    const now = Date.now();
    let cleaned = 0;
    const expiredKeys: string[] = [];

    for (const [key, session] of this.cache) {
      if (now >= session.expires_at) {
        expiredKeys.push(key);
        this.cache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info("mcp-client", "sessionCache", "cleanup_expired", undefined, `cleaned=${cleaned} remaining=${this.cache.size} expired_keys=[${expiredKeys.map(k => k.substring(0, 12) + "...").join(", ")}]`);
    } else {
      logger.debug("mcp-client", "sessionCache", "cleanup_noop", undefined, `all_${this.cache.size}_entries_valid`);
    }
  }
}
