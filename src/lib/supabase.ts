import { createClient } from '@supabase/supabase-js'

// Supabase client for the browser. Uses the public anon key, which is safe to
// expose client-side. All privileged work (e.g. Anthropic API calls) happens in
// the `generate-agent` Edge Function, never in the browser.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. Copy .env.example to .env and set ' +
      'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
