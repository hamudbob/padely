#!/usr/bin/env python3
"""Regenerate supabase/check_migrations.sql from supabase/migrations.

    python3 scripts/gen_migration_check.py supabase/migrations > supabase/check_migrations.sql

Re-run after adding a migration. Verified against a database migrated to
0063, 0066 and 0068: no false NO on a fully migrated database, and every
migration left out is reported NO.
"""
import re, sys, os, glob
mdir = sys.argv[1]
files = sorted(glob.glob(os.path.join(mdir, "*.sql")))
name_of = lambda f: os.path.basename(f)[:-4]

def strip_comments(sql):
    sql = re.sub(r"/\*.*?\*/", "", sql, flags=re.S)
    return "\n".join("" if re.match(r"^\s*--", l) else l for l in sql.splitlines())

texts = {f: strip_comments(open(f).read()) for f in files}

FN = re.compile(r"create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z_0-9]+)\s*\(", re.I)
def function_bodies(s):
    """name -> body text, for every function defined in s (last wins)."""
    out = {}
    for m in FN.finditer(s):
        name = m.group(1).lower()
        rest = s[m.end():]
        t = re.search(r"\bas\s+(\$[a-z_]*\$)", rest, re.I)
        if not t: continue
        tag = t.group(1)
        start = t.end()
        end = rest.find(tag, start)
        if end < 0: continue
        out[name] = rest[start:end]
    return out

bodies = {f: function_bodies(texts[f]) for f in files}

def new_lines(body, prev):
    prev_lines = set(l.strip() for l in (prev or "").splitlines())
    for line in body.splitlines():
        l = line.strip()
        if len(l) < 24 or len(l) > 160: continue
        if l in prev_lines: continue
        if "%" in l or "\\" in l: continue
        if l.startswith("--"): continue
        yield l

seen = set()
rows = []
for i, f in enumerate(files):
    mig = name_of(f)
    s = texts[f]
    found = []
    for m in re.finditer(r"create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_0-9]+)", s, re.I):
        found.append(("table", m.group(1).lower()))
    for m in FN.finditer(s):
        found.append(("function", m.group(1).lower()))
    for m in re.finditer(r"alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?([a-z_0-9]+)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_0-9]+)", s, re.I):
        found.append(("column", f"{m.group(1).lower()}.{m.group(2).lower()}"))
    for m in re.finditer(r"create\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?([a-z_0-9]+)", s, re.I):
        found.append(("index", m.group(1).lower()))
    new = []
    for k in found:
        if k not in seen and k not in new: new.append(k)
    for k in found: seen.add(k)

    checks = []
    for kind, name in new[:4]:
        if kind == "table":
            checks.append((f"table {name}", f"to_regclass('public.{name}') is not null"))
        elif kind == "function":
            checks.append((f"function {name}", f"exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = '{name}')"))
        elif kind == "column":
            t, c = name.split(".")
            checks.append((f"column {name}", f"exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = '{t}' and column_name = '{c}')"))
        elif kind == "index":
            checks.append((f"index {name}", f"to_regclass('public.{name}') is not null"))

    note = None
    if not checks:
        # Only rewrites functions that already existed.
        fns = list(bodies[f].keys())
        final_here = []
        superseded_by = []
        for fn in fns:
            later = [g for g in files[i+1:] if fn in bodies[g]]
            if later: superseded_by.append(name_of(later[-1]))
            else: final_here.append(fn)
        for fn in final_here:
            earlier = [g for g in files[:i] if fn in bodies[g]]
            prev = bodies[earlier[-1]][fn] if earlier else ""
            snippet = next(new_lines(bodies[f][fn], prev), None)
            if snippet:
                esc = snippet.replace("'", "''")
                checks.append((f"new code in {fn}()", f"exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = '{fn}' and p.prosrc like '%{esc}%')"))
        if not checks and superseded_by:
            note = "replaced later by " + ", ".join(sorted(set(superseded_by))) + " — that row decides"
    if checks:
        rows.append((mig, ", ".join(w for w, _ in checks), " and ".join(f"({c})" for _, c in checks)))
    else:
        rows.append((mig, note or "nothing to detect (grants or data only) — check by hand", "null"))

first, last = name_of(files[0])[:4], name_of(files[-1])[:4]
out = ["""-- =====================================================================
-- Which migrations are on THIS database?
--
-- Read-only. Paste into the Supabase SQL editor and run it on production
-- (and on staging if you want to compare).
--
-- Migrations here are pasted into the SQL editor, not run by the Supabase
-- CLI, so Supabase keeps no record of which ones ran. This checks for what
-- each migration leaves behind instead: its new tables, functions, columns
-- or indexes — or, for a migration that only rewrites an existing function,
-- a line of code that exists only in its new version.
--
--   yes   everything that migration adds is there
--   NO    something it adds is missing: most likely never run
--   -     nothing of its own left to detect: a later migration replaced the
--         same function (see the note), or it only changed grants or data
--
-- Generated from supabase/migrations ({first}-{last}). Regenerate with
-- scripts/gen_migration_check.py after adding a migration.
-- =====================================================================
select migration,
       case when ok is null then '-' when ok then 'yes' else 'NO' end as applied,
       checks
  from (values"""]
vals = []
for mig, what, cond in rows:
    vals.append(f"  ('{mig}', ({cond})::boolean, '{what.replace(chr(39), chr(39)*2)}')")
out.append(",\n".join(vals))
out.append(""") as t(migration, ok, checks)
 order by (case when ok then 2 when ok is null then 1 else 0 end), migration;""")
print("\n".join(out).replace("{first}", first).replace("{last}", last))
