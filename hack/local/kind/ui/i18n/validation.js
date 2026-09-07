import * as upstream from 'igz-controls/utils/validation.util'
import { t } from './locale'

export { checkPatternsValidity, checkPatternsValidityAsync } from 'igz-controls/utils/validation.util'

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
  return { ...rule, get label() { return validationLabel(rule.label) } }
}

function validationLabel(label) {
  if (typeof label !== 'string') return label
  if (t(label) !== label) return t(label)
  // These are rule descriptions, not user labels. Preserve character sets and limits.
  const colon = label.indexOf(':')
  if (colon !== -1) return t(label.slice(0, colon).trim()) + label.slice(colon)
  const length = label.match(/^Length - (min|max):? (\d+)(?:, (min|max):? (\d+))?$/)
  if (length) return t('Length') + ' - ' + t(length[1]) + ': ' + length[2] +
    (length[3] ? ', ' + t(length[3]) + ': ' + length[4] : '')
  return label
}
