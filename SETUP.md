# psview-agent — Setup

Stage 1 setup: provisioning Supabase (Postgres + Edge Function) and running the
frontend locally. This documents the manual steps; the app code is already
scaffolded.

## Prerequisites

- Node 18+ and npm (verified with Node 22, npm 10)
- [Supabase CLI](https://supabase.com/docs/guides/cli) (verified with 2.108)
- A Supabase project (create one at https://supabase.com/dashboard)
- An Anthropic API key (https://console.anthropic.com/)

## 1. Frontend environment variables

Copy the example file and fill in your Supabase project values:

```bash
cp .env.example .env
```

Then edit `.env`:

```
VITE_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

Both values are in your Supabase dashboard under **Project Settings → API**.
`.env` is gitignored — never commit it.

## 2. Authenticate the Supabase CLI

```bash
supabase login
```

## 3. Link this repo to your Supabase project

Replace `[ref]` with your project ref (the subdomain in your project URL,
e.g. `abcd1234`):

```bash
supabase link --project-ref [ref]
```

## 4. Run the database migration

Pushes `supabase/migrations/001_create_agent_sessions.sql` to your project:

```bash
supabase db push
```

> Note: the migration enables Row Level Security with a **fully permissive**
> policy for this no-auth test environment. Tighten it before any production use
> (see the warning in the SQL file).

## 5. Set the Anthropic API key as a Supabase secret

This makes the key available to the Edge Function (server-side only; it is never
shipped to the browser):

```bash
supabase secrets set ANTHROPIC_API_KEY=your_key_here
```

## 6. Deploy the Edge Function

```bash
supabase functions deploy generate-agent
```

## 7. Run the frontend locally

```bash
npm install   # if you haven't already
npm run dev
```

The dev server prints a local URL (default http://localhost:5173).
