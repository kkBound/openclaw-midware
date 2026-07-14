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
  /** Mock模式：不调用真实后端，返回模拟数据 */
  mockMode: boolean;
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

function optionalBool(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (!value) return defaultValue;
  return value === "true" || value === "1" || value === "yes";
}

let _config: AppConfig | null = null;

export function loadConfig(): AppConfig {
  const mockMode = optionalBool("MOCK_MODE", false);

  _config = {
    apiPrefix: mockMode ? (process.env.API_PREFIX || "https://mock.midware.example.com") : required("API_PREFIX"),
    appId: mockMode ? (process.env.APP_ID || "mock_app_id") : required("APP_ID"),
    appSecret: mockMode ? (process.env.APP_SECRET || "mock_app_secret") : required("APP_SECRET"),
    appTokenUrl: mockMode ? (process.env.APP_TOKEN_URL || "https://mock.midware.example.com/oauth/token") : required("APP_TOKEN_URL"),
    userSessionUrl: mockMode ? (process.env.USER_SESSION_URL || "https://mock.midware.example.com/api/v1/user/session") : required("USER_SESSION_URL"),
    appTokenTtlSeconds: optionalInt("APP_TOKEN_TTL_SECONDS", 3600),
    serverPort: optionalInt("SERVER_PORT", 3000),
    logLevel: process.env.LOG_LEVEL || "info",
    mockMode,
  };
  return _config;
}

export function getConfig(): AppConfig {
  if (!_config) {
    return loadConfig();
  }
  return _config;
}
