create extension if not exists pgcrypto;

create table public.files (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  mime text not null,
  size bigint not null,
  tg_file_id text not null,          -- Telegram file_id (never sent to clients)
  tg_message_id bigint not null,
  created_at timestamptz not null default now()
);

create table public.share_tokens (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references public.files(id) on delete cascade,
  token_hash text not null unique,   -- SHA-256 of the token; raw token is never stored
  expires_at timestamptz not null,
  max_views int not null default 5 check (max_views between 1 and 100),
  views int not null default 0,
  revoked boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.share_tokens (file_id);
create index on public.files (owner_id);

alter table public.files enable row level security;
alter table public.share_tokens enable row level security;

-- Owners can list/delete their files. Inserts happen only via the `upload` Edge Function (service role).
create policy "owner reads files"   on public.files for select using (owner_id = auth.uid());
create policy "owner deletes files" on public.files for delete using (owner_id = auth.uid());

-- Owners can see and revoke tokens for their files. Tokens are created only by Edge Functions.
create policy "owner reads tokens" on public.share_tokens for select
  using (exists (select 1 from public.files f where f.id = file_id and f.owner_id = auth.uid()));
create policy "owner revokes tokens" on public.share_tokens for update
  using (exists (select 1 from public.files f where f.id = file_id and f.owner_id = auth.uid()))
  with check (exists (select 1 from public.files f where f.id = file_id and f.owner_id = auth.uid()));

-- Atomic validate-and-consume: one statement checks expiry/revocation/limit and increments views.
create or replace function public.consume_token(p_hash text)
returns table (file_id uuid, name text, mime text, size bigint, expires_at timestamptz)
language sql security definer set search_path = public as $$
  update share_tokens t set views = t.views + 1
  from files f
  where t.token_hash = p_hash and not t.revoked and t.expires_at > now()
    and t.views < t.max_views and f.id = t.file_id
  returning f.id, f.name, f.mime, f.size, t.expires_at;
$$;
revoke all on function public.consume_token(text) from public, anon, authenticated;
grant execute on function public.consume_token(text) to service_role;
