import { describe, it, expect, vi } from "vitest";
import { AcpClient } from "../../src/acp/client.js";

describe("AcpClient", () => {
  function makeClient(opts?: { showThoughts?: boolean }) {
    return new AcpClient({
      sendTyping: vi.fn().mockResolvedValue(undefined),
      onThoughtFlush: vi.fn().mockResolvedValue(undefined),
      onToolProgress: vi.fn().mockResolvedValue(undefined),
      onImageReceived: vi.fn().mockResolvedValue(undefined),
      showThoughts: opts?.showThoughts ?? false,
    });
  }

  it("should accumulate text chunks and flush", async () => {
    const client = makeClient();

    await client.sessionUpdate({
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Hello " },
      },
    } as never);

    await client.sessionUpdate({
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "world!" },
      },
    } as never);

    const result = await client.flush();
    expect(result).toBe("Hello world!");
  });

  it("should reset chunks after flush", async () => {
    const client = makeClient();

    await client.sessionUpdate({
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "first" },
      },
    } as never);

    await client.flush();

    await client.sessionUpdate({
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "second" },
      },
    } as never);

    const result = await client.flush();
    expect(result).toBe("second");
  });

  it("should auto-approve permission requests", async () => {
    const client = makeClient();

    const result = await client.requestPermission({
      options: [
        { optionId: "deny", kind: "deny" },
        { optionId: "allow_once", kind: "allow_once" },
        { optionId: "allow_always", kind: "allow_always" },
      ],
    } as never);

    expect(result.outcome).toMatchObject({
      outcome: "selected",
      optionId: "allow_once",
    });
  });

  it("should fallback to first option if no allow option", async () => {
    const client = makeClient();

    const result = await client.requestPermission({
      options: [{ optionId: "custom", kind: "custom" }],
    } as never);

    expect(result.outcome).toMatchObject({
      outcome: "selected",
      optionId: "custom",
    });
  });

  it("should throttle typing indicators", async () => {
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const client = new AcpClient({
      sendTyping,
      onThoughtFlush: vi.fn().mockResolvedValue(undefined),
      onToolProgress: vi.fn().mockResolvedValue(undefined),
      onImageReceived: vi.fn().mockResolvedValue(undefined),
      showThoughts: false,
    });

    // Send multiple chunks rapidly
    for (let i = 0; i < 5; i++) {
      await client.sessionUpdate({
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: `chunk${i}` },
        },
      } as never);
    }

    // Should only have called typing once (throttled)
    expect(sendTyping).toHaveBeenCalledTimes(1);
  });

  it("should send tool progress notifications", async () => {
    const onToolProgress = vi.fn().mockResolvedValue(undefined);
    const client = new AcpClient({
      sendTyping: vi.fn().mockResolvedValue(undefined),
      onThoughtFlush: vi.fn().mockResolvedValue(undefined),
      onToolProgress,
      onImageReceived: vi.fn().mockResolvedValue(undefined),
      showThoughts: false,
    });

    await client.sessionUpdate({
      update: {
        sessionUpdate: "tool_call",
        title: "Read src/main.ts",
        status: "running",
      },
    } as never);

    expect(onToolProgress).toHaveBeenCalledWith("[Read src/main.ts]");
  });

  it("should accumulate thought chunks when showThoughts enabled", async () => {
    const onThoughtFlush = vi.fn().mockResolvedValue(undefined);
    const client = new AcpClient({
      sendTyping: vi.fn().mockResolvedValue(undefined),
      onThoughtFlush,
      onToolProgress: vi.fn().mockResolvedValue(undefined),
      onImageReceived: vi.fn().mockResolvedValue(undefined),
      showThoughts: true,
    });

    await client.sessionUpdate({
      update: {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "thinking..." },
      },
    } as never);

    // Thought flush happens when a message chunk arrives or on flush()
    await client.flush();
    expect(onThoughtFlush).toHaveBeenCalledWith(
      expect.stringContaining("thinking...")
    );
  });

  it("should ignore thought chunks when showThoughts disabled", async () => {
    const onThoughtFlush = vi.fn().mockResolvedValue(undefined);
    const client = new AcpClient({
      sendTyping: vi.fn().mockResolvedValue(undefined),
      onToolProgress: vi.fn().mockResolvedValue(undefined),
      onImageReceived: vi.fn().mockResolvedValue(undefined),
      onThoughtFlush,
      showThoughts: false,
    });

    await client.sessionUpdate({
      update: {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "thinking..." },
      },
    } as never);

    await client.flush();
    expect(onThoughtFlush).not.toHaveBeenCalled();
  });

  it("should provide readTextFile", async () => {
    // We don't test actual file reading, just verify the method exists
    const client = makeClient();
    expect(typeof client.readTextFile).toBe("function");
  });

  it("should provide writeTextFile", async () => {
    const client = makeClient();
    expect(typeof client.writeTextFile).toBe("function");
  });
});
