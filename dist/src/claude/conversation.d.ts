import type { ClaudeContentBlock } from "../adapter/inbound.js";
import type { ConversationTurn } from "./types.js";
export declare class Conversation {
    private history;
    private maxTurns;
    constructor(maxTurns: number);
    addUserMessage(content: ClaudeContentBlock[]): void;
    addAssistantMessage(text: string): void;
    getHistory(): ConversationTurn[];
    reset(): void;
    private trim;
}
//# sourceMappingURL=conversation.d.ts.map