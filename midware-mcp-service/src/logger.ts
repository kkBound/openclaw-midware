/**
 * 日志配置 - 支持脱敏和 trace_id
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

let currentLevel: LogLevel = "info";

export function initLogger(level: string): void {
  if (level in LEVEL_PRIORITY) {
    currentLevel = level as LogLevel;
  }
}

/** Token脱敏：仅显示前6位 + *** */
export function maskToken(token: string): string {
  if (!token || token.length <= 6) return "***";
  return token.substring(0, 6) + "***";
}

/** 生成 trace_id */
export function generateTraceId(): string {
  return `trace_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 8)}`;
}

function log(level: LogLevel, component: string, action: string, result: string, durationMs?: number, extra?: string): void {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[currentLevel]) return;

  const timestamp = new Date().toISOString();
  const parts = [timestamp, level.toUpperCase(), component, action, result];
  if (durationMs !== undefined) {
    parts.push(`${durationMs}ms`);
  }
  if (extra) {
    parts.push(extra);
  }

  const message = parts.join(" ");

  if (level === "error") {
    console.error(message);
  } else if (level === "warn") {
    console.warn(message);
  } else {
    console.log(message);
  }
}

export const logger = {
  debug: (component: string, action: string, result: string, durationMs?: number, extra?: string) =>
    log("debug", component, action, result, durationMs, extra),
  info: (component: string, action: string, result: string, durationMs?: number, extra?: string) =>
    log("info", component, action, result, durationMs, extra),
  warn: (component: string, action: string, result: string, durationMs?: number, extra?: string) =>
    log("warn", component, action, result, durationMs, extra),
  error: (component: string, action: string, result: string, durationMs?: number, extra?: string) =>
    log("error", component, action, result, durationMs, extra),
};
