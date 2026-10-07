import { useEffect, useState } from "react";
import { highlightCode, type HighlightedLine } from "../../../lib/highlight";

const failedLanguages = new Set<string>();

/** Highlights a block of lines; returns null until ready, or when highlighting fails (plain text is shown instead). */
export const useHighlightedLines = (lines: readonly string[], language: string): readonly HighlightedLine[] | null => {
  const code = lines.join("\n");
  const [result, setResult] = useState<{ readonly code: string; readonly lines: readonly HighlightedLine[] } | null>(null);
  useEffect(() => {
    if (lines.length === 0 || failedLanguages.has(language)) return undefined;
    let cancelled = false;
    highlightCode(code, language)
      .then((highlighted) => {
        if (!cancelled) setResult({ code, lines: highlighted });
      })
      .catch((error: unknown) => {
        failedLanguages.add(language);
        console.error(`[highlight] could not highlight ${language}; showing plain text`, error);
      });
    return () => {
      cancelled = true;
    };
  }, [code, language, lines.length]);
  return result?.code === code ? result.lines : null;
};
