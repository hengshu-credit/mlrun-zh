import React, { useCallback, useEffect, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import { mainHttpClient } from '../httpClient'
import { useSqlMessages } from './messages'
import './sql-datasets.css'

const emptyConnection = {
  name: '',
  dialect: 'postgresql',
  host: '',
  port: 5432,
  database: '',
  username: '',
  password: ''
}
const terminalStates = ['completed', 'error', 'failed', 'aborted']

export default function SqlDatasetManager({ project, onClose, onImported }) {
  const t = useSqlMessages()
  const base = `/projects/${encodeURIComponent(project)}`
  const [connections, setConnections] = useState([])
  const [datasets, setDatasets] = useState([])
  const [connection, setConnection] = useState('')
  const [credentials, setCredentials] = useState(emptyConnection)
  const [showConnection, setShowConnection] = useState(false)
  const [definition, setDefinition] = useState({
    name: '',
    query: '',
    parameters: '{}',
    description: ''
  })
  const [preview, setPreview] = useState(null)
  const [runs, setRuns] = useState({})
  const [published, setPublished] = useState({})
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const dialogRef = useRef(null)
  const mountedRef = useRef(true)
  const completedRef = useRef(new Set())
  const pollingRef = useRef(new Set())
  const importedRef = useRef(onImported)
  importedRef.current = onImported

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data } = await mainHttpClient.get(`${base}/sql-datasets`)
      if (!mountedRef.current) return
      setConnections(data.connections)
      setDatasets(data.datasets)
      // Older API versions may omit latest_run. Preserve local tracking in that case.
      const latestRuns = Object.fromEntries(
        data.datasets
          .filter(item => item.latest_run?.metadata?.uid)
          .map(item => [item.name, item.latest_run])
      )
      setRuns(previous => ({ ...previous, ...latestRuns }))
      setPublished(previous => ({
        ...previous,
        ...Object.fromEntries(
          Object.entries(latestRuns)
            .filter(([, run]) => run.status?.state === 'completed')
            .map(([name]) => [name, true])
        )
      }))
      setConnection(current => current || data.connections[0]?.name || '')
    } catch (failure) {
      if (mountedRef.current) setError(requestError(failure))
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [base])

  useEffect(() => {
    mountedRef.current = true
    load()
    const previous = document.activeElement
    dialogRef.current?.focus()
    return () => {
      mountedRef.current = false
      previous?.focus()
    }
  }, [load])

  const checkRun = useCallback(
    async (name, run) => {
      if (pollingRef.current.has(run.metadata.uid)) return
      pollingRef.current.add(run.metadata.uid)
      try {
        const { data } = await mainHttpClient.get(
          `${base}/runs/${encodeURIComponent(run.metadata.uid)}`
        )
        if (!mountedRef.current) return
        const current = data.data
        setRuns(previous => ({ ...previous, [name]: current }))
        if (current.status?.state === 'completed' && !completedRef.current.has(run.metadata.uid)) {
          completedRef.current.add(run.metadata.uid)
          setPublished(previous => ({ ...previous, [name]: true }))
          importedRef.current?.()
        }
      } catch (failure) {
        if (mountedRef.current) setError(requestError(failure))
      } finally {
        pollingRef.current.delete(run.metadata.uid)
      }
    },
    [base]
  )

  useEffect(() => {
    const pending = Object.entries(runs).filter(
      ([, run]) => !terminalStates.includes(run.status?.state)
    )
    if (!pending.length) return
    const timer = setInterval(() => pending.forEach(([name, run]) => checkRun(name, run)), 4000)
    return () => clearInterval(timer)
  }, [runs, checkRun])

  async function perform(action) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
    } catch (failure) {
      if (mountedRef.current) setError(requestError(failure))
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }

  function connectionAction(test) {
    perform(async () => {
      const port = Number(credentials.port)
      if (
        !['name', 'host', 'database', 'username', 'password'].every(key =>
          credentials[key].trim()
        ) ||
        !Number.isInteger(port) ||
        port < 1 ||
        port > 65535
      ) {
        throw new Error('Complete all connection fields with a valid port')
      }
      const { data } = await mainHttpClient.post(`${base}/sql-connections${test ? '/test' : ''}`, {
        ...credentials,
        port
      })
      if (!mountedRef.current) return
      if (test) setNotice('Connection successful')
      else {
        // Only retain the public fields even if a server accidentally returns a password.
        const { name, dialect, host, port: publicPort, database, username } = data
        setConnections(previous => [
          ...previous,
          { name, dialect, host, port: publicPort, database, username }
        ])
        setConnection(name)
        setCredentials(emptyConnection)
        setShowConnection(false)
        setNotice('Connection saved')
      }
    })
  }

  function queryAction(importDataset) {
    perform(async () => {
      if (!connection || !definition.query.trim())
        throw new Error('Select a connection and enter a SQL query')
      let parameters
      try {
        parameters = JSON.parse(definition.parameters)
      } catch {
        throw new Error('Parameters must be a JSON object')
      }
      if (!parameters || Array.isArray(parameters) || typeof parameters !== 'object')
        throw new Error('Parameters must be a JSON object')
      const query = {
        connection,
        query: definition.query,
        parameters,
        timeout_seconds: importDataset ? 300 : 30
      }
      if (!importDataset) {
        setPreview(null)
        const { data } = await mainHttpClient.post(`${base}/sql-datasets/preview`, query)
        if (mountedRef.current) setPreview(data)
      } else {
        if (!definition.name.trim()) throw new Error('Enter a dataset name')
        const saved = {
          ...query,
          name: definition.name.trim(),
          description: definition.description,
          max_rows: 1000000
        }
        const { data } = await mainHttpClient.post(`${base}/sql-datasets`, saved)
        if (!mountedRef.current) return
        setDatasets(previous => [...previous, saved])
        setRuns(previous => ({ ...previous, [saved.name]: data.run }))
      }
    })
  }

  function refresh(name) {
    perform(async () => {
      const { data } = await mainHttpClient.post(
        `${base}/sql-datasets/${encodeURIComponent(name)}/refresh`,
        {}
      )
      if (mountedRef.current) setRuns(previous => ({ ...previous, [name]: data.run }))
    })
  }

  function trapFocus(event) {
    if (event.key === 'Escape') onClose()
    if (event.key !== 'Tab') return
    const items = [
      ...dialogRef.current.querySelectorAll(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]'
      )
    ]
    const first = items[0]
    const last = items[items.length - 1]
    if (
      event.shiftKey &&
      (document.activeElement === first || document.activeElement === dialogRef.current)
    ) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }

  const updateDefinition = (key, value) => {
    setDefinition(previous => ({ ...previous, [key]: value }))
    if (key === 'query' || key === 'parameters') setPreview(null)
  }
  return (
    <div className="sql-datasets-backdrop">
      <section
        className="sql-datasets-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sql-datasets-title"
        tabIndex={-1}
        ref={dialogRef}
        onKeyDown={trapFocus}
      >
        <header>
          <div>
            <h2 id="sql-datasets-title">{t('SQL datasets')}</h2>
            <p>
              {t(
                'Create reusable datasets from database queries. Refresh explicitly to publish a new snapshot.'
              )}
            </p>
          </div>
          <button type="button" onClick={onClose}>
            {t('Close')}
          </button>
        </header>
        {error && (
          <div role="alert" className="sql-datasets-error">
            {t(error)}
          </div>
        )}
        {notice && <div role="status">{t(notice)}</div>}
        {loading ? (
          <p>{t('Loading')}</p>
        ) : (
          <>
            <section>
              <h3>{t('Saved connections')}</h3>
              <div className="sql-datasets-actions">
                <label>
                  {t('Connection')}
                  <select
                    value={connection}
                    disabled={busy}
                    onChange={event => {
                      setConnection(event.target.value)
                      setPreview(null)
                    }}
                  >
                    <option value="">{t('Select a connection')}</option>
                    {connections.map(item => (
                      <option key={item.name} value={item.name}>
                        {item.name} ({item.dialect})
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" disabled={busy} onClick={() => setShowConnection(true)}>
                  {t('New connection')}
                </button>
              </div>
              {showConnection && (
                <fieldset disabled={busy}>
                  <legend>{t('New connection')}</legend>
                  <p>
                    {t(
                      'Use a database account with read-only permissions. Passwords are stored as project secrets.'
                    )}
                  </p>
                  <div className="sql-datasets-grid">
                    <label>
                      {t('Database type')}
                      <select
                        value={credentials.dialect}
                        onChange={event =>
                          setCredentials(previous => ({
                            ...previous,
                            dialect: event.target.value,
                            port: event.target.value === 'mysql' ? 3306 : 5432
                          }))
                        }
                      >
                        <option value="postgresql">PostgreSQL</option>
                        <option value="mysql">MySQL</option>
                      </select>
                    </label>
                    {Object.entries({
                      name: 'Connection name',
                      host: 'Host',
                      port: 'Port',
                      database: 'Database',
                      username: 'Username',
                      password: 'Password'
                    }).map(([key, label]) => (
                      <label key={key}>
                        {t(label)}
                        <input
                          type={
                            key === 'password' ? 'password' : key === 'port' ? 'number' : 'text'
                          }
                          autoComplete={key === 'password' ? 'new-password' : 'off'}
                          value={credentials[key]}
                          onChange={event =>
                            setCredentials(previous => ({ ...previous, [key]: event.target.value }))
                          }
                        />
                      </label>
                    ))}
                  </div>
                  <div className="sql-datasets-actions">
                    <button type="button" onClick={() => connectionAction(true)}>
                      {t('Test connection')}
                    </button>
                    <button type="button" onClick={() => connectionAction(false)}>
                      {t('Save connection')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCredentials(emptyConnection)
                        setShowConnection(false)
                      }}
                    >
                      {t('Cancel')}
                    </button>
                  </div>
                </fieldset>
              )}
            </section>
            <section>
              <h3>{t('New SQL dataset')}</h3>
              <p>
                {t(
                  'Use one SELECT or WITH query and named parameters such as :minimum. Definitions cannot be edited; use a new name for a different query.'
                )}
              </p>
              <fieldset disabled={busy} className="sql-datasets-definition">
                <label>
                  {t('Dataset name')}
                  <input
                    value={definition.name}
                    onChange={event => updateDefinition('name', event.target.value)}
                  />
                </label>
                <label>
                  {t('SQL query')}
                  <textarea
                    rows={5}
                    spellCheck={false}
                    value={definition.query}
                    onChange={event => updateDefinition('query', event.target.value)}
                  />
                </label>
                <label>
                  {t('Parameters (JSON)')}
                  <textarea
                    rows={2}
                    spellCheck={false}
                    value={definition.parameters}
                    onChange={event => updateDefinition('parameters', event.target.value)}
                  />
                </label>
                <label>
                  {t('Description (optional)')}
                  <input
                    value={definition.description}
                    onChange={event => updateDefinition('description', event.target.value)}
                  />
                </label>
                <p>{t('Import limits: 300 seconds and 1,000,000 rows.')}</p>
                <div className="sql-datasets-actions">
                  <button type="button" onClick={() => queryAction(false)}>
                    {t('Preview query')}
                  </button>
                  <button
                    type="button"
                    className="sql-datasets-primary"
                    onClick={() => queryAction(true)}
                  >
                    {t('Import dataset')}
                  </button>
                </div>
              </fieldset>
            </section>
            {preview && (
              <section>
                <h3>{t('Preview')}</h3>
                {!preview.rows.length ? (
                  <p>{t('The query returned no rows')}</p>
                ) : (
                  <div className="sql-datasets-table">
                    <table>
                      <thead>
                        <tr>
                          {preview.columns.map(column => (
                            <th key={column}>{column}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {preview.rows.map((row, index) => (
                          <tr key={index}>
                            {preview.columns.map(column => (
                              <td key={column}>{cellText(row[column])}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {preview.truncated && (
                  <p>
                    {t(
                      'Preview is limited; importing runs the full query within the configured limits.'
                    )}
                  </p>
                )}
              </section>
            )}
            <section>
              <h3>{t('Saved SQL datasets')}</h3>
              <p>
                {t('A saved definition may not have a snapshot until its first import succeeds.')}
              </p>
              {!datasets.length ? (
                <p>{t('No SQL datasets yet')}</p>
              ) : (
                <div className="sql-datasets-table">
                  <table>
                    <thead>
                      <tr>
                        <th>{t('Dataset')}</th>
                        <th>{t('Connection')}</th>
                        <th>{t('Snapshot')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {datasets.map(item => {
                        const run = runs[item.name]
                        const state = run?.status?.state
                        const pending = run && !terminalStates.includes(state)
                        const uri = `store://datasets/${project}/${item.name}:latest`
                        return (
                          <tr key={item.name}>
                            <td>
                              <strong>{item.name}</strong>
                              {item.description && <p>{item.description}</p>}
                              <details>
                                <summary>{t('SQL query')}</summary>
                                <pre>{item.query}</pre>
                                <pre>{JSON.stringify(item.parameters, null, 2)}</pre>
                              </details>
                            </td>
                            <td>{item.connection}</td>
                            <td>
                              <div className="sql-datasets-actions">
                                <button
                                  type="button"
                                  disabled={busy || pending}
                                  onClick={() => refresh(item.name)}
                                >
                                  {t('Refresh snapshot')}
                                </button>
                                <a
                                  href={`${import.meta.env.VITE_PUBLIC_URL || ''}${base}/datasets?name=${encodeURIComponent(item.name)}`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {t('Open dataset')}
                                </a>
                              </div>
                              {run && (
                                <div className="sql-datasets-run">
                                  <span>{t(stateLabel(state))}</span>{' '}
                                  <a
                                    href={`${import.meta.env.VITE_PUBLIC_URL || ''}${base}/jobs/monitor-jobs/${encodeURIComponent(run.metadata.uid)}/overview`}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {t('View job')}
                                  </a>
                                  {pending && (
                                    <button type="button" onClick={() => checkRun(item.name, run)}>
                                      {t('Check status')}
                                    </button>
                                  )}
                                  {(published[item.name] || state === 'completed') && (
                                    <code>{uri}</code>
                                  )}
                                  {terminalStates.includes(state) && state !== 'completed' && (
                                    <p>
                                      {t(
                                        'The import failed. Any previous successful snapshot is still available.'
                                      )}
                                    </p>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            {error && (
              <button type="button" disabled={busy} onClick={load}>
                {t('Retry loading')}
              </button>
            )}
          </>
        )}
        {busy && <p aria-live="polite">{t('Working')}</p>}
      </section>
    </div>
  )
}

SqlDatasetManager.propTypes = {
  project: PropTypes.string.isRequired,
  onClose: PropTypes.func.isRequired,
  onImported: PropTypes.func
}

function requestError(failure) {
  // Do not show Axios request/config objects or validation inputs containing credentials.
  const detail = failure.response?.data?.detail || failure.response?.data?.message
  return typeof detail === 'string'
    ? detail
    : failure.response
      ? 'Request failed. Please try again.'
      : failure.message || 'Request failed. Please try again.'
}

function stateLabel(state) {
  if (state === 'completed') return 'Completed'
  if (['error', 'failed', 'aborted'].includes(state)) return 'Failed'
  if (state === 'running') return 'Running'
  if (state === 'pending') return 'Pending'
  return 'Queued'
}

function cellText(value) {
  if (value == null) return ''
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}
