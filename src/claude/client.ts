import Anthropic from "@anthropic-ai/sdk";
import type { ConversationTurn, ClaudeResponse } from "./types.js";

export interface ClaudeClientConfig {
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature?: number;
}

export class ClaudeClient {
  private client: Anthropic;
  private model: string;
  private maxTokens: number;
  private temperature?: number;

  constructor(config: ClaudeClientConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.model = config.model;
    this.maxTokens = config.maxTokens;
    this.temperature = config.temperature;
  }

  async chat(
    messages: ConversationTurn[],
    systemPrompt: string
  ): Promise<ClaudeResponse> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: systemPrompt,
      messages: messages.map((turn) => ({
        role: turn.role,
        content: turn.content,
      })),
      ...(this.temperature !== undefined && {
        temperature: this.temperature,
      }),
    });

    const textParts = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text);

    return {
      text: textParts.join(""),
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      stopReason: response.stop_reason ?? "unknown",
    };
  }
}
