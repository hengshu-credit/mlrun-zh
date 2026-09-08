const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

test('embedded Nuclio breadcrumbs return to MLRun in the top window', () => {
  const uiSource = process.env.NUCLIO_UI_SOURCE;
  const source = fs.readFileSync(path.join(uiSource, 'node_modules/iguazio.dashboard-controls/dist/js/iguazio.dashboard-controls.js'), 'utf8');
  const parser = require(path.join(uiSource, 'node_modules/@babel/parser'));
  const traverse = require(path.join(uiSource, 'node_modules/@babel/traverse')).default;
  let controllerSource;
  traverse(parser.parse(source), {
    FunctionDeclaration({ node }) {
      if (node.id.name === 'NclBreadcrumbsController') controllerSource = source.slice(node.start, node.end);
    }
  });
  for (const embedded of [true, false]) {
    for (const origin of ['http://127.0.0.1:4000', null]) {
      const window = { location: { href: 'nuclio-page' } };
      window.top = embedded ? { location: { href: 'mlrun-page' } } : window;
      const Controller = vm.runInNewContext(`(${controllerSource})`, {
        window,
        sessionStorage: { getItem: () => origin },
        document: { documentElement: { lang: 'zh-CN' } }
      });
      const routes = [];
      const ctrl = new Controller(
        { $on() {} },
        { current: { data: {} }, go: (...args) => routes.push(args) },
        { projectId: 'test' },
        { onSuccess() {} },
        require(path.join(uiSource, 'node_modules/lodash'))
      );
      ctrl.$onInit();
      ctrl.goToProjectsList();
      if (origin) assert.equal(window.top.location.href, 'http://127.0.0.1:4000/mlrun/projects?lng=zh-CN');
      ctrl.goToProjectScreen();
      if (origin) {
        assert.equal(window.top.location.href, 'http://127.0.0.1:4000/mlrun/projects/test?lng=zh-CN');
        assert.deepEqual(routes, []);
      } else {
        assert.equal(routes[0][0], 'app.projects');
        assert.equal(routes[1][0], 'app.project');
        assert.equal(routes[1][1].projectId, 'test');
      }
      if (embedded) assert.equal(window.location.href, 'nuclio-page');
    }
  }
});

function createService(search = '', stored = null, browserLanguage = 'en', blocked = false) {
  const file = path.join(__dirname, 'locale.service.js');
  assert.ok(fs.existsSync(file), 'Nuclio needs a locale service supporting Chinese and English');
  let factory;
  const values = { 'mlrun.ui.locale': stored };
  const window = {
    location: { search, pathname: '/', hash: '#/projects' },
    URLSearchParams,
    URL,
    sessionStorage: { getItem: () => null },
    navigator: { language: browserLanguage },
    document: { documentElement: { lang: 'en' } },
    history: { replaceState() {} },
    localStorage: { getItem: key => { if (blocked) throw new Error('blocked'); return values[key]; }, setItem: (key, value) => { if (blocked) throw new Error('blocked'); values[key] = value; } }
  };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    angular: { module: () => ({ factory: (name, implementation) => { factory = implementation; } }) }
  });
  return { service: factory(window), values, window };
}

test('explicit English wins over persisted Chinese and persists the new choice', () => {
  const { service, values } = createService('?lng=en', 'zh-CN');
  assert.equal(service.getLanguage(), 'en');
  assert.equal(values['mlrun.ui.locale'], 'en');
});
test('Chinese deep links and persisted locale resolve to the supported locale', () => {
  assert.equal(createService('?lng=zh-CN').service.getLanguage(), 'zh-CN');
  assert.equal(createService('', 'zh-CN').service.getLanguage(), 'zh-CN');
  assert.equal(createService('?lng=invalid', 'zh-CN').service.getLanguage(), 'zh-CN');
  assert.equal(createService().service.getLanguage(), 'en');
});
test('switching language persists only supported locale values and returns to MLRun with locale', () => {
  const { service, values } = createService();
  service.setLanguage('zh-CN');
  assert.equal(values['mlrun.ui.locale'], 'zh-CN');
  assert.equal(service.getMLRunUrl(), 'http://127.0.0.1:4000/mlrun/projects?lng=zh-CN');
  service.setLanguage('javascript:bad');
  assert.equal(values['mlrun.ui.locale'], 'en');
});
test('browser preference is used only when no valid explicit or stored locale exists', () => {
  assert.equal(createService('', null, 'zh-TW').service.getLanguage(), 'zh-CN');
  assert.equal(createService('', 'en', 'zh-CN').service.getLanguage(), 'en');
});
test('blocked storage still allows switching and updates the document language', () => {
  const { service, window } = createService('', null, 'zh-CN', true);
  assert.equal(service.getLanguage(), 'zh-CN');
  assert.equal(window.document.documentElement.lang, 'zh-CN');
  service.setLanguage('en');
  assert.equal(service.getLanguage(), 'en');
  assert.equal(window.document.documentElement.lang, 'en');
});
test('return to MLRun respects a supplied HTTP origin and rejects executable URLs', () => {
  assert.equal(createService('?origin=http%3A%2F%2Flocalhost%3A4400&lng=zh-CN').service.getMLRunUrl(), 'http://localhost:4400/mlrun/projects?lng=zh-CN');
  assert.equal(createService('?origin=https%3A%2F%2Fmlrun.example.com').service.getMLRunUrl(), 'https://mlrun.example.com/mlrun/projects?lng=en');
  assert.equal(createService('?origin=javascript%3Aalert(1)').service.getMLRunUrl(), 'http://127.0.0.1:4000/mlrun/projects?lng=en');
});

function flatten(value, prefix = '') {
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    const name = prefix ? `${prefix}.${key}` : key;
    return typeof item === 'object' ? Object.entries(flatten(item, name)) : [[name, item]];
  }));
}
const technicalKeys = {
  common: new Set(['CPU', 'ESC', 'GPU', 'ID', 'IDP', 'IOPS', 'MONACO', 'NVME', 'SLA', 'SPARK', 'URL', 'PLACEHOLDER.COMMA_DELIMITED_LIST_OF_NUMBERS', 'PLACEHOLDER.COMMA_DELIMITED_LIST_OF_STRINGS', 'PLACEHOLDER.PHONE_EXAMPLE']),
  functions: new Set(['API', 'CONFIGMAP', 'OAUTH2', 'PVC', 'QOS', 'SECRET', 'V3IO', 'TOOLTIP.CONFIG_MAP.HEAD', 'PLACEHOLDER.ENTER_FIELD_PATH', 'PLACEHOLDER.MY_SERVICE_ACCOUNT'])
};
test('Chinese catalogues cover every upstream key and preserve interpolation placeholders', () => {
  const source = process.env.NUCLIO_UI_SOURCE;
  assert.ok(source, 'Set NUCLIO_UI_SOURCE to the pinned upstream UI directory');
  for (const namespace of ['common', 'functions']) {
    const en = flatten(JSON.parse(fs.readFileSync(path.join(source, `node_modules/iguazio.dashboard-controls/dist/i18n/en/${namespace}.json`))));
    const file = path.join(__dirname, `i18n/zh-CN/${namespace}.json`);
    assert.ok(fs.existsSync(file), `Missing Chinese ${namespace} catalogue`);
    const zh = flatten(JSON.parse(fs.readFileSync(file)));
    assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
    for (const [key, value] of Object.entries(en)) {
      assert.ok(zh[key].trim(), `Empty ${namespace}:${key}`);
      if (!technicalKeys[namespace].has(key)) assert.notEqual(zh[key], value, `Untranslated ${namespace}:${key}`);
      assert.deepEqual(zh[key].match(/\{\{.*?\}\}/g)?.sort() || [], value.match(/\{\{.*?\}\}/g)?.sort() || [], key);
    }
    assert.match(zh[namespace === 'common' ? 'FUNCTIONS' : 'API_GATEWAYS'], /[\u4e00-\u9fff]/);
  }
});

test('native i18next translates API gateway controls while preserving user names in messages', async () => {
  const source = process.env.NUCLIO_UI_SOURCE;
  const i18next = require(path.join(source, 'node_modules/i18next')).createInstance();
  const functions = JSON.parse(fs.readFileSync(path.join(__dirname, 'i18n/zh-CN/functions.json')));
  await i18next.init({ lng: 'zh-CN', resources: { 'zh-CN': { functions } }, defaultNS: 'functions' });
  assert.equal(i18next.t('NEW_API_GATEWAY'), '新建 API 网关');
  const userName = 'USER_API_GATEWAY_English_中文';
  assert.equal(i18next.t('ERROR_MSG.DELETE_API_GW_FUNCTION', { apiGatewayName: userName }), `函数正在被 API 网关“${userName}”使用，无法删除。`);
});
test('hardcoded control options translate while API values, user data and code stay byte-identical', () => {
  const file = path.join(__dirname, 'control-labels.cjs');
  assert.ok(fs.existsSync(file), 'Hardcoded Nuclio display options need an i18next adapter');
  const translate = require(file);
  const source = "function NclVersionCodeController() { var options = [{ id: 'sourceCode', name: 'Source code (edit online)' }]; var code = 'Source code (edit online)'; } function UserData() { var value = { name: 'Source code (edit online)' }; }";
  const output = translate(source, process.env.NUCLIO_UI_SOURCE);
  assert.ok(output.includes("id: 'sourceCode'"));
  assert.ok(output.includes("var code = 'Source code (edit online)'"));
  assert.ok(output.includes("function UserData() { var value = { name: 'Source code (edit online)' }; }"));
  assert.ok(output.includes("$i18next.t("));
});
test('multiword supplemental labels resolve through native i18next without exposing namespace keys', async () => {
  const uiSource = process.env.NUCLIO_UI_SOURCE;
  const i18next = require(path.join(uiSource, 'node_modules/i18next')).createInstance();
  await i18next.init({ lng: 'zh-CN', resources: { 'zh-CN': { local: require('./i18n/zh-CN/local.json') } } });
  const source = "function NclVersionCodeController() { return { id: 'sourceCode', name: 'Source code (edit online)' }; } NclVersionCodeController();";
  const output = require('./control-labels.cjs')(source, uiSource);
  const option = vm.runInNewContext(output, { $i18next: i18next, i18next });
  assert.equal(option.name, '源代码（在线编辑）');
});
test('language changes check pending function, trigger and volume edits before reloading', () => {
  let check;
  const source = 'function NclVersionController($scope) { var ctrl = this; } NclVersionController;';
  const output = require('./control-labels.cjs')(source, process.env.NUCLIO_UI_SOURCE);
  const Controller = vm.runInNewContext(output);
  const ctrl = new Controller({ $on: (name, handler) => { check = handler; } });
  assert.equal(typeof check, 'function', 'Subscribe to the pending-changes check');
  for (const name of ['versionChanged', 'isTriggersChanged', 'isVolumesChanged']) {
    ctrl.version = { ui: { [name]: true } };
    let prevented = false;
    check({ preventDefault: () => { prevented = true; } });
    assert.ok(prevented, name);
  }
  ctrl.version = { ui: {} };
  check({ preventDefault: () => assert.fail('Pristine function should not prompt') });
});
test('cancelling the native unsaved-changes dialog restores selector without persisting or reloading', async () => {
  const uiSource = process.env.NUCLIO_UI_SOURCE;
  let Controller;
  const source = fs.readFileSync(path.join(uiSource, 'src/app/components/header/header.component.js'), 'utf8');
  vm.runInNewContext(source, { angular: { module: () => ({ component: (name, config) => { Controller = config.controller; } }) } });
  const dependencyNames = Controller.toString().match(/function\s+\w+\(([^)]*)\)/)[1].split(',').map(name => name.trim());
  let prompts = 0;
  const fail = () => assert.fail('Cancelled language selection must not reload or persist');
  const dependencies = {
    $rootScope: { $broadcast: () => ({ defaultPrevented: true }) },
    $state: { reload: fail },
    $i18next: { t: key => key, changeLanguage: fail },
    i18next: { language: 'en', loadLanguages: fail },
    lodash: require(path.join(uiSource, 'node_modules/lodash')),
    ConfigService: {},
    NuclioLocaleService: { setLanguage: fail, getMLRunUrl: () => '' },
    DialogsService: { confirm: () => { prompts++; return Promise.reject(new Error('cancelled')); } }
  };
  const ctrl = new Controller(...dependencyNames.map(name => dependencies[name] || {}));
  const originalSelection = ctrl.languages[0];
  ctrl.selectedLanguage = originalSelection;
  ctrl.onLanguageChange(ctrl.languages[1], true);
  await Promise.resolve();
  assert.equal(prompts, 1);
  assert.equal(ctrl.selectedLanguage.id, 'en');
  assert.notEqual(ctrl.selectedLanguage, originalSelection, 'Refresh the one-way dropdown binding after its internal selection changed');
});
