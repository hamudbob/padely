# Keeping Padelier running while changing it

Written at the end of the web phase, before the iOS and Play Store work begins.
Two questions, answered in the order they matter.

## 1. Your club keeps using the app while you rebuild it

The app already has a live audience: 42 accounts and a Monday night that
depends on it working. From here on, every change is a change to something
people are using. Four defences, cheapest first.

### Netlify's deploy history is your undo button

Every deploy Netlify has ever built is still there, and any of them can be made
live again in one click: Netlify dashboard -> Deploys -> pick a good one ->
**Publish deploy**. It takes seconds and needs no rebuild, because the built
files still exist.

This is the fastest fix for a bad front-end change, and it is why the front end
is the *safe* half of the app to experiment on. Learn where that button is
before you need it.

### Tag the version that works

    git tag -a phase-1-web -m "The web app the club used through August 2026"
    git push origin phase-1-web

A branch moves; a tag doesn't. Six months from now, `git checkout phase-1-web`
gets you exactly the app your club was using, whatever has happened to `main`
since.

### Build on a branch, not on main

Netlify deploys `main`. So:

    git checkout -b ios

and push that. Netlify builds it at its own preview URL, your club keeps the
`padelier.id` they know, and you merge to `main` only when the branch is
actually better. Do this for anything that changes how a screen works — the
iOS wrapper, report and block, Apple sign-in.

### The database is the half that has no undo

The front end can be rolled back in seconds. A migration cannot: it has already
rewritten the rows. This is the real risk in the next phase, and it deserves
the one piece of setup work in this document.

**Make a second Supabase project.** A free-tier one is enough. Point a
`.env.staging` at it, run every new migration there first against a copy of
real-shaped data, and only then run it on production. The whole reason
migrations 0046-0052 have been safe is that each was tried on a throwaway
Postgres before it touched anything of yours.

Stand it up with:

    export TARGET_DB_URL='...'      # the staging project's DIRECT connection
    ./scripts/apply-migrations.sh

That replays all 52 migrations in order. The whole chain was verified against
an empty Postgres on 26 Aug 2026 — 30 tables, 109 functions, 59 RLS policies,
no failures — so a clean replay is the expected result, not a hope.

**The staging project is not the iOS database.** iOS, Android and the web all
talk to the ONE production project, or the same person gets a different account
depending on which one they opened. Staging exists so migrations can be tried
somewhere harmless; it would exist even if you never shipped an app.

And keep writing migrations the way you already do: add columns as nullable,
add functions rather than rewriting them where you can, never `drop column` on
a table with data in it. An additive migration that turns out to be wrong is a
thing you can ignore. A destructive one is a thing you restore from backup.

## 2. Backing up the database

### What Supabase already does

You are on Pro, so the project gets an **automatic backup every day, and keeps
the last seven**. Dashboard -> Database -> Backups. Restoring overwrites the
whole project and takes the project down for a while, so it is a disaster tool,
not an oops tool.

Two limits worth knowing before you rely on it:

- **Seven days.** A mistake you notice in week three is past the window.
- **Storage is not included.** Avatars live in the storage bucket, and a
  database backup holds only the rows pointing at them. Delete an avatar and no
  restore brings it back.

Point-in-time recovery — rewind to any second rather than to last night — is a
paid add-on starting around $100/month and requiring a compute upgrade. For a
club app, that is not the right spend. A weekly dump you keep yourself is.

### The dump you hold yourself

    ./scripts/backup-db.sh

Set `SUPABASE_DB_URL` first (the script says where to find it). It writes a
gzipped `.sql` into `backups/`, which is gitignored — a dump contains every
member's email address and must never end up in a public repo.

Do this **before every migration in the next phase**, and on some regular
rhythm besides. A dump on your laptop survives things Supabase's own backups do
not: a deleted project, a billing lapse, a locked account, or a migration that
was wrong in a way nobody noticed for a fortnight.

Keep at least one copy off the laptop. A backup that only exists on the machine
that might die is not a backup.

### Restoring one

    gunzip -c backups/padelier-YYYYMMDD-HHMMSS.sql.gz | psql "$TARGET_DB_URL"

Restore into the **staging** project first, always. Look at it. Then decide.

### The part people skip

Try it once, now, while nothing is wrong. Take a dump, restore it into the
staging project, sign in, look at a session. An untested backup is a guess, and
the moment you find out it was a bad guess is the worst possible moment.
