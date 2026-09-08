# MLRun bilingual UI implementation plan

**Goal:** Add Simplified Chinese and English to the existing MLRun UI, with immediate switching, browser-language detection and persisted preference.

**Approved design:** The user approved the design in this task on 2026-09-08. Translate application navigation, forms, actions and feedback; preserve user data, API values, source code and logs.

**Architecture:** Keep the upstream UI pinned to c4235698cba093958c02281cd20dbe0ab380230e. Store a reproducible UI overlay under hack/local/kind/ui. A source-level Babel transform localizes explicitly identified presentation literals, using a reviewed English/Chinese catalogue and a React external locale store. No DOM rewriting or remote translation service.

**Stack:** React 18, Vite, Babel, Vitest, Node.js, Docker and existing kind deployment.

- [x] Test locale selection, persistence, missing-key fallback, interpolation and switching without losing form state; implement the locale store and accessible header selector.
- [x] Test the presentation-literal transform against API identifiers and user-provided content; implement extraction, source maps and reactive display labels.
- [x] Review and translate extracted UI messages; integrate navigation, main pages, dialogs and status presentation. Preserve protocol values.
- [x] Save pinned source metadata, overlay application/build scripts and local deployment instructions. Preserve existing workflow permission changes.
- [x] Run focused regression tests, lint and production build. Verify main pages and both language directions in a browser, including refresh and route changes.

Tests live in hack/local/kind/ui/i18n and are copied into the build workspace by the overlay script. Build outputs remain in ignored playground directories; reproducible inputs remain tracked in this repository. Existing unrelated changes must not be overwritten.

Verification on 2026-09-08: 109 tests across 15 files passed, including upstream Sidebar and workflow-permission regressions; ESLint and the production Vite build passed. The image was loaded into kind and the UI deployment rolled out successfully. Browser checks covered the Chinese homepage, monitoring tables, settings, model empty results, English/Chinese switching, reload persistence, and retaining unsaved form input. Test form changes were discarded without creating a project.

Follow-up on 2026-09-08: corrected Register artifact (including the open modal title and instructions), conditional Name headers, Batch run, Auto Refresh, Any time and the upstream sidebar pin tooltips. The header logo now returns to projects through the existing router. Language handoff between MLRun and Nuclio is explicit, and App/router-owning hooks do not subscribe to locale changes, preserving route/form identity. The expanded UI suite passed 129 tests across 18 files, including the separately added shell tests; ESLint and the Vite production build passed. The reproducible UI image tag is now 1.13.0-rc7-local.5.

Nuclio uses a separate pinned AngularJS/i18next overlay under hack/local/kind/nuclio-ui. It covers real-time functions and API gateways, maintains editable Chinese catalogues, passes the selected language on links back to the originating MLRun site, and places the home link and language selector side by side. Both build scripts are integrated into install-full.ps1.

Browser acceptance covered the corrected artifact dialog switching to English while retaining its typed name, the Chinese Nuclio functions/API gateway pages, single-line Chinese and English header layouts, MLRun-to-Nuclio Chinese handoff and Nuclio-to-MLRun English handoff. Nuclio's 12 regression tests cover its catalogues, native i18next interpolation, presentation-only options, locale/origin handling and cancelling an unsaved-edit language change. No test projects, artifacts or functions were saved.
