import { transformUi } from './transform.cjs'

const catalogue = { Projects: '项目', Name: '名称', Cancel: '取消', 'Delete {0}': '删除 {0}' }
const transform = source => transformUi(source, '/app/src/Example.jsx', catalogue).code

describe('source localization boundary', () => {
  it('translates explicit UI text, subscribes the component and preserves user values', () => {
    const code = transform(
      'const Example = ({ name }) => <><h1>Projects</h1><input placeholder="Name" value={name}/><p>{name}</p></>'
    )
    expect(code).toContain('__mlrunT("Projects")')
    expect(code).toContain('__mlrunT("Name")')
    expect(code).toContain('value={name}')
    expect(code).toContain('<p>{name}</p>')
    expect(code).toContain('__mlrunUseLocale()')
  })

  it('keeps protocol IDs, paths, comparisons and API payloads in English', () => {
    const code = transform(
      'const Example = ({ name }) => <a href="Projects" data-testid="Projects">{name === "Projects" ? "Cancel" : name}</a>; const payload = {name: "Projects", id: "Projects", value: "Name"}'
    )
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
    const code = transform(
      'const Example = () => { const label = useMemo(() => <h1>Projects</h1>, []); return label }'
    )
    expect(code).toContain('[__mlrunLocale]')
    expect(code).not.toContain('key=')
  })

  it('excludes log/code content and unknown text from localization', () => {
    const code = transform(
      'const Example = () => <><pre>Projects</pre><code>Projects</code><div>Unreviewed message</div></>'
    )
    expect(code).not.toContain('__mlrunT(')
  })

  it('localizes conditional headings but preserves column IDs and dynamic names', () => {
    const code = transform(
      'const column = {headerId: all ? "uid" : "name", headerLabel: all ? "UID" : "Name", value: name}'
    )
    expect(code).toContain('__mlrunT("Name")')
    expect(code).toContain('headerId: all ? "uid" : "name"')
    expect(code).toContain('value: name')
  })

  it('translates verified imported display constants only at presentation sites', () => {
    const code = transformUi(
      `import {ANY_TIME as allTime} from '../../constants';
      const Example = () => <><div title={allTime}>{allTime}</div><input value={allTime}/></>;
      const filter = {id: allTime, label: allTime};`,
      '/app/src/components/Example.jsx',
      { 'Any time': '任意时间' }
    ).code
    expect(code).toContain('__mlrunT("Any time")')
    expect(code).toContain('value={allTime}')
    expect(code).toContain('id: allTime')
  })

  it('translates immutable local display constants without touching data constants', () => {
    const code = transform(`const defaultMessage = 'Projects'; const name = 'Projects';
      const Example = ({message}) => <><h3>{message || defaultMessage}</h3><input value={defaultMessage}/><p>{name}</p></>`)
    expect(code).toContain('message || __mlrunT("Projects")')
    expect(code).toContain('value={defaultMessage}')
    expect(code).toContain('<p>{name}</p>')
  })
})
