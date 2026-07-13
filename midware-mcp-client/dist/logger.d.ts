/**
 * 日志配置 - 支持脱敏和 trace_id
 */
export declare function initLogger(level: string): void;
/** Token脱敏：仅显示前6位 + *** */
export declare function maskToken(token: string): string;
/** 生成 trace_id */
export declare function generateTraceId(): string;
export declare const logger: {
    debug: (component: string, action: string, result: string, durationMs?: number, extra?: string) => void;
    info: (component: string, action: string, result: string, durationMs?: number, extra?: string) => void;
    warn: (component: string, action: string, result: string, durationMs?: number, extra?: string) => void;
    error: (component: string, action: string, result: string, durationMs?: number, extra?: string) => void;
};
