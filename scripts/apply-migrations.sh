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
# The URL comes from the Supabase dashboard: the CONNECT button at the top of
# the page. Three are offered; the port is what tells them apart:
#
#   Direct connection      5432  <- first choice
#   Session pooler         5432  <- use this if Direct can't connect
#   Transaction pooler     6543  <- never, for migrations
#
# Direct is IPv6-only. Plenty of home and office networks are IPv4-only, and on
# those it fails to resolve at all — that is a network fact, not a broken
# password. The Session pooler is IPv4 on every tier and behaves the same way
# for this purpose, so it is the fallback.
#
# Not the Transaction pooler. It is transaction-mode, and these migrations
# create functions across statements that must stay on one connection.
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
  echo "psql not found. Two ways to get it on a Mac:" >&2
  echo >&2
  echo "  1. Homebrew (worth having anyway):" >&2
  echo '     /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"' >&2
  echo "     brew install libpq" >&2
  echo '     echo '"'"'export PATH="/opt/homebrew/opt/libpq/bin:$PATH"'"'"' >> ~/.zshrc && source ~/.zshrc' >&2
  echo >&2
  echo "  2. Postgres.app from postgresapp.com — drag to Applications, then:" >&2
  echo "     sudo mkdir -p /etc/paths.d && echo /Applications/Postgres.app/Contents/Versions/latest/bin | sudo tee /etc/paths.d/postgresapp" >&2
  exit 1
}

# A password with @ or / or # in it silently breaks the URL: everything before
# the LAST @ is read as user:password, so an @ in the password moves the host.
# The error you get is about the host, which sends you looking in the wrong
# place entirely. Catch it here instead.
AT_COUNT="$(printf '%s' "${TARGET_DB_URL#*://}" | tr -cd '@' | wc -c | tr -d ' ')"
if [[ "$AT_COUNT" -gt 1 ]]; then
  echo "That URL has more than one @ in it, which means your password contains one." >&2
  echo "Postgres URLs need it percent-encoded:  @ becomes %40" >&2
  echo >&2
  echo "Easier: Supabase -> Project Settings -> Database -> Reset database password," >&2
  echo "and choose one with only letters and numbers. Nothing depends on it yet." >&2
  exit 1
fi

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
