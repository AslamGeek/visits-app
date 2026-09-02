import { useMemo, useState } from 'react'
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  History,
  Search,
  Store,
  Users,
  X,
} from 'lucide-react'
import type { Doctor, MasterSettings, Visit, VisitKind } from '../types'
import {
  addDays,
  buildLastVisitMap,
  dayName,
  formatDate,
  isVisitStale,
  localDateString,
  normalize,
  relativeVisitLabel,
  unique,
  visitLineForDoctor,
} from '../utils'

interface VisitsProps {
  doctors: Doctor[]
  visits: Visit[]
  settings: MasterSettings
  focusDoctorId: string | null
  onSave: (visit: Visit) => Promise<void>
}

function CalendarView({ visits }: { visits: Visit[] }) {
  const today = localDateString()
  const [month, setMonth] = useState(today.slice(0, 7))
  const [yearNumber, monthNumber] = month.split('-').map(Number)
  const firstWeekday = new Date(yearNumber, monthNumber - 1, 1).getDay()
  const daysInMonth = new Date(yearNumber, monthNumber, 0).getDate()
  const monthVisits = visits.filter((visit) => visit.date.startsWith(month))
  const byDate = new Map<string, Visit[]>()
  monthVisits.forEach((visit) => {
    byDate.set(visit.date, [...(byDate.get(visit.date) ?? []), visit])
  })

  const moveMonth = (amount: number) => {
    const date = new Date(yearNumber, monthNumber - 1 + amount, 1)
    setMonth(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`)
  }

  const monthLabel = new Intl.DateTimeFormat('en-IN', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(yearNumber, monthNumber - 1, 1))

  return (
    <div className="calendar-card">
      <div className="calendar-header">
        <button className="icon-button" onClick={() => moveMonth(-1)} aria-label="Previous month"><ChevronLeft size={19} /></button>
        <strong>{monthLabel}</strong>
        <button className="icon-button" onClick={() => moveMonth(1)} aria-label="Next month"><ChevronRight size={19} /></button>
      </div>
      <div className="calendar-weekdays">{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div>
      <div className="calendar-grid">
        {Array.from({ length: firstWeekday }).map((_, index) => <span className="calendar-empty" key={`blank-${index}`} />)}
        {Array.from({ length: daysInMonth }).map((_, index) => {
          const date = `${month}-${String(index + 1).padStart(2, '0')}`
          const entries = byDate.get(date) ?? []
          return (
            <div className={`calendar-day ${date === today ? 'today' : ''}`} key={date} title={entries.map((visit) => `${visit.camp}: ${visit.kind}`).join(', ')}>
              <span>{index + 1}</span>
              {entries.length > 0 && <div className="calendar-dots">{entries.slice(0, 3).map((visit) => <i className={visit.kind === 'Visit' ? '' : 'off'} key={visit.localId} />)}</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function VisitHistory({ visits }: { visits: Visit[] }) {
  const [mode, setMode] = useState<'list' | 'calendar'>('list')
  return (
    <section className="visit-history-section">
      <div className="section-title-row">
        <div><p className="eyebrow">Saved locally</p><h2>Visit history</h2></div>
        <div className="view-switch">
          <button className={mode === 'list' ? 'active' : ''} onClick={() => setMode('list')} aria-label="List view"><History size={17} /></button>
          <button className={mode === 'calendar' ? 'active' : ''} onClick={() => setMode('calendar')} aria-label="Calendar view"><CalendarDays size={17} /></button>
        </div>
      </div>
      {mode === 'calendar' ? <CalendarView visits={visits} /> : visits.length ? (
        <div className="history-list">
          {visits.slice(0, 40).map((visit) => (
            <article className={`history-card ${visit.kind !== 'Visit' ? 'no-visit' : ''}`} key={visit.localId}>
              <div className="history-date-block"><strong>{new Date(`${visit.date}T00:00:00`).getDate()}</strong><span>{new Intl.DateTimeFormat('en-IN', { month: 'short' }).format(new Date(`${visit.date}T00:00:00`))}</span></div>
              <div className="history-copy">
                <div><h3>{visit.camp}</h3><span className={`sync-dot ${visit.syncState}`} title={visit.syncState} /></div>
                <p>{visit.kind === 'Visit' ? `${visit.doctorCount} doctors · ${visit.pharmacyCount} pharmacies` : visit.kind}</p>
                <small>{visit.day} · {formatDate(visit.date)}</small>
              </div>
            </article>
          ))}
        </div>
      ) : <div className="empty-card compact"><History size={24} /><h3>No visits yet</h3><p>Your saved bundles will appear here.</p></div>}
    </section>
  )
}

export function Visits({ doctors, visits, settings, focusDoctorId, onSave }: VisitsProps) {
  const initialDoctor = doctors.find((doctor) => doctor.id === focusDoctorId)
  const [date, setDate] = useState(localDateString())
  const [camp, setCamp] = useState(initialDoctor?.camp ?? settings.camps[0] ?? '')
  const [kind, setKind] = useState<VisitKind>('Visit')
  const [selectedIds, setSelectedIds] = useState<string[]>(
    initialDoctor ? [initialDoctor.id] : [],
  )
  const [query, setQuery] = useState('')
  const [specialty, setSpecialty] = useState('')
  const [callSchedule, setCallSchedule] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const activeCamp = camp || settings.camps[0] || ''
  const effectiveKind: VisitKind = dayName(date) === 'Sunday' ? 'Sunday' : kind
  const campDoctors = doctors.filter((doctor) => doctor.camp === activeCamp)
  const specialties = unique(campDoctors.flatMap((doctor) => doctor.specialties))
  const callSchedules = unique(campDoctors.map((doctor) => doctor.callSchedule))
  const lastVisitMap = useMemo(() => buildLastVisitMap(visits), [visits])

  const filteredDoctors = campDoctors
    .filter((doctor) => !query || [doctor.name, doctor.hospital, doctor.pharmacy].some((value) => normalize(value).includes(normalize(query))))
    .filter((doctor) => !specialty || doctor.specialties.includes(specialty))
    .filter((doctor) => !callSchedule || doctor.callSchedule === callSchedule)
    .sort((a, b) => {
      const aDate = lastVisitMap.get(a.id) ?? lastVisitMap.get(normalize(a.name)) ?? ''
      const bDate = lastVisitMap.get(b.id) ?? lastVisitMap.get(normalize(b.name)) ?? ''
      if (aDate === bDate) return a.name.localeCompare(b.name)
      if (!aDate) return -1
      if (!bDate) return 1
      return aDate.localeCompare(bDate)
    })

  const selectedDoctors = selectedIds.map((id) => doctors.find((doctor) => doctor.id === id)).filter(Boolean) as Doctor[]
  const pharmacies = unique(selectedDoctors.map((doctor) => doctor.pharmacy))

  const toggleDoctor = (id: string) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  const selectVisible = () => {
    const visibleIds = filteredDoctors.map((doctor) => doctor.id)
    setSelectedIds((current) => unique([...current, ...visibleIds]))
  }

  const clearVisible = () => {
    const visibleIds = new Set(filteredDoctors.map((doctor) => doctor.id))
    setSelectedIds((current) => current.filter((id) => !visibleIds.has(id)))
  }

  const saveVisit = async () => {
    setError('')
    if (!activeCamp) {
      setError('Select a camp first.')
      return
    }
    if (date < localDateString()) {
      setError('Past dates cannot be logged.')
      return
    }
    if (effectiveKind === 'Visit' && selectedDoctors.length === 0) {
      setError('Select at least one doctor.')
      return
    }

    const now = new Date().toISOString()
    const visit: Visit = {
      localId: crypto.randomUUID(),
      date,
      day: dayName(date),
      camp: activeCamp,
      kind: effectiveKind,
      doctorIds: effectiveKind === 'Visit' ? selectedDoctors.map((doctor) => doctor.id) : [],
      doctorCount: effectiveKind === 'Visit' ? selectedDoctors.length : 0,
      pharmacyCount: effectiveKind === 'Visit' ? pharmacies.length : 0,
      doctorLines: effectiveKind === 'Visit' ? selectedDoctors.map(visitLineForDoctor) : [`NO_VISIT:${effectiveKind}`],
      pharmacyLines: effectiveKind === 'Visit' ? pharmacies : [],
      createdAt: now,
      syncState: 'pending',
    }
    setSaving(true)
    try {
      await onSave(visit)
      setSelectedIds([])
      setDate(addDays(date, 1))
      setKind('Visit')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save the visit.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="page visits-page">
      <div className="visit-builder">
        <div className="section-title-row visit-title-row">
          <div><p className="eyebrow">Daily call plan</p><h2>Log visits</h2></div>
          <div className="date-day"><strong>{dayName(date)}</strong><span>{formatDate(date)}</span></div>
        </div>

        {error && <div className="inline-alert error"><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error"><X size={16} /></button></div>}

        <div className="visit-basics">
          <label className="field"><span>Date</span><input type="date" min={localDateString()} value={date} onChange={(event) => setDate(event.target.value || localDateString())} /></label>
          <label className="field"><span>Camp</span><select value={activeCamp} onChange={(event) => { setCamp(event.target.value); setSelectedIds([]) }}><option value="">Select camp</option>{settings.camps.map((item) => <option key={item}>{item}</option>)}</select></label>
        </div>

        {dayName(date) === 'Sunday' ? (
          <div className="sunday-notice"><CalendarDays size={18} /><div><strong>Sunday</strong><p>No doctor selection is needed.</p></div></div>
        ) : (
          <div className="segmented-control visit-kind-control" aria-label="Visit type">
            {(['Visit', 'Holiday', 'Leave'] as VisitKind[]).map((value) => <button className={kind === value ? 'active' : ''} key={value} onClick={() => { setKind(value); if (value !== 'Visit') setSelectedIds([]) }}>{value}</button>)}
          </div>
        )}

        {effectiveKind === 'Visit' && (
          <>
            <div className="visit-filter-bar">
              <div className="search-box compact-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find doctor…" aria-label="Search doctors for visit" />{query && <button onClick={() => setQuery('')} aria-label="Clear search"><X size={16} /></button>}</div>
              <select aria-label="Filter by specialty" value={specialty} onChange={(event) => setSpecialty(event.target.value)}><option value="">All specialties</option>{specialties.map((item) => <option key={item}>{item}</option>)}</select>
              <select aria-label="Filter by call schedule" value={callSchedule} onChange={(event) => setCallSchedule(event.target.value)}><option value="">Any schedule</option>{callSchedules.map((item) => <option key={item}>{item}</option>)}</select>
            </div>

            <div className="selection-toolbar">
              <span><Users size={15} /> {selectedIds.length} selected</span>
              <div><button onClick={selectVisible}>Select visible</button><button onClick={clearVisible}>Clear visible</button></div>
            </div>

            <div className="doctor-picker" role="listbox" aria-label="Doctors in selected camp">
              {filteredDoctors.length ? filteredDoctors.map((doctor) => {
                const selected = selectedIds.includes(doctor.id)
                const lastDate = lastVisitMap.get(doctor.id) ?? lastVisitMap.get(normalize(doctor.name))
                return (
                  <button className={`picker-doctor ${selected ? 'selected' : ''}`} key={doctor.id} onClick={() => toggleDoctor(doctor.id)} role="option" aria-selected={selected}>
                    <span className="picker-check">{selected && <Check size={15} />}</span>
                    <div><strong>{doctor.name}</strong><p>{[doctor.specialties.join(', '), doctor.hospital, doctor.pharmacy].filter(Boolean).join(' · ')}</p><small className={isVisitStale(lastDate) ? 'stale' : ''}><Clock3 size={12} /> {relativeVisitLabel(lastDate)}</small></div>
                  </button>
                )
              }) : <div className="picker-empty">No doctors match this camp and filter.</div>}
            </div>

            <div className="visit-preview">
              <div className="preview-heading"><div><p className="eyebrow">Live preview</p><h3>{selectedDoctors.length} doctors · {pharmacies.length} pharmacies</h3></div><span>{activeCamp || 'No camp'}</span></div>
              {selectedDoctors.length ? <div className="preview-columns"><div><span><Users size={14} /> Doctors</span>{selectedDoctors.map((doctor) => <p key={doctor.id}>{doctor.name}</p>)}</div><div><span><Store size={14} /> Pharmacies</span>{pharmacies.length ? pharmacies.map((pharmacy) => <p key={pharmacy}>{pharmacy}</p>) : <p>None linked</p>}</div></div> : <p className="muted-inline">Tap doctors above to build today’s bundle.</p>}
            </div>
          </>
        )}

        <button className="primary-button save-visit-button" onClick={saveVisit} disabled={saving || !activeCamp || (effectiveKind === 'Visit' && selectedIds.length === 0)}>
          <CalendarDays size={18} /> {saving ? 'Saving locally…' : effectiveKind === 'Visit' ? 'Save visit bundle' : `Save ${effectiveKind}`}
        </button>
      </div>

      <VisitHistory visits={visits} />
    </section>
  )
}
