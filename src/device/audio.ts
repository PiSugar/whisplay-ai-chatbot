import { exec, spawn, ChildProcess } from "child_process";
import { isEmpty, noop } from "lodash";

let recordingProcessList: ChildProcess[] = [];
let currentRecordingReject: (reason?: any) => void = noop;

const killAllRecordingProcesses = (): void => {
  recordingProcessList.forEach((child) => {
    try {
      child.stdin?.end();
      child.kill('SIGKILL');
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
    console.log(`开始录音, 最长${duration}秒钟...`);
    const recordingProcess = exec(
      cmd,
      (err, stdout, stderr) => {
        currentRecordingReject = reject;
        if (err) {
          killAllRecordingProcesses();
          reject(stderr);
        } else {
          resolve(outputPath);
        }
      }
    );
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
    const recordingProcess = exec(
      `sox -t alsa default -t mp3 ${outputPath}`,
      (err, stdout, stderr) => {
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
    console.log("录音已停止");
  } else {
    console.log("没有正在录音的进程");
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
  player.process = spawn("mpg123", ["-", "--scale", "2"]);
}, 5000);

const playAudioData = (
  resAudioData: string,
  audioDuration: number
): Promise<void> => {
  const audioBuffer = Buffer.from(resAudioData, "base64");
  return new Promise((resolve, reject) => {
    console.log("播放时长:", audioDuration);
    player.isPlaying = true;
    setTimeout(() => {
      resolve();
      player.isPlaying = false;
      console.log("音频播放完成");
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
        console.error(`播放音频错误: ${code}`);
        reject(code);
      } else {
        console.log("音频播放完成");
        resolve();
      }
    });
  });
};

const stopPlaying = (): void => {
  if (player.isPlaying) {
    try {
      console.log("中止播放音频");
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
    console.log("没有正在播放的音频");
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

function splitSentences(text: string): {
  sentences: string[];
  remaining: string;
} {
  const regex =
    /.*?([。！？!?，,]|[\uD800-\uDBFF][\uDC00-\uDFFF]|\.)(?=\s|$)/gs;

  const sentences: string[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const sentence = match[0].trim();
    // Check if the sentence is just a number followed by punctuation
    if (!/^\d+[.。！？!?，,]$/.test(sentence)) {
      sentences.push(sentence);
      lastIndex = regex.lastIndex;
    } else {
      // If it's just a number with punctuation, reset lastIndex to include this in the next match
      regex.lastIndex = match.index;
      break;
    }
  }

  const remaining = text.slice(lastIndex).trim();

  return { sentences, remaining };
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
    this.ttsFunc = ttsFunc;
    this.sentencesCallback = sentencesCallback;
    this.textCallback = textCallback;
  }

  private playAudioInOrder = async (): Promise<void> => {
    let currentIndex = 0;
    const playNext = async () => {
      if (currentIndex < this.speakArray.length) {
        try {
          const { data: audio, duration } = await this.speakArray[currentIndex];
          console.log(`播放音频 ${currentIndex + 1}/${this.speakArray.length}`);
          await playAudioData(audio, duration);
        } catch (error) {
          console.error("播放音频错误:", error);
        }
        currentIndex++;
        playNext();
      } else {
        this.playEndResolve();
        this.isStartSpeak = false;
        this.speakArray.length = 0;
      }
    };
    playNext();
  };

  partial = (text: string): void => {
    this.partialContent += text;
    const { sentences, remaining } = splitSentences(this.partialContent);
    if (sentences.length > 0) {
      this.parsedSentences.push(...sentences);
      this.sentencesCallback?.(this.parsedSentences);
      this.speakArray.push(
        ...sentences.map((item) =>
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
      this.speakArray.push(this.ttsFunc(this.partialContent));
      this.partialContent = "";
    }
    this.textCallback?.(this.parsedSentences.join(""));
    this.parsedSentences.length = 0;
  };

  getPlayEndPromise = (): Promise<void> => {
    return new Promise((resolve) => {
      this.playEndResolve = resolve;
    });
  };

  stop = (): void => {
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
