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


module.exports = {
  recordAudio,
  playAudioData,
}