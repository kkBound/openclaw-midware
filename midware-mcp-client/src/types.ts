/**
 * 类型定义
 */

/** 接口文档中的单个API定义 */
export interface ApiDoc {
  name: string;
  description: string;
  method: string;
  path: string;
  parameters?: Record<string, unknown>;
  response?: Record<string, unknown>;
}

/** 用户会话缓存结构 */
export interface SessionCache {
  api_docs: ApiDoc[];
  session_token: string;
  expires_at: number; // 过期时间戳（毫秒）
  user_token_hash: string; // user_token的SHA-256哈希
}

/** call_business_api 的请求参数 */
export interface CallBusinessApiParams {
  session_token: string;
  api_path: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  params?: Record<string, unknown>;
  headers?: Record<string, string>;
}

/** 插件配置 */
export interface PluginConfig {
  mcpServiceUrl: string;
  sessionCacheTtl: number;
  sessionRefreshBuffer: number;
  maxCacheSize: number;
  requestTimeout: number;
}
