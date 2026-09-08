(function () {
    'use strict';

    angular.module('nuclio.app').factory('NuclioLocaleService', NuclioLocaleService);

    function NuclioLocaleService($window) {
        var storageKey = 'mlrun.ui.locale';
        var language = /^zh/i.test($window.navigator.language || '') ? 'zh-CN' : 'en';
        var query = new $window.URLSearchParams($window.location.search);
        var requested = query.get('lng');
        var mlrunOrigin = getMLRunOrigin(query.get('origin'));

        try {
            var stored = $window.localStorage.getItem(storageKey);
            if (stored === 'en' || stored === 'zh-CN') {
                language = stored;
            }
        } catch (error) {
            // A restricted browser can still use the in-memory language selection.
        }
        if (requested === 'en' || requested === 'zh-CN') {
            setLanguage(requested);
            query.delete('lng');
            var remaining = query.toString();
            $window.history.replaceState(null, '', $window.location.pathname +
                (remaining ? '?' + remaining : '') + $window.location.hash);
        }
        $window.document.documentElement.lang = language;

        return {
            getLanguage: function () {
                return language;
            },
            setLanguage: setLanguage,
            getMLRunUrl: function () {
                return mlrunOrigin + '/mlrun/projects?lng=' + language;
            }
        };

        function setLanguage(value) {
            language = normalize(value);
            $window.document.documentElement.lang = language;
            try {
                $window.localStorage.setItem(storageKey, language);
            } catch (error) {
                // Keep switching available when browser storage is disabled.
            }
        }

        function normalize(value) {
            return value === 'zh-CN' ? 'zh-CN' : 'en';
        }

        function getMLRunOrigin(value) {
            try {
                var supplied = value || $window.sessionStorage.getItem('origin');
                var parsed = new $window.URL(supplied);
                if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
                    !parsed.username && !parsed.password) {
                    return parsed.origin;
                }
            } catch (error) {
                // Invalid origins and restricted storage use the local kind entry point.
            }
            return 'http://127.0.0.1:4000';
        }
    }
}());
