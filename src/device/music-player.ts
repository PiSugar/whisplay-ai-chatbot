import fs from "fs";
import path from "path";
import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import { webAudioBridge } from "./web-audio-bridge";

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

const levenshteinDistance = (a: string, b: string): number => {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const dp: number[][] = Array.from({ length: a.length + 1 }, () => []);
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
};

const normalizedSimilarity = (a: string, b: string): number => {
  if (!a || !b) return 0;
  const maxLen = Math.max(a.length, b.length);
  return Math.max(0, 1 - levenshteinDistance(a, b) / maxLen);
};

const scoreTrack = (normalizedQuery: string, track: Track): number => {
  if (!normalizedQuery) return 0;
  const title = track.normalizedTitle;
  if (!title) return 0;
  if (title === normalizedQuery) return 1;
  if (title.includes(normalizedQuery)) {
    const penalty = Math.min(0.2, (title.length - normalizedQuery.length) / 200);
    return Math.max(0, 0.92 - penalty);
  }
  const queryTokens = normalizedQuery.split(" ").filter(Boolean);
  if (queryTokens.length > 0) {
    const tokenHits = queryTokens.filter((token) => title.includes(token)).length;
    const tokenRate = tokenHits / queryTokens.length;
    if (tokenRate >= 0.66) return 0.7 + tokenRate * 0.2;
  }
  return normalizedSimilarity(normalizedQuery, title);
};

const safeSplitCsv = (value: string | undefined): string[] => {
  return (value || "").split(",").map((s) => s.trim()).filter(Boolean);
};

const parseExtensions = (value: string | undefined): Set<string> => {
  const extList = safeSplitCsv(value).map((v) => v.toLowerCase().replace(/^\./, ""));
  return new Set(extList.length > 0 ? extList : DEFAULT_EXTENSIONS);
};

const parseDirectories = (value: string | undefined): string[] => {
  return safeSplitCsv(value).map((dir) => path.resolve(dir));
};

class LocalMusicPlayer {
  private tracks: Track[] = [];
  private currentProcess: ChildProcessWithoutNullStreams | null = null;
  private currentTrack: Track | null = null;
  private preloadPromise: Promise<void> | null = null;
  private isPlaying: boolean = false;
  private continuousPlay: boolean = false; // Whether to auto-play next track

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

    const normalizedRoots = Array.from(new Set(this.libraryDirs.map((dir) => path.resolve(dir))));

    for (const rootDirRaw of normalizedRoots) {
      if (!fs.existsSync(rootDirRaw)) continue;

      let rootDir = rootDirRaw;
      try {
        rootDir = await fs.promises.realpath(rootDirRaw);
      } catch {}
      if (visitedDirs.has(rootDir)) continue;
      visitedDirs.add(rootDir);

      const stack: string[] = [rootDir];
      while (stack.length > 0) {
        const currentDir = stack.pop();
        if (!currentDir) continue;

        let entries: fs.Dirent[] = [];
        try {
          entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
        } catch {
          continue;
        }

        for (const entry of entries) {
          if (entry.name.startsWith(".")) continue;

          const fullPath = path.join(currentDir, entry.name);
          if (entry.isDirectory()) {
            let normalizedDir = fullPath;
            try {
              normalizedDir = await fs.promises.realpath(fullPath);
            } catch {}
            if (!visitedDirs.has(normalizedDir)) {
              visitedDirs.add(normalizedDir);
              stack.push(normalizedDir);
            }
            continue;
          }

          if (!entry.isFile()) continue;

          const ext = path.extname(entry.name).toLowerCase().replace(/^\./, "");
          if (!this.extensions.has(ext)) continue;

          let normalizedFile = fullPath;
          try {
            normalizedFile = await fs.promises.realpath(fullPath);
          } catch {}
          if (visitedFiles.has(normalizedFile)) continue;
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
          console.log(`[Music] Indexed ${this.tracks.length} track(s)`);
        })
        .catch((err) => {
          console.error(`[Music] Failed to index: ${err?.message || err}`);
          this.tracks = [];
        });
    }
    return this.preloadPromise;
  }

  private findBestMatch(query: string): MatchResult | null {
    const normalizedQuery = normalizeForSearch(query);
    if (!normalizedQuery) return null;

    let best: MatchResult | null = null;
    for (const track of this.tracks) {
      const score = scoreTrack(normalizedQuery, track);
      if (score < this.minScore) continue;
      if (!best || score > best.score) best = { track, score };
    }
    return best;
  }

  private getRandomTrack(): Track | null {
    if (this.tracks.length === 0) return null;
    const index = Math.floor(Math.random() * this.tracks.length);
    return this.tracks[index];
  }

  private stopCurrentProcess(): void {
    if (webAudioBridge.isAvailable()) {
      webAudioBridge.stopPlayback();
    }

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

  private async playViaWeb(filePath: string, onEnded?: () => void): Promise<boolean> {
    if (!webAudioBridge.isAvailable()) return false;

    try {
      const ext = path.extname(filePath).toLowerCase();
      const format = ext === ".mp3" ? "mp3" : "wav";
      const buffer = fs.readFileSync(filePath);
      const fileSizeMB = buffer.length / (1024 * 1024);
      const estimatedDuration = Math.min(600, Math.max(30, fileSizeMB * 40));

      await webAudioBridge.playAudioData(
        { buffer, duration: estimatedDuration * 1000, filePath },
        format as "mp3" | "wav"
      );

      if (onEnded) onEnded();
      return true;
    } catch (err: any) {
      console.error(`[Music] Web playback failed: ${err?.message}`);
      return false;
    }
  }

  private async playNextRandomTrack(): Promise<void> {
    if (!this.isPlaying) return;

    const track = this.getRandomTrack();
    if (!track) return;

    this.stopCurrentProcess();
    this.currentTrack = track;

    // Callback when playback ends - continue with next random track
    const onEnded = () => {
      if (this.isPlaying) {
        void this.playNextRandomTrack();
      }
    };

    const playedViaWeb = await this.playViaWeb(track.filePath, onEnded);
    if (playedViaWeb) {
      console.log(`[Music] Playing: ${track.title}`);
      return;
    }

    // Local playback fallback
    const { command, args } = this.buildPlaybackCommand(track.filePath);
    const process = spawn(command, args);
    this.currentProcess = process;

    process.on("error", (err) => {
      console.error(`[Music] Playback error: ${err.message}`);
      if (this.currentProcess === process) {
        this.currentProcess = null;
        this.currentTrack = null;
      }
    });

    process.on("exit", () => {
      if (this.currentProcess === process) {
        this.currentProcess = null;
        this.currentTrack = null;
        if (this.isPlaying) {
          void this.playNextRandomTrack();
        }
      }
    });

    console.log(`[Music] Playing: ${track.title}`);
  }

  private async startPlayback(track: Track, continuous: boolean = false): Promise<void> {
    this.stopCurrentProcess();
    this.currentTrack = track;
    this.isPlaying = true;
    this.continuousPlay = continuous;

    // Callback when playback ends
    const onEnded = () => {
      if (this.isPlaying && this.continuousPlay) {
        void this.playNextRandomTrack();
      } else {
        this.isPlaying = false;
      }
    };

    const playedViaWeb = await this.playViaWeb(track.filePath, onEnded);
    if (playedViaWeb) return;

    // Local playback fallback
    const { command, args } = this.buildPlaybackCommand(track.filePath);
    const process = spawn(command, args);
    this.currentProcess = process;

    process.on("error", (err) => {
      console.error(`[Music] Playback error: ${err.message}`);
      if (this.currentProcess === process) {
        this.currentProcess = null;
        this.currentTrack = null;
      }
    });

    process.on("exit", () => {
      if (this.currentProcess === process) {
        this.currentProcess = null;
        this.currentTrack = null;
        if (this.isPlaying) {
          void this.playNextRandomTrack();
        }
      }
    });
  }

  async playByQuery(query: string, continuous: boolean = false): Promise<{
    ok: boolean;
    message: string;
    trackPath?: string;
    trackTitle?: string;
  }> {
    if (!this.isConfigured()) {
      return { ok: false, message: "Music library not configured." };
    }

    await this.preloadLibrary();
    if (this.tracks.length === 0) {
      return { ok: false, message: "No music files found." };
    }

    const best = this.findBestMatch(query);
    if (!best) {
      return { ok: false, message: `No matching track found for "${query}"` };
    }

    await this.startPlayback(best.track, continuous);

    return {
      ok: true,
      message: `Playing: ${best.track.title}`,
      trackPath: best.track.filePath,
      trackTitle: best.track.title,
    };
  }

  async playRandom(continuous: boolean = true): Promise<{
    ok: boolean;
    message: string;
    trackPath?: string;
    trackTitle?: string;
  }> {
    if (!this.isConfigured()) {
      return { ok: false, message: "Music library not configured." };
    }

    await this.preloadLibrary();
    if (this.tracks.length === 0) {
      return { ok: false, message: "No music files found." };
    }

    const track = this.getRandomTrack();
    if (!track) {
      return { ok: false, message: "Could not select a random track." };
    }

    await this.startPlayback(track, continuous);

    return {
      ok: true,
      message: `Playing: ${track.title}`,
      trackPath: track.filePath,
      trackTitle: track.title,
    };
  }

  stop(): void {
    this.isPlaying = false;
    this.stopCurrentProcess();
    console.log("[Music] Playback stopped");
  }

  isMusicPlaying(): boolean {
    return this.isPlaying;
  }

  getCurrentTrack(): Track | null {
    return this.currentTrack;
  }
}

let localMusicPlayerInstance: LocalMusicPlayer | null = null;
let localMusicPlayerKey = "";

export const getLocalMusicPlayer = (env: Record<string, string | undefined>): LocalMusicPlayer => {
  const dirs = parseDirectories(env.MUSIC_LIBRARY_DIRS);
  const extensions = parseExtensions(env.MUSIC_FILE_EXTENSIONS);
  const minScoreRaw = parseFloat(env.MUSIC_FUZZY_MIN_SCORE || "");
  const minScore = Number.isFinite(minScoreRaw) ? Math.min(1, Math.max(0, minScoreRaw)) : DEFAULT_MIN_SCORE;
  const rescanRaw = parseInt(env.MUSIC_RESCAN_SECONDS || "", 60);
  const rescanSeconds = Number.isFinite(rescanRaw) && rescanRaw > 0 ? rescanRaw : DEFAULT_RESCAN_SECONDS;
  const soundCardIndex = env.SOUND_CARD_INDEX || "1";

  const key = JSON.stringify({
    dirs,
    extensions: Array.from(extensions.values()).sort(),
    minScore,
    rescanSeconds,
    soundCardIndex,
  });

  if (!localMusicPlayerInstance || key !== localMusicPlayerKey) {
    localMusicPlayerInstance = new LocalMusicPlayer(dirs, extensions, minScore, rescanSeconds, soundCardIndex);
    localMusicPlayerKey = key;
    void localMusicPlayerInstance.preloadLibrary();
  }

  return localMusicPlayerInstance;
};

export const stopMusicPlayback = (): void => {
  localMusicPlayerInstance?.stop();
};

export const isMusicPlaying = (): boolean => {
  return localMusicPlayerInstance?.isMusicPlaying() ?? false;
};

export const getCurrentTrackTitle = (): string => {
  return localMusicPlayerInstance?.getCurrentTrack()?.title || "";
};
