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
  response?: {
    type: string;
    description?: string;
    properties?: Record<string, unknown>;
  };
}

/** get_user_docs_and_session 返回数据 */
export interface UserSessionResponse {
  api_docs: ApiDoc[];
  session_token: string;
  expires_in: number;
  accountGbId: string;
  merchantId: number;
}

/** call_business_api 的请求参数 */
export interface CallBusinessApiParams {
  session_token: string;
  api_path: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  params?: Record<string, unknown>;
  headers?: Record<string, string>;
}

/** 应用Token缓存条目 */
export interface AppTokenCache {
  token: string;
  expiresAt: number; // 过期时间戳（毫秒）
}

/** 自定义错误类型 */
export class AppTokenFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppTokenFetchError";
  }
}

export class AppAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppAuthError";
  }
}

export class SessionTokenExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionTokenExpiredError";
  }
}
