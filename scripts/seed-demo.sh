#!/usr/bin/env bash
#
# Load supabase/seed/seed_demo.sql into a database, for App Store screenshots.
#
# WHAT THIS IS FOR. Screenshots need a club that looks lived in: fourteen
# members, five weeks of played sessions, a rating that has moved, a scheduled
# night with a waiting list. Playing that through the interface is an evening's
# work. This is a minute.
#
# WHERE IT SHOULD RUN. padelier-v2, the staging project. Not production. The
# screenshots go on a public store page, and real members' names and faces
# cannot be taken back off it once they are there.
#
# It asks for the connection string and reads it silently, the same way
# apply-migrations.sh does, so nothing lands in ~/.zsh_history or on screen.
#
# SAFE TO RE-RUN. The seed deletes its own rows before inserting them. Every id
# it creates begins 'dddd', and it touches nothing else. To remove it entirely
# later, run the delete block at the top of the seed file on its own.
set -euo pipefail

cd "$(dirname "$0")/.."
SEED="supabase/seed/seed_demo.sql"
[[ -f "$SEED" ]] || { echo "Can't find $SEED" >&2; exit 1; }

command -v psql >/dev/null 2>&1 || {
  echo "psql not found — same install as for apply-migrations.sh:" >&2
  echo "  brew install libpq" >&2
  echo '  echo '"'"'export PATH="/opt/homebrew/opt/libpq/bin:$PATH"'"'"' >> ~/.zshrc && source ~/.zshrc' >&2
  exit 1
}

FROM_ENV=""
if [[ -n "${TARGET_DB_URL:-}" ]]; then
  FROM_ENV="yes"
else
  echo
  echo "  Paste the padelier-v2 connection string (it will not be shown)."
  echo "  Supabase -> padelier-v2 -> Connect. On an IPv4-only network take the"
  echo "  Session pooler string (aws-...pooler.supabase.com, port 5432)."
  printf '  > '
  read -rs TARGET_DB_URL
  echo
  [[ -n "$TARGET_DB_URL" ]] || { echo "  Nothing pasted." >&2; exit 1; }
fi

SAFE="$(printf '%s' "$TARGET_DB_URL" | sed -E 's#(://[^:/@]+):[^@]*@#\1:******@#')"
echo
[[ -n "$FROM_ENV" ]] && { echo "  Using TARGET_DB_URL already set in this terminal."; echo "  To be asked for a different one:  unset TARGET_DB_URL"; echo; }
echo "  $SAFE"
echo

echo "Checking the connection ..."
psql "$TARGET_DB_URL" -Atc 'select 1' >/dev/null

# The guard that matters. Staging has a handful of accounts; production had 48
# real people the last time anyone counted. If this database is full of
# strangers, it is not the one you meant to seed.
REAL="$(psql "$TARGET_DB_URL" -Atc "select count(*) from profiles where id::text not like 'dddd%'")"
echo "That database has $REAL real profile(s) in it."
if [[ "$REAL" -gt 20 ]]; then
  echo
  echo "  STOP. That looks like production, not padelier-v2." >&2
  echo "  Seeding it would put fourteen invented members and a fake club into a" >&2
  echo "  database real people are using. Check which project you copied the" >&2
  echo "  connection string from." >&2
  echo >&2
  echo "  If you genuinely mean to do this (the demo account for Apple's" >&2
  echo "  reviewer is the one good reason), run it again as:" >&2
  echo "      SEED_ANYWAY=1 ./scripts/seed-demo.sh" >&2
  [[ "${SEED_ANYWAY:-}" == "1" ]] || exit 1
  echo
  echo "  SEED_ANYWAY is set. Continuing." >&2
fi

echo
printf '  Type yes to load the demo club: '
read -r TYPED
[[ "$TYPED" == "yes" ]] || { echo "  Stopped. Nothing was run." >&2; exit 1; }

echo
psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 -f "$SEED"

cat <<'DONE'

Loaded. Sign in on the simulator as:

    ana@demo.padelier.id  /  DemoPadel2026

Ana owns Kemang Padel Club, so she sees the club, the league table, the past
five Tuesdays and next Tuesday's RSVP list. Every other member uses the same
password with their own first name, e.g. bagas@demo.padelier.id.
DONE
