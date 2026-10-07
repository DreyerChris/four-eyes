import { describe, expect, it } from "vitest";
import { highlightCode, languageForPath, syntaxOfScopes } from "./highlight";

describe("languageForPath", () => {
  it.each([
    ["src/app.ts", "typescript"],
    ["web/App.tsx", "tsx"],
    ["package.json", "json"],
    ["scripts/build.MJS", "javascript"],
    ["Dockerfile", "docker"],
    ["docker/Dockerfile.dev", "docker"],
    ["Makefile", "make"],
    [".github/workflows/ci.yml", "yaml"],
    ["README", "text"],
    ["data.unknownext", "text"],
  ])("%s → %s", (path, language) => {
    expect(languageForPath(path)).toBe(language);
  });
});

describe("highlightCode", () => {
  it("returns plain lines for text without loading Shiki", async () => {
    expect(await highlightCode("a\nb", "text", "dark")).toEqual([[{ content: "a" }], [{ content: "b" }]]);
  });

  it("colours TypeScript with one entry per line", async () => {
    const lines = await highlightCode("const a = 1;\nexport {};", "typescript", "dark");
    expect(lines).toHaveLength(2);
    expect(lines[0]?.map((token) => token.content).join("")).toBe("const a = 1;");
    expect(lines[0]?.some((token) => token.color !== undefined)).toBe(true);
  }, 20_000);

  it("marks comment and string pieces but not code inside template expressions", async () => {
    const [line] = await highlightCode('const s = `Hi ${name}`; // the regex', "typescript", "dark");
    const syntaxOf = (content: string): string | undefined => line?.find((token) => token.content.includes(content))?.syntax;
    expect(syntaxOf("Hi")).toBe("string");
    expect(syntaxOf("name")).toBeUndefined();
    expect(syntaxOf("regex")).toBe("comment");
    expect(line?.map((token) => token.content).join("")).toBe('const s = `Hi ${name}`; // the regex');
  }, 20_000);

  it("colours the same code differently for different themes", async () => {
    const colours = async (theme: "dark" | "synthwave"): Promise<readonly (string | undefined)[]> =>
      (await highlightCode("const a = 1;", "typescript", theme))[0]?.map((token) => token.color) ?? [];
    expect(await colours("synthwave")).not.toEqual(await colours("dark"));
  }, 20_000);
});

describe("syntaxOfScopes", () => {
  it("uses the innermost comment, string or embedded-code scope", () => {
    expect(syntaxOfScopes(["source.ts", "meta.import.ts", "string.quoted.double.ts"])).toBe("string");
    expect(syntaxOfScopes(["source.ts", "comment.line.double-slash.ts", "punctuation.definition.comment.ts"])).toBe("comment");
    expect(syntaxOfScopes(["source.ts", "string.template.ts", "meta.template.expression.ts", "variable.other.readwrite.ts"])).toBeUndefined();
    expect(syntaxOfScopes(["source.ts", "variable.other.readwrite.ts"])).toBeUndefined();
  });
});
