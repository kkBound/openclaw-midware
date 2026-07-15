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
export const TOOL_DESCRIPTION = `根据session_token调用业务接口，获取实际数据。

**重要规则**：
1. api_path 必须完全使用 get_user_docs_and_session 返回的 api_docs 中的 path 字段，禁止自行编造路径
2. method 必须使用 api_docs 中的 method 字段，禁止自行指定
3. params 中的参数名必须使用 api_docs 中 parameters 定义的字段名，禁止自行编造参数
4. 如果 api_docs 中某个参数 required 为 true，则必须在 params 中提供该参数
5. 调用前请对照 api_docs 确认 path、method、参数名完全匹配

**调用示例**：
假设 api_docs 返回:
  - path: "/p/midware/api/V1.0/customers/jobNumber", method: "GET", parameters: { jobNumber: { type: "string", required: true } }
则调用: api_path="/p/midware/api/V1.0/customers/jobNumber", method="GET", params={ "jobNumber": "WP09680" }`;

/** 输入参数 Schema */
export const inputSchema = z.object({
  session_token: z.string().describe("通过 get_user_docs_and_session 获取的临时会话Token"),
  api_path: z.string().describe("接口路径，必须从 api_docs 中对应接口的 path 字段原样复制，不可自行编造。例如 /p/midware/api/V1.0/customers/jobNumber"),
  method: z.enum(["GET", "POST", "PUT", "DELETE"]).describe("HTTP方法，必须从 api_docs 中对应接口的 method 字段原样使用"),
  params: z.record(z.unknown()).optional().describe("接口参数。GET请求时作为query参数，POST/PUT请求时作为JSON body。参数名和类型必须严格遵循 api_docs 中 parameters 的定义，required=true 的参数必须提供"),
  headers: z.record(z.string()).optional().describe("额外请求头（可选，通常不需要）"),
});

/** 输入参数类型 */
export type InputParams = z.infer<typeof inputSchema>;

/**
 * 执行 Tool
 */
export async function execute(params: InputParams): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const traceId = generateTraceId();
  const startTime = Date.now();

  try {
    // 打印 AI 实际生成的参数，便于排查是否遵从 api_docs
    logger.info("mcp-service", "tool:call_business_api", "input", undefined, `trace_id=${traceId} api_path=${params.api_path} method=${params.method} params=${JSON.stringify(params.params || {})} has_session_token=${!!params.session_token}`);

    // 参数校验
    if (!params.session_token) {
      throw new Error("session_token不能为空");
    }
    if (!params.api_path || !params.api_path.startsWith("/")) {
      throw new Error("api_path必须以/开头，且必须从api_docs中获取，不可自行编造");
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
