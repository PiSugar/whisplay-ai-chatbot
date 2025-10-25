import { exec, spawn, ChildProcess } from "child_process";
import { isEmpty, noop } from "lodash";
import { killAllProcesses } from "../utils";
import dotenv from "dotenv";
import { ttsServer, asrServer } from "../cloud-api/server";
import { ASRServer, TTSServer } from "../type";

dotenv.config();

const useWavPlayer = [TTSServer.gemini, TTSServer.piper].includes(ttsServer);
export const recordFileFormat = [ASRServer.vosk, ASRServer.whisper].includes(asrServer)
  ? "wav"
  : "mp3";

function startPlayerProcess() {
  if (useWavPlayer) {
    return spawn("aplay", [
      "-f",
      "S16_LE", // 16-bit PCM
      "-r",
      "24000", // rate
      "-c",
      "1", // channels
      "-", // read from stdin
    ]);
  } else {
    return spawn("mpg123", ["-", "--scale", "2", "-o", "alsa"]);
  }
}

let recordingProcessList: ChildProcess[] = [];
let currentRecordingReject: (reason?: any) => void = noop;

const killAllRecordingProcesses = (): void => {
  recordingProcessList.forEach((child) => {
    console.log("Killing recording process", child.pid);
    try {
      child.stdin?.end();
      killAllProcesses(child.pid!);
    } catch (e) {}
  });
  recordingProcessList.length = 0;
};

const recordAudio = (
  outputPath: string,
  duration: number = 10
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const cmd = `sox -t alsa default -t ${recordFileFormat} ${outputPath} silence 1 0.1 60% 1 1.0 60%`;
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
    const recordingProcess = exec(
      `sox -t alsa default -t ${recordFileFormat} ${outputPath}`,
      (err, stdout, stderr) => {
        if (err) {
          killAllRecordingProcesses();
          reject(stderr);
        }
      }
    );
    recordingProcessList.push(recordingProcess);
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

const playAudioData = (
  resAudioData: string,
  audioDuration: number
): Promise<void> => {
  if (isEmpty(resAudioData) || audioDuration <= 0) {
    console.log("No audio data to play, skipping playback.");
    return Promise.resolve();
  }
  const audioBuffer = Buffer.from(resAudioData, "base64");
  return new Promise((resolve, reject) => {
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
