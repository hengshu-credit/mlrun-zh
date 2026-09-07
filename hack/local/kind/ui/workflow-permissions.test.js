import { beforeEach, describe, expect, it, vi } from 'vitest'
import projectsIguazioApi from '../../api/projects-iguazio-api'
import { fetchMissingProjectPermission, fetchMissingProjectsPermissions } from './workflow.util'

vi.mock('../../api/projects-iguazio-api', () => ({
  default: {
    getProjectOwnerVisibility: vi.fn(),
    getProjectWorkflowsUpdateAuthorization: vi.fn()
  }
}))
vi.mock('../Jobs/jobs.util', () => ({ page: {} }))
vi.mock('../../reducers/projectReducer', () => ({
  setAccessibleProjectsMap: payload => ({ type: 'permissions', payload })
}))

describe.each([
  [
    'list',
    (map, dispatch, authentication) =>
      fetchMissingProjectsPermissions(
        ['deployment-smoke', 'deployment-smoke'],
        map,
        dispatch,
        authentication
      )
  ],
  [
    'detail',
    (map, dispatch, authentication) =>
      fetchMissingProjectPermission('deployment-smoke', map, dispatch, authentication)
  ]
])('%s workflow permissions', (_name, fetchPermissions) => {
  beforeEach(() => {
    vi.resetAllMocks()
    projectsIguazioApi.getProjectOwnerVisibility.mockResolvedValue({})
    projectsIguazioApi.getProjectWorkflowsUpdateAuthorization.mockResolvedValue({})
  })

  it('allows explicit no-auth mode without requesting Iguazio permissions', async () => {
    const dispatch = vi.fn()
    await fetchPermissions({}, dispatch, 'none')
    expect(projectsIguazioApi.getProjectOwnerVisibility).not.toHaveBeenCalled()
    expect(projectsIguazioApi.getProjectWorkflowsUpdateAuthorization).not.toHaveBeenCalled()
    expect(dispatch).toHaveBeenCalledWith({
      type: 'permissions',
      payload: { 'deployment-smoke': true }
    })
  })

  it('waits for frontend-spec before caching any permission decision', async () => {
    const dispatch = vi.fn()
    await fetchPermissions({}, dispatch, undefined)
    expect(projectsIguazioApi.getProjectOwnerVisibility).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('preserves denied access and existing projects in authenticated mode', async () => {
    projectsIguazioApi.getProjectOwnerVisibility.mockRejectedValue(new Error('403'))
    projectsIguazioApi.getProjectWorkflowsUpdateAuthorization.mockRejectedValue(new Error('403'))
    const dispatch = vi.fn()
    await fetchPermissions({ other: true }, dispatch, 'iguazio')
    expect(projectsIguazioApi.getProjectOwnerVisibility).toHaveBeenCalledExactlyOnceWith(
      'deployment-smoke'
    )
    expect(
      projectsIguazioApi.getProjectWorkflowsUpdateAuthorization
    ).toHaveBeenCalledExactlyOnceWith('deployment-smoke')
    expect(dispatch).toHaveBeenCalledWith({
      type: 'permissions',
      payload: { other: true, 'deployment-smoke': false }
    })
  })

  it('keeps owner and workflow-specific authorization checks', async () => {
    const dispatch = vi.fn()
    await fetchPermissions({}, dispatch, 'iguazio')
    expect(projectsIguazioApi.getProjectWorkflowsUpdateAuthorization).not.toHaveBeenCalled()
    projectsIguazioApi.getProjectOwnerVisibility.mockRejectedValue(new Error('403'))
    await fetchPermissions({}, dispatch, 'iguazio')
    expect(projectsIguazioApi.getProjectWorkflowsUpdateAuthorization).toHaveBeenCalledWith(
      'deployment-smoke'
    )
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'permissions',
      payload: { 'deployment-smoke': true }
    })
  })

  it('does not refetch a cached project', async () => {
    const dispatch = vi.fn()
    await fetchPermissions({ 'deployment-smoke': true }, dispatch, 'iguazio')
    expect(projectsIguazioApi.getProjectOwnerVisibility).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })
})
