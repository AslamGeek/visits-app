import { API_TIMEOUT_MS, GAS_WEB_APP_URL } from './config'
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

function withTimeout(signal?: AbortSignal): {
  signal: AbortSignal
  cancel: () => void
} {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), API_TIMEOUT_MS)
  signal?.addEventListener('abort', () => controller.abort(), { once: true })
  return {
    signal: controller.signal,
    cancel: () => window.clearTimeout(timer),
  }
}

async function getBootstrap(): Promise<BootstrapPayload> {
  const timeout = withTimeout()
  try {
    const url = new URL(GAS_WEB_APP_URL)
    url.searchParams.set('action', 'bootstrap')
    url.searchParams.set('_', Date.now().toString())
    const response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      redirect: 'follow',
      signal: timeout.signal,
    })
    if (!response.ok) throw new Error(`Sync service returned ${response.status}`)
    const data = (await response.json()) as BootstrapPayload
    if (!data.success) throw new Error(data.message || 'Could not load sheet data')
    return data
  } finally {
    timeout.cancel()
  }
}

async function postOperation(item: QueueItem): Promise<Record<string, unknown>> {
  const timeout = withTimeout()
  try {
    const response = await fetch(GAS_WEB_APP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: item.action,
        opId: item.opId,
        payload: item.payload,
      }),
      cache: 'no-store',
      redirect: 'follow',
      signal: timeout.signal,
    })
    if (!response.ok) throw new Error(`Sync service returned ${response.status}`)
    const data = (await response.json()) as Record<string, unknown>
    if (data.success !== true) {
      throw new Error(String(data.message || 'A queued change could not be saved'))
    }
    return data
  } finally {
    timeout.cancel()
  }
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
  if (!navigator.onLine) {
    emit({ phase: 'offline', pending: await db.queue.count() })
    return
  }

  emit({ phase: 'syncing', pending: await db.queue.count() })
  try {
    await pushQueue()
    const bootstrap = await getBootstrap()
    await applyBootstrap(bootstrap)
    await setMeta('lastSuccessfulSync', new Date().toISOString())
    emit({ phase: 'idle', pending: await db.queue.count() })
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
