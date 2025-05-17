const { exec, spawn } = require("child_process");
const { noop } = require("lodash");

let recordingProcess = null;
let currentRecordingReject = noop;

const recordAudio = (outputPath, duration = 10) => {
  return new Promise((resolve, reject) => {
    const cmd = `sox -t alsa default -t mp3 ${outputPath} silence 1 0.1 50% 1 1.0 50%`;
    console.log(`开始录音, 最长${duration}秒钟...`);
    recordingProcess = exec(cmd, (err, stdout, stderr) => {
      currentRecordingReject = reject;
      if (err) {
        if (recordingProcess) {
          recordingProcess.kill();
          recordingProcess = null;
        }
        reject(stderr);
      }
      else resolve(outputPath);
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

const stopRecording = () => {
  if (recordingProcess) {
    recordingProcess.kill();
    recordingProcess = null;
    try {
      currentRecordingReject();
    } catch (e) { }
    console.log("录音已停止");
  } else {
    console.log("没有正在录音的进程");
  }
};

const player = {
  isPlaying: false,
  process: spawn("mpg123", ["-", "--scale", "2"]),
};

const playAudioData = (resAudioData, audioDuration) => {
  // const audioData = Buffer.from(resAudioData).toString('base64');
  // console.time('存储mp3');
  const audioBuffer = Buffer.from(resAudioData, "base64");
  // fs.writeFileSync('output.mp3', audioBuffer);
  // console.timeEnd('存储mp3');
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
      process.stdin.write(audioBuffer);
    } catch (e) { }
    process.stdout.on("data", (data) => console.log(data.toString()));
    process.stderr.on("data", (data) => console.error(data.toString()));
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

const stopPlaying = () => {
  if (player.isPlaying) {
    try {
      console.log("中止播放音频");
      const process = player.process;
      process.stdin.end();
      process.kill();
    } catch { }
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
    player.stdin.end();
    player.kill();
  } catch { }
  process.exit();
});

function splitSentences(text) {
  const regex = /.*?([。！？!?，,]|[\uD800-\uDBFF][\uDC00-\uDFFF]|\.)(?=\s|$)/gs;

  const sentences = [];
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    sentences.push(match[0].trim());
    lastIndex = regex.lastIndex;
  }

  const remaining = text.slice(lastIndex).trim();

  return { sentences, remaining };
}

class StreamResponser {
  constructor(ttsFunc, sentencesCallback, textCallback) {
    this.ttsFunc = ttsFunc;
    this.sentencesCallback = sentencesCallback;
    this.textCallback = textCallback;
    this.partialContent = "";
    this.isStartSpeak = false;
    this.playEndResolve = () => { };
    this.speakArray = [];
    this.parsedSentences = [];
  }

  playAudioInOrder = async () => {
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

  partial = (text) => {
    this.partialContent += text;
    const { sentences, remaining } = splitSentences(this.partialContent);
    if (sentences.length > 0) {
      this.parsedSentences.push(...sentences);
      this.sentencesCallback && this.sentencesCallback(this.parsedSentences);
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

  endPartial = () => {
    if (this.partialContent) {
      this.parsedSentences.push(this.partialContent);
      this.sentencesCallback && this.sentencesCallback(this.parsedSentences);
      this.speakArray.push(this.ttsFunc(this.partialContent));
      this.partialContent = "";
    }
    this.textCallback && this.textCallback(this.parsedSentences.join(""));
    this.parsedSentences.length = 0;
  };

  getPlayEndPromise = () => {
    return new Promise((resolve) => {
      this.playEndResolve = resolve;
    });
  };

  stop = () => {
    this.speakArray.length = 0;
    this.isStartSpeak = false;
    this.partialContent = "";
    this.parsedSentences.length = 0;
    this.playEndResolve();
    stopPlaying();
  };
}

module.exports = {
  recordAudio,
  stopRecording,
  playAudioData,
  // createStreamResponser,
  StreamResponser,
};
