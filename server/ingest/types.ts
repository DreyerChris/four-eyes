import type { ParsedHunk } from "@shared/domain";

export interface FingerprintedHunk extends ParsedHunk {
  readonly fingerprint: string;
}
