/**
 * Where the capture view's own document lives, given the trusted renderer URL.
 *
 * WHY THIS IS A FUNCTION RATHER THAN AN INLINE `replace` (code review round 1, B1):
 * the two shapes of `rendererUrl` are not the same shape, and treating them as one cost
 * a dev-only defect that no rig could see. A built or packaged run hands over a `file:`
 * URL that ENDS in `index.html`, so the capture document is its sibling and a suffix
 * replacement is right. A dev run hands over electron-vite's `ELECTRON_RENDERER_URL`,
 * which is an ORIGIN with no document in it at all (`http://localhost:5173`), so the same
 * replacement matched nothing and the hidden window loaded the app's own `index.html` —
 * the shell `console-capture.tsx` exists to be separate from, which answers no
 * measurement and made every dev capture burn its settle budget and refuse.
 *
 * The repo's own precedent for a second dev document is to APPEND the path
 * (`backend-installer.ts`: `${ELECTRON_RENDERER_URL}/installer`), and this is that shape
 * for a dev origin, keeping the sibling replacement for a built tree.
 */
const INDEX_DOCUMENT_SUFFIX = /\/?index\.html(\?.*)?$/;

export const CAPTURE_DOCUMENT = "console-capture.html";

export const consoleCaptureUrlFor = (rendererUrl: string): string =>
	INDEX_DOCUMENT_SUFFIX.test(rendererUrl)
		? rendererUrl.replace(INDEX_DOCUMENT_SUFFIX, `/${CAPTURE_DOCUMENT}`)
		: `${rendererUrl.replace(/\/$/, "")}/${CAPTURE_DOCUMENT}`;
