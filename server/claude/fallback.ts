import type { ChunkPlan, PlannedChunk } from "@shared/claude";
import type { Hunk } from "@shared/domain";
import { countChanges } from "./format";

export type FileCategory = "types" | "logic" | "wiring" | "tests" | "skim";

const CATEGORY_ORDER: readonly FileCategory[] = ["types", "logic", "wiring", "tests", "skim"];

const LOCKFILES: ReadonlySet<string> = new Set([
  "pnpm-lock.yaml",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "bun.lockb",
  "bun.lock",
  "cargo.lock",
  "gemfile.lock",
  "poetry.lock",
  "pipfile.lock",
  "uv.lock",
  "composer.lock",
  "go.sum",
  "podfile.lock",
  "flake.lock",
  "mix.lock",
  "pubspec.lock",
  "packages.lock.json",
]);

const SKIM_PATTERNS: readonly RegExp[] = [
  /\.snap$/,
  /(^|\/)__snapshots__\//,
  /\.min\.(js|css)$/,
  /\.map$/,
  /(^|\/)(generated|__generated__|gen)\//,
  /\.generated\.[^/]+$/,
  /\.g\.[a-z]+$/,
  /_pb2(_grpc)?\.pyi?$/,
  /\.pb(\.gw)?\.go$/,
  /(^|\/)(dist|build|vendor|node_modules)\//,
  /(^|\/)migrations\/meta\//,
];

const TEST_PATTERNS: readonly RegExp[] = [
  /(^|\/)(__tests__|tests?|specs?|e2e|__mocks__|fixtures?)\//,
  /\.(test|spec)\.[^/]+$/,
  /_test\.(go|py|rb|exs?)$/,
  /(^|\/)test_[^/]+\.py$/,
  /Tests?\.(cs|java|kt|swift)$/,
];

const TYPE_PATTERNS: readonly RegExp[] = [
  /\.d\.ts$/,
  /(^|\/)(types?|models?|schemas?|interfaces|entities|dto|domain)\//,
  /(^|\/)(types?|models?|schemas?|interfaces|domain)\.[^/]+$/,
  /\.(proto|graphql|gql|prisma|sql)$/,
  /(^|\/)migrations\//,
];

const WIRING_PATTERNS: readonly RegExp[] = [
  /(^|\/)(index|main|app|server|mod|routes?|router)\.[^/]+$/,
  /(^|\/)(routes|config|configs|\.github|deploy|infra|scripts)\//,
  /\.config\.[^/]+$/,
  /(^|\/)(package\.json|tsconfig[^/]*\.json|Dockerfile|Makefile|docker-compose[^/]*)$/,
  /\.(json|ya?ml|toml|ini|env|cfg)$/,
];

const basename = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

const matchesAny = (path: string, patterns: readonly RegExp[]): boolean => patterns.some((pattern) => pattern.test(path));

/** Sorts a file into the review order buckets: types → logic → wiring → tests, with noisy files in skim. */
export const categorizeFile = (path: string): FileCategory => {
  if (LOCKFILES.has(basename(path).toLowerCase()) || matchesAny(path, SKIM_PATTERNS)) return "skim";
  if (matchesAny(path, TEST_PATTERNS)) return "tests";
  if (matchesAny(path, TYPE_PATTERNS)) return "types";
  if (matchesAny(path, WIRING_PATTERNS)) return "wiring";
  return "logic";
};

interface FileGroup {
  readonly path: string;
  readonly category: FileCategory;
  readonly hunks: readonly Hunk[];
}

const groupByFile = (hunks: readonly Hunk[]): readonly FileGroup[] => {
  const ordered = [...hunks].sort((a, b) => a.position - b.position);
  const paths = [...new Set(ordered.map((hunk) => hunk.filePath))];
  return paths.map((path) => ({
    path,
    category: categorizeFile(path),
    hunks: ordered.filter((hunk) => hunk.filePath === path),
  }));
};

const describeChanges = (hunks: readonly Hunk[]): string => {
  const totals = hunks
    .map((hunk) => countChanges(hunk.patchText))
    .reduce((sum, counts) => ({ added: sum.added + counts.added, removed: sum.removed + counts.removed }), {
      added: 0,
      removed: 0,
    });
  const hunkWord = hunks.length === 1 ? "hunk" : "hunks";
  return `${hunks.length} ${hunkWord}, +${totals.added} -${totals.removed}`;
};

const fileChunk = (group: FileGroup): PlannedChunk => ({
  title: group.path,
  explanation: `All changes in ${group.path} (${describeChanges(group.hunks)}). Claude could not plan this PR, so it is grouped by file.`,
  kind: "core",
  hunkIds: group.hunks.map((hunk) => hunk.id),
});

const skimChunk = (groups: readonly FileGroup[]): PlannedChunk => {
  const hunks = groups.flatMap((group) => group.hunks);
  return {
    title: "Skim: lockfiles, generated code and snapshots",
    explanation: `Noisy files that rarely need a close read: ${groups.map((group) => group.path).join(", ")} (${describeChanges(hunks)}).`,
    kind: "skim",
    hunkIds: hunks.map((hunk) => hunk.id),
  };
};

/** One chunk per file in dependency-ish order (types → logic → wiring → tests), noisy files (lockfiles, generated, snapshots) in one skim chunk. */
export const fallbackChunkPlan = (hunks: readonly Hunk[]): ChunkPlan => {
  const groups = groupByFile(hunks);
  const rank = (category: FileCategory): number => CATEGORY_ORDER.indexOf(category);
  const coreGroups = groups
    .filter((group) => group.category !== "skim")
    .map((group, index) => ({ group, index }))
    .sort((a, b) => rank(a.group.category) - rank(b.group.category) || a.index - b.index)
    .map(({ group }) => group);
  const skimGroups = groups.filter((group) => group.category === "skim");
  return {
    chunks: [...coreGroups.map(fileChunk), ...(skimGroups.length > 0 ? [skimChunk(skimGroups)] : [])],
  };
};
