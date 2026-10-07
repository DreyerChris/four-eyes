import { describe, expect, it } from "vitest";
import { createEventBus } from "../lib/events";
import { progressEventStream } from "./event-stream";

describe("progressEventStream", () => {
  it("replays history, then yields live events until aborted", async () => {
    const bus = createEventBus();
    bus.publish("rev_1", { type: "step", step: "fetch_pr", state: "done", message: null });
    const controller = new AbortController();
    const stream = progressEventStream(bus, "rev_1", controller.signal);

    const first = await stream.next();
    expect(first.value).toMatchObject({ type: "step", step: "fetch_pr" });

    const pending = stream.next();
    bus.publish("rev_1", { type: "review_updated" });
    expect((await pending).value).toMatchObject({ type: "review_updated" });

    const ended = stream.next();
    controller.abort();
    expect((await ended).done).toBe(true);
  });
});
