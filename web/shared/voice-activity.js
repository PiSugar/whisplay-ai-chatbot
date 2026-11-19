(function () {
  // Listen for the end of speech without changing the audio sent by MediaRecorder.
  window.watchForSpeechEnd = function (stream, settings, onEnd) {
    if (!settings) return () => {};
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return () => {};

    let context;
    let source;
    let analyser;
    try {
      context = new AudioContext();
      source = context.createMediaStreamSource(stream);
      analyser = context.createAnalyser();
      source.connect(analyser);
    } catch {
      if (context) void context.close().catch(() => {});
      return () => {};
    }
    const samples = new Float32Array(analyser.fftSize);
    let speechFrames = 0;
    let lastSpeech;
    let noiseFloor = 0;
    const interval = setInterval(() => {
      if (context.state !== "running") return;
      analyser.getFloatTimeDomainData(samples);
      const level = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
      const now = performance.now();
      if (lastSpeech === undefined) {
        if (level < 0.02) noiseFloor = 0.8 * noiseFloor + 0.2 * level;
        speechFrames = level >= 0.02 ? speechFrames + 1 : 0;
        if (speechFrames >= 2) lastSpeech = now;
      } else if (level >= Math.max(noiseFloor + 0.003, 0.02 * settings.endLevelRatio)) {
        lastSpeech = now;
      } else if (now - lastSpeech >= settings.silenceMs) {
        clearInterval(interval);
        onEnd();
      }
    }, 50);
    void context.resume().catch(() => {});
    return () => {
      clearInterval(interval);
      source.disconnect();
      void context.close().catch(() => {});
    };
  };
})();
