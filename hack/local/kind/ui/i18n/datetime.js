import moment from 'moment'
import 'moment/locale/zh-cn'
import * as upstream from 'igz-controls/utils/datetime.util'
import { getLocale, subscribe } from './locale'

export { getDateAndTimeByFormat, getFormatTime, sortListByDate } from 'igz-controls/utils/datetime.util'

export function getSupportedLocale() {
  return getLocale() === 'zh-CN' ? 'zh-CN' : upstream.getSupportedLocale()
}

export let supportedLocale = getSupportedLocale()
subscribe(() => { supportedLocale = getSupportedLocale() })

export function formatDatetime(date, fallback, options, locale = getSupportedLocale()) {
  return upstream.formatDatetime(date, fallback, options, locale)
}

export function getTimeElapsedByDate(date) {
  return moment.utc(date).locale(getLocale() === 'zh-CN' ? 'zh-cn' : 'en').fromNow()
}
