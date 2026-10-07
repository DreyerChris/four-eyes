import { err, ok, type Result } from "@shared/result";

export type Command =
  | { readonly name: "open"; readonly path: string }
  | { readonly name: "refresh" }
  | { readonly name: "summary" }
  | { readonly name: "goto"; readonly chunkNumber: number }
  | { readonly name: "settings" };

export interface CommandHelp {
  readonly usage: string;
  readonly description: string;
}

export const COMMAND_HELP: readonly CommandHelp[] = [
  { usage: "open <path>", description: "open a file from the PR at head" },
  { usage: "refresh", description: "pull in new commits" },
  { usage: "summary", description: "go to the review summary" },
  { usage: "goto <N>", description: "jump to chunk N" },
  { usage: "settings", description: "open settings" },
];

const parseGoto = (argument: string): Result<Command, string> => {
  if (!/^\d+$/.test(argument)) return err("Usage: goto <N>, where N is a chunk number");
  const chunkNumber = Number(argument);
  return chunkNumber < 1 ? err("Chunk numbers start at 1") : ok({ name: "goto", chunkNumber });
};

/** Parses command bar input such as ":goto 3" or "open src/a.ts". The leading ":" is optional. */
export const parseCommand = (input: string): Result<Command, string> => {
  const trimmed = input.trim().replace(/^:+/, "").trim();
  if (trimmed === "") return err("Type a command, e.g. goto 2");
  const [name = "", ...rest] = trimmed.split(/\s+/);
  const argument = trimmed.slice(name.length).trim();
  switch (name.toLowerCase()) {
    case "open":
    case "o":
      return argument === "" ? err("Usage: open <path>") : ok({ name: "open", path: argument.replace(/^\.\//, "") });
    case "refresh":
      return rest.length > 0 ? err("refresh takes no arguments") : ok({ name: "refresh" });
    case "summary":
      return rest.length > 0 ? err("summary takes no arguments") : ok({ name: "summary" });
    case "settings":
      return rest.length > 0 ? err("settings takes no arguments") : ok({ name: "settings" });
    case "goto":
    case "g":
      return parseGoto(argument);
    default:
      if (/^\d+$/.test(trimmed)) return parseGoto(trimmed);
      return err(`Unknown command "${name}". Try: ${COMMAND_HELP.map((help) => help.usage.split(" ")[0]).join(", ")}`);
  }
};
