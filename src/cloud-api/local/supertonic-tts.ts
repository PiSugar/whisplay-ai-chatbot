import * as fs from "fs";
import * as path from "path";
import { getAudioDurationInSeconds } from "get-audio-duration";
import dotenv from "dotenv";
import { ttsDir } from "../../utils/dir";
import { TTSResult } from "../../type";
import * as ort from "onnxruntime-node";

dotenv.config();

function replaceAllString(text: string, search: string, replacement: string) {
    return text.split(search).join(replacement);
}

const ttsServer = (process.env.TTS_SERVER || "").toLowerCase();
const supertonicAssetsDir =
  process.env.SUPERTONIC_ASSETS_DIR &&
  path.isAbsolute(process.env.SUPERTONIC_ASSETS_DIR)
    ? process.env.SUPERTONIC_ASSETS_DIR
    : path.resolve(
        process.cwd(),
        process.env.SUPERTONIC_ASSETS_DIR || "assets",
      );
const supertonicOnnxDir = path.join(supertonicAssetsDir, "onnx");
const supertonicVoiceStyle = process.env.SUPERTONIC_VOICE_STYLE || "M1";
const supertonicLanguage = process.env.SUPERTONIC_LANGUAGE || "en";
const supertonicTotalStep = parseInt(process.env.SUPERTONIC_TOTAL_STEP || "5");
const supertonicSpeed = parseFloat(process.env.SUPERTONIC_SPEED || "1.05");
const supertonicSilenceDuration = parseFloat(
  process.env.SUPERTONIC_SILENCE_DURATION || "0.3",
);

interface Config {
  ae: {
    sample_rate: number;
    base_chunk_size: number;
  };
  ttl: {
    chunk_compress_factor: number;
    latent_dim: number;
  };
}

interface Style {
  ttl: ort.Tensor;
  dp: ort.Tensor;
}

interface UnicodeProcessor {
  call: (
    textList: string[],
    langList: string[],
  ) => { textIds: number[][]; textMask: number[][][] };
}

const lengthToMask = (lengths: number[], maxLen?: number) => {
  const resolvedMaxLen = maxLen ?? Math.max(...lengths);
  const mask: number[][][] = [];
  for (let i = 0; i < lengths.length; i++) {
    const row: number[] = [];
    for (let j = 0; j < resolvedMaxLen; j++) {
      row.push(j < lengths[i] ? 1.0 : 0.0);
    }
    mask.push([row]);
  }
  return mask;
};

const getLatentMask = (
  wavLengths: number[],
  chunkSize: number,
  latentLen: number,
) => {
  const latentLengths = wavLengths.map((len) =>
    Math.floor((len + chunkSize - 1) / chunkSize),
  );
  return lengthToMask(latentLengths, latentLen);
};

class SupertonicTTS {
  private config: Config | null = null;
  private textProcessor: UnicodeProcessor | null = null;
  private dpSession: ort.InferenceSession | null = null;
  private textEncSession: ort.InferenceSession | null = null;
  private vectorEstSession: ort.InferenceSession | null = null;
  private vocoderSession: ort.InferenceSession | null = null;
  private style: Style | null = null;
  private sampleRate: number = 24000;
  private initialized: boolean = false;
  private initializePromise: Promise<void> | null = null;
  private initializePromiseResolve: () => void = () => {};

  async initialize() {
    if (this.initialized) return;
    if (this.initializePromise) {
      return this.initializePromise;
    }
    this.initializePromiseResolve = () => {};
    this.initializePromise = new Promise<void>((resolve) => {
      this.initializePromiseResolve = resolve;
    });

    try {
      console.log("Initializing Supertonic TTS...");

      const configPath = path.join(supertonicOnnxDir, "tts.json");
      if (!fs.existsSync(configPath)) {
        throw new Error(
          `Config file not found at ${configPath}. Please download Supertonic models first.`,
        );
      }
      this.config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      this.sampleRate = this.config!.ae.sample_rate;

      await this.loadTextProcessor();

      console.log("Loading ONNX models...");
      this.dpSession = await ort.InferenceSession.create(
        path.join(supertonicOnnxDir, "duration_predictor.onnx"),
      );
      this.textEncSession = await ort.InferenceSession.create(
        path.join(supertonicOnnxDir, "text_encoder.onnx"),
      );
      this.vectorEstSession = await ort.InferenceSession.create(
        path.join(supertonicOnnxDir, "vector_estimator.onnx"),
      );
      this.vocoderSession = await ort.InferenceSession.create(
        path.join(supertonicOnnxDir, "vocoder.onnx"),
      );

      await this.loadVoiceStyle(supertonicVoiceStyle);

      this.initialized = true;
      console.log(
        `Supertonic TTS initialized successfully with voice ${supertonicVoiceStyle}`,
      );
    } catch (error) {
      console.error("Failed to initialize Supertonic TTS:", error);
      throw error;
    } finally {
      this.initializePromiseResolve();
      this.initializePromise = null;
    }
  }

  private async loadTextProcessor() {
    const unicodeIndexerPath = path.join(
      supertonicOnnxDir,
      "unicode_indexer.json",
    );
    if (!fs.existsSync(unicodeIndexerPath)) {
      throw new Error(`Unicode indexer file not found at ${unicodeIndexerPath}`);
    }

    const unicodeIndexer = JSON.parse(
      fs.readFileSync(unicodeIndexerPath, "utf-8"),
    );

    const normalizeText = (text: string, lang: string) => {
      let normalized = text.normalize("NFKD");

      const emojiPattern =
        /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu;
      normalized = normalized.replace(emojiPattern, "");

      const replacements: Record<string, string> = {
        "–": "-",
        "‑": "-",
        "—": "-",
        "_": " ",
        "\u201C": '"',
        "\u201D": '"',
        "\u2018": "'",
        "\u2019": "'",
        "´": "'",
        "`": "'",
        "[": " ",
        "]": " ",
        "|": " ",
        "/": " ",
        "#": " ",
        "→": " ",
        "←": " ",
      };
      for (const [key, value] of Object.entries(replacements)) {
        normalized = replaceAllString(normalized, key, value);
      }

      normalized = normalized.replace(/[♥☆♡©\\]/g, "");

      const exprReplacements: Record<string, string> = {
        "@": " at ",
        "e.g.,": "for example, ",
        "i.e.,": "that is, ",
      };
      for (const [key, value] of Object.entries(exprReplacements)) {
        normalized = replaceAllString(normalized, key, value);
      }

      normalized = normalized
        .replace(/ ,/g, ",")
        .replace(/ \./g, ".")
        .replace(/ !/g, "!")
        .replace(/ \?/g, "?")
        .replace(/ ;/g, ";")
        .replace(/ :/g, ":")
        .replace(/ '/g, "'");

      while (normalized.includes('""')) {
        normalized = normalized.replace('""', '"');
      }
      while (normalized.includes("''")) {
        normalized = normalized.replace("''", "'");
      }
      while (normalized.includes("``")) {
        normalized = normalized.replace("``", "`");
      }

      normalized = normalized.replace(/\s+/g, " ").trim();

      if (!/[.!?;:,'\"')\]}…。」』】〉》›»]$/.test(normalized)) {
        normalized += ".";
      }

      return `<${lang}>${normalized}</${lang}>`;
    };

    const textToUnicodeValues = (text: string) =>
      Array.from(text).map((char) => char.charCodeAt(0));

    this.textProcessor = {
      call: (textList: string[], langList: string[]) => {
        const processed = textList.map((text, idx) =>
          normalizeText(text, langList[idx]),
        );
        const lengths = processed.map((text) => text.length);
        const maxLen = Math.max(...lengths);

        const textIds: number[][] = [];
        for (let i = 0; i < processed.length; i++) {
          const row = new Array(maxLen).fill(0);
          const unicodeVals = textToUnicodeValues(processed[i]);
          for (let j = 0; j < unicodeVals.length; j++) {
            row[j] = unicodeIndexer[unicodeVals[j]] ?? 0;
          }
          textIds.push(row);
        }

        const textMask = lengthToMask(lengths, maxLen);
        return { textIds, textMask };
      },
    };
  }

  private async loadVoiceStyle(voiceStyleName: string) {
    const voiceStylePath = path.join(
      supertonicAssetsDir,
      "voice_styles",
      `${voiceStyleName}.json`,
    );
    if (!fs.existsSync(voiceStylePath)) {
      throw new Error(`Voice style file not found at ${voiceStylePath}`);
    }

    const styleData = JSON.parse(fs.readFileSync(voiceStylePath, "utf-8"));
    const ttlDims = styleData.style_ttl.dims as number[];
    const dpDims = styleData.style_dp.dims as number[];
    const ttlData = styleData.style_ttl.data.flat(Infinity) as number[];
    const dpData = styleData.style_dp.data.flat(Infinity) as number[];

    this.style = {
      ttl: new ort.Tensor("float32", Float32Array.from(ttlData), ttlDims),
      dp: new ort.Tensor("float32", Float32Array.from(dpData), dpDims),
    };
  }

  private chunkText(text: string, maxLen: number = 300): string[] {
    if (text.length <= maxLen) {
      return [text];
    }

    const chunks: string[] = [];
    const paragraphs = text.split(/\n+/);

    for (const paragraph of paragraphs) {
      if (paragraph.length <= maxLen) {
        chunks.push(paragraph);
        continue;
      }

      const sentences = paragraph.match(/[^.!?]+[.!?]+/g) || [paragraph];
      let currentChunk = "";

      for (const sentence of sentences) {
        if ((currentChunk + sentence).length <= maxLen) {
          currentChunk += sentence;
        } else {
          if (currentChunk) chunks.push(currentChunk.trim());
          currentChunk = sentence;
        }
      }
      if (currentChunk) chunks.push(currentChunk.trim());
    }

    return chunks.filter((c) => c.length > 0);
  }

  private async synthesizeChunk(
    text: string,
    lang: string,
  ): Promise<{ wav: Float32Array; duration: number }> {
    if (
      !this.initialized ||
      !this.textProcessor ||
      !this.config ||
      !this.style
    ) {
      throw new Error("Supertonic TTS not initialized");
    }

    const { textIds, textMask } = this.textProcessor.call([text], [lang]);
    const textIdsTensor = new ort.Tensor(
      "int64",
      BigInt64Array.from(textIds.flat().map((value) => BigInt(value))),
      [1, textIds[0].length],
    );
    const textMaskTensor = new ort.Tensor(
      "float32",
      Float32Array.from(textMask.flat(2)),
      [1, 1, textMask[0][0].length],
    );

    const dpResults = await this.dpSession!.run({
      text_ids: textIdsTensor,
      style_dp: this.style.dp,
      text_mask: textMaskTensor,
    });
    const duration = dpResults.duration as ort.Tensor;
    const durationData = duration.data as Float32Array;
    const adjustedDuration = Float32Array.from(durationData, (value) =>
      value / supertonicSpeed,
    );

    const textEncResults = await this.textEncSession!.run({
      text_ids: textIdsTensor,
      style_ttl: this.style.ttl,
      text_mask: textMaskTensor,
    });
    const textEmb = textEncResults.text_emb as ort.Tensor;

    const wavLengths = Array.from(adjustedDuration).map((value) =>
      Math.floor(value * this.sampleRate),
    );
    const wavLenMax = Math.max(...wavLengths);
    const chunkSize =
      this.config.ae.base_chunk_size * this.config.ttl.chunk_compress_factor;
    const latentLen = Math.floor((wavLenMax + chunkSize - 1) / chunkSize);
    const latentDim =
      this.config.ttl.latent_dim * this.config.ttl.chunk_compress_factor;

    const noisyLatent = new Float32Array(latentDim * latentLen);
    for (let d = 0; d < latentDim; d++) {
      for (let t = 0; t < latentLen; t++) {
        const eps = 1e-10;
        const u1 = Math.max(eps, Math.random());
        const u2 = Math.random();
        const randNormal =
          Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
        noisyLatent[d * latentLen + t] = randNormal;
      }
    }

    const latentMask = getLatentMask(wavLengths, chunkSize, latentLen);
    for (let t = 0; t < latentLen; t++) {
      const maskValue = latentMask[0][0][t];
      for (let d = 0; d < latentDim; d++) {
        noisyLatent[d * latentLen + t] *= maskValue;
      }
    }

    let noisyLatentTensor = new ort.Tensor(
      "float32",
      noisyLatent,
      [1, latentDim, latentLen],
    );
    const latentMaskTensor = new ort.Tensor(
      "float32",
      Float32Array.from(latentMask.flat(2)),
      [1, 1, latentLen],
    );
    const totalStepTensor = new ort.Tensor(
      "float32",
      Float32Array.from([supertonicTotalStep]),
      [1],
    );

    for (let step = 0; step < supertonicTotalStep; step++) {
      const currentStepTensor = new ort.Tensor(
        "float32",
        Float32Array.from([step]),
        [1],
      );
      const vectorEstResults = await this.vectorEstSession!.run({
        noisy_latent: noisyLatentTensor,
        text_emb: textEmb,
        style_ttl: this.style.ttl,
        text_mask: textMaskTensor,
        latent_mask: latentMaskTensor,
        total_step: totalStepTensor,
        current_step: currentStepTensor,
      });
      const denoisedLatent = vectorEstResults.denoised_latent as ort.Tensor;
      noisyLatentTensor = new ort.Tensor(
        "float32",
        denoisedLatent.data as Float32Array,
        [1, latentDim, latentLen],
      );
    }

    const vocoderResults = await this.vocoderSession!.run({
      latent: noisyLatentTensor,
    });
    const wav = vocoderResults.wav_tts as ort.Tensor;
    const totalDuration = Array.from(adjustedDuration).reduce(
      (sum, value) => sum + value,
      0,
    );

    return {
      wav: wav.data as Float32Array,
      duration: totalDuration,
    };
  }

  async synthesize(
    text: string,
  ): Promise<{ audioPath: string; duration: number }> {
    await this.initialize();

    const maxLen = supertonicLanguage === "ko" ? 120 : 300;
    const chunks = this.chunkText(text, maxLen);

    let concatenatedWav: Float32Array = new Float32Array(0);
    let totalDuration = 0;

    console.log(`Synthesizing ${chunks.length} chunk(s)...`);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      console.log(
        `Processing chunk ${i + 1}/${chunks.length}: "${chunk.substring(0, 50)}..."`,
      );

      const result = await this.synthesizeChunk(chunk, supertonicLanguage);

      if (i > 0 && supertonicSilenceDuration > 0) {
        const silenceSamples = Math.floor(
          supertonicSilenceDuration * this.sampleRate,
        );
        const silence = new Float32Array(silenceSamples);
        concatenatedWav = new Float32Array([
          ...concatenatedWav,
          ...silence,
          ...result.wav,
        ]);
        totalDuration += supertonicSilenceDuration;
      } else {
        concatenatedWav = new Float32Array([...concatenatedWav, ...result.wav]);
      }

      totalDuration += result.duration;
    }

    const now = Date.now();
    const outputPath = path.join(ttsDir, `supertonic_${now}.wav`);
    this.writeWavFile(outputPath, concatenatedWav, this.sampleRate);

    const actualDuration = await getAudioDurationInSeconds(outputPath);

    console.log(
      `Supertonic TTS completed: ${outputPath} (${actualDuration.toFixed(2)}s)`,
    );

    return { audioPath: outputPath, duration: actualDuration };
  }

  private writeWavFile(
    filePath: string,
    audioData: Float32Array,
    sampleRate: number,
  ) {
    const int16Data = new Int16Array(audioData.length);
    for (let i = 0; i < audioData.length; i++) {
      const s = Math.max(-1, Math.min(1, audioData[i]));
      int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }

    const buffer = Buffer.alloc(44 + int16Data.length * 2);

    buffer.write("RIFF", 0);
    buffer.writeUInt32LE(36 + int16Data.length * 2, 4);
    buffer.write("WAVE", 8);

    buffer.write("fmt ", 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);

    buffer.write("data", 36);
    buffer.writeUInt32LE(int16Data.length * 2, 40);

    for (let i = 0; i < int16Data.length; i++) {
      buffer.writeInt16LE(int16Data[i], 44 + i * 2);
    }

    fs.writeFileSync(filePath, buffer);
  }
}

let supertonicInstance: SupertonicTTS | null = null;

if (ttsServer === "supertonic") {
  supertonicInstance = new SupertonicTTS();
  supertonicInstance.initialize().catch((err) => {
    console.error("Error initializing Supertonic TTS:", err.message);
  });
}

const supertonicTTS = async (text: string): Promise<TTSResult> => {
  try {
    if (!supertonicInstance) {
      supertonicInstance = new SupertonicTTS();
    }
    const result = await supertonicInstance.synthesize(text);
    return { filePath: result.audioPath, duration: result.duration * 1000 };
  } catch (error) {
    console.error("Supertonic TTS error:", error);
    return { duration: 0 };
  }
};

export default supertonicTTS;
