#!/usr/bin/env bash
#
# Replay supabase/migrations/*.sql, in order, into a target database.
#
# WHAT THIS IS FOR. Standing up a staging project that matches production
# exactly, so a migration can be tried somewhere harmless before it touches the
# database your club depends on. It also proves the migration history still
# builds a working database from nothing — worth knowing before a store
# submission, because "it works on the one database I've been editing for six
# months" is not the same claim.
#
# USAGE
#   export TARGET_DB_URL='postgresql://postgres.<ref>:<password>@<host>:5432/postgres'
#   ./scripts/apply-migrations.sh              # every migration, in order
#   ./scripts/apply-migrations.sh --from 0046  # resume from one
#
# The URL comes from Supabase: Project Settings -> Database -> Connection string
# -> URI. Use the DIRECT connection (port 5432), not the pooler (6543) — the
# pooler is in transaction mode and some of these migrations create functions
# across multiple statements.
#
# SAFETY. This asks you to type the project reference from the URL before it
# runs anything. That sounds fussy until the day two connection strings are open
# in two terminals. There is no undo for a migration.
#
# NOTE. Assumes a real Supabase project, where the auth and storage schemas
# already exist. It will not work against a bare Postgres without them.
set -euo pipefail

FROM=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --from) FROM="${2:-}"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "${TARGET_DB_URL:-}" ]]; then
  echo "TARGET_DB_URL is not set. See the comment at the top of this script." >&2
  exit 1
fi
command -v psql >/dev/null 2>&1 || {
  echo "psql not found. brew install libpq, then:" >&2
  echo "  export PATH=\"/opt/homebrew/opt/libpq/bin:\$PATH\"" >&2
  exit 1
}

cd "$(dirname "$0")/.."

# Pull the project ref out of the host for the confirmation prompt.
HOST="$(printf '%s' "$TARGET_DB_URL" | sed -E 's#^[^@]*@##; s#[:/].*$##')"
REF="$(printf '%s' "$TARGET_DB_URL" | sed -nE 's#^.*://postgres\.([a-z0-9]+):.*$#\1#p')"
[[ -z "$REF" ]] && REF="$HOST"

echo
echo "  Target host : $HOST"
echo "  Project ref : $REF"
echo
echo "  This applies migrations. There is no undo."
printf '  Type the project ref to continue: '
read -r TYPED
if [[ "$TYPED" != "$REF" ]]; then
  echo "  Didn't match. Nothing was run." >&2
  exit 1
fi

APPLIED=0
for f in supabase/migrations/*.sql; do
  base="$(basename "$f")"
  if [[ -n "$FROM" && "${base%%_*}" < "$FROM" ]]; then
    echo "skip  $base"
    continue
  fi
  echo "---   $base"
  # ON_ERROR_STOP so a failure stops the run rather than limping on and leaving
  # the database in a state no migration file describes.
  if ! psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 -q -f "$f"; then
    echo >&2
    echo "FAILED on $base — nothing after it has run." >&2
    echo "Fix it, then resume:  ./scripts/apply-migrations.sh --from ${base%%_*}" >&2
    exit 1
  fi
  APPLIED=$((APPLIED + 1))
done

echo
echo "Applied $APPLIED migration(s)."
echo "Seed it with a club and a session before you trust a test against it —"
echo "an empty database passes tests that a populated one fails."
