import React from 'react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import NuclioFrame from './NuclioFrame'
import { setLocale } from './locale'

beforeEach(() => {
  window.mlrunConfig = { nuclioUiUrl: 'http://localhost:8070' }
  setLocale('en')
})

afterEach(() => {
  cleanup()
  setLocale('en')
})

it.each([
  ['functions', 'Real-time functions'],
  ['api-gateways', 'API gateways'],
])('embeds the existing Nuclio %s page with project and language', (page, title) => {
  setLocale('zh-CN')
  render(
    <MemoryRouter initialEntries={['/projects/demo']}>
      <Routes>
        <Route path="/projects/:projectName" element={<NuclioFrame page={page} title={title} />} />
      </Routes>
    </MemoryRouter>,
  )
  const frame = document.querySelector('iframe')
  const url = new URL(frame.src)
  expect(url.origin).toBe('http://localhost:8070')
  expect(url.pathname).toBe(`/projects/demo/${page}`)
  expect(url.searchParams.get('lng')).toBe('zh-CN')
  expect(frame.title).toBe(page === 'functions' ? '实时函数' : 'API 网关')
  act(() => setLocale('en'))
  expect(frame).toHaveAttribute('title', title)
  // Changing the outer shell language must not reload an unsaved Nuclio form.
  expect(frame.src).toBe(url.toString())
})

it('loads the new project when the outer project route changes', () => {
  const SwitchProject = () => {
    const navigate = useNavigate()
    return <button onClick={() => navigate('/projects/second')}>Switch project</button>
  }
  render(
    <MemoryRouter initialEntries={['/projects/demo']}>
      <SwitchProject />
      <Routes>
        <Route path="/projects/:projectName" element={<NuclioFrame page="functions" title="Real-time functions" />} />
      </Routes>
    </MemoryRouter>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Switch project' }))
  expect(new URL(screen.getByTitle('Real-time functions').src).pathname).toBe('/projects/second/functions')
})
