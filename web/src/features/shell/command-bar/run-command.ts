import { err, ok, type Result } from "@shared/result";
import { paths, type Route } from "../../../app/router";
import type { ReviewLocation } from "../../../bus/context";
import type { AppEventMap } from "../../../bus/events";
import { reviewIdForRoute } from "../route";
import type { Command } from "./commands";

export interface CommandDeps {
  readonly route: Route;
  readonly location: ReviewLocation | null;
  readonly navigate: (to: string) => void;
  readonly emitOpenFile: (payload: AppEventMap["open-file"]) => void;
  readonly emitGotoChunk: (payload: AppEventMap["goto-chunk"]) => void;
  readonly openSettings: () => void;
  readonly refresh: () => Promise<void>;
  readonly loadChunkIds: (reviewId: string) => Promise<readonly string[]>;
}

const NEEDS_REVIEW = "Open a review first";

const gotoChunk = async (deps: CommandDeps, reviewId: string, chunkNumber: number): Promise<Result<void, string>> => {
  const knownCount = deps.location?.reviewId === reviewId ? deps.location.chunkCount : 0;
  if (deps.route.name === "review" && knownCount > 0) {
    if (chunkNumber > knownCount) return err(`This review has ${knownCount} chunks`);
    deps.emitGotoChunk({ reviewId, chunkNumber });
    return ok(undefined);
  }
  const chunkIds = await deps.loadChunkIds(reviewId);
  const chunkId = chunkIds[chunkNumber - 1];
  if (chunkId === undefined) return err(chunkIds.length === 0 ? "This review has no chunks yet" : `This review has ${chunkIds.length} chunks`);
  deps.navigate(paths.review(reviewId, chunkId));
  return ok(undefined);
};

/** Carries out a parsed command. Resolves to an error message the command bar shows when the command cannot run here. */
export const runCommand = async (command: Command, deps: CommandDeps): Promise<Result<void, string>> => {
  const reviewId = reviewIdForRoute(deps.route);
  try {
    switch (command.name) {
      case "settings":
        deps.openSettings();
        return ok(undefined);
      case "summary":
        if (reviewId === null) return err(NEEDS_REVIEW);
        deps.navigate(paths.summary(reviewId));
        return ok(undefined);
      case "open":
        if (reviewId === null) return err(NEEDS_REVIEW);
        deps.emitOpenFile({ reviewId, path: command.path, oldPath: null, line: null, side: "new" });
        return ok(undefined);
      case "refresh":
        if (reviewId === null) return err(NEEDS_REVIEW);
        await deps.refresh();
        return ok(undefined);
      case "goto":
        if (reviewId === null) return err(NEEDS_REVIEW);
        return await gotoChunk(deps, reviewId, command.chunkNumber);
    }
  } catch (error) {
    return err(`:${command.name} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
};
