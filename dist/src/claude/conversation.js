export class Conversation {
    history = [];
    maxTurns;
    constructor(maxTurns) {
        this.maxTurns = maxTurns;
    }
    addUserMessage(content) {
        this.history.push({ role: "user", content });
        this.trim();
    }
    addAssistantMessage(text) {
        this.history.push({
            role: "assistant",
            content: [{ type: "text", text }],
        });
        this.trim();
    }
    getHistory() {
        return [...this.history];
    }
    reset() {
        this.history = [];
    }
    trim() {
        while (this.history.length > this.maxTurns) {
            // Remove in pairs to keep user/assistant alignment
            if (this.history.length >= 2 &&
                this.history[0].role === "user" &&
                this.history[1].role === "assistant") {
                this.history.splice(0, 2);
            }
            else {
                this.history.shift();
            }
        }
    }
}
//# sourceMappingURL=conversation.js.map