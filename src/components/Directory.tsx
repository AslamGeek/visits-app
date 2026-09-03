import { useMemo, useState } from 'react'
import {
  Bookmark,
  Check,
  ChevronRight,
  Filter,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react'
import { MAX_VISIBLE_DOCTORS } from '../config'
import {
  EMPTY_FILTERS,
  type Doctor,
  type FilterPreset,
  type FilterState,
  type MasterSettings,
  type Product,
} from '../types'
import {
  doctorProductNames,
  normalize,
  productLabel,
  unique,
} from '../utils'

interface DirectoryProps {
  doctors: Doctor[]
  products: Product[]
  settings: MasterSettings
  presets: FilterPreset[]
  filters: FilterState
  onFiltersChange: (filters: FilterState) => void
  onAdd: () => void
  onOpen: (doctor: Doctor) => void
  onSavePreset: (name: string, filters: FilterState) => void
  onDeletePreset: (id: string) => void
}

interface FilterGroup {
  key: keyof FilterState
  label: string
  items: { id: string; label: string }[]
}

function doctorHasProduct(doctor: Doctor, productId: string, products: Product[]) {
  const product = products.find(
    (item) => normalize(item.prodId) === normalize(productId),
  )
  return doctor.prescribingProductIds.some((value) => {
    if (normalize(value) === normalize(productId)) return true
    return product ? normalize(value).includes(normalize(product.name)) : false
  })
}

function matchesGroup(
  doctor: Doctor,
  key: keyof FilterState,
  values: string[],
  products: Product[],
): boolean {
  if (!values.length) return true
  return values.some((value) => {
    switch (key) {
      case 'area':
        return normalize(doctor.area) === normalize(value)
      case 'camp':
        return normalize(doctor.camp) === normalize(value)
      case 'specialty':
        return doctor.specialties.some(
          (item) => normalize(item) === normalize(value),
        )
      case 'callSchedule':
        return normalize(doctor.callSchedule) === normalize(value)
      case 'product':
        return doctorHasProduct(doctor, value, products)
      case 'potential':
        return normalize(doctor.potential) === normalize(value)
      case 'prescriber':
        return doctor.prescriber === value
    }
  })
}

function applyFilters(
  doctors: Doctor[],
  query: string,
  filters: FilterState,
  products: Product[],
) {
  const normalizedQuery = normalize(query)
  return doctors
    .filter((doctor) => {
      if (!normalizedQuery) return true
      const productNames = doctorProductNames(doctor, products)
      return [
        doctor.name,
        doctor.hospital,
        doctor.pharmacy,
        doctor.area,
        doctor.camp,
        doctor.specialties.join(' '),
        doctor.prescribingProductIds.join(' '),
        productNames.join(' '),
      ].some((value) => normalize(value).includes(normalizedQuery))
    })
    .filter((doctor) =>
      (Object.keys(filters) as (keyof FilterState)[]).every((key) =>
        matchesGroup(doctor, key, filters[key], products),
      ),
    )
    .sort((a, b) => {
      if (a.prescriber !== b.prescriber) return a.prescriber === 'Rx' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

function activeFilterCount(filters: FilterState) {
  return Object.values(filters).reduce((total, values) => total + values.length, 0)
}

const TEMPLATE_ORDER: (keyof FilterState)[] = [
  'camp',
  'area',
  'product',
  'prescriber',
  'specialty',
  'callSchedule',
  'potential',
]

const TEMPLATE_LABELS: Record<keyof FilterState, string> = {
  area: 'Area',
  camp: 'Camp',
  specialty: 'Specialty',
  callSchedule: 'Schedule',
  product: 'Product',
  potential: 'Potential',
  prescriber: 'Prescriber',
}

function sameFilters(left: FilterState, right: FilterState): boolean {
  return TEMPLATE_ORDER.every((key) => {
    const leftValues = [...left[key]].sort()
    const rightValues = [...right[key]].sort()
    return leftValues.length === rightValues.length &&
      leftValues.every((value, index) => value === rightValues[index])
  })
}

function compactLabel(value: string, maxLength = 14): string {
  const clean = value.trim()
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 1)}…` : clean
}

function automaticTemplateName(
  filters: FilterState,
  products: Product[],
  presets: FilterPreset[],
): string {
  const exact = presets.find((preset) => sameFilters(preset.filters, filters))
  if (exact) return exact.name

  const parts = TEMPLATE_ORDER.flatMap((key) => {
    const values = filters[key] as string[]
    if (!values.length) return []
    if (values.length > 1) return [`${TEMPLATE_LABELS[key]} ×${values.length}`]
    const value = key === 'product'
      ? products.find((product) => normalize(product.prodId) === normalize(values[0]))?.name || values[0]
      : values[0]
    return [compactLabel(value)]
  })
  const visibleParts = parts.slice(0, 3)
  if (parts.length > 3) visibleParts.push(`+${parts.length - 3}`)
  const baseName = visibleParts.join(' + ')
  const usedNames = new Set(presets.map((preset) => normalize(preset.name)))
  if (!usedNames.has(normalize(baseName))) return baseName

  let suffix = 2
  while (usedNames.has(normalize(`${baseName} · ${suffix}`))) suffix += 1
  return `${baseName} · ${suffix}`
}

function FilterSheet({
  open,
  doctors,
  settings,
  products,
  filters,
  presets,
  onChange,
  onClose,
  onSavePreset,
  onDeletePreset,
}: {
  open: boolean
  doctors: Doctor[]
  settings: MasterSettings
  products: Product[]
  filters: FilterState
  presets: FilterPreset[]
  onChange: (filters: FilterState) => void
  onClose: () => void
  onSavePreset: (name: string, filters: FilterState) => void
  onDeletePreset: (id: string) => void
}) {
  const callSchedules = unique([
    ...settings.callSchedules,
    ...doctors.map((doctor) => doctor.callSchedule),
  ])
  const groups: FilterGroup[] = [
    {
      key: 'prescriber',
      label: 'Prescriber',
      items: [
        { id: 'Rx', label: 'Rx' },
        { id: 'NRx', label: 'NRx' },
      ],
    },
    { key: 'area', label: 'Area', items: settings.areas.map((id) => ({ id, label: id })) },
    { key: 'camp', label: 'Camp', items: settings.camps.map((id) => ({ id, label: id })) },
    {
      key: 'specialty',
      label: 'Specialty',
      items: settings.specialties.map((id) => ({ id, label: id })),
    },
    {
      key: 'callSchedule',
      label: 'Call schedule',
      items: callSchedules.map((id) => ({ id, label: id })),
    },
    {
      key: 'product',
      label: 'Product',
      items: products.map((product) => ({
        id: product.prodId,
        label: productLabel(product),
      })),
    },
    {
      key: 'potential',
      label: 'Potential',
      items: settings.potentials.map((id) => ({ id, label: id })),
    },
  ]

  if (!open) return null

  const toggle = (key: keyof FilterState, value: string) => {
    const selected = filters[key] as string[]
    const next = selected.includes(value)
      ? selected.filter((item) => item !== value)
      : [...selected, value]
    onChange({ ...filters, [key]: next })
  }

  const savePreset = () => {
    if (activeFilterCount(filters) === 0) return
    const name = automaticTemplateName(filters, products, presets)
    onSavePreset(name, filters)
  }

  return (
    <div className="sheet-layer" role="dialog" aria-modal="true" aria-label="Doctor filters">
      <button className="sheet-backdrop" aria-label="Close filters" onClick={onClose} />
      <div className="bottom-sheet filter-sheet">
        <div className="sheet-handle" />
        <header className="sheet-header">
          <div>
            <p className="eyebrow">Directory</p>
            <h2>Filters</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close filters">
            <X size={20} />
          </button>
        </header>

        {presets.length > 0 && (
          <section className="filter-section">
            <div className="section-label"><Bookmark size={15} /> Templates</div>
            <div className="preset-list">
              {presets.map((preset) => (
                <div className="preset-chip" key={preset.id}>
                  <button onClick={() => {
                    onChange(structuredClone(preset.filters))
                    onClose()
                  }}>
                    {preset.name}
                  </button>
                  <button
                    className="preset-delete"
                    aria-label={`Delete ${preset.name}`}
                    onClick={() => onDeletePreset(preset.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {groups.map((group) => (
          <section className="filter-section" key={group.key}>
            <div className="section-label">{group.label}</div>
            {group.items.length ? (
              <div className="chip-row">
                {group.items.map((item) => {
                  const selected = (filters[group.key] as string[]).includes(item.id)
                  return (
                    <button
                      className={`choice-chip ${selected ? 'selected' : ''}`}
                      key={item.id}
                      onClick={() => toggle(group.key, item.id)}
                    >
                      {selected && <Check size={13} />}
                      {item.label}
                    </button>
                  )
                })}
              </div>
            ) : (
              <p className="muted-inline">No values in the sheet yet.</p>
            )}
          </section>
        ))}

        {activeFilterCount(filters) > 0 && (
          <section className="save-preset-row">
            <button className="secondary-button" onClick={savePreset}>
              <Bookmark size={15} /> Save template
            </button>
          </section>
        )}

        <footer className="sheet-actions">
          <button
            className="text-button"
            onClick={() => onChange(structuredClone(EMPTY_FILTERS))}
            disabled={activeFilterCount(filters) === 0}
          >
            Clear all
          </button>
          <button className="primary-button" onClick={onClose}>Show results</button>
        </footer>
      </div>
    </div>
  )
}

export function Directory({
  doctors,
  products,
  settings,
  presets,
  filters,
  onFiltersChange,
  onAdd,
  onOpen,
  onSavePreset,
  onDeletePreset,
}: DirectoryProps) {
  const [query, setQuery] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const filtered = useMemo(
    () => applyFilters(doctors, query, filters, products),
    [doctors, query, filters, products],
  )

  const metrics = useMemo(() => {
    const hospitalSet = new Set(filtered.map((doctor) => normalize(doctor.hospital)).filter(Boolean))
    const pharmacySet = new Set(filtered.map((doctor) => normalize(doctor.pharmacy)).filter(Boolean))
    return {
      total: filtered.length,
      rx: filtered.filter((doctor) => doctor.prescriber === 'Rx').length,
      nrx: filtered.filter((doctor) => doctor.prescriber === 'NRx').length,
      hospitals: hospitalSet.size,
      pharmacies: pharmacySet.size,
    }
  }, [filtered])

  const count = activeFilterCount(filters)

  return (
    <section className="page directory-page">
      <div className="directory-tools">
        <div className="search-box">
          <Search size={19} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Doctor, area, camp, product…"
            aria-label="Search doctors, hospitals, pharmacies, areas, camps, specialties, and products"
          />
          {query && (
            <button aria-label="Clear search" onClick={() => setQuery('')}>
              <X size={18} />
            </button>
          )}
        </div>
        <button
          className={`filter-button ${count ? 'active' : ''}`}
          onClick={() => setFiltersOpen(true)}
          aria-label="Open filters"
        >
          <SlidersHorizontal size={20} />
          {count > 0 && <span>{count}</span>}
        </button>
      </div>

      <div className="metrics-strip" aria-label="Directory summary">
        {[
          ['Total', metrics.total],
          ['Rx', metrics.rx],
          ['NRx', metrics.nrx],
          ['Hosp', metrics.hospitals],
          ['Pharm', metrics.pharmacies],
        ].map(([label, value]) => (
          <div className="metric" key={label}>
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>

      {count > 0 && (
        <div className="active-filter-row">
          <Filter size={14} />
          <span>{count} active</span>
          <button onClick={() => onFiltersChange(structuredClone(EMPTY_FILTERS))}>Clear</button>
        </div>
      )}

      {doctors.length === 0 ? (
        <div className="empty-card">
          <div className="empty-icon"><Plus size={22} /></div>
          <h3>Start your directory</h3>
          <p>Add your first doctor after Areas and Camps are available from the Settings sheet.</p>
          <button className="primary-button" onClick={onAdd}>Add doctor</button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-card compact">
          <Search size={24} />
          <h3>No match</h3>
          <p>Try another search or clear a filter.</p>
        </div>
      ) : (
        <div className="doctor-list">
          {filtered.slice(0, MAX_VISIBLE_DOCTORS).map((doctor) => {
            const productNames = doctorProductNames(doctor, products)
            return (
              <button
                className={`doctor-card ${doctor.prescriber === 'Rx' ? 'rx' : ''}`}
                key={doctor.id}
                onClick={() => onOpen(doctor)}
              >
                <div className="doctor-card-main">
                  <div className="doctor-title-row">
                    <h3>{doctor.name}</h3>
                  </div>
                  <p>
                    {[doctor.hospital, doctor.pharmacy].filter(Boolean).join(' · ') ||
                      doctor.camp}
                  </p>
                  <div className="mini-tags">
                    {doctor.specialties.slice(0, 2).map((specialty) => (
                      <span key={specialty}>{specialty}</span>
                    ))}
                    {doctor.potential && <span>{doctor.potential}</span>}
                  </div>
                  {doctor.prescriber === 'Rx' && productNames.length > 0 && (
                    <div className="product-line">{productNames.join(', ')}</div>
                  )}
                </div>
                <span
                  className={`rx-badge prescriber-badge ${doctor.prescriber === 'Rx' ? 'rx' : 'nrx'}`}
                >
                  {doctor.prescriber}
                </span>
                <ChevronRight className="card-chevron" size={20} />
              </button>
            )
          })}
          {filtered.length > MAX_VISIBLE_DOCTORS && (
            <p className="list-limit-note">Refine the search to see the remaining doctors.</p>
          )}
        </div>
      )}

      <FilterSheet
        open={filtersOpen}
        doctors={doctors}
        settings={settings}
        products={products}
        filters={filters}
        presets={presets}
        onChange={onFiltersChange}
        onClose={() => setFiltersOpen(false)}
        onSavePreset={onSavePreset}
        onDeletePreset={onDeletePreset}
      />
    </section>
  )
}
