// Makes Nickii's finished reply appear word by word, like streamed AI output.
// Timing varies slightly per word so it does not look mechanical.

export interface StreamOptions {
  baseMs?: number;    // average delay per word
  jitter?: number;    // 0..1, random variation
  random?: () => number;
}

export function splitForStreaming(text: string): string[] {
  // Keep spaces/newlines attached to the following word so joining restores the exact text.
  return text.match(/\s*\S+/g) ?? [];
}

export function wordDelays(words: string[], opts: StreamOptions = {}): number[] {
  const base = opts.baseMs ?? 55;
  const jitter = opts.jitter ?? 0.5;
  const rnd = opts.random ?? Math.random;
  return words.map((w) => {
    const punctuationPause = /[.!?…]$/.test(w) ? base * 2.5 : /[,;:]$/.test(w) ? base * 1.4 : 0;
    const variation = 1 + (rnd() * 2 - 1) * jitter;
    return Math.max(10, Math.round(base * variation + punctuationPause));
  });
}

/** Calls onUpdate with the growing text; resolves when done. Returns a cancel function via the signal. */
export async function streamText(
  text: string,
  onUpdate: (shown: string, done: boolean) => void,
  opts: StreamOptions & { signal?: AbortSignal } = {},
): Promise<void> {
  const words = splitForStreaming(text);
  const delays = wordDelays(words, opts);
  let shown = '';
  for (let i = 0; i < words.length; i++) {
    if (opts.signal?.aborted) break;
    await new Promise((r) => setTimeout(r, delays[i]));
    shown += words[i];
    onUpdate(shown, i === words.length - 1);
  }
  if (words.length === 0) onUpdate('', true);
}
