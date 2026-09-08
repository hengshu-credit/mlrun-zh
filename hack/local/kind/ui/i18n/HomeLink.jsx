import React from 'react'
import PropTypes from 'prop-types'
import { t, useLocale } from './locale'

export default function HomeLink({ navigate, children }) {
  useLocale()
  return (
    <a
      href={`${import.meta.env.VITE_PUBLIC_URL}/projects`}
      aria-label={t('Projects')}
      onClick={event => {
        if (
          navigate &&
          event.button === 0 &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.shiftKey &&
          !event.altKey
        ) {
          event.preventDefault()
          navigate('/projects')
        }
      }}
    >
      {children}
    </a>
  )
}

HomeLink.propTypes = { navigate: PropTypes.func, children: PropTypes.node }
