import fs from "fs";
import path from "path";
import { spawn, ChildProcessWithoutNullStreams } from "child_process";

type Track = {
  filePath: string;
  title: string;
  normalizedTitle: string;
};

type MatchResult = {
  track: Track;
  score: number;
};

const DEFAULT_EXTENSIONS = ["mp3", "wav", "flac", "m4a", "aac", "ogg"];
const DEFAULT_MIN_SCORE = 0.35;
const DEFAULT_RESCAN_SECONDS = 30;

const stripFileExtension = (name: string): string => {
  const ext = path.extname(name);
  return ext ? name.slice(0, -ext.length) : name;
};

const normalizeForSearch = (value: string): string => {
  return value
    .toLowerCase()
    .replace(/[\-_\.]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const safeSplitCsv = (value: string | undefined): string[] => {
  return (value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
};

const levenshteinDistance = (a: string, b: string): number => {
  if (a === b) {
    return 0;
  }
  if (a.length === 0) {
    return b.length;
  }
  if (b.length === 0) {
    return a.length;
  }

  const dp: number[][] = Array.from({ length: a.length + 1 }, () => []);
  for (let i = 0; i <= a.length; i++) {
    dp[i][0] = i;
  }
  for (let j = 0; j <= b.length; j++) {
    dp[0][j] = j;
  }

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }

  return dp[a.length][b.length];
};

const normalizedSimilarity = (a: string, b: string): number => {
  if (!a || !b) {
    return 0;
  }
  const maxLen = Math.max(a.length, b.length);
  const distance = levenshteinDistance(a, b);
  return Math.max(0, 1 - distance / maxLen);
};

const parseExtensions = (value: string | undefined): Set<string> => {
  const extList = safeSplitCsv(value).map((v) => v.toLowerCase().replace(/^\./, ""));
  const source = extList.length > 0 ? extList : DEFAULT_EXTENSIONS;
  return new Set(source);
};

const parseDirectories = (value: string | undefined): string[] => {
  return safeSplitCsv(value).map((dir) => path.resolve(dir));
};

const scoreTrack = (normalizedQuery: string, track: Track): number => {
  if (!normalizedQuery) {
    return 0;
  }

  const title = track.normalizedTitle;
  if (!title) {
    return 0;
  }

  if (title === normalizedQuery) {
    return 1;
  }

  if (title.includes(normalizedQuery)) {
    const penalty = Math.min(0.2, (title.length - normalizedQuery.length) / 200);
    return Math.max(0, 0.92 - penalty);
  }

  const queryTokens = normalizedQuery.split(" ").filter(Boolean);
  if (queryTokens.length > 0) {
    const tokenHits = queryTokens.filter((token) => title.includes(token)).length;
    const tokenRate = tokenHits / queryTokens.length;
    if (tokenRate >= 0.66) {
      return 0.7 + tokenRate * 0.2;
    }
  }

  return normalizedSimilarity(normalizedQuery, title);
};

class LocalMusicPlayer {
  private tracks: Track[] = [];
  private currentProcess: ChildProcessWithoutNullStreams | null = null;
  private currentTrack: Track | null = null;
  private preloadPromise: Promise<void> | null = null;

  constructor(
    private readonly libraryDirs: string[],
    private readonly extensions: Set<string>,
    private readonly minScore: number,
    private readonly rescanSeconds: number,
    private readonly soundCardIndex: string,
  ) {}

  private isConfigured(): boolean {
    return this.libraryDirs.length > 0;
  }

  private async scanTracksIteratively(): Promise<void> {
    const foundTracks: Track[] = [];
    const visitedDirs = new Set<string>();
    const visitedFiles = new Set<string>();

    const normalizedRoots = Array.from(
      new Set(this.libraryDirs.map((dir) => path.resolve(dir))),
    );

    for (const rootDirRaw of normalizedRoots) {
      if (!fs.existsSync(rootDirRaw)) {
        continue;
      }

      let rootDir = rootDirRaw;
      try {
        rootDir = await fs.promises.realpath(rootDirRaw);
      } catch {
        // Keep resolved path fallback when realpath is unavailable.
      }

      if (visitedDirs.has(rootDir)) {
        continue;
      }
      visitedDirs.add(rootDir);

      const stack: string[] = [rootDir];
      while (stack.length > 0) {
        const currentDir = stack.pop();
        if (!currentDir) {
          continue;
        }

        let entries: fs.Dirent[] = [];
        try {
          entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
        } catch {
          continue;
        }

        for (const entry of entries) {
          if (entry.name.startsWith(".")) {
            continue;
          }

          const fullPath = path.join(currentDir, entry.name);
          if (entry.isDirectory()) {
            let normalizedDir = fullPath;
            try {
              normalizedDir = await fs.promises.realpath(fullPath);
            } catch {
              // Keep unresolved path if permission or filesystem does not allow realpath.
            }
            if (!visitedDirs.has(normalizedDir)) {
              visitedDirs.add(normalizedDir);
              stack.push(normalizedDir);
            }
            continue;
          }

          if (!entry.isFile()) {
            continue;
          }

          const ext = path.extname(entry.name).toLowerCase().replace(/^\./, "");
          if (!this.extensions.has(ext)) {
            continue;
          }

          let normalizedFile = fullPath;
          try {
            normalizedFile = await fs.promises.realpath(fullPath);
          } catch {
            // Keep unresolved path as fallback.
          }
          if (visitedFiles.has(normalizedFile)) {
            continue;
          }
          visitedFiles.add(normalizedFile);

          const title = stripFileExtension(entry.name);
          foundTracks.push({
            filePath: normalizedFile,
            title,
            normalizedTitle: normalizeForSearch(title),
          });
        }
      }
    }

    this.tracks = foundTracks;
  }

  preloadLibrary(): Promise<void> {
    if (!this.preloadPromise) {
      this.preloadPromise = this.scanTracksIteratively()
        .then(() => {
          console.log(
            `[Music] Indexed ${this.tracks.length} track(s) from MUSIC_LIBRARY_DIRS.`,
          );
        })
        .catch((err) => {
          console.error(`[Music] Failed to index library: ${err?.message || err}`);
          this.tracks = [];
        });
    }

    return this.preloadPromise;
  }

  private findBestMatch(query: string): MatchResult | null {
    const normalizedQuery = normalizeForSearch(query);
    if (!normalizedQuery) {
      return null;
    }

    let best: MatchResult | null = null;
    for (const track of this.tracks) {
      const score = scoreTrack(normalizedQuery, track);
      if (score < this.minScore) {
        continue;
      }
      if (!best || score > best.score) {
        best = { track, score };
      }
    }

    return best;
  }

  private stopCurrentProcess(): void {
    if (!this.currentProcess) {
      this.currentTrack = null;
      return;
    }
    try {
      this.currentProcess.kill("SIGINT");
    } catch {
      try {
        this.currentProcess.kill("SIGTERM");
      } catch {}
    }
    this.currentProcess = null;
    this.currentTrack = null;
  }

  private buildPlaybackCommand(filePath: string): { command: string; args: string[] } {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".mp3") {
      return {
        command: "mpg123",
        args: ["-o", "alsa", "-a", `hw:${this.soundCardIndex},0`, filePath],
      };
    }

    return {
      command: "sox",
      args: [filePath, "-t", "alsa", `hw:${this.soundCardIndex},0`],
    };
  }

  async playByQuery(query: string): Promise<{
    ok: boolean;
    message: string;
    trackPath?: string;
    trackTitle?: string;
  }> {
    if (!this.isConfigured()) {
      return {
        ok: false,
        message: "MUSIC_LIBRARY_DIRS is empty. Please configure one or more music folders.",
      };
    }

    await this.preloadLibrary();
    if (this.tracks.length === 0) {
      return {
        ok: false,
        message: "No music files found in MUSIC_LIBRARY_DIRS.",
      };
    }

    const best = this.findBestMatch(query);
    if (!best) {
      return {
        ok: false,
        message: `No matching track found for \"${query}\".`,
      };
    }

    this.stopCurrentProcess();

    const { command, args } = this.buildPlaybackCommand(best.track.filePath);
    const process = spawn(command, args);
    this.currentProcess = process;
    this.currentTrack = best.track;

    process.on("error", (err) => {
      console.error(`[Music] Failed to start playback: ${err.message}`);
      if (this.currentProcess === process) {
        this.currentProcess = null;
        this.currentTrack = null;
      }
    });

    process.on("exit", () => {
      if (this.currentProcess === process) {
        this.currentProcess = null;
        this.currentTrack = null;
      }
    });

    return {
      ok: true,
      message: `Now playing: ${best.track.title}`,
      trackPath: best.track.filePath,
      trackTitle: best.track.title,
    };
  }

  stop(): { ok: boolean; message: string } {
    if (!this.currentProcess) {
      return {
        ok: false,
        message: "No music is currently playing.",
      };
    }

    this.stopCurrentProcess();
    return {
      ok: true,
      message: "Music playback stopped.",
    };
  }

  getStatus(): { isPlaying: boolean; title: string } {
    return {
      isPlaying: Boolean(this.currentProcess),
      title: this.currentTrack?.title || "",
    };
  }
}

let localMusicPlayerInstance: LocalMusicPlayer | null = null;
let localMusicPlayerKey = "";

export const getLocalMusicPlayer = (env: Record<string, string | undefined>): LocalMusicPlayer => {
  const dirs = parseDirectories(env.MUSIC_LIBRARY_DIRS);
  const extensions = parseExtensions(env.MUSIC_FILE_EXTENSIONS);
  const minScoreRaw = parseFloat(env.MUSIC_FUZZY_MIN_SCORE || "");
  const minScore = Number.isFinite(minScoreRaw)
    ? Math.min(1, Math.max(0, minScoreRaw))
    : DEFAULT_MIN_SCORE;
  const rescanRaw = parseInt(env.MUSIC_RESCAN_SECONDS || "", 60);
  const rescanSeconds = Number.isFinite(rescanRaw) && rescanRaw > 0
    ? rescanRaw
    : DEFAULT_RESCAN_SECONDS;
  const soundCardIndex = env.SOUND_CARD_INDEX || "1";

  const key = JSON.stringify({
    dirs,
    extensions: Array.from(extensions.values()).sort(),
    minScore,
    rescanSeconds,
    soundCardIndex,
  });

  if (!localMusicPlayerInstance || key !== localMusicPlayerKey) {
    localMusicPlayerInstance = new LocalMusicPlayer(
      dirs,
      extensions,
      minScore,
      rescanSeconds,
      soundCardIndex,
    );
    localMusicPlayerKey = key;
    void localMusicPlayerInstance.preloadLibrary();
  }

  return localMusicPlayerInstance;
};

export const stopMusicPlayback = (): boolean => {
  if (!localMusicPlayerInstance) {
    return false;
  }
  return localMusicPlayerInstance.stop().ok;
};

export const getMusicPlaybackStatus = (): { isPlaying: boolean; title: string } => {
  if (!localMusicPlayerInstance) {
    return { isPlaying: false, title: "" };
  }
  return localMusicPlayerInstance.getStatus();
};
