import {
  READ_TIMEOUT_MS,
  SYNC_API_URL,
  WRITE_TIMEOUT_MS,
} from './config'
import { db, setMeta } from './db'
import type {
  BootstrapPayload,
  Doctor,
  MasterData,
  QueueAction,
  QueueItem,
  Visit,
} from './types'

export type SyncPhase = 'offline' | 'idle' | 'syncing' | 'error'

export interface SyncDetail {
  phase: SyncPhase
  message?: string
  pending?: number
}

const SYNC_EVENT = 'medrep:sync-status'
let activeSync: Promise<void> | null = null

function emit(detail: SyncDetail): void {
  window.dispatchEvent(new CustomEvent<SyncDetail>(SYNC_EVENT, { detail }))
}

export function onSyncStatus(
  callback: (detail: SyncDetail) => void,
): () => void {
  const handler = (event: Event) => {
    callback((event as CustomEvent<SyncDetail>).detail)
  }
  window.addEventListener(SYNC_EVENT, handler)
  return () => window.removeEventListener(SYNC_EVENT, handler)
}

function withTimeout(timeoutMs: number, signal?: AbortSignal): {
  signal: AbortSignal
  cancel: () => void
} {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  signal?.addEventListener('abort', () => controller.abort(), { once: true })
  return {
    signal: controller.signal,
    cancel: () => window.clearTimeout(timer),
  }
}

async function fetchJson<T>(
  input: string | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<T> {
  const timeout = withTimeout(timeoutMs, init.signal ?? undefined)
  try {
    const response = await fetch(input, {
      ...init,
      cache: 'no-store',
      credentials: 'same-origin',
      referrerPolicy: 'no-referrer',
      signal: timeout.signal,
    })
    const text = await response.text()
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch {
      throw new Error('The sync service returned an invalid response')
    }
    if (!response.ok) {
      const message = (data as { message?: unknown }).message
      throw new Error(
        typeof message === 'string' ? message : `Sync service returned ${response.status}`,
      )
    }
    return data as T
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Sync timed out. Tap the cloud icon to try again.')
    }
    throw error
  } finally {
    timeout.cancel()
  }
}

async function getBootstrap(): Promise<BootstrapPayload> {
  const url = new URL(SYNC_API_URL, window.location.origin)
  url.searchParams.set('action', 'bootstrap')
  url.searchParams.set('_', Date.now().toString())
  const data = await fetchJson<BootstrapPayload>(url, { method: 'GET' }, READ_TIMEOUT_MS)
  if (!data.success) throw new Error(data.message || 'Could not load sheet data')
  return data
}

async function postOperation(item: QueueItem): Promise<Record<string, unknown>> {
  const data = await fetchJson<Record<string, unknown>>(SYNC_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      action: item.action,
      opId: item.opId,
      payload: item.payload,
    }),
    keepalive: true,
  }, WRITE_TIMEOUT_MS)
  if (data.success !== true) {
    throw new Error(String(data.message || 'A queued change could not be saved'))
  }
  return data
}

export async function queueChange(
  action: QueueAction,
  entityId: string,
  payload: QueueItem['payload'],
): Promise<string> {
  const opId = crypto.randomUUID()
  await db.queue.add({
    opId,
    action,
    entityId,
    payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
  })
  emit({ phase: navigator.onLine ? 'idle' : 'offline', pending: await db.queue.count() })
  return opId
}

async function pushQueue(): Promise<void> {
  const items = await db.queue.orderBy('createdAt').toArray()
  for (const item of items) {
    try {
      const result = await postOperation(item)
      await db.transaction('rw', db.queue, db.doctors, db.visits, async () => {
        if (item.action === 'upsertDoctor') {
          const doctor = (result.doctor as Doctor | undefined) ?? (item.payload as Doctor)
          await db.doctors.put({ ...doctor, syncState: 'synced' })
        }
        if (item.action === 'saveVisit') {
          const visit = item.payload as Visit
          const current = await db.visits.get(visit.localId)
          if (current) await db.visits.put({ ...current, syncState: 'synced' })
        }
        if (item.id !== undefined) await db.queue.delete(item.id)
      })
    } catch (error) {
      if (item.id !== undefined) {
        await db.queue.update(item.id, { attempts: item.attempts + 1 })
      }
      throw error
    }
  }
}

async function applyBootstrap(payload: BootstrapPayload): Promise<void> {
  const pendingDoctorIds = new Set(
    (await db.queue.where('action').equals('upsertDoctor').toArray()).map(
      (item) => item.entityId,
    ),
  )
  const pendingVisitIds = new Set(
    (await db.queue.where('action').equals('saveVisit').toArray()).map(
      (item) => item.entityId,
    ),
  )

  await db.transaction('rw', db.doctors, db.visits, db.meta, async () => {
    await db.doctors
      .filter((doctor) => doctor.syncState === 'synced' && !pendingDoctorIds.has(doctor.id))
      .delete()
    await db.visits
      .filter((visit) => visit.syncState === 'synced' && !pendingVisitIds.has(visit.localId))
      .delete()

    if (payload.doctors.length) {
      await db.doctors.bulkPut(
        payload.doctors
          .filter((doctor) => !pendingDoctorIds.has(doctor.id))
          .map((doctor) => ({ ...doctor, syncState: 'synced' as const })),
      )
    }
    if (payload.visits.length) {
      await db.visits.bulkPut(
        payload.visits
          .filter((visit) => !pendingVisitIds.has(visit.localId))
          .map((visit) => ({ ...visit, syncState: 'synced' as const })),
      )
    }

    const master: MasterData = {
      settings: payload.settings,
      products: payload.products,
    }
    await db.meta.put({ key: 'master', value: master })
    await db.meta.put({ key: 'lastSync', value: payload.serverTime })
  })
}

async function performSync(): Promise<void> {
  emit({ phase: 'syncing', pending: await db.queue.count() })
  try {
    const bootstrap = await getBootstrap()
    await applyBootstrap(bootstrap)
    await setMeta('lastSuccessfulSync', new Date().toISOString())
    const pending = await db.queue.count()
    emit({ phase: 'idle', message: 'Sheet data updated', pending })

    try {
      await pushQueue()
      emit({ phase: 'idle', pending: await db.queue.count() })
    } catch (error) {
      const message = error instanceof Error
        ? `Sheet data updated. A local change is still pending: ${error.message}`
        : 'Sheet data updated. A local change is still pending.'
      emit({ phase: 'error', message, pending: await db.queue.count() })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sync is temporarily unavailable'
    emit({ phase: 'error', message, pending: await db.queue.count() })
  }
}

export function syncNow(): Promise<void> {
  if (!activeSync) {
    activeSync = performSync().finally(() => {
      activeSync = null
    })
  }
  return activeSync
}
