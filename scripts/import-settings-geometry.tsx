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
 * Read `import-settings-geometry.mjs` for the states, the probe and the numbers.
 */

import { SettingsPage } from "@features/settings/components/settings-page";
import type { BackendSettings } from "@shared/api/local-operator/desktop-api";
import { applyThemeToDocument } from "@shared/themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { glassPaintFor } from "../src/shared/window-glass";
import configuredJson from "./fixtures/backend-settings-registry-configured.json";
import fixtureJson from "./fixtures/backend-settings-registry.json";
// The rig's stylesheet, not `@renderer/styles/index.css` directly: it imports
// that file AND declares `@source` over the renderer tree, which is the half
// that makes the classes written in `src/renderer/src` compile at all. See the
// file's own comment.
import "./import-settings-geometry.css";

const params = new URLSearchParams(location.search);
const THEME = params.get("theme") ?? "localOperatorDark";
/** Which committed projection to serve: `fresh`, `changed` or `redacted`. */
const FIXTURE = params.get("fixture") ?? "fresh";
/** Which interaction was driven before the probe ran, recorded for the report. */
const STATE = params.get("state") ?? "arrival";
/**
 * Evidence states the review asked for. Each is a deliberate fixture rather than
 * an unreachable accident:
 *
 *  - `previewFail=1` refuses `imports.preview`, which is the only way to see the
 *    inline failure and its Retry - the unmodified bridge always succeeds.
 *  - `complete=1` answers `imports.status` with a nested `result`, without which
 *    the container never enters its completion state and the "Import more
 *    conversations" CTA cannot be reached at all.
 *  - `glass=1` applies the app's OWN `glassPaintFor` exactly as
 *    `use-window-glass.ts` does, so the selected row is judged on the translucent
 *    ground the operator actually runs.
 */
const PREVIEW_FAIL = params.get("previewFail") === "1";
const COMPLETE = params.get("complete") === "1";
const GLASS = params.get("glass") === "1";

/*
 * THE SAME TWO WRITES THE APP'S THEME PROVIDER MAKES. Setting only
 * `data-theme` left the document without the `.dark` class, which is what the
 * `dark:` variants and the glass scheme derive from - so a dark palette was
 * being measured with the scheme's light half.
 */
applyThemeToDocument(THEME as Parameters<typeof applyThemeToDocument>[0]);

if (GLASS) {
	/*
	 * EXACTLY `paint()` FROM `use-window-glass.ts`: the same export, the same
	 * inputs, the same two writes (the attribute and the custom properties).
	 * Nothing here invents an alpha; if the shipped derivation changes, this rig
	 * follows it.
	 */
	const paint = glassPaintFor({
		coverage: "full",
		intensity: 80,
		mechanism: "vibrancy",
		material: "window",
		scheme: document.documentElement.classList.contains("dark")
			? "dark"
			: "light",
	});
	document.documentElement.dataset.glass = paint.kinds;
	for (const [name, value] of Object.entries(paint.vars)) {
		document.documentElement.style.setProperty(name, value);
	}
	/**
	 * Published so the driver can record what was applied rather than assert it:
	 * the numbers beside the frame say which alphas produced the picture.
	 */
	(window as unknown as Record<string, unknown>).__rigGlass = {
		kinds: paint.kinds,
		vars: paint.vars,
	};
}

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
 * The import surface's own fixtures, shaped in the WIRE vocabulary
 * (`snake_case`), because the renderer's mapper reads exactly these keys.
 */
const importSources = [
	{
		source: "omp",
		label: "omp",
		root: "/Users/damian/.omp/agent",
		detected: true,
		session_count: 9,
		availability: "full",
		detail: "sessions/**/*.jsonl",
	},
	{
		source: "claude",
		label: "Claude Code",
		root: "/Users/damian/.claude",
		detected: true,
		session_count: 3,
		availability: "full",
		detail: "projects and daemon job transcripts",
	},
];

const importSessions = [
	{
		source: "omp",
		source_id: "herd-install",
		title: "HERD: Check and update herdi install",
		cwd: "/Users/damian/oss/herd",
		created_ts: 1_760_000_000,
		updated_ts: 1_760_100_000,
		message_count: 154,
		compaction_count: 0,
		kind: "conversation",
		availability: "full",
		parent_source_id: null,
	},
	{
		source: "omp",
		source_id: "omp-2f1a",
		title: "Refactor the transcript writer",
		cwd: "/Users/damian/oss/omp",
		created_ts: 1_760_000_000,
		updated_ts: 1_760_100_000,
		message_count: 12,
		compaction_count: 0,
		kind: "conversation",
		availability: "full",
		parent_source_id: null,
	},
];

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
		request: async (request: {
			op: string;
			key?: string;
			value?: unknown;
			sessionIds?: Record<string, string[]>;
		}) => {
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
				/* ---- the import surface's own ops ---- */
				case "imports.sources":
					return ok({ sources: importSources });
				case "imports.sessions":
					return ok({ sessions: importSessions });
				case "imports.preview": {
					/*
					 * THE COUNTS ARE THE REQUESTED SESSIONS, not a fixed number: the
					 * whole point of the preview is to say what would be copied, and
					 * a stub that answers "2 sessions" whatever was asked for makes
					 * the rig's own numbers a fiction. The requested ids are counted
					 * and their message counts summed, so the card under test shows
					 * the same figures the selection actually implies.
					 */
					if (PREVIEW_FAIL) {
						return {
							status: 500,
							body: {
								detail: {
									code: "source_locked",
									message: "The source store is locked.",
								},
							},
						};
					}
					const requested = Object.values(request.sessionIds ?? {}).flat();
					const sessions = importSessions.filter((session) =>
						requested.includes(session.source_id),
					);
					return ok({
						total_sessions: requested.length,
						total_messages: sessions.reduce(
							(sum, session) => sum + (session.message_count ?? 0),
							0,
						),
						message_counts_estimated: true,
						total_compactions: 0,
						total_memory_records: 0,
						projected_memory_tokens: 0,
						projected_global_tokens: 0,
						warnings: [],
						instruction_review_paths: [],
					});
				}
				case "imports.start":
					return ok({ job_id: "job-probe-1" });
				case "imports.status":
					/*
					 * THE NESTED RESULT IS WHAT MAKES THE COMPLETION STATE REACHABLE. The
					 * container only sets `result` when the status carries one, so a stub
					 * that answers `done` with no `result` leaves the screen on the
					 * progress rows forever and the "Import more conversations" CTA
					 * cannot be captured - or judged.
					 */
					return ok({
						job_id: "job-probe-1",
						state: "done",
						phase: "done",
						source: "omp",
						session_id: "",
						completed: 1,
						total: 1,
						results: COMPLETE
							? [
									{
										source: "omp",
										source_id: "herd-install",
										outcome: "imported",
										target_session_id: "sess-rig-1",
										messages: 154,
										compactions: 0,
										warnings: [],
									},
								]
							: [],
						warnings: [],
						error: "",
						started_at: 1,
						updated_at: 2,
						...(COMPLETE
							? {
									result: {
										job_id: "job-probe-1",
										state: "done",
										sessions: [
											{
												source: "omp",
												source_id: "herd-install",
												outcome: "imported",
												target_session_id: "sess-rig-1",
												messages: 154,
												compactions: 0,
												redactions: 0,
												skipped: false,
												warnings: [],
											},
										],
										messages: 154,
										compactions: 0,
										memory_imported: 0,
										memory_skipped: 0,
										memory_review_path: "",
										instruction_review_path: "",
										redactions: 0,
										warnings: [],
										error: "",
									},
								}
							: {}),
					});
				case "imports.cancel":
					return ok(null);
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
				{/* The app's OWN shell chain, class for class, because the question
				    this rig exists for is which ancestor a `scrollIntoView` moves:
				    app.tsx's root is `relative flex h-screen flex-col overflow-hidden`
				    (the `relative` is what contains the app's `sr-only` labels, per
				    app.tsx's own comment), the region below it is
				    `flex min-h-0 flex-1 overflow-hidden`, and the route's host is
				    `main.flex grow flex-col overflow-hidden`. A rig that mounts the
				    page directly under a plain `h-screen` div lets those labels
				    escape the clip and stretch the body, which is a DIFFERENT scroll
				    geometry than the app has. */}
				<div
					data-rig-shell-root
					className="relative flex h-screen w-screen flex-col overflow-hidden bg-canvas"
				>
					<div className="flex min-h-0 flex-1 overflow-hidden">
						<main className="flex grow flex-col overflow-hidden">
							<SettingsPage />
						</main>
					</div>
				</div>
			</MemoryRouter>
		</QueryClientProvider>
	</StrictMode>,
);
