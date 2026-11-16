/*
 * The scoped config directory's preview - NON-SHIPPING, deliberately empty of behaviour.
 *
 * A RE-EXPORT, NOT A COPY, for two reasons. The real `.storybook/preview.tsx` is what
 * makes a frame trustworthy: the app's real faces (Geist Mono), `@renderer/styles/index.css`
 * with the Tailwind layers, the appearance/theme providers, the locale-direction provider
 * and the query-client decorator. A copy drifts; an import keeps this surface identical to
 * the product's own Storybook by construction - fonts and theme roles stay actual.
 *
 * VERIFIED AT cea4ee9b (blob e04f9b174254a8c74ddf5735140b798f34597082): the file's ONLY
 * top-level export is `export default preview;` at :694 (`const preview: Preview` :492),
 * so `export *` is deliberately absent - it would forward nothing today and could silently
 * forward something later that this surface never asked for.
 *
 * Nothing here reaches a backend: the story's meta decorator installs `mockUpdaterApi()`
 * (update-notification.stories.tsx:1344 -> :325, assigning `window.api.updater` at :1194),
 * a browser has no Electron preload so no IPC channel exists, and `checkForUpdates` is a
 * never-resolving stub (:1453).
 */
export { default } from "../.storybook/preview";
