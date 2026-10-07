import type { PrRef } from "@shared/domain";
import { HttpError } from "../lib/errors";

const NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;
const EXAMPLE = "https://github.com/<owner>/<repo>/pull/<number>";

const invalid = (input: string, reason: string): HttpError =>
  new HttpError(400, `"${input}" is not a pull request link (${reason}). Expected something like ${EXAMPLE}`);

const toUrl = (input: string): URL | null => {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  try {
    return new URL(withScheme);
  } catch {
    return null;
  }
};

/**
 * Parses a pasted PR link such as https://github.com/o/r/pull/12 or
 * https://ghe.example.com/o/r/pull/12/files into a PrRef.
 * Throws HttpError(400) with a readable message for anything else.
 */
export const parsePrUrl = (url: string): PrRef => {
  const input = url.trim();
  if (input === "") throw invalid(input, "it is empty");
  const parsed = toUrl(input);
  if (parsed === null) throw invalid(input, "it is not a valid URL");
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw invalid(input, "only http and https links are supported");
  if (parsed.hostname === "") throw invalid(input, "it has no host");

  const [owner, repo, kind, numberText] = parsed.pathname.split("/").filter((segment) => segment !== "");
  if (owner === undefined || repo === undefined || kind === undefined || numberText === undefined) {
    throw invalid(input, "the path must be /<owner>/<repo>/pull/<number>");
  }
  if (kind !== "pull") throw invalid(input, `expected "/pull/" after the repository, found "/${kind}/"`);
  if (!NAME_PATTERN.test(owner) || !NAME_PATTERN.test(repo)) throw invalid(input, "the owner or repository name has invalid characters");
  if (!/^\d+$/.test(numberText)) throw invalid(input, `"${numberText}" is not a pull request number`);
  const number = Number(numberText);
  if (!Number.isSafeInteger(number) || number <= 0) throw invalid(input, `"${numberText}" is not a pull request number`);

  return {
    host: parsed.host.toLowerCase(),
    owner,
    repo: repo.endsWith(".git") ? repo.slice(0, -4) : repo,
    number,
  };
};

/** Canonical web URL for a PR reference. */
export const prWebUrl = (ref: PrRef): string => `https://${ref.host}/${ref.owner}/${ref.repo}/pull/${ref.number}`;
