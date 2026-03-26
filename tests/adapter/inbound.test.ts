import { describe, it, expect, vi } from "vitest";
import { convertToClaudeContent } from "../../src/adapter/inbound.js";
import type { WeixinMessage } from "../../src/adapter/inbound.js";

describe("convertToClaudeContent", () => {
  const makeTextMessage = (text: string): WeixinMessage => ({
    msg_type: 1, // TEXT
    content: { text },
    from_user_id: "user1",
    context_token: "ctx1",
  });

  const makeImageMessage = (): WeixinMessage => ({
    msg_type: 2, // IMAGE
    content: {
      media_url: "https://cdn.example.com/image.jpg",
      aes_key: "0123456789abcdef",
    },
    from_user_id: "user1",
    context_token: "ctx1",
  });

  const makeVoiceMessage = (transcription?: string): WeixinMessage => ({
    msg_type: 3, // VOICE
    content: {
      media_url: "https://cdn.example.com/voice.silk",
      aes_key: "0123456789abcdef",
      ...(transcription ? { transcription } : {}),
    },
    from_user_id: "user1",
    context_token: "ctx1",
  });

  it("should convert text message to text content block", async () => {
    const result = await convertToClaudeContent(makeTextMessage("hello"));
    expect(result).toEqual([{ type: "text", text: "hello" }]);
  });

  it("should handle empty text", async () => {
    const result = await convertToClaudeContent(makeTextMessage(""));
    expect(result).toEqual([{ type: "text", text: "" }]);
  });

  it("should convert image message to image content block", async () => {
    const mockDownload = vi.fn().mockResolvedValue(Buffer.from("fake-image-data"));
    const result = await convertToClaudeContent(makeImageMessage(), mockDownload);

    expect(mockDownload).toHaveBeenCalledWith(
      "https://cdn.example.com/image.jpg",
      "0123456789abcdef"
    );
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
    const result = await convertToClaudeContent(
      makeVoiceMessage("hello world")
    );
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
      msg_type: 1,
      content: { text: "my reply" },
      from_user_id: "user1",
      context_token: "ctx1",
      ref_message: {
        content: { text: "original message" },
        msg_type: 1,
      },
    };
    const result = await convertToClaudeContent(msg);
    expect(result[0]).toMatchObject({ type: "text" });
    expect((result[0] as { type: "text"; text: string }).text).toContain("original message");
    expect((result[0] as { type: "text"; text: string }).text).toContain("my reply");
  });
});
