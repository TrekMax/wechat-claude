import type { ClaudeContentBlock } from "../adapter/inbound.js";

export interface ConversationTurn {
  role: "user" | "assistant";
  content: ClaudeContentBlock[];
}

export interface ClaudeResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  stopReason: string;
}
