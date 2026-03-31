import { supabase } from './supabase'

export function deleteRun(runId: string) {
  return supabase.from('runs').delete().eq('id', runId)
}
