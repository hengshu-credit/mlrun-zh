import React from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { mainHttpClient } from '../httpClient'
import { setLocale } from '../i18n/locale'
import SqlDatasetManager from './SqlDatasetManager'
import english from './en.json'
import chinese from './zh-CN.json'

vi.mock('../httpClient', () => ({ mainHttpClient: { get: vi.fn(), post: vi.fn() } }))

const connection = {
  name: 'warehouse',
  dialect: 'postgresql',
  host: 'db',
  port: 5432,
  database: 'analytics',
  username: 'reader'
}
const dataset = {
  name: 'customers',
  connection: 'warehouse',
  query: 'select id from customers',
  parameters: {}
}
const change = (label, value) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
const click = label => fireEvent.click(screen.getByRole('button', { name: label }))

beforeEach(() => {
  vi.clearAllMocks()
  setLocale('en')
  mainHttpClient.get.mockResolvedValue({ data: { connections: [connection], datasets: [dataset] } })
})
afterEach(() => {
  cleanup()
  setLocale('en')
  vi.useRealTimers()
})

it('tests and saves a reusable connection, clears its password, and keeps credentials out of query requests', async () => {
  mainHttpClient.post.mockImplementation(async (url, body) => ({
    data: url.endsWith('/test') ? { ok: true } : { ...body, password: undefined }
  }))
  render(<SqlDatasetManager project="demo" onClose={() => {}} />)
  await screen.findByText('warehouse (postgresql)')
  click('New connection')
  change('Connection name', 'source')
  change('Host', 'mysql.internal')
  change('Database', 'sales')
  change('Username', 'reader')
  change('Password', 'private-password')
  click('Test connection')
  await screen.findByRole('status')
  expect(screen.getByText('Connection successful')).toBeInTheDocument()
  click('Save connection')
  await screen.findByText('source (postgresql)')
  expect(screen.queryByDisplayValue('private-password')).not.toBeInTheDocument()
  expect(mainHttpClient.post).toHaveBeenCalledWith(
    '/projects/demo/sql-connections',
    expect.objectContaining({ password: 'private-password', port: 5432 })
  )
  change('SQL query', 'select :minimum as total')
  change('Parameters (JSON)', '{"minimum": 3}')
  mainHttpClient.post.mockResolvedValue({
    data: { columns: ['total'], rows: [{ total: 3 }], truncated: false }
  })
  click('Preview query')
  await screen.findByRole('cell', { name: '3' })
  expect(mainHttpClient.post).toHaveBeenLastCalledWith('/projects/demo/sql-datasets/preview', {
    connection: 'source',
    query: 'select :minimum as total',
    parameters: { minimum: 3 },
    timeout_seconds: 30
  })
})

it('rejects non-object parameters without sending SQL, and renders empty and truncated previews', async () => {
  render(<SqlDatasetManager project="demo" onClose={() => {}} />)
  await screen.findByText('warehouse (postgresql)')
  change('SQL query', 'select id from customers')
  change('Parameters (JSON)', '[]')
  click('Preview query')
  expect(await screen.findByRole('alert')).toHaveTextContent('Parameters must be a JSON object')
  expect(mainHttpClient.post).not.toHaveBeenCalled()
  change('Parameters (JSON)', '{}')
  mainHttpClient.post.mockResolvedValue({ data: { columns: ['id'], rows: [], truncated: false } })
  click('Preview query')
  await screen.findByText('The query returned no rows')
  mainHttpClient.post.mockResolvedValue({
    data: { columns: ['id'], rows: [{ id: 12 }], truncated: true }
  })
  click('Preview query')
  await screen.findByText(
    'Preview is limited; importing runs the full query within the configured limits.'
  )
  expect(screen.getByRole('cell', { name: '12' })).toBeInTheDocument()
})

it('registers a definition as a job and exposes the reusable URI only after success', async () => {
  const onImported = vi.fn()
  mainHttpClient.post.mockResolvedValue({
    data: {
      run: { metadata: { uid: 'job-123', name: 'sql-import' }, status: { state: 'running' } }
    }
  })
  render(<SqlDatasetManager project="demo" onClose={() => {}} onImported={onImported} />)
  await screen.findByText('warehouse (postgresql)')
  change('Dataset name', 'new-customers')
  change('SQL query', 'select id from customers')
  click('Import dataset')
  const job = await screen.findByRole('link', { name: 'View job' })
  expect(job.getAttribute('href')).toContain('/projects/demo/jobs/monitor-jobs/')
  expect(screen.getByText('Running')).toBeInTheDocument()
  expect(screen.queryByText('store://datasets/demo/new-customers:latest')).not.toBeInTheDocument()
  expect(mainHttpClient.post).toHaveBeenCalledWith(
    '/projects/demo/sql-datasets',
    expect.objectContaining({
      name: 'new-customers',
      connection: 'warehouse',
      timeout_seconds: 300,
      max_rows: 1000000
    })
  )
  mainHttpClient.get.mockResolvedValue({
    data: { data: { metadata: { uid: 'job-123' }, status: { state: 'completed' } } }
  })
  click('Check status')
  await screen.findByText('Completed')
  expect(screen.getByText('store://datasets/demo/new-customers:latest')).toBeInTheDocument()
  expect(onImported).toHaveBeenCalledTimes(1)
})

it('keeps saved definitions and previous dataset access when refresh fails', async () => {
  mainHttpClient.post.mockRejectedValue({
    response: { status: 409, data: { detail: 'Dataset already exists' } }
  })
  render(<SqlDatasetManager project="demo" onClose={() => {}} />)
  const row = await screen.findByRole('row', { name: /customers.*warehouse/ })
  fireEvent.click(within(row).getByRole('button', { name: 'Refresh snapshot' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Dataset already exists')
  expect(within(row).getByRole('link', { name: 'Open dataset' })).toBeInTheDocument()
  expect(within(row).getByText('customers')).toBeInTheDocument()
  expect(mainHttpClient.post).toHaveBeenCalledWith(
    '/projects/demo/sql-datasets/customers/refresh',
    {}
  )
})

it('changes language without clearing SQL', async () => {
  render(<SqlDatasetManager project="demo" onClose={() => {}} />)
  await screen.findByText('warehouse (postgresql)')
  change('SQL query', 'select id from customers')
  await act(async () => setLocale('zh-CN'))
  expect(screen.getByLabelText('SQL 查询')).toHaveValue('select id from customers')
  expect(screen.getByRole('button', { name: '导入数据集' })).toBeInTheDocument()
})

it('retains a previously successful snapshot URI after an asynchronous refresh fails', async () => {
  mainHttpClient.post.mockResolvedValue({
    data: { run: { metadata: { uid: 'first' }, status: { state: 'running' } } }
  })
  render(<SqlDatasetManager project="demo" onClose={() => {}} />)
  await screen.findByText('warehouse (postgresql)')
  click('Refresh snapshot')
  await screen.findByText('Running')
  mainHttpClient.get.mockResolvedValue({
    data: { data: { metadata: { uid: 'first' }, status: { state: 'completed' } } }
  })
  click('Check status')
  await screen.findByText('store://datasets/demo/customers:latest')
  mainHttpClient.post.mockResolvedValue({
    data: { run: { metadata: { uid: 'second' }, status: { state: 'running' } } }
  })
  click('Refresh snapshot')
  await screen.findByText('Running')
  mainHttpClient.get.mockResolvedValue({
    data: { data: { metadata: { uid: 'second' }, status: { state: 'error' } } }
  })
  click('Check status')
  await screen.findByText('Failed')
  expect(screen.getByText('store://datasets/demo/customers:latest')).toBeInTheDocument()
  expect(
    screen.getByText('The import failed. Any previous successful snapshot is still available.')
  ).toBeInTheDocument()
})

it('polls job completion automatically and stops polling after completion', async () => {
  mainHttpClient.post.mockResolvedValue({
    data: { run: { metadata: { uid: 'auto' }, status: { state: 'running' } } }
  })
  render(<SqlDatasetManager project="demo" onClose={() => {}} />)
  await screen.findByText('warehouse (postgresql)')
  vi.useFakeTimers()
  await act(async () => click('Refresh snapshot'))
  expect(screen.getByText('Running')).toBeInTheDocument()
  mainHttpClient.get.mockResolvedValue({
    data: { data: { metadata: { uid: 'auto' }, status: { state: 'completed' } } }
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(4000)
  })
  expect(screen.getByText('Completed')).toBeInTheDocument()
  mainHttpClient.get.mockClear()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(12000)
  })
  expect(mainHttpClient.get).not.toHaveBeenCalled()
})

it('recovers automatic status polling after a transient network error', async () => {
  mainHttpClient.post.mockResolvedValue({
    data: { run: { metadata: { uid: 'retry' }, status: { state: 'running' } } }
  })
  render(<SqlDatasetManager project="demo" onClose={() => {}} />)
  await screen.findByText('warehouse (postgresql)')
  vi.useFakeTimers()
  await act(async () => click('Refresh snapshot'))
  mainHttpClient.get.mockRejectedValueOnce(new Error('Network Error'))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(4000)
  })
  expect(screen.getByRole('alert')).toBeInTheDocument()
  mainHttpClient.get.mockResolvedValue({
    data: { data: { metadata: { uid: 'retry' }, status: { state: 'completed' } } }
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(4000)
  })
  expect(screen.getByText('Completed')).toBeInTheDocument()
})

it('restores a saved pending job after reopening and resumes status checks', async () => {
  mainHttpClient.get.mockResolvedValueOnce({
    data: {
      connections: [connection],
      datasets: [
        {
          ...dataset,
          latest_run: { metadata: { uid: 'restored-job' }, status: { state: 'running' } }
        }
      ]
    }
  })
  mainHttpClient.get.mockResolvedValue({
    data: { data: { metadata: { uid: 'restored-job' }, status: { state: 'completed' } } }
  })
  render(<SqlDatasetManager project="demo" onClose={() => {}} />)
  await screen.findByText('Running')
  expect(screen.getByRole('link', { name: 'View job' })).toHaveAttribute(
    'href',
    '/projects/demo/jobs/monitor-jobs/restored-job/overview'
  )
  click('Check status')
  await screen.findByText('Completed')
  expect(mainHttpClient.get).toHaveBeenLastCalledWith('/projects/demo/runs/restored-job')
  expect(screen.getByText('store://datasets/demo/customers:latest')).toBeInTheDocument()
})

it('restores a completed snapshot URI directly from the saved job', async () => {
  mainHttpClient.get.mockResolvedValueOnce({
    data: {
      connections: [connection],
      datasets: [
        {
          ...dataset,
          latest_run: { metadata: { uid: 'completed-job' }, status: { state: 'completed' } }
        }
      ]
    }
  })
  render(<SqlDatasetManager project="demo" onClose={() => {}} />)
  await screen.findByText('store://datasets/demo/customers:latest')
  expect(screen.getByText('Completed')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Check status' })).not.toBeInTheDocument()
})

it('does not render password inputs returned inside a server validation error', async () => {
  mainHttpClient.post.mockRejectedValue({
    response: {
      data: { detail: [{ input: { password: 'private-password' }, msg: 'Invalid connection' }] }
    }
  })
  render(<SqlDatasetManager project="demo" onClose={() => {}} />)
  await screen.findByText('warehouse (postgresql)')
  change('SQL query', 'select 1')
  click('Preview query')
  expect(await screen.findByRole('alert')).toHaveTextContent('Request failed. Please try again.')
  expect(document.body.textContent).not.toContain('private-password')
})

it('provides editable English and Chinese coverage for every SQL dataset message', () => {
  expect(Object.keys(chinese).sort()).toEqual(Object.keys(english).sort())
  expect(Object.values(chinese).every(value => typeof value === 'string' && value.trim())).toBe(
    true
  )
})
