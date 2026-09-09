import { useLocale } from '../i18n/locale'
import chinese from './zh-CN.json'
import english from './en.json'

export function useSqlMessages() {
  const locale = useLocale()
  return source => (locale === 'zh-CN' ? chinese[source] || source : english[source] || source)
}
