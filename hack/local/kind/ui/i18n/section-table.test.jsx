import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import SectionTable from '../elements/SectionTable/SectionTable'
import { setLocale } from './locale'

beforeEach(() => {
  const overlay = document.createElement('div')
  overlay.id = 'overlay_container'
  document.body.appendChild(overlay)
})

afterEach(() => {
  cleanup()
  document.getElementById('overlay_container').remove()
  setLocale('en')
})

it('translates column headings and status while keeping names and column identity stable', () => {
  setLocale('en')
  const table = {
    header: [{ value: 'Name' }, { value: 'Status' }],
    body: [{ name: { value: 'Name' }, status: { value: 'Running' } }]
  }
  render(<SectionTable table={table} />)
  const header = screen.getByRole('columnheader', { name: 'Name' })
  act(() => setLocale('zh-CN'))
  expect(screen.getByRole('columnheader', { name: '名称' })).toBe(header)
  expect(screen.getByRole('cell', { name: 'Name' })).toBeInTheDocument()
  expect(screen.getByRole('cell', { name: '运行中' })).toBeInTheDocument()
})
