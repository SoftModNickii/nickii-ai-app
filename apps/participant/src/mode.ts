// Which of CHAT · LINE · LIVE are open, and where the app should be after a line change.

import type { LineStatus, Mode } from '@nickii/shared';

export function availableModes(line: LineStatus | null): Record<Mode, boolean> {
  return {
    chat: line !== 'live',                       // during a direct transmission they answer inside LIVE
    line: line === 'invited' || line === 'waiting',
    live: line === 'live',
  };
}

/**
 * Mode after the line status changed (or at launch). Nickii's actions move the participant:
 * invited → LINE, transmission starts → LIVE, ends → CHAT. Otherwise keep what they chose if still open.
 */
export function modeAfterLineChange(current: Mode, previous: LineStatus | null, next: LineStatus | null): Mode {
  if (next === 'live') return 'live';
  if ((next === 'invited' || next === 'waiting') && previous !== 'invited' && previous !== 'waiting') return 'line';
  return availableModes(next)[current] ? current : 'chat';
}

/** Mode asked for in the address (?mode=line from an invitation notification), if it is open. */
export function requestedMode(search: string, line: LineStatus | null): Mode | null {
  const m = new URLSearchParams(search).get('mode');
  if (m !== 'chat' && m !== 'line' && m !== 'live') return null;
  return availableModes(line)[m] ? m : null;
}
