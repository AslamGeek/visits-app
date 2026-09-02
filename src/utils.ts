import type { Doctor, Product, Visit } from './types'

export function localDateString(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function addDays(dateString: string, amount: number): string {
  const [year, month, day] = dateString.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  date.setDate(date.getDate() + amount)
  return localDateString(date)
}

export function dayName(dateString: string): string {
  const [year, month, day] = dateString.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(
    new Date(year, month - 1, day),
  )
}

export function formatDate(dateString: string): string {
  const [year, month, day] = dateString.split('-').map(Number)
  if (!year || !month || !day) return dateString
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(year, month - 1, day))
}

export function normalize(value: unknown): string {
  return String(value ?? '').trim().toLocaleLowerCase()
}

export function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

export function generateDoctorId(camp: string): string {
  const code =
    camp
      .split(/[^a-zA-Z0-9]+/)
      .filter(Boolean)
      .map((part) => part.slice(0, 2))
      .join('')
      .toUpperCase()
      .slice(0, 6) || 'DOC'
  const time = Date.now().toString(36).toUpperCase().slice(-5)
  const random = crypto.randomUUID().slice(0, 3).toUpperCase()
  return `${code}-${time}${random}`
}

export function productLabel(product: Product): string {
  return product.dosageForm
    ? `${product.name} · ${product.dosageForm}`
    : product.name
}

export function doctorProductNames(
  doctor: Doctor,
  products: Product[],
): string[] {
  return doctor.prescribingProductIds.map((id) => {
    const product = products.find(
      (item) => normalize(item.prodId) === normalize(id),
    )
    if (product) return productLabel(product)
    const legacy = products.find((item) =>
      normalize(id).includes(normalize(item.name)),
    )
    return legacy ? productLabel(legacy) : id
  })
}

export function visitLineForDoctor(doctor: Doctor): string {
  const specialty = doctor.specialties.join(', ') || 'General'
  return `${doctor.id} — ${doctor.name} (${specialty})`
}

export function doctorIdFromVisitLine(line: string): string | null {
  const separator = line.indexOf(' — ')
  return separator > 0 ? line.slice(0, separator).trim() : null
}

export function visitDoctorName(line: string): string {
  const withoutId = line.includes(' — ') ? line.split(' — ').slice(1).join(' — ') : line
  const specialtyStart = withoutId.lastIndexOf(' (')
  return (specialtyStart > 0 ? withoutId.slice(0, specialtyStart) : withoutId).trim()
}

export function buildLastVisitMap(visits: Visit[]): Map<string, string> {
  const map = new Map<string, string>()
  visits
    .filter((visit) => visit.kind === 'Visit')
    .forEach((visit) => {
      visit.doctorLines.forEach((line) => {
        const id = doctorIdFromVisitLine(line)
        const keys = [id, normalize(visitDoctorName(line))].filter(Boolean) as string[]
        keys.forEach((key) => {
          const current = map.get(key)
          if (!current || visit.date > current) map.set(key, visit.date)
        })
      })
    })
  return map
}

export function relativeVisitLabel(dateString?: string): string {
  if (!dateString) return 'Never visited'
  const [year, month, day] = dateString.split('-').map(Number)
  const then = new Date(year, month - 1, day).getTime()
  const [todayYear, todayMonth, todayDay] = localDateString().split('-').map(Number)
  const today = new Date(todayYear, todayMonth - 1, todayDay).getTime()
  const days = Math.max(0, Math.round((today - then) / 86_400_000))
  if (days === 0) return 'Visited today'
  if (days === 1) return '1 day ago'
  return `${days} days ago`
}

export function isVisitStale(dateString?: string): boolean {
  if (!dateString) return true
  const [year, month, day] = dateString.split('-').map(Number)
  const days = Math.round(
    (Date.now() - new Date(year, month - 1, day).getTime()) / 86_400_000,
  )
  return days >= 14
}
