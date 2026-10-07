import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { reviewsRepo } from "../db/repositories";
import { HttpError } from "../lib/errors";
import { createTestContext, type TestContextHandle } from "../test/context";
import { removeWorktree } from "./git";
import { FAKE_PR_URL } from "./github-client";
import { startIngest, waitForIngest } from "./pipeline";
import { definitionPatterns, getContextLines, multilineDefinitionPatterns, getFileContents, searchDefinitions } from "./source";

vi.mock("../claude/chunking", () => ({ runChunking: vi.fn(async () => []) }));
vi.mock("../claude/review", () => ({ runReview: vi.fn(async () => []) }));

describe("source access", () => {
  let handle: TestContextHandle;
  let reviewId: string;

  beforeAll(async () => {
    handle = createTestContext();
    const { review } = await startIngest(handle.ctx, { url: FAKE_PR_URL });
    reviewId = review.id;
    await waitForIngest(reviewId);
  });

  afterAll(() => handle.close());

  const review = (): ReturnType<typeof reviewsRepo.requireReview> => reviewsRepo.requireReview(handle.ctx.db, reviewId);

  describe("getFileContents", () => {
    it("returns the file at the head SHA by default", async () => {
      const result = await getFileContents(handle.ctx, reviewId, { path: "src/types/user.ts" });
      expect(result.sha).toBe(review().headSha);
      expect(result.content).toContain("readonly email: string;");
    });

    it("returns the base version when asked for the base SHA, using the old path of a rename", async () => {
      const result = await getFileContents(handle.ctx, reviewId, { path: "src/utils/format.ts", sha: review().baseSha });
      expect(result.content).toContain("Math.random()");
      const atHead = await getFileContents(handle.ctx, reviewId, { path: "src/utils/format.ts" });
      expect(atHead.content).toBeNull();
    });

    it("rebuilds a deleted worktree on demand", async () => {
      await removeWorktree(handle.ctx, reviewId);
      expect(review().worktreePath).toBeNull();
      const result = await getFileContents(handle.ctx, reviewId, { path: "README.md" });
      expect(result.content).toBe("# Demo\n\nA demo app that sends welcome mails.\n");
      const rebuilt = review().worktreePath;
      expect(rebuilt !== null && existsSync(rebuilt)).toBe(true);
    });

    it("throws a 404 for a commit that is not available", async () => {
      await expect(getFileContents(handle.ctx, reviewId, { path: "README.md", sha: "0".repeat(40) })).rejects.toThrow(HttpError);
    });
  });

  describe("getContextLines", () => {
    it("returns the requested 1-based inclusive range", async () => {
      const result = await getContextLines(handle.ctx, reviewId, { path: "src/types/user.ts", sha: review().headSha, start: 2, end: 3 });
      expect(result.lines).toEqual([
        { number: 2, text: "  readonly id: string;" },
        { number: 3, text: "  readonly name: string;" },
      ]);
      expect(result.totalLines).toBe(8);
    });

    it("clamps the range to the file", async () => {
      const result = await getContextLines(handle.ctx, reviewId, { path: "src/types/user.ts", sha: review().headSha, start: 7, end: 500 });
      expect(result.lines.map((line) => line.number)).toEqual([7, 8]);
      const beyond = await getContextLines(handle.ctx, reviewId, { path: "src/types/user.ts", sha: review().headSha, start: 50, end: 60 });
      expect(beyond.lines).toEqual([]);
    });

    it("counts a final line without a newline", async () => {
      const result = await getContextLines(handle.ctx, reviewId, { path: "README.md", sha: review().baseSha, start: 1, end: 10 });
      expect(result.lines.map((line) => line.text)).toEqual(["# Demo", "", "A demo app."]);
    });

    it("rejects inverted ranges and missing files", async () => {
      await expect(getContextLines(handle.ctx, reviewId, { path: "README.md", sha: review().headSha, start: 5, end: 2 })).rejects.toThrow(
        /end must not be before start/,
      );
      await expect(getContextLines(handle.ctx, reviewId, { path: "nope.ts", sha: review().headSha, start: 1, end: 2 })).rejects.toThrow(
        /does not exist/,
      );
    });
  });

  describe("searchDefinitions", () => {
    it("finds a class definition", async () => {
      const result = await searchDefinitions(handle.ctx, reviewId, { symbol: "UserService" });
      expect(result.matches).toEqual([
        { path: "src/services/user-service.ts", line: 13, column: 14, preview: "export class UserService {" },
      ]);
    });

    it("finds const arrow functions, interfaces and methods but not their call sites", async () => {
      const randomId = await searchDefinitions(handle.ctx, reviewId, { symbol: "randomId" });
      expect(randomId.matches.map((m) => `${m.path}:${m.line}`)).toEqual(["src/utils/formatting.ts:1"]);

      const mailer = await searchDefinitions(handle.ctx, reviewId, { symbol: "Mailer" });
      expect(mailer.matches.map((m) => `${m.path}:${m.line}`)).toEqual(["src/services/user-service.ts:9"]);

      const createUser = await searchDefinitions(handle.ctx, reviewId, { symbol: "createUser" });
      expect(createUser.matches.map((m) => `${m.path}:${m.line}:${m.column}`)).toEqual(["src/services/user-service.ts:19:9"]);
    });

    it("finds type aliases", async () => {
      const result = await searchDefinitions(handle.ctx, reviewId, { symbol: "UserId" });
      expect(result.matches.map((m) => m.path)).toEqual(["src/types/user.ts"]);
    });

    it("returns no matches for unknown symbols and non-identifiers", async () => {
      expect((await searchDefinitions(handle.ctx, reviewId, { symbol: "doesNotExistAnywhere" })).matches).toEqual([]);
      expect((await searchDefinitions(handle.ctx, reviewId, { symbol: "foo-bar" })).matches).toEqual([]);
      expect((await searchDefinitions(handle.ctx, reviewId, { symbol: "a.b(" })).matches).toEqual([]);
    });
  });
});

describe("definitionPatterns", () => {
  const matchesAny = (symbol: string, line: string): boolean =>
    definitionPatterns(symbol).some((pattern) => new RegExp(pattern).test(line));

  it.each([
    ["foo", "export function foo(a: number) {"],
    ["foo", "export default async function foo() {"],
    ["Foo", "export abstract class Foo<T> extends Bar {"],
    ["Foo", "interface Foo {"],
    ["Foo", "export type Foo = string;"],
    ["Foo", "enum Foo {"],
    ["foo", "export const foo = (): void => {};"],
    ["foo", "let foo: number = 1;"],
    ["foo", "def foo(self, x):"],
    ["Foo", "pub struct Foo {"],
    ["foo", "pub(crate) fn foo() -> u8 {"],
    ["foo", "func foo(x int) error {"],
    ["Foo", "func (s *Server) Foo(ctx context.Context) error {"],
    ["foo", "  private async foo(bar: string): Promise<void> {"],
    ["foo", "  foo = async (x) => {"],
    ["$store", "const $store = createStore();"],
    ["withParams", "  #withParams(params: Record<string, string>): Node<T> {"],
    ["endAnchored", "  #endAnchored = false"],
    ["endAnchored", "  #endAnchored: boolean = false;"],
    ["endAnchored", "  private readonly endAnchored: boolean;"],
    ["name", "  name?: string;"],
  ])("%s is defined by %j", (symbol, line) => {
    expect(matchesAny(symbol, line)).toBe(true);
  });

  it.each([
    ["foo", "const result = foo(1);"],
    ["foo", "foo();"],
    ["foo", "export const foobar = 1;"],
    ["foo", "import { foo } from './foo';"],
    ["foo", "this.foo = 1;"],
    ["foo", "  foo = foo + 1;"],
    ["foo", "  this.#foo = 1;"],
    ["foo", "  foo("],
    ["foo", "  if (foo === bar) {"],
  ])("%s is not defined by %j", (symbol, line) => {
    expect(matchesAny(symbol, line)).toBe(false);
  });
});

describe("multilineDefinitionPatterns", () => {
  const matchesAny = (symbol: string, source: string): boolean =>
    multilineDefinitionPatterns(symbol).some((pattern) => new RegExp(pattern, "m").test(source));

  it("finds a method whose parameters span several lines", () => {
    const source = ["class Node<T> {", "  #pushHandlerSets(", "    handlerSets: HandlerSet<T>[],", "    node: Node<T>,", "  ): void {", "    return;", "  }", "}"].join("\n");
    expect(matchesAny("pushHandlerSets", source)).toBe(true);
  });

  it("does not treat a call spread over several lines as a definition", () => {
    expect(matchesAny("foo", ["  foo(", "    a,", "    b,", "  );", "  if (x) {"].join("\n"))).toBe(false);
    expect(matchesAny("describe", ['describe("x", () => {', "  it();", "});"].join("\n"))).toBe(false);
  });
});
