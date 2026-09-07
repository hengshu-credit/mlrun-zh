// Apply to a disposable, pinned upstream UI checkout; do not rewrite backend sources.
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(process.argv[2] || '.')
if (!fs.existsSync(path.join(root, 'src/layout/Header/Header.jsx'))) {
  throw new Error('Expected a complete MLRun UI source directory')
}
const destination = path.join(root, 'src/i18n')
fs.mkdirSync(destination, { recursive: true })
fs.cpSync(path.join(__dirname, 'i18n'), destination, { recursive: true })

function update(relative, marker, search, replacement) {
  const file = path.join(root, relative)
  const source = fs.readFileSync(file, 'utf8')
  if (source.includes(marker)) return
  if (!source.includes(search)) throw new Error(`Upstream integration point changed: ${relative}`)
  fs.writeFileSync(file, source.replace(search, replacement))
}

update('src/layout/Header/Header.jsx', "import LanguageSelector", "import React from 'react'",
  "import React from 'react'\nimport LanguageSelector from '../../i18n/LanguageSelector'")
update('src/layout/Header/Header.jsx', '<LanguageSelector />', '<div className="header__actions">',
  '<div className="header__actions">\n        <LanguageSelector />')
for (const config of ['vite.config.mjs', 'vitest.config.mjs']) {
  update(config, "const mlrunLocalization", "import { defineConfig", "import { createRequire } from 'node:module'\nconst mlrunLocalization = createRequire(import.meta.url)('./src/i18n/vite-plugin.cjs')\nimport { defineConfig")
  update(config, 'plugins: [mlrunLocalization()', 'plugins: [', 'plugins: [mlrunLocalization(), ')
}
console.log(`Applied bilingual UI overlay to ${root}`)
