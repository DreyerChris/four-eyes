import type { Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { JsonRoute, PathParams, SseRoute } from "@shared/api";
import { errorMessage, HttpError } from "./errors";

type Infer<S> = S extends z.ZodType ? z.infer<S> : undefined;

export interface HandlerInput<P extends string, Q, B> {
  readonly params: PathParams<P>;
  readonly query: Infer<Q>;
  readonly body: Infer<B>;
  readonly signal: AbortSignal;
  readonly c: Context;
}

const formatZodError = (error: z.ZodError): string =>
  error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");

const parseWith = <S extends z.ZodType | null>(schema: S, value: unknown, what: string): Infer<S> => {
  if (schema === null) return undefined as Infer<S>;
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(400, `Invalid ${what}: ${formatZodError(result.error)}`);
  return result.data as Infer<S>;
};

const readJsonBody = async (c: Context): Promise<unknown> => {
  const text = await c.req.text();
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Request body is not valid JSON");
  }
};

const readInput = async <P extends string, Q extends z.ZodType | null, B extends z.ZodType | null>(
  c: Context,
  route: { readonly path: P; readonly query: Q; readonly body: B },
): Promise<HandlerInput<P, Q, B>> => ({
  params: c.req.param() as PathParams<P>,
  query: parseWith(route.query, c.req.query(), "query"),
  body: parseWith(route.body, route.body === null ? undefined : await readJsonBody(c), "body"),
  signal: c.req.raw.signal,
  c,
});

const methodFor = (method: string): "get" | "post" | "put" | "patch" | "delete" => {
  const lower = method.toLowerCase();
  if (lower === "get" || lower === "post" || lower === "put" || lower === "patch" || lower === "delete") return lower;
  throw new Error(`Unsupported HTTP method ${method}`);
};

/** Registers a JSON route from shared/api.ts. The handler gets validated params, query and body. */
export const registerJson = <P extends string, Q extends z.ZodType | null, B extends z.ZodType | null, R extends z.ZodType>(
  app: Hono,
  route: JsonRoute<P, Q, B, R>,
  handler: (input: HandlerInput<P, Q, B>) => Promise<z.infer<R>> | z.infer<R>,
): void => {
  app.on(methodFor(route.method).toUpperCase(), route.path, async (c) => {
    const input = await readInput(c, route);
    return c.json(await handler(input));
  });
};

/** Registers a server-sent-events route. Each yielded value is sent as one `data:` JSON message. */
export const registerSse = <P extends string, Q extends z.ZodType | null, B extends z.ZodType | null, E extends z.ZodType>(
  app: Hono,
  route: SseRoute<P, Q, B, E>,
  handler: (input: HandlerInput<P, Q, B>) => Promise<AsyncIterable<z.infer<E>>> | AsyncIterable<z.infer<E>>,
): void => {
  app.on(methodFor(route.method).toUpperCase(), route.path, async (c) => {
    const input = await readInput(c, route);
    const iterable = await handler(input);
    return streamSSE(c, async (stream) => {
      try {
        for await (const event of iterable) {
          if (stream.aborted) break;
          await stream.writeSSE({ data: JSON.stringify(event) });
        }
      } catch (error) {
        console.error(`[sse] ${route.method} ${route.path} failed`, error);
        await stream.writeSSE({ event: "error", data: JSON.stringify({ error: errorMessage(error) }) });
      }
    });
  });
};

/** Maps thrown errors to JSON `{ error }` responses with a fitting status code. */
export const handleError = (error: Error, c: Context): Response => {
  if (error instanceof HttpError) return c.json({ error: error.message }, error.status);
  console.error(`[http] ${c.req.method} ${c.req.path} failed`, error);
  return c.json({ error: error.message || "Internal server error" }, 500);
};
