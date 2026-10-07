import { execFile } from "node:child_process";

export interface CommandOutput {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface CommandOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly timeoutMs?: number;
}

const MAX_BUFFER = 512 * 1024 * 1024;

export class CommandError extends Error {
  readonly exitCode: number;
  readonly stderr: string;

  constructor(command: string, exitCode: number, stderr: string, cause?: unknown) {
    const detail = stderr.trim().split("\n").slice(-5).join("\n");
    super(`${command} failed (exit ${exitCode})${detail === "" ? "" : `: ${detail}`}`, { cause });
    this.name = "CommandError";
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

const describeCommand = (file: string, args: readonly string[]): string =>
  [file, ...args.filter((arg) => !arg.startsWith("-") && !arg.includes("="))].slice(0, 2).join(" ");

/** Runs a program without a shell and resolves with its output and exit code, even when the exit code is non-zero. */
export const runCommandRaw = (file: string, args: readonly string[], options: CommandOptions = {}): Promise<CommandOutput> =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      [...args],
      {
        cwd: options.cwd,
        env: options.env ?? process.env,
        maxBuffer: MAX_BUFFER,
        timeout: options.timeoutMs ?? 10 * 60 * 1000,
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ stdout, stderr, exitCode: 0 });
          return;
        }
        if (typeof error.code === "number") {
          resolve({ stdout, stderr, exitCode: error.code });
          return;
        }
        const reason = error.code === "ENOENT" ? `${file} is not installed or not on PATH` : error.message;
        reject(new CommandError(describeCommand(file, args), -1, reason, error));
      },
    );
  });

/** Runs a program and returns stdout. Throws CommandError with the tail of stderr on a non-zero exit. */
export const runCommand = async (file: string, args: readonly string[], options: CommandOptions = {}): Promise<string> => {
  const output = await runCommandRaw(file, args, options);
  if (output.exitCode !== 0) throw new CommandError(describeCommand(file, args), output.exitCode, output.stderr);
  return output.stdout;
};
