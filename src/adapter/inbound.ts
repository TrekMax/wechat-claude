/**
 * Converts WeChat iLink messages to Claude API content blocks.
 */

export interface WeixinMessage {
  msg_type: number; // 1=text, 2=image, 3=voice, 4=file, 5=video
  content: Record<string, unknown>;
  from_user_id: string;
  context_token: string;
  ref_message?: {
    content: Record<string, unknown>;
    msg_type: number;
  };
}

export type ClaudeContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: {
        type: "base64";
        media_type: string;
        data: string;
      };
    };

export type MediaDownloader = (
  url: string,
  aesKey: string
) => Promise<Buffer>;

const MSG_TYPE = {
  TEXT: 1,
  IMAGE: 2,
  VOICE: 3,
  FILE: 4,
  VIDEO: 5,
} as const;

function inferMediaType(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes(".png")) return "image/png";
  if (lower.includes(".gif")) return "image/gif";
  if (lower.includes(".webp")) return "image/webp";
  return "image/jpeg";
}

function extractRefText(msg: WeixinMessage): string {
  if (!msg.ref_message) return "";

  const ref = msg.ref_message;
  let refText = "";

  if (ref.msg_type === MSG_TYPE.TEXT && ref.content?.text) {
    refText = String(ref.content.text);
  } else if (ref.msg_type === MSG_TYPE.IMAGE) {
    refText = "[Image]";
  } else if (ref.msg_type === MSG_TYPE.VOICE) {
    refText = ref.content?.transcription
      ? String(ref.content.transcription)
      : "[Voice]";
  } else {
    refText = "[Other message]";
  }

  return refText;
}

export async function convertToClaudeContent(
  msg: WeixinMessage,
  downloadMedia?: MediaDownloader
): Promise<ClaudeContentBlock[]> {
  switch (msg.msg_type) {
    case MSG_TYPE.TEXT: {
      const text = String(msg.content.text ?? "");
      const refText = extractRefText(msg);
      if (refText) {
        return [{ type: "text", text: `[Quoting: "${refText}"]\n${text}` }];
      }
      return [{ type: "text", text }];
    }

    case MSG_TYPE.IMAGE: {
      if (!downloadMedia) {
        return [{ type: "text", text: "[Image received but no downloader available]" }];
      }
      try {
        const url = String(msg.content.media_url);
        const aesKey = String(msg.content.aes_key);
        const buffer = await downloadMedia(url, aesKey);
        return [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: inferMediaType(url),
              data: buffer.toString("base64"),
            },
          },
        ];
      } catch {
        return [{ type: "text", text: "[Image received but download failed]" }];
      }
    }

    case MSG_TYPE.VOICE: {
      const transcription = msg.content.transcription;
      if (transcription) {
        return [
          {
            type: "text",
            text: `[Voice message transcription]: ${String(transcription)}`,
          },
        ];
      }
      return [
        { type: "text", text: "[Voice message received, no transcription available]" },
      ];
    }

    case MSG_TYPE.FILE: {
      const filename = msg.content.file_name || "unknown file";
      return [
        { type: "text", text: `[File received: ${String(filename)}]` },
      ];
    }

    case MSG_TYPE.VIDEO: {
      return [{ type: "text", text: "[Video received]" }];
    }

    default:
      return [{ type: "text", text: "[Unsupported message type]" }];
  }
}
