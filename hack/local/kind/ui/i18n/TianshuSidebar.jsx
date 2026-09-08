import React, { useEffect, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import { FolderOpen } from 'lucide-react'
import ProjectDropdown from '../nextGenComponents/shared/Sidebar/ProjectDropdown'
import { NUCLIO_PAGE } from '../constants'
import {
  getFooterLinks,
  getLinks,
} from '../nextGenComponents/shared/Sidebar/navbarList.util'
import SidebarEntry from './SidebarEntry'
import { t, useLocale } from './locale'

const storageKey = 'mlrun:layout:sidebar-width'
const clampWidth = (width) => Math.min(320, Math.max(64, Math.round(width)))

export default function TianshuSidebar({ projectName }) {
  useLocale()
  const [width, setWidth] = useState(readWidth)
  const [resizing, setResizing] = useState(false)
  const drag = useRef(null)

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(width))
    } catch {
      /* Storage is optional. */
    }
    window.dispatchEvent(new CustomEvent('mainResize'))
  }, [width])

  const stopResize = () => {
    drag.current = null
    setResizing(false)
  }
  const compact = width < 168

  return (
    <aside
      className={`tianshu-sidebar${resizing ? ' is-resizing' : ''}`}
      style={{ width }}
      data-testid="sidebar"
      data-compact={compact}
    >
      <div className="tianshu-project">
        <FolderOpen className="tianshu-project-icon" aria-hidden="true" />
        <ProjectDropdown projectName={projectName} />
      </div>
      <nav className="tianshu-navigation" aria-label={t('Main navigation')}>
        <ul>
          {getLinks(projectName).map((link) => link.id === NUCLIO_PAGE ? {
            ...link,
            nestedLinks: link.nestedLinks.map((child) => ({
              ...child,
              link: `/projects/${projectName}/${child.id}`,
              externalLink: false,
            })),
          } : link).map((link) => (
            <SidebarEntry key={link.id} {...link} compact={compact} />
          ))}
        </ul>
      </nav>
      <nav
        className="tianshu-sidebar-footer"
        aria-label={t('Project tools')}
        data-testid="sidebar-footer"
      >
        <ul>
          {getFooterLinks(projectName).map((link) => (
            <SidebarEntry key={link.id} {...link} compact={compact} />
          ))}
        </ul>
      </nav>
      <div
        className="tianshu-resizer"
        role="separator"
        tabIndex={0}
        aria-label={t('Resize sidebar')}
        title={t('Drag to resize sidebar')}
        aria-orientation="vertical"
        aria-valuemin={64}
        aria-valuemax={320}
        aria-valuenow={width}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.preventDefault()
          event.currentTarget.setPointerCapture?.(event.pointerId)
          drag.current = { x: event.clientX, width }
          setResizing(true)
        }}
        onPointerMove={(event) => {
          if (drag.current)
            setWidth(
              clampWidth(drag.current.width + event.clientX - drag.current.x),
            )
        }}
        onPointerUp={stopResize}
        onPointerCancel={stopResize}
        onLostPointerCapture={stopResize}
        onKeyDown={(event) => {
          const next = {
            ArrowLeft: width - 8,
            ArrowRight: width + 8,
            Home: 64,
            End: 320,
          }[event.key]
          if (next !== undefined) {
            event.preventDefault()
            setWidth(clampWidth(next))
          }
        }}
      />
    </aside>
  )
}

TianshuSidebar.propTypes = { projectName: PropTypes.string.isRequired }

function readWidth() {
  try {
    const saved = localStorage.getItem(storageKey)
    const value = Number(saved)
    if (saved?.trim() && Number.isFinite(value)) return clampWidth(value)
  } catch {
    /* Storage is optional. */
  }
  return 220
}
