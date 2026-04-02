import fs from "fs";
import path from "path";
import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import { getAudioDurationInSeconds } from "get-audio-duration";
import { webAudioBridge } from "./web-audio-bridge";

// Lazy imports to avoid circular dependencies
const lazyAudio = () => require("./audio") as { releaseAudioPlayer: () => Promise<void>; restoreAudioPlayer: () => void };
const lazyDisplay = () => require("./display") as { display: (s: Record<string, any>) => void };

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
  private static readonly MAX_PLAYBACK_RETRIES = 10;
  private static readonly RETRY_DELAY_MS = 1000;

  private tracks: Track[] = [];
  private currentProcess: ChildProcessWithoutNullStreams | null = null;
  private currentTrack: Track | null = null;
  private preloadPromise: Promise<void> | null = null;
  private isPlaying: boolean = false;
  private continuousPlay: boolean = false; // Whether to auto-play next track
  private pendingTrack: Track | null = null;
  private pendingContinuous: boolean = false;
  private playbackGeneration: number = 0;
  private playbackRetries: number = 0;
  private trackChangeCallback: ((title: string) => void) | null = null;
  private playbackEndCallback: (() => void) | null = null;
  private progressTimer: ReturnType<typeof setInterval> | null = null;
  private playbackStartTime: number = 0;
  private currentTrackDurationMs: number = 0;

  onTrackChange(callback: ((title: string) => void) | null): void {
    this.trackChangeCallback = callback;
  }

  onPlaybackEnd(callback: (() => void) | null): void {
    this.playbackEndCallback = callback;
  }

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

  private stopProgressTimer(): void {
    if (this.progressTimer) {
      clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
    // Clear progress bar from display
    try {
      lazyDisplay().display({ music_progress: -1, music_duration_ms: 0 });
    } catch {}
  }

  private startProgressTimer(durationMs: number): void {
    this.stopProgressTimer();
    this.currentTrackDurationMs = durationMs;
    this.playbackStartTime = Date.now();
    // Send initial progress
    try {
      lazyDisplay().display({ music_progress: 0, music_duration_ms: durationMs });
    } catch {}
    this.progressTimer = setInterval(() => {
      if (!this.isPlaying || this.currentTrackDurationMs <= 0) {
        this.stopProgressTimer();
        return;
      }
      const elapsed = Date.now() - this.playbackStartTime;
      const progress = Math.min(1, elapsed / this.currentTrackDurationMs);
      try {
        lazyDisplay().display({ music_progress: progress, music_duration_ms: this.currentTrackDurationMs });
      } catch {}
    }, 1000);
  }

  private async getTrackDurationMs(filePath: string): Promise<number> {
    try {
      const sec = await getAudioDurationInSeconds(filePath);
      return Math.round(sec * 1000);
    } catch {
      return 0;
    }
  }

  private stopCurrentProcess(): void {
    this.playbackGeneration++;

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

  /**
   * Spawn mpg123/sox for a track. On abnormal exit (code != 0), retries
   * the same track up to MAX_PLAYBACK_RETRIES times with a delay.
   * On normal exit, calls onNormalEnd. Stale exits from previous
   * generations are silently ignored.
   */
  private spawnAndPlay(track: Track, gen: number, onNormalEnd: () => void): void {
    const { command, args } = this.buildPlaybackCommand(track.filePath);
    const proc = spawn(command, args);
    this.currentProcess = proc;

    proc.on("error", (err) => {
      console.error(`[Music] Playback spawn error: ${err.message}`);
      if (gen === this.playbackGeneration) {
        this.currentProcess = null;
        this.currentTrack = null;
      }
    });

    proc.on("exit", (code, signal) => {
      if (gen !== this.playbackGeneration) return;

      if (code && code !== 0) {
        console.error(`[Music] Playback exited with code=${code} signal=${signal}`);
        this.currentProcess = null;
        if (this.isPlaying && this.playbackRetries < LocalMusicPlayer.MAX_PLAYBACK_RETRIES) {
          this.playbackRetries++;
          console.log(`[Music] Retrying "${track.title}" (attempt ${this.playbackRetries}/${LocalMusicPlayer.MAX_PLAYBACK_RETRIES})...`);
          setTimeout(() => {
            if (gen === this.playbackGeneration && this.isPlaying) {
              this.spawnAndPlay(track, gen, onNormalEnd);
            }
          }, LocalMusicPlayer.RETRY_DELAY_MS);
          return;
        }
      }

      this.playbackRetries = 0;
      this.currentProcess = null;
      this.currentTrack = null;
      if (this.isPlaying) {
        onNormalEnd();
      }
    });

    console.log(`[Music] Playing: ${track.title}`);
    this.trackChangeCallback?.(track.title);
  }

  private buildPlaybackCommand(filePath: string): { command: string; args: string[] } {
    const ext = path.extname(filePath).toLowerCase();
    // Use the "dmixed" ALSA device (dmix software mixer) so music playback
    // can coexist with the persistent TTS player without ALSA device conflicts.
    const alsaDevice = "dmixed";
    if (ext === ".mp3") {
      return {
        command: "mpg123",
        args: ["-o", "alsa", "-a", alsaDevice, filePath],
      };
    }
    return {
      command: "sox",
      args: [filePath, "-t", "alsa", alsaDevice],
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
    this.stopProgressTimer();
    this.currentTrack = track;
    this.playbackRetries = 0;

    const durationMs = await this.getTrackDurationMs(track.filePath);
    if (!this.isPlaying) return;

    // Callback when playback ends - continue with next random track
    const onEnded = () => {
      this.stopProgressTimer();
      if (this.isPlaying) {
        void this.playNextRandomTrack();
      }
    };

    const playedViaWeb = await this.playViaWeb(track.filePath, onEnded);
    if (playedViaWeb) {
      console.log(`[Music] Playing: ${track.title}`);
      this.trackChangeCallback?.(track.title);
      if (durationMs > 0) this.startProgressTimer(durationMs);
      return;
    }

    const gen = this.playbackGeneration;
    this.spawnAndPlay(track, gen, onEnded);
    if (durationMs > 0) this.startProgressTimer(durationMs);
  }

  private async startPlayback(track: Track, continuous: boolean = false): Promise<void> {
    this.stopCurrentProcess();
    this.stopProgressTimer();
    this.currentTrack = track;
    this.isPlaying = true;
    this.continuousPlay = continuous;
    this.playbackRetries = 0;

    const durationMs = await this.getTrackDurationMs(track.filePath);
    if (!this.isPlaying) return;

    // Callback when playback ends normally
    const onEnded = () => {
      this.stopProgressTimer();
      if (this.isPlaying && this.continuousPlay) {
        void this.playNextRandomTrack();
      } else {
        this.isPlaying = false;
        this.playbackEndCallback?.();
      }
    };

    const playedViaWeb = await this.playViaWeb(track.filePath, onEnded);
    if (playedViaWeb) {
      if (durationMs > 0) this.startProgressTimer(durationMs);
      return;
    }

    // Release the persistent TTS player so ALSA is completely free.
    // Music uses the "dmixed" device (dmix mixer) which can coexist, but
    // releasing first avoids any contention on the underlying hardware.
    await lazyAudio().releaseAudioPlayer();
    if (!this.isPlaying) return;

    const gen = this.playbackGeneration;
    this.spawnAndPlay(track, gen, onEnded);
    if (durationMs > 0) this.startProgressTimer(durationMs);
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

  async findByQuery(query: string, continuous: boolean = false): Promise<{
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

    this.pendingTrack = best.track;
    this.pendingContinuous = continuous;

    return {
      ok: true,
      message: `Playing: ${best.track.title}`,
      trackPath: best.track.filePath,
      trackTitle: best.track.title,
    };
  }

  async findRandom(continuous: boolean = true): Promise<{
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

    this.pendingTrack = track;
    this.pendingContinuous = continuous;

    return {
      ok: true,
      message: `Playing: ${track.title}`,
      trackPath: track.filePath,
      trackTitle: track.title,
    };
  }

  startPendingPlayback(): void {
    if (!this.pendingTrack) return;
    const track = this.pendingTrack;
    const continuous = this.pendingContinuous;
    this.pendingTrack = null;
    void this.startPlayback(track, continuous);
  }

  stop(): void {
    this.isPlaying = false;
    this.pendingTrack = null;
    this.stopProgressTimer();
    this.stopCurrentProcess();
    // Restore the persistent TTS player after releasing
    lazyAudio().restoreAudioPlayer();
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

export const startPendingMusicPlayback = (): void => {
  localMusicPlayerInstance?.startPendingPlayback();
};

export const onMusicTrackChange = (callback: ((title: string) => void) | null): void => {
  localMusicPlayerInstance?.onTrackChange(callback);
};

export const onMusicPlaybackEnd = (callback: (() => void) | null): void => {
  localMusicPlayerInstance?.onPlaybackEnd(callback);
};
