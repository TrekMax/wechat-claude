export type BridgeMode = "api" | "acp";
export interface AgentConfig {
    command: string;
    args: string[];
    cwd: string;
    env?: Record<string, string>;
    showThoughts: boolean;
}
export interface WeChatClaudeConfig {
    mode: BridgeMode;
    debug: boolean;
    wechat: {
        baseUrl: string;
        cdnBaseUrl: string;
        botType: string;
    };
    claude: {
        apiKey: string;
        model: string;
        maxTokens: number;
        systemPrompt: string;
        temperature?: number;
    };
    agent: AgentConfig;
    session: {
        idleTimeoutMs: number;
        maxConcurrentUsers: number;
        maxConversationTurns: number;
        resetKeywords: string[];
    };
    storage: {
        dir: string;
    };
}
type DeepPartial<T> = {
    [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};
export declare function loadConfig(overrides?: DeepPartial<WeChatClaudeConfig>): WeChatClaudeConfig;
export {};
//# sourceMappingURL=config.d.ts.map