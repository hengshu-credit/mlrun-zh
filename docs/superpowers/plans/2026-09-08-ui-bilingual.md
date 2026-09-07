# MLRun bilingual UI implementation plan

**Goal:** Add Simplified Chinese and English to the existing MLRun UI, with immediate switching, browser-language detection and persisted preference.

**Approved design:** The user approved the design in this task on 2026-09-08. Translate application navigation, forms, actions and feedback; preserve user data, API values, source code and logs.

**Architecture:** Keep the upstream UI pinned to c4235698cba093958c02281cd20dbe0ab380230e. Store a reproducible UI overlay under hack/local/kind/ui. A source-level Babel transform localizes explicitly identified presentation literals, using a reviewed English/Chinese catalogue and a React external locale store. No DOM rewriting or remote translation service.

**Stack:** React 18, Vite, Babel, Vitest, Node.js, Docker and existing kind deployment.

- [ ] Test locale selection, persistence, missing-key fallback, interpolation and switching without losing form state; implement the locale store and accessible header selector.
- [ ] Test the presentation-literal transform against API identifiers and user-provided content; implement extraction, source maps and reactive display labels.
- [ ] Review and translate extracted UI messages; integrate navigation, main pages, dialogs and status presentation. Preserve protocol values.
- [ ] Save pinned source metadata, overlay application/build scripts and local deployment instructions. Preserve existing workflow permission changes.
- [ ] Run focused regression tests, lint and production build. Verify main pages and both language directions in a browser, including refresh and route changes.

Tests live in hack/local/kind/ui/i18n and are copied into the build workspace by the overlay script. Build outputs remain in ignored playground directories; reproducible inputs remain tracked in this repository. Existing unrelated changes must not be overwritten.
