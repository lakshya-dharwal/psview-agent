import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { planCampaign } from '../lib/api'
import type {
  AwakenedData,
  ConfigFormData,
  ToneHint,
} from '../types/agent'

const TONE_OPTIONS: ToneHint[] = ['Warm', 'Sharp', 'Formal', 'Ambitious']

const INTENT_PRESETS = [
  'Get a candidate to book an intro call',
  'Re-engage a candidate who has gone quiet',
  'Pitch a role to a passive candidate',
  'Close a candidate after multiple touchpoints',
]

const CUSTOM = 'Custom'

type Errors = Partial<Record<keyof ConfigFormData | 'intentSelection', string>>

interface Props {
  onAwakened: (
    sessionId: string,
    data: AwakenedData,
    form: ConfigFormData,
  ) => void
}

export default function ConfigForm({ onAwakened }: Props) {
  const [form, setForm] = useState<ConfigFormData>({
    company_name: '',
    company_mission: '',
    culture_description: '',
    candidate_profile: '',
    tone_hint: '',
    campaign_intent: '',
    campaign_intent_detail: '',
  })
  // The dropdown's selected value (a preset string or "Custom"). When "Custom",
  // the free-text input below feeds form.campaign_intent.
  const [intentSelection, setIntentSelection] = useState('')
  const [customIntent, setCustomIntent] = useState('')

  const [errors, setErrors] = useState<Errors>({})
  const [loading, setLoading] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  function set<K extends keyof ConfigFormData>(key: K, value: ConfigFormData[K]) {
    setForm((f) => ({ ...f, [key]: value }))
    setErrors((e) => ({ ...e, [key]: undefined }))
  }

  function validate(): boolean {
    const e: Errors = {}
    if (!form.company_name.trim()) e.company_name = 'Required.'
    if (!form.company_mission.trim()) e.company_mission = 'Required.'
    if (!form.culture_description.trim()) e.culture_description = 'Required.'
    if (!form.candidate_profile.trim()) e.candidate_profile = 'Required.'
    if (!form.tone_hint) e.tone_hint = 'Select a tone.'
    if (!intentSelection) {
      e.intentSelection = 'Select a campaign intent.'
    } else if (intentSelection === CUSTOM && !customIntent.trim()) {
      e.campaign_intent = 'Describe your custom intent.'
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault()
    setSubmitError(null)
    if (!validate()) return

    const campaign_intent =
      intentSelection === CUSTOM ? customIntent.trim() : intentSelection
    const payload: ConfigFormData = { ...form, campaign_intent }

    setLoading(true)
    try {
      const { data: row, error } = await supabase
        .from('agent_sessions')
        .insert({ ...payload, status: 'configuring' })
        .select('id')
        .single()
      if (error || !row) {
        throw new Error(error?.message ?? 'Could not create session.')
      }

      const awakened = await planCampaign(row.id, payload)
      onAwakened(row.id, awakened, payload)
    } catch (err) {
      setSubmitError(
        'Agent encountered an error generating the campaign. Try again.',
      )
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) return <AwakeningLoader />

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-12">
      <header className="space-y-4">
        <p className="text-[11px] tracking-[0.1em] uppercase text-ink">
          Step 1 — Configure
        </p>
        <h1 className="font-serif text-4xl sm:text-5xl text-ink leading-[1.1]">
          Brief your agent.
          <br />
          <span className="text-muted">It will wake up with a plan.</span>
        </h1>
      </header>

      <Field label="Company name" error={errors.company_name}>
        <TextInput
          value={form.company_name}
          onChange={(v) => set('company_name', v)}
          placeholder="Acme Inc."
        />
      </Field>

      <Field label="One-line mission" error={errors.company_mission}>
        <TextInput
          value={form.company_mission}
          onChange={(v) => set('company_mission', v)}
          placeholder="What you exist to do, in a sentence."
        />
      </Field>

      <Field label="Culture description" error={errors.culture_description}>
        <TextArea
          value={form.culture_description}
          onChange={(v) => set('culture_description', v)}
          placeholder="How the team works, what it values."
        />
      </Field>

      <Field label="Ideal candidate profile" error={errors.candidate_profile}>
        <TextArea
          value={form.candidate_profile}
          onChange={(v) => set('candidate_profile', v)}
          placeholder="Who you are trying to reach."
        />
      </Field>

      <Field label="Tone hint" error={errors.tone_hint}>
        <div className="flex flex-wrap gap-3">
          {TONE_OPTIONS.map((tone) => {
            const active = form.tone_hint === tone
            return (
              <button
                type="button"
                key={tone}
                onClick={() => set('tone_hint', tone)}
                className={`px-5 py-2 text-sm border rounded-[2px] transition-colors ${
                  active
                    ? 'bg-ink text-white border-ink'
                    : 'bg-white text-ink border-line hover:border-ink'
                }`}
              >
                {tone}
              </button>
            )
          })}
        </div>
      </Field>

      <Field label="Campaign intent" error={errors.intentSelection ?? errors.campaign_intent}>
        <select
          value={intentSelection}
          onChange={(e) => {
            setIntentSelection(e.target.value)
            setErrors((er) => ({
              ...er,
              intentSelection: undefined,
              campaign_intent: undefined,
            }))
          }}
          className="w-full bg-white border border-line rounded-none px-0 py-3 text-ink text-base border-x-0 border-t-0 border-b focus:outline-none focus:border-ink"
        >
          <option value="" disabled>
            Select an intent…
          </option>
          {INTENT_PRESETS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
          <option value={CUSTOM}>Custom…</option>
        </select>
        {intentSelection === CUSTOM && (
          <div className="mt-4">
            <TextInput
              value={customIntent}
              onChange={(v) => {
                setCustomIntent(v)
                setErrors((er) => ({ ...er, campaign_intent: undefined }))
              }}
              placeholder="Describe your campaign intent."
            />
          </div>
        )}
      </Field>

      <Field label="Anything specific to add?" optional>
        <TextInput
          value={form.campaign_intent_detail}
          onChange={(v) => set('campaign_intent_detail', v)}
          placeholder="Optional — extra context for the agent."
        />
      </Field>

      {submitError && (
        <p className="text-sm text-ink border border-line rounded-[2px] px-4 py-3">
          {submitError}
        </p>
      )}

      <button
        type="submit"
        className="w-full bg-ink text-white uppercase text-[13px] tracking-[0.1em] py-4 rounded-full hover:opacity-90 transition-opacity"
      >
        Configure Agent
      </button>
    </form>
  )
}

// --- Small form primitives ------------------------------------------------

function Field({
  label,
  error,
  optional,
  children,
}: {
  label: string
  error?: string
  optional?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="space-y-3">
      <label className="block text-[11px] tracking-[0.1em] uppercase text-ink">
        {label}
        {optional && <span className="text-muted normal-case"> (optional)</span>}
      </label>
      {children}
      {error && <p className="text-[13px] text-ink/70">{error}</p>}
    </div>
  )
}

function TextInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-white border-0 border-b border-line rounded-none px-0 py-3 text-ink text-base placeholder:text-muted/60 focus:outline-none focus:border-ink"
    />
  )
}

function TextArea({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <textarea
      rows={3}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-white border border-line rounded-[2px] px-4 py-3 text-ink text-base placeholder:text-muted/60 focus:outline-none focus:border-ink resize-none"
    />
  )
}

// --- Loading state --------------------------------------------------------

export function AwakeningLoader({
  label = 'Awakening',
  headline = 'The agent is reasoning about your brief',
}: {
  label?: string
  headline?: string
} = {}) {
  return (
    <div className="py-32 flex flex-col items-center justify-center text-center space-y-6">
      <p className="text-[11px] tracking-[0.1em] uppercase text-ink">{label}</p>
      <p className="font-serif text-2xl sm:text-3xl text-ink">
        {headline}
        <span className="awakening-dots" />
      </p>
      <div className="w-40 h-px bg-line overflow-hidden">
        <div className="awakening-bar h-px bg-ink" />
      </div>
    </div>
  )
}
