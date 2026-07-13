/**
 * MCP Tool 2: call_business_api
 * 根据session_token调用具体的业务接口，获取实际数据
 */

import { z } from "zod";
import { callBackendApi } from "../backend-client.js";
import { logger, generateTraceId, maskToken } from "../logger.js";

/** Tool 名称 */
export const TOOL_NAME = "call_business_api";

/** Tool 描述 */
export const TOOL_DESCRIPTION = "根据session_token调用具体的业务接口，获取实际数据。Agent根据用户问题和接口文档选择调用。";

/** 输入参数 Schema */
export const inputSchema = {
  session_token: z.string().describe("通过get_user_docs_and_session获取的临时会话Token"),
  api_path: z.string().describe("接口路径（不含前缀），如 /api/v1/orders"),
  method: z.enum(["GET", "POST", "PUT", "DELETE"]).describe("HTTP请求方法"),
  params: z.record(z.unknown()).optional().describe("接口参数（GET时为query参数，POST/PUT时为body参数）"),
  headers: z.record(z.string()).optional().describe("额外请求头（可选）"),
};

/** 输入参数类型 */
export type InputParams = {
  session_token: string;
  api_path: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  params?: Record<string, unknown>;
  headers?: Record<string, string>;
};

/**
 * 执行 Tool
 */
export async function execute(params: InputParams): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const traceId = generateTraceId();
  const startTime = Date.now();

  try {
    // 参数校验
    if (!params.session_token) {
      throw new Error("session_token不能为空");
    }
    if (!params.api_path || !params.api_path.startsWith("/")) {
      throw new Error("api_path必须以/开头");
    }
    if (!["GET", "POST", "PUT", "DELETE"].includes(params.method)) {
      throw new Error(`method必须在允许列表中: GET/POST/PUT/DELETE，当前: ${params.method}`);
    }

    logger.info("mcp-service", "tool:call_business_api", "start", undefined, `trace_id=${traceId} path=${params.api_path} method=${params.method} session_token=${maskToken(params.session_token)}`);

    // 调用后端业务API
    const result = await callBackendApi({
      session_token: params.session_token,
      api_path: params.api_path,
      method: params.method,
      params: params.params,
      headers: params.headers,
    });

    const duration = Date.now() - startTime;
    logger.info("mcp-service", "tool:call_business_api", "success", duration, `trace_id=${traceId} path=${params.api_path} status=${result.status}`);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(result.body),
        },
      ],
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const duration = Date.now() - startTime;
    logger.error("mcp-service", "tool:call_business_api", "failed", duration, `trace_id=${traceId} error=${errMsg}`);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            error: "call_business_api_failed",
            message: errMsg,
          }),
        },
      ],
    };
  }
}
