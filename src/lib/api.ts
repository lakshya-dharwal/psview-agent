import { supabase } from './supabase'
import type {
  AwakenedData,
  CandidateResponse,
  ConfigFormData,
  Archetype,
} from '../types/agent'

/**
 * Invoke the `generate-agent` Edge Function's `plan_campaign` action.
 * Used both for the initial plan (ConfigForm) and re-plans with a forced
 * archetype (AgentAwakens). Throws a clear Error on any failure so callers can
 * render the inline retry UI.
 */
export async function planCampaign(
  sessionId: string,
  form: ConfigFormData,
  forcedArchetype?: Archetype,
): Promise<AwakenedData> {
  const { data, error } = await supabase.functions.invoke('generate-agent', {
    body: {
      action: 'plan_campaign',
      session_id: sessionId,
      ...form,
      ...(forcedArchetype ? { forced_archetype: forcedArchetype } : {}),
    },
  })

  if (error) {
    throw new Error(error.message ?? 'Edge Function request failed.')
  }
  if (!data?.ok) {
    throw new Error(data?.error ?? 'The agent failed to generate a campaign.')
  }

  return data.data as AwakenedData
}

/**
 * Invoke the `respond_to_candidate` action. The Edge Function loads the full
 * session row itself, so only the session id and the candidate's reply text are
 * needed. Throws a clear Error on failure for the inline retry UI.
 */
export async function respondToCandidate(
  sessionId: string,
  replyText: string,
): Promise<CandidateResponse> {
  const { data, error } = await supabase.functions.invoke('generate-agent', {
    body: {
      action: 'respond_to_candidate',
      session_id: sessionId,
      reply_text: replyText,
    },
  })

  if (error) {
    throw new Error(error.message ?? 'Edge Function request failed.')
  }
  if (!data?.ok) {
    throw new Error(data?.error ?? 'The agent failed to respond.')
  }

  return data.data as CandidateResponse
}
