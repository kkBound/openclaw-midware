/**
 * Mock 数据 - 在 MOCK_MODE=true 时替代真实后端调用
 */

import type { UserSessionResponse, CallBusinessApiParams } from "./types.js";

/** Mock app_token */
const MOCK_APP_TOKEN = "app_tok_mock_abcdef123456";

/** Mock session_token（每次调用递增计数，方便验证刷新） */
let sessionCallCount = 0;

/**
 * 模拟 getAppToken 返回
 */
export function mockGetAppToken(): { token: string; expiresAt: number } {
  return {
    token: MOCK_APP_TOKEN,
    expiresAt: Date.now() + 3600 * 1000, // 1小时后过期
  };
}

/**
 * 模拟获取用户会话
 */
export function mockFetchUserSession(userToken: string): UserSessionResponse {
  sessionCallCount++;
  const sessionToken = sessionCallCount >= 2 ? `sess_mock_refreshed_${sessionCallCount}` : "sess_mock_xyz789";

  const result: UserSessionResponse = {
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
      {
        name: "create_order",
        description: "创建订单",
        method: "POST",
        path: "/api/v1/orders",
        parameters: {
          product_id: { type: "string", required: true },
          quantity: { type: "integer", required: true },
          remark: { type: "string", required: false },
        },
        response: {
          type: "object",
          description: "创建订单响应",
          properties: {
            order_id: { type: "string" },
            status: { type: "string" },
          },
        },
      },
    ],
    session_token: sessionToken,
    expires_in: 1200,
  };

  // eslint-disable-next-line no-console
  console.log(`${new Date().toISOString()} INFO  mcp-service mockFetchUserSession success user_token=${userToken.substring(0, 6)}*** session_token=${sessionToken.substring(0, 15)}... call_count=${sessionCallCount}`);

  return result;
}

/**
 * 模拟调用业务API
 */
export function mockCallBusinessApi(params: CallBusinessApiParams): { status: number; body: unknown } {
  const { api_path, method } = params;

  // eslint-disable-next-line no-console
  console.log(`${new Date().toISOString()} INFO  mcp-service mockCallBusinessApi start path=${api_path} method=${method}`);

  // 根据 api_path 返回不同的模拟数据
  if (api_path === "/api/v1/orders" && method === "GET") {
    return {
      status: 200,
      body: {
        total: 2,
        page: 1,
        page_size: 20,
        items: [
          { id: "ORD-001", status: "completed", amount: 199.00, created_at: "2026-07-10T10:00:00Z" },
          { id: "ORD-002", status: "pending", amount: 350.50, created_at: "2026-07-11T14:30:00Z" },
        ],
      },
    };
  }

  if (api_path.startsWith("/api/v1/orders/") && method === "GET") {
    const orderId = api_path.split("/").pop();
    return {
      status: 200,
      body: {
        id: orderId,
        status: "completed",
        amount: 199.00,
        created_at: "2026-07-10T10:00:00Z",
        items: [
          { product_id: "P001", name: "商品A", quantity: 2, price: 99.50 },
        ],
      },
    };
  }

  if (api_path === "/api/v1/orders" && method === "POST") {
    return {
      status: 200,
      body: {
        order_id: "ORD-003",
        status: "created",
        message: "订单创建成功",
      },
    };
  }

  // 默认返回
  return {
    status: 404,
    body: {
      error: "api_not_found",
      message: `Mock模式：未匹配到接口 ${method} ${api_path}`,
    },
  };
}
