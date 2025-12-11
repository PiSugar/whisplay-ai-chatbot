import { exec, spawn, ChildProcess } from "child_process";
import { isEmpty, noop, set } from "lodash";
import dotenv from "dotenv";
import { ttsServer, asrServer } from "../cloud-api/server";
import { ASRServer, TTSResult, TTSServer } from "../type";

dotenv.config();

const soundCardIndex = process.env.SOUND_CARD_INDEX || "1";

const useWavPlayer = [TTSServer.gemini, TTSServer.piper].includes(ttsServer);

export const recordFileFormat = [
  ASRServer.vosk,
  ASRServer.whisper,
  ASRServer.llm8850whisper,
].includes(asrServer)
  ? "wav"
  : "mp3";

function startPlayerProcess() {
  if (useWavPlayer) {
    return null;
    // use sox play for wav files
    // return spawn("play", [
    //   "-f",
    //   "S16_LE",
    //   "-c",
    //   "1",
    //   "-r",
    //   "24000",
    //   "-D",
    //   `hw:${soundCardIndex},0`,
    //   "-", // read from stdin
    // ]);
  } else {
    // use mpg123 for mp3 files
    return spawn("mpg123", [
      "-",
      "--scale",
      "2",
      "-o",
      "alsa",
      "-a",
      `hw:${soundCardIndex},0`,
    ]);
  }
}

let recordingProcessList: ChildProcess[] = [];
let currentRecordingReject: (reason?: any) => void = noop;

const killAllRecordingProcesses = (): void => {
  recordingProcessList.forEach((child) => {
    console.log("Killing recording process", child.pid);
    try {
      child.kill("SIGINT");
    } catch (e) {}
  });
  recordingProcessList.length = 0;
};

const recordAudio = (
  outputPath: string,
  duration: number = 10
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const cmd = `sox -t alsa default -t ${recordFileFormat} -c 1 -r 16000 ${outputPath} silence 1 0.1 60% 1 1.0 60%`;
    console.log(`Starting recording, maximum ${duration} seconds...`);
    const recordingProcess = exec(cmd, (err, stdout, stderr) => {
      currentRecordingReject = reject;
      if (err) {
        killAllRecordingProcesses();
        reject(stderr);
      } else {
        resolve(outputPath);
        killAllRecordingProcesses();
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
    const recordingProcess = spawn("sox", [
      "-t",
      "alsa",
      "default",
      "-t",
      recordFileFormat,
      "-c",
      "1",
      "-r",
      "16000",
      outputPath,
    ]);

    recordingProcess.on("error", (err) => {
      killAllRecordingProcesses();
      reject(err);
    });

    recordingProcess.stderr?.on("data", (data) => {
      console.error(data.toString());
    });
    recordingProcessList.push(recordingProcess);
    stopFunc = () => {
      killAllRecordingProcesses();
    };
    recordingProcess.on("exit", () => {
      resolve(outputPath);
    });
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
    console.log("No recording process running");
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
  player.process = startPlayerProcess();
}, 5000);

const playAudioData = (params: TTSResult): Promise<void> => {
  const { duration: audioDuration, filePath, base64, buffer } = params;
  if (audioDuration <= 0 || (!filePath && !base64 && !buffer)) {
    console.log("No audio data to play, skipping playback.");
    return Promise.resolve();
  }
  // play wav file using aplay
  if (filePath) {
    return Promise.race([
      new Promise<void>((resolve) => {
        setTimeout(() => {
          resolve();
        }, audioDuration + 1000);
      }),
      new Promise<void>((resolve, reject) => {
        console.log("Playback duration:", audioDuration);
        player.isPlaying = true;
        const process = spawn("play", [filePath]);
        process.on("close", (code: number) => {
          player.isPlaying = false;
          if (code !== 0) {
            console.error(`Audio playback error: ${code}`);
            reject(code);
          } else {
            console.log("Audio playback completed");
            resolve();
          }
        });
      }),
    ]).catch((error) => {
      console.error("Audio playback error:", error);
    });
  }

  // play mp3 buffer using mpg123
  return new Promise((resolve, reject) => {
    const audioBuffer = base64 ? Buffer.from(base64, "base64") : buffer;
    console.log("Playback duration:", audioDuration);
    player.isPlaying = true;
    setTimeout(() => {
      resolve();
      player.isPlaying = false;
      console.log("Audio playback completed");
    }, audioDuration); // Add 1 second buffer

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
    // Recreate process
    setTimeout(() => {
      player.process = startPlayerProcess();
    }, 500);
  } else {
    console.log("No audio currently playing");
  }
};

// Close audio player when exiting program
process.on("SIGINT", () => {
  try {
    if (player.process) {
      player.process.stdin?.end();
      player.process.kill();
    }
  } catch {}
  process.exit();
});

export {
  recordAudio,
  recordAudioManually,
  stopRecording,
  playAudioData,
  stopPlaying,
};
