export function chunkText(
  text: string,
  maxSize = 600,
  overlap = 100
): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  const sentences = splitSentences(clean);

  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if ((current + " " + sentence).length <= maxSize) {
      current += (current ? " " : "") + sentence;
    } else {
      chunks.push(current.trim());
      current = sentence;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  // overlap 处理
  if (overlap > 0 && chunks.length > 1) {
    return applyOverlap(chunks, overlap);
  }

  return chunks;
}

/**
 * 简单句子分割（中英文兼容）
 */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？.!?])/)
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * 添加重叠上下文
 */
function applyOverlap(chunks: string[], overlap: number): string[] {
  const result: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    if (i === 0) {
      result.push(chunks[i]);
    } else {
      const prev = chunks[i - 1];
      const overlapText = prev.slice(-overlap);
      result.push(overlapText + " " + chunks[i]);
    }
  }

  return result;
}
