/**
 * The Backend settings section, in the states a first visit, a search and a deep
 * link can put it in.
 *
 * Why this file exists. This is the largest surface in the app — 99 registry
 * rows in 18 sections — and until now it had NO story, NO fixture and NO
 * committed frame anywhere in `docs/evidence/`. Every claim about it was a claim
 * about a surface nobody could look at, and the redesign that follows has to be
 * judged against the surface as it was.
 *
 * A story rather than a rig, because the one thing a browser cannot supply is
 * `window.api.desktop.request` — the preload bridge `desktop-api.desktopRequest`
 * prefers, and without which every frame would photograph a transport error. The
 * stub below is `mcp-management-section.stories.tsx`'s pattern (the four
 * operations this section issues, and a named refusal for anything else). The
 * section, its query, its search box and its controls are the PRODUCT's.
 *
 * The payload is not hand-written either. `scripts/fixtures/backend-settings-registry*.json`
 * is the real `/v1/settings` projection: `settings_io.py` serialized exactly as
 * `server/routes/settings.py::list_settings` does it, so a label, a help
 * sentence, an enum's choices or a `warning` clause that is wrong in a frame is
 * wrong in the registry. Two states are committed — a fresh install, and one
 * configured through the registry's own `write_setting` (which is why
 * `is_default` is the product's judgement of each row rather than a flag this
 * file sets).
 *
 * What the frames are evidence about, and their limit: they are pictures of the
 * RENDERER over a fixture shaped like the wire. Whether the real backend serves
 * that payload is QA's job against a running app, not a frame's.
 */

import type { BackendSettings } from "@shared/api/local-operator/desktop-api";
import type { Meta, StoryObj } from "@storybook/react";
import { screen, userEvent } from "@storybook/test";
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
 * `fetch("/__desktop")`, which Storybook's dev server does not serve — so
 * without this every frame would photograph a transport error instead of the
 * section. It answers the four operations this surface issues and refuses
 * anything else BY NAME, so a story that starts issuing a fifth read fails
 * loudly rather than hanging on a promise nothing resolves.
 *
 * `settings.edit`/`settings.reset` mutate the live payload the way the backend
 * does (the value, then `is_default`), because a "saved" or "reset" row is a
 * state this surface has and no static fixture can be in two states at once.
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
 * a layout the product never renders — and the section's stacked fallback keys
 * on the COLUMN, not the window, so the width is the variable under test in the
 * narrow story.
 */
const Ground = ({
	initialFilter,
	focusKey,
}: {
	initialFilter?: string;
	focusKey?: string | null;
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

/**
 * Install the bridge and mount the ground.
 *
 * Called from each story's `render`, which runs for the story being previewed
 * and not for its siblings — the payload is installed before the mount and
 * before React Query's first fetch.
 */
const mount = ({
	state = "fresh",
	initialFilter,
	focusKey,
}: {
	state?: string;
	initialFilter?: string;
	focusKey?: string | null;
} = {}) => {
	const payload = payloadFor(state);
	installBridge(payload);
	return <Ground initialFilter={initialFilter} focusKey={focusKey} />;
};

/* ------------------------------------------------------------------ plays */

/**
 * Every state below is driven through the section headers themselves rather than
 * through the filter bar's expand/collapse controls, because that is the one
 * handle the pre-redesign surface and the redesigned one both have: the chips are
 * what the redesigned bar ADDS, and a play that depended on them would photograph
 * an error on the surface the before-frames come from.
 */

/**
 * A button whose visible text starts with `text`.
 *
 * Text rather than an accessible name, because a section header's name is a row
 * of marks (title, count, scope, changed dot) whose exact spelling is the
 * redesign's to choose — while the title it starts with is the registry's.
 */
const buttonStartingWith = (text: string) =>
	screen
		.queryAllByRole("button")
		.find((button) => (button.textContent ?? "").trim().startsWith(text));

/** A button whose visible text contains `text`, case-insensitively. */
const buttonContaining = (text: string) =>
	screen
		.queryAllByRole("button")
		.find((button) =>
			(button.textContent ?? "").toLowerCase().includes(text.toLowerCase()),
		);

/** Open every closed section, the way `Expand all` does it. */
const expandAll = async () => {
	const sections = await screen.findAllByRole("button", { expanded: false });
	for (const header of sections) await userEvent.click(header);
};

/** Close every open section. */
const collapseAll = async () => {
	const sections = await screen.findAllByRole("button", { expanded: true });
	for (const header of sections) await userEvent.click(header);
};

/**
 * Turn on the advanced tier, when the surface has one to turn on.
 *
 * The pre-redesign surface has no such control, and `buttonContaining` finding
 * nothing is how this stays a no-op there instead of throwing inside a play
 * (which would leave a frame of a Storybook error rather than of the section).
 */
const toggleShowAdvanced = async () => {
	const chip = buttonContaining("advanced");
	if (chip) await userEvent.click(chip);
};

/**
 * Reveal the advanced tier and open one section by its title.
 *
 * Both steps are conditional, which is what keeps one story valid on both
 * surfaces: pre-redesign there is no advanced tier, and every section already
 * open.
 */
const openSection = async (title: string) => {
	await toggleShowAdvanced();
	const header = buttonStartingWith(title);
	if (header && header.getAttribute("aria-expanded") === "false") {
		await userEvent.click(header);
	}
};

/** The result count the search bar reports, and the empty-state sentence. */
const RESULT_COUNT = /result/i;
const NO_MATCH = /no settings match/i;

const typeSearch = async (text: string) => {
	const input = await screen.findByLabelText("Search settings");
	await userEvent.type(input, text);
};

const meta: Meta = {
	title: "Settings/Backend",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/* ------------------------------------------------------------------ */
/* Arrival                                                             */
/* ------------------------------------------------------------------ */

/**
 * The first paint, no interaction: whatever the section decides to show before
 * the user has done anything.
 *
 * This is the frame the operator's complaint is measured against ("an immensely
 * long scroll"), and the one the region-height target is stated at.
 */
export const Arrival: Story = {
	render: () => mount(),
};

/** Every section open — the whole registry at once, which is the long scroll. */
export const AllExpanded: Story = {
	render: () => mount(),
	play: async () => {
		await expandAll();
	},
};

/** Nothing open: the readable index of 18 section headers. */
export const Collapsed: Story = {
	render: () => mount(),
	play: async () => {
		await collapseAll();
	},
};

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

/**
 * A search that matches a handful of rows across several sections.
 *
 * Search suspends the reader's own collapse choices and force-opens the
 * sections it lands in; it also reports how many rows it found, in how many
 * sections, because a search that can hide its own matches behind a closed
 * header is a defect this surface shipped with.
 */
export const Filtered: Story = {
	render: () => mount(),
	play: async () => {
		await typeSearch("cache");
		await screen.findByText(RESULT_COUNT);
	},
};

/** A search that matches nothing, with the way out. */
export const NoResults: Story = {
	render: () => mount(),
	play: async () => {
		await typeSearch("zzzzzz");
		await screen.findByText(NO_MATCH);
	},
};

/* ------------------------------------------------------------------ */
/* Changed rows                                                        */
/* ------------------------------------------------------------------ */

/**
 * Off-default rows: a changed dot, a `Use default`, and the Save the draft
 * needs. The fixture is the registry's own projection of a configured install,
 * so `is_default` is the registry's judgement, not this file's.
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
 * to return early, which left four keys unfocusable, unanchored by any deep
 * link and unidentifiable — "Retired" read as three bare numbers.
 */
export const ReadOnlyAndRedacted: Story = {
	render: () => mount({ state: "redacted" }),
	play: async () => {
		await openSection("Web search");
	},
};

/* ------------------------------------------------------------------ */
/* Gated children                                                      */
/* ------------------------------------------------------------------ */

/**
 * A child of a feature that is switched off.
 *
 * `session.cleanup.enabled` is false in both committed fixtures, so the four
 * cleanup rows under it render disabled and say which switch they are waiting
 * on — rather than rendering enabled and saveable, which is how they shipped.
 */
export const GatedChildren: Story = {
	render: () => mount({ state: "changed" }),
	play: async () => {
		await openSection("Session storage");
	},
};

/* ------------------------------------------------------------------ */
/* The deep link                                                       */
/* ------------------------------------------------------------------ */

/**
 * `?setting=web_search.searxng_endpoint` — an advanced, redacted key, which is
 * the hardest arrival a deep link has to survive: the row does not exist in the
 * DOM until both the tier and the section are open, and the reveal has to
 * happen before the focus.
 */
export const DeepLink: Story = {
	render: () => mount({ focusKey: "web_search.searxng_endpoint" }),
};

/* ------------------------------------------------------------------ */
/* The narrow column                                                   */
/* ------------------------------------------------------------------ */

/**
 * The column at the width where a row's control and its label stop fitting
 * side by side.
 *
 * The section keys on the COLUMN, not the window: at a 1000px window the column
 * is 888px, only 8px narrower than at 1380px, so a window-width breakpoint would
 * never fire where it is needed.
 */
export const Narrow: Story = {
	render: () => mount({ state: "changed" }),
	play: async () => {
		await expandAll();
	},
};

/* ------------------------------------------------------------------ */
/* A section, alone                                                    */
/* ------------------------------------------------------------------ */

/**
 * One section open and the rest closed, with a heading's own geometry in frame:
 * the chevron, the title, the row count, the scope and the changed dot.
 *
 * `within` is used deliberately — the assertion is about the section box, so a
 * mark that leaked to another header would not satisfy it.
 */
export const OneSectionOpen: Story = {
	render: () => mount({ state: "changed" }),
	play: async () => {
		await collapseAll();
		const header = buttonStartingWith("Model");
		if (!header) throw new Error("no Model header rendered");
		await userEvent.click(header);
	},
};
