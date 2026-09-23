/**
 * Whether THIS document may report to PostHog, read from the launch.
 *
 * The renderer cannot work this out for itself. Its configuration arrives as
 * `VITE_*` variables inlined at BUILD time, so a variable set at launch cannot
 * reach it at all — a build made with the project key carries it forever, and
 * the schema's default is the live key, so a rig that simply omits the variable
 * still ships it. The decision therefore travels the way the renderer's other
 * launch facts do: main composes it into the window's
 * `webPreferences.additionalArguments` (`telemetryArgument` in
 * `src/main/telemetry-launch.ts`), the preload reads it out of its own
 * `process.argv` — synchronously, before any page code runs — and exposes it as
 * `window.api.telemetryEnabled`.
 *
 * FAIL-CLOSED, and why the default points this way. Anything other than an
 * explicit `true` from the bridge reads as OFF: no bridge at all (Storybook, a
 * bare Vite renderer, a test host that mounted the app's components without the
 * preload), an argument the preload could not parse, or a future window-creation
 * path that forgot to compose the entry. `src/main/index.ts` writes the entry on
 * EVERY window it creates — unlike the dev driver's opt-in, which is written
 * only when armed — precisely so that "no entry" can never be a normal launch's
 * spelling. The wrong guess here is a run's events landing in a customer-facing
 * dashboard as a user and a session replay, which is what this exists to stop;
 * the cost of the closed guess is that the app says nothing to PostHog, which is
 * the state the launch asked for.
 *
 * This module is what the renderer's two PostHog call sites read — the provider
 * in `main.tsx` and the feature-flag provider, whose neutral branch must not
 * touch `posthog-js` at all — so "off" is decided in one place rather than in
 * two files that could drift.
 */

/**
 * The decision, from whatever the bridge offered.
 *
 * A named function rather than an inline comparison because it is the whole rule
 * above, and because a test can assert it without a renderer: everything except
 * an explicit `true` is off.
 */
export function resolveTelemetryEnabled(
	fromBridge: boolean | undefined,
): boolean {
	return fromBridge === true;
}

/**
 * This document's decision, resolved once at module load.
 *
 * `typeof window` is guarded rather than assumed so this module can be imported
 * outside a renderer (a node test bundling it, a future main-process import);
 * that path resolves to OFF like every other one that has no bridge to read.
 */
export const telemetryEnabled: boolean = resolveTelemetryEnabled(
	typeof window === "undefined" ? undefined : window.api?.telemetryEnabled,
);
