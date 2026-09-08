const fs = require('node:fs');
const path = require('node:path');
const source = path.resolve(process.argv[2]);
const catalogueRoot = 'node_modules/iguazio.dashboard-controls/dist/i18n';
const resources = {};
const extraChinese = require('./i18n/zh-CN/local.json');
for (const locale of ['en', 'zh-CN']) {
  resources[locale] = {};
  resources[locale].local = locale === 'zh-CN' ? extraChinese : Object.fromEntries(Object.keys(extraChinese).map(key => [key, key]));
  for (const namespace of ['common', 'functions']) {
    const file = locale === 'en' ? path.join(source, catalogueRoot, locale, `${namespace}.json`) : path.join(__dirname, 'i18n', locale, `${namespace}.json`);
    resources[locale][namespace] = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
}
function patch(file, before, after) {
  const target = path.join(source, file);
  const text = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
  if (!text.includes(before)) throw new Error(`Pinned upstream changed: ${file}: ${before}`);
  fs.writeFileSync(target, text.replace(before, after));
}
fs.copyFileSync(path.join(__dirname, 'locale.service.js'), path.join(source, 'src/app/shared/services/locale.service.js'));
fs.cpSync(path.join(__dirname, 'i18n/zh-CN'), path.join(source, catalogueRoot, 'zh-CN'), { recursive: true });
fs.writeFileSync(path.join(source, 'src/app/shared/services/locale-resources.js'), '/* eslint-disable */\nangular.module("nuclio.app").constant("NuclioLocaleResources", ' + JSON.stringify(resources) + ');\n');
patch('src/app/app.run.js', 'NuclioProjectsDataService) {', 'NuclioProjectsDataService, NuclioLocaleService, NuclioLocaleResources) {');
patch('src/app/app.run.js', "fallbackLng: 'en',", "fallbackLng: 'en',\n            lng: NuclioLocaleService.getLanguage(),\n            supportedLngs: ['en', 'zh-CN'],\n            load: 'currentOnly',\n            resources: NuclioLocaleResources,");
patch('src/app/app.run.js', "defaultVersion: 'v0.72'", "defaultVersion: 'mlrun-bilingual-1'");
patch('src/app/app.run.js', "'functions'\n", "'functions',\n                'local'\n");
patch('src/app/app.controller.js', "        var lng = i18next.language;\n", '');
patch('src/app/app.controller.js', '{lng: lng}', '{lng: i18next.language}');
patch('src/app/components/header/header.component.js', 'lodash, ConfigService, NavigationTabsService) {', 'lodash, ConfigService, NavigationTabsService, NuclioLocaleService, DialogsService) {');
patch('src/app/components/header/header.component.js', "name: 'EN',\n                id: 'en'", "name: 'English',\n                id: 'en'\n            },\n            {\n                name: '中文',\n                id: 'zh-CN'");
patch('src/app/components/header/header.component.js', 'ctrl.onLanguageChange = onLanguageChange;', 'ctrl.onLanguageChange = onLanguageChange;\n        ctrl.getMLRunUrl = NuclioLocaleService.getMLRunUrl;');
patch('src/app/components/header/header.component.js', '$i18next.changeLanguage(ctrl.selectedLanguage.id);', 'NuclioLocaleService.setLanguage(ctrl.selectedLanguage.id);\n                        $i18next.changeLanguage(ctrl.selectedLanguage.id);');
patch('src/app/components/header/header.component.js', "i18next.language.replace(/(\\w{2}).+/, '$1')", "i18next.language");
patch('src/app/components/header/header.component.js', "ctrl.selectedLanguage = lodash.find(ctrl.languages, ['id', initialLng]);", "ctrl.selectedLanguage = lodash.cloneDeep(lodash.find(ctrl.languages, ['id', initialLng]));");
patch('src/app/components/header/header.component.js', 'function onLanguageChange(item, isItemChanged) {', `function onLanguageChange(item, isItemChanged) {
            if (isItemChanged && $rootScope.$broadcast('nuclio-check-unsaved-changes').defaultPrevented) {
                DialogsService.confirm(
                    $i18next.t('common:LEAVE_PAGE_CONFIRM', {lng: i18next.language}),
                    $i18next.t('common:LEAVE', {lng: i18next.language}),
                    $i18next.t('common:DONT_LEAVE', {lng: i18next.language})
                ).then(function () {
                    performLanguageChange(item, isItemChanged);
                }, setSelectedLanguage);
                return;
            }
            performLanguageChange(item, isItemChanged);
        }

        function performLanguageChange(item, isItemChanged) {`);
patch('src/app/components/header/header.tpl.html', '<div data-ng-if="$ctrl.isStagingMode()" class="languages-dropdown">', '<div class="languages-dropdown">\n            <a class="link mlrun-home-link" target="_top" data-ng-href="{{$ctrl.getMLRunUrl()}}">{{ \'Home · MLRun\' | i18next: {ns: \'local\', keySeparator: false} }}</a>');
patch('src/app/components/header/header.less', 'width: 70px;', 'width: auto;\n        display: flex;\n        align-items: center;\n        flex-shrink: 0;\n        gap: 20px;\n\n        .mlrun-home-link { white-space: nowrap; }\n        form { width: 90px; margin: 0; }');
// Existing dashboard dropdowns use the name field; attr.lang does not match this menu's values.
patch('src/app/components/header/header.tpl.html', 'data-name-key="attr.lang"', 'data-name-key="name"');
patch('src/app/components/header/header.tpl.html', 'data-item-select-field="attr.id"', 'data-item-select-field="id"');
// Return to the outer MLRun page instead of loading another shell inside its iframe.
const controls = 'node_modules/iguazio.dashboard-controls/dist/js/iguazio.dashboard-controls.js';
patch(controls, "window.location.href = siteOrigin + '/mlrun/projects';", "window.top.location.href = siteOrigin + '/mlrun/projects?lng=' + encodeURIComponent(document.documentElement.lang);");
patch(controls, "window.location.href = siteOrigin + '/mlrun/projects/' + $stateParams.projectId;", "window.top.location.href = siteOrigin + '/mlrun/projects/' + $stateParams.projectId + '?lng=' + encodeURIComponent(document.documentElement.lang);");
const controlsPath = path.join(source, controls);
fs.writeFileSync(controlsPath, require('./control-labels.cjs')(fs.readFileSync(controlsPath, 'utf8'), source));
// Preserve original image bytes: native image optimizers are not needed for this UI overlay.
patch('gulpfile.js', ".pipe(gulpIf(!state.isDevMode, imagemin({\n            optimizationLevel: 3,\n            progressive: true,\n            interlaced: true\n        })))", '');
console.log('Applied Nuclio bilingual overlay using the upstream i18next catalogues.');
