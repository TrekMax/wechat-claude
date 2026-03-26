import type { ClaudeContentBlock } from "../adapter/inbound.js";
import type { ConversationTurn } from "./types.js";

export class Conversation {
  private history: ConversationTurn[] = [];
  private maxTurns: number;

  constructor(maxTurns: number) {
    this.maxTurns = maxTurns;
  }

  addUserMessage(content: ClaudeContentBlock[]): void {
    this.history.push({ role: "user", content });
    this.trim();
  }

  addAssistantMessage(text: string): void {
    this.history.push({
      role: "assistant",
      content: [{ type: "text", text }],
    });
    this.trim();
  }

  getHistory(): ConversationTurn[] {
    return [...this.history];
  }

  reset(): void {
    this.history = [];
  }

  private trim(): void {
    while (this.history.length > this.maxTurns) {
      // Remove in pairs to keep user/assistant alignment
      if (
        this.history.length >= 2 &&
        this.history[0].role === "user" &&
        this.history[1].role === "assistant"
      ) {
        this.history.splice(0, 2);
      } else {
        this.history.shift();
      }
    }
  }
}
