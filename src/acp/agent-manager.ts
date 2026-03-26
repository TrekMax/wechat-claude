/**
 * Manages spawning and killing ACP agent subprocesses.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import type { AcpClient } from "./client.js";

export interface AgentProcessInfo {
  process: ChildProcess;
  connection: acp.ClientSideConnection;
  sessionId: string;
}

export interface SpawnAgentParams {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  client: AcpClient;
}

export async function spawnAgent(
  params: SpawnAgentParams
): Promise<AgentProcessInfo> {
  const { command, args, cwd, env, client } = params;

  const useShell = process.platform === "win32";

  const proc = spawn(command, args, {
    stdio: ["pipe", "pipe", "inherit"],
    cwd,
    env: { ...process.env, ...env },
    shell: useShell,
  });

  if (!proc.stdin || !proc.stdout) {
    throw new Error("Failed to create agent subprocess with pipe stdio");
  }

  const input = Writable.toWeb(
    proc.stdin
  ) as WritableStream<Uint8Array>;
  const output = Readable.toWeb(
    proc.stdout
  ) as ReadableStream<Uint8Array>;

  const stream = acp.ndJsonStream(input, output);
  const connection = new acp.ClientSideConnection(() => client, stream);

  // Initialize ACP protocol
  await connection.initialize({
    protocolVersion: acp.PROTOCOL_VERSION,
    clientInfo: {
      name: "wechat-claude",
      title: "wechat-claude",
      version: "0.1.0",
    },
    clientCapabilities: {
      fs: {
        readTextFile: true,
        writeTextFile: true,
      },
    },
  });

  // Create session
  const sessionResult = await connection.newSession({
    cwd,
    mcpServers: [],
  });

  return {
    process: proc,
    connection,
    sessionId: sessionResult.sessionId,
  };
}

export function killAgent(proc: ChildProcess): void {
  if (!proc.killed) {
    proc.kill("SIGTERM");
    const forceTimer = setTimeout(() => {
      if (!proc.killed) proc.kill("SIGKILL");
    }, 5_000);
    forceTimer.unref();
  }
}
