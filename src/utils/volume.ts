
const minDb = -90; // minimum decibel value
const maxDb = 0; // maximum decibel value
const minValue = 0; // minimum linear value
const maxValue = 100; // maximum linear value

export function linearToDbPercent(value: number): number {
  const clamped = Math.max(minValue, Math.min(value, maxValue));
  const linearRatio = (clamped - minValue) / (maxValue - minValue);
  const dB = minDb + (maxDb - minDb) * linearRatio;

  // 映射 dB 到对数感知的百分比
  const dbPercent = ((dB - minDb) / (maxDb - minDb)) * 100;
  return Math.round(dbPercent);
}

export function dbPercentToLinear(dbPercent: number): number {
  const clampedPercent = Math.max(0, Math.min(dbPercent, 100));
  const dB = minDb + (maxDb - minDb) * (clampedPercent / 100);

  // 还原为线性音量值
  const linearRatio = (dB - minDb) / (maxDb - minDb);
  const linear = minValue + linearRatio * (maxValue - minValue);

  return Math.round(linear);
}
