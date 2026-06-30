import { useState } from 'react'
import { planCampaign } from '../lib/api'
import { ARCHETYPES } from '../types/agent'
import type {
  Archetype,
  AwakenedData,
  ConfigFormData,
  Message,
} from '../types/agent'
import { AwakeningLoader } from './ConfigForm'

interface Props {
  sessionId: string
  form: ConfigFormData
  data: AwakenedData
  onReplanned: (data: AwakenedData) => void
  onContinue: () => void
  onStartOver: () => void
}

export default function AgentAwakens({
  sessionId,
  form,
  data,
  onReplanned,
  onContinue,
  onStartOver,
}: Props) {
  // The archetype currently selected in the override dropdown.
  const [selected, setSelected] = useState<Archetype>(data.archetype)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dirty = selected !== data.archetype

  async function handleReplan() {
    setError(null)
    setLoading(true)
    try {
      const next = await planCampaign(sessionId, form, selected)
      onReplanned(next)
      setSelected(next.archetype)
    } catch (err) {
      setError('Agent encountered an error generating the campaign. Try again.')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) return <AwakeningLoader />

  return (
    <div className="space-y-16">
      <header className="flex items-center justify-between gap-4">
        <p className="text-[11px] tracking-[0.1em] uppercase text-ink">
          Step 2 — Agent Awakens
        </p>
        <button
          type="button"
          onClick={onStartOver}
          className="text-[11px] tracking-[0.08em] uppercase text-muted hover:text-ink transition-colors underline-offset-4 hover:underline shrink-0"
        >
          Start Over
        </button>
      </header>

      {/* Section A — Identity */}
      <section className="border border-line rounded-[22px] p-8 sm:p-10 space-y-8">
        <div className="space-y-3">
          <h1 className="font-serif text-5xl text-ink leading-none">
            {data.agent_name}
          </h1>
          <span className="inline-block text-[11px] tracking-[0.1em] uppercase text-ink border border-line rounded-full px-3 py-1">
            {data.archetype}
          </span>
          <p className="text-body max-w-2xl leading-relaxed pt-2">
            {data.archetype_reasoning}
          </p>
          <p className="text-muted text-sm italic">
            {data.personality_summary}
          </p>
        </div>

        {/* Archetype override */}
        <div className="border-t border-line pt-6 space-y-4">
          <label className="block text-[11px] tracking-[0.1em] uppercase text-ink">
            Override archetype
          </label>
          <div className="flex flex-wrap items-center gap-4">
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value as Archetype)}
              className="bg-white border-0 border-b border-line rounded-none px-0 py-2 text-ink focus:outline-none focus:border-ink"
            >
              {ARCHETYPES.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            {dirty && (
              <button
                type="button"
                onClick={handleReplan}
                className="text-[12px] tracking-[0.08em] uppercase text-white bg-ink rounded-[3px] px-4 py-2 hover:opacity-90 transition-opacity"
              >
                Re-plan with this archetype
              </button>
            )}
          </div>
          {error && <p className="text-[13px] text-ink/70">{error}</p>}
        </div>

        {/* Principles */}
        <div className="border-t border-line pt-6 space-y-5">
          <p className="text-[11px] tracking-[0.1em] uppercase text-ink">
            Operating principles
          </p>
          <ul className="space-y-4">
            {data.principles.map((p, i) => (
              <li key={i} className="space-y-1">
                <p className="text-ink">{p.title}</p>
                <p className="text-body text-sm leading-relaxed">
                  {p.description}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Section B — Campaign plan (supporting) */}
      <section className="space-y-3 max-w-2xl">
        <p className="text-[11px] tracking-[0.1em] uppercase text-ink">
          Campaign plan
        </p>
        <p className="text-body text-sm leading-relaxed">
          {data.campaign_plan.strategy}
        </p>
        <p className="text-muted text-sm leading-relaxed">
          {data.campaign_plan.spacing_rationale}
        </p>
      </section>

      {/* Section C — Message sequence */}
      <section className="space-y-0">
        <p className="text-[11px] tracking-[0.1em] uppercase text-ink mb-6">
          Message sequence — {data.campaign_plan.total_messages} touchpoints
        </p>
        <div className="divide-y divide-line">
          {data.messages.map((m) => (
            <MessageCard key={m.sequence} message={m} />
          ))}
        </div>
      </section>

      {/* CTA */}
      <div className="pt-4">
        <button
          type="button"
          onClick={onContinue}
          className="w-full bg-ink text-white uppercase text-[13px] tracking-[0.1em] py-4 rounded-full hover:opacity-90 transition-opacity"
        >
          Continue to Simulator
        </button>
      </div>
    </div>
  )
}

function MessageCard({ message: m }: { message: Message }) {
  return (
    <article className="py-8 space-y-4">
      <p className="text-[11px] tracking-[0.1em] uppercase text-ink">
        Message {m.sequence} — {m.channel} — {m.day_offset}
      </p>
      <div className="space-y-1">
        <p className="text-muted text-sm italic">Intent: {m.intent}</p>
        <p className="text-muted text-sm italic">
          Candidate model: {m.candidate_model}
        </p>
      </div>
      <div className="border border-line rounded-[16px] p-6 text-ink leading-relaxed whitespace-pre-line">
        {m.message_body}
      </div>
    </article>
  )
}
