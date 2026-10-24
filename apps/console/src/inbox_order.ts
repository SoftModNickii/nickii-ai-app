// Inbox order: whoever has waited longest for an answer comes first. Then everyone else,
// most recent activity first.

import type { InboxRow } from '@nickii/shared';

export function sortInbox(rows: InboxRow[]): InboxRow[] {
  return [...rows].sort((a, b) => {
    const aw = a.waiting_since_t_ms, bw = b.waiting_since_t_ms;
    if (aw !== null && bw !== null) return aw - bw;
    if (aw !== null) return -1;
    if (bw !== null) return 1;
    const al = Math.max(a.last_in_t_ms ?? 0, a.last_out_t_ms ?? 0);
    const bl = Math.max(b.last_in_t_ms ?? 0, b.last_out_t_ms ?? 0);
    return bl - al;
  });
}

/** "45 s", "12 min", "3 h 05" — how long someone has been waiting. */
export function formatWait(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const hours = Math.floor(m / 60);
  return `${hours} h ${String(m % 60).padStart(2, '0')}`;
}

export function waitingCount(rows: InboxRow[]): number {
  return rows.filter((r) => r.waiting_since_t_ms !== null).length;
}
