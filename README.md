# psview-agent

A recruiting agent with constrained autonomy: given a company's context and a single campaign intent, it independently decides its own personality, strategy, and message sequence, then adapts to candidate replies in real time — no step-by-step prompting required.

## What I built

A three-step flow:

1. **Configure** — You brief the agent on your company (name, mission, culture), the ideal candidate, a tone hint, and the campaign intent.
2. **Agent Awakens** — The agent reasons about which of four personality archetypes genuinely fits your context, names itself, sets its operating principles, and generates a full multi-touch outreach sequence. You can override the archetype and have it re-plan.
3. **Simulator** — You reply as the candidate. The agent classifies the signal in the reply, autonomously decides whether to continue, pause, or close the engagement, and writes its next message — all visible and auditable.

## Architecture

**The two-call reasoning chain.** Every agent action is split into two sequential Anthropic calls instead of one:

- **Call 1 — Reason / Plan.** The agent thinks: which archetype fits, what the strategy is, what signal the candidate is sending, what it currently believes about their state of mind, and what to do next. It returns this as strict JSON.
- **Call 2 — Execute.** A second call takes Call 1's decisions as hard constraints and produces the actual artifact (the message sequence, or the next reply). It is explicitly told not to re-decide the strategy — only to execute it.

This pattern is used in both Edge Function actions:

- `plan_campaign`: Call 1 picks archetype + campaign plan → Call 2 writes the message sequence following that plan.
- `respond_to_candidate`: Call 1 classifies the signal + chooses the next action → Call 2 writes the response under that decision.

**The archetype system.** Most outreach agents reduce personality to a tone setting — warm, formal, casual. This one treats personality as a deliberate recruiting strategy: each of the four archetypes — **The Connector** (warmth, rapport), **The Challenger** (productive tension), **The Insider** (writes like a teammate), **The Strategist** (frames around the candidate's career) — implies a different opening logic, a different pressure level, and a different way of handling objections, not just different adjectives. The agent has to justify which one fits a specific company and candidate profile before it writes anything, and that reasoning is shown, not hidden.

**Supabase + Edge Function.** All Anthropic calls run server-side inside a Supabase Edge Function (`generate-agent`). The Anthropic API key lives only as a Supabase secret and is never exposed to the browser. The function reads and writes the `agent_sessions` Postgres table directly with the service role, so the frontend never needs to pass the full session back and forth — it sends an action plus an id, and the function loads what it needs.

**Guardrails.** Every reasoning and generation prompt explicitly instructs the agent to only reference details present in the provided company context, candidate profile, campaign intent, or the candidate's actual replies — and to stay general rather than inventing compensation, funding, team size, or role details that weren't given.

## Tested against hard cases

The simulator was tested against a deliberately hostile reply ("Not interested, please don't contact me again") to confirm the agent closes gracefully rather than pushing. It did — no second ask, no pressure, a clean exit that preserves the relationship. The same flow was also checked against a compensation question, a skeptical "is this AI" challenge, a genuinely interested reply, and a low-pressure objection, to confirm the agent's behavior changes appropriately rather than defaulting to one script.

## Choices

- **Why Supabase** — it matches PSVIEW's stack (Postgres + Edge Functions), and keeps the API key server-side without standing up a separate backend.
- **Why the archetype system** — it grounds the agent's personality in a deliberate, reasoned identity rather than a tone dropdown, which makes its message voice consistent, distinct across personas, and explainable.
- **Why two sequential calls instead of one** — separating reasoning from execution makes the agent's intent legible and constrainable: the plan exists as data before any message is written, so you can see why it acted, override it, and trust that the message actually follows the plan.

## What makes the agent intelligent, not just an LLM call

Before every message, the agent first reasons about intent and the candidate's state in a dedicated call, then a second call executes that plan under hard constraints — the reasoning is visible and auditable, not hidden inside a single prompt.

## What I'd improve with more time

- Org-scoped auth and tighter RLS policies (session access is currently open for this no-auth test environment)
- A real candidate profile input, beyond the "ideal candidate" description, so outreach personalizes against an actual person, not just a target profile
- Structured evaluation tests for the conversation classifier, beyond manual testing
- Human-approval gating before any real send, if this moved beyond simulation

## Setup

See [SETUP.md](./SETUP.md) for environment configuration: Supabase login/link, setting the `ANTHROPIC_API_KEY` secret, deploying the Edge Function, running the migration, and running the frontend.

## Stack

- React + TypeScript + Vite
- Tailwind CSS
- Supabase (Postgres + Edge Functions)
- Anthropic Claude (`claude-sonnet-4-6`)
- Deployed via Vercel (frontend) + Supabase (Edge Function + DB)
