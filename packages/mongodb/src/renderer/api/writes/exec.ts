/** Kubernetes exec frames (v4.channel.k8s.io): the first byte names the stream. */
export function execOutput(frames: Uint8Array[]): { stdout: string; error?: string } {
  const decoder = new TextDecoder();
  let stdout = "";
  let error: string | undefined;

  for (const frame of frames) {
    const text = decoder.decode(frame.slice(1));

    if (frame[0] === 1) stdout += text;
    else if (frame[0] === 3 && text) {
      const status = JSON.parse(text) as { status?: string; message?: string };

      if (status.status !== "Success") error = status.message ?? "the command failed";
    }
  }

  return { stdout, error };
}
