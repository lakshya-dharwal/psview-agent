# psview-agent

An autonomous AI recruiting agent that designs and runs a candidate outreach campaign, then adapts in real time to candidate replies.

## What I built

A three-step flow:

1. **Configure** — You brief the agent on your company (name, mission, culture), the ideal candidate, a tone hint, and the campaign intent.
2. **Agent Awakens** — The agent reasons about which of four personality *archetypes* genuinely fits your context, names itself, sets its operating principles, and generates a full multi-touch outreach sequence. You can override the archetype and have it re-plan.
3. **Simulator** — You reply as the candidate. The agent classifies the signal in the reply, autonomously decides whether to continue, pause, or close the engagement, and writes its next message — all visible and auditable.

## Architecture

**The two-call reasoning chain.** Every agent action is split into two sequential Anthropic calls instead of one:

- **Call 1 — Reason / Plan.** The agent thinks: which archetype fits, what the strategy is, what signal the candidate is sending, what it currently believes about their state of mind, and what to do next. It returns this as strict JSON.
- **Call 2 — Execute.** A second call takes Call 1's decisions as hard constraints and produces the actual artifact (the message sequence, or the next reply). It is explicitly told **not** to re-decide the strategy — only to execute it.

This pattern is used in both Edge Function actions:
- `plan_campaign`: Call 1 picks archetype + campaign plan → Call 2 writes the message sequence following that plan.
- `respond_to_candidate`: Call 1 classifies the signal + chooses the next action → Call 2 writes the response under that decision.

**The archetype system.** Rather than a single tone slider, the agent commits to one of four deliberate personas — **The Connector** (warmth, rapport), **The Challenger** (productive tension), **The Insider** (writes like a teammate), **The Strategist** (frames around the candidate's career). It must *reason* about which fits the actual company and candidate, not default to a safe choice. This grounds the agent's voice in something more intentional than a tone keyword.

**Supabase + Edge Function.** All Anthropic calls run server-side inside a Supabase Edge Function (`generate-agent`). The Anthropic API key lives only as a Supabase secret and is **never exposed to the browser**. The function reads and writes the `agent_sessions` Postgres table directly with the service role, so the frontend never needs to pass the full session back and forth — it sends an action plus an id, and the function loads what it needs.

## Choices

- **Why Supabase** — it matches PSVIEW's stack (Postgres + Edge Functions), and keeps the API key server-side without standing up a separate backend.
- **Why the archetype system** — it grounds the agent's personality in a deliberate, reasoned identity rather than a tone dropdown, which makes its message voice consistent and explainable.
- **Why two sequential calls instead of one** — separating reasoning from execution makes the agent's intent legible and constrainable: the plan exists as data before any message is written, so you can see *why* it acted, override it, and trust that the message actually follows the plan.

## What makes the agent intelligent, not just an LLM call

> Before every message, the agent first reasons about intent and the candidate's state in a dedicated call, then a second call executes that plan under hard constraints — the reasoning is visible and auditable, not hidden inside a single prompt.

## Setup

See [SETUP.md](SETUP.md) for environment configuration: Supabase login/link, setting the `ANTHROPIC_API_KEY` secret, deploying the Edge Function, running the migration, and running the frontend.

## Stack

- React + TypeScript + Vite
- Tailwind CSS
- Supabase (Postgres + Edge Functions)
- Anthropic Claude (`claude-sonnet-4-6`)
- Deployed via Vercel (frontend) + Supabase (Edge Function + DB)
