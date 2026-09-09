// Apply after apply-bilingual.cjs to the disposable, pinned upstream UI checkout.
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(process.argv[2] || '.')
const target = path.join(root, 'src/components/Datasets/Datasets.jsx')
if (!fs.existsSync(target) || !fs.existsSync(path.join(root, 'src/i18n/locale.js'))) {
  throw new Error('Expected the complete MLRun UI source with the bilingual overlay applied')
}
let source = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n')
if (!source.includes('import SqlDatasetManager')) {
  const replacements = [
    [
      "import React, { useCallback } from 'react'",
      "import React, { useCallback, useState } from 'react'\nimport { useParams } from 'react-router-dom'\nimport SqlDatasetManager from '../../sql-datasets/SqlDatasetManager'\nimport { useSqlMessages } from '../../sql-datasets/messages'"
    ],
    [
      '  const artifactsStore =',
      '  const { projectName } = useParams()\n  const sqlT = useSqlMessages()\n  const [sqlOpen, setSqlOpen] = useState(false)\n  const [sqlRevision, setSqlRevision] = useState(0)\n  const artifactsStore ='
    ],
    [
      '    <Artifacts\n',
      '    <>\n    {sqlOpen && <SqlDatasetManager project={projectName} onClose={() => setSqlOpen(false)} onImported={() => setSqlRevision(value => value + 1)} />}\n    <Artifacts\n      key={sqlRevision}\n'
    ],
    [
      '      actionButtons={[\n',
      "      actionButtons={[\n        {\n          variant: PRIMARY_BUTTON,\n          label: sqlT('SQL datasets'),\n          className: 'action-button',\n          onClick: () => setSqlOpen(true)\n        },\n"
    ],
    ['    />\n  )', '    />\n    </>\n  )']
  ]
  for (const [search, replacement] of replacements) {
    if (!source.includes(search))
      throw new Error(`SQL dataset integration point changed: ${search}`)
    source = source.replace(search, replacement)
  }
}
fs.cpSync(path.join(__dirname, 'sql-datasets'), path.join(root, 'src/sql-datasets'), {
  recursive: true
})
fs.writeFileSync(target, source)
