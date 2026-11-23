export interface MobileStreamEvent {
  event: "request" | "provider" | "delta" | "done";
  data: Record<string, unknown>;
}

/** Self-contained so the same tested implementation can run in the WebView. */
export function createMobileStreamParser(onEvent: (event: MobileStreamEvent) => void) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let pending = "";
  let event = "";
  let data = "";
  let totalBytes = 0;
  let outputChars = 0;
  let done = false;
  const maxFrame = 65_536;

  function dispatch() {
    if (!event && !data) return;
    if (done) throw new Error("AI_STREAM_AFTER_DONE");
    let value: Record<string, unknown>;
    try {
      value = JSON.parse(data);
    } catch {
      throw new Error("AI_STREAM_INVALID_JSON");
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("AI_STREAM_INVALID_EVENT");
    }
    if (event === "error") {
      throw new Error(typeof value.error === "string" && /^[A-Z0-9_]{1,80}$/.test(value.error)
        ? value.error : "AI_STREAM_ERROR");
    }
    if (event === "delta") {
      if (typeof value.text !== "string") throw new Error("AI_STREAM_INVALID_DELTA");
      outputChars += value.text.length;
      if (outputChars > 524_288) throw new Error("AI_RESPONSE_TOO_LARGE");
    } else if (event === "request") {
      if (typeof value.requestId !== "string") throw new Error("AI_STREAM_INVALID_REQUEST");
    } else if (event === "provider") {
      if (typeof value.id !== "string" || typeof value.model !== "string") throw new Error("AI_STREAM_INVALID_PROVIDER");
    } else if (event === "done") {
      if (typeof value.provider !== "string" || typeof value.model !== "string") throw new Error("AI_STREAM_INVALID_DONE");
      if (!outputChars) throw new Error("AI_EMPTY_RESPONSE");
      done = true;
    } else {
      throw new Error("AI_STREAM_UNKNOWN_EVENT");
    }
    onEvent({ event: event as MobileStreamEvent["event"], data: value });
    event = "";
    data = "";
  }

  function decode(text: string) {
    pending += text;
    let newline: number;
    while ((newline = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, newline).replace(/\r$/, "");
      pending = pending.slice(newline + 1);
      if (line.length + data.length > maxFrame) throw new Error("AI_STREAM_FRAME_TOO_LARGE");
      if (!line) dispatch();
      else if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data += (data ? "\n" : "") + line.slice(5).replace(/^ /, "");
      else if (!line.startsWith(":")) throw new Error("AI_STREAM_INVALID_FRAME");
    }
    if (pending.length + data.length > maxFrame) throw new Error("AI_STREAM_FRAME_TOO_LARGE");
  }

  return {
    push(chunk: Uint8Array) {
      totalBytes += chunk.byteLength;
      if (totalBytes > 2_097_152) throw new Error("AI_STREAM_TOO_LARGE");
      decode(decoder.decode(chunk, { stream: true }));
    },
    finish() {
      decode(decoder.decode());
      if (pending || event || data || !done) throw new Error("AI_STREAM_INCOMPLETE");
    }
  };
}
