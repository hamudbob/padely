-- ---------------------------------------------------------------------
-- 0053  Report and block
--
-- Both stores require it and the app has neither. /u/<id> shows a
-- stranger's photo and free-text bio to anyone with the link, which is
-- exactly the surface App Store guideline 1.2 is about: a way to report
-- objectionable content, and a way to stop seeing a particular person.
--
-- WHAT A BLOCK IS, AND ISN'T. Content and contact — not presence.
--
--   It hides: the name, photo and bio on their public profile, in both
--     directions; their appearance in your partner and rival lists; and
--     their ability to invite you to a club, or you them.
--
--   It does NOT touch a session you are both in. The draw is unchanged,
--     both names stay on the scoreboard, and the standings are as they
--     were. Two people who both turned up are on the same court whatever
--     the database thinks, and a scoreboard that disagrees with the court
--     is worse than an uncomfortable evening.
--
--   It is silent. Only the blocker is ever told a block exists. Telling
--     the blocked person converts a quiet act of avoidance into a
--     confrontation, which is the thing blocking exists to avoid.
--
-- Symmetric where it hides things: once either person has blocked the
-- other, neither sees the other's profile. A one-way block that still let
-- the blocked person study the profile of someone avoiding them would be
-- worse than not having the feature.
--
-- Reports go to the app admins, not to the club. They are about safety,
-- and the person being reported may be the club's own host.
-- ---------------------------------------------------------------------

-- --- Tables ------------------------------------------------------------

create table if not exists blocks (
  blocker_id uuid not null references profiles(id) on delete cascade,
  blocked_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_not_self check (blocker_id <> blocked_id)
);
-- The reverse lookup ("has anyone blocked me?") runs on every profile read.
create index if not exists blocks_blocked_idx on blocks (blocked_id);

create table if not exists reports (
  id              uuid primary key default gen_random_uuid(),
  reporter_id     uuid references profiles(id) on delete set null,
  subject_user_id uuid not null references profiles(id) on delete cascade,
  reason          text not null check (reason in
                    ('abuse', 'impersonation', 'inappropriate_photo',
                     'inappropriate_name', 'spam', 'other')),
  detail          text check (detail is null or char_length(detail) <= 1000),
  -- A snapshot of what was actually complained about. Without it, someone can
  -- change their photo and bio the moment a report lands and the admin sees a
  -- clean profile and no evidence.
  subject_snapshot jsonb,
  status          text not null default 'open'
                    check (status in ('open', 'reviewed', 'actioned', 'dismissed')),
  created_at      timestamptz not null default now(),
  reviewed_at     timestamptz,
  reviewed_by     uuid references profiles(id) on delete set null,
  admin_note      text
);
create index if not exists reports_open_idx on reports (created_at desc) where status = 'open';
create index if not exists reports_subject_idx on reports (subject_user_id);

alter table blocks  enable row level security;
alter table reports enable row level security;

-- You may read and remove your own blocks. Writes go through block_user so the
-- self-block and duplicate cases are handled in one place.
drop policy if exists blocks_read_own on blocks;
create policy blocks_read_own on blocks for select to authenticated
  using (blocker_id = auth.uid());

drop policy if exists blocks_delete_own on blocks;
create policy blocks_delete_own on blocks for delete to authenticated
  using (blocker_id = auth.uid());

-- Reports are deliberately write-only from the app's point of view: you can
-- file one, you cannot read anyone's, not even your own. A readable report
-- table is a way to find out who reported you.
drop policy if exists reports_admin_read on reports;
create policy reports_admin_read on reports for select to authenticated
  using (is_app_admin());

-- --- Blocking ----------------------------------------------------------

create or replace function block_user(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Please sign in.' using errcode = 'P0001';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You can''t block yourself.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from profiles where id = p_user_id) then
    raise exception 'That player no longer exists.' using errcode = 'P0002';
  end if;

  insert into blocks (blocker_id, blocked_id)
  values (auth.uid(), p_user_id)
  on conflict do nothing;   -- blocking twice is not an error, it is a no-op

  -- A block withdraws any PENDING invitation in either direction. Leaving one
  -- alive would let a blocked person arrive in your club by a side door.
  -- Decided invitations are history and stay as they are.
  delete from club_invites
   where status = 'pending'
     and ((invitee_id = p_user_id  and inviter_id = auth.uid())
       or (invitee_id = auth.uid() and inviter_id = p_user_id));
end;
$$;

create or replace function unblock_user(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Please sign in.' using errcode = 'P0001';
  end if;
  delete from blocks where blocker_id = auth.uid() and blocked_id = p_user_id;
end;
$$;

/** Everyone you have blocked, for the list in Settings. Names come from the
 *  profile directly rather than through get_public_profile, which would show
 *  you "Player" for every row and make the list useless. */
create or replace function my_blocks()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'id', p.id, 'display_name', p.display_name,
      'avatar_url', p.avatar_url, 'blocked_at', b.created_at
    ) order by b.created_at desc),
    '[]'::jsonb)
  from blocks b
  join profiles p on p.id = b.blocked_id
  where b.blocker_id = auth.uid();
$$;

/** True when either of the two has blocked the other. The helper the rest of
 *  the app asks, so no caller has to remember the symmetry. */
create or replace function is_blocked_between(p_a uuid, p_b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from blocks
     where (blocker_id = p_a and blocked_id = p_b)
        or (blocker_id = p_b and blocked_id = p_a)
  );
$$;

-- --- Reporting ---------------------------------------------------------

create or replace function report_user(p_user_id uuid, p_reason text, p_detail text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_profile profiles%rowtype;
  v_id uuid;
  v_recent int;
begin
  if auth.uid() is null then
    raise exception 'Please sign in.' using errcode = 'P0001';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You can''t report yourself.' using errcode = 'P0001';
  end if;
  select * into v_profile from profiles where id = p_user_id;
  if not found then
    raise exception 'That player no longer exists.' using errcode = 'P0002';
  end if;
  if p_reason not in ('abuse','impersonation','inappropriate_photo','inappropriate_name','spam','other') then
    raise exception 'Pick a reason.' using errcode = 'P0001';
  end if;

  -- A cap, not a gate. Reporting the same person repeatedly adds nothing to
  -- the queue except noise, and a stream of reports is also how someone
  -- harasses by proxy.
  select count(*) into v_recent
    from reports
   where reporter_id = auth.uid()
     and created_at > now() - interval '24 hours';
  if v_recent >= 10 then
    raise exception 'That''s a lot of reports today. Email us instead and a person will read it.'
      using errcode = 'P0001';
  end if;

  insert into reports (reporter_id, subject_user_id, reason, detail, subject_snapshot)
  values (
    auth.uid(), p_user_id, p_reason, nullif(btrim(coalesce(p_detail, '')), ''),
    -- Frozen at the moment of the report: a photo swapped an hour later
    -- shouldn't erase what was complained about.
    jsonb_build_object(
      'display_name', v_profile.display_name,
      'avatar_url',   v_profile.avatar_url,
      'bio',          v_profile.bio,
      'captured_at',  now()
    )
  )
  returning id into v_id;

  return jsonb_build_object('id', v_id);
end;
$$;

-- --- The profile, with blocking applied ---------------------------------

create or replace function get_public_profile(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_profile profiles%rowtype;
  v_teams   jsonb;
  v_i_blocked  boolean := false;   -- 0053
  v_blocked_me boolean := false;   -- 0053
  v_wins    int := 0;
  v_losses  int := 0;
  v_draws   int := 0;
  v_form    jsonb;
  v_trend   jsonb;
begin
  select * into v_profile from profiles where id = p_user_id;
  if not found then
    return null;
  end if;

  -- Blocking (0053). Redacting the ROW rather than the returned object means
  -- every key built below follows automatically, and a key added later can't
  -- forget to.
  --
  -- Symmetric on purpose: if either of you has blocked the other, neither sees
  -- the other's name, photo or bio. A one-way block that still let the blocked
  -- person study the profile of someone avoiding them would be worse than
  -- nothing. The record and rating stay — they belong to the sessions other
  -- people played, and they identify nobody once the name is gone.
  if auth.uid() is not null and auth.uid() <> p_user_id then
    select exists (select 1 from blocks where blocker_id = auth.uid() and blocked_id = p_user_id),
           exists (select 1 from blocks where blocker_id = p_user_id and blocked_id = auth.uid())
      into v_i_blocked, v_blocked_me;

    if v_i_blocked or v_blocked_me then
      v_profile.display_name := 'Player';
      v_profile.avatar_url   := null;
      v_profile.bio          := null;
    end if;
  end if;

  select coalesce(
           jsonb_agg(
             jsonb_build_object('id', c.id, 'name', c.name, 'logo_url', c.logo_url, 'role', cm.role)
             order by cm.joined_at
           ),
           '[]'::jsonb
         )
    into v_teams
    from club_members cm
    join clubs c on c.id = cm.club_id
   where cm.user_id = p_user_id;

  select
    count(*) filter (where (mp.side = 'A' and m.outcome = 'win_a')
                        or  (mp.side = 'B' and m.outcome = 'win_b')),
    count(*) filter (where (mp.side = 'A' and m.outcome = 'win_b')
                        or  (mp.side = 'B' and m.outcome = 'win_a')),
    count(*) filter (where m.outcome = 'draw')
    into v_wins, v_losses, v_draws
    from match_participants mp
    join players p on p.id = mp.player_id
    join matches m on m.id = mp.match_id
   where p.linked_user_id = p_user_id
     and m.status = 'final'
     and m.outcome in ('win_a', 'win_b', 'draw');

  select coalesce(jsonb_agg(res order by ord), '[]'::jsonb)
    into v_form
    from (
      select
        case
          when (mp.side = 'A' and m.outcome = 'win_a') or (mp.side = 'B' and m.outcome = 'win_b') then 'W'
          when m.outcome = 'draw' then 'D'
          else 'L'
        end as res,
        row_number() over (order by m.updated_at desc) as ord
      from match_participants mp
      join players p on p.id = mp.player_id
      join matches m on m.id = mp.match_id
     where p.linked_user_id = p_user_id
       and m.status = 'final'
       and m.outcome in ('win_a', 'win_b', 'draw')
     order by m.updated_at desc
     limit 5
    ) f;

  select coalesce(jsonb_agg(jsonb_build_object('rating', rating, 'delta', delta) order by created_at), '[]'::jsonb)
    into v_trend
    from (
      select rating, delta, created_at
        from rating_history
       where user_id = p_user_id
       order by created_at desc
       limit 12
    ) h;

  return jsonb_build_object(
    'id',           v_profile.id,
    'display_name', v_profile.display_name,
    'avatar_url',   v_profile.avatar_url,
    'bio',          v_profile.bio,          -- new in 0036
    'rating',       v_profile.rating,
    'rating_games', v_profile.rating_games,
    'provisional',  v_profile.rating_deviation > 110,
    'member_since', v_profile.created_at,
    'teams',        v_teams,
    'wins',         v_wins,
    'losses',       v_losses,
    'draws',        v_draws,
    'form',         v_form,
    'rating_trend', v_trend,
    -- Only the blocker is told. Being blocked is not something we announce:
    -- it turns a quiet act of avoidance into a confrontation, which is the
    -- thing blocking exists to prevent.
    'blocked_by_me', v_i_blocked
  );
end;
$$;
-- --- Grants -------------------------------------------------------------

revoke all on function block_user(uuid)          from anon;
revoke all on function unblock_user(uuid)        from anon;
revoke all on function my_blocks()               from anon;
revoke all on function report_user(uuid, text, text) from anon;
revoke all on function is_blocked_between(uuid, uuid) from anon;

grant execute on function block_user(uuid)             to authenticated;
grant execute on function unblock_user(uuid)           to authenticated;
grant execute on function my_blocks()                  to authenticated;
grant execute on function report_user(uuid, text, text) to authenticated;
grant execute on function is_blocked_between(uuid, uuid) to authenticated;
-- get_public_profile stays readable by anon: a shared profile link has to work
-- for someone who hasn't signed up. Blocking simply never applies to a visitor
-- with no account, because there is nobody for them to have blocked.
grant execute on function get_public_profile(uuid) to anon, authenticated;

comment on table blocks is
  'Content and contact, not presence. Hides profiles and peer lists both ways and kills invitations; never alters a session both people played.';
comment on table reports is
  'Write-only from the app: you can file one, nobody can read whose. subject_snapshot freezes the complained-of profile so it cannot be edited away.';
