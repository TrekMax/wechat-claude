/**
 * ACP Client implementation.
 * Handles agent communication: chunk accumulation, permission auto-approval,
 * typing indicators, and file system access.
 */
import type * as acp from "@agentclientprotocol/sdk";
export interface AcpClientOpts {
    sendTyping: () => Promise<void>;
    onThoughtFlush: (text: string) => Promise<void>;
    onToolProgress: (text: string) => Promise<void>;
    onImageReceived: (data: Buffer, mimeType: string) => Promise<void>;
    onFileReceived: (data: Buffer, fileName: string, mimeType: string) => Promise<void>;
    showThoughts: boolean;
}
export interface FlushResult {
    text: string;
    images: Array<{
        data: Buffer;
        mimeType: string;
    }>;
}
export declare class AcpClient implements acp.Client {
    private chunks;
    private imageChunks;
    private thoughtChunks;
    private lastTypingAt;
    private opts;
    constructor(opts: AcpClientOpts);
    updateCallbacks(callbacks: {
        sendTyping: () => Promise<void>;
        onThoughtFlush: (text: string) => Promise<void>;
        onToolProgress: (text: string) => Promise<void>;
        onImageReceived: (data: Buffer, mimeType: string) => Promise<void>;
        onFileReceived: (data: Buffer, fileName: string, mimeType: string) => Promise<void>;
    }): void;
    setShowThoughts(enabled: boolean): void;
    get showThoughts(): boolean;
    requestPermission(params: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse>;
    sessionUpdate(params: acp.SessionNotification): Promise<void>;
    readTextFile(params: acp.ReadTextFileRequest): Promise<acp.ReadTextFileResponse>;
    writeTextFile(params: acp.WriteTextFileRequest): Promise<acp.WriteTextFileResponse>;
    createTerminal(): Promise<never>;
    flush(): Promise<string>;
    private maybeFlushThoughts;
    private maybeSendTyping;
}
//# sourceMappingURL=client.d.ts.map