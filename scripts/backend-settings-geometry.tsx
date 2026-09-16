/**
 * Geometry rig: the SHIPPED settings page, mounted against a stubbed desktop
 * bridge that answers with the real `/v1/settings` projection.
 *
 * The page is mounted rather than the section alone because the numbers this rig
 * exists for are the page's: the settings page gives the section its column
 * (`max-w-4xl`), and a section mounted at some other width would be measured at
 * a width the product never renders.
 *
 * The payload is NOT hand-written: `scripts/fixtures/backend-settings-registry*.json`
 * is `settings_io.py` serialized exactly as `server/routes/settings.py::list_settings`
 * does it, so a label, a help sentence or a choice that is wrong in a measurement
 * is wrong in the registry.
 *
 * Read `backend-settings-geometry.mjs` for the states, the probe and the numbers.
 */

import { SettingsPage } from "@features/settings/components/settings-page";
import type { BackendSettings } from "@shared/api/local-operator/desktop-api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import configuredJson from "./fixtures/backend-settings-registry-configured.json";
import fixtureJson from "./fixtures/backend-settings-registry.json";
// The rig's stylesheet, not `@renderer/styles/index.css` directly: it imports
// that file AND declares `@source` over the renderer tree, which is the half
// that makes the classes written in `src/renderer/src` compile at all. See the
// file's own comment.
import "./backend-settings-geometry.css";

const params = new URLSearchParams(location.search);
const THEME = params.get("theme") ?? "localOperatorDark";
/** Which committed projection to serve: `fresh`, `changed` or `redacted`. */
const FIXTURE = params.get("fixture") ?? "fresh";
/** Which interaction was driven before the probe ran, recorded for the report. */
const STATE = params.get("state") ?? "arrival";

document.documentElement.dataset.theme = THEME;

const base = fixtureJson as unknown as BackendSettings;
const configured = configuredJson as unknown as BackendSettings;

/**
 * The redacted state, which no default configuration produces: it needs an
 * endpoint whose value carries a query string or userinfo, which `_private_endpoint`
 * classifies rather than the fixture. Picked by key shape so it follows the
 * registry if a key is renamed.
 */
function payloadFor(state: string): BackendSettings {
	if (state === "changed") return configured;
	if (state !== "redacted") return base;
	const key = base.settings.find((s) => /base_url|endpoint/.test(s.key))?.key;
	return {
		...base,
		settings: base.settings.map((s) =>
			s.key === key
				? { ...s, redacted: true, value: null, is_default: true }
				: s,
		),
	};
}

/** One live payload, mutated by `settings.edit` so a Save is observable. */
const payload = payloadFor(FIXTURE);

/*
 * The fixture is also published on the window, so the probe can name each row's
 * KIND. The DOM shows a number input or a switch; only the registry knows that
 * `retry.fallbackChains` is a cascade and that `keymap.new_session` is a hotkey,
 * and "px per row by kind" is one of the numbers this rig is for. Nothing
 * renders from this global.
 */
(window as unknown as { __rig?: unknown }).__rig = {
	state: STATE,
	fixture: FIXTURE,
	sections: payload.sections,
	settings: payload.settings.map((setting) => ({
		key: setting.key,
		section: setting.section,
		kind: setting.kind,
		is_default: setting.is_default,
		redacted: setting.redacted,
		gated_by: setting.gated_by ?? null,
		has_help: Boolean(setting.help),
	})),
};

const ok = (result: unknown) => ({
	status: 200,
	body: { status: 200, message: "ok", result },
});

/*
 * The page mounts two neighbouring surfaces that talk to the preload bridge
 * directly — the header's update control and the Application updates section at
 * the foot — and both throw inside effects when their bridge member is missing,
 * which unmounts the WHOLE tree and leaves an empty document rather than a page
 * with one broken corner. A jobless version of those members is therefore part
 * of rendering this surface at all. They answer nothing, and nothing here is a
 * measurement of them.
 */
const idle = async () => null;
const unsubscribe = () => () => {};
const preload: Record<string, unknown> = {
	desktop: {
		request: async (request: { op: string; key?: string; value?: unknown }) => {
			switch (request.op) {
				case "capabilities":
					return ok({
						desktop_contract: 1,
						desktop_available: true,
						desktop_auth: "bearer",
						// `settings` is the gate this surface sits behind; the rest are
						// deliberately absent so neighbouring sections that negotiate
						// their own capabilities stay quiet rather than half-rendering.
						features: { settings: 1, config: 1 },
					});
				case "config.get":
					// `ok()` builds the IPC envelope around ONE CRUDResponse, so this
					// argument is the ConfigResponse itself, not a second envelope:
					// nesting two puts `values` one level below where `useConfig`
					// reads it and the whole page throws on `config.values.hosting`.
					return ok({
						version: "0.0.0-rig",
						metadata: { created_at: "", last_modified: "" },
						values: {
							hosting: "openrouter",
							model_name: "openrouter/deepseek/deepseek-chat",
							conversation_length: 30,
							detail_length: 10,
							max_learnings_history: 50,
							auto_save_conversation: true,
						},
					});
				case "settings.list":
					return ok(payload);
				case "settings.edit": {
					const row = payload.settings.find((s) => s.key === request.key);
					if (row) {
						row.value = request.value;
						row.is_default = false;
					}
					return ok(row ?? null);
				}
				case "settings.reset": {
					const row = payload.settings.find((s) => s.key === request.key);
					if (row) {
						row.value = row.default;
						row.is_default = true;
					}
					return ok(row ?? null);
				}
				default:
					return {
						status: 404,
						body: { detail: { code: "not_implemented", message: request.op } },
					};
			}
		},
	},
	systemInfo: {
		getAppVersion: async () => "0.0.0-rig",
		getPlatformInfo: async () => ({
			platform: "darwin",
			arch: "arm64",
			nodeVersion: "",
			electronVersion: "",
			chromeVersion: "",
		}),
	},
	openExternal: async () => undefined,
	updater: new Proxy(
		{
			checkForAllUpdates: async () => ({
				affirmation: null,
				app: null,
				server: null,
				npx: null,
			}),
		},
		{
			get(target, prop) {
				if (prop in target) {
					return (target as Record<string, unknown>)[prop as string];
				}
				// Every `on*` is a subscribe: it must hand back an unsubscribe, or
				// the effect that installs it returns `undefined` and React treats
				// the value as a cleanup it cannot call.
				return String(prop).startsWith("on") ? unsubscribe : idle;
			},
		},
	),
};

(window as unknown as { api: unknown }).api = preload;

// React Query pauses refetching in a hidden tab, which silently defeats a rig
// run. Reporting the document visible keeps the measurements the ones a focused
// user would produce.
Object.defineProperty(document, "visibilityState", {
	configurable: true,
	get: () => "visible",
});
Object.defineProperty(document, "hidden", {
	configurable: true,
	get: () => false,
});

const client = new QueryClient({
	defaultOptions: {
		queries: {
			retry: false,
			gcTime: Number.POSITIVE_INFINITY,
			retryOnMount: false,
			refetchOnWindowFocus: false,
		},
	},
});

createRoot(document.getElementById("root") as HTMLElement).render(
	<StrictMode>
		<QueryClientProvider client={client}>
			{/* The page resolves its own route for `/settings` deep links. */}
			<MemoryRouter initialEntries={["/settings"]}>
				{/* `h-screen` because the page's root is `h-full`: the app's shell
				    gives it a bounded height, and without one the content div never
				    becomes the scroller the section lives in. */}
				<div className="h-screen w-screen overflow-hidden bg-canvas">
					<SettingsPage />
				</div>
			</MemoryRouter>
		</QueryClientProvider>
	</StrictMode>,
);
