import React, { useMemo } from 'react'
import PropTypes from 'prop-types'
import { useParams } from 'react-router-dom'
import { generateNuclioLink } from '../utils/parseUri'
import { t, useLocale } from './locale'

export default function NuclioFrame({ page, title }) {
  const { projectName } = useParams()
  useLocale()
  // Capture the initial language per page/project. Shell language changes must
  // not reload the embedded editor and discard work in progress.
  const src = useMemo(
    () => generateNuclioLink(`/projects/${encodeURIComponent(projectName)}/${page}`),
    [projectName, page],
  )

  return <iframe className="mlrun-nuclio-frame" src={src} title={t(title)} />
}

NuclioFrame.propTypes = {
  page: PropTypes.oneOf(['functions', 'api-gateways']).isRequired,
  title: PropTypes.string.isRequired,
}
