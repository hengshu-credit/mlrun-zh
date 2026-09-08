import React from 'react'
import PropTypes from 'prop-types'
import { t, useLocale } from './locale'

const resources = {
  documentation: { title: 'Documentation', url: 'https://docs.mlrun.org/en/latest/' },
  'function-hub': { title: 'Function hub', url: 'https://www.mlrun.org/hub/' }
}

export default function ResourceFrame({ resource }) {
  useLocale()
  const { title, url } = resources[resource]
  return <iframe
    className="mlrun-resource-frame"
    src={url}
    title={t(title)}
    sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
  />
}

ResourceFrame.propTypes = { resource: PropTypes.oneOf(Object.keys(resources)).isRequired }
