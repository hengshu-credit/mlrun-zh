import moment from 'moment'
import * as upstream from 'igz-controls/utils/datetime.util'
import { getLocale, subscribe } from './locale'

export {
  getDateAndTimeByFormat,
  getFormatTime,
  sortListByDate
} from 'igz-controls/utils/datetime.util'

export function getSupportedLocale() {
  return getLocale() === 'zh-CN' ? 'zh-CN' : upstream.getSupportedLocale()
}

export let supportedLocale = getSupportedLocale()
subscribe(() => {
  supportedLocale = getSupportedLocale()
})

export function formatDatetime(date, fallback, options, locale = getSupportedLocale()) {
  return upstream.formatDatetime(date, fallback, options, locale)
}

export function getTimeElapsedByDate(date) {
  if (getLocale() === 'en') return upstream.getTimeElapsedByDate(date)
  const seconds = (moment.utc(date).valueOf() - Date.now()) / 1000
  if (!Number.isFinite(seconds)) return '-'
  const units = [
    ['year', 31536000],
    ['month', 2592000],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
    ['second', 1]
  ]
  const [unit, sizeInSeconds] = units.find(([, size]) => Math.abs(seconds) >= size) || units.at(-1)
  return new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' }).format(
    Math.round(seconds / sizeInSeconds),
    unit
  )
}
