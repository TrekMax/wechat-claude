import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages.js";
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
    const apiMessages: MessageParam[] = messages.map((turn) => ({
      role: turn.role,
      content: turn.content.map((block) => {
        if (block.type === "text") {
          return { type: "text" as const, text: block.text };
        }
        // Image block
        return {
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: block.source.media_type,
            data: block.source.data,
          },
        };
      }),
    }));

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: systemPrompt,
      messages: apiMessages,
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
