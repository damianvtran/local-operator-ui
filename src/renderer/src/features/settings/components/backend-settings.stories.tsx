/**
 * The Backend settings section, in the states a first visit, a search and a deep
 * link can put it in.
 *
 * Why this file exists. This is the largest surface in the app - 99 registry
 * rows in 18 sections - and until now it had NO story, NO fixture and NO
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
 */

import type { BackendSettings } from "@shared/api/local-operator/desktop-api";
import type { Meta, StoryObj } from "@storybook/react";
import type { FC } from "react";
import { useLayoutEffect } from "react";
import configuredJson from "../../../../../../scripts/fixtures/backend-settings-registry-configured.json";
import fixtureJson from "../../../../../../scripts/fixtures/backend-settings-registry.json";
import type { DesktopResponse } from "../../../../../shared/desktop-contract";
import { BackendSettingsSection } from "./backend-settings-section";

type Setting = BackendSettings["settings"][number];

/* --------------------------------------------------------------- bridge */

type BridgeRequest = { op: string; key?: string; value?: unknown };

/**
 * The desktop transport, stubbed.
 *
 * `desktopRequest` prefers `window.api.desktop.request` and falls back to
 * `fetch("/__desktop")`, which Storybook's dev server does not serve - so
 * without this every frame would photograph a transport error instead of the
 * section. It answers the four operations this surface issues and refuses
 * anything else BY NAME, so a story that starts issuing a fifth read fails
 * loudly rather than hanging on a promise nothing resolves.
 *
 * `settings.edit`/`settings.reset` mutate the live payload the way the backend
 * does (the value, then `is_default`), because a saved or reset row is a state
 * this surface has and one static fixture cannot be in two states at once.
 */
let bridge: ((request: BridgeRequest) => Promise<DesktopResponse>) | null =
	null;

const installBridge = (payload: BackendSettings) => {
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
			case "settings.edit": {
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
	expect: () =>
		/results? in \d+ sections?/.test(document.body.textContent ?? ""),
};

const NO_RESULTS: Script = {
	run: async () => {
		await typeSearch("zzzzzz");
	},
	expect: () =>
		/No settings match this search/.test(document.body.textContent ?? ""),
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
}: {
	state?: string;
	initialFilter?: string;
	focusKey?: string | null;
	script?: Script;
} = {}) => {
	installBridge(payloadFor(state));
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

/** Nothing open: the readable index of 18 section headers. */
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
 * is 888px, only 8px narrower than at 1380px, so a window-width breakpoint would
 * never fire where it is needed.
 */
export const Narrow: Story = {
	render: () => mount({ state: "changed", script: ONE_SECTION }),
};
