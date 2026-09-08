import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation } from 'react-router-dom'
import PropTypes from 'prop-types'
import { ChevronRight } from 'lucide-react'
import { t } from './locale'

export default function SidebarEntry({
  label,
  icon,
  link,
  externalLink,
  nestedLinks,
  compact,
}) {
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const trigger = useRef(null)
  const panel = useRef(null)
  const closeTimer = useRef(null)
  const focusChild = useRef(false)
  const popupId = useId()
  const hasChildren = Boolean(nestedLinks)
  const active = nestedLinks
    ? nestedLinks.some(
        (child) => !child.externalLink && matches(pathname, child.link),
      )
    : !externalLink && matches(pathname, link)

  const cancelClose = () => clearTimeout(closeTimer.current)
  const close = () => {
    cancelClose()
    setOpen(false)
  }
  const show = () => {
    cancelClose()
    if (compact) {
      trigger.current.closest('aside').dispatchEvent(
        new CustomEvent('mlrun-sidebar-popup', { detail: popupId }),
      )
    }
    setOpen(true)
  }
  const scheduleClose = () => {
    cancelClose()
    closeTimer.current = setTimeout(() => setOpen(false), 160)
  }

  useEffect(() => {
    clearTimeout(closeTimer.current)
    setOpen(!compact && active && hasChildren)
  }, [pathname, compact, active, hasChildren])
  useEffect(() => () => clearTimeout(closeTimer.current), [])

  useLayoutEffect(() => {
    if (!open) return
    if (!hasChildren) return
    if (compact) {
      const rect = trigger.current.getBoundingClientRect()
      const sidebar = trigger.current.closest('aside').getBoundingClientRect()
      const height = panel.current.offsetHeight
      const width = panel.current.offsetWidth
      setPosition({
        top: Math.max(8, Math.min(rect.top, window.innerHeight - height - 8)),
        left: Math.max(8, Math.min(sidebar.right, window.innerWidth - width - 8)),
      })
    }
    if (focusChild.current) {
      panel.current.querySelector('a')?.focus()
      focusChild.current = false
    }
  }, [open, compact, hasChildren])

  useEffect(() => {
    if (!open || !compact || !hasChildren) return
    const dismiss = (event) => {
      if (
        !trigger.current?.contains(event.target) &&
        !panel.current?.contains(event.target)
      )
        setOpen(false)
    }
    const onScroll = (event) => {
      if (!panel.current?.contains(event.target)) setOpen(false)
    }
    const onResize = () => setOpen(false)
    const sidebar = trigger.current.closest('aside')
    const onPopupOpen = (event) => {
      if (event.detail !== popupId) setOpen(false)
    }
    sidebar.addEventListener('mlrun-sidebar-popup', onPopupOpen)
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('focusin', dismiss)
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    window.addEventListener('mainResize', onResize)
    window.addEventListener('blur', onResize)
    return () => {
      sidebar.removeEventListener('mlrun-sidebar-popup', onPopupOpen)
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('focusin', dismiss)
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('mainResize', onResize)
      window.removeEventListener('blur', onResize)
    }
  }, [open, compact, popupId, hasChildren])

  const content = (
    <>
      <span className="tianshu-menu-icon" aria-hidden="true">
        {icon}
      </span>
      {!compact && <span className="tianshu-menu-label">{t(label)}</span>}
    </>
  )
  const className = `tianshu-menu-item${active ? ' is-active' : ''}`

  const submenu = open && nestedLinks && (
    <div
      ref={panel}
      id={popupId}
      className={compact ? 'tianshu-flyout' : 'tianshu-submenu'}
      style={compact ? position : undefined}
      onMouseEnter={compact ? cancelClose : undefined}
      onMouseLeave={compact ? scheduleClose : undefined}
      onKeyDown={(event) => {
        if (event.key === 'Escape' || event.key === 'ArrowLeft') {
          event.preventDefault()
          close()
          trigger.current?.focus()
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          const children = [...panel.current.querySelectorAll('a')]
          const index = children.indexOf(document.activeElement)
          children[
            (index + (event.key === 'ArrowDown' ? 1 : -1) + children.length) % children.length
          ]?.focus()
        }
      }}
    >
      {compact && <div className="tianshu-flyout-title">{t(label)}</div>}
      <ul>
        {nestedLinks.map((child) => (
          <li key={child.id}>
            {child.externalLink ? (
              <a href={child.link} target="_top" onClick={compact ? close : undefined}>
                {t(child.label)}
              </a>
            ) : (
              <Link
                to={child.link}
                onClick={compact ? close : undefined}
                aria-current={matches(pathname, child.link) ? 'page' : undefined}
              >
                {t(child.label)}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  )

  return (
    <li
      onMouseEnter={compact && nestedLinks ? show : undefined}
      onMouseLeave={compact && nestedLinks ? scheduleClose : undefined}
    >
      {nestedLinks ? (
        <>
          <button
            ref={trigger}
            type="button"
            className={className}
            aria-label={t(label)}
            aria-expanded={open}
            aria-controls={open ? popupId : undefined}
            onClick={() => (compact || !open ? show() : close())}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                event.preventDefault()
                focusChild.current = true
                show()
                if (open) panel.current?.querySelector('a')?.focus()
              } else if (event.key === 'Escape') close()
            }}
          >
            {content}
            {!compact && (
              <ChevronRight
                className="tianshu-menu-chevron"
                aria-hidden="true"
              />
            )}
          </button>
          {submenu && (compact ? createPortal(submenu, document.body) : submenu)}
        </>
      ) : externalLink ? (
        <a
          className={className}
          href={link}
          target="_top"
          aria-label={t(label)}
          title={compact ? t(label) : undefined}
        >
          {content}
        </a>
      ) : (
        <Link
          className={className}
          to={link}
          aria-label={t(label)}
          title={compact ? t(label) : undefined}
          aria-current={active ? 'page' : undefined}
        >
          {content}
        </Link>
      )}
    </li>
  )
}

SidebarEntry.propTypes = {
  label: PropTypes.string.isRequired,
  icon: PropTypes.node,
  link: PropTypes.string,
  externalLink: PropTypes.bool,
  compact: PropTypes.bool,
  nestedLinks: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
      label: PropTypes.string.isRequired,
      link: PropTypes.string.isRequired,
      externalLink: PropTypes.bool,
    }),
  ),
}

function matches(pathname, link) {
  return Boolean(link && (pathname === link || pathname.startsWith(`${link}/`)))
}
