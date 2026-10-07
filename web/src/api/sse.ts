import type { z } from "zod";

const parseEventData = <S extends z.ZodType>(schema: S, data: string): z.infer<S> => {
  const parsed = schema.safeParse(JSON.parse(data));
  if (!parsed.success) throw new Error(`Invalid server event: ${parsed.error.message}`);
  return parsed.data;
};

/** Subscribes to a GET server-sent-events route. Returns an unsubscribe function. */
export const subscribeSse = <S extends z.ZodType>(
  url: string,
  schema: S,
  onEvent: (event: z.infer<S>) => void,
  onError?: (message: string) => void,
): (() => void) => {
  const source = new EventSource(url);
  source.onmessage = (message: MessageEvent<string>) => {
    try {
      onEvent(parseEventData(schema, message.data));
    } catch (error) {
      onError?.(error instanceof Error ? error.message : String(error));
    }
  };
  source.onerror = () => {
    if (source.readyState === EventSource.CLOSED) onError?.(`Event stream closed: ${url}`);
  };
  return () => source.close();
};

interface SseFrame {
  readonly event: string;
  readonly data: string;
}

const parseFrame = (raw: string): SseFrame => {
  const lines = raw.split("\n");
  const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim() ?? "message";
  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""))
    .join("\n");
  return { event, data };
};

/** POSTs a JSON body and reads the server-sent-events response until it ends. Rejects on HTTP or stream errors. */
export const postSse = async <S extends z.ZodType>(
  url: string,
  body: unknown,
  schema: S,
  onEvent: (event: z.infer<S>) => void,
  signal?: AbortSignal,
): Promise<void> => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok || !response.body) {
    const text = await response.text();
    throw new Error(`Request to ${url} failed (${response.status}): ${text || response.statusText}`);
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value.replace(/\r\n/g, "\n");
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    frames
      .filter((frame) => frame.trim() !== "")
      .map(parseFrame)
      .forEach((frame) => {
        if (frame.event === "error") throw new Error(`Stream from ${url} failed: ${frame.data}`);
        onEvent(parseEventData(schema, frame.data));
      });
  }
};
