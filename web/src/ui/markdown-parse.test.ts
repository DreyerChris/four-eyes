import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown } from "./markdown-parse";

describe("parseInline", () => {
  it("turns code spans, bold, italics and links into nodes", () => {
    expect(parseInline("`#withParams` returns a **new** `Node` and *maybe* [docs](https://x.dev/a)")).toEqual([
      { kind: "code", text: "#withParams" },
      { kind: "text", text: " returns a " },
      { kind: "strong", children: [{ kind: "text", text: "new" }] },
      { kind: "text", text: " " },
      { kind: "code", text: "Node" },
      { kind: "text", text: " and " },
      { kind: "em", children: [{ kind: "text", text: "maybe" }] },
      { kind: "text", text: " " },
      { kind: "link", href: "https://x.dev/a", children: [{ kind: "text", text: "docs" }] },
    ]);
  });

  it("leaves snake_case words and lone asterisks alone", () => {
    expect(parseInline("call my_func_name with a * b")).toEqual([{ kind: "text", text: "call my_func_name with a * b" }]);
  });

  it("does not turn javascript: links into links", () => {
    expect(parseInline("[x](javascript:alert(1))")).toEqual([{ kind: "text", text: "[x](javascript:alert(1))" }]);
  });
});

describe("parseMarkdown", () => {
  it("splits paragraphs, lists and fenced code", () => {
    const blocks = parseMarkdown("First line\ncontinues.\n\n- one\n- two\n\n```ts\nconst a = 1;\n```\n1. a\n2. b");
    expect(blocks.map((block) => block.kind)).toEqual(["paragraph", "list", "code", "list"]);
    expect(blocks[0]).toEqual({ kind: "paragraph", children: [{ kind: "text", text: "First line continues." }] });
    expect(blocks[2]).toEqual({ kind: "code", language: "ts", text: "const a = 1;" });
    expect(blocks[3]).toMatchObject({ kind: "list", ordered: true });
  });

  it("keeps an unclosed fence as code to the end", () => {
    expect(parseMarkdown("```\nabc\ndef")).toEqual([{ kind: "code", language: "", text: "abc\ndef" }]);
  });
});
