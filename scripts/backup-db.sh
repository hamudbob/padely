#!/usr/bin/env bash
#
# A full logical backup of the Padelier database, written to ./backups/.
#
# WHY, given Supabase already backs up nightly: those backups live inside the
# same account as the thing they protect, keep only seven days on Pro, and are
# restored by overwriting the whole project. This produces a plain .sql file you
# hold, that survives a deleted project or a locked account, and that you can
# read, diff and restore selectively.
#
# USAGE
#   export SUPABASE_DB_URL='postgresql://postgres.<ref>:<password>@<host>:6543/postgres'
#   ./scripts/backup-db.sh
#
# Get that string from the Supabase dashboard: Project Settings -> Database ->
# Connection string -> URI. It contains your database password, so keep it in
# your shell profile or a password manager and NEVER commit it. ./backups/ is
# gitignored for the same reason: a dump contains every user's email address.
#
# WHAT THIS DOES NOT COVER: Storage. Avatars live in the storage bucket and a
# database dump holds only the rows that point at them. Supabase's own backups
# exclude storage objects too. If avatars matter, download the bucket separately.
set -euo pipefail

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "SUPABASE_DB_URL is not set. See the comment at the top of this script." >&2
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "pg_dump not found. Install the Postgres client tools: brew install libpq" >&2
  echo "then add it to PATH:  export PATH=\"/opt/homebrew/opt/libpq/bin:\$PATH\"" >&2
  exit 1
fi

cd "$(dirname "$0")/.."
mkdir -p backups
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="backups/padelier-${STAMP}.sql"

echo "Dumping to ${OUT} ..."
# --no-owner / --no-privileges: the roles on a restore target won't match
# Supabase's, and without these the restore fails on every GRANT.
pg_dump "$SUPABASE_DB_URL" \
  --no-owner --no-privileges \
  --schema=public --schema=auth --schema=storage \
  --file "$OUT"

gzip -f "$OUT"
echo "Done: ${OUT}.gz  ($(du -h "${OUT}.gz" | cut -f1))"
echo
echo "Keep at least one copy somewhere that is NOT this laptop and NOT Supabase."
