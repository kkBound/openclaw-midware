/**
 * OpenClaw 插件入口 - midware-mcp-client
 *
 * 作为 OpenClaw 原生插件运行，为 Agent 提供两个 Tool:
 * 1. get_user_docs_and_session - 获取用户接口文档和会话Token（带缓存）
 * 2. call_business_api - 调用业务接口获取数据
 *
 * 生命周期:
 * - gateway_start: 连接 midware-mcp-service，启动缓存清理
 * - gateway_stop: 断开连接，停止缓存清理
 */

import "dotenv/config";
import { Type } from "typebox";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { McpServiceClient } from "./mcp-client.js";
import { SessionCacheManager } from "./session-cache.js";
import { logger, generateTraceId, maskToken } from "./logger.js";
import type { PluginConfig } from "./types.js";

// 全局实例
let mcpClient: McpServiceClient | null = null;
let sessionCache: SessionCacheManager | null = null;

export default definePluginEntry({
  id: "midware-mcp-client",
  name: "Midware MCP Client",
  description: "Midware MCP 会话缓存与业务 API 代理插件",

  register(api) {
    // 在 register 闭包中捕获插件配置（该版本 gateway_start 事件不含 pluginConfig）
    const pluginConfig = (api as { pluginConfig?: Record<string, unknown> }).pluginConfig;

    // ===== 生命周期 Hooks =====

    // Gateway 启动时连接 mcp-service
    api.on("gateway_start", async () => {
      const config = resolveConfig(pluginConfig);
      logger.info("mcp-client", "gateway_start", "initializing", undefined, `serviceUrl=${config.mcpServiceUrl}`);

      // 创建 MCP Client
      mcpClient = new McpServiceClient(config);
      await mcpClient.connect();

      // 创建会话缓存管理器
      sessionCache = new SessionCacheManager(config, mcpClient);
      sessionCache.startCleanup();

      logger.info("mcp-client", "gateway_start", "ready", undefined, `cacheTtl=${config.sessionCacheTtl}s refreshBuffer=${config.sessionRefreshBuffer}s`);
    });

    // Gateway 关闭时断开连接
    api.on("gateway_stop", async () => {
      logger.info("mcp-client", "gateway_stop", "shutting_down", undefined);

      if (sessionCache) {
        sessionCache.stopCleanup();
        sessionCache.clear();
        sessionCache = null;
      }

      if (mcpClient) {
        await mcpClient.disconnect();
        mcpClient = null;
      }

      logger.info("mcp-client", "gateway_stop", "done", undefined);
    });

    // ===== Tool 1: get_user_docs_and_session =====
    api.registerTool(
      {
        name: "get_user_docs_and_session",
        label: "Get User Docs And Session",
        description:
          "根据用户Token获取该用户可调用的接口文档列表和临时会话Token(session_token)。每个用户首次会话时调用一次。返回 api_docs（接口文档列表）、session_token（用于后续业务接口调用）、accountGbId 和 merchantId。",
        parameters: Type.Object({
          user_token: Type.String({
            description: "前端获取的用户临时Token，用于缓存key",
          }),
          agent_token: Type.String({
            description: "Agent Token，传递给后端用于获取用户接口文档和会话Token",
          }),
          job_number: Type.String({
            description: "工号，传递给后端请求头 job-number",
          }),
        }),
        async execute(_toolCallId: string, params: unknown) {
          const traceId = generateTraceId();
          const startTime = Date.now();
          const p = params as { user_token: string; agent_token: string; job_number: string };

          try {
            if (!sessionCache) {
              throw new Error("会话缓存管理器未初始化，请等待插件启动完成");
            }

            logger.info("mcp-client", "tool:get_user_docs_and_session", "start", undefined, `trace_id=${traceId} user_token=${maskToken(p.user_token)} agent_token=${maskToken(p.agent_token)} job_number=${p.job_number}`);

            // 带缓存的获取用户会话
            const session = await sessionCache.getUserSession(p.user_token, p.agent_token, p.job_number);

            const duration = Date.now() - startTime;
            const cacheStats = sessionCache.getStats();
            logger.info("mcp-client", "tool:get_user_docs_and_session", "success", duration, `trace_id=${traceId} api_docs_count=${session.api_docs.length} cache_size=${cacheStats.size} accountGbId=${session.accountGbId} merchantId=${session.merchantId}`);

            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    api_docs: session.api_docs,
                    session_token: session.session_token,
                    expires_in: Math.floor((session.expires_at - Date.now()) / 1000),
                    accountGbId: session.accountGbId,
                    merchantId: session.merchantId,
                  }),
                },
              ],
              details: undefined,
            };
          } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            const duration = Date.now() - startTime;
            logger.error("mcp-client", "tool:get_user_docs_and_session", "failed", duration, `trace_id=${traceId} error=${errMsg}`);

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
              details: undefined,
            };
          }
        },
      },
      { optional: false }
    );

    // ===== Tool 2: call_business_api =====
    api.registerTool(
      {
        name: "call_business_api",
        label: "Call Business API",
        description:
          "根据session_token调用具体的业务接口，获取实际数据。需要先调用 get_user_docs_and_session 获取 session_token。根据接口文档(api_docs)选择要调用的接口。",
        parameters: Type.Object({
          session_token: Type.String({
            description: "通过 get_user_docs_and_session 获取的临时会话Token",
          }),
          api_path: Type.String({
            description: "接口路径（不含前缀），如 /api/v1/orders",
          }),
          method: Type.Union(
            [Type.Literal("GET"), Type.Literal("POST"), Type.Literal("PUT"), Type.Literal("DELETE")]
          ),
          params: Type.Optional(
            Type.Record(Type.String(), Type.Unknown())
          ),
          headers: Type.Optional(
            Type.Record(Type.String(), Type.String())
          ),
        }),
        async execute(_toolCallId: string, params: unknown) {
          const traceId = generateTraceId();
          const startTime = Date.now();
          const p = params as {
            session_token: string;
            api_path: string;
            method: "GET" | "POST" | "PUT" | "DELETE";
            params?: Record<string, unknown>;
            headers?: Record<string, string>;
          };

          try {
            if (!mcpClient) {
              throw new Error("MCP Client 未初始化，请等待插件启动完成");
            }

            logger.info("mcp-client", "tool:call_business_api", "start", undefined, `trace_id=${traceId} path=${p.api_path} method=${p.method} session_token=${maskToken(p.session_token)}`);

            // 代理转发到 mcp-service
            const result = await mcpClient.callBusinessApi({
              session_token: p.session_token,
              api_path: p.api_path,
              method: p.method,
              params: p.params,
              headers: p.headers,
            });

            const duration = Date.now() - startTime;
            logger.info("mcp-client", "tool:call_business_api", "success", duration, `trace_id=${traceId} path=${p.api_path}`);

            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(result),
                },
              ],
              details: undefined,
            };
          } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            const duration = Date.now() - startTime;
            logger.error("mcp-client", "tool:call_business_api", "failed", duration, `trace_id=${traceId} error=${errMsg}`);

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
              details: undefined,
            };
          }
        },
      },
      { optional: false }
    );
  },
});

function envString(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

function envInt(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  const num = parseInt(value, 10);
  return isNaN(num) ? defaultValue : num;
}

/**
 * 从插件配置和环境变量中解析参数，优先级：插件配置 > 环境变量 > 默认值
 */
function resolveConfig(pluginConfig: Record<string, unknown> | undefined): PluginConfig {
  const config = pluginConfig || {};
  return {
    mcpServiceUrl: (config.mcpServiceUrl as string) || envString("MCP_SERVICE_URL", "http://localhost:3000/mcp"),
    sessionCacheTtl: (config.sessionCacheTtl as number) || envInt("SESSION_CACHE_TTL_SECONDS", 1200),
    sessionRefreshBuffer: (config.sessionRefreshBuffer as number) || envInt("SESSION_REFRESH_BUFFER_SECONDS", 300),
    maxCacheSize: (config.maxCacheSize as number) || envInt("MAX_CACHE_SIZE", 1000),
    requestTimeout: (config.requestTimeout as number) || envInt("REQUEST_TIMEOUT", 30),
  };
}
