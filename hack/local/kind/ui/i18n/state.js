import upstreamGetState from '../utils/getState'
import { t } from './locale'

// Keep protocol values and CSS state classes exactly as provided by the upstream mapper.
export default function getState(state, page, kind, reason = '', error = '') {
  const result = upstreamGetState(state, page, kind, reason, error)
  const baseLabel = upstreamGetState(state, page, kind).label
  return {
    ...result,
    get label() {
      if (!baseLabel) return result.label
      const suffix = (result.label || '').slice(baseLabel.length)
      return t(baseLabel) + (reason ? suffix.replace(/^\. Reason: /, `. ${t('Reason')}: `) : suffix)
    }
  }
}
