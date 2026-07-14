/**
 * 后端HTTP调用封装
 */

import { getConfig } from "./config.js";
import { logger, maskToken, generateTraceId } from "./logger.js";
import { getAppToken } from "./auth.js";
import { UserSessionResponse, CallBusinessApiParams } from "./types.js";
import { mockFetchUserSession, mockCallBusinessApi } from "./mock-data.js";

/** HTTP请求超时 */
const HTTP_TIMEOUT_MS = 15000;

/** 5xx重试次数 */
const MAX_RETRIES_5XX = 2;

/**
 * 调用后端接口获取用户文档和会话Token
 */
export async function fetchUserSession(userToken: string): Promise<UserSessionResponse> {
  const config = getConfig();

  // Mock 模式
  if (config.mockMode) {
    logger.info("mcp-service", "fetchUserSession(mock)", "start", undefined, `user_token=${maskToken(userToken)}`);
    const data = mockFetchUserSession(userToken);
    logger.info("mcp-service", "fetchUserSession(mock)", "success", 0, `session_token=${maskToken(data.session_token)}`);
    return data;
  }

  const traceId = generateTraceId();
  const startTime = Date.now();

  const appToken = await getAppToken();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

    const response = await fetch(config.userSessionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        access_token: appToken,
        appId: config.appId,
        "X-User-Token": userToken,
      },
      body: JSON.stringify({}),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      throw new Error(`获取用户会话失败: ${response.status} ${response.statusText} ${errBody}`);
    }

    const data = (await response.json()) as UserSessionResponse;

    const duration = Date.now() - startTime;
    logger.info("mcp-service", "fetchUserSession", "success", duration, `trace_id=${traceId} session_token=${maskToken(data.session_token)}`);

    return data;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("mcp-service", "fetchUserSession", "failed", undefined, `trace_id=${traceId} error=${errMsg}`);
    throw error;
  }
}

/**
 * 调用后端业务API
 */
export async function callBackendApi(params: CallBusinessApiParams): Promise<{ status: number; body: unknown }> {
  const config = getConfig();

  // Mock 模式
  if (config.mockMode) {
    logger.info("mcp-service", "callBusinessApi(mock)", "start", undefined, `path=${params.api_path} method=${params.method}`);
    const result = mockCallBusinessApi(params);
    logger.info("mcp-service", "callBusinessApi(mock)", "success", 0, `path=${params.api_path} status=${result.status}`);
    return result;
  }

  const traceId = generateTraceId();
  const startTime = Date.now();

  const { session_token, api_path, method, params: queryParams, headers: extraHeaders } = params;

  // 构造完整URL
  const url = `${config.apiPrefix}${api_path}`;

  // 获取app_token
  const appToken = await getAppToken();

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES_5XX; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

      const baseHeaders: Record<string, string> = {
        access_token: appToken,
        appId: config.appId,
        "X-Session-Token": session_token,
        ...(extraHeaders || {}),
      };

      let response: Response;

      if (method === "GET" || method === "DELETE") {
        // GET/DELETE: params作为query string
        const queryString = queryParams && Object.keys(queryParams).length > 0
          ? "?" + new URLSearchParams(queryParams as Record<string, string>).toString()
          : "";
        response = await fetch(`${url}${queryString}`, {
          method,
          headers: baseHeaders,
          signal: controller.signal,
        });
      } else {
        // POST/PUT: params作为JSON body
        baseHeaders["Content-Type"] = "application/json";
        response = await fetch(url, {
          method,
          headers: baseHeaders,
          body: queryParams ? JSON.stringify(queryParams) : undefined,
          signal: controller.signal,
        });
      }

      clearTimeout(timeout);

      const duration = Date.now() - startTime;

      // 401: session_token过期
      if (response.status === 401) {
        logger.warn("mcp-service", "callBusinessApi", "session_token_expired", duration, `trace_id=${traceId} path=${api_path}`);
        return { status: 401, body: { error: "session_token_expired", message: "会话Token已过期，请重新调用get_user_docs_and_session" } };
      }

      // 403: 权限不足
      if (response.status === 403) {
        logger.warn("mcp-service", "callBusinessApi", "permission_denied", duration, `trace_id=${traceId} path=${api_path}`);
        return { status: 403, body: { error: "permission_denied", message: "权限不足" } };
      }

      // 404: 接口不存在
      if (response.status === 404) {
        logger.warn("mcp-service", "callBusinessApi", "api_not_found", duration, `trace_id=${traceId} path=${api_path}`);
        return { status: 404, body: { error: "api_not_found", message: `接口路径不存在: ${api_path}` } };
      }

      // 429: 限流
      if (response.status === 429) {
        logger.warn("mcp-service", "callBusinessApi", "rate_limited", duration, `trace_id=${traceId} path=${api_path}`);
        return { status: 429, body: { error: "rate_limited", message: "请求频率超限" } };
      }

      // 5xx: 重试
      if (response.status >= 500) {
        lastError = new Error(`后端服务端错误: ${response.status}`);
        if (attempt < MAX_RETRIES_5XX) {
          logger.warn("mcp-service", "callBusinessApi", `retry_${attempt}/${MAX_RETRIES_5XX}`, duration, `trace_id=${traceId} path=${api_path} status=${response.status}`);
          await new Promise((resolve) => setTimeout(resolve, 1000));
          continue;
        }
      }

      // 解析响应体
      const body = await response.json().catch(() => null);

      if (response.ok) {
        logger.info("mcp-service", "callBusinessApi", "success", duration, `trace_id=${traceId} path=${api_path} status=${response.status}`);
      } else {
        logger.warn("mcp-service", "callBusinessApi", "error", duration, `trace_id=${traceId} path=${api_path} status=${response.status}`);
      }

      return { status: response.status, body };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const errMsg = lastError.message;

      if (error instanceof Error && error.name === "AbortError") {
        logger.warn("mcp-service", "callBusinessApi", "timeout", Date.now() - startTime, `trace_id=${traceId} path=${api_path}`);
        return { status: 0, body: { error: "timeout_error", message: "请求超时" } };
      }

      if (attempt < MAX_RETRIES_5XX) {
        logger.warn("mcp-service", "callBusinessApi", `retry_${attempt}/${MAX_RETRIES_5XX}`, Date.now() - startTime, `trace_id=${traceId} path=${api_path} error=${errMsg}`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
    }
  }

  const duration = Date.now() - startTime;
  logger.error("mcp-service", "callBusinessApi", "failed", duration, `trace_id=${traceId} path=${api_path} error=${lastError?.message}`);
  return { status: 500, body: { error: "server_error", message: lastError?.message || "服务端错误" } };
}
