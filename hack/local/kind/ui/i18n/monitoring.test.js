import { generateMonitoringStats } from '../utils/generateMonitoringData'
import { JOBS_MONITORING_JOBS_TAB } from '../constants'
import { setLocale } from './locale'

afterEach(() => setLocale('en'))

it('updates cached monitoring labels without changing navigation filters', () => {
  setLocale('en')
  const destinations = []
  const stats = generateMonitoringStats(
    { running: 1, failed: 0, completed: 2 },
    destination => destinations.push(destination),
    JOBS_MONITORING_JOBS_TAB,
    'test-project'
  )
  expect(stats.counters[0].label).toBe('In process')
  stats.counters[0].link()
  setLocale('zh-CN')
  expect(stats.counters.map(counter => counter.label)).toEqual(['处理中', '失败', '成功'])
  stats.counters[0].link()
  expect(destinations[1]).toBe(destinations[0])
  expect(stats.counters[0].counter).toBe(1)
})
