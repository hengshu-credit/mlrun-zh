import React from 'react'
import { Form } from 'react-final-form'
import { FormTextarea } from 'igz-controls/components'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { setLocale } from './locale'
import { getTimeElapsedByDate, formatDatetime } from './datetime'
import { getValidationRules } from './validation'
import * as upstreamValidation from 'igz-controls/utils/validation.util'

afterEach(() => { cleanup(); vi.useRealTimers(); setLocale('en') })

it('localizes relative dates while retaining the timestamp and local timezone', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-08T00:00:00Z'))
  setLocale('zh-CN')
  expect(getTimeElapsedByDate('2026-09-07T22:00:00Z')).toContain('2 小时前')
  expect(formatDatetime('2026-09-07T22:00:00Z', '-', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' })).toContain('2026年9月7日')
  setLocale('en')
  expect(getTimeElapsedByDate('2026-09-07T22:00:00Z')).toBe('2 hours ago')
})

it('translates validation help without changing permitted project names', () => {
  setLocale('zh-CN')
  const rules = getValidationRules('project.name')
  const original = upstreamValidation.getValidationRules('project.name')
  for (const value of ['my-project', '中文', 'a_b', 'name with spaces', '']) {
    expect(rules.map(rule => rule.pattern.test(value))).toEqual(original.map(rule => rule.pattern.test(value)))
  }
  expect(rules.some(rule => /允许字符/.test(rule.label))).toBe(true)
  act(() => setLocale('en'))
  expect(rules.map(rule => rule.label)).toEqual(original.map(rule => rule.label))
})

it('switches shared control counters without clearing an edited form', () => {
  setLocale('en')
  render(<Form onSubmit={() => {}} initialValues={{ description: '' }}>
    {() => <FormTextarea name="description" label="Description" maxLength={10} />}
  </Form>)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Projects' } })
  expect(screen.getByRole('textbox')).toHaveValue('Projects')
  act(() => setLocale('zh-CN'))
  expect(screen.getByText('剩余 2 个字符')).toBeInTheDocument()
  expect(screen.getByRole('textbox')).toHaveValue('Projects')
  act(() => setLocale('en'))
  expect(screen.getByText('2 characters left')).toBeInTheDocument()
})
