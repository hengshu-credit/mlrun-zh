import React from 'react'
import { Provider } from 'react-redux'
import { createStore } from 'redux'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import Header from '../layout/Header/Header'
import { generateNuclioLink } from '../utils/parseUri'
import { initializeLocale, getLocale, setLocale } from './locale'

afterEach(() => {
  cleanup()
  setLocale('en')
  window.history.replaceState(null, '', '/')
})

it('returns to projects with the header outside the application router', () => {
  const Location = () => <output>{useLocation().pathname}</output>
  const router = createMemoryRouter([{ path: '*', element: <Location /> }], {
    initialEntries: ['/projects/demo/jobs']
  })
  render(
    <Provider store={createStore(() => ({ appStore: { frontendSpec: {} } }))}>
      <Header navigate={router.navigate} />
      <RouterProvider router={router} />
    </Provider>
  )
  fireEvent.click(screen.getAllByRole('link')[0])
  expect(screen.getByRole('status')).toHaveTextContent('/projects')
  expect(screen.getByRole('status')).not.toHaveTextContent('/jobs')
})

it('carries the selected language to Nuclio without changing project paths', () => {
  window.mlrunConfig = { nuclioUiUrl: 'http://localhost:8070' }
  setLocale('zh-CN')
  const chinese = new URL(generateNuclioLink('/projects/my-project/functions'))
  expect(chinese.pathname).toBe('/projects/my-project/functions')
  expect(chinese.searchParams.get('lng')).toBe('zh-CN')
  setLocale('en')
  expect(
    new URL(generateNuclioLink('/projects/my-project/api-gateways')).searchParams.get('lng')
  ).toBe('en')
})

it('consumes a language handoff once and preserves other URL parameters', () => {
  setLocale('en')
  window.history.replaceState(null, '', '/mlrun/projects?lng=zh-CN&name=Projects#results')
  initializeLocale(['en'])
  expect(getLocale()).toBe('zh-CN')
  expect(window.location.search).toBe('?name=Projects')
  expect(window.location.hash).toBe('#results')
  setLocale('en')
  initializeLocale(['zh-CN'])
  expect(getLocale()).toBe('en')
})
