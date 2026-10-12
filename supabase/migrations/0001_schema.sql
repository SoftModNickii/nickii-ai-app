-- Nickii AI: database schema, row-level security, storage bucket.
-- Mirrors packages/shared/src/types.ts. Change both together.
--
-- Who is who:
--   participants: anonymous Supabase Auth users (signInAnonymously), role `authenticated`.
--   Nickii: an email/password Supabase Auth user listed in public.operators (added by hand, see docs/setup.md).
--   Edge functions: service role (bypasses RLS).
--
-- Every record carries t_ms: server time, UTC, ms since epoch (docs/dataset.md "One clock").

-- ---------------------------------------------------------------- clock

create or replace function public.server_time_ms()
returns bigint
language sql
volatile
set search_path = ''
as $$ select (extract(epoch from clock_timestamp()) * 1000)::bigint $$;

grant execute on function public.server_time_ms() to anon, authenticated;

-- ---------------------------------------------------------------- operators

create table public.operators (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_operator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select exists (select 1 from public.operators where user_id = auth.uid()) $$;

grant execute on function public.is_operator() to authenticated;

-- ---------------------------------------------------------------- participants

create table public.participants (
  id uuid primary key references auth.users (id) on delete cascade,
  -- The only participant id that goes into the dataset.
  pseudonym text not null unique
    default 'p_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
  agreed_at timestamptz,
  agreement_version text,
  platform text,           -- 'ios' | 'android' | 'desktop'; operational only, dropped at export
  created_at timestamptz not null default now()
);

-- Called from the agreement screen inside the installed app. Creates or updates the caller's row.
create or replace function public.accept_agreement(p_agreement_version text, p_platform text)
returns public.participants
language plpgsql
security definer
set search_path = ''
as $$
declare
  row public.participants;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  insert into public.participants (id, agreed_at, agreement_version, platform)
  values (auth.uid(), now(), p_agreement_version, p_platform)
  on conflict (id) do update
    set agreed_at = now(), agreement_version = excluded.agreement_version, platform = excluded.platform
  returning * into row;
  return row;
end $$;

revoke execute on function public.accept_agreement(text, text) from public, anon;
grant execute on function public.accept_agreement(text, text) to authenticated;

create or replace function public.is_participant()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.participants where id = auth.uid() and agreed_at is not null)
$$;

grant execute on function public.is_participant() to authenticated;

-- ---------------------------------------------------------------- push subscriptions (operational only)

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants (id) on delete cascade,
  kind text not null default 'webpush' check (kind in ('webpush', 'apns', 'fcm')),
  endpoint text not null unique,     -- web push URL or native device token
  p256dh text,
  auth text,
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  constraint webpush_has_keys check (kind <> 'webpush' or (p256dh is not null and auth is not null))
);

create index push_subscriptions_participant on public.push_subscriptions (participant_id);

-- ---------------------------------------------------------------- messages

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants (id) on delete cascade,
  sender text not null check (sender in ('participant', 'nickii', 'system')),
  body text not null check (char_length(body) between 1 and 4000),
  input_method text check (input_method in ('typed', 'dictated', 'unknown')),
  t_ms bigint not null default public.server_time_ms(),
  created_at timestamptz not null default now()
);

create index messages_participant_time on public.messages (participant_id, t_ms);
create index messages_time on public.messages (t_ms);

-- Message time is always the server's, so nobody can backdate a message.
create or replace function public.stamp_server_time()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.t_ms := public.server_time_ms();
  return new;
end $$;

create trigger messages_stamp before insert on public.messages
  for each row execute function public.stamp_server_time();

-- ---------------------------------------------------------------- operator status (one row)

create table public.operator_status (
  id smallint primary key default 1 check (id = 1),
  state text not null default 'away' check (state in ('live', 'away')),
  status_word text not null default 'LISTENING',
  updated_t_ms bigint not null default public.server_time_ms()
);

insert into public.operator_status (id) values (1);

-- ---------------------------------------------------------------- holding line

create table public.line_entries (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants (id) on delete cascade,
  status text not null default 'invited' check (status in ('invited', 'waiting', 'live', 'done', 'left')),
  invited_t_ms bigint not null default public.server_time_ms(),
  arrived_t_ms bigint,     -- participant opened the app into the line
  started_t_ms bigint,     -- direct transmission started
  ended_t_ms bigint
);

-- One open entry per participant, and only one direct transmission at a time.
create unique index line_one_open_per_participant on public.line_entries (participant_id)
  where status in ('invited', 'waiting', 'live');
create unique index line_one_live on public.line_entries ((true)) where status = 'live';
create index line_status_time on public.line_entries (status, invited_t_ms);

-- Participant arrives in / leaves the line. They cannot change anything else about line entries.
create or replace function public.line_arrive()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.line_entries
     set status = 'waiting', arrived_t_ms = public.server_time_ms()
   where participant_id = auth.uid() and status = 'invited'
$$;

create or replace function public.line_leave()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.line_entries
     set status = 'left', ended_t_ms = public.server_time_ms()
   where participant_id = auth.uid() and status in ('invited', 'waiting')
$$;

-- Position (1 = next) and a rough wait estimate from the last 10 finished transmissions
-- (default 5 minutes each when there are none yet). Participants never see other participants.
create or replace function public.my_line_position()
returns table (status text, line_position integer, estimated_wait_ms bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select * from public.line_entries
     where participant_id = auth.uid() and status in ('invited', 'waiting', 'live')
  ),
  avg_len as (
    select coalesce(avg(ended_t_ms - started_t_ms), 300000)::bigint as ms
      from (select ended_t_ms, started_t_ms from public.line_entries
             where status = 'done' and started_t_ms is not null and ended_t_ms is not null
             order by ended_t_ms desc limit 10) recent
  ),
  ahead as (
    select count(*)::integer as n
      from public.line_entries e, mine
     where e.status in ('invited', 'waiting') and e.invited_t_ms < mine.invited_t_ms
  )
  select mine.status,
         case when mine.status = 'live' then 0 else ahead.n + 1 end,
         case when mine.status = 'live' then 0 else ahead.n::bigint * avg_len.ms
           + (select count(*) from public.line_entries where status = 'live') * avg_len.ms / 2 end
    from mine, ahead, avg_len
$$;

revoke execute on function public.line_arrive(), public.line_leave(), public.my_line_position() from public, anon;
grant execute on function public.line_arrive() to authenticated;
grant execute on function public.line_leave() to authenticated;
grant execute on function public.my_line_position() to authenticated;

-- ---------------------------------------------------------------- events (dataset)
-- t_ms: when it happened, on the server clock as measured by the device (events can be queued offline).
-- received_t_ms: when the server stored it.

create table public.operator_events (
  id bigint generated always as identity primary key,
  name text not null check (name in (
    'state_live', 'state_away', 'thread_opened', 'thread_closed',
    'compose_start', 'compose_pause', 'compose_delete', 'compose_send',
    'push_sent', 'push_broadcast', 'line_invite', 'transmission_start', 'transmission_end',
    'loop_started', 'mask_clip', 'face_capture_heartbeat'
  )),
  participant_id uuid references public.participants (id) on delete set null,
  data jsonb not null default '{}'::jsonb,
  t_ms bigint not null,
  received_t_ms bigint not null default public.server_time_ms()
);

create index operator_events_time on public.operator_events (t_ms);
create index operator_events_name_time on public.operator_events (name, t_ms desc);

create table public.participant_events (
  id bigint generated always as identity primary key,
  participant_id uuid not null references public.participants (id) on delete cascade,
  name text not null check (name in (
    'app_open', 'app_hidden', 'app_visible', 'install_gate_blocked', 'agreement_accepted',
    'push_enabled', 'push_denied', 'push_opened', 'mode_changed',
    'line_joined', 'line_left', 'transmission_seen', 'compose_start', 'message_sent'
  )),
  data jsonb not null default '{}'::jsonb,
  t_ms bigint not null,
  received_t_ms bigint not null default public.server_time_ms()
);

create index participant_events_time on public.participant_events (t_ms);

-- Clock offsets measured by each device (face capture every 10 minutes).
create table public.clock_sync (
  id bigint generated always as identity primary key,
  device text not null,                 -- 'face-capture' | 'console' | …
  offset_ms double precision not null,  -- server - local
  round_trip_ms double precision not null,
  t_ms bigint not null default public.server_time_ms()
);

-- ---------------------------------------------------------------- inbox view for the console

-- One row per participant: when they started waiting for an answer (null = not waiting).
create view public.inbox with (security_invoker = true) as
select p.id as participant_id,
       p.pseudonym,
       last_in.t_ms as last_in_t_ms,
       last_in.body as last_in_body,
       last_out.t_ms as last_out_t_ms,
       (select min(m.t_ms) from public.messages m
         where m.participant_id = p.id and m.sender = 'participant'
           and m.t_ms > coalesce(last_out.t_ms, 0)) as waiting_since_t_ms
  from public.participants p
  left join lateral (
    select t_ms, body from public.messages
     where participant_id = p.id and sender = 'participant' order by t_ms desc limit 1
  ) last_in on true
  left join lateral (
    select t_ms from public.messages
     where participant_id = p.id and sender = 'nickii' order by t_ms desc limit 1
  ) last_out on true;

-- ---------------------------------------------------------------- row-level security

alter table public.operators enable row level security;
alter table public.participants enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.messages enable row level security;
alter table public.operator_status enable row level security;
alter table public.line_entries enable row level security;
alter table public.operator_events enable row level security;
alter table public.participant_events enable row level security;
alter table public.clock_sync enable row level security;

-- Nobody signed out reads or writes tables. Functions above are the only anon entry point (server_time_ms).
revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;
grant select on public.operators, public.participants, public.inbox to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant select, insert on public.messages to authenticated;
grant select, update on public.operator_status to authenticated;
grant select, insert, update on public.line_entries to authenticated;
grant select, insert on public.operator_events, public.participant_events, public.clock_sync to authenticated;

create policy "operators see themselves" on public.operators
  for select to authenticated using (user_id = auth.uid());

create policy "participant sees own row; operator sees all" on public.participants
  for select to authenticated using (id = auth.uid() or public.is_operator());

create policy "participant manages own push subscriptions" on public.push_subscriptions
  for all to authenticated
  using (participant_id = auth.uid())
  with check (participant_id = auth.uid() and public.is_participant());
create policy "operator sees push subscriptions" on public.push_subscriptions
  for select to authenticated using (public.is_operator());

create policy "participant reads own thread; operator reads all" on public.messages
  for select to authenticated using (participant_id = auth.uid() or public.is_operator());
create policy "participant writes into own thread" on public.messages
  for insert to authenticated
  with check (participant_id = auth.uid() and sender = 'participant' and public.is_participant());
create policy "operator replies" on public.messages
  for insert to authenticated
  with check (public.is_operator() and sender in ('nickii', 'system'));

create policy "everyone signed in reads the status" on public.operator_status
  for select to authenticated using (true);
create policy "operator sets the status" on public.operator_status
  for update to authenticated using (public.is_operator()) with check (public.is_operator());

create policy "participant sees own line entries; operator all" on public.line_entries
  for select to authenticated using (participant_id = auth.uid() or public.is_operator());
create policy "operator invites" on public.line_entries
  for insert to authenticated with check (public.is_operator());
create policy "operator runs the line" on public.line_entries
  for update to authenticated using (public.is_operator()) with check (public.is_operator());

create policy "operator events: operator only" on public.operator_events
  for all to authenticated using (public.is_operator()) with check (public.is_operator());

create policy "participant logs own events" on public.participant_events
  for insert to authenticated with check (participant_id = auth.uid() and public.is_participant());
create policy "operator reads participant events" on public.participant_events
  for select to authenticated using (public.is_operator());

create policy "clock sync: operator only" on public.clock_sync
  for all to authenticated using (public.is_operator()) with check (public.is_operator());

-- ---------------------------------------------------------------- realtime

alter publication supabase_realtime add table
  public.messages, public.operator_status, public.line_entries, public.operator_events;

-- ---------------------------------------------------------------- storage: face chunks (operator only)

insert into storage.buckets (id, name, public)
values ('face_chunks', 'face_chunks', false)
on conflict (id) do nothing;

create policy "face chunks: operator reads" on storage.objects
  for select to authenticated using (bucket_id = 'face_chunks' and public.is_operator());
create policy "face chunks: operator uploads" on storage.objects
  for insert to authenticated with check (bucket_id = 'face_chunks' and public.is_operator());
create policy "face chunks: operator overwrites" on storage.objects
  for update to authenticated using (bucket_id = 'face_chunks' and public.is_operator());
