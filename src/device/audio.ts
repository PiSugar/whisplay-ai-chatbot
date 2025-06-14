import { exec, spawn, ChildProcess } from "child_process";
import { noop } from "lodash";

let recordingProcess: ChildProcess | null = null;
let currentRecordingReject: (reason?: any) => void = noop;

const recordAudio = (outputPath: string, duration: number = 10): Promise<string> => {
  return new Promise((resolve, reject) => {
    const cmd = `sox -t alsa default -t mp3 ${outputPath} silence 1 0.1 60% 1 1.0 60%`;
    console.log(`开始录音, 最长${duration}秒钟...`);
    recordingProcess = exec(cmd, (err, stdout, stderr) => {
      currentRecordingReject = reject;
      if (err) {
        if (recordingProcess) {
          recordingProcess.kill();
          recordingProcess = null;
        }
        reject(stderr);
      } else {
        resolve(outputPath);
      }
    });

    // Set a timeout to kill the recording process after the specified duration
    setTimeout(() => {
      if (recordingProcess) {
        recordingProcess.kill();
        recordingProcess = null;
        resolve(outputPath);
      }
    }, duration * 1000);
  });
};

const recordAudioManually = (outputPath: string): { result: Promise<string>; stop: () => void } => {
  let stopFunc: () => void = noop;
  const result = new Promise<string>((resolve, reject) => {
    currentRecordingReject = reject;
    recordingProcess = exec(`sox -t alsa default -t mp3 ${outputPath}`, (err, stdout, stderr) => {
      if (err) {
        if (recordingProcess) {
          recordingProcess.kill();
          recordingProcess = null;
        }
        reject(stderr);
      }
    });
    stopFunc = () => {
      if (recordingProcess) {
        recordingProcess.kill();
        recordingProcess = null;
      }
      resolve(outputPath);
    };
  });
  return {
    result,
    stop: stopFunc,
  };
};

const stopRecording = (): void => {
  if (recordingProcess) {
    recordingProcess.kill();
    recordingProcess = null;
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
  process: ChildProcess;
}

const player: Player = {
  isPlaying: false,
  process: spawn("mpg123", ["-", "--scale", "2"]),
};

const playAudioData = (resAudioData: string, audioDuration: number): Promise<void> => {
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
      process.stdin?.end();
      process.kill();
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
    player.process.stdin?.end();
    player.process.kill();
  } catch {}
  process.exit();
});

function splitSentences(text: string): { sentences: string[]; remaining: string } {
  const regex = /.*?([。！？!?，,]|[\uD800-\uDBFF][\uDC00-\uDFFF]|\.)(?=\s|$)/gs;

  const sentences: string[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    sentences.push(match[0].trim());
    lastIndex = regex.lastIndex;
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

  constructor(ttsFunc: TTSFunc, sentencesCallback?: SentencesCallback, textCallback?: TextCallback) {
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
