import { describe, expect, it } from "vitest";
import type { ChunkView } from "@shared/api";
import { findUnseen, orderChunks, orderFindings, resolveChunkIndex } from "./ordering";
import { fixtureChunk, fixtureFinding, fixtureProgress } from "./testFixtures";

const chunk = (id: string, roundNumber: number, position: number, status: "unseen" | "good" = "unseen"): ChunkView =>
  fixtureChunk({ id, roundNumber, position, progress: fixtureProgress({ chunkId: id, status }) });

describe("orderChunks", () => {
  it("orders by round, then position", () => {
    const ordered = orderChunks([chunk("r2a", 2, 0), chunk("r1b", 1, 1), chunk("r1a", 1, 0)]);
    expect(ordered.map((c) => c.id)).toEqual(["r1a", "r1b", "r2a"]);
  });
});

describe("resolveChunkIndex", () => {
  const chunks = [chunk("a", 1, 0, "good"), chunk("b", 1, 1), chunk("c", 1, 2)];

  it("prefers the chunk in the URL", () => {
    expect(resolveChunkIndex(chunks, "c")).toBe(2);
  });

  it("falls back to the first unseen chunk, then the first chunk", () => {
    expect(resolveChunkIndex(chunks, "missing")).toBe(1);
    expect(resolveChunkIndex([chunk("a", 1, 0, "good")], null)).toBe(0);
  });
});

describe("findUnseen", () => {
  const chunks = [chunk("a", 1, 0), chunk("b", 1, 1, "good"), chunk("c", 1, 2), chunk("d", 1, 3, "good")];

  it("finds the nearest unseen chunk in either direction", () => {
    expect(findUnseen(chunks, 0, 1)).toBe(2);
    expect(findUnseen(chunks, 3, -1)).toBe(2);
    expect(findUnseen(chunks, 2, 1)).toBe(-1);
  });
});

describe("orderFindings", () => {
  it("groups by severity and puts resolved findings last", () => {
    const ordered = orderFindings([
      fixtureFinding({ id: "nit", severity: "nit" }),
      fixtureFinding({ id: "bug-resolved", lifecycle: "resolved" }),
      fixtureFinding({ id: "bug" }),
      fixtureFinding({ id: "risk", severity: "risk" }),
    ]);
    expect(ordered.map((finding) => finding.id)).toEqual(["bug", "bug-resolved", "risk", "nit"]);
  });
});
