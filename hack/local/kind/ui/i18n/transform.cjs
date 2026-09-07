// Localize source-authored presentation strings only. API/user values are never looked up.
const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default
const generate = require('@babel/generator').default
const b = require('@babel/types')
const path = require('node:path')

const displayKeys = new Set([
  'label', 'title', 'header', 'tooltip', 'placeholder', 'message', 'helpText',
  'helperText', 'noDataMessage', 'emptyText', 'btnConfirmLabel', 'confirmButtonLabel',
  'cancelButtonLabel', 'buttonLabel', 'text', 'aria-label', 'alt'
])
const excludedTags = /^(pre|code|script|style|textarea|Editor|MonacoEditor|SyntaxHighlighter)$/
const isDisplayKey = key => displayKeys.has(key) || key === 'tip' || /(?:Label|Title|Header|Tooltip|Message|Placeholder|Text|Tip)$/.test(key)

function transformUi(source, filename, catalogue, collect = () => {}, options = {}) {
  const ast = parser.parse(source, { sourceType: 'module', plugins: ['jsx'] })
  let translated = false
  let adapted = false
  const componentNames = new Set()
  const aliases = new Map()
  const hookNames = new Set(['useMemo', 'useCallback'])
  traverse(ast, {
    ImportDeclaration(p) {
      if (options.adapters?.[p.node.source.value]) {
        p.node.source.value = options.adapters[p.node.source.value]
        adapted = true
      }
    },
    ImportSpecifier(p) {
      if (/^(useMemo|useCallback)$/.test(p.node.imported.name)) hookNames.add(p.node.local.name)
    },
    ExportSpecifier(p) {
      if (/^[A-Z]|^use[A-Z]|^default$/.test(p.node.exported.name)) componentNames.add(p.node.local.name)
    },
    AssignmentExpression(p) {
      if (b.isMemberExpression(p.node.left) && /^(displayName|propTypes)$/.test(p.node.left.property.name)) {
        componentNames.add(p.node.left.object.name)
      }
    },
    VariableDeclarator(p) {
      if (b.isIdentifier(p.node.id) && b.isIdentifier(p.node.init)) aliases.set(p.node.id.name, p.node.init.name)
    }
  })
  for (const name of componentNames) {
    if (aliases.has(name)) componentNames.add(aliases.get(name))
  }

  function call(message, values = []) {
    if (!/[A-Za-z]/.test(message)) return null
    collect(message)
    if (!Object.hasOwn(catalogue, message)) return null
    translated = true
    return b.callExpression(b.identifier('__mlrunT'), [
      b.stringLiteral(message), ...(values.length ? [b.arrayExpression(values)] : [])
    ])
  }

  function displayExpression(node) {
    if (b.isStringLiteral(node)) return call(node.value) || node
    if (b.isTemplateLiteral(node)) {
      const message = node.quasis.map((part, index) =>
        part.value.cooked + (index < node.expressions.length ? `{${index}}` : '')
      ).join('')
      return call(message, node.expressions.map(expression => b.isConditionalExpression(expression) ? displayExpression(expression) : expression)) || node
    }
    if (b.isConditionalExpression(node)) {
      node.consequent = displayExpression(node.consequent)
      node.alternate = displayExpression(node.alternate)
    } else if (b.isLogicalExpression(node)) {
      node.right = displayExpression(node.right)
    }
    return node
  }

  function isCode(p) {
    return !!p.findParent(parent => parent.isJSXElement() &&
      excludedTags.test(parent.node.openingElement.name.name || ''))
  }

  traverse(ast, {
    JSXText(p) {
      if (isCode(p)) return
      // Match React's JSX whitespace normalization, preserving explicit inline spaces.
      const lines = p.node.value.replace(/\t/g, ' ').split(/\r\n|\n|\r/)
      let lastNonEmpty = 0
      lines.forEach((line, index) => { if (/[^ ]/.test(line)) lastNonEmpty = index })
      const text = lines.map((line, index) => {
        if (index !== 0) line = line.replace(/^ +/, '')
        if (index !== lines.length - 1) line = line.replace(/ +$/, '')
        return line && index !== lastNonEmpty ? line + ' ' : line
      }).join('')
      const replacement = call(text)
      if (replacement) p.replaceWith(b.jsxExpressionContainer(replacement))
    },
    JSXAttribute(p) {
      if ((!isDisplayKey(p.node.name.name) && p.node.name.name !== 'description') || !p.node.value || isCode(p)) return
      if (b.isStringLiteral(p.node.value)) {
        const replacement = displayExpression(p.node.value)
        if (replacement !== p.node.value) p.node.value = b.jsxExpressionContainer(replacement)
      } else if (b.isJSXExpressionContainer(p.node.value)) {
        p.node.value.expression = displayExpression(p.node.value.expression)
      }
    },
    JSXExpressionContainer(p) {
      if (p.parentPath.isJSXAttribute() || isCode(p)) return
      p.node.expression = displayExpression(p.node.expression)
    },
    ObjectProperty(p) {
      const key = p.node.key.name || p.node.key.value
      if (options.compiled && key === 'children') {
        if (b.isArrayExpression(p.node.value)) p.node.value.elements = p.node.value.elements.map(element => element ? displayExpression(element) : element)
        else p.node.value = displayExpression(p.node.value)
        return
      }
      if (p.node.computed || !isDisplayKey(key) || !b.isStringLiteral(p.node.value)) return
      // Do not touch API modules, persisted data defaults or validation schemas.
      if (/\/(api|store)\//.test(filename.replace(/\\/g, '/'))) return
      const replacement = call(p.node.value.value)
      if (!replacement) return
      // A getter also handles labels created once at module load, without remounting views.
      p.replaceWith(b.objectMethod('get', p.node.key, [], b.blockStatement([
        b.returnStatement(replacement)
      ])))
      p.skip()
    },
    AssignmentPattern(p) {
      const key = p.parentPath.isObjectProperty() ? (p.parent.key.name || p.parent.key.value) : p.node.left.name
      if (isDisplayKey(key)) {
        p.node.right = displayExpression(p.node.right)
      }
    }
  })

  let subscribed = false
  // Subscribe every React component: some consume translated module-level menus only.
  traverse(ast, {
    Function(p) {
      const owner = p.findParent(q => q.isVariableDeclarator() || q.isFunction())
      const name = p.node.id?.name || (owner?.isVariableDeclarator() ? owner.node.id.name : '')
      if (options.compiled ? !componentNames.has(name) : !/^[A-Z]|^use[A-Z]/.test(name)) return
      let hasJsxOrHook = false
      p.traverse({
        JSXElement() { hasJsxOrHook = true },
        JSXFragment() { hasJsxOrHook = true },
        CallExpression(q) {
          if (/^use[A-Z]/.test(q.node.callee.name || q.node.callee.property?.name || '') || options.compiled) hasJsxOrHook = true
        }
      })
      if (!hasJsxOrHook) return
      if (!b.isBlockStatement(p.node.body)) p.node.body = b.blockStatement([b.returnStatement(p.node.body)])
      p.node.body.body.unshift(b.variableDeclaration('const', [b.variableDeclarator(
        b.identifier('__mlrunLocale'), b.callExpression(b.identifier('__mlrunUseLocale'), [])
      )]))
      p.traverse({
        CallExpression(q) {
          if (!hookNames.has(q.node.callee.name || q.node.callee.property?.name || '')) return
          const dependencies = q.node.arguments[1]
          if (b.isArrayExpression(dependencies)) dependencies.elements.push(b.identifier('__mlrunLocale'))
        }
      })
      subscribed = true
      p.skip()
    }
  })
  if (!translated && !subscribed && !adapted) return { code: source, map: null }
  const relative = options.localeModule || path.relative(path.dirname(filename), path.join(filename.slice(0, filename.lastIndexOf('/src/') + 4), 'i18n/locale')).replace(/\\/g, '/')
  if (translated || subscribed) ast.program.body.unshift(b.importDeclaration([
    ...(translated ? [b.importSpecifier(b.identifier('__mlrunT'), b.identifier('t'))] : []),
    ...(subscribed ? [b.importSpecifier(b.identifier('__mlrunUseLocale'), b.identifier('useLocale'))] : [])
  ], b.stringLiteral(options.localeModule || (relative.startsWith('.') ? relative : './' + relative))))
  return generate(ast, { sourceMaps: true, sourceFileName: filename }, source)
}

module.exports = { transformUi }
