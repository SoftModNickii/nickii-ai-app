// Decides the one status word and one sentence participants see (CLAUDE.md: few orientation elements).

import type { LineStatus, Mode, OperatorState } from '@nickii/shared';
import { SENTENCES, STATUS_WORDS } from './copy';

export interface StatusInput {
  mode: Mode;
  operatorState: OperatorState;
  /** Nickii can override the word shown while live (operator_status.status_word). */
  operatorWord: string | null;
  /** Last message in the thread is the participant's: they are waiting for an answer. */
  awaitingReply: boolean;
  lineStatus: LineStatus | null;
  online: boolean;
}

export interface StatusLine {
  word: string;
  sentence: keyof typeof SENTENCES;
}

export function statusLine(i: StatusInput): StatusLine {
  if (!i.online) return { word: STATUS_WORDS.offline, sentence: 'offline' };
  if (i.mode === 'live' || i.lineStatus === 'live') return { word: STATUS_WORDS.transmission, sentence: 'liveNow' };
  if (i.mode === 'line') return { word: STATUS_WORDS.waiting, sentence: 'lineWaiting' };
  if (i.awaitingReply) {
    return { word: STATUS_WORDS.thinking, sentence: i.operatorState === 'away' ? 'chatAway' : 'chatThinking' };
  }
  const word = i.operatorState === 'live' && i.operatorWord ? i.operatorWord : STATUS_WORDS.listening;
  return { word, sentence: 'chatIdle' };
}
