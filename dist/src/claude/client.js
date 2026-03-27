import Anthropic from "@anthropic-ai/sdk";
export class ClaudeClient {
    client;
    model;
    maxTokens;
    temperature;
    constructor(config) {
        this.client = new Anthropic({ apiKey: config.apiKey });
        this.model = config.model;
        this.maxTokens = config.maxTokens;
        this.temperature = config.temperature;
    }
    async chat(messages, systemPrompt) {
        const apiMessages = messages.map((turn) => ({
            role: turn.role,
            content: turn.content.map((block) => {
                if (block.type === "text") {
                    return { type: "text", text: block.text };
                }
                // Image block
                return {
                    type: "image",
                    source: {
                        type: "base64",
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
            .filter((block) => block.type === "text")
            .map((block) => block.text);
        return {
            text: textParts.join(""),
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
            stopReason: response.stop_reason ?? "unknown",
        };
    }
}
//# sourceMappingURL=client.js.map