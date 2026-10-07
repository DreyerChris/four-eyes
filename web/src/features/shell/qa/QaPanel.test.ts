import { describe, expect, it } from "vitest";
import { buildAskRequest, type QaTarget } from "./QaPanel";

const target: QaTarget = {
  reviewId: "rev_1",
  chunkId: "chk_1",
  chunkNumber: 1,
  selection: { reviewId: "rev_1", chunkId: "chk_2", filePath: "src/a.ts", side: "new", startLine: 14, endLine: 10, text: "const a = 1;" },
  prefill: "",
};

describe("buildAskRequest", () => {
  it("ties the question to the selection's file, ordered line range and chunk", () => {
    expect(buildAskRequest(target, "  why?  ", true, true)).toEqual({
      chunkId: "chk_2",
      filePath: "src/a.ts",
      startLine: 10,
      endLine: 14,
      selectedText: "const a = 1;",
      question: "why?",
      useOpus: true,
    });
  });

  it("falls back to the current chunk when the selection is left out", () => {
    expect(buildAskRequest(target, "what changed?", false, false)).toEqual({
      chunkId: "chk_1",
      filePath: null,
      startLine: null,
      endLine: null,
      selectedText: null,
      question: "what changed?",
      useOpus: false,
    });
  });
});
