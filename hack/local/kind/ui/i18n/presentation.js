import { t } from './locale'

export function displayLabel(label) {
  return typeof label === 'string' ? t(label) : label
}

export function displayStatus(status) {
  if (typeof status !== 'string') return status
  const labels = {
    running: 'Running',
    ready: 'Ready',
    completed: 'Completed',
    succeeded: 'Succeeded',
    failed: 'Failed',
    error: 'Error',
    pending: 'Pending',
    aborted: 'Aborted',
    aborting: 'Aborting',
    terminating: 'Terminating',
    disabled: 'Disabled',
    unhealthy: 'Unhealthy',
    unknown: 'Unknown',
    deploying: 'Deploying',
    initialized: 'Initialized',
    standby: 'Standby',
    skipped: 'Skipped'
  }
  return Object.hasOwn(labels, status.toLowerCase()) ? t(labels[status.toLowerCase()]) : status
}
