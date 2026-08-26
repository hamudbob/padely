-- ---------------------------------------------------------------------
-- 0054  Somewhere for reports to go
--
-- 0053 made reports safe to file and impossible to snoop on. It did not
-- give anyone a way to READ them, which makes the queue worse than no
-- report button: the person who filed one was told "a person reads every
-- report" and, until now, that was not true.
--
-- Two functions. admin_reports lists the queue with enough context to
-- decide without leaving the page — what was said, what the profile
-- looked like at the time, what it looks like NOW, and whether this
-- subject has been reported before. admin_resolve_report closes one with
-- an outcome and a note.
--
-- The reporter's identity is included. Admins need it for the case a
-- report queue always eventually sees: one person reporting another
-- repeatedly out of spite. It never leaves the admin console.
-- ---------------------------------------------------------------------

create or replace function admin_reports(p_include_closed boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  perform admin_guard();

  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc), '[]'::jsonb) into v
  from (
    select
      rp.id, rp.reason, rp.detail, rp.status, rp.created_at,
      rp.reviewed_at, rp.admin_note,
      rp.reporter_id,
      reporter.display_name as reporter_name,
      rp.subject_user_id,
      -- What it looked like when the complaint was made...
      rp.subject_snapshot -> 'display_name' as snapshot_name,
      rp.subject_snapshot -> 'avatar_url'   as snapshot_avatar,
      rp.subject_snapshot -> 'bio'          as snapshot_bio,
      -- ...and what it looks like now. A difference between the two is
      -- itself information: either they cleaned it up, or somebody
      -- already acted.
      subject.display_name as current_name,
      subject.avatar_url   as current_avatar,
      subject.bio          as current_bio,
      subject.deleted_at is not null as subject_deleted,
      -- A first complaint and a fifth are different situations, and
      -- reading them one at a time hides that.
      (select count(*) from reports o where o.subject_user_id = rp.subject_user_id) as reports_about_subject,
      (select count(*) from reports o where o.reporter_id = rp.reporter_id) as reports_by_reporter,
      reviewer.display_name as reviewed_by_name
    from reports rp
    left join profiles reporter on reporter.id = rp.reporter_id
    left join profiles subject  on subject.id  = rp.subject_user_id
    left join profiles reviewer on reviewer.id = rp.reviewed_by
    where p_include_closed or rp.status = 'open'
  ) r;

  return v;
end;
$$;

create or replace function admin_resolve_report(
  p_report_id uuid,
  p_status    text,
  p_note      text default null
)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform admin_guard();
  if p_status not in ('open', 'reviewed', 'actioned', 'dismissed') then
    raise exception 'Not a valid outcome.' using errcode = 'P0001';
  end if;

  update reports
     set status      = p_status,
         admin_note  = coalesce(nullif(btrim(coalesce(p_note, '')), ''), admin_note),
         -- Reopening clears the review, so a reopened report doesn't carry a
         -- reviewer who no longer stands behind it.
         reviewed_at = case when p_status = 'open' then null else now() end,
         reviewed_by = case when p_status = 'open' then null else auth.uid() end
   where id = p_report_id;

  if not found then
    raise exception 'That report no longer exists.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function admin_reports(boolean)               from anon;
revoke all on function admin_resolve_report(uuid, text, text) from anon;
grant execute on function admin_reports(boolean)               to authenticated;
grant execute on function admin_resolve_report(uuid, text, text) to authenticated;

comment on function admin_reports(boolean) is
  'The report queue, with the profile as it was AND as it is now, plus how often this subject and this reporter appear. Admin only.';
