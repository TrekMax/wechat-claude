import { describe, it, expect } from "vitest";
import { formatForWeChat, splitText } from "../../src/adapter/outbound.js";

describe("formatForWeChat", () => {
  it("should strip bold markdown", () => {
    expect(formatForWeChat("**hello**")).toBe("hello");
  });

  it("should strip italic markdown", () => {
    expect(formatForWeChat("*italic*")).toBe("italic");
  });

  it("should strip code blocks", () => {
    const input = "before\n```typescript\nconst x = 1;\n```\nafter";
    const result = formatForWeChat(input);
    expect(result).toContain("const x = 1;");
    expect(result).not.toContain("```");
  });

  it("should strip inline code backticks", () => {
    expect(formatForWeChat("use `npm install`")).toBe("use npm install");
  });

  it("should convert headers to plain text", () => {
    expect(formatForWeChat("## Title")).toBe("Title");
    expect(formatForWeChat("### Sub")).toBe("Sub");
  });

  it("should handle empty string", () => {
    expect(formatForWeChat("")).toBe("");
  });

  it("should preserve plain text", () => {
    expect(formatForWeChat("hello world")).toBe("hello world");
  });

  it("should strip link markdown but keep text", () => {
    expect(formatForWeChat("[click here](https://example.com)")).toBe(
      "click here (https://example.com)"
    );
  });
});

describe("splitText", () => {
  it("should return single chunk for short text", () => {
    const result = splitText("hello", 4000);
    expect(result).toEqual(["hello"]);
  });

  it("should split at newlines when possible", () => {
    const line = "a".repeat(2000);
    const text = `${line}\n${line}\n${line}`;
    const result = splitText(text, 4000);
    expect(result.length).toBeGreaterThan(1);
    result.forEach((chunk) => {
      expect(chunk.length).toBeLessThanOrEqual(4000);
    });
  });

  it("should force-split long lines without newlines", () => {
    const text = "a".repeat(8000);
    const result = splitText(text, 4000);
    expect(result.length).toBe(2);
    expect(result[0].length).toBe(4000);
    expect(result[1].length).toBe(4000);
  });

  it("should handle empty string", () => {
    expect(splitText("", 4000)).toEqual([""]);
  });
});
