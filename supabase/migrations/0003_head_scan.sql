-- Nickii's scanned head (point cloud), published from the console, shown in every participant's app.
-- File: Storage bucket `public_assets`, path head/<version>.bin (format: packages/shared/src/head_model.ts).
-- operator_status.head_version names the current file; null = the generated placeholder head.

alter table public.operator_status add column if not exists head_version text
  check (head_version is null or head_version ~ '^[A-Za-z0-9_-]{1,64}$');

-- Public bucket: anyone with the address can read (participants' apps), only operators can write.
insert into storage.buckets (id, name, public)
values ('public_assets', 'public_assets', true)
on conflict (id) do nothing;

create policy "public assets: operator uploads" on storage.objects
  for insert to authenticated with check (bucket_id = 'public_assets' and public.is_operator());
create policy "public assets: operator overwrites" on storage.objects
  for update to authenticated using (bucket_id = 'public_assets' and public.is_operator());
create policy "public assets: operator lists" on storage.objects
  for select to authenticated using (bucket_id = 'public_assets' and public.is_operator());
