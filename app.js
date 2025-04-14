const { exec, spawn } = require("child_process");
const { recognizeAudio } = require("./tencent-cloud");
const chatWithDoubao = require("./doubao-llm");
const volcengineTTS = require("./volcengine-tts");
const { main: display } = require("./display");

const recordAudio = (outputPath, duration = 10) => {
  return new Promise((resolve, reject) => {
    // Using arecord with a pipe to opusenc to create an ogg-opus file
    // const cmd = `arecord -D hw:0,0 -f S16_LE -r 16000 -c 1 -t raw | opusenc --bitrate 16 --raw --raw-rate 16000 --raw-chan 1 - ${outputPath}`;
    // const cmd = `arecord -D hw:0,0 -f S16_LE -r 16000 -c 2 -t raw | lame -r -s 16 - ${outputPath}`;
    // const cmd == `sox -d -t wavpcm -c 2 -b 16 -r 16000 -e signed-integer --endian little output.wav silence 1 0.1 25% 1 3.0 30%`
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

const player = spawn("mpg123", ["-"]);

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

(async () => {
  // const audioData = await ttsByteDance('欢迎使用豆包语音合成服务');
  // playAudioData(audioData);

  display();

  const filePath = "record.mp3";

  while (true) {
    console.log("聆听中...");
    await recordAudio(filePath, 60);
    console.log("识别中...");
    const text = await recognizeAudio(filePath);

    // 调用腾讯云语音合成，播报识别结果
    // const audioData = await synthesizeSpeech(res);
    // 调用字节跳动语音合成，播报识别结果
    if (text) {
      const answer = await chatWithDoubao(text);
      if (answer) {
        const { data: audioData, duration } = await volcengineTTS(answer);
        // 播放合成的音频
        await playAudioData(audioData, duration);
      }
    } else {
      console.log("识别结果为空, 请继续说");
    }
  }
})();

// 退出程序时关闭音频播放器
process.on("SIGINT", () => {
  console.log("退出程序");
  player.stdin.end();
  player.kill();
  process.exit();
});
