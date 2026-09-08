import React from 'react'
import { Provider } from 'react-redux'
import { createStore } from 'redux'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  SidebarProvider,
  TooltipProvider,
} from 'igz-controls/nextGenComponents'
import Sidebar from './TianshuSidebar'
import Header from '../layout/Header/Header'
import { setLocale } from './locale'

const store = createStore(() => ({
  appStore: { frontendSpec: {} },
  projectStore: { projectsNames: { data: ['demo', 'second'] } },
}))
const Location = () => <output>{useLocation().pathname}</output>
const renderSidebar = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/projects/demo/monitor']}>
        <TooltipProvider>
          <SidebarProvider>
            <Sidebar projectName="demo" />
            <Location />
          </SidebarProvider>
        </TooltipProvider>
      </MemoryRouter>
    </Provider>,
  )

beforeEach(() => {
  localStorage.clear()
  setLocale('en')
  window.mlrunConfig = { nuclioUiUrl: 'http://localhost:8070' }
  vi.stubGlobal('PointerEvent', MouseEvent)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  setLocale('en')
})

it('uses the shared brand and removes community links', () => {
  render(
    <Provider store={store}>
      <Header />
    </Provider>,
  )
  expect(screen.getByAltText('MLRun').getAttribute('src')).toContain(
    'hengshucredit',
  )
  expect(screen.getByText('Crafting Innovation, Guiding Decisions')).toBeInTheDocument()
  act(() => setLocale('zh-CN'))
  expect(screen.getByText('天工开物，枢衡定策')).toBeInTheDocument()
  expect(screen.queryByText('Crafting Innovation, Guiding Decisions')).not.toBeInTheDocument()
  act(() => setLocale('en'))
  expect(screen.getByText('Crafting Innovation, Guiding Decisions')).toBeInTheDocument()
  expect(
    screen
      .getAllByRole('link')
      .some((link) => /github|joincommunity|slack/i.test(link.href)),
  ).toBe(false)
})

it('resizes through the compact threshold, clamps and remembers width', () => {
  const view = renderSidebar()
  const rail = screen.getByRole('separator', { name: 'Resize sidebar' })
  expect(rail).toHaveAttribute('aria-valuenow', '220')
  fireEvent.pointerDown(rail, { clientX: 220, pointerId: 1, button: 0 })
  fireEvent.pointerMove(rail, { clientX: 90, pointerId: 1 })
  fireEvent.pointerUp(rail, { clientX: 90, pointerId: 1 })
  expect(rail).toHaveAttribute('aria-valuenow', '90')
  expect(screen.getByTestId('sidebar')).toHaveAttribute('data-compact', 'true')
  view.unmount()
  renderSidebar()
  const restored = screen.getByRole('separator', { name: 'Resize sidebar' })
  expect(restored).toHaveAttribute('aria-valuenow', '90')
  fireEvent.keyDown(restored, { key: 'End' })
  expect(restored).toHaveAttribute('aria-valuenow', '320')
  expect(screen.getByTestId('sidebar')).toHaveAttribute('data-compact', 'false')
  fireEvent.keyDown(restored, { key: 'Home' })
  fireEvent.keyDown(restored, { key: 'ArrowLeft' })
  expect(restored).toHaveAttribute('aria-valuenow', '64')
})

it.each([64, 220])(
  'uses the correct trigger and submenu placement at width %s',
  (width) => {
    localStorage.setItem('mlrun:layout:sidebar-width', String(width))
    renderSidebar()
    const trigger = screen.getByRole('button', { name: 'Data and artifacts' })
    fireEvent.mouseEnter(trigger)
    if (width === 220) {
      expect(screen.queryByRole('link', { name: 'Datasets' })).not.toBeInTheDocument()
      fireEvent.click(trigger)
    }
    const child = screen.getByRole('link', { name: 'Datasets' })
    expect(screen.getByTestId('sidebar').contains(child)).toBe(width === 220)
    expect(Boolean(child.closest('.tianshu-flyout'))).toBe(width === 64)
    fireEvent.mouseLeave(trigger)
    fireEvent.click(child)
    expect(screen.getByRole('status')).toHaveTextContent(
      '/projects/demo/datasets',
    )
    expect(trigger).toHaveAttribute('aria-expanded', String(width === 220))
    if (width === 220) {
      expect(screen.getByRole('link', { name: 'Datasets' })).toHaveAttribute('aria-current', 'page')
      fireEvent.click(trigger)
      expect(screen.queryByRole('link', { name: 'Documents' })).not.toBeInTheDocument()
    }
  },
)

it('closes a compact hover popup on leave without a click cancelling the hover', () => {
  vi.useFakeTimers()
  try {
    localStorage.setItem('mlrun:layout:sidebar-width', '64')
    renderSidebar()
    const trigger = screen.getByRole('button', { name: 'Data and artifacts' })
    fireEvent.mouseEnter(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    fireEvent.mouseLeave(trigger)
    act(() => vi.advanceTimersByTime(200))
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    fireEvent.mouseEnter(trigger)
    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    fireEvent.mouseLeave(trigger)
    act(() => vi.advanceTimersByTime(200))
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  } finally {
    vi.useRealTimers()
  }
})

it('keeps a compact hover popup open while entering it and replaces it on another menu hover', () => {
  vi.useFakeTimers()
  try {
    localStorage.setItem('mlrun:layout:sidebar-width', '64')
    renderSidebar()
    const trigger = screen.getByRole('button', { name: 'Data and artifacts' })
    fireEvent.mouseEnter(trigger)
    const child = screen.getByRole('link', { name: 'Datasets' })
    fireEvent.mouseLeave(trigger)
    fireEvent.mouseEnter(child.closest('.tianshu-flyout'))
    act(() => vi.advanceTimersByTime(200))
    expect(child).toBeInTheDocument()
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Nuclio' }))
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('link', { name: 'Real-time functions' })).toBeInTheDocument()
  } finally {
    vi.useRealTimers()
  }
})

it('supports keyboard submenu access, Escape and live translations', () => {
  renderSidebar()
  const trigger = screen.getByRole('button', { name: 'Data and artifacts' })
  fireEvent.keyDown(trigger, { key: 'ArrowRight' })
  expect(screen.getByRole('link', { name: 'Datasets' })).toHaveFocus()
  fireEvent.keyDown(screen.getByRole('link', { name: 'Datasets' }), {
    key: 'Escape',
  })
  expect(trigger).toHaveFocus()
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  act(() => setLocale('zh-CN'))
  expect(
    screen.getByRole('separator', { name: '调整侧边栏宽度' }),
  ).toBeInTheDocument()
})

it('works when browser storage is unavailable', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  renderSidebar()
  const rail = screen.getByRole('separator', { name: 'Resize sidebar' })
  fireEvent.keyDown(rail, { key: 'Home' })
  expect(rail).toHaveAttribute('aria-valuenow', '64')
})

it('keeps project switching accessible in compact mode', () => {
  localStorage.setItem('mlrun:layout:sidebar-width', '64')
  renderSidebar()
  fireEvent.pointerDown(
    screen.getByTestId('sidebar-project-dropdown-trigger'),
    { button: 0, ctrlKey: false },
  )
  fireEvent.click(screen.getByRole('menuitem', { name: 'second' }))
  expect(screen.getByRole('status')).toHaveTextContent(
    '/projects/second/monitor',
  )
})

it('dismisses a compact popup on outside click and when another menu opens', () => {
  localStorage.setItem('mlrun:layout:sidebar-width', '64')
  renderSidebar()
  const trigger = screen.getByRole('button', { name: 'Nuclio' })
  fireEvent.mouseEnter(trigger)
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  fireEvent.pointerDown(document.body)
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  fireEvent.mouseEnter(trigger)
  const other = screen.getByRole('button', { name: 'Data and artifacts' })
  fireEvent.pointerDown(other)
  fireEvent.mouseEnter(other)
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  expect(other).toHaveAttribute('aria-expanded', 'true')
})

it('keeps expanded children open while scrolling or clicking outside', () => {
  renderSidebar()
  const trigger = screen.getByRole('button', { name: 'Data and artifacts' })
  fireEvent.click(trigger)
  fireEvent.pointerDown(document.body)
  fireEvent.scroll(screen.getByRole('navigation', { name: 'Main navigation' }))
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByTestId('sidebar')).toContainElement(screen.getByRole('link', { name: 'Datasets' }))
})

it('closes the old menu presentation when crossing the compact threshold', () => {
  renderSidebar()
  const trigger = screen.getByRole('button', { name: 'Data and artifacts' })
  const rail = screen.getByRole('separator', { name: 'Resize sidebar' })
  fireEvent.click(trigger)
  fireEvent.keyDown(rail, { key: 'Home' })
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  fireEvent.mouseEnter(trigger)
  expect(screen.getByRole('link', { name: 'Datasets' }).closest('.tianshu-flyout')).not.toBeNull()
  fireEvent.keyDown(rail, { key: 'End' })
  expect(document.querySelector('.tianshu-flyout')).toBeNull()
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
})

it.each([
  ['Real-time functions', 'real-time-functions'],
  ['API gateways', 'api-gateways'],
])('opens %s inside MLRun', (label, path) => {
  renderSidebar()
  const trigger = screen.getByRole('button', { name: 'Nuclio' })
  fireEvent.click(trigger)
  const link = screen.getByRole('link', { name: label })
  expect(link).not.toHaveAttribute('target')
  fireEvent.click(link)
  expect(screen.getByRole('status')).toHaveTextContent(`/projects/demo/${path}`)
  expect(trigger).toHaveClass('is-active')
  expect(screen.getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page')
  fireEvent.pointerDown(document.body)
  fireEvent.pointerDown(screen.getByTestId('sidebar-project-dropdown-trigger'), {
    button: 0, ctrlKey: false,
  })
  fireEvent.click(screen.getByRole('menuitem', { name: 'second' }))
  expect(screen.getByRole('status')).toHaveTextContent(`/projects/second/${path}`)
})
