import { describe, expect, it } from 'vitest'
import { transformUi } from './transform.cjs'

const catalogue = { Projects: '项目', Name: '名称', Cancel: '取消', 'Delete {0}': '删除 {0}' }
const transform = source => transformUi(source, '/app/src/Example.jsx', catalogue).code

describe('source localization boundary', () => {
  it('translates explicit UI text, subscribes the component and preserves user values', () => {
    const code = transform('const Example = ({ name }) => <><h1>Projects</h1><input placeholder="Name" value={name}/><p>{name}</p></>')
    expect(code).toContain('__mlrunT("Projects")')
    expect(code).toContain('__mlrunT("Name")')
    expect(code).toContain('value={name}')
    expect(code).toContain('<p>{name}</p>')
    expect(code).toContain('__mlrunUseLocale()')
  })

  it('keeps protocol IDs, paths, comparisons and API payloads in English', () => {
    const code = transform('const Example = ({ name }) => <a href="Projects" data-testid="Projects">{name === "Projects" ? "Cancel" : name}</a>; const payload = {name: "Projects", id: "Projects", value: "Name"}')
    expect(code).toContain('href="Projects"')
    expect(code).toContain('name === "Projects"')
    expect(code).toContain('name: "Projects"')
    expect(code).toContain('value: "Name"')
    expect(code).toContain('__mlrunT("Cancel")')
  })

  it('keeps catalogue labels reactive even in module-level menus', () => {
    const code = transform('export const menu = [{id: "projects", label: "Projects"}]')
    expect(code).toContain('get label()')
    expect(code).toContain('return __mlrunT("Projects")')
    expect(code).toContain('id: "projects"')
  })

  it('passes template values as opaque interpolation arguments', () => {
    const code = transform('const Example = ({ name }) => <h1>{`Delete ${name}`}</h1>')
    expect(code).toContain('__mlrunT("Delete {0}", [name])')
  })

  it('invalidates memoized display data on language changes without changing component keys', () => {
    const code = transform('const Example = () => { const label = useMemo(() => "Projects", []); return <h1>Projects</h1> }')
    expect(code).toContain('[__mlrunLocale]')
    expect(code).not.toContain('key=')
  })

  it('excludes log/code content and unknown text from localization', () => {
    const code = transform('const Example = () => <><pre>Projects</pre><code>Projects</code><div>Unreviewed message</div></>')
    expect(code).not.toContain('__mlrunT(')
  })
})
