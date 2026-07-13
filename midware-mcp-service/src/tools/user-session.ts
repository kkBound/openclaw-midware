/**
 * MCP Tool 1: get_user_docs_and_session
 * 根据用户临时Token获取接口文档列表和临时会话Token
 */

import { z } from "zod";
import { fetchUserSession } from "../backend-client.js";
import { logger, generateTraceId, maskToken } from "../logger.js";

/** Tool 名称 */
export const TOOL_NAME = "get_user_docs_and_session";

/** Tool 描述 */
export const TOOL_DESCRIPTION = "根据用户临时Token获取该用户可调用的接口文档列表和临时会话Token(session_token)。每个用户首次会话时调用一次。";

/** 输入参数 Schema */
export const inputSchema = z.object({
  user_token: z.string().describe("前端获取的用户临时Token，通常有效期较短（如15分钟）"),
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
    logger.info("mcp-service", "tool:get_user_docs_and_session", "start", undefined, `trace_id=${traceId} user_token=${maskToken(params.user_token)}`);

    // 调用后端获取用户会话
    const session = await fetchUserSession(params.user_token);

    const duration = Date.now() - startTime;
    logger.info("mcp-service", "tool:get_user_docs_and_session", "success", duration, `trace_id=${traceId} api_docs_count=${session.api_docs.length}`);

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
