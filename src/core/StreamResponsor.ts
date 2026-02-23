import { purifyTextForTTS, splitSentences } from "../utils";
import dotenv from "dotenv";
import { playAudioData, stopPlaying } from "../device/audio";
import { TTSResult } from "../type";

dotenv.config();

type TTSFunc = (text: string) => Promise<TTSResult>;
type SentencesCallback = (sentences: string[]) => void;
type TextCallback = (text: string) => void;
type SentencePlayCallback = (payload: {
  charEnd: number;
  durationMs: number;
  sentenceIndex: number;
  sentence: string;
}) => void;

export class StreamResponser {
  private ttsFunc: TTSFunc;
  private sentencesCallback?: SentencesCallback;
  private textCallback?: TextCallback;
  private sentencePlayCallback?: SentencePlayCallback;
  private partialContent: string = "";
  private playEndResolve: () => void = () => {};
  private speakQueue: {
    sentenceIndex: number;
    sentence: string;
    ttsPromise: Promise<TTSResult>;
  }[] = [];
  private parsedSentences: string[] = [];
  private displaySentences: string[] = [];
  private isPlaying: boolean = false;
  private ttsChain: Promise<void> = Promise.resolve();

  constructor(
    ttsFunc: TTSFunc,
    sentencesCallback?: SentencesCallback,
    textCallback?: TextCallback,
    sentencePlayCallback?: SentencePlayCallback
  ) {
    this.ttsFunc = async (text) => {
      console.time("[TTS time]");
      const result = await ttsFunc(text);
      console.timeEnd("[TTS time]");
      return result;
    };
    this.sentencesCallback = sentencesCallback;
    this.textCallback = textCallback;
    this.sentencePlayCallback = sentencePlayCallback;
  }

  private getCharEndForSentence(sentenceIndex: number): number {
    if (sentenceIndex < 0 || sentenceIndex >= this.displaySentences.length) {
      return 0;
    }
    return this.displaySentences.slice(0, sentenceIndex + 1).join(" ").length;
  }

  private playAudioInOrder = async (): Promise<void> => {
    // Prevent multiple concurrent calls
    if (this.isPlaying) {
      console.log(
        "Audio playback already in progress, skipping duplicate call"
      );
      return;
    }
    let currentIndex = 0;
    const playNext = async () => {
      if (currentIndex < this.speakQueue.length) {
        this.isPlaying = true;
        try {
          const item = this.speakQueue[currentIndex];
          const playParams = await item.ttsPromise;
          console.log(
            `Playing audio ${currentIndex + 1}/${this.speakQueue.length}`
          );
          this.sentencePlayCallback?.({
            charEnd: this.getCharEndForSentence(item.sentenceIndex),
            durationMs: playParams.duration,
            sentenceIndex: item.sentenceIndex,
            sentence: item.sentence,
          });
          await playAudioData(playParams);
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
          `Play all audio completed. Total: ${this.speakQueue.length}`
        );
        this.isPlaying = false;
        this.playEndResolve();
        this.speakQueue.length = 0;
        this.speakQueue = [];
        this.displaySentences.length = 0;
      }
    };
    playNext();
  };

  private enqueueTTS = (text: string): Promise<TTSResult> => {
    const task = this.ttsChain.then(() => this.ttsFunc(text));
    this.ttsChain = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  };

  partial = (text: string): void => {
    this.partialContent += text;
    // replace newlines with spaces
    this.partialContent = this.partialContent.replace(/\n/g, " ");
    const { sentences, remaining } = splitSentences(this.partialContent);
    if (sentences.length > 0) {
      this.parsedSentences.push(...sentences);
      const startIndex = this.displaySentences.length;
      this.displaySentences.push(...sentences);
      this.sentencesCallback?.(this.displaySentences);
      // remove emoji
      const length = this.speakQueue.length;
      const queueItems: {
        sentenceIndex: number;
        sentence: string;
        ttsPromise: Promise<TTSResult>;
      }[] = [];
      sentences.forEach((sentence, index) => {
        const purified = purifyTextForTTS(sentence);
        if (!purified) {
          return;
        }
        const ttsPromise = this.enqueueTTS(purified);
        queueItems.push({
          sentenceIndex: startIndex + index,
          sentence,
          ttsPromise,
        });
      });
      if (queueItems.length > 0) {
        this.speakQueue.push(...queueItems);
        if (length === 0 && !this.isPlaying) {
          this.playAudioInOrder();
        }
      }
    }
    this.partialContent = remaining;
  };

  endPartial = (): void => {
    if (this.partialContent) {
      this.parsedSentences.push(this.partialContent);
      this.displaySentences.push(this.partialContent);
      this.sentencesCallback?.(this.displaySentences);
      // remove emoji
      this.partialContent = this.partialContent.replace(
        /[\u{1F600}-\u{1F64F}]/gu,
        ""
      );
      if (this.partialContent.trim() !== "") {
        const text = purifyTextForTTS(this.partialContent);
        const length = this.speakQueue.length;
        this.speakQueue.push({
          sentenceIndex: this.displaySentences.length - 1,
          sentence: this.displaySentences[this.displaySentences.length - 1],
          ttsPromise: this.enqueueTTS(text),
        });
        if (length === 0 && !this.isPlaying) {
          this.playAudioInOrder();
        }
      }
      this.partialContent = "";
    }
    this.textCallback?.(this.displaySentences.join(" "));
    this.parsedSentences.length = 0;
  };

  getPlayEndPromise = (): Promise<void> => {
    return new Promise((resolve) => {
      this.playEndResolve = resolve;
    });
  };

  stop = (): void => {
    this.speakQueue = [];
    this.speakQueue.length = 0;
    this.partialContent = "";
    this.parsedSentences.length = 0;
    this.displaySentences.length = 0;
    this.isPlaying = false;
    this.ttsChain = Promise.resolve();
    this.playEndResolve();
    stopPlaying();
  };
}
