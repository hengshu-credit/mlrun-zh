const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const applyShell = require('./apply-shell.cjs')

test('applies the shell to fresh bilingual sources and can be repeated', () => {
  const temporaryRoot = fs.realpathSync(os.tmpdir())
  const root = fs.mkdtempSync(path.join(temporaryRoot, 'mlrun-shell-overlay-'))
  const fixtures = {
    'index.html': '<link href="/favicon.ico" />',
    'src/layout/Header/Header.jsx': `import React from 'react'
import Logo from 'igz-controls/images/mlrun-blue-logo.svg?react'
const Header = ({ navigate }) => (
  <header>
    <Logo className="header__logo" alt="MLRun" />
    <div>
          <div>The Open Source MLOps</div>
          <div>Orchestration Framework</div>
        </div>
        <a href="https://docs.mlrun.org/en/latest/">Documentation</a>
        <a href="https://www.mlrun.org/hub/">Function hub</a>
  </header>
)
Header.propTypes = { navigate: PropTypes.func }
`,
    'src/App.jsx': `import './scss/main.scss'
const App = () => <><Header navigate={router.navigate} /><Route path="projects" element={<Projects />} /></>
`,
    'src/layout/Page/Page.jsx': "import Sidebar from '../../nextGenComponents/shared/Sidebar'",
    'src/nextGenComponents/shared/Sidebar/ProjectDropdown/ProjectDropdown.jsx': `
ref={project.isCurrent ? currentProjectRef : null}
data-testid="sidebar-project-dropdown-trigger"
className="w-[--radix-popper-anchor-width]"
`
  }
  try {
    for (const [relative, source] of Object.entries(fixtures)) {
      const filename = path.join(root, relative)
      fs.mkdirSync(path.dirname(filename), { recursive: true })
      fs.writeFileSync(filename, source)
    }
    applyShell(root)
    const first = Object.fromEntries(Object.keys(fixtures).map(relative => [relative, fs.readFileSync(path.join(root, relative), 'utf8')]))
    assert.match(first['src/App.jsx'], /import ResourceFrame/)
    assert.match(first['src/App.jsx'], /import '\.\/i18n\/tianshu-shell\.css'/)
    assert.match(first['src/App.jsx'], /path="documentation"/)
    applyShell(root)
    for (const [relative, source] of Object.entries(first)) {
      assert.equal(fs.readFileSync(path.join(root, relative), 'utf8'), source)
    }
  } finally {
    const resolved = fs.realpathSync(root)
    assert.equal(path.dirname(resolved), temporaryRoot)
    assert.ok(path.basename(resolved).startsWith('mlrun-shell-overlay-'))
    fs.rmSync(resolved, { recursive: true, force: true })
  }
})
