const path = require('node:path');
const catalogue = require('./i18n/zh-CN/local.json');
const controllers = new Set([
  'NclVersionCodeController', 'NclFunctionEventPaneController',
  'NclVersionConfigurationResourcesController', 'FunctionFromScratchController',
  'FunctionsService'
]);

// Limit edits to known Nuclio display properties. API identifiers and code are never rewritten.
module.exports = function translateControlLabels(source, uiSource) {
  const parser = require(path.join(uiSource, 'node_modules/@babel/parser'));
  const traverse = require(path.join(uiSource, 'node_modules/@babel/traverse')).default;
  const edits = [];
  const translate = text => `$i18next.t(${JSON.stringify(text)}, { ns: 'local', lng: i18next.language, keySeparator: false })`;
  const ast = parser.parse(source);
  traverse(ast, {
    VariableDeclaration(statement) {
      const owner = statement.findParent(parent => parent.isFunctionDeclaration());
      if (owner?.node.id?.name !== 'NclVersionController') return;
      if (!statement.node.declarations.some(item => item.id.name === 'ctrl' && item.init?.type === 'ThisExpression')) return;
      edits.push({ start: statement.node.end, end: statement.node.end, text: `
    $scope.$on('nuclio-check-unsaved-changes', function (event) {
      var ui = ctrl.version && ctrl.version.ui || {};
      if (ui.versionChanged || ui.isTriggersChanged || ui.isVolumesChanged) {
        event.preventDefault();
      }
    });` });
    },
    ObjectProperty(property) {
      const { node } = property;
      if (!['name', 'tooltip'].includes(node.key.name) || node.value.type !== 'StringLiteral') return;
      const owner = property.findParent(parent => parent.isFunctionDeclaration() && controllers.has(parent.node.id?.name));
      if (!owner) return;
      if (Object.hasOwn(catalogue, node.value.value)) {
        edits.push({ start: node.value.start, end: node.value.end, text: translate(node.value.value) });
      }
      if (owner.node.id.name !== 'FunctionsService' || node.key.name !== 'name') return;
      const fields = property.parent.properties;
      if (!fields.some(field => field.key?.name === 'type') || fields.some(field => field.key?.name === 'label')) return;
      const humanName = node.value.value.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
      const label = humanName.charAt(0).toUpperCase() + humanName.slice(1);
      if (Object.hasOwn(catalogue, label)) {
        edits.push({ start: node.end, end: node.end, text: `, label: ${translate(label)}` });
      }
    }
  });
  for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  return source;
};
