export const APP_NAME = 'MedRep'

export const SPREADSHEET_ID =
  '1Zg5Rxn6TNskev1EFwwrZI9gWP1mDyifBg6ACI_YTFxU'

export const GAS_WEB_APP_URL =
  import.meta.env.VITE_GAS_WEB_APP_URL ||
  'https://script.google.com/macros/s/AKfycbzlzn1Q9C2lppXa7E8Zo1UH4QfWAvXf6ufqP0hPw7Vmvdb_hr5RduxT5iLQVIfKI4R3/exec'

export const API_TIMEOUT_MS = 30_000
export const SYNC_RETRY_DELAY_MS = 1_200
export const FOREGROUND_SYNC_INTERVAL_MS = 60_000
export const UNDO_WINDOW_MS = 8_000
export const MAX_VISIBLE_DOCTORS = 100
