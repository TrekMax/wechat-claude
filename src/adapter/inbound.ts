/**
 * Converts WeChat iLink messages to Claude API content blocks.
 * Handles text, images, voice (with transcription), files, and video.
 */

import type {
  WeixinMessage,
  MessageItem,
} from "@xmccln/wechat-ilink-sdk";

export type ImageMediaType =
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp";

export type ClaudeContentBlock =
  | { type: "text"; text: string }
  | {
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
export type MediaDownloadFn = (
  message: WeixinMessage
) => Promise<DownloadedMediaResult | null>;

const ITEM_TYPE = {
  TEXT: 1,
  IMAGE: 2,
  VOICE: 3,
  FILE: 4,
  VIDEO: 5,
} as const;

function inferImageMediaType(mimeType: string): ImageMediaType {
  if (mimeType === "image/png") return "image/png";
  if (mimeType === "image/gif") return "image/gif";
  if (mimeType === "image/webp") return "image/webp";
  return "image/jpeg";
}

function extractRefText(item: MessageItem): string {
  if (!item.ref_msg?.message_item) return "";

  const ref = item.ref_msg.message_item;
  if (ref.type === ITEM_TYPE.TEXT && ref.text_item?.text) {
    return ref.text_item.text;
  }
  if (ref.type === ITEM_TYPE.IMAGE) return "[Image]";
  if (ref.type === ITEM_TYPE.VOICE) {
    return ref.voice_item?.text || "[Voice]";
  }
  return "[Other message]";
}

function isTextReadable(mimeType: string): boolean {
  return (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType === "application/xml" ||
    mimeType === "application/javascript" ||
    mimeType === "application/typescript"
  );
}

export async function convertToClaudeContent(
  msg: WeixinMessage,
  downloadMedia?: MediaDownloadFn
): Promise<ClaudeContentBlock[]> {
  const blocks: ClaudeContentBlock[] = [];

  if (!msg.item_list || msg.item_list.length === 0) {
    return [{ type: "text", text: "[Empty message]" }];
  }

  for (const item of msg.item_list) {
    const refText = extractRefText(item);

    switch (item.type) {
      case ITEM_TYPE.TEXT: {
        const text = item.text_item?.text ?? "";
        if (refText) {
          blocks.push({
            type: "text",
            text: `[Quoting: "${refText}"]\n${text}`,
          });
        } else {
          blocks.push({ type: "text", text });
        }
        break;
      }

      case ITEM_TYPE.IMAGE: {
        if (!downloadMedia) {
          blocks.push({
            type: "text",
            text: "[Image received but no downloader available]",
          });
          break;
        }
        try {
          const result = await downloadMedia(msg);
          if (result) {
            blocks.push({
              type: "image",
              source: {
                type: "base64",
                media_type: inferImageMediaType(result.mimeType),
                data: result.buffer.toString("base64"),
              },
            });
          } else {
            blocks.push({
              type: "text",
              text: "[Image received but download failed]",
            });
          }
        } catch {
          blocks.push({
            type: "text",
            text: "[Image received but download failed]",
          });
        }
        break;
      }

      case ITEM_TYPE.VOICE: {
        const transcription = item.voice_item?.text;
        if (transcription) {
          blocks.push({
            type: "text",
            text: `[Voice message transcription]: ${transcription}`,
          });
        } else {
          // No transcription — note duration if available
          const duration = item.voice_item?.playtime;
          const durationStr = duration
            ? ` (${Math.round(duration / 1000)}s)`
            : "";
          blocks.push({
            type: "text",
            text: `[Voice message received${durationStr}, no transcription available]`,
          });
        }
        break;
      }

      case ITEM_TYPE.FILE: {
        const filename = item.file_item?.file_name || "unknown file";
        const fileSize = item.file_item?.len;
        const sizeStr = fileSize ? ` (${fileSize} bytes)` : "";

        // Try to download text-readable files
        if (downloadMedia) {
          try {
            const result = await downloadMedia(msg);
            if (result && isTextReadable(result.mimeType)) {
              const content = result.buffer.toString("utf-8");
              blocks.push({
                type: "text",
                text: `[File: ${filename}${sizeStr}]\n\`\`\`\n${content}\n\`\`\``,
              });
              break;
            }
          } catch {
            // fall through to text description
          }
        }

        blocks.push({
          type: "text",
          text: `[File received: ${filename}${sizeStr}]`,
        });
        break;
      }

      case ITEM_TYPE.VIDEO: {
        const duration = item.video_item?.play_length;
        const durationStr = duration ? ` (${duration}s)` : "";
        blocks.push({
          type: "text",
          text: `[Video received${durationStr}]`,
        });
        break;
      }

      default:
        blocks.push({ type: "text", text: "[Unsupported message type]" });
    }
  }

  return blocks.length > 0
    ? blocks
    : [{ type: "text", text: "[Empty message]" }];
}
