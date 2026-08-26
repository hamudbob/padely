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
#   ./scripts/apply-migrations.sh              # every migration, in order
#   ./scripts/apply-migrations.sh --from 0046  # resume from one
#
# It asks for the connection string and reads it silently. Don't set it with
# `export` — that puts your database password in ~/.zsh_history and on screen,
# where it gets copied into a chat or a screenshot without anyone meaning to.
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

# Asked for, not exported. A connection string typed as `export TARGET_DB_URL=...`
# ends up in ~/.zsh_history and on screen, where it gets copied into a chat or a
# screenshot along with everything around it. Read silently instead: nothing is
# echoed, nothing is saved, and there is no command to paste back.
FROM_ENV=""
if [[ -n "${TARGET_DB_URL:-}" ]]; then
  # An exported variable from earlier in the same terminal silently wins over
  # the prompt, so the script appears to ignore what you meant to paste. Say so.
  FROM_ENV="yes"
else
  echo
  echo "  Paste the connection string (it will not be shown), then press Enter."
  echo "  Supabase -> Connect -> Direct tab. On an IPv4-only network use the"
  echo "  Session pooler string (aws-...pooler.supabase.com, port 5432)."
  printf '  > '
  read -rs TARGET_DB_URL
  echo
  if [[ -z "$TARGET_DB_URL" ]]; then
    echo "  Nothing pasted." >&2
    exit 1
  fi
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

# Show the connection with the password masked and ask for a plain yes.
#
# This used to print a project ref pulled out with a regex and ask you to type
# it back. Two connection formats put the ref in two different places, the
# extraction was fragile, and when it failed the prompt asked for a hostname
# nobody would guess to type — so the confirmation blocked correct attempts
# while proving nothing. Showing the whole string minus the password is both
# safer to read and impossible to get wrong: the project ref is right there in
# it, either in the username or the host.
SAFE="$(printf '%s' "$TARGET_DB_URL" | sed -E 's#(://[^:/@]+):[^@]*@#\1:******@#')"

echo
if [[ -n "$FROM_ENV" ]]; then
  echo "  Using TARGET_DB_URL already set in this terminal."
  echo "  To be asked for a different one:  unset TARGET_DB_URL"
  echo
fi
echo "  $SAFE"
echo
echo "  This applies every migration to that database. There is no undo."
printf '  Type yes to continue: '
read -r TYPED
if [[ "$TYPED" != "yes" ]]; then
  echo "  Stopped. Nothing was run." >&2
  exit 1
fi

# Prove the connection before touching anything. Failing on migration 0001
# looks like a broken migration; it is almost always the network.
echo
echo "Checking the connection ..."
if ! PRE="$(psql "$TARGET_DB_URL" -Atc 'select 1' 2>&1)"; then
  echo >&2
  if printf '%s' "$PRE" | grep -qi 'could not translate host name\|no route to host\|network is unreachable'; then
    cat >&2 <<'HINT'
Could not resolve that host. This is almost never a wrong password.

Supabase's DIRECT connection is IPv6-only, and most home and office networks
are IPv4-only — so the name genuinely does not resolve for you.

The fix: Supabase -> Connect -> Direct tab, and take the SESSION POOLER string
instead. It is also port 5432 and works identically for migrations. It looks
like:

  postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres

NOT the Transaction pooler on 6543 — that one cannot run these migrations.
HINT
  else
    echo "Could not connect:" >&2
    printf '%s\n' "$PRE" >&2
  fi
  exit 1
fi
echo "Connected."
echo

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
