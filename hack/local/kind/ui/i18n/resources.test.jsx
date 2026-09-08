import React from 'react'
import { Provider } from 'react-redux'
import { createStore } from 'redux'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import Header from '../layout/Header/Header'
import ResourceFrame from './ResourceFrame'
import { setLocale } from './locale'

afterEach(() => { cleanup(); setLocale('en'); vi.unstubAllEnvs() })

it.each([
  ['/projects', 'Documentation', '/documentation', 'https://docs.mlrun.org/en/latest/'],
  ['/projects/demo/monitor', 'Documentation', '/projects/demo/documentation', 'https://docs.mlrun.org/en/latest/'],
  ['/mlrun/projects/demo/monitor', 'Documentation', '/projects/demo/documentation', 'https://docs.mlrun.org/en/latest/'],
  ['/projects/demo/monitor', 'Function hub', '/projects/demo/function-hub', 'https://www.mlrun.org/hub/']
])('opens %s resource %s inside the shell', async (initial, label, path, url) => {
  setLocale('en')
  vi.stubEnv('VITE_PUBLIC_URL', '/mlrun')
  const basename = initial.startsWith('/mlrun/') ? '/mlrun' : '/'
  const router = createMemoryRouter([
    { path: '*', element: <div>Project page</div> },
    { path, element: <ResourceFrame resource={label === 'Documentation' ? 'documentation' : 'function-hub'} /> }
  ], { basename, initialEntries: [initial] })
  render(<Provider store={createStore(() => ({ appStore: { frontendSpec: {} } }))}>
    <Header navigate={router.navigate} router={router} /><RouterProvider router={router} />
  </Provider>)
  const link = screen.getByRole('link', { name: label })
  expect(link).not.toHaveAttribute('target', '_blank')
  expect(link.getAttribute('href')).toMatch(new RegExp(`${path}$`))
  fireEvent.click(link)
  expect(router.state.location.pathname).toBe(`${basename === '/' ? '' : basename}${path}`)
  const frame = screen.getByTitle(label)
  expect(frame).toHaveAttribute('src', url)
  expect(screen.getByTestId('header')).toBeInTheDocument()
  act(() => setLocale('zh-CN'))
  expect(frame.src).toBe(url)
  expect(frame.title).toBe(label === 'Documentation' ? '文档' : '函数中心')
  await act(async () => { await router.navigate('/projects/second/monitor') })
  expect(screen.getByRole('link', { name: '文档' }).getAttribute('href')).toMatch(/\/projects\/second\/documentation$/)
})
