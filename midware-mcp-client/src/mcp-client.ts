/**
 * MCP Client - 连接 midware-mcp-service，代理 Tool 调用
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { logger, generateTraceId, maskToken } from "./logger.js";
import { PluginConfig, CallBusinessApiParams } from "./types.js";

/** get_user_docs_and_session 的返回类型 */
export interface UserSessionResult {
  api_docs: Array<{
    name: string;
    description: string;
    method: string;
    path: string;
    parameters?: Record<string, unknown>;
    response?: Record<string, unknown>;
  }>;
  session_token: string;
  expires_in: number;
}

export class McpServiceClient {
  private client: Client | null = null;
  private config: PluginConfig;

  constructor(config: PluginConfig) {
    this.config = config;
  }

  /**
   * 连接 midware-mcp-service
   */
  async connect(): Promise<void> {
    const traceId = generateTraceId();
    const startTime = Date.now();

    try {
      logger.info("mcp-client", "connect", "start", undefined, `trace_id=${traceId} url=${this.config.mcpServiceUrl}`);

      const transport = new StreamableHTTPClientTransport(
        new URL(this.config.mcpServiceUrl)
      );

      this.client = new Client({
        name: "midware-mcp-client",
        version: "1.0.0",
      });

      await this.client.connect(transport);

      const duration = Date.now() - startTime;
      logger.info("mcp-client", "connect", "success", duration, `trace_id=${traceId}`);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error("mcp-client", "connect", "failed", Date.now() - startTime, `trace_id=${traceId} error=${errMsg}`);
      throw error;
    }
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      logger.info("mcp-client", "disconnect", "success", undefined);
    }
  }

  /**
   * 调用 get_user_docs_and_session
   */
  async callGetUserDocsAndSession(userToken: string): Promise<UserSessionResult> {
    const traceId = generateTraceId();
    const startTime = Date.now();

    if (!this.client) {
      throw new Error("MCP Client 未连接，请先调用 connect()");
    }

    try {
      logger.info("mcp-client", "callGetUserDocsAndSession", "start", undefined, `trace_id=${traceId} user_token=${maskToken(userToken)}`);

      const result = await this.client.callTool({
        name: "get_user_docs_and_session",
        arguments: { user_token: userToken },
      });

      const text = this.extractText(result);
      const session = JSON.parse(text) as UserSessionResult;

      const duration = Date.now() - startTime;
      logger.info("mcp-client", "callGetUserDocsAndSession", "success", duration, `trace_id=${traceId} session_token=${maskToken(session.session_token)}`);

      return session;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error("mcp-client", "callGetUserDocsAndSession", "failed", Date.now() - startTime, `trace_id=${traceId} error=${errMsg}`);
      throw error;
    }
  }

  /**
   * 调用 call_business_api
   */
  async callBusinessApi(params: CallBusinessApiParams): Promise<unknown> {
    const traceId = generateTraceId();
    const startTime = Date.now();

    if (!this.client) {
      throw new Error("MCP Client 未连接，请先调用 connect()");
    }

    try {
      logger.info("mcp-client", "callBusinessApi", "start", undefined, `trace_id=${traceId} path=${params.api_path} method=${params.method}`);

      const result = await this.client.callTool({
        name: "call_business_api",
        arguments: {
          session_token: params.session_token,
          api_path: params.api_path,
          method: params.method,
          params: params.params,
          headers: params.headers,
        },
      });

      const text = this.extractText(result);
      const body = JSON.parse(text);

      const duration = Date.now() - startTime;
      logger.info("mcp-client", "callBusinessApi", "success", duration, `trace_id=${traceId} path=${params.api_path}`);

      return body;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error("mcp-client", "callBusinessApi", "failed", Date.now() - startTime, `trace_id=${traceId} error=${errMsg}`);
      throw error;
    }
  }

  /**
   * 从 MCP Tool 返回结果中提取 text 内容
   * callTool 返回联合类型（标准 content 形式 或 兼容 toolResult 形式）
   */
  private extractText(result: unknown): string {
    const r = result as Record<string, unknown>;
    const content = r.content;

    // 标准形式：content 数组中找 text 项
    if (Array.isArray(content)) {
      for (const item of content) {
        const c = item as { type?: string; text?: string };
        if (c.type === "text" && typeof c.text === "string") {
          return c.text;
        }
      }
    }

    // 兼容形式：toolResult 字段
    if (r.toolResult !== undefined) {
      return typeof r.toolResult === "string" ? r.toolResult : JSON.stringify(r.toolResult);
    }

    throw new Error("MCP Tool 返回内容无法解析");
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return this.client !== null;
  }
}
