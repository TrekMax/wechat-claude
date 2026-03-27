import type { ConversationTurn, ClaudeResponse } from "./types.js";
export interface ClaudeClientConfig {
    apiKey: string;
    model: string;
    maxTokens: number;
    temperature?: number;
}
export declare class ClaudeClient {
    private client;
    private model;
    private maxTokens;
    private temperature?;
    constructor(config: ClaudeClientConfig);
    chat(messages: ConversationTurn[], systemPrompt: string): Promise<ClaudeResponse>;
}
//# sourceMappingURL=client.d.ts.map