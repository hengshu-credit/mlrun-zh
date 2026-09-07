import React, { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getLocale, initializeLocale, setLocale, subscribe, t, useLocale } from './locale'
import LanguageSelector from './LanguageSelector'

beforeEach(() => {
  localStorage.clear()
  setLocale('en')
  localStorage.clear()
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('locale preference', () => {
  it('uses the browser language and gives a saved choice priority', () => {
    initializeLocale(['zh-CN', 'en'])
    expect(getLocale()).toBe('zh-CN')
    setLocale('en')
    initializeLocale(['zh-CN'])
    expect(getLocale()).toBe('en')
    expect(document.documentElement.lang).toBe('en')
  })

  it('ignores invalid saved preferences and falls back to English', () => {
    localStorage.setItem('mlrun.ui.locale', 'not-a-locale')
    initializeLocale(['fr-FR'])
    expect(getLocale()).toBe('en')
  })

  it('keeps working when browser storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    initializeLocale(['zh-Hans'])
    expect(getLocale()).toBe('zh-CN')
    expect(() => setLocale('en')).not.toThrow()
  })

  it('notifies subscribers only when the locale changes and supports cleanup', () => {
    let updates = 0
    const unsubscribe = subscribe(() => updates++)
    setLocale('zh-CN')
    setLocale('zh-CN')
    unsubscribe()
    setLocale('en')
    expect(updates).toBe(1)
  })
})

describe('translation and interaction', () => {
  it('falls back to the source message without translating interpolation values', () => {
    setLocale('zh-CN')
    expect(t('Projects')).toBe('项目')
    expect(t('Unknown UI message')).toBe('Unknown UI message')
    expect(t('Delete {0}', ['Projects'])).toBe('删除 Projects')
    setLocale('en')
    expect(t('Delete {0}', ['Projects'])).toBe('Delete Projects')
  })

  it('switches both ways without remounting a form or translating user content', () => {
    function Form() {
      useLocale()
      const [name, setName] = useState('Projects')
      return <><LanguageSelector /><h1>{t('Projects')}</h1>
        <input aria-label="Project name" value={name} onChange={event => setName(event.target.value)} />
        <p>{name}</p></>
    }
    render(<Form />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'My Projects' } })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zh-CN' } })
    expect(screen.getByRole('heading')).toHaveTextContent('项目')
    expect(screen.getByRole('textbox')).toHaveValue('My Projects')
    expect(localStorage.getItem('mlrun.ui.locale')).toBe('zh-CN')
    act(() => setLocale('en'))
    expect(screen.getByRole('heading')).toHaveTextContent('Projects')
    expect(screen.getByRole('textbox')).toHaveValue('My Projects')
  })
})
