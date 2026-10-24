"""Builds a small fake performance (2 participants, a reply, a transmission, face chunks across
midnight UTC), runs the export, and checks the result.

Run: python3 -m unittest discover -s dataset/tests   (needs dataset/requirements.txt)
"""

import csv
import gzip
import json
import re
import sys
import tempfile
import unittest
from pathlib import Path

import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "export_scripts"))
import export_dataset as ex  # noqa: E402

REPO = HERE.parent.parent
T0 = 1_791_590_340_000  # 2026-10-09 23:59:00 UTC
ALICE, BOB, GONE = "uuid-alice", "uuid-bob", "uuid-gone"


def write_csv(path: Path, header: list[str], rows: list[list]):
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)


def make_sample(root: Path) -> tuple[Path, Path, Path]:
    tables, face = root / "tables", root / "face"
    tables.mkdir()
    (face / "2026-10-09").mkdir(parents=True)
    write_csv(tables / "participants.csv", ["id", "pseudonym", "agreed_at", "agreement_version", "platform", "created_at"], [
        [ALICE, "p_aaaa1111", "2026-10-09T20:00:00Z", "v1", "ios", "2026-10-09T20:00:00Z"],
        [BOB, "p_bbbb2222", "2026-10-09T20:00:00Z", "v1", "android", "2026-10-09T20:00:00Z"],
        [GONE, "p_gone0000", "2026-10-09T20:00:00Z", "v1", "ios", "2026-10-09T20:00:00Z"],
    ])
    msg_h = ["id", "participant_id", "sender", "body", "input_method", "t_ms", "created_at"]
    write_csv(tables / "messages.csv", msg_h, [
        ["m1", ALICE, "participant", "hello?", "typed", T0 + 1_000, ""],
        ["m2", GONE, "participant", "delete me", "typed", T0 + 1_500, ""],
        ["m3", ALICE, "nickii", "I am here.", "", T0 + 20_000, ""],
        ["m4", BOB, "participant", "and me?", "dictated", T0 + 30_000, ""],
    ])
    ev_h = ["id", "name", "participant_id", "data", "t_ms", "received_t_ms"]
    write_csv(tables / "operator_events.csv", ev_h, [
        [1, "state_live", "", "{}", T0, T0],
        [2, "thread_opened", ALICE, "{}", T0 + 5_000, T0 + 5_000],
        [3, "compose_start", ALICE, "{}", T0 + 8_000, T0 + 8_000],
        [4, "compose_send", ALICE, json.dumps({"chars": 10}), T0 + 20_000, T0 + 20_000],
        [5, "thread_closed", ALICE, "{}", T0 + 25_000, T0 + 25_000],
        [6, "line_invite", BOB, "{}", T0 + 40_000, T0 + 40_000],
        [7, "transmission_start", BOB, "{}", T0 + 50_000, T0 + 50_000],
        [8, "transmission_end", BOB, "{}", T0 + 70_000, T0 + 70_000],
        [9, "state_away", "", "{}", T0 + 80_000, T0 + 80_000],
        [10, "thread_opened", GONE, "{}", T0 + 85_000, T0 + 85_000],
    ])
    write_csv(tables / "participant_events.csv", ev_h, [
        [1, "app_open", ALICE, "{}", T0 + 500, T0 + 600],
        [2, "app_open", GONE, "{}", T0 + 700, T0 + 800],
    ])
    write_csv(tables / "line_entries.csv", ["id", "participant_id", "status", "invited_t_ms", "arrived_t_ms", "started_t_ms", "ended_t_ms"], [
        ["l1", BOB, "done", T0 + 40_000, T0 + 45_000, T0 + 50_000, T0 + 70_000],
    ])
    write_csv(tables / "clock_sync.csv", ["id", "device", "offset_ms", "round_trip_ms", "t_ms"], [
        [1, "face-capture", 12.5, 40, T0],
    ])
    # Face: 1 frame per second for 100 s (crosses midnight UTC at T0+60 s), in two chunks;
    # the second chunk is also present twice (re-uploaded after a crash).
    header = ex.FACE_COLUMNS
    def chunk(path: Path, start: int, n: int):
        with gzip.open(path, "wt") as f:
            f.write(",".join(header) + "\n")
            for i in range(n):
                t = T0 + (start + i) * 1000
                blend = [f"{(i % 10) / 10:.5f}"] * len(ex.BLENDSHAPE_NAMES)
                matrix = ["1", "0", "0", "1.5", "0", "1", "0", "-2", "0", "0", "1", "-40", "0", "0", "0", "1"]
                f.write(",".join([str(t), "1", *blend, *matrix, "30.0"]) + "\n")
    chunk(face / "2026-10-09" / "face_2026-10-09_23-59-00.csv.gz", 0, 60)
    (face / "2026-10-10").mkdir()
    chunk(face / "2026-10-10" / "face_2026-10-10_00-00-00.csv.gz", 60, 40)
    chunk(face / "2026-10-10" / "face_2026-10-10_00-00-00_copy.csv.gz", 60, 40)
    exclude = root / "deletion_requests.txt"
    exclude.write_text("p_gone0000\n")
    return tables, face, exclude


class ExportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        root = Path(cls.tmp.name)
        tables, face, exclude = make_sample(root)
        cls.out = ex.main(["--tables", str(tables), "--face", str(face), "--out", str(root / "out"), "--exclude", str(exclude)])

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def read(self, name):
        return pd.read_parquet(self.out / name)

    def test_folder_and_files(self):
        self.assertEqual(self.out.name, "nickii_ai_dataset_2026-10-09_2026-10-10")
        for f in ["README.md", "participants.parquet", "messages.parquet", "operator_events.parquet",
                  "participant_events.parquet", "line_entries.parquet", "clock_sync.csv",
                  "face/face_2026-10-09.parquet", "face/face_2026-10-10.parquet",
                  "face_context/face_context_2026-10-09.parquet", "samples/messages.csv", "samples/face_context.csv"]:
            self.assertTrue((self.out / f).exists(), f)

    def test_no_participant_ids_or_device_info(self):
        for f in self.out.rglob("*"):
            if f.suffix in (".csv", ".md"):
                text = f.read_text()
            elif f.suffix == ".parquet":
                text = pd.read_parquet(f).to_csv()
            else:
                continue
            self.assertNotIn("uuid-", text, f)
            self.assertNotIn("android", text, f)
        self.assertNotIn("platform", self.read("participants.parquet").columns)

    def test_deletion_requests_removed_everywhere(self):
        for f in self.out.rglob("*.parquet"):
            self.assertNotIn("p_gone0000", pd.read_parquet(f).to_csv(), f)
        self.assertEqual(list(self.read("participants.parquet")["pseudonym"]), ["p_aaaa1111", "p_bbbb2222"])

    def test_messages(self):
        m = self.read("messages.parquet")
        self.assertEqual(list(m["body"]), ["hello?", "I am here.", "and me?"])
        self.assertEqual(list(m["pseudonym"]), ["p_aaaa1111", "p_aaaa1111", "p_bbbb2222"])
        self.assertEqual(m["time_utc"].iloc[0], "2026-10-09T23:59:01.000Z")

    def test_operator_events_keep_events_without_participant(self):
        e = self.read("operator_events.parquet")
        self.assertIn("state_live", list(e["name"]))
        self.assertEqual(len(e), 9)  # GONE's thread_opened removed

    def test_face_split_by_day_without_duplicates(self):
        d1, d2 = self.read("face/face_2026-10-09.parquet"), self.read("face/face_2026-10-10.parquet")
        self.assertEqual((len(d1), len(d2)), (60, 40))
        self.assertEqual(list(d1.columns), ex.FACE_COLUMNS)
        self.assertEqual(str(d1["jawOpen"].dtype), "float32")
        self.assertEqual(d1["m23"].iloc[0], -40)

    def test_face_context_labels(self):
        c = pd.concat([self.read("face_context/face_context_2026-10-09.parquet"),
                       self.read("face_context/face_context_2026-10-10.parquet")]).set_index("t_ms")
        at = lambda s: c.loc[T0 + s * 1000]  # noqa: E731
        self.assertEqual(at(0)["mode"], "chat")
        self.assertEqual(at(10)["open_thread"], "p_aaaa1111")
        self.assertTrue(at(10)["typing"])
        self.assertFalse(at(21)["typing"])
        self.assertEqual(at(10)["last_in_from"], "p_aaaa1111")
        self.assertEqual(at(10)["ms_since_last_in"], 9_000)
        self.assertTrue(pd.isna(at(10)["last_out_t_ms"]))
        self.assertEqual(at(42)["mode"], "line")
        self.assertEqual(at(42)["line_waiting"], 1)
        self.assertEqual(at(55)["mode"], "live")
        self.assertEqual(at(55)["transmission_with"], "p_bbbb2222")
        self.assertEqual(at(75)["mode"], "chat")
        self.assertEqual(at(85)["mode"], "away")
        self.assertEqual(at(85)["operator_state"], "away")
        self.assertIsNone(at(90)["open_thread"])  # GONE's thread is not shown

    def test_readme(self):
        text = (self.out / "README.md").read_text()
        self.assertIn("pseudonym", text)
        self.assertIn("| messages.parquet | 3 |", text)

    def test_blendshape_names_match_the_app(self):
        ts = (REPO / "packages/shared/src/blendshapes.ts").read_text()
        block = ts[ts.index("BLENDSHAPE_NAMES = [") : ts.index("] as const")]
        self.assertEqual(re.findall(r"'([A-Za-z_]+)'", block), ex.BLENDSHAPE_NAMES)
        self.assertIn("'fps_measured'", ts)


if __name__ == "__main__":
    unittest.main()
