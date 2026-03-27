import type { WeixinMessage } from "@xmccln/wechat-ilink-sdk";
import type { WeChatClaudeConfig } from "./config.js";
export declare class WeChatClaudeBridge {
    private sdk;
    private config;
    private mediaDownloader;
    private apiEndpoints;
    private debug;
    private sentFiles;
    private typingTickets;
    private claude?;
    private sessions?;
    private acpSessions?;
    constructor(config: WeChatClaudeConfig, token: string);
    start(): Promise<void>;
    destroy(): void;
    /** Process a single WeChat message. Public for testability. */
    processMessage(msg: WeixinMessage): Promise<void>;
    private getTypingTicket;
    private sendTypingIndicator;
    private cancelTypingIndicator;
    /**
     * Handle chat commands. Returns true if message was a command (consumed).
     */
    private handleCommand;
    private handleTaskCommand;
    private processApiMessage;
    private processAcpMessage;
    /** Short helper for sending command responses */
    private reply;
    private createMediaDownloader;
    /** Send progress/tool/thought text — no image scanning */
    private sendProgressText;
    /** Send final agent reply — with image path detection and deduplication */
    private sendReply;
    private static readonly MEDIA_EXTENSIONS;
    /**
     * Extract local file paths pointing to images/media/documents from agent reply text.
     * Looks for absolute paths like /Users/xxx/file.png or /home/xxx/report.pdf
     */
    private extractFilePaths;
    /**
     * Send a local file (image/video) to WeChat user via iLink protocol.
     */
    private sendLocalFile;
    private sendFileBuffer;
    private sendImage;
}
//# sourceMappingURL=bridge.d.ts.map