/**
 * MCP Server 入口 - 启动 MCP Server + Express HTTP 承载 Streamable HTTP transport
 */

import "dotenv/config";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadConfig } from "./config.js";
import { initLogger, logger } from "./logger.js";
import * as userSessionTool from "./tools/user-session.js";
import * as businessApiTool from "./tools/business-api.js";

/**
 * 创建 MCP Server 实例并注册 Tools
 */
function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "midware-mcp-service",
    version: "1.0.0",
  });

  // 注册 Tool 1: get_user_docs_and_session
  server.registerTool(
    userSessionTool.TOOL_NAME,
    {
      description: userSessionTool.TOOL_DESCRIPTION,
      inputSchema: userSessionTool.inputSchema,
    },
    async (params) => {
      return userSessionTool.execute(params);
    }
  );

  // 注册 Tool 2: call_business_api
  server.registerTool(
    businessApiTool.TOOL_NAME,
    {
      description: businessApiTool.TOOL_DESCRIPTION,
      inputSchema: businessApiTool.inputSchema,
    },
    async (params) => {
      return businessApiTool.execute(params);
    }
  );

  return server;
}

/**
 * 启动服务
 */
async function main(): Promise<void> {
  // 加载环境变量
  const config = loadConfig();
  initLogger(config.logLevel);

  logger.info("mcp-service", "startup", "config_loaded", undefined, `port=${config.serverPort} apiPrefix=${config.apiPrefix}`);

  // 创建 Express 应用
  const app = express();
  app.use(express.json());

  // 健康检查端点
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "midware-mcp-service", version: "1.0.0" });
  });

  // MCP Streamable HTTP 端点
  app.post("/mcp", async (req, res) => {
    const startTime = Date.now();
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // 无状态模式
      });

      const server = createMcpServer();
      await server.connect(transport);

      await transport.handleRequest(req, res, req.body);

      const duration = Date.now() - startTime;
      logger.debug("mcp-service", "mcp_request", "handled", duration);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error("mcp-service", "mcp_request", "error", Date.now() - startTime, `error=${errMsg}`);
      res.status(500).json({ error: "internal_error", message: errMsg });
    }
  });

  // GET /mcp - 返回端点信息
  app.get("/mcp", (_req, res) => {
    res.json({
      service: "midware-mcp-service",
      version: "1.0.0",
      protocol: "MCP Streamable HTTP",
      tools: [userSessionTool.TOOL_NAME, businessApiTool.TOOL_NAME],
    });
  });

  // 启动HTTP服务
  app.listen(config.serverPort, () => {
    logger.info("mcp-service", "startup", "listening", undefined, `port=${config.serverPort}`);
    logger.info("mcp-service", "startup", "ready", undefined, `health=http://localhost:${config.serverPort}/health mcp=http://localhost:${config.serverPort}/mcp`);
  });

  // 优雅关闭
  const shutdown = (signal: string) => {
    logger.info("mcp-service", "shutdown", `signal_${signal}`, undefined);
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((error) => {
  logger.error("mcp-service", "startup", "fatal", undefined, `error=${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
