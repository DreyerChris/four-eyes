import type { Verbosity } from "@shared/domain";

export interface OutputLengthRules {
  readonly chunkExplanation: string;
  readonly finding: string;
  readonly verdictSummary: string;
  readonly answer: string;
}

/** Prompt lines that set how long Claude's written output is, per verbosity setting. "standard" is the original wording. */
export const OUTPUT_LENGTH_RULES: Readonly<Record<Verbosity, OutputLengthRules>> = {
  brief: {
    chunkExplanation: "explanation: one plain sentence on what changed and what the reviewer should look for.",
    finding: "title: one short line. explanation: one or two sentences with what is wrong and the key evidence. suggestedFix: optional, one line.",
    verdictSummary: "verdict.summary: one plain sentence on the overall state of the PR.",
    answer: "Answer as briefly as you can, usually in one to three sentences. Leave out background the reviewer did not ask for.",
  },
  standard: {
    chunkExplanation: "explanation: two or three plain sentences on what changed and why it matters, so the reviewer knows what to look for.",
    finding: "title: one short line. explanation: what is wrong, why it matters, and the evidence. suggestedFix: optional, a short concrete fix.",
    verdictSummary: "verdict.summary: two to four plain sentences on the overall state of the PR.",
    answer: "Keep the answer focused on the question.",
  },
  detailed: {
    chunkExplanation:
      "explanation: a short paragraph (four to six plain sentences) on what changed, why, how it connects to the rest of the PR, and what the reviewer should check.",
    finding:
      "title: one short line. explanation: a full paragraph covering what is wrong, when it happens, why it matters, and the evidence with path:line references. suggestedFix: optional, a concrete fix, which may include a short code snippet.",
    verdictSummary:
      "verdict.summary: a short paragraph (four to six plain sentences) on the overall state of the PR, its main risks, and what the author should do next.",
    answer: "Answer thoroughly. Explain your reasoning, the related code paths and any edge cases, with path:line references.",
  },
};
