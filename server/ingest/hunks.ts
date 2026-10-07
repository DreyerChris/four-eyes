import { parseUnifiedDiff } from "./diff";
import { fingerprintHunk } from "./fingerprint";
import { diffBetween } from "./git";
import { splitLargeHunks } from "./split";
import type { FingerprintedHunk } from "./types";

/** parse → split → fingerprint for an already-fetched raw diff. */
export const hunksFromDiff = (raw: string): readonly FingerprintedHunk[] =>
  splitLargeHunks(parseUnifiedDiff(raw)).map((hunk) => ({ ...hunk, fingerprint: fingerprintHunk(hunk) }));

/** diff → parse → split → fingerprint for base...head inside `repoPath`. Shared by ingest and refresh. */
export const computeHunks = async (
  repoPath: string,
  baseSha: string,
  headSha: string,
): Promise<readonly FingerprintedHunk[]> => hunksFromDiff(await diffBetween(repoPath, baseSha, headSha));
