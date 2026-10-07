export type Inline =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "strong"; readonly children: readonly Inline[] }
  | { readonly kind: "em"; readonly children: readonly Inline[] }
  | { readonly kind: "link"; readonly href: string; readonly children: readonly Inline[] };

export type Block =
  | { readonly kind: "paragraph"; readonly children: readonly Inline[] }
  | { readonly kind: "heading"; readonly children: readonly Inline[] }
  | { readonly kind: "code"; readonly language: string; readonly text: string }
  | { readonly kind: "list"; readonly ordered: boolean; readonly items: readonly (readonly Inline[])[] }
  | { readonly kind: "quote"; readonly children: readonly Inline[] };

const INLINE_PATTERN = /`([^`]+)`|\*\*(.+?)\*\*|__(.+?)__|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])|(?<!\w)_(?!\s)(.+?)(?<!\s)_(?!\w)/;

/** Parses inline markdown: code spans, bold, italics and http(s) links. Everything else stays plain text. */
export const parseInline = (source: string): readonly Inline[] => {
  const match = INLINE_PATTERN.exec(source);
  if (match === null) return source === "" ? [] : [{ kind: "text", text: source }];
  const before: readonly Inline[] = match.index > 0 ? [{ kind: "text", text: source.slice(0, match.index) }] : [];
  const [whole, code, bold, boldAlt, linkText, href, italic, italicAlt] = match;
  const node: Inline =
    code !== undefined
      ? { kind: "code", text: code }
      : bold !== undefined || boldAlt !== undefined
        ? { kind: "strong", children: parseInline(bold ?? boldAlt ?? "") }
        : linkText !== undefined && href !== undefined
          ? { kind: "link", href, children: parseInline(linkText) }
          : { kind: "em", children: parseInline(italic ?? italicAlt ?? "") };
  return [...before, node, ...parseInline(source.slice(match.index + whole.length))];
};

const FENCE = /^\s*(```|~~~)\s*([\w+-]*)\s*$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;

interface ParseState {
  readonly blocks: readonly Block[];
  readonly rest: readonly string[];
}

const takeWhile = (lines: readonly string[], keep: (line: string) => boolean): number => {
  const index = lines.findIndex((line) => !keep(line));
  return index === -1 ? lines.length : index;
};

const startsBlock = (line: string): boolean =>
  FENCE.test(line) || BULLET.test(line) || NUMBERED.test(line) || HEADING.test(line) || QUOTE.test(line);

const nextBlock = (lines: readonly string[]): ParseState => {
  const [first = "", ...others] = lines;
  const fence = FENCE.exec(first);
  if (fence) {
    const end = others.findIndex((line) => line.trim() === fence[1]);
    const body = end === -1 ? others : others.slice(0, end);
    return { blocks: [{ kind: "code", language: fence[2] ?? "", text: body.join("\n") }], rest: end === -1 ? [] : others.slice(end + 1) };
  }
  const heading = HEADING.exec(first);
  if (heading) return { blocks: [{ kind: "heading", children: parseInline(heading[1] ?? "") }], rest: others };
  const listPattern = BULLET.test(first) ? BULLET : NUMBERED.test(first) ? NUMBERED : null;
  if (listPattern) {
    const count = takeWhile(lines, (line) => listPattern.test(line));
    const items = lines.slice(0, count).map((line) => parseInline(listPattern.exec(line)?.[1] ?? ""));
    return { blocks: [{ kind: "list", ordered: listPattern === NUMBERED, items }], rest: lines.slice(count) };
  }
  if (QUOTE.test(first)) {
    const count = takeWhile(lines, (line) => QUOTE.test(line));
    const text = lines.slice(0, count).map((line) => QUOTE.exec(line)?.[1] ?? "").join(" ");
    return { blocks: [{ kind: "quote", children: parseInline(text) }], rest: lines.slice(count) };
  }
  if (first.trim() === "") return { blocks: [], rest: others };
  const count = 1 + takeWhile(others, (line) => line.trim() !== "" && !startsBlock(line));
  const text = lines.slice(0, count).map((line) => line.trim()).join(" ");
  return { blocks: [{ kind: "paragraph", children: parseInline(text) }], rest: lines.slice(count) };
};

/** Splits markdown into paragraphs, headings, fenced code, lists and quotes. */
export const parseMarkdown = (source: string): readonly Block[] => {
  const walk = (state: ParseState): readonly Block[] => {
    if (state.rest.length === 0) return state.blocks;
    const next = nextBlock(state.rest);
    return walk({ blocks: [...state.blocks, ...next.blocks], rest: next.rest });
  };
  return walk({ blocks: [], rest: source.replace(/\r\n/g, "\n").split("\n") });
};
