// Channels of the v4.channel.k8s.io exec protocol.
const STDOUT = 1;
const STDERR = 2;
const STATUS = 3;

export interface ExecResult {
  stdout: string;
  /** Set when the command failed: what it printed, before the API server's exit-code message. */
  error?: string;
}

/** Collects an exec's frames as they arrive, and says how it ended once the socket closes. */
export function execCollector() {
  const decoder = new TextDecoder();
  let stdout = "";
  let stderr = "";
  let failure: string | undefined;

  return {
    push(frame: Uint8Array): void {
      const text = decoder.decode(frame.slice(1));

      if (frame[0] === STDOUT) stdout += text;
      else if (frame[0] === STDERR) stderr += text;
      else if (frame[0] === STATUS && text) {
        const status = JSON.parse(text) as { status?: string; message?: string };

        if (status.status !== "Success") failure = status.message ?? "the command failed";
      }
    },
    result(): ExecResult {
      if (failure === undefined) return { stdout };

      return { stdout, error: stderr.trim() || stdout.trim() || failure };
    },
  };
}
