import getState from './state'
import upstreamGetState from '../utils/getState'
import { setLocale } from './locale'
import { FUNCTIONS_PAGE, JOBS_PAGE } from '../constants'

afterEach(() => setLocale('en'))

it('keeps stored status labels reactive without changing protocol values or reasons', () => {
  setLocale('en')
  const status = getState('running', FUNCTIONS_PAGE, 'job')
  const error = getState('error', JOBS_PAGE, 'job', 'Projects')
  const apiError = getState('error', JOBS_PAGE, 'job', '', 'Reason: Projects')
  setLocale('zh-CN')
  expect(status.label).toBe('运行中')
  expect(status.value).toBe('running')
  expect(status.className).toBe(upstreamGetState('running', FUNCTIONS_PAGE, 'job').className)
  expect(error.label).toBe('错误. 原因: Projects')
  expect(apiError.label).toBe('错误. Reason: Projects')
  setLocale('en')
  expect(status.label).toBe('Running')
  expect(error.label).toBe('Error. Reason: Projects')
})
