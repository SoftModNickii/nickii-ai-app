#!/usr/bin/env python3
"""Builds the Nickii AI dataset from raw table dumps and face chunks (docs/dataset.md).

Input (dataset/raw is git-ignored):
  <tables>/participants.csv, messages.csv, operator_events.csv, participant_events.csv,
           clock_sync.csv, line_entries.csv      (made by dump_tables.sh)
  <face>/**/face_*.csv.gz                       (Storage bucket face_chunks, or the Mac's folder)

Output:
  nickii_ai_dataset_<first>_<last>/
    README.md
    participants.parquet, messages.parquet, operator_events.parquet,
    participant_events.parquet, line_entries.parquet
    face/face_<day>.parquet                one file per UTC day
    face_context/face_context_<day>.parquet face frames + what was happening at that moment
    clock_sync.csv
    samples/*.csv                           first rows of each table for a quick look

Privacy: participant ids are replaced by pseudonyms; push subscriptions and device info are not
exported; participants listed in --exclude (pseudonyms, one per line) are removed everywhere.

Usage:
  python3 dataset/export_scripts/export_dataset.py --tables dataset/raw/tables --face dataset/raw/face \
      --out dataset/output [--exclude dataset/raw/deletion_requests.txt]
"""

from __future__ import annotations

import argparse
import gzip
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

# Must match packages/shared/src/blendshapes.ts (the test checks this).
BLENDSHAPE_NAMES = [
    "_neutral",
    "browDownLeft", "browDownRight", "browInnerUp", "browOuterUpLeft", "browOuterUpRight",
    "cheekPuff", "cheekSquintLeft", "cheekSquintRight",
    "eyeBlinkLeft", "eyeBlinkRight",
    "eyeLookDownLeft", "eyeLookDownRight", "eyeLookInLeft", "eyeLookInRight",
    "eyeLookOutLeft", "eyeLookOutRight", "eyeLookUpLeft", "eyeLookUpRight",
    "eyeSquintLeft", "eyeSquintRight", "eyeWideLeft", "eyeWideRight",
    "jawForward", "jawLeft", "jawOpen", "jawRight",
    "mouthClose", "mouthDimpleLeft", "mouthDimpleRight", "mouthFrownLeft", "mouthFrownRight",
    "mouthFunnel", "mouthLeft", "mouthLowerDownLeft", "mouthLowerDownRight",
    "mouthPressLeft", "mouthPressRight", "mouthPucker", "mouthRight",
    "mouthRollLower", "mouthRollUpper", "mouthShrugLower", "mouthShrugUpper",
    "mouthSmileLeft", "mouthSmileRight", "mouthStretchLeft", "mouthStretchRight",
    "mouthUpperUpLeft", "mouthUpperUpRight",
    "noseSneerLeft", "noseSneerRight",
]
MATRIX_COLUMNS = [f"m{i // 4}{i % 4}" for i in range(16)]
FACE_COLUMNS = ["t_ms", "face_present", *BLENDSHAPE_NAMES, *MATRIX_COLUMNS, "fps_measured"]
SAMPLE_ROWS = 200


def utc_iso(t_ms: pd.Series) -> pd.Series:
    """2026-10-09T23:59:01.000Z"""
    return pd.to_datetime(t_ms, unit="ms", utc=True).dt.strftime("%Y-%m-%dT%H:%M:%S.%f").str[:-3] + "Z"


def read_table(tables: Path, name: str) -> pd.DataFrame:
    path = tables / f"{name}.csv"
    if not path.exists():
        raise SystemExit(f"Missing {path}. Run dataset/export_scripts/dump_tables.sh first.")
    return pd.read_csv(path, dtype=str, keep_default_na=False, na_values=[""])


def to_int(s: pd.Series) -> pd.Series:
    return pd.to_numeric(s, errors="coerce").astype("Int64")


# ---------------------------------------------------------------- tables


def pseudonymise(df: pd.DataFrame, column: str, pseudonyms: dict[str, str], excluded: set[str],
                 keep_missing: bool) -> pd.DataFrame:
    """Replaces a participant id column with `pseudonym`; drops excluded participants' rows."""
    ids = df[column]
    pseudo = ids.map(pseudonyms)
    drop = pseudo.isin(excluded) | (ids.notna() & pseudo.isna())  # unknown ids: drop, never leak
    if not keep_missing:
        drop |= ids.isna()
    out = df.loc[~drop].drop(columns=[column])
    out.insert(0, "pseudonym", pseudo[~drop])
    return out


def build_tables(tables: Path, excluded: set[str]) -> dict[str, pd.DataFrame]:
    participants = read_table(tables, "participants")
    pseudonyms = dict(zip(participants["id"], participants["pseudonym"]))

    p = participants[~participants["pseudonym"].isin(excluded)]
    out: dict[str, pd.DataFrame] = {
        # platform (device type) is operational only and dropped (docs/dataset.md).
        "participants": p[["pseudonym", "agreed_at", "agreement_version", "created_at"]].reset_index(drop=True),
    }

    m = read_table(tables, "messages")
    m = pseudonymise(m, "participant_id", pseudonyms, excluded, keep_missing=False)
    m["t_ms"] = to_int(m["t_ms"])
    m = m.sort_values("t_ms")
    m["time_utc"] = utc_iso(m["t_ms"])
    out["messages"] = m[["t_ms", "time_utc", "pseudonym", "sender", "input_method", "body"]].reset_index(drop=True)

    for name, keep_missing in (("operator_events", True), ("participant_events", False)):
        e = read_table(tables, name)
        e = pseudonymise(e, "participant_id", pseudonyms, excluded, keep_missing=keep_missing)
        e["t_ms"] = to_int(e["t_ms"])
        e["received_t_ms"] = to_int(e["received_t_ms"])
        e = e.sort_values("t_ms")
        e["time_utc"] = utc_iso(e["t_ms"])
        out[name] = e[["t_ms", "time_utc", "name", "pseudonym", "data", "received_t_ms"]].reset_index(drop=True)

    line = read_table(tables, "line_entries")
    line = pseudonymise(line, "participant_id", pseudonyms, excluded, keep_missing=False)
    for c in ("invited_t_ms", "arrived_t_ms", "started_t_ms", "ended_t_ms"):
        line[c] = to_int(line[c])
    out["line_entries"] = line[["pseudonym", "status", "invited_t_ms", "arrived_t_ms", "started_t_ms", "ended_t_ms"]] \
        .sort_values("invited_t_ms").reset_index(drop=True)
    return out


# ---------------------------------------------------------------- face


def read_face_chunks(face_dir: Path) -> pd.DataFrame:
    files = sorted(face_dir.rglob("face_*.csv.gz"))
    if not files:
        return pd.DataFrame(columns=FACE_COLUMNS)
    frames = []
    for f in files:
        with gzip.open(f, "rt") as fh:
            df = pd.read_csv(fh)
        missing = [c for c in FACE_COLUMNS if c not in df.columns]
        if missing:
            raise SystemExit(f"{f}: unexpected columns, missing {missing[:3]}…")
        frames.append(df[FACE_COLUMNS])
    face = pd.concat(frames, ignore_index=True)
    # A chunk can be uploaded twice (recovered after a crash): keep one row per timestamp.
    face = face.drop_duplicates(subset="t_ms").sort_values("t_ms").reset_index(drop=True)
    face["t_ms"] = face["t_ms"].astype("int64")
    face["face_present"] = face["face_present"].astype("int8")
    for c in FACE_COLUMNS[2:]:
        face[c] = face[c].astype("float32")
    return face


def intervals_from_events(events: pd.DataFrame, start: set[str], end: set[str]) -> list[tuple[int, int, str | None]]:
    """Pairs start/end events into (start_t, end_t, pseudonym) intervals. Open intervals run to the end."""
    out: list[tuple[int, int, str | None]] = []
    open_at: int | None = None
    who: str | None = None
    for row in events.itertuples(index=False):
        if row.name in start:
            if open_at is not None:
                out.append((open_at, int(row.t_ms), who))
            open_at, who = int(row.t_ms), (row.pseudonym if isinstance(row.pseudonym, str) else None)
        elif row.name in end and open_at is not None:
            out.append((open_at, int(row.t_ms), who))
            open_at, who = None, None
    if open_at is not None:
        out.append((open_at, np.iinfo(np.int64).max, who))
    return out


def label_intervals(t: np.ndarray, intervals: list[tuple[int, int, str | None]]) -> tuple[np.ndarray, np.ndarray]:
    """For each time: inside any interval? and the pseudonym of that interval."""
    inside = np.zeros(len(t), dtype=bool)
    who = np.full(len(t), None, dtype=object)
    for a, b, p in intervals:
        lo, hi = np.searchsorted(t, a, "left"), np.searchsorted(t, b, "left")
        inside[lo:hi] = True
        who[lo:hi] = p
    return inside, who


def last_before(t: np.ndarray, times: np.ndarray, values: np.ndarray | None = None):
    """For each t: the latest event time <= t (NA if none) and that event's value."""
    idx = np.searchsorted(times, t, "right") - 1
    ok = idx >= 0
    picked = np.zeros(len(t), dtype="int64")
    if len(times):
        picked[ok] = times[idx[ok]]
    last_t = pd.arrays.IntegerArray(picked, mask=~ok)
    vals = None
    if values is not None:
        vals = np.full(len(t), None, dtype=object)
        if len(times):
            vals[ok] = values[idx[ok]]
    return last_t, vals


def face_context(face: pd.DataFrame, tables: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Face frames joined with what was happening (docs/dataset.md "Context labels")."""
    t = face["t_ms"].to_numpy()
    ops = tables["operator_events"]

    state_ev = ops[ops["name"].isin(["state_live", "state_away"])]
    st_t, st_v = last_before(t, state_ev["t_ms"].to_numpy(dtype="int64"), state_ev["name"].to_numpy())
    operator_state = np.where(st_v == "state_live", "live", "away").astype(object)
    operator_state[np.asarray(st_t.isna())] = "unknown"

    tx = intervals_from_events(ops, {"transmission_start"}, {"transmission_end"})
    in_tx, tx_who = label_intervals(t, tx)
    threads = intervals_from_events(ops, {"thread_opened"}, {"thread_closed"})
    _, open_thread = label_intervals(t, threads)
    typing_iv = intervals_from_events(ops, {"compose_start"}, {"compose_send", "thread_closed"})
    typing, _ = label_intervals(t, typing_iv)

    line = tables["line_entries"]
    waiting = np.zeros(len(t), dtype="int32")
    for row in line.itertuples(index=False):
        if pd.isna(row.invited_t_ms):
            continue
        end = row.started_t_ms if not pd.isna(row.started_t_ms) else row.ended_t_ms
        end = int(end) if not pd.isna(end) else np.iinfo(np.int64).max
        waiting[np.searchsorted(t, int(row.invited_t_ms), "left"):np.searchsorted(t, end, "left")] += 1

    mode = np.where(in_tx, "live", np.where(operator_state == "away", "away", np.where(waiting > 0, "line", "chat")))

    msgs = tables["messages"]
    ins = msgs[msgs["sender"] == "participant"]
    outs = msgs[msgs["sender"] == "nickii"]
    in_t, in_who = last_before(t, ins["t_ms"].to_numpy(dtype="int64"), ins["pseudonym"].to_numpy())
    out_t, out_who = last_before(t, outs["t_ms"].to_numpy(dtype="int64"), outs["pseudonym"].to_numpy())

    ctx = pd.DataFrame({
        "t_ms": t,
        "mode": mode,
        "operator_state": operator_state,
        "transmission_with": tx_who,
        "line_waiting": waiting,
        "open_thread": open_thread,
        "typing": typing,
        "last_in_t_ms": in_t,
        "last_in_from": in_who,
        "ms_since_last_in": pd.array(t, dtype="Int64") - in_t,
        "last_out_t_ms": out_t,
        "last_out_to": out_who,
        "ms_since_last_out": pd.array(t, dtype="Int64") - out_t,
    })
    return pd.concat([face.reset_index(drop=True), ctx.drop(columns=["t_ms"])], axis=1)


# ---------------------------------------------------------------- output


README_TEMPLATE = """# Nickii AI dataset ({first} – {last})

Recorded during the 7-day durational performance *Nickii AI* by Nickii Schamborski.
Participants used an app that looked and behaved like an AI; every answer came from Nickii, live.

All times are `t_ms`: server time, UTC, milliseconds since 1970-01-01 (one clock for all streams).
Devices measured their offset to the server regularly (`clock_sync.csv`).

## Consent and privacy
Participants agreed inside the app that their conversations are recorded for an artistic dataset
under a pseudonym. They appear only as `p_xxxxxxxx`. Push addresses and device information are
not part of this dataset. Participants who asked for deletion have been removed.

## Files
| File | Rows | What |
| --- | --- | --- |
{file_rows}

## Columns
- **messages**: `sender` participant / nickii / system; `input_method` typed / dictated / unknown (a guess from key events, not verified per message).
- **operator_events**: what Nickii did. `compose_*` = how she wrote replies (start, pauses ≥ 2 s, deletions, send with totals); `state_live` / `state_away`; `push_*`; `line_invite`; `transmission_start` / `_end`; `face_capture_heartbeat` = health of face recording. `data` is JSON.
- **participant_events**: app opened / hidden / visible, notifications, mode changes, line, messages sent. `data` is JSON.
- **face/**: one row per video frame (target 30 fps). `face_present` 0/1, 52 MediaPipe blendshapes (0–1, ARKit-compatible names), `m00`…`m33` = 4×4 facial transformation matrix, row-major (`m03`, `m13`, `m23` = head position), `fps_measured`.
- **face_context/**: face rows plus `mode` (chat / line / live / away), `operator_state`, `transmission_with`, `line_waiting`, `open_thread` (whose conversation was open in the console), `typing`, last message in/out with time since.

Recorded with MediaPipe Face Landmarker (web). Raw webcam video is not part of this dataset.
Exported {exported}.
"""


def write_outputs(out_root: Path, tables: dict[str, pd.DataFrame], face: pd.DataFrame, clock: Path) -> Path:
    times = [df["t_ms"] for k, df in tables.items() if "t_ms" in df and len(df)] + ([face["t_ms"]] if len(face) else [])
    if times:
        all_t = pd.concat(times)
        first = datetime.fromtimestamp(int(all_t.min()) / 1000, timezone.utc).date().isoformat()
        last = datetime.fromtimestamp(int(all_t.max()) / 1000, timezone.utc).date().isoformat()
    else:
        first = last = "empty"
    root = out_root / f"nickii_ai_dataset_{first}_{last}"
    if root.exists():
        shutil.rmtree(root)
    (root / "samples").mkdir(parents=True)
    rows: list[str] = []

    for name, df in tables.items():
        df.to_parquet(root / f"{name}.parquet", index=False)
        df.head(SAMPLE_ROWS).to_csv(root / "samples" / f"{name}.csv", index=False)
        rows.append(f"| {name}.parquet | {len(df)} | |")

    if len(face):
        (root / "face").mkdir()
        (root / "face_context").mkdir()
        day = pd.to_datetime(face["t_ms"], unit="ms", utc=True).dt.strftime("%Y-%m-%d")
        for d, part in face.groupby(day):
            part = part.reset_index(drop=True)
            part.to_parquet(root / "face" / f"face_{d}.parquet", index=False)
            face_context(part, tables).to_parquet(root / "face_context" / f"face_context_{d}.parquet", index=False)
            rows.append(f"| face/face_{d}.parquet | {len(part)} | |")
            rows.append(f"| face_context/face_context_{d}.parquet | {len(part)} | |")
        face.head(SAMPLE_ROWS).to_csv(root / "samples" / "face.csv", index=False)
        face_context(face.head(SAMPLE_ROWS).reset_index(drop=True), tables).to_csv(root / "samples" / "face_context.csv", index=False)

    shutil.copy(clock, root / "clock_sync.csv")
    rows.append(f"| clock_sync.csv | {len(pd.read_csv(clock))} | |")
    (root / "README.md").write_text(README_TEMPLATE.format(
        first=first, last=last, file_rows="\n".join(rows),
        exported=datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")))
    return root


def main(argv: list[str] | None = None) -> Path:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tables", type=Path, required=True)
    ap.add_argument("--face", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--exclude", type=Path, help="pseudonyms to remove (deletion requests), one per line")
    a = ap.parse_args(argv)

    excluded = set()
    if a.exclude:
        excluded = {line.strip() for line in a.exclude.read_text().splitlines() if line.strip()}
    tables = build_tables(a.tables, excluded)
    face = read_face_chunks(a.face)
    root = write_outputs(a.out, tables, face, a.tables / "clock_sync.csv")
    print(f"Dataset written to {root}")
    return root


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
