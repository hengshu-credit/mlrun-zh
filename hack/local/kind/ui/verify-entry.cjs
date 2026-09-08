// Run against a started UI: node verify-entry.cjs http://127.0.0.1:4000
const assert = require('node:assert/strict')
const base = process.argv[2] || 'http://127.0.0.1:4000'

async function request(path) {
  return fetch(new URL(path, base), { redirect: 'manual', signal: AbortSignal.timeout(10000) })
}

async function verify() {
  for (const path of ['/', '/?lng=en', '/mlrun/']) {
    const response = await request(path)
    assert.equal(response.status, 302, `${path} must redirect to the canonical entry`)
    assert.equal(response.headers.get('location'), `/mlrun/projects${path.includes('?') ? '?lng=en' : ''}`)
    assert.match(response.headers.get('cache-control') || '', /no-store/)
  }
  const entry = await request('/mlrun/projects')
  assert.equal(entry.status, 200)
  assert.match(entry.headers.get('cache-control') || '', /no-store/)
  const html = await entry.text()
  for (const path of ['/index.html', '/mlrun/projects/test/monitor']) {
    const response = await request(path)
    assert.equal(response.status, 200)
    assert.match(response.headers.get('cache-control') || '', /no-store/)
    assert.equal(await response.text(), html, `${path} must serve the current entry`)
  }
  const script = html.match(/src="([^"]+\/assets\/index-[^"]+\.js)"/)
  assert.ok(script, 'Entry must reference the versioned application bundle')
  const bundle = await request(script[1])
  assert.equal(bundle.status, 200)
  assert.ok((await bundle.text()).includes('Crafting Innovation, Guiding Decisions'))
  const config = await request('/mlrun/config.json')
  assert.equal(config.status, 200)
  assert.match(config.headers.get('cache-control') || '', /no-store/)
  await config.json()
  const recovery = await request('/ui-refresh')
  assert.equal(recovery.status, 302)
  assert.equal(recovery.headers.get('location'), '/mlrun/projects')
  assert.equal(recovery.headers.get('clear-site-data'), '"cache"')
  assert.equal((await request('/mlrun/api/v1/projects')).status, 200)
  console.log('Entry redirects, cache headers, current UI bundle, deep links and API proxy verified')
}

verify().catch(error => { console.error(error); process.exitCode = 1 })
