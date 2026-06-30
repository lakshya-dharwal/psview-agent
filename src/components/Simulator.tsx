import { useState } from 'react'
import { respondToCandidate } from '../lib/api'
import type {
  AwakenedData,
  CandidateResponse,
  ConversationTurn,
} from '../types/agent'
import { AwakeningLoader } from './ConfigForm'

interface Props {
  sessionId: string
  data: AwakenedData
  initialThread?: ConversationTurn[]
  onStartOver: () => void
}

export default function Simulator({
  sessionId,
  data,
  initialThread = [],
  onStartOver,
}: Props) {
  const [thread, setThread] = useState<ConversationTurn[]>(initialThread)
  const [reply, setReply] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const closed =
    thread.length > 0 && thread[thread.length - 1].agent.next_action === 'close'

  async function send() {
    if (!reply.trim() || loading) return
    setError(null)
    setLoading(true)
    const candidate_reply = reply.trim()
    try {
      const response: CandidateResponse = await respondToCandidate(
        sessionId,
        candidate_reply,
      )
      setThread((t) => [
        ...t,
        { candidate_reply, agent: response, timestamp: new Date().toISOString() },
      ])
      setReply('')
    } catch (err) {
      setError(
        'Agent encountered an error generating the response. Try again.',
      )
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-16">
      <header className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <p className="text-[11px] tracking-[0.1em] uppercase text-ink">
            Step 3 — Simulator
          </p>
          <button
            type="button"
            onClick={onStartOver}
            className="text-[11px] tracking-[0.08em] uppercase text-muted hover:text-ink transition-colors underline-offset-4 hover:underline shrink-0"
          >
            Start Over
          </button>
        </div>
        <h1 className="font-serif text-4xl sm:text-5xl text-ink leading-[1.1]">
          Simulate candidate reply.
        </h1>
        <p className="text-body max-w-2xl leading-relaxed">
          {data.agent_name} ({data.archetype}) drafted{' '}
          {data.campaign_plan.total_messages} touchpoints. Reply as the candidate
          and watch the agent classify the signal, decide its next move, and
          respond.
        </p>
      </header>

      {/* Original planned sequence (summarized) */}
      <section className="space-y-4">
        <p className="text-[11px] tracking-[0.1em] uppercase text-ink">
          Planned outreach
        </p>
        <ol className="space-y-2">
          {data.messages.map((m) => (
            <li
              key={m.sequence}
              className="text-sm text-body flex gap-3 border-b border-line pb-2"
            >
              <span className="text-muted uppercase text-[11px] tracking-[0.08em] shrink-0 pt-0.5">
                {m.channel} · {m.day_offset}
              </span>
              <span className="line-clamp-2">{m.intent}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* Live conversation */}
      {thread.length > 0 && (
        <section className="space-y-0 divide-y divide-line">
          {thread.map((turn, i) => (
            <TurnView key={i} turn={turn} />
          ))}
        </section>
      )}

      {/* Loading */}
      {loading && (
        <AwakeningLoader label="Responding" headline="The agent is reading the reply" />
      )}

      {/* Reply input / closed state */}
      {!loading &&
        (closed ? (
          <div className="border border-line rounded-[20px] p-8 text-center space-y-2">
            <span className="inline-block text-[11px] tracking-[0.1em] uppercase text-ink border border-ink rounded-full px-3 py-1">
              Engagement closed
            </span>
            <p className="text-body text-sm">
              {data.agent_name} has gracefully closed this engagement.
            </p>
          </div>
        ) : (
          <section className="space-y-4">
            <label className="block text-[11px] tracking-[0.1em] uppercase text-ink">
              Candidate reply
            </label>
            <textarea
              rows={3}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Type the candidate's reply…"
              className="w-full bg-white border border-line rounded-[2px] px-4 py-3 text-ink text-base placeholder:text-muted/60 focus:outline-none focus:border-ink resize-none"
            />
            {error && <p className="text-[13px] text-ink/70">{error}</p>}
            <button
              type="button"
              onClick={send}
              disabled={!reply.trim()}
              className="w-full bg-ink text-white uppercase text-[13px] tracking-[0.1em] py-4 rounded-full hover:opacity-90 transition-opacity disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Send Reply
            </button>
          </section>
        ))}

      {/* Dark closing bookend */}
      <ClosingSection
        agentName={data.agent_name}
        thread={thread}
        closed={closed}
      />
    </div>
  )
}

function TurnView({ turn }: { turn: ConversationTurn }) {
  const a = turn.agent
  return (
    <div className="py-8 space-y-5">
      {/* Candidate reply */}
      <div className="space-y-2">
        <p className="text-[11px] tracking-[0.1em] uppercase text-muted">
          Candidate replied
        </p>
        <p className="text-body whitespace-pre-line">{turn.candidate_reply}</p>
      </div>

      {/* Agent signal + reasoning */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-block text-[11px] tracking-[0.1em] uppercase text-ink border border-line rounded-full px-3 py-1">
            Signal: {a.signal}
          </span>
          {a.next_action === 'close' && (
            <span className="inline-block text-[11px] tracking-[0.1em] uppercase text-ink border border-ink rounded-full px-3 py-1">
              Engagement closed
            </span>
          )}
          {a.next_action === 'pause' && (
            <span className="inline-block text-[11px] tracking-[0.1em] uppercase text-muted border border-line rounded-full px-3 py-1">
              Holding off
            </span>
          )}
        </div>
        <p className="text-muted text-sm italic">{a.signal_reasoning}</p>
        <p className="text-muted text-sm italic">Intent: {a.intent}</p>
        <p className="text-muted text-sm italic">
          Candidate model: {a.candidate_model}
        </p>
        <p className="text-muted text-sm italic">
          Next action: {a.next_action} — {a.next_action_reasoning}
        </p>
      </div>

      {/* Response body / pause note */}
      {a.next_action === 'pause' ? (
        <div className="border border-line border-dashed rounded-[16px] p-6 bg-[#fafafa]">
          <p className="text-[11px] tracking-[0.1em] uppercase text-muted mb-2">
            Agent is holding off — no message sent
          </p>
          <p className="text-body text-sm italic whitespace-pre-line">
            {a.response_body}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-[11px] tracking-[0.1em] uppercase text-muted">
            {a.channel} ·{' '}
            {a.next_action === 'close' ? 'Closing message' : 'Response'}
          </p>
          <div className="border border-line rounded-[16px] p-6 text-ink leading-relaxed whitespace-pre-line">
            {a.response_body}
          </div>
        </div>
      )}
    </div>
  )
}

function ClosingSection({
  agentName,
  thread,
  closed,
}: {
  agentName: string
  thread: ConversationTurn[]
  closed: boolean
}) {
  const lastSignal = thread.length
    ? thread[thread.length - 1].agent.signal
    : null

  const summary = closed
    ? 'The engagement has been closed — gracefully, on the agent’s own call.'
    : thread.length === 0
      ? 'Awaiting the first candidate reply.'
      : `Last read: ${lastSignal}. The agent is still engaged.`

  return (
    <section className="closing-section -mx-6 sm:-mx-8 px-6 sm:px-8 py-16 mt-8 rounded-[24px] text-center">
      <p className="text-[11px] tracking-[0.1em] uppercase text-white/50 mb-4">
        End of session
      </p>
      <p className="font-serif text-2xl sm:text-3xl text-white leading-snug max-w-xl mx-auto">
        {agentName} — {summary}
      </p>
    </section>
  )
}
