import React from 'react'
import PropTypes from 'prop-types'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import Datasets from '../components/Datasets/Datasets'
import { mainHttpClient } from '../httpClient'
import { setLocale } from '../i18n/locale'

vi.mock('../httpClient', () => ({ mainHttpClient: { get: vi.fn(), post: vi.fn() } }))
vi.mock('react-redux', () => ({ useSelector: () => ({ datasets: { datasetLoading: false } }) }))
vi.mock('../components/Artifacts/Artifacts', () => {
  function ArtifactActions({ actionButtons }) {
    return (
      <div>
        {actionButtons.map(action => (
          <button key={action.label} onClick={action.onClick}>
            {action.label}
          </button>
        ))}
      </div>
    )
  }
  ArtifactActions.propTypes = { actionButtons: PropTypes.array }
  return { default: ArtifactActions }
})
// Existing artifact editing and registration are unrelated to the new action entry.
vi.mock('../components/Datasets/datasets.util', () => ({
  generateActionsMenu: vi.fn(),
  generatePageData: vi.fn(),
  handleApplyDetailsChanges: vi.fn(),
  registerDatasetTitle: 'Register dataset'
}))
vi.mock('../components/RegisterArtifactModal/RegisterArtifactModal', () => ({
  default: () => null
}))
vi.mock('../utils/createArtifactsContent', () => ({ createDatasetsRowData: vi.fn() }))
vi.mock('../reducers/artifactsReducer', () => ({ fetchDataSets: vi.fn(), removeDataSets: vi.fn() }))
vi.mock('igz-controls/utils/common.util', () => ({ openPopUp: vi.fn() }))

afterEach(() => {
  cleanup()
  setLocale('en')
})

it('opens SQL datasets from the real dataset page using its project route and current language', async () => {
  mainHttpClient.get.mockResolvedValue({ data: { connections: [], datasets: [] } })
  setLocale('zh-CN')
  render(
    <MemoryRouter initialEntries={['/projects/demo/datasets']}>
      <Routes>
        <Route
          path="/projects/:projectName/datasets"
          element={<Datasets isAllVersions={false} />}
        />
      </Routes>
    </MemoryRouter>
  )
  fireEvent.click(screen.getByRole('button', { name: 'SQL 数据集' }))
  expect(await screen.findByText('暂无 SQL 数据集')).toBeInTheDocument()
  expect(mainHttpClient.get).toHaveBeenCalledWith('/projects/demo/sql-datasets')
  await act(async () => setLocale('en'))
  expect(screen.getByRole('dialog', { name: 'SQL datasets' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Register dataset' })).toBeInTheDocument()
})
