import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { transformSync } from '@babel/core'
import jsx from '@babel/plugin-transform-react-jsx'
import commonjs from '@babel/plugin-transform-modules-commonjs'
import { transformUi } from './transform.cjs'
import localization from './vite-plugin.cjs'
import * as locale from './locale'
import * as datetime from './datetime'

afterEach(() => {
  cleanup()
  locale.setLocale('en')
})

function compile(source, filename) {
  const localized = filename
    ? localization().transform(source, filename)?.code || source
    : transformUi(source, '/app/src/Fixture.jsx', { Projects: '项目' }).code
  const { code } = transformSync(localized, {
    babelrc: false,
    configFile: false,
    plugins: [jsx, commonjs]
  })
  const output = { exports: {} }
  const resolve = name => (name === 'react' ? React : name === './datetime' ? datetime : locale)
  Function('require', 'module', 'exports', code)(resolve, output, output.exports)
  return output.exports.default
}

it('does not restart effect-driven operations when only the language changes', () => {
  const Fixture = compile(`import React, {useCallback, useEffect, useMemo} from 'react';
    export default function Fixture({onEffect}) {
      const operation = useCallback(() => onEffect(), [onEffect]);
      const config = useMemo(() => ({ interval: 1000 }), []);
      useEffect(() => { operation(config) }, [operation, config]);
      return <h1>Projects</h1>
    }`)
  let operations = 0
  locale.setLocale('en')
  render(<Fixture onEffect={() => operations++} />)
  expect(operations).toBe(1)
  act(() => locale.setLocale('zh-CN'))
  expect(screen.getByRole('heading')).toHaveTextContent('项目')
  expect(operations).toBe(1)
})

it.each(['/app/src/App.jsx', '/app/src/hooks/mode.hook.js', '/app/src/hooks/nuclioMode.hook.js'])(
  'keeps route-owned form state when changing language beneath %s',
  filename => {
    const Content = compile(`import React, {useState} from 'react';
      export default function Content() {
        const [name, setName] = useState('');
        return <><h1>Projects</h1><input aria-label="name" value={name} onChange={event => setName(event.target.value)} /></>
      }`)
    const Root = compile(
      `import React from 'react';
      export default function App({Content, onRender}) {
        onRender();
        const Wrapped = () => <Content />;
        return <Wrapped />
      }`,
      filename
    )
    let renders = 0
    locale.setLocale('en')
    render(<Root Content={Content} onRender={() => renders++} />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'Projects' } })
    act(() => locale.setLocale('zh-CN'))
    expect(screen.getByRole('heading')).toHaveTextContent('项目')
    expect(screen.getByRole('textbox')).toBe(input)
    expect(input).toHaveValue('Projects')
    expect(renders).toBe(1)
  }
)

it('updates memoized presentation while retaining component state', () => {
  const Fixture = compile(`import React, {useMemo, useState} from 'react';
    export default function Fixture() {
      const [name] = useState('Projects');
      const header = useMemo(() => <h1>Projects</h1>, []);
      return <>{header}<input aria-label="name" value={name} readOnly /></>
    }`)
  locale.setLocale('en')
  render(<Fixture />)
  act(() => locale.setLocale('zh-CN'))
  expect(screen.getByRole('heading')).toHaveTextContent('项目')
  expect(screen.getByRole('textbox')).toHaveValue('Projects')
})

it('refreshes memoized dates when switching language', () => {
  const Fixture = compile(`import React, {useMemo} from 'react';
    import {formatDatetime} from './datetime';
    export default function Fixture() {
      const date = useMemo(() => formatDatetime('2026-09-08T10:00:00Z'), []);
      return <time>{date}</time>
    }`)
  locale.setLocale('en')
  const { container } = render(<Fixture />)
  const english = container.textContent
  act(() => locale.setLocale('zh-CN'))
  expect(container.textContent).toBe(datetime.formatDatetime('2026-09-08T10:00:00Z'))
  expect(container.textContent).not.toBe(english)
})
