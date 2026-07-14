/**
 * 应用Token管理 - 签名认证 + 缓存
 */

import { createHash, randomUUID } from "node:crypto";
import { getConfig } from "./config.js";
import { logger, maskToken, generateTraceId } from "./logger.js";
import { AppTokenCache, AppTokenFetchError, AppAuthError } from "./types.js";
import { mockGetAppToken } from "./mock-data.js";

/** 内存缓存 */
let appTokenCache: AppTokenCache | null = null;

/** 过期前提前刷新时间（5分钟） */
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

/** 重试配置 */
const MAX_RETRIES = 3;
const RETRY_INTERVAL_MS = 2000;

/** HTTP请求超时 */
const HTTP_TIMEOUT_MS = 10000;

/**
 * 构建有序Body字符串
 * 将Body JSON对象按Key升序排序，拼接为 key1:value1&key2:value2 格式
 * 空值字段跳过，Body为空时返回空字符串
 */
export function buildSortedBodyString(body: Record<string, unknown> | null): string {
  if (!body || Object.keys(body).length === 0) {
    logger.debug("mcp-service", "buildSortedBodyString", "empty_body", undefined);
    return "";
  }

  const sortedKeys = Object.keys(body).sort();
  const parts: string[] = [];

  for (const key of sortedKeys) {
    const value = body[key];
    // 空值字段跳过不参与签名
    if (value === null || value === undefined || value === "") {
      logger.debug("mcp-service", "buildSortedBodyString", "skip_empty", undefined, `key=${key}`);
      continue;
    }
    parts.push(`${key}:${String(value)}`);
  }

  const result = parts.join("&");
  logger.debug("mcp-service", "buildSortedBodyString", "result", undefined, `body_str=${result}`);
  return result;
}

/**
 * 构造签名
 * 签名原文: appId={APP_ID}&body={有序Body字符串}&nonce={Nonce}&secreteKey={APP_SECRET}
 * Sign = MD5(签名原文).toUpperCase()
 */
export function buildSignature(body: Record<string, unknown> | null, nonce: string): string {
  const config = getConfig();
  const bodyStr = buildSortedBodyString(body);
  const signContent = `appId=${config.appId}&body=${bodyStr}&nonce=${nonce}&secreteKey=${config.appSecret}`;
  const md5Hash = createHash("md5").update(signContent, "utf8").digest("hex");
  const sign = md5Hash.toUpperCase();

  logger.debug("mcp-service", "buildSignature", "computed", undefined, `appId=${config.appId} nonce=${nonce} sign=${sign.substring(0, 8)}...`);

  return sign;
}

/**
 * 调用后端认证接口获取app_token
 */
async function fetchAppTokenFromBackend(): Promise<AppTokenCache> {
  const config = getConfig();
  const traceId = generateTraceId();
  const startTime = Date.now();

  const body: Record<string, unknown> = { grant_type: "client_credentials" };
  const nonce = randomUUID();
  const sign = buildSignature(body, nonce);

  logger.info("mcp-service", "fetchAppTokenFromBackend", "start", undefined, `trace_id=${traceId} url=${config.appTokenUrl} appId=${config.appId} nonce=${nonce}`);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      logger.debug("mcp-service", "fetchAppTokenFromBackend", `attempt_${attempt}/${MAX_RETRIES}`, undefined, `trace_id=${traceId} url=${config.appTokenUrl}`);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

      logger.debug("mcp-service", "fetchAppTokenFromBackend", "sending_request", undefined, `trace_id=${traceId} method=POST timeout=${HTTP_TIMEOUT_MS}ms`);

      const response = await fetch(config.appTokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          appId: config.appId,
          sign: sign,
          nonce: nonce,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      logger.debug("mcp-service", "fetchAppTokenFromBackend", "response_received", undefined, `trace_id=${traceId} status=${response.status} statusText=${response.statusText}`);

      if (response.status === 401) {
        logger.error("mcp-service", "fetchAppTokenFromBackend", "auth_failed_401", undefined, `trace_id=${traceId} appId=${config.appId}`);
        throw new AppAuthError("应用认证失败 (401)，请检查APP_ID和APP_SECRET");
      }

      if (response.status >= 500) {
        logger.warn("mcp-service", "fetchAppTokenFromBackend", "server_error", undefined, `trace_id=${traceId} status=${response.status}`);
        throw new Error(`后端服务端错误: ${response.status}`);
      }

      if (!response.ok) {
        logger.warn("mcp-service", "fetchAppTokenFromBackend", "http_error", undefined, `trace_id=${traceId} status=${response.status} statusText=${response.statusText}`);
        throw new Error(`认证接口返回错误: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as {
        access_token: string;
        token_type?: string;
        expires_in?: number;
      };

      logger.debug("mcp-service", "fetchAppTokenFromBackend", "response_parsed", undefined, `trace_id=${traceId} has_token=${!!data.access_token} token_type=${data.token_type || "N/A"} expires_in=${data.expires_in || "N/A"}`);

      if (!data.access_token) {
        logger.error("mcp-service", "fetchAppTokenFromBackend", "missing_access_token", undefined, `trace_id=${traceId}`);
        throw new Error("认证响应中缺少 access_token 字段");
      }

      const expiresIn = data.expires_in ?? config.appTokenTtlSeconds;
      const cache: AppTokenCache = {
        token: data.access_token,
        expiresAt: Date.now() + expiresIn * 1000,
      };

      const duration = Date.now() - startTime;
      logger.info("mcp-service", "fetchAppTokenFromBackend", "success", duration, `trace_id=${traceId} token=${maskToken(cache.token)} expires_in=${expiresIn}s expires_at=${new Date(cache.expiresAt).toISOString()}`);

      return cache;
    } catch (error) {
      if (error instanceof AppAuthError) {
        // 401 不重试，直接抛出
        logger.error("mcp-service", "fetchAppTokenFromBackend", "auth_error_no_retry", undefined, `trace_id=${traceId}`);
        throw error;
      }

      const isLastAttempt = attempt === MAX_RETRIES;
      const errMsg = error instanceof Error ? error.message : String(error);
      const errName = error instanceof Error ? error.name : "Unknown";

      logger.warn("mcp-service", "fetchAppTokenFromBackend", `retry_${attempt}/${MAX_RETRIES}`, undefined, `trace_id=${traceId} error_name=${errName} error=${errMsg}`);

      if (isLastAttempt) {
        logger.error("mcp-service", "fetchAppTokenFromBackend", "all_retries_exhausted", Date.now() - startTime, `trace_id=${traceId} attempts=${MAX_RETRIES} error=${errMsg}`);
        throw new AppTokenFetchError(`获取app_token失败，已重试${MAX_RETRIES}次: ${errMsg}`);
      }

      logger.debug("mcp-service", "fetchAppTokenFromBackend", "waiting_retry", undefined, `trace_id=${traceId} wait_ms=${RETRY_INTERVAL_MS}`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL_MS));
    }
  }

  throw new AppTokenFetchError("获取app_token失败：超出最大重试次数");
}

/**
 * 获取并缓存应用级Token
 * - 缓存有效且未即将过期 → 直接返回
 * - 缓存即将过期 → 异步刷新，本次返回旧Token
 * - 缓存不存在/已过期 → 同步获取新Token
 */
export async function getAppToken(): Promise<string> {
  const config = getConfig();

  // Mock 模式
  if (config.mockMode) {
    if (appTokenCache && Date.now() < appTokenCache.expiresAt - REFRESH_BUFFER_MS) {
      logger.debug("mcp-service", "getAppToken(mock)", "cache_hit", undefined, `token=${maskToken(appTokenCache.token)}`);
      return appTokenCache.token;
    }
    const mock = mockGetAppToken();
    appTokenCache = { token: mock.token, expiresAt: mock.expiresAt };
    logger.info("mcp-service", "getAppToken(mock)", "success", 0, `token=${maskToken(appTokenCache.token)} expires_at=${new Date(appTokenCache.expiresAt).toISOString()}`);
    return appTokenCache.token;
  }

  const traceId = generateTraceId();
  const startTime = Date.now();

  // 缓存有效
  if (appTokenCache) {
    const now = Date.now();
    const remainingMs = appTokenCache.expiresAt - now;
    const refreshThresholdMs = appTokenCache.expiresAt - REFRESH_BUFFER_MS;

    logger.debug("mcp-service", "getAppToken", "cache_check", undefined, `trace_id=${traceId} now=${now} expires_at=${appTokenCache.expiresAt} remaining_ms=${remainingMs} refresh_buffer_ms=${REFRESH_BUFFER_MS} token=${maskToken(appTokenCache.token)}`);

    if (now < refreshThresholdMs) {
      // 缓存有效，无需刷新
      logger.debug("mcp-service", "getAppToken", "cache_hit", Date.now() - startTime, `trace_id=${traceId} remaining_ms=${remainingMs}`);
      return appTokenCache.token;
    }

    // 已过期
    if (now >= appTokenCache.expiresAt) {
      logger.info("mcp-service", "getAppToken", "cache_expired", undefined, `trace_id=${traceId} expired_ms=${now - appTokenCache.expiresAt}`);
      appTokenCache = null;
    } else {
      // 即将过期但尚未过期 — 同步刷新（确保返回有效token）
      logger.info("mcp-service", "getAppToken", "cache_near_expiry", undefined, `trace_id=${traceId} remaining_ms=${remainingMs} threshold_ms=${REFRESH_BUFFER_MS}`);
      // 继续到下面的同步获取
    }
  } else {
    logger.debug("mcp-service", "getAppToken", "cache_miss", undefined, `trace_id=${traceId}`);
  }

  // 同步获取
  logger.info("mcp-service", "getAppToken", "fetching_new_token", undefined, `trace_id=${traceId}`);
  appTokenCache = await fetchAppTokenFromBackend();

  const duration = Date.now() - startTime;
  logger.info("mcp-service", "getAppToken", "token_acquired", duration, `trace_id=${traceId} token=${maskToken(appTokenCache.token)} expires_at=${new Date(appTokenCache.expiresAt).toISOString()}`);

  return appTokenCache.token;
}

/**
 * 清除缓存（用于测试或错误恢复）
 */
export function clearAppTokenCache(): void {
  if (appTokenCache) {
    logger.info("mcp-service", "clearAppTokenCache", "cleared", undefined, `token=${maskToken(appTokenCache.token)}`);
  } else {
    logger.debug("mcp-service", "clearAppTokenCache", "already_empty", undefined);
  }
  appTokenCache = null;
}

/**
 * 获取缓存状态（用于调试）
 */
export function getAppTokenCacheStatus(): { hasCache: boolean; token: string | null; expiresAt: number | null; remainingMs: number | null } {
  if (!appTokenCache) {
    return { hasCache: false, token: null, expiresAt: null, remainingMs: null };
  }
  return {
    hasCache: true,
    token: maskToken(appTokenCache.token),
    expiresAt: appTokenCache.expiresAt,
    remainingMs: appTokenCache.expiresAt - Date.now(),
  };
}
