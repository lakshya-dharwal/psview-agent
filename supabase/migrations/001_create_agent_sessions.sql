-- Migration: create the agent_sessions table.
-- Stores everything about a single autonomous-recruiting-agent session:
-- the company/candidate configuration, the generated agent persona + plan,
-- the outbound messages, and the live candidate conversation thread.

create table if not exists agent_sessions (
  id                      uuid primary key default gen_random_uuid(),
  created_at              timestamptz default now(),

  -- Configuration provided by the user (Stage 1 input).
  company_name            text,
  company_mission         text,
  culture_description     text,
  candidate_profile       text,
  tone_hint               text,
  campaign_intent         text,
  campaign_intent_detail  text,            -- nullable: optional free-text detail

  -- Generated agent persona (filled in Stage 2).
  archetype               text,            -- nullable
  archetype_reasoning     text,            -- nullable
  agent_name              text,            -- nullable
  personality_summary     text,            -- nullable
  principles              jsonb,           -- nullable
  campaign_plan           jsonb,           -- nullable
  messages                jsonb,           -- nullable

  -- Live candidate conversation (filled in Stage 3).
  conversation_thread     jsonb default '[]'::jsonb,

  status                  text default 'configuring'
);

-- Row Level Security ---------------------------------------------------------
-- RLS is enabled, but the policy below is intentionally fully permissive so the
-- public anon key can perform all operations. This is acceptable ONLY because
-- this is a test environment with no authentication.
--
-- !!! PRODUCTION WARNING !!!
-- Before any real deployment, REPLACE this open policy with auth-scoped policies
-- (e.g. restrict rows to the owning user via auth.uid(), and gate inserts/updates
-- behind authenticated roles). Leaving `using (true)` in production exposes the
-- entire table to anyone holding the anon key.
alter table agent_sessions enable row level security;

create policy "test_env_allow_all"
  on agent_sessions
  for all
  using (true)
  with check (true);
