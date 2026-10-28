-- Who is online right now, and the numbers for the console: installed, online, waiting, in line, today.

-- ---------------------------------------------------------------- presence
-- Each installed app reports every 30 s while open (and once when hidden). One row per participant.

create table public.participant_presence (
  participant_id uuid primary key references public.participants (id) on delete cascade,
  last_seen_t_ms bigint not null default public.server_time_ms(),
  visible boolean not null default true,
  mode text not null default 'chat' check (mode in ('chat', 'line', 'live')),
  platform text
);

create index participant_presence_seen on public.participant_presence (last_seen_t_ms desc);

-- Participants call this; the server sets the time so a wrong phone clock cannot make them "online".
create or replace function public.report_presence(p_visible boolean, p_mode text, p_platform text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.participant_presence (participant_id, last_seen_t_ms, visible, mode, platform)
  select auth.uid(), public.server_time_ms(), p_visible, p_mode, p_platform
   where public.is_participant()
  on conflict (participant_id) do update
    set last_seen_t_ms = excluded.last_seen_t_ms, visible = excluded.visible,
        mode = excluded.mode, platform = excluded.platform
$$;

revoke execute on function public.report_presence(boolean, text, text) from public, anon;
grant execute on function public.report_presence(boolean, text, text) to authenticated;

alter table public.participant_presence enable row level security;
grant select on public.participant_presence to authenticated;
create policy "operator sees presence" on public.participant_presence
  for select to authenticated using (public.is_operator());

alter publication supabase_realtime add table public.participant_presence;

-- ---------------------------------------------------------------- stats for the console
-- "Online" = seen in the last 90 s with the app visible. "Today" = since local midnight in the given zone.

create or replace function public.console_stats(p_timezone text default 'Europe/Vienna')
returns table (
  installed integer,          -- accepted the agreement
  with_push integer,          -- have at least one push subscription (can be reached)
  online_now integer,
  open_now integer,           -- app open, including in the background
  waiting integer,            -- waiting for an answer
  in_line integer,
  live_now integer,
  installed_today integer,
  messages_in_today integer,
  messages_out_today integer,
  pushes_today integer,
  t_ms bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with now_ms as (select public.server_time_ms() as t),
  day_start as (
    select (extract(epoch from date_trunc('day', now() at time zone p_timezone) at time zone p_timezone) * 1000)::bigint as t
  )
  select
    (select count(*)::integer from public.participants where agreed_at is not null),
    (select count(distinct participant_id)::integer from public.push_subscriptions),
    (select count(*)::integer from public.participant_presence, now_ms
      where visible and last_seen_t_ms > now_ms.t - 90000),
    (select count(*)::integer from public.participant_presence, now_ms
      where last_seen_t_ms > now_ms.t - 90000),
    (select count(*)::integer from public.inbox where waiting_since_t_ms is not null),
    (select count(*)::integer from public.line_entries where status in ('invited', 'waiting')),
    (select count(*)::integer from public.line_entries where status = 'live'),
    (select count(*)::integer from public.participants, day_start
      where agreed_at is not null and (extract(epoch from agreed_at) * 1000) >= day_start.t),
    (select count(*)::integer from public.messages, day_start where sender = 'participant' and t_ms >= day_start.t),
    (select count(*)::integer from public.messages, day_start where sender = 'nickii' and t_ms >= day_start.t),
    (select coalesce(sum((data->>'sent')::integer), 0)::integer from public.operator_events, day_start
      where name in ('push_sent', 'push_broadcast') and t_ms >= day_start.t),
    (select t from now_ms)
   where public.is_operator()
$$;

revoke execute on function public.console_stats(text) from public, anon;
grant execute on function public.console_stats(text) to authenticated;
