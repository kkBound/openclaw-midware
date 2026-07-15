/**
 * USER_SESSION_URL 测试脚本
 *
 * 1. 先调用 APP_TOKEN_URL 获取 accessToken
 * 2. 用 accessToken + agentToken + appId 调用 USER_SESSION_URL 获取文档信息
 *
 * 运行方式：
 *   cd d:\projects\midware-mcp\test
 *   npx tsx test-user-session.ts
 */

import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// 手动加载 service 的 .env
const envPath = join(import.meta.dirname, "..", "midware-mcp-service", ".env");
const envContent = readFileSync(envPath, "utf-8");
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIndex = trimmed.indexOf("=");
  if (eqIndex === -1) continue;
  const key = trimmed.substring(0, eqIndex).trim();
  const value = trimmed.substring(eqIndex + 1).trim();
  if (!process.env[key]) {
    process.env[key] = value;
  }
}

// ===== 读取配置 =====

const APP_ID = process.env.APP_ID || "";
const APP_SECRET = process.env.APP_SECRET || "";
const APP_TOKEN_URL = process.env.APP_TOKEN_URL || "";
const USER_SESSION_URL = process.env.USER_SESSION_URL || "";

// 测试用 agentToken 和 jobNumber（需替换为真实值）
const TEST_AGENT_TOKEN = process.env.TEST_AGENT_TOKEN || "test_agent_token_001";
const TEST_JOB_NUMBER = process.env.TEST_JOB_NUMBER || "WP09680";

console.log("\n============================================================");
console.log("  USER_SESSION_URL 测试");
console.log("============================================================\n");

console.log("配置信息:");
console.log(`  APP_ID:           ${APP_ID}`);
console.log(`  APP_TOKEN_URL:    ${APP_TOKEN_URL}`);
console.log(`  USER_SESSION_URL: ${USER_SESSION_URL}`);
console.log(`  TEST_AGENT_TOKEN: ${TEST_AGENT_TOKEN.substring(0, 10)}...`);
console.log(`  TEST_JOB_NUMBER:  ${TEST_JOB_NUMBER}`);
console.log("");

if (!APP_ID || !APP_SECRET || !APP_TOKEN_URL || !USER_SESSION_URL) {
  console.error("错误: 请检查 .env 配置");
  process.exit(1);
}

// ===== 工具函数 =====

function buildSignature(body: Record<string, unknown> | null, nonce: string): string {
  let bodyStr = "";
  if (body && Object.keys(body).length > 0) {
    const sortedKeys = Object.keys(body).sort();
    const parts: string[] = [];
    for (const key of sortedKeys) {
      const value = body[key];
      if (value === null || value === undefined || value === "") continue;
      parts.push(`${key}:${String(value)}`);
    }
    bodyStr = parts.join("&");
  }
  const signContent = `appId=${APP_ID}&body=${bodyStr}&nonce=${nonce}&secreteKey=${APP_SECRET}`;
  return createHash("md5").update(signContent, "utf8").digest("hex").toUpperCase();
}

async function fetchAppToken(): Promise<string> {
  console.log("--- Step 1: 获取 accessToken ---\n");

  const body: Record<string, unknown> = {};
  const nonce = randomUUID();
  const sign = buildSignature(body, nonce);

  console.log(`  POST ${APP_TOKEN_URL}`);
  console.log(`  Headers: appId=${APP_ID} sign=${sign.substring(0, 16)}... nonce=${nonce}`);
  console.log(`  Body: {}`);
  console.log("");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  const response = await fetch(APP_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      appId: APP_ID,
      sign: sign,
      nonce: nonce,
    },
    body: JSON.stringify(body),
    signal: controller.signal,
  });

  clearTimeout(timeout);

  const text = await response.text();
  console.log(`  Response: ${text}`);
  console.log("");

  const json = JSON.parse(text);
  if (json.errcode !== 0 || !json.data?.token) {
    throw new Error(`获取 accessToken 失败: errcode=${json.errcode} errMsg=${json.errMsg}`);
  }

  const token = json.data.token;
  console.log(`  [PASS] accessToken = ${token.substring(0, 20)}...`);
  console.log(`         expireTime  = ${json.data.expireTime} (${new Date(parseInt(json.data.expireTime, 10)).toISOString()})`);
  console.log("");

  return token;
}

async function fetchUserSession(accessToken: string): Promise<void> {
  console.log("--- Step 2: 调用 USER_SESSION_URL 获取文档信息 ---\n");

  console.log(`  POST ${USER_SESSION_URL}`);
  console.log(`  Headers:`);
  console.log(`    Content-Type:  application/json`);
  console.log(`    access_token:  ${accessToken.substring(0, 20)}...`);
  console.log(`    appId:         ${APP_ID}`);
  console.log(`    X-Agent-Token: ${TEST_AGENT_TOKEN.substring(0, 10)}...`);
  console.log(`    X-Job-Number:  ${TEST_JOB_NUMBER}`);
  console.log(`  Body: {}`);
  console.log("");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  const response = await fetch(USER_SESSION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      access_token: accessToken,
      appId: APP_ID,
      "X-Agent-Token": TEST_AGENT_TOKEN,
      "X-Job-Number": TEST_JOB_NUMBER,
    },
    body: JSON.stringify({}),
    signal: controller.signal,
  });

  clearTimeout(timeout);

  const text = await response.text();
  console.log(`  Status: ${response.status} ${response.statusText}`);
  console.log(`  Response: ${text}`);
  console.log("");

  // 解析响应
  try {
    const json = JSON.parse(text);

    if (json.errcode !== undefined && json.errcode !== 0) {
      console.log(`  [FAIL] 业务错误: errcode=${json.errcode} errMsg=${json.errMsg}`);
      process.exit(1);
    }

    // 响应可能直接在 data 中，也可能在顶层
    const data = json.data || json;

    if (data.api_docs || data.session_token || data.docs) {
      console.log("  [PASS] 获取文档信息成功！");

      if (data.session_token) {
        console.log(`         session_token:  ${data.session_token.substring(0, 20)}...`);
      }
      if (data.expires_in) {
        console.log(`         expires_in:      ${data.expires_in}`);
      }
      if (data.accountGbId) {
        console.log(`         accountGbId:     ${data.accountGbId}`);
      }
      if (data.merchantId) {
        console.log(`         merchantId:      ${data.merchantId}`);
      }
      if (data.api_docs) {
        console.log(`         api_docs_count:  ${data.api_docs.length}`);
        for (const doc of data.api_docs) {
          console.log(`           - ${doc.name}: ${doc.method} ${doc.path} (${doc.description})`);
        }
      }
      if (data.docs) {
        console.log(`         docs_count:      ${data.docs.length}`);
        for (const doc of data.docs) {
          console.log(`           - ${JSON.stringify(doc).substring(0, 100)}`);
        }
      }
    } else {
      console.log(`  [INFO] 响应结构（未识别到标准字段，完整输出）:`);
      console.log(`         ${JSON.stringify(json, null, 2)}`);
    }
  } catch {
    console.log(`  [FAIL] 非JSON响应: ${text.substring(0, 200)}`);
    process.exit(1);
  }
}

// ===== 主流程 =====

async function main(): Promise<void> {
  try {
    const accessToken = await fetchAppToken();
    await fetchUserSession(accessToken);

    console.log("\n============================================================");
    console.log("  测试通过!");
    console.log("============================================================\n");
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.log(`\n  [FAIL] ${errMsg}`);
    console.log("\n============================================================");
    console.log("  测试失败!");
    console.log("============================================================\n");
    process.exit(1);
  }
}

main();
