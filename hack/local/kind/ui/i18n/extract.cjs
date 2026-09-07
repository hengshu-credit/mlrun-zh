const fs = require('node:fs')
const path = require('node:path')
const { transformUi } = require('./transform.cjs')
const root = path.resolve(__dirname, '..')
const messages = new Map()

function visit(directory, compiled = false) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (['i18n', '__mocks__', 'stories'].includes(entry.name)) continue
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) visit(file, compiled)
    else if ((compiled ? /\.mjs$/ : /\.[jt]sx?$/).test(file) && !/\.(test|spec)\./.test(file)) {
      transformUi(fs.readFileSync(file, 'utf8'), file.replace(/\\/g, '/'), {}, message => {
        const locations = messages.get(message) || new Set()
        locations.add(path.relative(root, file).replace(/\\/g, '/'))
        messages.set(message, locations)
      }, { compiled })
    }
  }
}
visit(root)
for (const directory of ['components', 'elements']) {
  visit(path.join(root, '../node_modules/iguazio.dashboard-react-controls/dist', directory), true)
}
const sorted = [...messages].sort(([a], [b]) => a.localeCompare(b))
fs.writeFileSync(path.join(root, '../i18n-messages.json'), JSON.stringify(
  Object.fromEntries(sorted.map(([message, files]) => [message, [...files]])), null, 2) + '\n')
console.log(`Extracted ${messages.size} presentation messages to i18n-messages.json`)
