-- ---------------------------------------------------------------------
-- 0045_error_codes.sql
--
-- Every failure the app can show now carries a code the person can quote:
-- PDL-2002 for a known condition, PDL-U-7F3A for anything not yet
-- catalogued. This stores it, groups by it, and — the part that makes it
-- worth having — lets you paste a code a user sent you straight into the
-- admin console's search box and land on that exact error.
--
-- Codes are DERIVED on the client from the error itself (see lib/errors.ts),
-- not assigned by hand, so the same failure produces the same code on every
-- device without anyone maintaining a registry of call sites.
--
-- Idempotent and safe to re-run.
-- ---------------------------------------------------------------------

alter table client_errors add column if not exists code text;
create index if not exists client_errors_code_idx on client_errors (code, created_at desc);

comment on column client_errors.code is
  'The PDL-… code shown to the user for this failure. Curated codes are documented in docs/ERRORS.md; PDL-U-… is derived from the error itself and is stable across devices.';

-- report_client_error gains the code. Same clamping, same flood guard: only
-- the payload is wider.
--
-- The 7-argument version is DROPPED rather than left beside this one: two
-- overloads where the only difference is a defaulted argument makes every
-- call ambiguous ("could not choose a best candidate function"). Dropping it
-- is also what keeps a browser on the previous bundle working through a
-- deploy — PostgREST resolves by argument NAME, so a call without p_code
-- still matches this function and takes the default.
drop function if exists report_client_error(text, text, text, text, text, text, jsonb);

create or replace function report_client_error(
  p_kind        text,
  p_message     text,
  p_stack       text default null,
  p_route       text default null,
  p_app_version text default null,
  p_user_agent  text default null,
  p_context     jsonb default null,
  p_code        text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_msg    text;
  v_recent integer;
begin
  if p_kind is null or p_kind not in ('error', 'rejection', 'boundary', 'query') then
    return;
  end if;
  v_msg := left(coalesce(nullif(btrim(p_message), ''), 'Unknown error'), 500);

  select count(*) into v_recent
    from client_errors
   where created_at > now() - interval '1 minute'
     and user_id is not distinct from v_uid;
  if v_recent >= 30 then
    return;
  end if;

  insert into client_errors (
    user_id, kind, message, stack, route, app_version, user_agent, context, fingerprint, code
  ) values (
    v_uid,
    p_kind,
    v_msg,
    left(p_stack, 4000),
    left(p_route, 200),
    left(p_app_version, 60),
    left(p_user_agent, 300),
    p_context,
    -- Group by CODE when there is one: two spellings of the same failure are
    -- one problem, and the code already says which.
    coalesce(nullif(left(p_code, 40), ''), md5(p_kind || coalesce(left(p_route, 120), '') || left(v_msg, 160))),
    left(p_code, 40)
  );
end;
$$;

grant execute on function report_client_error(text, text, text, text, text, text, jsonb, text) to anon, authenticated;

-- --- The console: show the code, and count user-reported ones ----------
create or replace function admin_errors(p_hours integer default 168, p_include_resolved boolean default false, p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  perform admin_guard();
  select coalesce(jsonb_agg(to_jsonb(x) order by x.last_seen desc), '[]'::jsonb) into v
  from (
    select ce.fingerprint,
           min(ce.created_at)                                     as first_seen,
           max(ce.created_at)                                     as last_seen,
           count(*)                                               as occurrences,
           count(distinct ce.user_id)                             as users,
           bool_or(ce.resolved_at is null)                        as open,
           -- Someone pressed "Report this" rather than shrugging: worth
           -- knowing, because it separates the errors people NOTICED from
           -- the ones that merely happened.
           count(*) filter (where ce.context ? 'user_reported')    as reported,
           (array_agg(ce.code    order by ce.created_at desc))[1]  as code,
           (array_agg(ce.message order by ce.created_at desc))[1]  as message,
           (array_agg(ce.kind    order by ce.created_at desc))[1]  as kind,
           (array_agg(ce.route   order by ce.created_at desc))[1]  as route,
           (array_agg(ce.stack   order by ce.created_at desc))[1]  as stack,
           (array_agg(ce.app_version order by ce.created_at desc))[1] as app_version
      from client_errors ce
     where ce.created_at > now() - make_interval(hours => greatest(1, coalesce(p_hours, 168)))
       and (coalesce(p_include_resolved, false) or ce.resolved_at is null)
     group by ce.fingerprint
     order by max(ce.created_at) desc
     limit greatest(1, least(coalesce(p_limit, 50), 200))
  ) x;
  return v;
end;
$$;

-- --- Search: a pasted code resolves like anything else ------------------
create or replace function admin_search(p_query text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb;
  q text := btrim(coalesce(p_query, ''));
  v_uuid uuid;
begin
  perform admin_guard();
  if length(q) < 2 then return '[]'::jsonb; end if;

  begin
    v_uuid := q::uuid;
  exception when others then
    v_uuid := null;
  end;

  -- A code is unambiguous and is what a user will have sent you, so it
  -- answers on its own rather than being mixed in with name matches.
  if upper(q) like 'PDL-%' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.last_seen desc), '[]'::jsonb) into v
    from (
      select 'error' as type,
             ce.fingerprint as id,
             (array_agg(ce.message order by ce.created_at desc))[1] as label,
             concat_ws(' · ', upper(q),
                       count(*)::text || ' time' || case when count(*) = 1 then '' else 's' end,
                       count(distinct ce.user_id)::text || ' user' || case when count(distinct ce.user_id) = 1 then '' else 's' end,
                       (array_agg(ce.route order by ce.created_at desc))[1]) as sublabel,
             1 as weight,
             max(ce.created_at) as last_seen
        from client_errors ce
       where upper(ce.code) = upper(q)
       group by ce.fingerprint
       limit 20
    ) x;
    return v;
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.weight, x.label), '[]'::jsonb) into v
  from (
    select 1 as weight, 'session' as type, s.id::text as id, s.name as label,
           concat_ws(' · ', s.status, s.format, 'code ' || s.join_code, ph.display_name) as sublabel
      from sessions s
      left join profiles ph on ph.id = s.created_by
     where (v_uuid is not null and s.id = v_uuid)
        or upper(s.join_code) = upper(q)
        or s.public_token = q
        or s.name ilike '%' || q || '%'
    union all
    select 2, 'user', p.id::text, p.display_name,
           concat_ws(' · ', u.email, 'rating ' || round(p.rating)::text,
                     p.rating_games::text || ' games')
      from profiles p
      left join auth.users u on u.id = p.id
     where (v_uuid is not null and p.id = v_uuid)
        or p.display_name ilike '%' || q || '%'
        or u.email ilike '%' || q || '%'
    union all
    select 3, 'club', c.id::text, c.name,
           concat_ws(' · ', 'code ' || c.club_code,
                     (select count(*) from club_members cm where cm.club_id = c.id)::text || ' members')
      from clubs c
     where (v_uuid is not null and c.id = v_uuid)
        or c.name ilike '%' || q || '%'
        or upper(c.club_code) = upper(q)
    union all
    select 4, 'player', pl.session_id::text, pl.display_name,
           concat_ws(' · ', 'in ' || s.name, case when pl.linked_user_id is null then 'guest' else 'linked' end)
      from players pl
      join sessions s on s.id = pl.session_id
     where pl.display_name ilike '%' || q || '%'
     limit 20
  ) x;
  return v;
end;
$$;
