const { exec, spawn } = require("child_process");

const recordAudio = (outputPath, duration = 10) => {
  return new Promise((resolve, reject) => {
    const cmd = `sox -t alsa default -t mp3 ${outputPath} silence 1 0.1 15% 1 1.0 20%`;
    console.log(`开始录音, 最长${duration}秒钟...`);
    const process = exec(cmd, (err, stdout, stderr) => {
      if (err) reject(stderr);
      else resolve(outputPath);
    });

    // Set a timeout to kill the recording process after the specified duration
    setTimeout(() => {
      process.kill();
      resolve(outputPath);
    }, duration * 1000);
  });
};

const player = spawn("mpg123", ["-", "--scale", "2"]); // 设置音量为50%

const playAudioData = (resAudioData, audioDuration) => {
  // const audioData = Buffer.from(resAudioData).toString('base64');
  // console.time('存储mp3');
  const audioBuffer = Buffer.from(resAudioData, "base64");
  // fs.writeFileSync('output.mp3', audioBuffer);
  // console.timeEnd('存储mp3');
  return new Promise((resolve, reject) => {
    console.log("播放时长:", audioDuration);
    setTimeout(() => {
      resolve();
      console.log("音频播放完成");
    }, audioDuration); // 加1秒缓冲

    player.stdin.write(audioBuffer);
    player.stdout.on("data", (data) => console.log(data.toString()));
    player.stderr.on("data", (data) => console.error(data.toString()));
    player.on("exit", (code) => {
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

// 退出程序时关闭音频播放器
process.on("SIGINT", () => {
  console.log("退出程序");
  player.stdin.end();
  player.kill();
  process.exit();
});

function splitSentences(text) {
  const regex = /.*?([。！？!?]|[\uD800-\uDBFF][\uDC00-\uDFFF]|\.)(?=\s|$)/gs;

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

const createSteamResponser = (ttsFunc, sentencesCallback, textCallback) => {
  // 流式播放
  let partialContent = "";
  let isStartSpeak = false;
  let playEndResolve = () => {};

  const speakArray = [];
  const parsedSentences = [];
  const partial = (text) => {
    partialContent += text;
    // 如果有句号，emoji，问号，叹号等标点符号，就认为是完整的一句话，截取这个符号之前的内容存入数组
    const { sentences, remaining } = splitSentences(partialContent);
    if (sentences.length > 0) {
      parsedSentences.push(...sentences);
      sentencesCallback && sentencesCallback(parsedSentences);
      speakArray.push(
        ...sentences.map((item) =>
          ttsFunc(item).finally(() => {
            if (!isStartSpeak) {
              playAudioInOrder();
              isStartSpeak = true;
            }
          })
        )
      );
    }
    partialContent = remaining;
  };
  const endPartial = () => {
    if (partialContent) {
      parsedSentences.push(partialContent);
      sentencesCallback && sentencesCallback(parsedSentences);
      speakArray.push(ttsFunc(partialContent));
      partialContent = "";
    }
    textCallback & textCallback(parsedSentences.join(""));
    parsedSentences.length = 0;
  };

  // 触发顺序播放
  const playAudioInOrder = async () => {
    let currentIndex = 0;
    const playNext = async () => {
      if (currentIndex < speakArray.length) {
        try {
          const { data: audio, duration } = await speakArray[currentIndex];
          console.log(`播放音频 ${currentIndex + 1}/${speakArray.length}`);
          await playAudioData(audio, duration);
        } catch (error) {
          console.error("播放音频错误:", error);
        }
        currentIndex++;
        playNext();
      } else {
        playEndResolve();
        isStartSpeak = false;
        speakArray.length = 0;
      }
    };
    playNext();
  };

  const getPlayEndPromise = () =>
    new Promise((resolve) => {
      playEndResolve = resolve;
    });

  return {
    partial,
    endPartial,
    getPlayEndPromise,
  };
};

module.exports = {
  recordAudio,
  playAudioData,
  createSteamResponser,
};
