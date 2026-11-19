import { randomUUID } from "node:crypto";
import { readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const key = "AUTO_LISTENING_ENABLED";

export const isAutoListeningEnabled = (): boolean =>
  process.env[key]?.toLowerCase() === "true";

export function getVoiceDetectEndSilenceSeconds(value: string | undefined): number {
  const seconds = parseFloat(value ?? "");
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 1.5;
}

export function saveAutoListening(enabled: boolean, envPath = resolve(".env")): void {
  let contents = "";
  let mode = 0o600;
  try {
    envPath = realpathSync(envPath);
    contents = readFileSync(envPath, "utf8");
    mode = statSync(envPath).mode & 0o777;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const assignment = `${key}=${enabled}`;
  const pattern = /^([ \t]*(?:export[ \t]+)?)AUTO_LISTENING_ENABLED[ \t]*=[^\r\n]*/gm;
  const newline = contents.includes("\r\n") ? "\r\n" : "\n";
  const updated = pattern.test(contents)
    ? contents.replace(pattern, `$1${assignment}`)
    : `${contents}${contents && !contents.endsWith("\n") ? newline : ""}${assignment}${newline}`;

  if (updated !== contents) {
    const temporaryPath = `${envPath}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporaryPath, updated, { flag: "wx", mode });
      renameSync(temporaryPath, envPath);
    } finally {
      rmSync(temporaryPath, { force: true });
    }
  }
  process.env[key] = String(enabled);
}
