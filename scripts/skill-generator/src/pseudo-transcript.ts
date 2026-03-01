/**
 * Convert article text to pseudo-transcript format for the Mistral analyzer.
 * The analyzer expects [start-end] timestamped segments.
 */

export interface TranscriptSegment {
  text: string;
  start: number;
  end: number;
}

export interface SegmentCharMap {
  segmentIndex: number;
  startChar: number;
  endChar: number;
}

/**
 * Split text into sentences (simple heuristic: . ! ? followed by space or end).
 */
function splitIntoSentences(text: string): Array<{ text: string; startChar: number; endChar: number }> {
  const segments: Array<{ text: string; startChar: number; endChar: number }> = [];
  let pos = 0;
  let buf = "";
  let startChar = 0;

  const flush = () => {
    const s = buf.trim();
    if (s.length > 0) {
      segments.push({ text: s, startChar, endChar: startChar + s.length });
    }
    startChar = pos;
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    buf += c;
    if ((c === "." || c === "!" || c === "?") && (i + 1 >= text.length || /[\s\n]/.test(text[i + 1]!))) {
      pos = i + 1;
      flush();
      buf = "";
    }
  }
  if (buf.trim().length > 0) {
    pos = text.length;
    flush();
  }

  return segments;
}

/**
 * Convert article text to transcript segments with fake timestamps.
 * Returns segments and a mapping from segment index to char range.
 */
export function articleToTranscript(text: string): {
  segments: TranscriptSegment[];
  charMap: SegmentCharMap[];
} {
  const sentenceRanges = splitIntoSentences(text);
  const segments: TranscriptSegment[] = [];
  const charMap: SegmentCharMap[] = [];

  for (let i = 0; i < sentenceRanges.length; i++) {
    const { text: segText, startChar, endChar } = sentenceRanges[i]!;
    segments.push({
      text: segText,
      start: i,
      end: i + 1,
    });
    charMap.push({ segmentIndex: i, startChar, endChar });
  }

  return { segments, charMap };
}

/**
 * Format transcript for the analyzer (matches API format).
 */
export function formatTranscriptForAnalyzer(segments: TranscriptSegment[]): string {
  return segments
    .map((s) => `[${s.start.toFixed(1)}s-${s.end.toFixed(1)}s] ${s.text}`)
    .join("\n");
}

/**
 * Map a quote from the prediction to character positions in the text.
 * Uses substring search; returns null if not found.
 */
export function quoteToCharRange(text: string, quote: string): { startChar: number; endChar: number } | null {
  const normalizedQuote = quote.trim().replace(/\s+/g, " ");
  const normalizedText = text.replace(/\s+/g, " ");
  const idx = normalizedText.indexOf(normalizedQuote);
  if (idx === -1) {
    const idxOrig = text.indexOf(quote.trim());
    if (idxOrig !== -1) {
      return { startChar: idxOrig, endChar: idxOrig + quote.trim().length };
    }
    return null;
  }
  return { startChar: idx, endChar: idx + normalizedQuote.length };
}

/**
 * Check if two char ranges overlap.
 */
export function rangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number
): boolean {
  return aStart < bEnd && bStart < aEnd;
}
