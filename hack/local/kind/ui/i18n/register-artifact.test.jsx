import React from 'react'
import { Provider } from 'react-redux'
import { createStore } from 'redux'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import RegisterArtifactModal from '../components/RegisterArtifactModal/RegisterArtifactModal'
import { ARTIFACT_TYPE, MODEL_TYPE } from '../constants'
import { setLocale } from './locale'

// The path picker is unrelated to title reactivity; keep the real modal, form and name input.
vi.mock('../common/TargetPath/TargetPath', () => ({ default: () => null }))

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

function renderModal(artifactKind, title) {
  const router = createMemoryRouter([
    {
      path: '*',
      element: (
        <RegisterArtifactModal
          artifactKind={artifactKind}
          title={title}
          isOpen
          onResolve={() => {}}
          params={{ projectName: 'test-project' }}
          refresh={() => {}}
        />
      )
    }
  ])
  return render(
    <Provider store={createStore(() => ({ appStore: { frontendSpec: {} } }))}>
      <RouterProvider router={router} />
    </Provider>
  )
}

it.each([
  ['zh-CN', '注册产物', 'en', 'Register artifact'],
  ['en', 'Register artifact', 'zh-CN', '注册产物']
])('updates an open %s artifact title without resetting its form', async (initial, title, next, expected) => {
  setLocale(initial)
  const { container } = renderModal(ARTIFACT_TYPE, title)
  expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
  const name = container.querySelector('input[name="metadata.key"]')
  await act(async () => {
    fireEvent.change(name, { target: { value: 'Projects' } })
  })

  await act(async () => setLocale(next))

  expect(screen.getByRole('heading', { name: expected })).toBeInTheDocument()
  expect(container.querySelector('input[name="metadata.key"]')).toBe(name)
  expect(name).toHaveValue('Projects')
})

it('preserves the supplied title for other artifact kinds', async () => {
  setLocale('en')
  renderModal(MODEL_TYPE, 'Custom Projects')
  await act(async () => setLocale('zh-CN'))
  expect(screen.getByRole('heading', { name: 'Custom Projects' })).toBeInTheDocument()
})
