// TypeScript types mirroring the `agent_sessions` Postgres table
// (see supabase/migrations/001_create_agent_sessions.sql).
//
// The jsonb columns (principles, campaign_plan, messages, conversation_thread)
// carry the shapes defined below.

/** The four agent archetypes the system can select. */
export type Archetype =
  | 'The Connector'
  | 'The Challenger'
  | 'The Insider'
  | 'The Strategist'

export const ARCHETYPES: Archetype[] = [
  'The Connector',
  'The Challenger',
  'The Insider',
  'The Strategist',
]

/** Outreach channels an agent may use. */
export type Channel = 'LinkedIn' | 'Email'

/** Tone selector options on the configure form. */
export type ToneHint = 'Warm' | 'Sharp' | 'Formal' | 'Ambitious'

/** Lifecycle status of a session. */
export type SessionStatus =
  | 'configuring'
  | 'awakened'
  | 'closed'

/** A guiding principle the agent operates by (jsonb element of `principles`). */
export interface Principle {
  title: string
  description: string
}

/** The agent's planned outreach campaign (jsonb `campaign_plan`). */
export interface CampaignPlan {
  total_messages: number
  channels: Channel[]
  strategy: string
  spacing_rationale: string
}

/** A single outbound message in the campaign (jsonb element of `messages`). */
export interface Message {
  sequence: number
  channel: Channel
  day_offset: string
  intent: string
  candidate_model: string
  message_body: string
}

/** How the agent classifies a candidate's reply. */
export type Signal =
  | 'Interested'
  | 'Hesitant'
  | 'Ghosting'
  | 'Hard No'
  | 'Curious'

/** The agent's autonomous decision about how to proceed. */
export type NextAction = 'continue' | 'pause' | 'close'

/** The agent's full response to a candidate reply (output of respond_to_candidate). */
export interface CandidateResponse {
  signal: Signal
  signal_reasoning: string
  next_action: NextAction
  next_action_reasoning: string
  intent: string
  candidate_model: string
  channel: Channel
  response_body: string
}

/** A single turn in the live candidate conversation (jsonb `conversation_thread`). */
export interface ConversationTurn {
  candidate_reply: string
  agent: CandidateResponse
  timestamp: string
}

/** The configuration captured by Step 1 (Configure). */
export interface ConfigFormData {
  company_name: string
  company_mission: string
  culture_description: string
  candidate_profile: string
  tone_hint: ToneHint | ''
  campaign_intent: string
  campaign_intent_detail: string
}

/** The generated persona + plan returned by the `plan_campaign` action. */
export interface AwakenedData {
  archetype: Archetype
  archetype_reasoning: string
  agent_name: string
  personality_summary: string
  principles: Principle[]
  campaign_plan: CampaignPlan
  messages: Message[]
}

/** Full row of the `agent_sessions` table. */
export interface AgentSession {
  id: string
  created_at: string
  company_name: string
  company_mission: string
  culture_description: string
  candidate_profile: string
  tone_hint: string
  campaign_intent: string
  campaign_intent_detail: string | null
  archetype: Archetype | null
  archetype_reasoning: string | null
  agent_name: string | null
  personality_summary: string | null
  principles: Principle[] | null
  campaign_plan: CampaignPlan | null
  messages: Message[] | null
  conversation_thread: ConversationTurn[]
  status: SessionStatus
}
