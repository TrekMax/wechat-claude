import { describe, it, expect, vi } from "vitest";
import { convertToClaudeContent } from "../../src/adapter/inbound.js";
import type { WeixinMessage } from "@xmccln/wechat-ilink-sdk";

// Helper to build SDK-shaped messages
function makeTextMessage(text: string): WeixinMessage {
  return {
    from_user_id: "user1",
    context_token: "ctx1",
    message_type: 1,
    item_list: [
      { type: 1, text_item: { text } },
    ],
  };
}

function makeImageMessage(): WeixinMessage {
  return {
    from_user_id: "user1",
    context_token: "ctx1",
    message_type: 1,
    item_list: [
      {
        type: 2,
        image_item: {
          media: { encrypt_query_param: "param1", aes_key: "key1" },
        },
      },
    ],
  };
}

function makeVoiceMessage(transcription?: string): WeixinMessage {
  return {
    from_user_id: "user1",
    context_token: "ctx1",
    message_type: 1,
    item_list: [
      {
        type: 3,
        voice_item: {
          media: { encrypt_query_param: "param1", aes_key: "key1" },
          ...(transcription ? { text: transcription } : {}),
        },
      },
    ],
  };
}

describe("convertToClaudeContent", () => {
  it("should convert text message to text content block", async () => {
    const result = await convertToClaudeContent(makeTextMessage("hello"));
    expect(result).toEqual([{ type: "text", text: "hello" }]);
  });

  it("should handle empty text", async () => {
    const result = await convertToClaudeContent(makeTextMessage(""));
    expect(result).toEqual([{ type: "text", text: "" }]);
  });

  it("should handle empty item_list", async () => {
    const msg: WeixinMessage = {
      from_user_id: "user1",
      context_token: "ctx1",
      item_list: [],
    };
    const result = await convertToClaudeContent(msg);
    expect(result).toEqual([{ type: "text", text: "[Empty message]" }]);
  });

  it("should convert image with downloader to base64 content block", async () => {
    const mockDownload = vi.fn().mockResolvedValue({
      buffer: Buffer.from("fake-image-data"),
      mimeType: "image/jpeg",
    });

    const result = await convertToClaudeContent(makeImageMessage(), mockDownload);

    expect(mockDownload).toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/jpeg",
      },
    });
  });

  it("should fallback to text when image download fails", async () => {
    const mockDownload = vi.fn().mockRejectedValue(new Error("download failed"));
    const result = await convertToClaudeContent(makeImageMessage(), mockDownload);

    expect(result).toEqual([
      { type: "text", text: "[Image received but download failed]" },
    ]);
  });

  it("should use voice transcription when available", async () => {
    const result = await convertToClaudeContent(makeVoiceMessage("hello world"));
    expect(result).toEqual([
      { type: "text", text: "[Voice message transcription]: hello world" },
    ]);
  });

  it("should note when voice has no transcription", async () => {
    const result = await convertToClaudeContent(makeVoiceMessage());
    expect(result).toEqual([
      { type: "text", text: "[Voice message received, no transcription available]" },
    ]);
  });

  it("should handle message with reference/quote", async () => {
    const msg: WeixinMessage = {
      from_user_id: "user1",
      context_token: "ctx1",
      message_type: 1,
      item_list: [
        {
          type: 1,
          text_item: { text: "my reply" },
          ref_msg: {
            message_item: {
              type: 1,
              text_item: { text: "original message" },
            },
          },
        },
      ],
    };
    const result = await convertToClaudeContent(msg);
    expect(result[0]).toMatchObject({ type: "text" });
    const text = (result[0] as { type: "text"; text: string }).text;
    expect(text).toContain("original message");
    expect(text).toContain("my reply");
  });
});
