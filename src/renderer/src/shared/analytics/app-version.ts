/**
 * The installed app's version as a PostHog super property, `app_version`.
 *
 * WHY THIS EXISTS (2026-11-24). No desktop event said which build of the app
 * sent it. The only version on a renderer event was `$lib_version`, and that is
 * posthog-js's own (1.235.6 on v0.60.2, v0.61.0 and v0.62.1 alike), so a fix
 * shipped for onboarding or first-run could not be verified in the field: the
 * funnel before and after a release looked like one population. A super
 * property is stamped by posthog-js onto EVERY event it captures — named
 * product events, `$autocapture`, `$rageclick`, `$exception`, `$pageview` — so
 * one registration covers them all without touching a single call site.
 *
 * WHERE THE VALUE COMES FROM. Main's `app.getVersion()`, handed to this window
 * through `additionalArguments` and read back by the preload as
 * `window.api.appVersion` (`APP_VERSION_ARG` in `src/main/telemetry-launch.ts`
 * explains why argv and not the async `get-app-version` IPC). It is plain
 * semver, nothing personal, and the same string the About panel shows.
 *
 * WHEN IT IS REGISTERED, and why that is early enough. `main.tsx` calls
 * `registerAppVersion` from posthog-js's `loaded` option. In posthog-js 1.235.6
 * `init` → `_init` calls `_loaded()` synchronously
 * (`node_modules/posthog-js/lib/src/posthog-core.js:463`), and `_loaded` runs
 * `this.config.loaded(this)` (:507) BEFORE it schedules the initial pageview
 * with `setTimeout(..., 1)` (:514-520; the source's own comment: "this happens
 * after 'loaded' so a user can call identify or any other things before the
 * pageview fires"). So the very first `$pageview` already carries it. Re-check
 * those lines when posthog-js is upgraded.
 *
 * WHY `unregister` WHEN THERE IS NO VERSION. `register` persists super
 * properties (localStorage/cookie) across launches. A launch whose bridge has
 * no version — an older main, a host that is not an app window — would
 * otherwise keep stamping the PREVIOUS launch's version on its events, which is
 * worse than none: absence reads as "unknown", a stale value reads as a fact.
 *
 * NO `posthog-js` IMPORT HERE beyond the structural type below, for
 * `product-events.ts`'s reason: node-side test bundles reach this module and
 * cannot load posthog-js.
 */

/** The super property's name, as a query against the events should spell it. */
export const APP_VERSION_PROPERTY = "app_version";

/** The two posthog-js client methods this needs, and nothing else. */
export interface SuperPropertyClient {
	register(properties: Record<string, string>): void;
	unregister(property: string): void;
}

/**
 * Register `version` on `client`, or clear a persisted one when there is no
 * usable version. Never throws: analytics is never a reason for start-up to
 * fail, and a throw inside `loaded` is caught and logged by posthog-js anyway
 * (posthog-core.js:508-510), which would only add noise.
 */
export function registerAppVersion(
	client: SuperPropertyClient,
	version: string | null | undefined,
): void {
	try {
		const trimmed = typeof version === "string" ? version.trim() : "";
		if (trimmed === "") {
			client.unregister(APP_VERSION_PROPERTY);
			return;
		}
		client.register({ [APP_VERSION_PROPERTY]: trimmed });
	} catch {
		// Dropped silently, as every other analytics failure is.
	}
}

/**
 * The version this window's bridge reports, or `null` outside an app window
 * (Storybook, a bare renderer, a node test bundle). Guarded rather than assumed,
 * like `telemetryEnabled`, so importing this module never needs a `window`.
 */
export function bridgeAppVersion(): string | null {
	if (typeof window === "undefined") return null;
	const value = (window as { api?: { appVersion?: unknown } }).api?.appVersion;
	return typeof value === "string" ? value : null;
}
