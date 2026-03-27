/**
 * Converts WeChat iLink messages to Claude API content blocks.
 * Handles text, images, voice (with transcription), files, and video.
 */
import type { WeixinMessage } from "@xmccln/wechat-ilink-sdk";
export type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";
export type ClaudeContentBlock = {
    type: "text";
    text: string;
} | {
    type: "image";
    source: {
        type: "base64";
        media_type: ImageMediaType;
        data: string;
    };
};
export interface DownloadedMediaResult {
    buffer: Buffer;
    mimeType: string;
}
/** Downloads media from a message, returns buffer and mime type */
export type MediaDownloadFn = (message: WeixinMessage) => Promise<DownloadedMediaResult | null>;
export declare function convertToClaudeContent(msg: WeixinMessage, downloadMedia?: MediaDownloadFn): Promise<ClaudeContentBlock[]>;
//# sourceMappingURL=inbound.d.ts.map