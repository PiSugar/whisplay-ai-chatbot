import { exec, spawn, ChildProcess } from "child_process";
import { isEmpty, noop } from "lodash";
import { splitSentences } from "../utils";

let recordingProcessList: ChildProcess[] = [];
let currentRecordingReject: (reason?: any) => void = noop;

const killAllRecordingProcesses = (): void => {
  recordingProcessList.forEach((child) => {
    try {
      child.stdin?.end();
      child.kill("SIGKILL");
    } catch (e) {}
  });
  recordingProcessList.length = 0;
};

const recordAudio = (
  outputPath: string,
  duration: number = 10
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const cmd = `sox -t alsa default -t mp3 ${outputPath} silence 1 0.1 60% 1 1.0 60%`;
    console.log(`Recording started, maximum ${duration} seconds...`);
    const recordingProcess = exec(cmd, (err, _stdout, stderr) => {
      currentRecordingReject = reject;
      if (err) {
        killAllRecordingProcesses();
        reject(stderr);
      } else {
        resolve(outputPath);
      }
    });
    recordingProcessList.push(recordingProcess);

    // Set a timeout to kill the recording process after the specified duration
    setTimeout(() => {
      if (recordingProcessList.includes(recordingProcess)) {
        killAllRecordingProcesses();
        resolve(outputPath);
      }
    }, duration * 1000);
  });
};

const recordAudioManually = (
  outputPath: string
): { result: Promise<string>; stop: () => void } => {
  let stopFunc: () => void = noop;
  const result = new Promise<string>((resolve, reject) => {
    currentRecordingReject = reject;
    const _recordingProcess = exec(
      `sox -t alsa default -t mp3 ${outputPath}`,
      (err, _stdout, stderr) => {
        if (err) {
          killAllRecordingProcesses();
          reject(stderr);
        }
      }
    );
    stopFunc = () => {
      killAllRecordingProcesses();
      resolve(outputPath);
    };
  });
  return {
    result,
    stop: stopFunc,
  };
};

const stopRecording = (): void => {
  if (!isEmpty(recordingProcessList)) {
    killAllRecordingProcesses();
    try {
      currentRecordingReject();
    } catch (e) {}
    console.log("Recording stopped");
  } else {
    console.log("No recording process is running");
  }
};

interface Player {
  isPlaying: boolean;
  process: ChildProcess | null;
}

const player: Player = {
  isPlaying: false,
  process: null,
};

setTimeout(() => {
  player.process = spawn("mpg123", ["-", "--scale", "2", "-o", "alsa"]);
}, 5000);

const playAudioData = (
  resAudioData: string,
  audioDuration: number
): Promise<void> => {
  const audioBuffer = Buffer.from(resAudioData, "base64");
  return new Promise((resolve, reject) => {
    console.log("Playing duration:", audioDuration);
    player.isPlaying = true;
    setTimeout(() => {
      resolve();
      player.isPlaying = false;
      console.log("Audio playback completed");
    }, audioDuration); // 加1秒缓冲

    const process = player.process;

    if (!process) {
      return reject(new Error("Audio player is not initialized."));
    }

    try {
      process.stdin?.write(audioBuffer);
    } catch (e) {}
    process.stdout?.on("data", (data) => console.log(data.toString()));
    process.stderr?.on("data", (data) => console.error(data.toString()));
    process.on("exit", (code) => {
      player.isPlaying = false;
      if (code !== 0) {
        console.error(`Audio playback error: ${code}`);
        reject(code);
      } else {
        console.log("Audio playback completed");
        resolve();
      }
    });
  });
};

const stopPlaying = (): void => {
  if (player.isPlaying) {
    try {
      console.log("Stopping audio playback");
      const process = player.process;
      if (process) {
        process.stdin?.end();
        process.kill();
      }
    } catch {}
    player.isPlaying = false;
    // 重新创建进程
    setTimeout(() => {
      player.process = spawn("mpg123", ["-", "--scale", "2"]);
    }, 500);
  } else {
    console.log("No audio is currently playing");
  }
};

// 退出程序时关闭音频播放器
process.on("SIGINT", () => {
  try {
    if (player.process) {
      player.process.stdin?.end();
      player.process.kill();
    }
  } catch {}
  process.exit();
});

function purifyText(text: string): string {
  // remove unprocessable characters，such as *, #, ~, etc.
  return text.replace(/[*#~]/g, "").trim();
}

type TTSFunc = (text: string) => Promise<{ data: string; duration: number }>;
type SentencesCallback = (sentences: string[]) => void;
type TextCallback = (text: string) => void;

class StreamResponser {
  private ttsFunc: TTSFunc;
  private sentencesCallback?: SentencesCallback;
  private textCallback?: TextCallback;
  private partialContent: string = "";
  private isStartSpeak: boolean = false;
  private playEndResolve: () => void = () => {};
  private speakArray: Promise<{ data: string; duration: number }>[] = [];
  private parsedSentences: string[] = [];

  constructor(
    ttsFunc: TTSFunc,
    sentencesCallback?: SentencesCallback,
    textCallback?: TextCallback
  ) {
    this.ttsFunc = (text) => ttsFunc(purifyText(text));
    this.sentencesCallback = sentencesCallback;
    this.textCallback = textCallback;
  }

  private playAudioInOrder = async (): Promise<void> => {
    let currentIndex = 0;
    const playNext = async () => {
      if (currentIndex < this.speakArray.length) {
        try {
          const { data: audio, duration } = await this.speakArray[currentIndex];
          console.log(`Playing audio ${currentIndex + 1}/${this.speakArray.length}`);
          await playAudioData(audio, duration);
        } catch (error) {
          console.error("Audio playback error:", error);
        }
        currentIndex++;
        playNext();
      } else if (this.partialContent) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        playNext();
      } else {
        console.log(
          `Play all audio completed. Total: ${this.speakArray.length}`
        );
        this.playEndResolve();
        this.isStartSpeak = false;
        this.speakArray.length = 0;
        this.speakArray = [];
      }
    };
    playNext();
  };

  partial = (text: string): void => {
    this.partialContent += text;
    // replace newlines with spaces
    this.partialContent = this.partialContent.replace(/\n/g, " ");
    const { sentences, remaining } = splitSentences(this.partialContent);
    if (sentences.length > 0) {
      this.parsedSentences.push(...sentences);
      this.sentencesCallback?.(this.parsedSentences);
      // remove emoji
      const filteredSentences = sentences
        .map((item) => item.replace(/[\u{1F600}-\u{1F64F}]/gu, ""))
        .filter((item) => item.trim() !== "");
      this.speakArray.push(
        ...filteredSentences.map((item) =>
          this.ttsFunc(item).finally(() => {
            if (!this.isStartSpeak) {
              this.playAudioInOrder();
              this.isStartSpeak = true;
            }
          })
        )
      );
    }
    this.partialContent = remaining;
  };

  endPartial = (): void => {
    if (this.partialContent) {
      this.parsedSentences.push(this.partialContent);
      this.sentencesCallback?.(this.parsedSentences);
      // remove emoji
      this.partialContent = this.partialContent.replace(
        /[\u{1F600}-\u{1F64F}]/gu,
        ""
      );
      if (this.partialContent.trim() !== "") {
        this.speakArray.push(this.ttsFunc(this.partialContent));
      }
      this.partialContent = "";
    }
    this.textCallback?.(this.parsedSentences.join(" "));
    this.parsedSentences.length = 0;
  };

  getPlayEndPromise = (): Promise<void> => {
    return new Promise((resolve) => {
      this.playEndResolve = resolve;
    });
  };

  stop = (): void => {
    this.speakArray = [];
    this.speakArray.length = 0;
    this.isStartSpeak = false;
    this.partialContent = "";
    this.parsedSentences.length = 0;
    this.playEndResolve();
    stopPlaying();
  };
}

export {
  recordAudio,
  recordAudioManually,
  stopRecording,
  playAudioData,
  StreamResponser,
};
