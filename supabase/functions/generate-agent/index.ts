// Supabase Edge Function: generate-agent
//
// Runs on Deno. Hosts all Anthropic API calls server-side so the API key is
// never exposed to the browser. The frontend POSTs a JSON body with an `action`
// field; this function routes to the matching handler.
//
// Stage 2 implements the real `plan_campaign` action: TWO sequential Anthropic
// calls (claude-sonnet-4-6). Call 1 reasons about the agent archetype + overall
// strategy; Call 2 generates the actual messages, executing (not re-deciding)
// Call 1's plan. After both succeed, the agent_sessions row is updated in place.
//
// `respond_to_candidate` remains a stub (Stage 3).
//
// Secrets: ANTHROPIC_API_KEY via `supabase secrets set ANTHROPIC_API_KEY=...`.
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are auto-injected by Supabase.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const MODEL = 'claude-sonnet-4-6'

// CORS — allow the frontend (any origin in this test env) to call the function.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/** Supabase client with the service role (auto-injected env vars). */
function getServiceClient() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Supabase service environment variables are not available.')
  }
  return createClient(supabaseUrl, serviceKey)
}

// ---------------------------------------------------------------------------
// Anthropic helpers
// ---------------------------------------------------------------------------

interface AnthropicContentBlock {
  type: string
  text?: string
}
interface AnthropicResponse {
  content?: AnthropicContentBlock[]
}

/** Raw call to the Anthropic Messages API. Reads the key from env only. */
async function callAnthropic(params: {
  system: string
  user: string
  maxTokens?: number
}): Promise<AnthropicResponse> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set in the function environment.')
  }

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: params.maxTokens ?? 2048,
      system: params.system,
      messages: [{ role: 'user', content: params.user }],
    }),
  })

  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Anthropic API error ${res.status}: ${detail}`)
  }

  return (await res.json()) as AnthropicResponse
}

/** Concatenate the text content blocks of an Anthropic response. */
function extractText(resp: AnthropicResponse): string {
  return (resp.content ?? [])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('')
    .trim()
}

/**
 * Parse strict JSON from a model response, defending against the most common
 * failure modes:
 *   1. direct JSON.parse
 *   2. strip ```json ... ``` / ``` ... ``` code fences, then parse
 *   3. extract the first balanced {...} object from the text, then parse
 * Throws if all strategies fail.
 */
function parseStrictJSON(text: string): unknown {
  // 1. Direct parse.
  try {
    return JSON.parse(text)
  } catch {
    // fall through
  }

  // 2. Strip code fences and parse.
  const defenced = text
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()
  if (defenced !== text) {
    try {
      return JSON.parse(defenced)
    } catch {
      // fall through
    }
  }

  // 3. Extract the first balanced {...} block (handles preamble/trailing prose
  //    and braces inside strings).
  const balanced = extractFirstBalancedObject(defenced)
  if (balanced) {
    return JSON.parse(balanced) // let a throw here propagate as a parse failure
  }

  throw new Error('Could not parse JSON from model response.')
}

/** Returns the first balanced {...} substring, or null. String-aware. */
function extractFirstBalancedObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
    } else if (ch === '{') {
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0) {
        return text.slice(start, i + 1)
      }
    }
  }
  return null
}

/**
 * Call Anthropic expecting strict JSON. Automatically retries ONCE if the
 * response cannot be parsed (per spec), then surfaces a clear error.
 */
async function callAnthropicJSON(params: {
  system: string
  user: string
  maxTokens?: number
}): Promise<unknown> {
  try {
    return parseStrictJSON(extractText(await callAnthropic(params)))
  } catch (firstErr) {
    // One automatic retry on parse/transient failure.
    try {
      return parseStrictJSON(extractText(await callAnthropic(params)))
    } catch (secondErr) {
      throw new Error(
        `Model did not return valid JSON after one retry: ${
          (secondErr as Error).message
        } (first: ${(firstErr as Error).message})`,
      )
    }
  }
}

// ---------------------------------------------------------------------------
// plan_campaign
// ---------------------------------------------------------------------------

const ARCHETYPE_CONTEXT = `The four archetypes you may choose from:
- The Connector: high warmth, builds rapport fast, references the candidate's actual background, low pressure. Best for creative/mission-driven cultures.
- The Challenger: intellectually provocative, makes the candidate feel evaluated not just pitched, creates productive tension. Best for high-performance engineering cultures.
- The Insider: writes like an existing team member, uses internal language naturally, creates an "us" feeling fast. Best for tight-knit startup cultures.
- The Strategist: frames every message around the candidate's career trajectory not the company's need, appeals to ambition. Best for senior hires and ambitious cultures.`

interface PlanInput {
  company_name: string
  company_mission: string
  culture_description: string
  candidate_profile: string
  tone_hint: string
  campaign_intent: string
  campaign_intent_detail?: string | null
  forced_archetype?: string | null
}

function contextBlock(input: PlanInput): string {
  return `Company name: ${input.company_name}
One-line mission: ${input.company_mission}
Culture description: ${input.culture_description}
Ideal candidate profile: ${input.candidate_profile}
Tone hint: ${input.tone_hint}
Campaign intent: ${input.campaign_intent}${
    input.campaign_intent_detail
      ? `\nAdditional detail: ${input.campaign_intent_detail}`
      : ''
  }`
}

// --- Call 1: archetype + strategy ---
async function planCall1(input: PlanInput): Promise<{
  archetype: string
  archetype_reasoning: string
  agent_name: string
  personality_summary: string
  principles: { title: string; description: string }[]
  campaign_plan: {
    total_messages: number
    channels: string[]
    strategy: string
    spacing_rationale: string
  }
}> {
  const forced = input.forced_archetype
  const archetypeInstruction = forced
    ? `The archetype is FIXED to "${forced}". Use it. Set "archetype" to exactly "${forced}" and tailor all reasoning, persona, principles and plan to that archetype.`
    : `You must reason about which archetype genuinely fits this specific company and candidate profile. Do not default to a safe choice — select the ONE that truly fits.`

  const system = `You are designing an autonomous AI recruiting agent. Reason carefully about the inputs and produce a persona and a high-level campaign plan.

${ARCHETYPE_CONTEXT}

${archetypeInstruction}

Only reference details that are explicitly present in the provided company context, candidate profile, or campaign intent. Do not invent specific details such as compensation, funding, team size, customer names, tech stack specifics, or role details that were not provided. If specific information was not given, stay general rather than fabricating it.

Return ONLY valid JSON, no markdown, no code fences, no preamble. The JSON must match exactly this shape:
{
  "archetype": "The Connector" | "The Challenger" | "The Insider" | "The Strategist",
  "archetype_reasoning": "2 sentences on why this archetype fits THIS company and candidate",
  "agent_name": "a natural-sounding human first name",
  "personality_summary": "one sentence on how this agent communicates",
  "principles": [
    {"title": "...", "description": "one sentence"},
    {"title": "...", "description": "one sentence"},
    {"title": "...", "description": "one sentence"}
  ],
  "campaign_plan": {
    "total_messages": <integer you decide, typically 2-4>,
    "channels": ["LinkedIn" | "Email", ...] (length must equal total_messages),
    "strategy": "2-3 sentences describing the overall approach",
    "spacing_rationale": "one sentence on the timing logic between messages and why"
  }
}`

  const result = (await callAnthropicJSON({
    system,
    user: contextBlock(input),
    maxTokens: 1536,
  })) as Awaited<ReturnType<typeof planCall1>>

  // Minimal shape validation.
  if (
    !result?.archetype ||
    !Array.isArray(result?.principles) ||
    !result?.campaign_plan ||
    !Array.isArray(result.campaign_plan.channels) ||
    typeof result.campaign_plan.total_messages !== 'number'
  ) {
    throw new Error('Call 1 returned an unexpected shape.')
  }
  return result
}

// --- Call 2: messages, executing Call 1's plan ---
async function planCall2(
  input: PlanInput,
  plan: Awaited<ReturnType<typeof planCall1>>,
): Promise<{
  messages: {
    sequence: number
    channel: string
    day_offset: string
    intent: string
    candidate_model: string
    message_body: string
  }[]
}> {
  const system = `You are the recruiting agent "${plan.agent_name}", archetype "${plan.archetype}".
${plan.personality_summary}

You have ALREADY decided the strategy. Do NOT re-decide it. Execute the plan exactly.

Campaign plan to execute:
- total_messages: ${plan.campaign_plan.total_messages}
- channel sequence (use in this order): ${JSON.stringify(plan.campaign_plan.channels)}
- strategy: ${plan.campaign_plan.strategy}
- spacing_rationale: ${plan.campaign_plan.spacing_rationale}

Principles to embody:
${plan.principles.map((p) => `- ${p.title}: ${p.description}`).join('\n')}

Write exactly ${plan.campaign_plan.total_messages} messages. The i-th message must use the i-th channel from the sequence above. Space them per the spacing rationale (e.g. "Day 1", "Day 4", ...). Each message_body must be written in the "${plan.archetype}" voice and reference REAL specifics from the company context — not generic copy.

Only reference details that are explicitly present in the provided company context, candidate profile, or campaign intent. Do not invent specific details such as compensation, funding, team size, customer names, tech stack specifics, or role details that were not provided. If specific information was not given, stay general rather than fabricating it.

Return ONLY valid JSON, no markdown, no code fences, no preamble, matching exactly:
{
  "messages": [
    {
      "sequence": 1,
      "channel": "LinkedIn" | "Email",
      "day_offset": "Day 1",
      "intent": "one sentence: what this message is trying to achieve",
      "candidate_model": "one sentence: what the agent currently believes about the candidate's state of mind at this point",
      "message_body": "the actual outreach message text"
    }
  ]
}`

  const result = (await callAnthropicJSON({
    system,
    user: contextBlock(input),
    maxTokens: 3072,
  })) as Awaited<ReturnType<typeof planCall2>>

  if (!result?.messages || !Array.isArray(result.messages)) {
    throw new Error('Call 2 returned an unexpected shape.')
  }
  if (result.messages.length !== plan.campaign_plan.total_messages) {
    throw new Error(
      `Call 2 returned ${result.messages.length} messages, expected ${plan.campaign_plan.total_messages}.`,
    )
  }
  return result
}

async function handlePlanCampaign(
  body: PlanInput & { session_id?: string },
): Promise<Response> {
  if (!body.session_id) {
    return jsonResponse({ ok: false, error: 'Missing session_id.' }, 400)
  }

  const plan = await planCall1(body)
  const { messages } = await planCall2(body, plan)

  const update = {
    archetype: plan.archetype,
    archetype_reasoning: plan.archetype_reasoning,
    agent_name: plan.agent_name,
    personality_summary: plan.personality_summary,
    principles: plan.principles,
    campaign_plan: plan.campaign_plan,
    messages,
    status: 'awakened',
  }

  // Persist to the agent_sessions row (service role; auto-injected env vars).
  const supabase = getServiceClient()
  const { error } = await supabase
    .from('agent_sessions')
    .update(update)
    .eq('id', body.session_id)
  if (error) {
    throw new Error(`Failed to persist session: ${error.message}`)
  }

  return jsonResponse({ ok: true, data: update })
}

// ---------------------------------------------------------------------------
// respond_to_candidate
// ---------------------------------------------------------------------------

type Signal =
  | 'Interested'
  | 'Hesitant'
  | 'Ghosting'
  | 'Hard No'
  | 'Curious'
type NextAction = 'continue' | 'pause' | 'close'

interface SessionRow {
  company_name: string
  company_mission: string
  culture_description: string
  candidate_profile: string
  tone_hint: string
  campaign_intent: string
  campaign_intent_detail: string | null
  archetype: string
  agent_name: string
  personality_summary: string
  principles: { title: string; description: string }[]
  campaign_plan: {
    total_messages: number
    channels: string[]
    strategy: string
    spacing_rationale: string
  }
  messages: unknown[]
  conversation_thread: ConversationTurn[]
  status: string
}

interface CandidateResponseData {
  signal: Signal
  signal_reasoning: string
  next_action: NextAction
  next_action_reasoning: string
  intent: string
  candidate_model: string
  channel: string
  response_body: string
}

interface ConversationTurn {
  candidate_reply: string
  agent: CandidateResponseData
  timestamp: string
}

/** Render the prior conversation (original sequence + live turns) as text. */
function conversationContext(session: SessionRow): string {
  const planned = (session.messages as { day_offset?: string; channel?: string; message_body?: string }[])
    .map(
      (m, i) =>
        `[Planned message ${i + 1} — ${m.channel} — ${m.day_offset}]\n${m.message_body}`,
    )
    .join('\n\n')

  const live = session.conversation_thread
    .map(
      (t, i) =>
        `[Candidate reply ${i + 1}]\n${t.candidate_reply}\n[Agent response — signal ${t.agent.signal}, action ${t.agent.next_action}]\n${t.agent.response_body}`,
    )
    .join('\n\n')

  return [
    `Original planned outreach sequence:\n${planned}`,
    live ? `Conversation so far:\n${live}` : 'No live conversation turns yet.',
  ].join('\n\n')
}

function companyContext(session: SessionRow): string {
  return `Company name: ${session.company_name}
One-line mission: ${session.company_mission}
Culture description: ${session.culture_description}
Ideal candidate profile: ${session.candidate_profile}
Tone hint: ${session.tone_hint}
Campaign intent: ${session.campaign_intent}${
    session.campaign_intent_detail
      ? `\nAdditional detail: ${session.campaign_intent_detail}`
      : ''
  }`
}

// --- Call 1: signal classification + candidate modeling ---
async function respondCall1(
  session: SessionRow,
  reply: string,
): Promise<{
  signal: Signal
  signal_reasoning: string
  next_action: NextAction
  next_action_reasoning: string
  intent: string
  candidate_model: string
}> {
  const system = `You are the recruiting agent "${session.agent_name}", archetype "${session.archetype}".
${session.personality_summary}

Principles you operate by:
${session.principles.map((p) => `- ${p.title}: ${p.description}`).join('\n')}

${ARCHETYPE_CONTEXT}

A candidate has just sent a new reply. Reason about it. Classify the reply into EXACTLY ONE signal:
- "Interested": clear positive engagement, wants to move forward.
- "Hesitant": engaging but with reservations, questions, or friction.
- "Ghosting": a long silence is implied before this reply, or the reply is non-committal after apparent silence.
- "Hard No": an explicit or strongly-implied rejection.
- "Curious": asking questions, exploring, not yet committed either way.
Use judgment from the conversation context; if ambiguous, pick the most sensible classification.

Then decide the next action autonomously:
- "continue": keep engaging with a new message.
- "pause": hold off, do not send an outbound message right now.
- "close": gracefully end the engagement.

Only reference details that are explicitly present in the provided company context, candidate profile, campaign intent, or the candidate's actual replies in this conversation. Do not invent specific details such as compensation, funding, team size, customer names, tech stack specifics, or role details that were not provided. If specific information was not given, stay general rather than fabricating it.

Return ONLY valid JSON, no markdown, no code fences, no preamble, matching exactly:
{
  "signal": "Interested" | "Hesitant" | "Ghosting" | "Hard No" | "Curious",
  "signal_reasoning": "one sentence on why this classification fits the reply",
  "next_action": "continue" | "pause" | "close",
  "next_action_reasoning": "one sentence on why the agent chose this action",
  "intent": "one sentence: what the agent will try to achieve in its response, given this signal",
  "candidate_model": "one sentence: updated belief about the candidate's state of mind based on this reply"
}`

  const user = `${companyContext(session)}

${conversationContext(session)}

The candidate's NEW reply:
${reply}`

  const result = (await callAnthropicJSON({
    system,
    user,
    maxTokens: 1024,
  })) as {
    signal: Signal
    signal_reasoning: string
    next_action: NextAction
    next_action_reasoning: string
    intent: string
    candidate_model: string
  }

  if (!result?.signal || !result?.next_action || !result?.intent) {
    throw new Error('Respond Call 1 returned an unexpected shape.')
  }
  return result
}

// --- Call 2: response generation, executing Call 1 ---
async function respondCall2(
  session: SessionRow,
  reply: string,
  decision: Awaited<ReturnType<typeof respondCall1>>,
): Promise<{ channel: string; response_body: string }> {
  const actionInstruction =
    decision.next_action === 'pause'
      ? `next_action is "pause": do NOT draft an outbound message. "response_body" must be a brief INTERNAL note (not addressed to the candidate) explaining that the agent is holding off and why.`
      : decision.next_action === 'close'
        ? `next_action is "close": write a graceful, low-pressure CLOSING message to the candidate in the "${session.archetype}" voice, leaving the door open without pressure.`
        : `next_action is "continue": write the actual next outbound message to the candidate in the "${session.archetype}" voice, referencing real specifics from the company context, advancing the stated intent.`

  const system = `You are the recruiting agent "${session.agent_name}", archetype "${session.archetype}".
${session.personality_summary}

You have ALREADY classified the signal and decided the next action. Do NOT re-classify or re-decide. Execute the decision.

Decision to execute:
- signal: ${decision.signal} (${decision.signal_reasoning})
- next_action: ${decision.next_action} (${decision.next_action_reasoning})
- intent: ${decision.intent}
- candidate_model: ${decision.candidate_model}

${actionInstruction}

Only reference details that are explicitly present in the provided company context, candidate profile, campaign intent, or the candidate's actual replies in this conversation. Do not invent specific details such as compensation, funding, team size, customer names, tech stack specifics, or role details that were not provided. If specific information was not given, stay general rather than fabricating it.

Return ONLY valid JSON, no markdown, no code fences, no preamble, matching exactly:
{
  "channel": "LinkedIn" | "Email",
  "response_body": "the actual message text, or an internal note if next_action is pause"
}`

  const user = `${companyContext(session)}

${conversationContext(session)}

The candidate's NEW reply:
${reply}`

  const result = (await callAnthropicJSON({
    system,
    user,
    maxTokens: 1536,
  })) as { channel: string; response_body: string }

  if (!result?.response_body) {
    throw new Error('Respond Call 2 returned an unexpected shape.')
  }
  return result
}

async function handleRespondToCandidate(
  body: { session_id?: string; reply_text?: string },
): Promise<Response> {
  if (!body.session_id) {
    return jsonResponse({ ok: false, error: 'Missing session_id.' }, 400)
  }
  if (!body.reply_text?.trim()) {
    return jsonResponse({ ok: false, error: 'Missing reply_text.' }, 400)
  }

  const supabase = getServiceClient()

  // Fetch the full session row; the frontend does not re-send everything.
  const { data: session, error: fetchErr } = await supabase
    .from('agent_sessions')
    .select('*')
    .eq('id', body.session_id)
    .single<SessionRow>()
  if (fetchErr || !session) {
    throw new Error(`Could not load session: ${fetchErr?.message ?? 'not found'}`)
  }

  const call1 = await respondCall1(session, body.reply_text)
  const call2 = await respondCall2(session, body.reply_text, call1)

  const responseData: CandidateResponseData = {
    signal: call1.signal,
    signal_reasoning: call1.signal_reasoning,
    next_action: call1.next_action,
    next_action_reasoning: call1.next_action_reasoning,
    intent: call1.intent,
    candidate_model: call1.candidate_model,
    channel: call2.channel,
    response_body: call2.response_body,
  }

  const newTurn: ConversationTurn = {
    candidate_reply: body.reply_text,
    agent: responseData,
    timestamp: new Date().toISOString(),
  }

  const conversation_thread = [
    ...(session.conversation_thread ?? []),
    newTurn,
  ]
  const status = call1.next_action === 'close' ? 'closed' : 'awakened'

  const { error: updateErr } = await supabase
    .from('agent_sessions')
    .update({ conversation_thread, status })
    .eq('id', body.session_id)
  if (updateErr) {
    throw new Error(`Failed to persist conversation: ${updateErr.message}`)
  }

  return jsonResponse({ ok: true, data: responseData })
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed. Use POST.' }, 405)
  }

  let body: { action?: string; [key: string]: unknown }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid JSON body.' }, 400)
  }

  try {
    switch (body.action) {
      case 'plan_campaign':
        return await handlePlanCampaign(body as PlanInput & { session_id?: string })

      case 'respond_to_candidate':
        return await handleRespondToCandidate(
          body as { session_id?: string; reply_text?: string },
        )

      default:
        return jsonResponse(
          {
            ok: false,
            error:
              'Unknown or missing "action". Expected "plan_campaign" or "respond_to_candidate".',
          },
          400,
        )
    }
  } catch (err) {
    console.error('generate-agent error:', err)
    return jsonResponse(
      { ok: false, error: (err as Error).message ?? 'Unknown error.' },
      500,
    )
  }
})
