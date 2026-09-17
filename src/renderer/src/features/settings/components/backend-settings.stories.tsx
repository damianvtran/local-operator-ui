/**
 * The Backend settings section, in the states a first visit, a search and a deep
 * link can put it in.
 *
 * Why this file exists. This is the largest surface in the app - 102 registry
 * rows in 19 sections - and until now it had NO story, NO fixture and NO
 * committed frame anywhere in `docs/evidence/`. Every claim about it was a claim
 * about a surface nobody could look at, and the redesign it accompanies has to
 * be judged against what it was.
 *
 * A story rather than a rig, because the one thing a browser cannot supply is
 * `window.api.desktop.request` - the preload bridge `desktop-api.desktopRequest`
 * prefers, and without which every frame would photograph a transport error. The
 * stub below is `mcp-management-section.stories.tsx`'s pattern (the operations
 * this section issues, and a named refusal for anything else). The section, its
 * query, its filter bar and its controls are the PRODUCT's.
 *
 * The payload is not hand-written either. `scripts/fixtures/backend-settings-registry*.json`
 * is the real `/v1/settings` projection: `settings_io.py` serialized exactly as
 * `server/routes/settings.py::list_settings` does it, so a label, a help
 * sentence, an enum's choices or a `warning` clause that is wrong in a frame is
 * wrong in the registry. Two states are committed - a fresh install, and one
 * configured through the registry's own `write_setting` (which is why
 * `is_default` is the product's judgement of each row rather than a flag this
 * file sets).
 *
 * HOW THE INTERACTIVE FRAMES ARE TAKEN. Storybook's `play` cannot hold a
 * capture: the harness photographs as soon as the story has elements and the
 * webfonts have loaded, which is usually before a play has finished driving
 * anything. So the driven states use this repo's own shutter contract instead
 * (`app-updates-section.stories.tsx`): a component sets
 * `documentElement.dataset.capturePending` on mount, runs the script, waits for
 * the state it claims to show to be ON SCREEN, and only then clears it. A script
 * whose state never arrives leaves the shutter closed and fails the sweep,
 * rather than quietly committing a picture of an untouched section.
 *
 * The scripts are DOM-level (`element.click()`, a setter plus an `input` event)
 * rather than `@storybook/test`'s user-event, for the same reason the hold is
 * imperative: this runs in a layout effect, outside a play, and what it has to
 * drive is the product's own React handlers.
 *
 * What the frames are evidence about, and their limit: they are pictures of the
 * RENDERER over a fixture shaped like the wire. Whether the real backend serves
 * that payload - and `warning`/`gated_by` in particular, which the current
 * server does NOT project - is QA's job against a running app, not a frame's.
 * The provider and model rows added two ops to this stub
 * (`providers.list`, `models.catalogue`); their option lists come from
 * `setting-combobox.fixtures.ts`, and the hosting registry there is the
 * committed real projection rather than a hand-written one.
 */

import type { BackendSettings } from "@shared/api/local-operator/desktop-api";
import type { Meta, StoryObj } from "@storybook/react";
import type { FC } from "react";
import { useLayoutEffect } from "react";
import configuredJson from "../../../../../../scripts/fixtures/backend-settings-registry-configured.json";
import fixtureJson from "../../../../../../scripts/fixtures/backend-settings-registry.json";
import type { DesktopResponse } from "../../../../../shared/desktop-contract";
import { BackendSettingsSection } from "./backend-settings-section";
import { PROVIDER_ROWS, catalogue } from "./setting-combobox.fixtures";

type Setting = BackendSettings["settings"][number];

/* --------------------------------------------------------------- bridge */

type BridgeRequest = { op: string; key?: string; value?: unknown };

/**
 * How the stubbed transport answers a WRITE.
 *
 * `ok` is the shipped behaviour. The other two exist because a write's two
 * non-success endings are states of this surface and neither can be photographed
 * through a store that always succeeds: `hang` leaves the request in flight (the
 * `Saving` state, and the `Saving` label on the row and on `Save all`), and
 * `fail` answers the server's own refusal (the `role="alert"` and its `Retry`).
 * Both were unit-test-only until now — the design round's blocking evidence gap
 * was that 11 stories and 144 frames showed no draft at all (D3).
 */
type BridgeMode = "ok" | "hang" | "fail";

/**
 * The desktop transport, stubbed.
 *
 * `desktopRequest` prefers `window.api.desktop.request` and falls back to
 * `fetch("/__desktop")`, which Storybook's dev server does not serve - so
 * without this every frame would photograph a transport error instead of the
 * section. It answers the six operations this surface issues - the four it has
 * always issued plus `providers.list` and `models.catalogue`, which the provider
 * and model rows added - and refuses anything else BY NAME, so a story that
 * starts issuing a seventh read fails loudly rather than hanging on a promise
 * nothing resolves.
 *
 * `settings.edit`/`settings.reset` mutate the live payload the way the backend
 * does (the value, then `is_default`), because a saved or reset row is a state
 * this surface has and one static fixture cannot be in two states at once.
 */
let bridge: ((request: BridgeRequest) => Promise<DesktopResponse>) | null =
	null;

/**
 * How the stubbed transport answers the two ops the provider and model rows
 * issue.
 *
 * `ok` is the shipped behaviour. The other three are states of this surface no
 * happy payload can photograph: a model catalogue that came back with a
 * per-provider failure (`errors` non-empty, which still carries `models`), one
 * whose credential store could not be read, where every row's `connected` is
 * the listing's own default and must not be turned into a badge, and one that
 * has not answered yet — the state the list's own loading row exists for, and
 * the one this surface's first open is ALWAYS in for a moment. All are asserted
 * in the option builders' test; these stories exist so a reader can SEE what
 * they produce in the row.
 */
type CatalogueMode = "ok" | "partial" | "unknown-credentials" | "in-flight";

const installBridge = (
	payload: BackendSettings,
	mode: BridgeMode = "ok",
	catalogueMode: CatalogueMode = "ok",
) => {
	const ok = (result: unknown): DesktopResponse => ({
		status: 200,
		body: { status: 200, message: "ok", result },
	});
	const row = (key?: string) => payload.settings.find((s) => s.key === key);
	bridge = async (request) => {
		switch (request.op) {
			case "capabilities":
				return ok({
					desktop_contract: 1,
					desktop_available: true,
					desktop_auth: "bearer",
					// `settings` is the gate this surface sits behind.
					features: { settings: 1 },
				});
			case "settings.list":
				return ok(payload);
			case "providers.list":
				// The committed real projection of `/v1/auth/providers`, so the frames
				// show the seventeen rows the shipped backend returns.
				return ok({ providers: PROVIDER_ROWS });
			case "models.catalogue":
				if (catalogueMode === "in-flight") {
					// A promise that never settles, which is what a fetch in flight IS
					// from the renderer's side. Without this state the list can only be
					// photographed with rows in it, and the claim it makes before they
					// arrive goes unexamined (design round 1, D1).
					return new Promise<DesktopResponse>(() => {});
				}
				if (catalogueMode === "partial") {
					return ok(
						catalogue({
							errors: { lmstudio: "unreachable", ollama: "unreachable" },
						}),
					);
				}
				if (catalogueMode === "unknown-credentials") {
					return ok(catalogue({ credentials_known: false }));
				}
				return ok(catalogue());
			case "settings.edit": {
				if (mode === "hang") return new Promise<DesktopResponse>(() => {});
				if (mode === "fail") {
					return {
						status: 422,
						body: {
							detail: {
								code: "write_refused",
								message: "The server refused the write.",
							},
						},
					};
				}
				const target = row(request.key);
				if (target) {
					target.value = request.value;
					target.is_default = false;
				}
				return ok(target ?? null);
			}
			case "settings.reset": {
				const target = row(request.key);
				if (target) {
					target.value = target.default;
					target.is_default = true;
				}
				return ok(target ?? null);
			}
			default:
				return {
					status: 404,
					body: { detail: { code: "not_implemented", message: request.op } },
				};
		}
	};
};

if (typeof window !== "undefined") {
	const page = window as unknown as {
		api?: {
			desktop?: { request: (r: BridgeRequest) => Promise<DesktopResponse> };
		};
	};
	const api = page.api ?? {};
	page.api = api;
	api.desktop = {
		request: (request: BridgeRequest) => {
			if (!bridge) throw new Error("no bridge installed for this story");
			return bridge(request);
		},
	};
}

/* --------------------------------------------------------------- fixtures */

const FRESH = fixtureJson as unknown as BackendSettings;
const CONFIGURED = configuredJson as unknown as BackendSettings;

/** The keys whose value is an endpoint, so the registry can redact one. */
const REDACTED_KEY = /base_url|baseUrl|endpoint/;

/**
 * One row in the redacted state.
 *
 * The registry ships that state and no default configuration produces it: it
 * needs an endpoint whose value carries a query string or userinfo, which
 * `_private_endpoint` classifies rather than the fixture. The row is picked by
 * KEY SHAPE rather than hard-coded so it follows the registry if a key is
 * renamed.
 */
const redactedKey = (settings: Setting[]) =>
	settings.find((setting) => REDACTED_KEY.test(setting.key))?.key;

/** The payload for one state, derived from the committed projection. */
function payloadFor(state: string): BackendSettings {
	const base = state === "changed" ? CONFIGURED : FRESH;
	if (state !== "redacted") return base;
	const key = redactedKey(base.settings);
	return {
		...base,
		settings: base.settings.map((setting) =>
			setting.key === key
				? { ...setting, redacted: true, value: null, is_default: true }
				: setting,
		),
	};
}

/* ------------------------------------------------------------- the ground */

/**
 * The section, in the column the settings page gives it.
 *
 * `max-w-4xl` is not a story choice: it is `settings-page.tsx`'s own content
 * column, and it is what makes the column 896px at a 1380px window and 888px at
 * 1000px. A story that mounted the section at some other width would photograph
 * a layout the product never renders - and the section's stacked fallback keys
 * on the COLUMN, not the window, so the width is the variable under test in the
 * narrow story.
 */
const Ground: FC<{ initialFilter?: string; focusKey?: string | null }> = ({
	initialFilter,
	focusKey,
}) => (
	<div className="min-h-screen bg-canvas p-6">
		<div className="mx-auto w-full max-w-4xl">
			<BackendSettingsSection
				focusKey={focusKey ?? null}
				initialFilter={initialFilter ?? ""}
			/>
		</div>
	</div>
);

/* ------------------------------------------------------------- the shutter */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const nextFrame = () =>
	new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

/** Wait for a predicate the story's own script is supposed to make true. */
const waitFor = async (done: () => boolean, attempts = 300) => {
	for (let i = 0; i < attempts; i++) {
		if (done()) return true;
		await sleep(20);
	}
	return false;
};

const sectionHeaderTriggers = (expanded: boolean) =>
	Array.from(
		document.querySelectorAll<HTMLElement>(
			`[data-section-header] button[aria-expanded="${expanded}"]`,
		),
	);

const clickAll = async (elements: HTMLElement[]) => {
	for (const el of elements) {
		el.click();
		await sleep(10);
	}
};

/**
 * Open one section by title, and only if it is closed.
 *
 * Idempotent on purpose: a layout effect can run twice (React's StrictMode in
 * development does exactly that), and an unconditional click would toggle the
 * section straight back shut — a frame of the wrong state that still looks
 * plausible.
 */
const openHeader = async (title: string) => {
	const header = buttonStartingWith(title);
	if (header?.getAttribute("aria-expanded") === "false") {
		header.click();
		await sleep(30);
	}
};

/** Reveal the advanced tier, and only if it is not already shown. */
const ensureAdvanced = async () => {
	const chip = buttonContaining("Show advanced");
	if (chip?.getAttribute("aria-pressed") === "false") {
		chip.click();
		await sleep(50);
	}
};

/**
 * A button whose visible text starts with `text`.
 *
 * Text rather than an accessible name, because a section header's name is a row
 * of marks (title, count, scope, changed dot) whose exact spelling is the
 * design's to choose - while the title it starts with is the registry's.
 */
const buttonStartingWith = (text: string) =>
	Array.from(document.querySelectorAll<HTMLElement>("button")).find((button) =>
		(button.textContent ?? "").trim().startsWith(text),
	);

const buttonContaining = (text: string) =>
	Array.from(document.querySelectorAll<HTMLElement>("button")).find((button) =>
		(button.textContent ?? "").toLowerCase().includes(text.toLowerCase()),
	);

/**
 * Type into a field the way a person does.
 *
 * React reads a controlled input's value from its own tracker, so assigning
 * `input.value` alone leaves the product's `onChange` looking at the old value.
 * Going through the prototype's setter and then dispatching `input` is what the
 * library-free rigs in this repo do (`scripts/renderer-driver.mjs`).
 */
const setFieldValue = (input: HTMLInputElement, value: string) => {
	const setter = Object.getOwnPropertyDescriptor(
		window.HTMLInputElement.prototype,
		"value",
	)?.set;
	setter?.call(input, value);
	input.dispatchEvent(new Event("input", { bubbles: true }));
};

const setTextareaValue = (el: HTMLTextAreaElement, value: string) => {
	const setter = Object.getOwnPropertyDescriptor(
		window.HTMLTextAreaElement.prototype,
		"value",
	)?.set;
	setter?.call(el, value);
	el.dispatchEvent(new Event("input", { bubbles: true }));
};

const typeSearch = async (text: string) => {
	const input = document.querySelector<HTMLInputElement>(
		'input[aria-label="Search settings"]',
	);
	if (!input) throw new Error("no search field rendered");
	input.focus();
	setFieldValue(input, text);
};

const rowsOf = (key: string) =>
	document.querySelector(`[data-setting-key="${key}"]`);

/*
 * Every regex this file uses is a top-level constant, including the one inside
 * `unsavedLine` and the row-button matchers below: an inline literal is compiled
 * on each call, and the four this round added were the only new warnings in the
 * whole `pnpm lint` run (review round 1, m3 — which fixed the first two and is
 * why the rule is worth following rather than re-argued).
 */
const RESULTS_IN_SECTIONS = /results? in \d+ sections?/;
const NO_MATCHES = /No settings match this search/;
const UNSAVED_LINE = /\d+ unsaved changes?/;
const SAVE_IDLE = /^Save$/;
const SAVE_BUSY = /^Saving$/;
const SAVE_OR_BUSY = /^(Save|Saving)$/;

/** One button inside one row, by its visible label. */
const rowButton = (key: string, label: RegExp) =>
	Array.from(
		document.querySelectorAll<HTMLElement>(
			`[data-setting-key="${key}"] button`,
		),
	).find((button) => label.test((button.textContent ?? "").trim()));

/** The row's cascade editor, which is the only `textarea` an advanced row has. */
const chainField = (key: string) =>
	document.querySelector<HTMLTextAreaElement>(
		`[data-setting-key="${key}"] textarea`,
	);

/** The page-level counter, which is the whole of "saving is no longer silent". */
const unsavedLine = () => UNSAVED_LINE.test(document.body.textContent ?? "");

const rowsRendered = () =>
	document.querySelectorAll("[data-setting-key]").length;

/* ------------------------------------------------------------------ */
/* States                                                             */
/* ------------------------------------------------------------------ */

/** A script a story runs before the shutter, and what proves it landed. */
type Script = { run: () => Promise<void>; expect: () => boolean };

const ALL_EXPANDED: Script = {
	run: async () => {
		await clickAll(sectionHeaderTriggers(false));
	},
	expect: () => sectionHeaderTriggers(false).length === 0 && rowsRendered() > 0,
};

const COLLAPSED: Script = {
	run: async () => {
		await clickAll(sectionHeaderTriggers(true));
	},
	expect: () => sectionHeaderTriggers(true).length === 0,
};

const ONE_SECTION: Script = {
	run: async () => {
		await clickAll(sectionHeaderTriggers(true));
		await openHeader("Model");
	},
	expect: () => Boolean(rowsOf("hosting")),
};

const FILTERED: Script = {
	run: async () => {
		await typeSearch("cache");
	},
	expect: () => RESULTS_IN_SECTIONS.test(document.body.textContent ?? ""),
};

const NO_RESULTS: Script = {
	run: async () => {
		await typeSearch("zzzzzz");
	},
	expect: () => NO_MATCHES.test(document.body.textContent ?? ""),
};

const REDACTED: Script = {
	run: async () => {
		// The redacted endpoint is an advanced key inside a section that is
		// closed on arrival, so the frame has to reveal the tier and open the
		// section to show it at all.
		await ensureAdvanced();
		await openHeader("Web search");
	},
	expect: () => Boolean(rowsOf("web_search.searxng_endpoint")),
};

const GATED: Script = {
	run: async () => {
		await ensureAdvanced();
		await openHeader("Session storage");
	},
	expect: () => Boolean(rowsOf("session.cleanup.max_sessions")),
};

const DEEP_LINK: Script = {
	// The reveal is the SECTION's own effect (that is what is under test here);
	// this script exists only to hold the shutter until it has landed.
	run: async () => {},
	expect: () => Boolean(rowsOf("web_search.searxng_endpoint")),
};

/**
 * The registry's one `cascade` key, which is the row the save model is hardest on.
 *
 * It lives in `failover` (advanced, closed on arrival), so the script opens the
 * tier and the section before it can touch the editor. All three of the states
 * below drive THIS row deliberately: it is the one whose draft is a set of chains
 * rather than a value, it is the row whose save used to leave the page saying
 * "1 unsaved change" about a write that had landed (review round 1, M1; QA round
 * 1, Q3), and a frame of it dirty / saving / failed is what the design round
 * asked for instead of a unit test's word for it (D3).
 */
const CASCADE_KEY = "retry.fallbackChains";

/** Put the cascade row into a state an unsaved edit describes. */
const editCascade = async () => {
	await ensureAdvanced();
	await openHeader("Failover and retry");
	await waitFor(() => Boolean(chainField(CASCADE_KEY)));
	const field = chainField(CASCADE_KEY);
	if (field) {
		setTextareaValue(field, `${field.value}\nanthropic/claude-sonnet-4`);
	}
	await sleep(50);
};

const DIRTY: Script = {
	run: editCascade,
	expect: () => unsavedLine() && Boolean(rowButton(CASCADE_KEY, SAVE_OR_BUSY)),
};

const SAVING: Script = {
	run: async () => {
		await editCascade();
		rowButton(CASCADE_KEY, SAVE_IDLE)?.click();
	},
	expect: () => Boolean(rowButton(CASCADE_KEY, SAVE_BUSY)),
};

const SAVE_FAILED: Script = {
	run: async () => {
		await editCascade();
		rowButton(CASCADE_KEY, SAVE_IDLE)?.click();
	},
	expect: () => Boolean(document.querySelector('[role="alert"]')),
};

/** The rows a state is about: the frame is not taken before they exist. */
const dispatchReadiness = async () => {
	await waitFor(() => rowsRendered() > 0);
	// One more tick, so the section's own seeding effect has committed and the
	// controls are bound to drafts rather than rendering their first pass.
	await sleep(30);
};

/**
 * Run a script with the shutter held.
 *
 * `capturePending` is set in a LAYOUT effect, so it is on the document before
 * the harness's readiness probe can see a rendered section - a probe that ran
 * first would photograph the state before the script touched it.
 */
const Driven: FC<{
	script: Script;
	initialFilter?: string;
	focusKey?: string;
}> = ({ script, initialFilter, focusKey }) => {
	useLayoutEffect(() => {
		document.documentElement.dataset.capturePending = "1";
		let cancelled = false;
		const run = async () => {
			await dispatchReadiness();
			await script.run();
			await waitFor(script.expect);
			await nextFrame();
			await nextFrame();
			if (!cancelled) delete document.documentElement.dataset.capturePending;
		};
		void run();
		return () => {
			cancelled = true;
			delete document.documentElement.dataset.capturePending;
		};
	}, [script]);
	return <Ground initialFilter={initialFilter} focusKey={focusKey} />;
};

const mount = ({
	state = "fresh",
	initialFilter,
	focusKey,
	script,
	mode,
	catalogueMode,
}: {
	state?: string;
	initialFilter?: string;
	focusKey?: string | null;
	script?: Script;
	mode?: BridgeMode;
	catalogueMode?: CatalogueMode;
} = {}) => {
	installBridge(payloadFor(state), mode, catalogueMode);
	if (script) {
		return (
			<Driven
				script={script}
				initialFilter={initialFilter}
				focusKey={focusKey ?? undefined}
			/>
		);
	}
	return <Ground initialFilter={initialFilter} focusKey={focusKey} />;
};

const meta: Meta = {
	title: "Settings/Backend",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/**
 * The registry's own provider and model rows, and the list one of them offers.
 *
 * WHAT THESE FRAMES ARE FOR. `hosting` and `model_name` were two bare `<Input>`s
 * with no placeholder and no affordance (`settings-backend--arrival` is the
 * before frame), and they are the operator's report. They are now the only
 * searchable fields in the registry, so three things need to be photographable:
 * the rows at rest, the list open over the whole login registry, and the model
 * list narrowed by the hosting beside it — which is the state the CONFIGURED
 * fixture produces by itself, because it holds
 * `model_name: "deepseek/deepseek-chat"`, a selector-shaped value no catalogue
 * row carries.
 *
 * The option payloads come from `setting-combobox.fixtures.ts`; the registry
 * payload is the committed projection, as everywhere in this file.
 */
const comboboxInput = (key: string) =>
	document.querySelector<HTMLInputElement>(
		`[data-setting-key="${key}"] input[role="combobox"]`,
	);

const listboxOpen = () => Boolean(document.querySelector('ul[role="listbox"]'));

/**
 * Open the row's own list, and hold the shutter until the list is really up.
 *
 * A combobox whose options are fetched lazily has no rows until the first open,
 * so a frame taken before that answers is a picture of an empty field — the
 * state this whole change exists to remove.
 */
const openCombobox = (key: string) => async () => {
	await waitFor(() => Boolean(comboboxInput(key)));
	comboboxInput(key)?.focus();
	await waitFor(listboxOpen);
};

const PROVIDER_ROWS_SCRIPT: Script = {
	run: async () => {},
	expect: () =>
		Boolean(comboboxInput("hosting")) && Boolean(comboboxInput("model_name")),
};

const HOSTING_LIST: Script = {
	run: () => openCombobox("hosting")(),
	expect: () =>
		listboxOpen() &&
		(document.querySelector('ul[role="listbox"]')?.textContent ?? "").includes(
			"Ollama",
		),
};

const MODEL_LIST: Script = {
	run: () => openCombobox("model_name")(),
	expect: () =>
		listboxOpen() &&
		(document.querySelector('ul[role="listbox"]')?.textContent ?? "").includes(
			"openrouter/",
		),
};

/**
 * The model list opened over a catalogue that never answers.
 *
 * The expectation deliberately stops at "the popover is open": waiting for a row
 * would wait forever, and the frame's subject is what the list says in the
 * absence of one.
 */
const MODEL_LIST_IN_FLIGHT: Script = {
	run: () => openCombobox("model_name")(),
	expect: () => listboxOpen(),
};

/**
 * The five rows at rest: the configured fixture's values, and a placeholder on
 * every row that is unset.
 */
export const ProviderModelRows: Story = {
	render: () => mount({ state: "changed", script: PROVIDER_ROWS_SCRIPT }),
};

/**
 * The hosting list open: the WHOLE login registry — every provider the app
 * knows, signed in or not — grouped by what it would take to use it.
 *
 * This is the operator's "tied to the centralised login state" claim as a
 * picture rather than a sentence, and the credential state is SHOWN rather than
 * used to filter: `hosting` is where a user names the provider they intend to
 * boot on, which may be one they have not logged into yet.
 */
export const HostingListOpen: Story = {
	render: () => mount({ state: "changed", script: HOSTING_LIST }),
};

/**
 * The model list open, narrowed by the hosting beside it.
 *
 * `hosting` is `openrouter` in this fixture, so the list is the aggregator's
 * rows — and the row at the bottom is the field's own value, rescued into its
 * own group because no listing contains `deepseek/deepseek-chat`. A stored
 * value that renders as a blank field is a lie the user cannot debug.
 */
export const ModelListOpen: Story = {
	render: () => mount({ state: "changed", script: MODEL_LIST }),
};

/**
 * A catalogue that came back with providers missing.
 *
 * `errors` is a partial-failure map and the answer still carries `models`, so
 * this is a NOTE under the field rather than an error state — collapsing the
 * two is a measured defect (1450 usable rows replaced by a wall of 21 provider
 * names), and `catalogueListing` is the module that exists to keep them apart.
 *
 * Named for what it renders. It was `catalogue-deferred`, which promised an
 * in-flight fetch this story has never shown — a partial failure answers
 * immediately, with rows — and the name is what made the in-flight state look
 * covered while no frame showed it (design round 1, D5.3).
 */
export const CataloguePartial: Story = {
	render: () =>
		mount({ state: "changed", catalogueMode: "partial", script: MODEL_LIST }),
};

/**
 * The catalogue still on its way: the first open of a model field.
 *
 * This is the state four of the five rows this PR adds are in for a moment on
 * every first open — a lazy ~460 KB fetch — and it is the state the list must
 * not answer with "Nothing matches that model", a claim about a query that has
 * not run. The field shows its placeholder and stays typeable; the list says it
 * is loading.
 */
export const CatalogueInFlight: Story = {
	render: () =>
		mount({
			state: "changed",
			catalogueMode: "in-flight",
			script: MODEL_LIST_IN_FLIGHT,
		}),
};

/**
 * A catalogue whose credential store could not be read.
 *
 * Every row's `connected` is then the listing's own default — "show everything
 * rather than claim the user owns no models" — so the list is grouped under one
 * heading and nothing is badged as signed in.
 */
export const CatalogueUnknownCredentials: Story = {
	render: () =>
		mount({
			state: "changed",
			catalogueMode: "unknown-credentials",
			script: MODEL_LIST,
		}),
};

/* ------------------------------------------------------------------ */
/* Arrival                                                            */
/* ------------------------------------------------------------------ */

/**
 * The first paint, no interaction: whatever the section decides to show before
 * the reader has done anything.
 *
 * This is the frame the operator's complaint is measured against ("an immensely
 * long scroll"), and the one the arrival targets are stated at.
 */
export const Arrival: Story = {
	render: () => mount(),
};

/** Every section open — the registry at its own length, advanced still held. */
export const AllExpanded: Story = {
	render: () => mount({ script: ALL_EXPANDED }),
};

/** Nothing open: the readable index of 19 section headers. */
export const Collapsed: Story = {
	render: () => mount({ script: COLLAPSED }),
};

/** One section open and the rest closed: a header's own geometry in frame. */
export const OneSectionOpen: Story = {
	render: () => mount({ state: "changed", script: ONE_SECTION }),
};

/* ------------------------------------------------------------------ */
/* Search                                                             */
/* ------------------------------------------------------------------ */

/**
 * A search that matches a handful of rows across several sections.
 *
 * Search suspends the reader's own collapse choices and force-opens the sections
 * it lands in; it also reports how many rows it found, in how many sections,
 * because a search that can hide its own matches behind a closed header is a
 * defect this surface shipped with.
 */
export const Filtered: Story = {
	render: () => mount({ script: FILTERED }),
};

/** A search that matches nothing, with the way out. */
export const NoResults: Story = {
	render: () => mount({ script: NO_RESULTS }),
};

/* ------------------------------------------------------------------ */
/* Changed rows                                                        */
/* ------------------------------------------------------------------ */

/**
 * Off-default rows: a changed dot, a `Use default`, and the Save an edit needs.
 *
 * The fixture is the registry's own projection of a configured install, so
 * `is_default` is the registry's judgement and not this file's.
 */
export const ChangedRows: Story = {
	render: () => mount({ state: "changed" }),
};

/* ------------------------------------------------------------------ */
/* Rows the section cannot edit                                        */
/* ------------------------------------------------------------------ */

/**
 * A redacted row and the retired ones.
 *
 * Both keep their wrapper, their label and their `data-setting-key`: they used
 * to return early without any of the three, which left four keys unfocusable,
 * unanchored by any deep link and unidentifiable — "Retired" read as three bare
 * numbers.
 */
export const ReadOnlyAndRedacted: Story = {
	render: () => mount({ state: "redacted", script: REDACTED }),
};

/* ------------------------------------------------------------------ */
/* Gated children                                                      */
/* ------------------------------------------------------------------ */

/**
 * Children of a feature that is switched off.
 *
 * `session.cleanup.enabled` is false in both committed fixtures, so the four
 * cleanup rows under it render disabled and say which switch they are waiting
 * on — rather than rendering enabled and saveable, which is how they shipped.
 */
export const GatedChildren: Story = {
	render: () => mount({ state: "changed", script: GATED }),
};

/* ------------------------------------------------------------------ */
/* The deep link                                                       */
/* ------------------------------------------------------------------ */

/**
 * `?setting=web_search.searxng_endpoint` — an advanced key inside a closed
 * section, which is the hardest arrival a deep link has to survive: the row does
 * not exist in the DOM until both the tier and the section are open, and the
 * reveal has to happen before the focus.
 */
export const DeepLink: Story = {
	render: () =>
		mount({ focusKey: "web_search.searxng_endpoint", script: DEEP_LINK }),
};

/* ------------------------------------------------------------------ */
/* The narrow column                                                   */
/* ------------------------------------------------------------------ */

/**
 * The column at the width where a row's label and its control stop fitting side
 * by side.
 *
 * The row keys on its COLUMN, not on the window: at a 1000px window the column
 * is 660px once the page's own rail sits beside it (the QA round measured it;
 * an earlier draft of the spec said 888px), so a window-width breakpoint would
 * never fire where it is needed.
 */
export const Narrow: Story = {
	render: () => mount({ state: "changed", script: ONE_SECTION }),
};

/* ------------------------------------------------------------------ */
/* The save model, and its two endings                                 */
/* ------------------------------------------------------------------ */

/**
 * A draft: `Save`, the row's changed dot, and the page-level unsaved counter.
 *
 * This is the half of this PR's claim — saving "stopped being silent" — that no
 * frame showed at all until now, and it is also the surface's densest row state
 * (two extra buttons in an off-default row's cluster).
 */
export const Dirty: Story = {
	render: () => mount({ state: "changed", script: DIRTY }),
};

/**
 * A write in flight.
 *
 * The transport never answers, so `Saving` is on screen rather than a caption:
 * the row's own button says it, and the bar's `Save all` would say it too.
 */
export const Saving: Story = {
	render: () => mount({ state: "changed", script: SAVING, mode: "hang" }),
};

/**
 * A refused write, with the draft kept.
 *
 * The server's own refusal, announced in a `role="alert"` beside the row it is
 * about, with `Retry` re-submitting what the reader typed rather than re-reading
 * the field.
 */
export const SaveFailed: Story = {
	render: () => mount({ state: "changed", script: SAVE_FAILED, mode: "fail" }),
};
