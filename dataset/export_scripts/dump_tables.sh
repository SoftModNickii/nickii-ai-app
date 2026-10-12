#!/usr/bin/env bash
# Dumps the Supabase tables needed for the dataset to CSV files, using psql (free, part of PostgreSQL).
# DATABASE_URL: Supabase dashboard → Project Settings → Database → Connection string (URI).
# Never commit it. Usage:  DATABASE_URL=postgres://... dataset/export_scripts/dump_tables.sh dataset/raw/tables
set -euo pipefail
OUT="${1:-dataset/raw/tables}"
: "${DATABASE_URL:?Set DATABASE_URL (see comment at the top of this file)}"
mkdir -p "$OUT"
for table in participants messages operator_events participant_events clock_sync line_entries; do
  echo "dumping $table"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "\\copy (select * from public.$table) to '$OUT/$table.csv' with csv header"
done
echo "done: $OUT"
echo "Face chunks: download the Storage bucket face_chunks into dataset/raw/face (dashboard, or the Mac's folder copy)."
