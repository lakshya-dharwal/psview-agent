import { useEffect, useState } from 'react'
import ConfigForm, { AwakeningLoader } from './components/ConfigForm'
import AgentAwakens from './components/AgentAwakens'
import Simulator from './components/Simulator'
import { supabase } from './lib/supabase'
import type {
  AgentSession,
  AwakenedData,
  ConfigFormData,
  ConversationTurn,
} from './types/agent'

type Step = 'configure' | 'awakened' | 'simulating'

const SESSION_PARAM = 'session'

function getSessionParam(): string | null {
  return new URLSearchParams(window.location.search).get(SESSION_PARAM)
}

function setSessionParam(id: string) {
  const url = new URL(window.location.href)
  url.searchParams.set(SESSION_PARAM, id)
  window.history.replaceState(null, '', url.toString())
}

function clearSessionParam() {
  const url = new URL(window.location.href)
  url.searchParams.delete(SESSION_PARAM)
  window.history.replaceState(null, '', url.toString())
}

function buildFormFromSession(row: AgentSession): ConfigFormData {
  return {
    company_name: row.company_name,
    company_mission: row.company_mission,
    culture_description: row.culture_description,
    candidate_profile: row.candidate_profile,
    tone_hint: (row.tone_hint as ConfigFormData['tone_hint']) || '',
    campaign_intent: row.campaign_intent,
    campaign_intent_detail: row.campaign_intent_detail ?? '',
  }
}

/** Returns null if the row is missing data required to render Step 2/3. */
function buildAwakenedFromSession(row: AgentSession): AwakenedData | null {
  if (
    !row.archetype ||
    !row.archetype_reasoning ||
    !row.agent_name ||
    !row.personality_summary ||
    !row.principles ||
    !row.campaign_plan ||
    !row.messages
  ) {
    return null
  }
  return {
    archetype: row.archetype,
    archetype_reasoning: row.archetype_reasoning,
    agent_name: row.agent_name,
    personality_summary: row.personality_summary,
    principles: row.principles,
    campaign_plan: row.campaign_plan,
    messages: row.messages,
  }
}

function App() {
  const [step, setStep] = useState<Step>('configure')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [form, setForm] = useState<ConfigFormData | null>(null)
  const [awakened, setAwakened] = useState<AwakenedData | null>(null)
  const [conversationThread, setConversationThread] = useState<
    ConversationTurn[]
  >([])

  const [restoring, setRestoring] = useState(false)
  const [restoreError, setRestoreError] = useState<string | null>(null)

  // Restore session state from the `?session=` URL param on initial load.
  useEffect(() => {
    const id = getSessionParam()
    if (!id) return

    let cancelled = false
    setRestoring(true)

    supabase
      .from('agent_sessions')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data, error }) => {
        if (cancelled) return

        if (error || !data) {
          setRestoreError(
            'We could not find that session. Starting from Step 1.',
          )
          clearSessionParam()
          setRestoring(false)
          return
        }

        const session = data as AgentSession

        if (session.status === 'configuring') {
          // Nothing to resume — the plan never finished generating.
          clearSessionParam()
          setRestoring(false)
          return
        }

        const restoredAwakened = buildAwakenedFromSession(session)
        if (!restoredAwakened) {
          setRestoreError(
            'That session is missing data and could not be restored. Starting from Step 1.',
          )
          clearSessionParam()
          setRestoring(false)
          return
        }

        setSessionId(session.id)
        setForm(buildFormFromSession(session))
        setAwakened(restoredAwakened)
        setConversationThread(session.conversation_thread ?? [])
        setStep(session.status === 'closed' ? 'simulating' : 'awakened')
        setRestoring(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  // Smoothly scroll to top on every step change, so transitions (including the
  // instant ConfigForm/AgentAwakens -> Simulator switch) never leave the
  // viewport stranded mid-page looking blank.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [step])

  function handleAwakened(
    id: string,
    data: AwakenedData,
    submitted: ConfigFormData,
  ) {
    setSessionId(id)
    setAwakened(data)
    setForm(submitted)
    setConversationThread([])
    setSessionParam(id)
    setStep('awakened')
  }

  function handleContinue() {
    if (sessionId) setSessionParam(sessionId)
    setStep('simulating')
  }

  function handleStartOver() {
    clearSessionParam()
    setSessionId(null)
    setForm(null)
    setAwakened(null)
    setConversationThread([])
    setRestoreError(null)
    setStep('configure')
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-2xl px-6 sm:px-8 py-20 sm:py-28">
        {restoring && (
          <AwakeningLoader
            label="Restoring"
            headline="Reconnecting to your session"
          />
        )}

        {!restoring && restoreError && step === 'configure' && (
          <p className="mb-8 text-[13px] text-ink/70 border border-line rounded-[2px] px-4 py-3">
            {restoreError}
          </p>
        )}

        {!restoring && step === 'configure' && (
          <ConfigForm onAwakened={handleAwakened} />
        )}

        {!restoring && step === 'awakened' && sessionId && form && awakened && (
          <AgentAwakens
            key={sessionId}
            sessionId={sessionId}
            form={form}
            data={awakened}
            onReplanned={setAwakened}
            onContinue={handleContinue}
            onStartOver={handleStartOver}
          />
        )}

        {!restoring && step === 'simulating' && sessionId && awakened && (
          <Simulator
            key={sessionId}
            sessionId={sessionId}
            data={awakened}
            initialThread={conversationThread}
            onStartOver={handleStartOver}
          />
        )}
      </div>
    </div>
  )
}

export default App
