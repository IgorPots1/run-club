import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabase-admin'

type AuditPayload = Record<string, unknown>

type WriteAdminAuditEntryInput = {
  actorUserId: string
  action: string
  entityType: string
  entityId?: string | null
  payloadBefore?: AuditPayload | null
  payloadAfter?: AuditPayload | null
}

function normalizeAuditPayload(payload: AuditPayload | null | undefined): AuditPayload {
  return payload ?? {}
}

export async function writeAdminAuditEntry(input: WriteAdminAuditEntryInput) {
  try {
    const supabase = createSupabaseAdminClient()
    const { error } = await supabase.from('admin_audit_log').insert({
      actor_user_id: input.actorUserId,
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      payload_before: normalizeAuditPayload(input.payloadBefore),
      payload_after: normalizeAuditPayload(input.payloadAfter),
    })

    if (error) {
      console.error('[admin-audit] failed to insert audit entry', {
        actorUserId: input.actorUserId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        code: error.code ?? null,
        message: error.message,
        details: error.details ?? null,
      })
    }
  } catch (error) {
    console.error('[admin-audit] unexpected audit insert failure', {
      actorUserId: input.actorUserId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      error,
    })
  }
}
