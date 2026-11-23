/**
 * The electron-vite dev server URL, honoured ONLY in an unpackaged build.
 *
 * WHY. `ELECTRON_RENDERER_URL` is how `pnpm dev` points the window at Vite's
 * http server. Read unconditionally, the same variable in a PACKAGED app's
 * environment let any same-uid launcher:
 * - load an arbitrary origin as the trusted renderer document (it widened
 *   `trustedRendererDocuments`, which the desktop IPC trusts as the operator's
 *   UI), and so drive the `desktop-request` bridge from a page it controls;
 * - turn DevTools on (`webPreferences.devTools`);
 * - add that origin to the backend's CORS allowlist, and switch the updater
 *   into dev mode.
 * F2 makes the packaged app's card answers count as the operator's verified
 * consent, so the packaged app must not let an environment variable choose its
 * UI. A packaged launch therefore ignores the variable completely.
 *
 * `isPackaged` is a parameter rather than an `electron` import so the rule is
 * testable as arithmetic; callers pass `app.isPackaged`.
 */
export function devRendererUrl(
	isPackaged: boolean,
	env: NodeJS.ProcessEnv = process.env,
): string | undefined {
	if (isPackaged) return undefined;
	return env.ELECTRON_RENDERER_URL || undefined;
}
