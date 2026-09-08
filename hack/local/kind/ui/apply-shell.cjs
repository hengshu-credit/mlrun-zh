// Keep shell customizations reproducible on the pinned upstream checkout.
const fs = require('node:fs')
const path = require('node:path')

module.exports = (root) => {
  function update(relative, marker, search, replacement) {
    const file = path.join(root, relative)
    const source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
    if (source.includes(marker)) return
    if (!source.includes(search))
      throw new Error(`Shell integration point changed: ${relative}`)
    fs.writeFileSync(file, source.replace(search, replacement))
  }

  update(
    'index.html',
    'href="/src/i18n/assets/hengshucredit_animated.svg"',
    'href="/favicon.ico"',
    'href="/src/i18n/assets/hengshucredit_animated.svg"',
  )

  const header = 'src/layout/Header/Header.jsx'
  update(
    header,
    'import brandLogo',
    "import Logo from 'igz-controls/images/mlrun-blue-logo.svg?react'",
    "import brandLogo from '../../i18n/assets/hengshucredit_animated.svg'",
  )
  update(
    header,
    'src={brandLogo}',
    '<Logo className="header__logo" alt="MLRun" />',
    '<img src={brandLogo} className="header__logo" alt="MLRun" />',
  )
  update(
    header,
    'header__brand-copy',
    '<div>\n          <div>The Open Source MLOps</div>\n          <div>Orchestration Framework</div>\n        </div>',
    '<div className="header__brand-copy">\n          <strong>MLRun</strong>\n          <span>天工开物，枢衡定策</span>\n        </div>',
  )

  update(
    header,
    '<span>Crafting Innovation, Guiding Decisions</span>',
    '<span>天工开物，枢衡定策</span>',
    '<span>Crafting Innovation, Guiding Decisions</span>',
  )

  const headerFile = path.join(root, header)
  let source = fs.readFileSync(headerFile, 'utf8')
  for (const name of ['GithubIcon', 'SlackIcon']) {
    if (!source.includes(`import ${name}`)) continue
    const anchor = new RegExp(`        <a\\s[^>]*>\\s*<${name} />\\s*</a>\\n`)
    if (!anchor.test(source))
      throw new Error(`Header community link changed: ${name}`)
    source = source
      .replace(anchor, '')
      .replace(new RegExp(`import ${name} from [^\\n]+\\n`), '')
  }
  fs.writeFileSync(headerFile, source)
  update(header, 'import HeaderResources', "import React from 'react'",
    "import React from 'react'\nimport HeaderResources from '../../i18n/HeaderResources'")
  update(header, 'const Header = ({ navigate, router })', 'const Header = ({ navigate })',
    'const Header = ({ navigate, router })')
  update(header, 'router: PropTypes.object', 'Header.propTypes = { navigate: PropTypes.func }',
    'Header.propTypes = { navigate: PropTypes.func, router: PropTypes.object }')
  source = fs.readFileSync(headerFile, 'utf8')
  if (!source.includes('<HeaderResources')) {
    const links = /        <a\s+href="https:\/\/docs\.mlrun\.org\/en\/latest\/"[\s\S]*?<\/a>\s*<a\s+href="https:\/\/www\.mlrun\.org\/hub\/"[\s\S]*?<\/a>/
    if (!links.test(source)) throw new Error('Header resource links changed upstream')
    fs.writeFileSync(headerFile, source.replace(links, '        <HeaderResources navigate={navigate} router={router} />'))
  }
  update('src/App.jsx', '<Header navigate={router.navigate} router={router}',
    '<Header navigate={router.navigate} />', '<Header navigate={router.navigate} router={router} />')
  update('src/App.jsx', "import ResourceFrame from './i18n/ResourceFrame'",
    "import './i18n/tianshu-shell.css'", "import './i18n/tianshu-shell.css'\nimport ResourceFrame from './i18n/ResourceFrame'")
  update('src/App.jsx', 'path="documentation"',
    '<Route path="projects" element={<Projects />} />',
    `<Route path="projects" element={<Projects />} />
          <Route path="documentation" element={<ResourceFrame resource="documentation" />} />
          <Route path="function-hub" element={<ResourceFrame resource="function-hub" />} />
          <Route path="projects/:projectName/documentation" element={<ResourceFrame resource="documentation" />} />
          <Route path="projects/:projectName/function-hub" element={<ResourceFrame resource="function-hub" />} />`)
  update(
    'src/layout/Page/Page.jsx',
    "import Sidebar from '../../i18n/TianshuSidebar'",
    "import Sidebar from '../../nextGenComponents/shared/Sidebar'",
    "import Sidebar from '../../i18n/TianshuSidebar'",
  )
  update(
    'src/App.jsx',
    "import './i18n/tianshu-shell.css'",
    "import './scss/main.scss'",
    "import './scss/main.scss'\nimport './i18n/tianshu-shell.css'",
  )
  update(
    'src/App.jsx',
    "import NuclioFrame from './i18n/NuclioFrame'",
    "import './i18n/tianshu-shell.css'",
    "import './i18n/tianshu-shell.css'\nimport NuclioFrame from './i18n/NuclioFrame'",
  )
  update(
    'src/App.jsx',
    'path="projects/:projectName/real-time-functions"',
    '<Route path="projects" element={<Projects />} />',
    `<Route path="projects" element={<Projects />} />
          <Route path="projects/:projectName/real-time-functions" element={<NuclioFrame page="functions" title="Real-time functions" />} />
          <Route path="projects/:projectName/api-gateways" element={<NuclioFrame page="api-gateways" title="API gateways" />} />`,
  )

  // The compact project selector remains the same accessible dropdown trigger.
  update(
    'src/nextGenComponents/shared/Sidebar/ProjectDropdown/ProjectDropdown.jsx',
    "aria-current={project.isCurrent ? 'page' : undefined}",
    'ref={project.isCurrent ? currentProjectRef : null}',
    "ref={project.isCurrent ? currentProjectRef : null}\n                        aria-current={project.isCurrent ? 'page' : undefined}",
  )
  update(
    'src/nextGenComponents/shared/Sidebar/ProjectDropdown/ProjectDropdown.jsx',
    'aria-label={projectName}',
    'data-testid="sidebar-project-dropdown-trigger"',
    'data-testid="sidebar-project-dropdown-trigger"\n            aria-label={projectName}',
  )
  update(
    'src/nextGenComponents/shared/Sidebar/ProjectDropdown/ProjectDropdown.jsx',
    'min-w-[240px]',
    'className="w-[--radix-popper-anchor-width]',
    'className="min-w-[240px] w-[--radix-popper-anchor-width]',
  )
}
