/**
 * MCP Tool 1: get_user_docs_and_session
 * 根据Agent Token获取接口文档列表和临时会话Token
 */

import { z } from "zod";
import { fetchUserSession } from "../backend-client.js";
import { logger, generateTraceId, maskToken } from "../logger.js";

/** Tool 名称 */
export const TOOL_NAME = "get_user_docs_and_session";

/** Tool 描述 */
export const TOOL_DESCRIPTION = "根据Agent Token获取该用户可调用的接口文档列表和临时会话Token(session_token)。每个用户首次会话时调用一次。";

/** 输入参数 Schema */
export const inputSchema = z.object({
  agent_token: z.string().describe("Agent Token，用于获取用户接口文档和会话Token"),
  job_number: z.string().describe("工号，用于后端请求头 job-number"),
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
    logger.info("mcp-service", "tool:get_user_docs_and_session", "start", undefined, `trace_id=${traceId} agent_token=${maskToken(params.agent_token)} job_number=${params.job_number}`);

    // 调用后端获取用户会话
    const session = await fetchUserSession(params.agent_token, params.job_number);

    const duration = Date.now() - startTime;
    logger.info("mcp-service", "tool:get_user_docs_and_session", "success", duration, `trace_id=${traceId} api_docs_count=${session.api_docs.length} accountGbId=${session.accountGbId} merchantId=${session.merchantId}`);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(session),
        },
      ],
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const duration = Date.now() - startTime;
    logger.error("mcp-service", "tool:get_user_docs_and_session", "failed", duration, `trace_id=${traceId} error=${errMsg}`);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            error: "get_user_docs_and_session_failed",
            message: errMsg,
          }),
        },
      ],
    };
  }
}
