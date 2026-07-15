/**
 * APP_TOKEN_URL 签名认证测试脚本
 *
 * 实际调用后端认证接口，验证签名计算和响应解析
 *
 * 运行方式：
 *   cd d:\projects\midware-mcp\test
 *   npx tsx test-app-token.ts
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

console.log("\n============================================================");
console.log("  APP_TOKEN_URL 签名认证测试");
console.log("============================================================\n");

console.log("配置信息:");
console.log(`  APP_ID:        ${APP_ID}`);
console.log(`  APP_SECRET:    ${APP_SECRET.substring(0, 8)}...${APP_SECRET.substring(APP_SECRET.length - 4)}`);
console.log(`  APP_TOKEN_URL: ${APP_TOKEN_URL}`);
console.log("");

if (!APP_ID || !APP_SECRET || !APP_TOKEN_URL) {
  console.error("错误: 请检查 .env 中 APP_ID / APP_SECRET / APP_TOKEN_URL 是否配置");
  process.exit(1);
}

// ===== 签名计算过程 =====

const body: Record<string, unknown> = {}; // 空 body
const nonce = randomUUID();

console.log("--- 签名计算过程 ---\n");

// Step 1: 有序Body字符串（空body → 空字符串）
const bodyStr = ""; // body为空
console.log("Step 1 - Body JSON: {}");
console.log(`Step 1 - 有序Body字符串: "${bodyStr}"`);
console.log("");

// Step 2: 签名原文
const signContent = `appId=${APP_ID}&body=${bodyStr}&nonce=${nonce}&secreteKey=${APP_SECRET}`;
console.log("Step 2 - 签名原文:");
console.log(`  appId=${APP_ID}`);
console.log(`  body=${bodyStr}`);
console.log(`  nonce=${nonce}`);
console.log(`  secreteKey=${APP_SECRET.substring(0, 8)}...${APP_SECRET.substring(APP_SECRET.length - 4)}`);
console.log("");

// Step 3: MD5 + 大写
const sign = createHash("md5").update(signContent, "utf8").digest("hex").toUpperCase();
console.log(`Step 3 - Sign = ${sign}`);
console.log("");

// ===== 发送请求 =====

async function main(): Promise<void> {
  console.log("--- 发送HTTP请求 ---\n");

  const requestBody = JSON.stringify(body);

  console.log("请求:");
  console.log(`  POST ${APP_TOKEN_URL}`);
  console.log(`  Headers:`);
  console.log(`    Content-Type: application/json`);
  console.log(`    appId: ${APP_ID}`);
  console.log(`    sign: ${sign.substring(0, 16)}...`);
  console.log(`    nonce: ${nonce}`);
  console.log(`  Body: ${requestBody}`);
  console.log("");

  try {
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
      body: requestBody,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const responseText = await response.text();

    console.log("响应:");
    console.log(`  Status: ${response.status} ${response.statusText}`);
    console.log(`  Body:   ${responseText}`);
    console.log("");

    // 解析响应
    try {
      const json = JSON.parse(responseText);

      if (json.errcode === 0 && json.data?.token) {
        console.log("  [PASS] 获取 app_token 成功！");
        console.log(`         token:      ${json.data.token.substring(0, 20)}...`);
        console.log(`         expireTime: ${json.data.expireTime} (${new Date(parseInt(json.data.expireTime, 10)).toISOString()})`);

        // 验证 token 格式
        const token = json.data.token;
        const expireTime = parseInt(json.data.expireTime, 10);
        const remainingMs = expireTime - Date.now();

        if (token.length > 0 && remainingMs > 0) {
          console.log(`  [PASS] token 非空且未过期 (剩余 ${Math.floor(remainingMs / 1000 / 60)} 分钟)`);
        } else {
          console.log(`  [WARN] token 可能无效或已过期`);
        }

        console.log("\n============================================================");
        console.log("  测试通过!");
        console.log("============================================================\n");
      } else {
        console.log(`  [FAIL] 业务错误: errcode=${json.errcode} errMsg=${json.errMsg}`);
        process.exit(1);
      }
    } catch {
      console.log(`  [FAIL] 非JSON响应: ${responseText.substring(0, 200)}`);
      process.exit(1);
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.log(`  [FAIL] 请求异常: ${errMsg}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("测试失败:", error);
  process.exit(1);
});
