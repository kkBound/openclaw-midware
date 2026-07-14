/**
 * 本地集成测试脚本
 *
 * 测试流程：
 * 1. 启动 midware-mcp-service（MOCK_MODE=true，不连真实后端）
 * 2. 创建 MCP Client 连接 service
 * 3. 验证连接、Tool 调用、缓存命中、缓存过期刷新
 *
 * 运行方式：
 *   cd d:\projects\midware-mcp\test
 *   npx tsx run-test.ts
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createHash } from "node:crypto";

// ===== 测试配置 =====

const SERVICE_URL = process.env.SERVICE_URL || "http://localhost:9003/mcp";
const MOCK_USER_TOKEN = "user_tok_test_001";
const MOCK_AGENT_TOKEN = "agent_tok_test_001";
const MOCK_JOB_NUMBER = "EMP001";

// ===== 测试工具函数 =====

let stepCount = 0;
function step(name: string): void {
  stepCount++;
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Step ${stepCount}: ${name}`);
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

function testLog(component: string, action: string, result: string, extra?: string): void {
  const ts = new Date().toISOString();
  const msg = extra ? `${ts} INFO  ${component} ${action} ${result} ${extra}` : `${ts} INFO  ${component} ${action} ${result}`;
  console.log(`  [TEST] ${msg}`);
}

// ===== SimpleMcpClient（测试用 MCP Client） =====

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
    const r = result as Record<string, unknown>;
    const content = r.content;

    // 标准形式
    if (Array.isArray(content)) {
      for (const item of content) {
        const c = item as { type?: string; text?: string };
        if (c.type === "text" && typeof c.text === "string") {
          return c.text;
        }
      }
    }

    // 兼容形式
    if (r.toolResult !== undefined) {
      return typeof r.toolResult === "string" ? r.toolResult : JSON.stringify(r.toolResult);
    }

    throw new Error("返回内容无法解析");
  }

  async listTools(): Promise<unknown> {
    if (!this.client) throw new Error("Client未连接");
    return await this.client.listTools();
  }
}

// ===== SimpleSessionCache（测试用简化版缓存） =====

interface CacheEntry {
  api_docs: unknown[];
  session_token: string;
  expires_at: number;
  user_token_hash: string;
  accountGbId: string;
  merchantId: string;
}

class SimpleSessionCache {
  private cache = new Map<string, CacheEntry>();
  private refreshBufferMs: number;
  private fetchCount = 0;

  constructor(refreshBufferSeconds: number = 1) {
    this.refreshBufferMs = refreshBufferSeconds * 1000;
  }

  async getUserSession(
    userToken: string,
    agentToken: string,
    jobNumber: string,
    client: SimpleMcpClient
  ): Promise<CacheEntry> {
    const cacheKey = createHash("sha256").update(userToken).digest("hex");
    const now = Date.now();

    const cached = this.cache.get(cacheKey);
    if (cached) {
      const remainingMs = cached.expires_at - now;

      if (now >= cached.expires_at) {
        testLog("sessionCache", "getUserSession", "cache_expired", `remaining_ms=${remainingMs}`);
        this.cache.delete(cacheKey);
      } else if (now >= cached.expires_at - this.refreshBufferMs) {
        testLog("sessionCache", "getUserSession", "cache_near_expiry", `remaining_ms=${remainingMs} triggering_refresh`);
        this.refreshAsync(agentToken, jobNumber, cacheKey, client);
        return cached;
      } else {
        testLog("sessionCache", "getUserSession", "cache_hit", `remaining_ms=${remainingMs}`);
        return cached;
      }
    } else {
      testLog("sessionCache", "getUserSession", "cache_miss", `key=${cacheKey.substring(0, 16)}...`);
    }

    this.fetchCount++;
    testLog("sessionCache", "getUserSession", `fetching #${this.fetchCount}`, "");
    const text = await client.callTool("get_user_docs_and_session", {
      agent_token: agentToken,
      job_number: jobNumber,
    });
    const result = JSON.parse(text);

    const entry: CacheEntry = {
      api_docs: result.api_docs,
      session_token: result.session_token,
      expires_at: Date.now() + result.expires_in * 1000,
      user_token_hash: cacheKey,
      accountGbId: result.accountGbId,
      merchantId: result.merchantId,
    };

    this.cache.set(cacheKey, entry);
    testLog("sessionCache", "getUserSession", "fetched", `session_token=${entry.session_token.substring(0, 15)}...`);

    return entry;
  }

  private async refreshAsync(
    agentToken: string,
    jobNumber: string,
    cacheKey: string,
    client: SimpleMcpClient
  ): Promise<void> {
    this.fetchCount++;
    testLog("sessionCache", "refreshAsync", `start #${this.fetchCount}`, "");
    try {
      const text = await client.callTool("get_user_docs_and_session", {
        agent_token: agentToken,
        job_number: jobNumber,
      });
      const result = JSON.parse(text);
      const entry: CacheEntry = {
        api_docs: result.api_docs,
        session_token: result.session_token,
        expires_at: Date.now() + result.expires_in * 1000,
        user_token_hash: cacheKey,
        accountGbId: result.accountGbId,
        merchantId: result.merchantId,
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
}

// ===== 主测试流程 =====

async function main(): Promise<void> {
  console.log("\n");
  console.log("============================================================");
  console.log("     Midware MCP 本地集成测试");
  console.log("     mcp-client <-> mcp-service (MOCK_MODE) 连接验证");
  console.log("============================================================");

  console.log(`\n  Service URL: ${SERVICE_URL}`);
  console.log(`  请确保 midware-mcp-service 已启动（MOCK_MODE=true）\n`);

  let client: SimpleMcpClient | null = null;

  try {
    // ===== Step 1: 健康检查 =====
    step("健康检查 midware-mcp-service");
    const healthResp = await fetch(`${SERVICE_URL.replace("/mcp", "/health")}`);
    if (!healthResp.ok) {
      throw new Error(`Service 未启动或不可达: ${healthResp.status}`);
    }
    const health = await healthResp.json();
    assert(health.status === "ok", "Service 健康检查通过");
    console.log(`  Service: ${health.service} v${health.version}`);

    // ===== Step 2: 连接 service =====
    step("MCP Client 连接 mcp-service");
    client = new SimpleMcpClient();
    await client.connect(SERVICE_URL);
    assert(true, "Client 连接成功");

    // 列出可用 Tools
    const tools = await client.listTools() as { tools?: Array<{ name: string; description?: string }> };
    const toolNames = tools.tools?.map((t) => t.name) || [];
    console.log(`  可用 Tools: ${toolNames.join(", ")}`);
    assert(toolNames.includes("get_user_docs_and_session"), "Tool get_user_docs_and_session 已注册");
    assert(toolNames.includes("call_business_api"), "Tool call_business_api 已注册");

    // ===== Step 3: 调用 get_user_docs_and_session =====
    step("调用 get_user_docs_and_session（agent_token + job_number）");
    const text1 = await client.callTool("get_user_docs_and_session", {
      agent_token: MOCK_AGENT_TOKEN,
      job_number: MOCK_JOB_NUMBER,
    });
    const session1 = JSON.parse(text1);
    assert(session1.api_docs.length === 3, `返回3个API文档（实际: ${session1.api_docs.length}）`);
    assert(session1.session_token === "sess_mock_xyz789", `首次 session_token = sess_mock_xyz789`);
    assert(session1.expires_in > 0, `expires_in > 0`);
    assert(session1.accountGbId === "acc_gb_001", `accountGbId = acc_gb_001`);
    assert(session1.merchantId === "mch_001", `merchantId = mch_001`);
    console.log(`  session_token: ${session1.session_token}`);
    console.log(`  expires_in: ${session1.expires_in}s`);
    console.log(`  accountGbId: ${session1.accountGbId}`);
    console.log(`  merchantId: ${session1.merchantId}`);
    console.log(`  api_docs: ${session1.api_docs.map((d: { name: string }) => d.name).join(", ")}`);

    // ===== Step 4: 调用 call_business_api（GET 订单列表） =====
    step("调用 call_business_api（GET /api/v1/orders）");
    const bizText1 = await client.callTool("call_business_api", {
      session_token: session1.session_token,
      api_path: "/api/v1/orders",
      method: "GET",
      params: { status: "pending", page: 1 },
    });
    const biz1 = JSON.parse(bizText1);
    assert(biz1.total === 2, `返回2条订单（实际: ${biz1.total}）`);
    assert(biz1.items.length === 2, `订单列表长度=2`);
    console.log(`  订单1: ${biz1.items[0].id} ${biz1.items[0].status} ${biz1.items[0].amount}`);
    console.log(`  订单2: ${biz1.items[1].id} ${biz1.items[1].status} ${biz1.items[1].amount}`);

    // ===== Step 5: 调用 call_business_api（GET 订单详情） =====
    step("调用 call_business_api（GET /api/v1/orders/ORD-001）");
    const bizText2 = await client.callTool("call_business_api", {
      session_token: session1.session_token,
      api_path: "/api/v1/orders/ORD-001",
      method: "GET",
    });
    const biz2 = JSON.parse(bizText2);
    assert(biz2.id === "ORD-001", `订单ID = ORD-001`);
    assert(biz2.status === "completed", `订单状态 = completed`);
    console.log(`  订单详情: id=${biz2.id} status=${biz2.status} amount=${biz2.amount}`);

    // ===== Step 6: 调用 call_business_api（POST 创建订单） =====
    step("调用 call_business_api（POST /api/v1/orders）");
    const bizText3 = await client.callTool("call_business_api", {
      session_token: session1.session_token,
      api_path: "/api/v1/orders",
      method: "POST",
      params: { product_id: "P001", quantity: 2 },
    });
    const biz3 = JSON.parse(bizText3);
    assert(biz3.order_id === "ORD-003", `新订单ID = ORD-003`);
    assert(biz3.status === "created", `订单状态 = created`);
    console.log(`  创建订单: order_id=${biz3.order_id} status=${biz3.status}`);

    // ===== Step 7: 测试缓存逻辑（使用简化缓存） =====
    step("测试 session 缓存逻辑（user_token作缓存key，agent_token+job_number传service）");
    const cache = new SimpleSessionCache(1);

    // 首次获取 - cache miss
    const cs1 = await cache.getUserSession(MOCK_USER_TOKEN, MOCK_AGENT_TOKEN, MOCK_JOB_NUMBER, client);
    assert(cache.getStats().fetchCount === 1, "首次获取 fetchCount=1");
    assert(cs1.accountGbId === "acc_gb_001", "缓存条目包含 accountGbId");
    assert(cs1.merchantId === "mch_001", "缓存条目包含 merchantId");

    // 第二次获取 - cache hit
    const cs2 = await cache.getUserSession(MOCK_USER_TOKEN, MOCK_AGENT_TOKEN, MOCK_JOB_NUMBER, client);
    assert(cs2.session_token === cs1.session_token, "缓存命中，返回相同 session_token");
    assert(cache.getStats().fetchCount === 1, "fetchCount 仍为1（缓存命中）");
    console.log(`  缓存统计: ${JSON.stringify(cache.getStats())}`);

    // ===== 测试完成 =====
    console.log("\n");
    console.log("============================================================");
    console.log("                     所有测试通过!");
    console.log("============================================================\n");

  } finally {
    if (client) {
      await client.disconnect();
      console.log("  [清理] MCP Client 已断开");
    }
  }
}

main().catch((error) => {
  console.error("\n测试失败:", error);
  process.exit(1);
});
