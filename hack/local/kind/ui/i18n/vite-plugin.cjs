/* global __dirname */
const { transformUi } = require('./transform.cjs')
const catalogue = require('./zh-CN.json')
const path = require('node:path')

module.exports = function mlrunLocalization() {
  return {
    name: 'mlrun-localization',
    enforce: 'pre',
    transform(source, id) {
      const filename = id.replace(/\\/g, '/').split('?')[0]
      // These modules own the router, not presentation. Subscribing them (including
      // hooks called by App) recreates route component types and clears form state.
      if (/\/src\/(App\.jsx|hooks\/(mode|nuclioMode)\.hook\.js)$/.test(filename)) return null
      if (
        /\/iguazio.dashboard-react-controls\/dist\/(components|elements|nextGenComponents\/components)\/.*\.mjs$/.test(
          filename
        )
      ) {
        return transformUi(source, filename, catalogue, undefined, {
          compiled: true,
          localeModule: path.resolve(__dirname, 'locale.js').replace(/\\/g, '/')
        })
      }
      if (
        !/\/src\/.*\.[jt]sx?$/.test(filename) ||
        /\/i18n\/|\/__mocks__\/|\.(test|spec)\./.test(filename)
      )
        return null
      return transformUi(source, filename, catalogue, undefined, {
        stateAdapter: path.resolve(__dirname, 'state.js').replace(/\\/g, '/'),
        adapters: Object.fromEntries(
          ['datetime', 'validation'].map(name => [
            `igz-controls/utils/${name}.util`,
            path.resolve(__dirname, `${name}.js`).replace(/\\/g, '/')
          ])
        )
      })
    }
  }
}
