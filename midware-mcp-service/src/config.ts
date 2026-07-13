/**
 * 环境变量加载与校验
 */

export interface AppConfig {
  /** 后端实际API的请求地址前缀 */
  apiPrefix: string;
  /** 应用标识 */
  appId: string;
  /** 应用密钥 */
  appSecret: string;
  /** 获取应用Token的接口完整URL */
  appTokenUrl: string;
  /** 获取用户文档和临时会话Token的接口URL */
  userSessionUrl: string;
  /** 应用Token缓存有效期（秒） */
  appTokenTtlSeconds: number;
  /** MCP服务监听端口 */
  serverPort: number;
  /** 日志级别 */
  logLevel: string;
}

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`缺少必填环境变量: ${key}`);
  }
  return value;
}

function optionalInt(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  const num = parseInt(value, 10);
  if (isNaN(num)) return defaultValue;
  return num;
}

let _config: AppConfig | null = null;

export function loadConfig(): AppConfig {
  _config = {
    apiPrefix: required("API_PREFIX"),
    appId: required("APP_ID"),
    appSecret: required("APP_SECRET"),
    appTokenUrl: required("APP_TOKEN_URL"),
    userSessionUrl: required("USER_SESSION_URL"),
    appTokenTtlSeconds: optionalInt("APP_TOKEN_TTL_SECONDS", 3600),
    serverPort: optionalInt("SERVER_PORT", 3000),
    logLevel: process.env.LOG_LEVEL || "info",
  };
  return _config;
}

export function getConfig(): AppConfig {
  if (!_config) {
    return loadConfig();
  }
  return _config;
}
