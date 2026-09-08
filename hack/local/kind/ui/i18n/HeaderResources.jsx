import React, { useSyncExternalStore } from 'react'
import PropTypes from 'prop-types'
import { t, useLocale } from './locale'

const noSubscription = () => () => {}
const defaultPath = () => '/projects'

export default function HeaderResources({ router, navigate }) {
  useLocale()
  // Header lives outside RouterProvider. Subscribe only this navigation fragment
  // so project switches update links without recreating the application router.
  const locationPath = useSyncExternalStore(
    router?.subscribe || noSubscription,
    router ? () => router.state.location.pathname : defaultPath,
    defaultPath
  )
  const base = (import.meta.env.VITE_PUBLIC_URL || '').replace(/\/$/, '')
  const pathname = base && locationPath.startsWith(`${base}/`)
    ? locationPath.slice(base.length)
    : locationPath
  const project = pathname.match(/^\/projects\/([^/]+)(?:\/|$)/)?.[1]
  const prefix = project && project !== '*' ? `/projects/${project}` : ''

  return <>
    {[
      ['documentation', 'Documentation'],
      ['function-hub', 'Function hub']
    ].map(([resource, label]) => {
      const path = `${prefix}/${resource}`
      return <a key={resource}
        href={`${base}${path}`}
        className="header__documentation"
        aria-current={pathname === path ? 'page' : undefined}
        onClick={event => {
          if (navigate && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
            event.preventDefault()
            navigate(path)
          }
        }}>
        {t(label)}
      </a>
    })}
  </>
}

HeaderResources.propTypes = {
  navigate: PropTypes.func,
  router: PropTypes.shape({ subscribe: PropTypes.func.isRequired, state: PropTypes.object.isRequired })
}
