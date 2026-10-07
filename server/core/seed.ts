import type { ChunkKind, Finding, Hunk, ParsedHunk, Review } from "@shared/domain";
import type { AppContext } from "../context";
import { chunksRepo, claudeRunsRepo, findingsRepo, hunksRepo, reviewsRepo, roundsRepo, verdictsRepo } from "../db/repositories";
import { newId } from "../lib/ids";
import { nowIso } from "../lib/time";

const BASE_SHA = "1111111111111111111111111111111111111111";
const HEAD_SHA = "2222222222222222222222222222222222222222";

const FIXTURE_HUNKS: readonly ParsedHunk[] = [
  {
    filePath: "src/types/user.ts",
    oldFilePath: null,
    changeType: "modified",
    oldStart: 1,
    oldLines: 5,
    newStart: 1,
    newLines: 6,
    patchText: [
      "@@ -1,5 +1,6 @@",
      " export interface User {",
      "   readonly id: string;",
      "   readonly name: string;",
      "+  readonly email: string;",
      "   readonly createdAt: Date;",
      " }",
    ].join("\n"),
  },
  {
    filePath: "src/services/user-service.ts",
    oldFilePath: null,
    changeType: "modified",
    oldStart: 10,
    oldLines: 6,
    newStart: 10,
    newLines: 8,
    patchText: [
      "@@ -10,6 +10,8 @@ export class UserService {",
      "   async createUser(name: string): Promise<User> {",
      "-    const user = { id: randomId(), name, createdAt: new Date() };",
      "+    const email = `${name.toLowerCase()}@example.com`;",
      "+    const user = { id: randomId(), name, email, createdAt: new Date() };",
      "+    await this.mailer.sendWelcome(email);",
      "     await this.store.save(user);",
      "     return user;",
      "   }",
    ].join("\n"),
  },
  {
    filePath: "src/services/user-service.ts",
    oldFilePath: null,
    changeType: "modified",
    oldStart: 30,
    oldLines: 4,
    newStart: 32,
    newLines: 4,
    patchText: [
      "@@ -30,4 +32,4 @@ export class UserService {",
      "   findByName(name: string): User | undefined {",
      "-    return this.store.all().find((u) => u.name === name);",
      "+    return this.store.all().find((u) => u.name.toLowerCase() === name.toLowerCase());",
      "   }",
      " }",
    ].join("\n"),
  },
  {
    filePath: "src/routes/users.ts",
    oldFilePath: null,
    changeType: "modified",
    oldStart: 5,
    oldLines: 3,
    newStart: 5,
    newLines: 4,
    patchText: [
      "@@ -5,3 +5,4 @@ const router = new Router();",
      " router.post(\"/users\", createUserHandler);",
      " router.get(\"/users/:name\", findUserHandler);",
      "+router.get(\"/users/:name/email\", findUserEmailHandler);",
      " export default router;",
    ].join("\n"),
  },
  {
    filePath: "test/user-service.test.ts",
    oldFilePath: null,
    changeType: "added",
    oldStart: 0,
    oldLines: 0,
    newStart: 1,
    newLines: 5,
    patchText: [
      "@@ -0,0 +1,5 @@",
      "+import { UserService } from \"../src/services/user-service\";",
      "+",
      "+test(\"creates a user with an email\", async () => {",
      "+  expect((await new UserService().createUser(\"Ada\")).email).toBe(\"ada@example.com\");",
      "+});",
    ].join("\n"),
  },
  {
    filePath: "pnpm-lock.yaml",
    oldFilePath: null,
    changeType: "modified",
    oldStart: 100,
    oldLines: 2,
    newStart: 100,
    newLines: 2,
    patchText: ["@@ -100,2 +100,2 @@", "   mailer:", "-    version: 1.0.0", "+    version: 1.1.0"].join("\n"),
  },
];

const FIXTURE_CHUNKS: readonly { readonly title: string; readonly explanation: string; readonly kind: ChunkKind; readonly hunkIndexes: readonly number[] }[] = [
  { title: "Add email to the User type", explanation: "The User model gains an email field.", kind: "core", hunkIndexes: [0] },
  {
    title: "Create users with an email and send a welcome mail",
    explanation: "createUser derives an email, sends a welcome mail, and name lookup becomes case-insensitive.",
    kind: "core",
    hunkIndexes: [1, 2],
  },
  { title: "Expose the email route", explanation: "A new GET route returns a user's email.", kind: "core", hunkIndexes: [3] },
  { title: "Test user creation", explanation: "A unit test covers the email derivation.", kind: "core", hunkIndexes: [4] },
  { title: "Skim: lockfile", explanation: "Dependency bump for the mailer package.", kind: "skim", hunkIndexes: [5] },
];

/** Inserts a complete, ready-to-step review without git or Claude. Only reachable when FOUR_EYES_FAKE_CLAUDE=1. */
export const seedFixtureReview = (ctx: AppContext): Review => {
  const now = nowIso();
  const reviewId = newId("rev");
  const roundId = newId("rnd");
  const prNumber = Math.max(999, ...reviewsRepo.listReviews(ctx.db).map((review) => review.prNumber)) + 1;
  const review: Review = {
    id: reviewId,
    host: "github.com",
    owner: "acme",
    repo: "widgets",
    prNumber,
    title: `Add email to users (fixture #${prNumber})`,
    author: "octocat",
    url: `https://github.com/acme/widgets/pull/${prNumber}`,
    baseSha: BASE_SHA,
    headSha: HEAD_SHA,
    ghState: "open",
    status: "active",
    pipelineStatus: "ready",
    pipelineError: null,
    worktreePath: null,
    qaSessionId: null,
    remoteHeadSha: HEAD_SHA,
    remoteCheckedAt: now,
    myReviewState: null,
    myReviewSubmittedAt: null,
    myReviewCommitSha: null,
    createdAt: now,
    lastActivityAt: now,
    finishedAt: null,
  };
  const hunks: readonly Hunk[] = FIXTURE_HUNKS.map((parsed, position) => ({
    ...parsed,
    id: newId("h"),
    reviewId,
    roundId,
    fingerprint: `fixture-${position}`,
    position,
    present: true,
  }));
  const hunkIdAt = (index: number): string => {
    const hunk = hunks[index];
    if (!hunk) throw new Error(`Fixture hunk index ${index} out of range`);
    return hunk.id;
  };
  const findings: readonly Finding[] = [
    {
      id: newId("fnd"),
      reviewId,
      roundId,
      severity: "bug",
      title: "Welcome mail is sent before the user is saved",
      explanation: "If store.save throws, the user gets a welcome mail for an account that does not exist.",
      suggestedFix: "Send the welcome mail after `await this.store.save(user)`.",
      lifecycle: "new",
      userVerdict: null,
      range: null,
      hunkIds: [hunkIdAt(1)],
    },
    {
      id: newId("fnd"),
      reviewId,
      roundId,
      severity: "nit",
      title: "Test name could mention lower-casing",
      explanation: "The test checks lower-casing but the name does not say so.",
      suggestedFix: null,
      lifecycle: "new",
      userVerdict: null,
      range: null,
      hunkIds: [hunkIdAt(4)],
    },
  ];
  ctx.db.transaction((tx) => {
    reviewsRepo.insertReview(tx, review);
    roundsRepo.insertRound(tx, { id: roundId, reviewId, number: 1, headSha: HEAD_SHA, createdAt: now });
    hunksRepo.insertHunks(tx, hunks);
    chunksRepo.insertChunks(
      tx,
      FIXTURE_CHUNKS.map((chunk, position) => ({
        chunk: { id: newId("chk"), reviewId, roundId, position, title: chunk.title, explanation: chunk.explanation, kind: chunk.kind },
        hunkIds: chunk.hunkIndexes.map(hunkIdAt),
      })),
    );
    findingsRepo.insertFindings(tx, findings);
    verdictsRepo.upsertVerdict(tx, {
      reviewId,
      roundId,
      summary: "Solid change; fix the welcome-mail ordering before merging.",
      suggestion: "request_changes",
    });
    (["chunking", "review"] as const).forEach((kind) =>
      claudeRunsRepo.insertRun(tx, {
        id: newId("run"),
        reviewId,
        kind,
        model: kind === "chunking" ? "claude-sonnet-5-5" : "claude-opus-5-5",
        status: "succeeded",
        sessionId: null,
        inputTokens: 1000,
        outputTokens: 200,
        costUsd: 0.01,
        error: null,
        startedAt: now,
        finishedAt: now,
      }),
    );
  });
  return review;
};
