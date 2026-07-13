/**
 * MCP Client - 连接 midware-mcp-service，代理 Tool 调用
 */
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
export declare class McpServiceClient {
    private client;
    private config;
    constructor(config: PluginConfig);
    /**
     * 连接 midware-mcp-service
     */
    connect(): Promise<void>;
    /**
     * 断开连接
     */
    disconnect(): Promise<void>;
    /**
     * 调用 get_user_docs_and_session
     */
    callGetUserDocsAndSession(userToken: string): Promise<UserSessionResult>;
    /**
     * 调用 call_business_api
     */
    callBusinessApi(params: CallBusinessApiParams): Promise<unknown>;
    /**
     * 从 MCP Tool 返回结果中提取 text 内容
     */
    private extractText;
    /**
     * 检查是否已连接
     */
    isConnected(): boolean;
}
