import english from './en.json'
import chinese from './zh-CN.json'

it('keeps both catalogues complete and preserves every interpolation argument', () => {
  expect(Object.keys(chinese).sort()).toEqual(Object.keys(english).sort())
  for (const [source, translation] of Object.entries(chinese)) {
    expect(translation.trim().length, source).toBeGreaterThan(0)
    expect([...translation.matchAll(/\{\d+\}/g)].map(match => match[0]).sort(), source).toEqual(
      [...source.matchAll(/\{\d+\}/g)].map(match => match[0]).sort()
    )
  }
})
