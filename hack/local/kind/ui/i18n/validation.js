import * as upstream from 'igz-controls/utils/validation.util'
import { t } from './locale'

export {
  checkPatternsValidity,
  checkPatternsValidityAsync
} from 'igz-controls/utils/validation.util'

export function getValidationRules(...args) {
  return upstream.getValidationRules(...args).map(localizeRule)
}

export function getInternalLabelsValidationRule(...args) {
  return localizeRule(upstream.getInternalLabelsValidationRule(...args))
}

export function required(message) {
  return value => upstream.required(message ?? t('Required'))(value)
}

function localizeRule(rule) {
  return {
    ...rule,
    get label() {
      return validationLabel(rule.label)
    }
  }
}

function validationLabel(label) {
  if (typeof label !== 'string') return label
  if (t(label) !== label) return t(label)
  // These are rule descriptions, not user labels. Preserve character sets and limits.
  const prefix = label.match(/^\[(Name|Value|Key|Prefix)\]\s*/)
  if (prefix) return `[${t(prefix[1])}] ` + validationLabel(label.slice(prefix[0].length))
  const length = label.match(/^Max length [-–] (\d+) characters$/)
  if (length) return t('Maximum length: {0} characters', [length[1]])
  const colon = label.indexOf(':')
  if (colon !== -1) {
    const heading = label.slice(0, colon).trim()
    const normalized = heading.replace(/–/g, '-').replace(/\s+/g, ' ')
    const translated = t(normalized)
    if (translated !== normalized)
      return translated + label.slice(colon).replace(/\b(min|max)(?=:)/g, word => t(word))
  }
  return label
}
