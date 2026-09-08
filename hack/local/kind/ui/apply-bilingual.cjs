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

update(
  'src/layout/Header/Header.jsx',
  'import LanguageSelector',
  "import React from 'react'",
  "import React from 'react'\nimport LanguageSelector from '../../i18n/LanguageSelector'"
)
update(
  'src/layout/Header/Header.jsx',
  '<LanguageSelector />',
  '<div className="header__actions">',
  '<div className="header__actions">\n        <LanguageSelector />'
)
update(
  'src/layout/Header/Header.jsx',
  'import HomeLink',
  "import React from 'react'",
  "import React from 'react'\nimport PropTypes from 'prop-types'\nimport HomeLink from '../../i18n/HomeLink'"
)
update(
  'src/layout/Header/Header.jsx',
  '<HomeLink navigate=',
  '<a href={`${import.meta.env.VITE_PUBLIC_URL}/`}>\n          <Logo className="header__logo" alt="MLRun" />\n        </a>',
  '<HomeLink navigate={navigate}>\n          <Logo className="header__logo" alt="MLRun" />\n        </HomeLink>'
)
update(
  'src/layout/Header/Header.jsx',
  'const Header = ({ navigate',
  'const Header = ()',
  'const Header = ({ navigate })'
)
update(
  'src/layout/Header/Header.jsx',
  'Header.propTypes',
  'export default Header',
  'Header.propTypes = { navigate: PropTypes.func }\n\nexport default Header'
)
update('src/App.jsx', '<Header navigate=', '<Header />', '<Header navigate={router.navigate} />')
update(
  'src/utils/parseUri.js',
  'import { getLocale }',
  'const generateNuclioLink =',
  "import { getLocale } from '../i18n/locale'\n\nconst generateNuclioLink ="
)
update(
  'src/utils/parseUri.js',
  "linkUrl.searchParams.set('lng'",
  'return linkUrl.toString()',
  "linkUrl.searchParams.set('lng', getLocale())\n  return linkUrl.toString()"
)
for (const config of ['vite.config.mjs', 'vitest.config.mjs']) {
  update(
    config,
    'const mlrunLocalization',
    'import { defineConfig',
    "import { createRequire } from 'node:module'\nconst mlrunLocalization = createRequire(import.meta.url)('./src/i18n/vite-plugin.cjs')\nimport { defineConfig"
  )
  update(config, 'plugins: [mlrunLocalization()', 'plugins: [', 'plugins: [mlrunLocalization(), ')
}

// These components render application-defined field/column descriptors. Only the
// presentation expressions are localized; row keys, test IDs and data values stay raw.
const sectionTable = 'src/elements/SectionTable/SectionTable.jsx'
update(
  sectionTable,
  'import { displayLabel',
  "import React from 'react'",
  "import React from 'react'\nimport { displayLabel, displayStatus } from '../../i18n/presentation'"
)
update(
  sectionTable,
  'text={displayLabel(header.value)}',
  'text={header.value}',
  'text={displayLabel(header.value)}'
)
update(
  sectionTable,
  '\n                        {displayLabel(header.value)}\n',
  '\n                        {header.value}\n',
  '\n                        {displayLabel(header.value)}\n'
)
update(
  sectionTable,
  'text={displayStatus(status)}',
  'text={status}',
  'text={displayStatus(status)}'
)
update(
  sectionTable,
  'displayStatus(body[key].value)',
  'text={body[key].tooltip || body[key].value}',
  'text={body[key].tooltip || displayStatus(body[key].value)}'
)
const tableFile = path.join(root, sectionTable)
let tableSource = fs.readFileSync(tableFile, 'utf8')
const statusStart = tableSource.indexOf(") : key === 'status' ? (")
const statusEnd = tableSource.indexOf(') : (', statusStart + 1)
// Find the end of the status branch after its inner conditional.
const statusTail = tableSource.indexOf(') : (\n                            <>', statusEnd + 1)
if (!tableSource.includes('{displayStatus(body[key].value)}')) {
  if (statusStart < 0 || statusTail < 0) throw new Error('SectionTable status branch changed')
  const branch = tableSource
    .slice(statusStart, statusTail)
    .replace('{body[key].value}', '{displayStatus(body[key].value)}')
  tableSource = tableSource.slice(0, statusStart) + branch + tableSource.slice(statusTail)
  fs.writeFileSync(tableFile, tableSource)
}
const detailsTable = 'src/nextGenComponents/shared/DetailsInfoTable/DetailsInfoTable.jsx'
update(
  detailsTable,
  'import { displayLabel',
  "import React from 'react'",
  "import React from 'react'\nimport { displayLabel } from '../../../i18n/presentation'"
)
update(detailsTable, '{displayLabel(item.label)}', '{item.label}', '{displayLabel(item.label)}')
const configurationLabel =
  'src/nextGenComponents/pages/ApplicationsPage/ApplicationDetails/Configuration/LabelWithTooltip.jsx'
update(
  configurationLabel,
  'import { t }',
  "import React from 'react'",
  "import React from 'react'\nimport { t } from '../../../../../i18n/locale'"
)
update(configurationLabel, '{t(label)}', '{label}', '{t(label)}')
update(configurationLabel, '{t(tooltipText)}', '{tooltipText}', '{t(tooltipText)}')
// Monitoring labels are locally defined constants; API status filters stay raw.
const monitoring = 'src/utils/generateMonitoringData.js'
update(
  monitoring,
  "import { t } from '../i18n/locale'",
  'const IN_PROCESS',
  "import { t } from '../i18n/locale'\n\nconst IN_PROCESS"
)
const monitoringFile = path.join(root, monitoring)
let monitoringSource = fs.readFileSync(monitoringFile, 'utf8')
for (const label of ['IN_PROCESS', 'FAILED', 'SUCCEEDED', 'RUNNING']) {
  const getter = `get label() { return t(${label}) }`
  if (monitoringSource.includes(getter)) continue
  if (!monitoringSource.includes(`label: ${label}`)) {
    throw new Error(`Monitoring label changed: ${label}`)
  }
  monitoringSource = monitoringSource.replaceAll(`label: ${label}`, getter)
}
fs.writeFileSync(monitoringFile, monitoringSource)
const noData = 'src/utils/getNoDataMessage.js'
update(
  noData,
  'import { t, getLocale }',
  'import { isEqual, keyBy }',
  "import { t, getLocale } from '../i18n/locale'\nimport { isEqual, keyBy }"
)
update(
  noData,
  "return t('No data to show')",
  "return 'No data to show'",
  "return t('No data to show')"
)
update(
  noData,
  "t('No {0} found'",
  '`No ${messageNames.plural.toLocaleLowerCase()} found`',
  "t('No {0} found', [getLocale() === 'en' ? messageNames.plural.toLocaleLowerCase() : t(messageNames.plural)])"
)
update(
  noData,
  "}, t('No data matches the filter:",
  "}, 'No data matches the filter: \"')",
  "}, t('No data matches the filter: \"'))"
)
update(noData, '/[:：]$/.test(label)', "label.endsWith(':')", '/[:：]$/.test(label)')
// Popup props capture their opening language; derive this fixed title at render time.
update(
  'src/components/RegisterArtifactModal/RegisterArtifactModal.jsx',
  "title={artifactKind === ARTIFACT_TYPE ? 'Register artifact' : title}",
  'title={title}',
  "title={artifactKind === ARTIFACT_TYPE ? 'Register artifact' : title}"
)
require('./apply-shell.cjs')(root)
console.log(`Applied bilingual UI and Tianshu shell overlay to ${root}`)
