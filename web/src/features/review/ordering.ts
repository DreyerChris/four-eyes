import type { ChunkView, FindingView } from "@shared/api";
import { SEVERITIES } from "@shared/domain";

/** Chunks in stepping order: by round, then by position within the round. */
export const orderChunks = (chunks: readonly ChunkView[]): readonly ChunkView[] =>
  [...chunks].sort((a, b) => a.roundNumber - b.roundNumber || a.position - b.position);

/** Index of the chunk to show: the one in the URL, else the first unseen one, else the first. */
export const resolveChunkIndex = (chunks: readonly ChunkView[], chunkId: string | null): number => {
  const fromUrl = chunkId === null ? -1 : chunks.findIndex((chunk) => chunk.id === chunkId);
  if (fromUrl !== -1) return fromUrl;
  const unseen = chunks.findIndex((chunk) => chunk.progress.status === "unseen");
  return unseen === -1 ? 0 : unseen;
};

/** Nearest unseen chunk after (step 1) or before (step -1) `from`, or -1. */
export const findUnseen = (chunks: readonly ChunkView[], from: number, step: 1 | -1): number => {
  const indexes = Array.from({ length: chunks.length }, (_, offset) => from + step * (offset + 1)).filter(
    (index) => index >= 0 && index < chunks.length,
  );
  return indexes.find((index) => chunks[index]?.progress.status === "unseen") ?? -1;
};

/** Findings in display order: grouped by severity, resolved ones last within each group. */
export const orderFindings = (findings: readonly FindingView[]): readonly FindingView[] =>
  SEVERITIES.flatMap((severity) => {
    const group = findings.filter((finding) => finding.severity === severity);
    return [...group.filter((finding) => finding.lifecycle !== "resolved"), ...group.filter((finding) => finding.lifecycle === "resolved")];
  });
