export const VOICE_PCM_SAMPLE_RATE = 16_000;

export function pcm16WavHeader(byteLength: number, sampleRate: number, channels: number): Buffer {
  const header = Buffer.alloc(44);
  const frameSize = channels * 2;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + byteLength, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * frameSize, 28);
  header.writeUInt16LE(frameSize, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(byteLength, 40);
  return header;
}
