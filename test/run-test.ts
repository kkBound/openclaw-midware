/**
 * 本地集成测试脚本
 *
 * 测试流程：
 * 1. 启动 Mock mcp-service（模拟 app_token 获取 + 用户会话 + 业务API）
 * 2. 创建 mcp-client 的 McpServiceClient + SessionCacheManager
 * 3. 验证连接、Tool 调用、缓存命中、缓存过期刷新
 *
 * 运行方式：
 *   cd d:\projects\midware-mcp\test
 *   npx tsx run-test.ts
 *
 * 或从项目根目录：
 *   npx tsx test/run-test.ts
 */

import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import { createHash } from "node:crypto";

// ===== 测试配置 =====

const MOCK_SERVICE_PORT = 3999;
const MOCK_SERVICE_URL = `http://localhost:${MOCK_SERVICE_PORT}/mcp`;

// 模拟的 app_token
const MOCK_APP_TOKEN = "app_tok_mock_abcdef123456";
const MOCK_SESSION_TOKEN = "sess_mock_xyz789";
const MOCK_USER_TOKEN = "user_tok_test_001";

// ===== 测试工具函数 =====

let stepCount = 0;
function step(name: string): void {
  stepCount++;
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  步骤 ${stepCount}: ${name}`);
  console.log(`${"=".repeat(60)}\n`);
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`  [FAIL] ${message}`);
    process.exit(1);
  } else {
    console.log(`  [PASS] ${message}`);
  }
}

// ===== Mock MCP Service =====

function createMockMcpServer(): McpServer {
  const server = new McpServer({
    name: "mock-midware-mcp-service",
    version: "1.0.0-test",
  });

  let callCount = 0;

  // Tool 1: get_user_docs_and_session
  server.tool(
    "get_user_docs_and_session",
    "根据用户临时Token获取接口文档列表和会话Token",
    {
      user_token: z.string().describe("用户临时Token"),
    },
    async (params) => {
      callCount++;
      console.log(`  [Mock Service] 收到 get_user_docs_and_session 调用 #${callCount}`);
      console.log(`  [Mock Service] user_token: ${params.user_token.substring(0, 10)}...`);

      // 第3次调用返回新的 session_token（模拟刷新）
      const sessionToken = callCount >= 3 ? "sess_mock_REFRESHED_999" : MOCK_SESSION_TOKEN;

      const result = {
        api_docs: [
          {
            name: "query_order_list",
            description: "查询订单列表",
            method: "GET",
            path: "/api/v1/orders",
            parameters: {
              status: { type: "string", required: false, description: "订单状态" },
              page: { type: "integer", required: false, default: 1 },
            },
            response: {
              type: "object",
              description: "订单列表响应",
              properties: {
                total: { type: "integer" },
                items: { type: "array" },
              },
            },
          },
          {
            name: "get_order_detail",
            description: "获取订单详情",
            method: "GET",
            path: "/api/v1/orders/{id}",
            parameters: {
              id: { type: "string", required: true },
            },
            response: {
              type: "object",
              description: "订单详情响应",
            },
          },
        ],
        session_token: sessionToken,
        expires_in: 3, // 3秒过期，方便测试缓存刷新
      };

      console.log(`  [Mock Service] 返回 session_token: ${sessionToken.substring(0, 15)}... expires_in: 3s`);

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    }
  );

  // Tool 2: call_business_api
  server.tool(
    "call_business_api",
    "调用业务接口",
    {
      session_token: z.string(),
      api_path: z.string(),
      method: z.enum(["GET", "POST", "PUT", "DELETE"]),
      params: z.record(z.unknown()).optional(),
      headers: z.record(z.string()).optional(),
    },
    async (params) => {
      console.log(`  [Mock Service] 收到 call_business_api 调用`);
      console.log(`  [Mock Service] session_token: ${params.session_token.substring(0, 15)}...`);
      console.log(`  [Mock Service] api_path: ${params.api_path}`);
      console.log(`  [Mock Service] method: ${params.method}`);

      // 模拟业务数据返回
      const mockData = {
        status: 200,
        data: {
          total: 2,
          page: 1,
          page_size: 20,
          items: [
            { id: "ORD-001", status: "completed", amount: 199.00, created_at: "2026-07-10T10:00:00Z" },
            { id: "ORD-002", status: "pending", amount: 350.50, created_at: "2026-07-11T14:30:00Z" },
          ],
        },
      };

      console.log(`  [Mock Service] 返回模拟业务数据`);

      return {
        content: [{ type: "text" as const, text: JSON.stringify(mockData) }],
      };
    }
  );

  return server;
}

// ===== 启动 Mock Service =====

async function startMockService(): Promise<ReturnType<express.Application["listen"]>> {
  return new Promise((resolve, reject) => {
    const app = express();
    app.use(express.json());

    // 健康检查
    app.get("/health", (_req, res) => {
      res.json({ status: "ok", service: "mock-midware-mcp-service" });
    });

    // MCP Streamable HTTP 端点
    app.post("/mcp", async (req, res) => {
      try {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });
        const server = createMockMcpServer();
        await server.connect(transport);
        await transport.handleIncomingMessage(req.body, res, req.headers);
      } catch (error) {
        console.error("  [Mock Service] 错误:", error);
        res.status(500).json({ error: "mock_service_error" });
      }
    });

    app.get("/mcp", (_req, res) => {
      res.json({ service: "mock-midware-mcp-service", tools: ["get_user_docs_and_session", "call_business_api"] });
    });

    const server = app.listen(MOCK_SERVICE_PORT, () => {
      console.log(`  [Mock Service] 已启动，监听端口 ${MOCK_SERVICE_PORT}`);
      resolve(server);
    });

    server.on("error", reject);
  });
}

// ===== 简易 Logger（测试用） =====

function testLog(component: string, action: string, result: string, extra?: string): void {
  const ts = new Date().toISOString();
  const msg = extra ? `${ts} INFO  ${component} ${action} ${result} ${extra}` : `${ts} INFO  ${component} ${action} ${result}`;
  console.log(`  [TEST] ${msg}`);
}

// ===== SimpleMcpClient（测试用，直接操作MCP SDK） =====

class SimpleMcpClient {
  private client: Client | null = null;

  async connect(url: string): Promise<void> {
    const transport = new StreamableHTTPClientTransport(new URL(url));
    this.client = new Client(
      { name: "test-client", version: "1.0.0" },
      { capabilities: { tools: {} } }
    );
    await this.client.connect(transport);
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    if (!this.client) throw new Error("Client未连接");
    const result = await this.client.callTool({ name, arguments: args });
    const content = result.content as Array<{ type: string; text?: string }>;
    const textContent = content?.find((c) => c.type === "text" && c.text);
    if (!textContent?.text) throw new Error("返回内容为空");
    return textContent.text;
  }

  async listTools(): Promise<unknown> {
    if (!this.client) throw new Error("Client未连接");
    return await this.client.listTools();
  }
}

// ===== SimpleSessionCache（测试用，简化版缓存） =====

interface CacheEntry {
  api_docs: unknown[];
  session_token: string;
  expires_at: number;
  user_token_hash: string;
}

class SimpleSessionCache {
  private cache = new Map<string, CacheEntry>();
  private refreshBufferMs: number;
  private fetchCount = 0;

  constructor(refreshBufferSeconds: number = 1) {
    this.refreshBufferMs = refreshBufferSeconds * 1000;
  }

  async getUserSession(userToken: string, client: SimpleMcpClient): Promise<CacheEntry> {
    const cacheKey = createHash("sha256").update(userToken).digest("hex");
    const now = Date.now();

    const cached = this.cache.get(cacheKey);
    if (cached) {
      const remainingMs = cached.expires_at - now;

      // 已过期
      if (now >= cached.expires_at) {
        testLog("sessionCache", "getUserSession", "cache_expired", `remaining_ms=${remainingMs}`);
        this.cache.delete(cacheKey);
      } else if (now >= cached.expires_at - this.refreshBufferMs) {
        // 即将过期 - 异步刷新，返回旧数据
        testLog("sessionCache", "getUserSession", "cache_near_expiry", `remaining_ms=${remainingMs} triggering_refresh`);
        this.refreshAsync(userToken, cacheKey, client);
        return cached;
      } else {
        // 缓存有效
        testLog("sessionCache", "getUserSession", "cache_hit", `remaining_ms=${remainingMs} session_token=${cached.session_token.substring(0, 15)}...`);
        return cached;
      }
    } else {
      testLog("sessionCache", "getUserSession", "cache_miss", `key=${cacheKey.substring(0, 16)}...`);
    }

    // 从 service 获取
    this.fetchCount++;
    testLog("sessionCache", "getUserSession", `fetching #${this.fetchCount}`, "");
    const text = await client.callTool("get_user_docs_and_session", { user_token: userToken });
    const result = JSON.parse(text);

    const entry: CacheEntry = {
      api_docs: result.api_docs,
      session_token: result.session_token,
      expires_at: Date.now() + result.expires_in * 1000,
      user_token_hash: cacheKey,
    };

    this.cache.set(cacheKey, entry);
    testLog("sessionCache", "getUserSession", "fetched", `session_token=${entry.session_token.substring(0, 15)}... expires_in=${result.expires_in}s`);

    return entry;
  }

  private async refreshAsync(userToken: string, cacheKey: string, client: SimpleMcpClient): Promise<void> {
    this.fetchCount++;
    testLog("sessionCache", "refreshAsync", `start #${this.fetchCount}`, "");
    try {
      const text = await client.callTool("get_user_docs_and_session", { user_token: userToken });
      const result = JSON.parse(text);
      const entry: CacheEntry = {
        api_docs: result.api_docs,
        session_token: result.session_token,
        expires_at: Date.now() + result.expires_in * 1000,
        user_token_hash: cacheKey,
      };
      this.cache.set(cacheKey, entry);
      testLog("sessionCache", "refreshAsync", "success", `new_session_token=${entry.session_token.substring(0, 15)}...`);
    } catch (error) {
      testLog("sessionCache", "refreshAsync", "failed", `${error instanceof Error ? error.message : String(error)}`);
    }
  }

  getStats(): { size: number; fetchCount: number } {
    return { size: this.cache.size, fetchCount: this.fetchCount };
  }

  clear(): void {
    this.cache.clear();
    this.fetchCount = 0;
  }
}

// ===== 主测试流程 =====

async function main(): Promise<void> {
  console.log("\n");
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║     Midware MCP 本地集成测试                              ║");
  console.log("║     mcp-client ↔ mcp-service 连接与工具调用验证           ║");
  console.log("╚══════════════════════════════════════════════════════════╝");

  // ===== 步骤1: 启动 Mock Service =====
  step("启动 Mock mcp-service");
  const mockServer = await startMockService();
  console.log(`  Mock Service URL: ${MOCK_SERVICE_URL}`);

  // 健康检查
  const healthResp = await fetch(`http://localhost:${MOCK_SERVICE_PORT}/health`);
  const health = await healthResp.json();
  assert(health.status === "ok", "Mock Service 健康检查");

  let client: SimpleMcpClient | null = null;

  try {
    // ===== 步骤2: 连接 mcp-service =====
    step("MCP Client 连接 mcp-service");
    client = new SimpleMcpClient();
    await client.connect(MOCK_SERVICE_URL);
    assert(true, "Client 连接成功");

    // 列出可用 Tools
    const tools = await client.listTools() as { tools?: Array<{ name: string; description?: string }> };
    const toolNames = tools.tools?.map((t) => t.name) || [];
    console.log(`  可用 Tools: ${toolNames.join(", ")}`);
    assert(toolNames.includes("get_user_docs_and_session"), "Tool get_user_docs_and_session 已注册");
    assert(toolNames.includes("call_business_api"), "Tool call_business_api 已注册");

    // ===== 步骤3: 首次调用 get_user_docs_and_session（缓存未命中） =====
    step("首次调用 get_user_docs_and_session（缓存未命中）");
    const cache = new SimpleSessionCache(1); // 1秒刷新缓冲

    const session1 = await cache.getUserSession(MOCK_USER_TOKEN, client);
    assert(session1.api_docs.length === 2, "返回2个API文档");
    assert(session1.session_token === MOCK_SESSION_TOKEN, `session_token = ${MOCK_SESSION_TOKEN}`);
    assert(session1.expires_at > Date.now(), "过期时间在未来");
    console.log(`  缓存统计: ${JSON.stringify(cache.getStats())}`);
    assert(cache.getStats().fetchCount === 1, "首次调用 fetchCount=1");

    // ===== 步骤4: 第二次调用（缓存命中） =====
    step("第二次调用（缓存命中，不触发网络请求）");
    const session2 = await cache.getUserSession(MOCK_USER_TOKEN, client);
    assert(session2.session_token === session1.session_token, "返回相同 session_token");
    assert(cache.getStats().fetchCount === 1, "fetchCount 仍为1（缓存命中）");
    console.log(`  缓存统计: ${JSON.stringify(cache.getStats())}`);

    // ===== 步骤5: 等待缓存即将过期，触发异步刷新 =====
    step("等待缓存即将过期，触发异步刷新");
    console.log("  等待 2.5 秒（expires_in=3s, refreshBuffer=1s → 2s后进入刷新区间）...");
    await new Promise((r) => setTimeout(r, 2500));

    const session3 = await cache.getUserSession(MOCK_USER_TOKEN, client);
    // 此时应该返回旧的缓存数据（即将过期），同时异步刷新
    assert(session3.session_token === MOCK_SESSION_TOKEN, "返回旧 session_token（异步刷新中）");
    console.log(`  缓存统计: ${JSON.stringify(cache.getStats())}`);

    // 等待异步刷新完成
    console.log("  等待 0.5 秒，让异步刷新完成...");
    await new Promise((r) => setTimeout(r, 500));

    // ===== 步骤6: 再次调用，应返回刷新后的数据 =====
    step("刷新后调用（应返回新 session_token）");
    const session4 = await cache.getUserSession(MOCK_USER_TOKEN, client);
    console.log(`  session_token: ${session4.session_token.substring(0, 25)}...`);
    // 刷新后的 token 应该是 "sess_mock_REFRESHED_999"
    assert(
      session4.session_token === "sess_mock_REFRESHED_999",
      "返回刷新后的新 session_token"
    );
    console.log(`  缓存统计: ${JSON.stringify(cache.getStats())}`);

    // ===== 步骤7: 调用 call_business_api =====
    step("调用 call_business_api 获取业务数据");
    const bizResultText = await client.callTool("call_business_api", {
      session_token: session4.session_token,
      api_path: "/api/v1/orders",
      method: "GET",
      params: { status: "pending", page: 1 },
    });
    const bizResult = JSON.parse(bizResultText);
    assert(bizResult.status === 200, "业务API返回 status=200");
    assert(bizResult.data.total === 2, "返回2条订单");
    assert(bizResult.data.items.length === 2, "订单列表长度=2");
    console.log(`  业务数据: ${JSON.stringify(bizResult.data, null, 2).substring(0, 200)}...`);

    // ===== 步骤8: 缓存过期后重新获取 =====
    step("缓存完全过期后重新获取");
    console.log("  等待 4 秒，让缓存完全过期...");
    await new Promise((r) => setTimeout(r, 4000));

    const beforeFetch = cache.getStats().fetchCount;
    const session5 = await cache.getUserSession(MOCK_USER_TOKEN, client);
    assert(cache.getStats().fetchCount > beforeFetch, "fetchCount 增加（过期后重新获取）");
    assert(session5.session_token !== "", "返回有效 session_token");
    console.log(`  缓存统计: ${JSON.stringify(cache.getStats())}`);

    // ===== 测试完成 =====
    console.log("\n");
    console.log("╔══════════════════════════════════════════════════════════╗");
    console.log("║                     所有测试通过!                          ║");
    console.log("╚══════════════════════════════════════════════════════════╝\n");

  } finally {
    // 清理
    if (client) {
      await client.disconnect();
      console.log("  [清理] MCP Client 已断开");
    }
    mockServer.close();
    console.log("  [清理] Mock Service 已停止");
  }
}

// 运行测试
main().catch((error) => {
  console.error("\n测试失败:", error);
  process.exit(1);
});
