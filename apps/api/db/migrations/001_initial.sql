create table if not exists users (
  id text primary key,
  email text not null unique,
  display_name text not null,
  password_hash text,
  role text not null default 'owner',
  created_at timestamptz not null default now()
);

create table if not exists threads (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  display_name text not null,
  workspace_path text not null,
  account_mode text not null default 'auto',
  pinned_account_id text,
  model text not null default 'gpt-5.5',
  status text not null default 'idle',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists messages (
  id text primary key,
  thread_id text not null references threads(id) on delete cascade,
  role text not null,
  content text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists runs (
  id text primary key,
  thread_id text not null references threads(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  account_id text,
  status text not null,
  error_code text,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists server_profiles (
  id text primary key,
  name text not null,
  host_alias text not null,
  enabled boolean not null default true,
  allowed_commands_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists codex_accounts (
  id text primary key,
  label text not null,
  email_masked text,
  plan_type text not null default 'unknown',
  status text not null default 'active',
  priority integer not null default 100,
  current_5h_usage numeric,
  current_week_usage numeric,
  reset_5h_at timestamptz,
  reset_week_at timestamptz,
  last_used_at timestamptz,
  secret_ref text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists automations (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  name text not null,
  cron_expr text not null,
  timezone text not null default 'Asia/Shanghai',
  target_thread_id text references threads(id) on delete set null,
  create_new_thread boolean not null default false,
  prompt text not null,
  enabled boolean not null default true,
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id text primary key,
  user_id text references users(id) on delete set null,
  thread_id text references threads(id) on delete set null,
  run_id text references runs(id) on delete set null,
  action text not null,
  target text,
  command text,
  exit_code integer,
  output_ref text,
  created_at timestamptz not null default now()
);

insert into users (id, email, display_name, role)
values ('usr_owner', 'owner@local', 'Owner', 'owner')
on conflict (id) do nothing;

insert into server_profiles (id, name, host_alias, enabled)
values
  ('srv_111', '111', 'ecs-111', true),
  ('srv_114', '114', 'ecs-114', true),
  ('srv_150', '150', 'local-150', true)
on conflict (id) do nothing;
