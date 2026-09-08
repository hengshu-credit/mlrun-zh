import { useSyncExternalStore } from 'react'
import chinese from './zh-CN.json'

const storageKey = 'mlrun.ui.locale'
const listeners = new Set()
let locale = 'en'

export function getLocale() {
  return locale
}

export function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useLocale() {
  return useSyncExternalStore(subscribe, getLocale, () => 'en')
}

export function initializeLocale(languages = navigator.languages) {
  let saved
  try {
    saved = localStorage.getItem(storageKey)
  } catch {
    // Browser privacy policies can disable storage; in-memory switching still works.
  }
  const url = new URL(window.location.href)
  const requested = url.searchParams.get('lng')
  if (requested === 'en' || requested === 'zh-CN') {
    saved = requested
    try {
      localStorage.setItem(storageKey, requested)
    } catch {
      // Cross-application handoff also works when persistent storage is blocked.
    }
    url.searchParams.delete('lng')
    window.history.replaceState(window.history.state, '', url)
  }
  const preferred =
    saved === 'en' || saved === 'zh-CN'
      ? saved
      : /^zh(?:-|$)/i.test(languages?.[0] || '')
        ? 'zh-CN'
        : 'en'
  updateLocale(preferred)
}

export function setLocale(value) {
  if (value !== 'en' && value !== 'zh-CN') return
  try {
    localStorage.setItem(storageKey, value)
  } catch {
    // Persist when available, without making storage a prerequisite for the UI.
  }
  updateLocale(value)
}

export function t(source, values = []) {
  const message = locale === 'zh-CN' && Object.hasOwn(chinese, source) ? chinese[source] : source
  return message.replace(/\{(\d+)\}/g, (placeholder, index) =>
    index < values.length ? String(values[index]) : placeholder
  )
}

function updateLocale(value) {
  document.documentElement.lang = value
  if (locale === value) return
  locale = value
  listeners.forEach(listener => listener())
}

if (typeof window !== 'undefined') {
  initializeLocale()
  window.addEventListener('storage', event => {
    if (event.key === storageKey || event.key === null) initializeLocale()
  })
}
