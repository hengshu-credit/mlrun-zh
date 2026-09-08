import { getNoDataMessage } from '../utils/getNoDataMessage'
import { MODELS_TAB, NAME_FILTER } from '../constants'
import { setLocale } from './locale'

afterEach(() => setLocale('en'))

it('localizes empty results while preserving user filter values', () => {
  setLocale('en')
  expect(getNoDataMessage({}, {}, '', MODELS_TAB)).toBe('No models found')
  setLocale('zh-CN')
  expect(getNoDataMessage({}, {}, '', MODELS_TAB)).toBe('未找到模型')
  expect(
    getNoDataMessage(
      { [NAME_FILTER]: 'Projects' },
      { [NAME_FILTER]: { label: '名称：' } },
      '',
      MODELS_TAB
    )
  ).toBe('没有匹配以下筛选条件的数据："名称： Projects"')
})
