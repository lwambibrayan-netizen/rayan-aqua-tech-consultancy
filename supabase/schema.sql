-- Run in the Supabase SQL editor. Authenticated users can only access rows whose
-- user_id equals their verified Supabase auth.uid(). API requests use the caller's
-- JWT and the anon key; there is deliberately no service-role-key bypass.
create extension if not exists pgcrypto;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  location text not null default '',
  project_type text not null default 'Water supply',
  client text not null default '',
  status text not null default 'Planning' check (status in ('Planning','In progress','On hold','Completed')),
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists projects_user_updated_idx on public.projects(user_id, updated_at desc);

create table if not exists public.project_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  kind text not null check (kind in ('hydraulic','boq','report','drawing','gis','calculations')),
  data jsonb not null,
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  unique(project_id, kind)
);
create index if not exists project_documents_user_project_idx on public.project_documents(user_id, project_id);

create table if not exists public.gis_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  data jsonb not null,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists gis_drafts_user_project_updated_idx on public.gis_drafts(user_id, project_id, updated_at desc);

alter table public.projects enable row level security;
alter table public.project_documents enable row level security;
alter table public.gis_drafts enable row level security;

create policy "engineers manage own projects" on public.projects for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "engineers manage own project documents" on public.project_documents for all to authenticated using (
  user_id = (select auth.uid()) and exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid()))
) with check (
  user_id = (select auth.uid()) and exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid()))
);
create policy "engineers manage own GIS drafts" on public.gis_drafts for all to authenticated using (
  user_id = (select auth.uid()) and exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid()))
) with check (
  user_id = (select auth.uid()) and exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid()))
);

grant select, insert, update, delete on public.projects, public.project_documents, public.gis_drafts to authenticated;
