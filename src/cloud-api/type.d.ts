declare module "mp3-duration" {
  function duration(buffer: Buffer): Promise<number>;
  export = duration;
}