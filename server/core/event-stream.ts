import type { ProgressEvent } from "@shared/domain";
import type { EventBus } from "../lib/events";

/** Replays the review's recent progress events, then yields live ones until `signal` aborts. */
export async function* progressEventStream(
  events: EventBus,
  reviewId: string,
  signal: AbortSignal,
): AsyncGenerator<ProgressEvent> {
  const queue: ProgressEvent[] = [...events.history(reviewId)];
  let wake: (() => void) | null = null;
  const unsubscribe = events.subscribe(reviewId, (event) => {
    queue.push(event);
    wake?.();
  });
  const onAbort = (): void => wake?.();
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    while (!signal.aborted) {
      const next = queue.shift();
      if (next) {
        yield next;
      } else {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = null;
      }
    }
  } finally {
    unsubscribe();
    signal.removeEventListener("abort", onAbort);
  }
}
