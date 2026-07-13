/**
 * 用户会话缓存管理 - LRU缓存 + 过期刷新
 */
import { SessionCache, PluginConfig } from "./types.js";
import { McpServiceClient } from "./mcp-client.js";
export declare class SessionCacheManager {
    /** LRU缓存（Map保持插入顺序，delete+set实现LRU） */
    private cache;
    private config;
    private mcpClient;
    private cleanupTimer;
    /** 正在刷新中的key集合，防止重复刷新 */
    private refreshing;
    constructor(config: PluginConfig, mcpClient: McpServiceClient);
    /**
     * 启动定时清理任务
     */
    startCleanup(): void;
    /**
     * 停止定时清理任务
     */
    stopCleanup(): void;
    /**
     * 获取用户会话（带缓存）
     * 1. 计算 cache_key = SHA256(user_token)
     * 2. 查询内存缓存
     *    - 缓存命中且未过期 → 直接返回
     *    - 缓存命中但即将过期 → 异步刷新，本次返回旧数据
     *    - 缓存未命中 → 调用 mcp-service 获取
     */
    getUserSession(userToken: string): Promise<SessionCache>;
    /**
     * 获取缓存中的 session_token（如果有效）
     */
    getCachedSessionToken(userToken: string): string | null;
    /**
     * 删除指定用户的缓存（用于登出等场景）
     */
    invalidate(userToken: string): void;
    /**
     * 清空所有缓存
     */
    clear(): void;
    /**
     * 获取缓存统计
     */
    getStats(): {
        size: number;
        maxSize: number;
        refreshingCount: number;
    };
    /**
     * 获取所有缓存条目的调试信息（不含敏感数据）
     */
    getDebugInfo(): Array<{
        keyPrefix: string;
        sessionTokenMasked: string;
        expiresAt: number;
        remainingMs: number;
        apiDocsCount: number;
    }>;
    /**
     * 计算 user_token 的 SHA-256 哈希
     */
    private hashUserToken;
    /**
     * 从 mcp-service 获取用户会话数据
     */
    private fetchFromService;
    /**
     * 异步刷新缓存（不阻塞当前请求）
     */
    private refreshAsync;
    /**
     * 写入缓存（LRU淘汰）
     */
    private put;
    /**
     * 清理过期缓存
     */
    private cleanupExpired;
}
