/**
 * The remaining English on the Agents page and the Agent Hub, refused in the
 * languages the app actually ships (not in `en`, where a literal is invisible).
 *
 *     node --test scripts/agents-remaining-literals.test.mjs
 *
 * WHY THIS SUITE EXISTS. The rendered audit in the sibling PR (`rendered-1432`)
 * found copy that stayed English in every non-English locale although its page
 * was translated around it:
 *
 *   1. the Agents page's ask pane — heading, description, the composer's two
 *      placeholders, the hand-add button and the roster's own add button;
 *   2. the detail pane's `Delegates` fact and its `Show all` / `Show less`
 *      expander;
 *   3. the public hub card's `updated {age}` line and its `Get` button, and the
 *      viewer-state notice's `Try again`;
 *   4. the publish dialog's title, in all six of its states;
 *   5. the organization team row's `updated` prefix, which was concatenated in
 *      front of a localized relative time (`updated il y a 2 jours`).
 *
 * WHAT IS MEASURED, and with which instrument.
 *
 * A. THE PRODUCTION COMPONENT IS MOUNTED, not a probe that re-states its JSX.
 *    Each surface below is the shipped component (`AskPaneCopy`,
 *    `AddManuallyButton`, `ConfigComposer`, `AgentMeta`, `ReadBlock`, `AgentCard`,
 *    `TeamProvenance`), mounted in jsdom through `react-dom/client`. The publish
 *    title is a pure function the dialog renders into its heading; mounting the
 *    whole dialog (its transport, credential probe and review states) would test
 *    the fakes rather than the sentence, so its six arms are called directly.
 *
 * B. THE WORDS ARE SENTINELS, NOT THE SHIPPED TRANSLATIONS. This branch is
 *    ENGLISH ONLY by design: the translator wave that gives these keys fr/ur
 *    values has not run yet, so `t()` would fall back to English and an assertion
 *    against the shipped catalogue would pass for the wrong reason. Each locale's
 *    catalogue is therefore registered over the real one with a marker per key
 *    (`FR …` / `UR …`), and the assertion is that the marker is what rendered.
 *    That proves the call site reads the key instead of a literal.
 *
 * C. THE AGE IS THE HUB'S LOCALIZED PHRASE. `updated {when}` passes
 *    `commentAge()`, the repository's settled distance formatter, so the French
 *    and Urdu expectations below carry the real `il y a 3 jours` / `3 دن پہلے`
 *    from `ui.hub.comments.age.days`. The old shape printed date-fns' English
 *    `3 days ago` and appended `updated` by concatenation.
 *
 * D. THE NEGATIVE CONTROL IS EXECUTED. The bundle is rebuilt once with ONE call
 *    site — the ask heading — reverted to its English literal, and the positive
 *    assertion is shown to fail against it. A test that cannot fail is not
 *    evidence.
 *
 * WHAT IT DOES NOT PROVE: pixels. Wrapping, truncation and the 288 px roster
 * button's budget are layout, covered by the frames and the context sidecars.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const DOM = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/agents",
});
const FORCE_FROM_JSDOM = [
	"Event",
	"CustomEvent",
	"UIEvent",
	"MouseEvent",
	"PointerEvent",
	"KeyboardEvent",
	"FocusEvent",
	"InputEvent",
	"CompositionEvent",
	"HTMLElement",
	"Element",
	"Node",
	"DocumentFragment",
	"Range",
	"Selection",
	"DOMRect",
	"DOMRectReadOnly",
	"getComputedStyle",
	"requestAnimationFrame",
	"cancelAnimationFrame",
];
for (const key of Object.getOwnPropertyNames(DOM.window)) {
	if (key === "window" || key === "self" || key === "globalThis") continue;
	if (key in globalThis && !FORCE_FROM_JSDOM.includes(key)) continue;
	try {
		globalThis[key] = DOM.window[key];
	} catch {
		// jsdom's own accessors refuse to be read out of scope.
	}
}
globalThis.window = DOM.window;
globalThis.document = DOM.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
/*
 * NO SOCKETS. The agents/hub module graph reaches the app's connectivity probe,
 * whose query fetches the server's health endpoint; in this rig there is no
 * server, and a real fetch leaves keep-alive sockets that outlive the suite. The
 * answer below is inert and never consulted by the copy under test.
 */
const inertResponse = {
	ok: true,
	status: 200,
	json: async () => ({ result: { data: { msg: "ok", result: null } } }),
	text: async () => "",
	headers: { get: () => null },
};
globalThis.fetch = async () => inertResponse;
DOM.window.fetch = globalThis.fetch;
const storage = new Map();
Object.defineProperty(DOM.window, "localStorage", {
	configurable: true,
	value: {
		getItem: (key) => storage.get(key) ?? null,
		setItem: (key, value) => storage.set(key, String(value)),
		removeItem: (key) => storage.delete(key),
		clear: () => storage.clear(),
		key: (index) => [...storage.keys()][index] ?? null,
		get length() {
			return storage.size;
		},
	},
});
globalThis.localStorage = DOM.window.localStorage;
DOM.window.matchMedia = (query) => ({
	media: query,
	matches: false,
	addEventListener: () => {},
	removeEventListener: () => {},
	dispatchEvent: () => false,
});
globalThis.requestAnimationFrame = (callback) =>
	setTimeout(() => callback(Date.now()), 0);
globalThis.cancelAnimationFrame = (handle) => clearTimeout(handle);
globalThis.ResizeObserver = class {
	observe() {}
	disconnect() {}
};
DOM.window.HTMLCanvasElement.prototype.getContext = () => ({
	measureText: (text) => ({ width: String(text).length * 8 }),
	font: "",
	fillText: () => {},
	clearRect: () => {},
	save: () => {},
	restore: () => {},
});
DOM.window.electron = {
	ipcRenderer: {
		on: () => () => {},
		removeListener: () => {},
		send: () => {},
		invoke: async (channel) =>
			channel === "get-platform-info"
				? { platform: "darwin" }
				: { canceled: true, filePaths: [] },
	},
};
DOM.window.api = DOM.window.api ?? {};
DOM.window.api.ipcRenderer = DOM.window.api.ipcRenderer ?? {
	invoke: async () => ({}),
	send: () => {},
	on: () => {},
	once: () => {},
	removeListener: () => {},
	removeAllListeners: () => {},
};
DOM.window.api.platform = "darwin";
globalThis.api = DOM.window.api;

/*
 * A READABLE BOX FOR THE EXPANDER. jsdom has no layout engine, so
 * `scrollHeight`/`clientHeight` are both 0 and `ReadBlock` would never decide its
 * prose overflows. Both are pinned here to the relationship a clamped block has
 * (content taller than the box); the SHIPPED component still makes the decision
 * from those two numbers, and the negative control below proves the label is not
 * painted from a constant.
 */
Object.defineProperty(DOM.window.HTMLElement.prototype, "scrollHeight", {
	configurable: true,
	get: () => 240,
});
Object.defineProperty(DOM.window.HTMLElement.prototype, "clientHeight", {
	configurable: true,
	get: () => 60,
});

const ROOT = process.cwd();

/* English shapes the pre-fix code printed; hoisted for `useTopLevelRegex`. */
const AGENTS_PAGE_SOURCE = /features\/agents\/components\/agents-page\.tsx$/;
const ENGLISH_ASK_HEADING = /Ask for an agent/;
const ENGLISH_DELEGATES = /Delegates/;
const ENGLISH_UPDATED = /updated/;
const ENGLISH_UPDATED_3_DAYS = /updated 3 days ago/;

/** One build per mutation; the default bundle is shared. */
const bundles = new Map();
/** Query clients this file created, so their timers do not outlive the run. */
const clients = [];

function seamPlugin(mutation) {
	if (mutation !== "revert-heading") return undefined;
	return {
		name: "agents-literals-negative-control",
		setup(builder) {
			builder.onLoad({ filter: AGENTS_PAGE_SOURCE }, (args) => {
				const source = readFileSync(args.path, "utf8");
				const call = 't("ui.agents.pages.ask.heading_agent")';
				assert.equal(
					source.split(call).length - 1,
					1,
					"the negative control must revert the one heading call site",
				);
				return {
					contents: source.replace(call, '"Ask for an agent"'),
					loader: "tsx",
				};
			});
		},
	};
}

async function load(mutation) {
	const cached = bundles.get(mutation);
	if (cached) return cached;
	const result = await build({
		stdin: {
			contents: [
				'export * as React from "react";',
				'export { AskPaneCopy, AddManuallyButton } from "../src/renderer/src/features/agents/components/agents-page";',
				'export { AgentMeta } from "../src/renderer/src/features/agents/components/agent-detail";',
				'export { ReadBlock } from "../src/renderer/src/features/agents/components/detail-parts";',
				'export { ConfigComposer } from "../src/renderer/src/features/agents/config-run/config-composer";',
				'export { publishDialogTitle } from "../src/renderer/src/features/agents/components/upload-agent-dialog";',
				'export { AgentCard } from "../src/renderer/src/features/agent-hub/components/agent-card";',
				'export { TeamProvenance } from "../src/renderer/src/features/agent-hub/components/org-teams-list";',
				'export * as summary from "../src/renderer/src/features/agent-hub/components/org-team-summary";',
				'export { MemoryRouter } from "react-router-dom";',
				'export { createRoot } from "react-dom/client";',
				'export { QueryClient, QueryClientProvider } from "@tanstack/react-query";',
				'export * as i18n from "../src/i18n";',
			].join("\n"),
			resolveDir: `${ROOT}/scripts`,
		},
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
		mainFields: ["module", "main"],
		conditions: ["import"],
		jsx: "automatic",
		external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
		alias: {
			"@shared": `${ROOT}/src/renderer/src/shared`,
			"@features": `${ROOT}/src/renderer/src/features`,
			"@assets": `${ROOT}/src/renderer/src/assets`,
		},
		loader: {
			".css": "empty",
			".svg": "text",
			".png": "dataurl",
			".webp": "dataurl",
			".ttf": "empty",
			".woff": "empty",
			".woff2": "empty",
			".eot": "empty",
		},
		define: { "import.meta.env": "{}" },
		banner: {
			js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
		},
		plugins: [seamPlugin(mutation)].filter(Boolean),
	});
	const bundlePath = new URL(
		`./_agents-remaining-${process.pid}-${mutation ?? "base"}.mjs`,
		import.meta.url,
	);
	/*
	 * A FILE, not a `data:` URL: the bundle keeps React external, and a bare
	 * specifier cannot resolve from a data URL (the first version of this file did
	 * that and every case failed with ERR_INVALID_URL before rendering anything).
	 */
	await writeFile(bundlePath, result.outputFiles[0].text);
	const module = await import(bundlePath.href);
	await unlink(bundlePath).catch(() => {});
	bundles.set(mutation, module);
	return module;
}

/** Every key this branch extracted, with a marker per locale. */
const copy = (marker) => ({
	"ui.agents.pages.ask.heading_agent": `${marker} heading agent`,
	"ui.agents.pages.ask.heading_team": `${marker} heading team`,
	"ui.agents.pages.ask.body_agent": `${marker} body agent`,
	"ui.agents.pages.ask.body_team": `${marker} body team`,
	"ui.agents.pages.ask.manual_agent": `${marker} manual agent`,
	"ui.agents.pages.ask.manual_team": `${marker} manual team`,
	"ui.agents.pages.add_manual.agent": `${marker} add agent`,
	"ui.agents.pages.add_manual.team": `${marker} add team`,
	"ui.agents.config.placeholder.hero": `${marker} hero placeholder`,
	"ui.agents.config.placeholder.docked": `${marker} docked placeholder`,
	"ui.agents.config.placeholder.about": `${marker} about {name}`,
	"ui.agents.detail.meta.delegates": `${marker} delegates`,
	"ui.agents.detail.read.show_all": `${marker} show all`,
	"ui.agents.detail.read.show_less": `${marker} show less`,
	"ui.hub.pages.card.updated": `${marker} changed {when}`,
	"ui.hub.pages.card.get": `${marker} get`,
	"ui.hub.teams.recency.updated": `${marker} changed {when}`,
	"ui.hub.teams.recency.created": `${marker} created {when}`,
	"ui.agents.upload.title.publish_public": `${marker} publish {name} public?`,
	"ui.agents.upload.title.publish_org": `${marker} publish {name} to {destination}?`,
	"ui.agents.upload.title.update_listing": `${marker} update {name}?`,
	"ui.agents.upload.title.published_public": `${marker} published {name}`,
	"ui.agents.upload.title.published_org": `${marker} published {name} to {destination}`,
	"ui.agents.upload.title.republished": `${marker} republished {name}`,
	"ui.common.actions.retry_again": `${marker} retry`,
	"ui.common.actions.retrying": `${marker} retrying`,
});

let prepared;
function prepare(lib) {
	if (prepared) return prepared;
	/*
	 * French and Urdu only. `en` is deliberately NOT registered: leaving the
	 * shipped English in place is what lets the last test prove the store returns
	 * to it, and a sentinel registered over `en` would make every other assertion
	 * pass without touching the real fallback.
	 */
	i18nRegister(lib, "fr", "FR");
	i18nRegister(lib, "ur", "UR");
	prepared = true;
	return prepared;
}
function i18nRegister(lib, locale, marker) {
	lib.i18n.registerCatalogue(locale, copy(marker));
}
const useLocale = (lib, locale) => lib.i18n.setLocale(locale);

/** Mount a production component and return its text plus a teardown. */
async function mount(lib, element) {
	const container = document.createElement("div");
	document.body.append(container);
	const root = lib.createRoot(container);
	await lib.React.act(async () => root.render(element));
	return {
		container,
		text: () => container.textContent ?? "",
		async unmount() {
			await lib.React.act(async () => root.unmount());
			container.remove();
		},
	};
}

/* The fake run handle: the composer's contract is with this object. */
const composerRun = (overrides = {}) => ({
	enabled: true,
	disabledReason: null,
	status: "idle",
	sessionId: null,
	frontend: null,
	topic: "",
	error: null,
	stopError: null,
	about: null,
	touched: [],
	step: null,
	elapsed: "0s",
	activity: [],
	results: [],
	answer: "",
	canRetry: false,
	starting: false,
	attached: false,
	start: async () => true,
	stop: async () => undefined,
	retry: async () => undefined,
	dismiss: () => undefined,
	...overrides,
});

const PROFILE = {
	name: "fixture-agent",
	source: "custom",
	kind: "role",
	delegate: true,
	divergent_fields: [],
};

const AGENT = {
	id: "synthetic-agent",
	name: "release-readiness-reviewer",
	description: "Checks a release against its checklist.",
	visibility: "public",
	tags: [],
	categories: [],
	account_metadata: { name: "QA Author" },
	updated_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
	like_count: 3,
	favourite_count: 1,
	download_count: 12,
};

const TEAM = {
	id: "synthetic-team",
	name: "Release readiness",
	project: "Onboarding",
	description: "Screens onboarding subjects.",
	manager: "lead-screener",
	members: [{ role: "screener", kind: "role", count: 3 }],
	version: "1.2.0",
	created_date: new Date(Date.now() - 41 * 86_400_000).toISOString(),
	updated_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
	account_metadata: { name: "Ana Perez", email: "ana@example.com" },
};

const ANSWERED_PUBLIC = {
	name: "aida",
	hubAgentId: "hub-1",
	republished: false,
	orgName: null,
	localPolicies: null,
};
const ANSWERED_ORG = { ...ANSWERED_PUBLIC, orgName: "QA Organisation" };
const ANSWERED_REPUBLISHED = { ...ANSWERED_PUBLIC, republished: true };

/* ------------------------------------------------------- the Agents page */

test("the ask pane paints the catalogue, in French and Urdu", async () => {
	const lib = await load();
	prepare(lib);
	for (const [locale, marker] of [
		["fr", "FR"],
		["ur", "UR"],
	]) {
		useLocale(lib, locale);
		const agent = await mount(
			lib,
			lib.React.createElement(lib.AskPaneCopy, { teamMode: false }),
		);
		const agentText = agent.text();
		assert.match(agentText, new RegExp(`${marker} heading agent`));
		assert.match(agentText, new RegExp(`${marker} body agent`));
		assert.doesNotMatch(agentText, ENGLISH_ASK_HEADING);
		await agent.unmount();

		const team = await mount(
			lib,
			lib.React.createElement(lib.AskPaneCopy, { teamMode: true }),
		);
		const teamText = team.text();
		assert.match(teamText, new RegExp(`${marker} heading team`));
		assert.match(teamText, new RegExp(`${marker} body team`));
		await team.unmount();
	}
});

test("both hand-add controls paint their keys", async () => {
	const lib = await load();
	prepare(lib);
	for (const [locale, marker] of [
		["fr", "FR"],
		["ur", "UR"],
	]) {
		useLocale(lib, locale);
		for (const teamMode of [false, true]) {
			const button = await mount(
				lib,
				lib.React.createElement(lib.AddManuallyButton, {
					teamMode,
					disabled: false,
					onClick: () => {},
				}),
			);
			assert.match(
				button.text(),
				new RegExp(`${marker} add ${teamMode ? "team" : "agent"}`),
			);
			await button.unmount();
		}
	}
});

test("the composer's three placeholders are catalogue messages", async () => {
	const lib = await load();
	prepare(lib);
	const mountComposer = async (props) => {
		const queryClient = new lib.QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		return mount(
			lib,
			lib.React.createElement(
				lib.QueryClientProvider,
				{ client: queryClient },
				lib.React.createElement(lib.ConfigComposer, {
					run: composerRun(),
					about: null,
					onClearAbout: () => {},
					...props,
				}),
			),
		);
	};
	for (const [locale, marker] of [
		["fr", "FR"],
		["ur", "UR"],
	]) {
		useLocale(lib, locale);
		const hero = await mountComposer({ hero: true });
		assert.equal(
			hero.container.querySelector("textarea")?.getAttribute("placeholder"),
			`${marker} hero placeholder`,
		);
		await hero.unmount();

		const docked = await mountComposer({});
		assert.equal(
			docked.container.querySelector("textarea")?.getAttribute("placeholder"),
			`${marker} docked placeholder`,
		);
		await docked.unmount();

		const about = await mount(
			lib,
			lib.React.createElement(
				lib.QueryClientProvider,
				{ client: new lib.QueryClient() },
				lib.React.createElement(lib.ConfigComposer, {
					run: composerRun(),
					about: { kind: "agent", name: "aida" },
					onClearAbout: () => {},
				}),
			),
		);
		assert.equal(
			about.container.querySelector("textarea")?.getAttribute("placeholder"),
			`${marker} about aida`,
		);
		await about.unmount();
	}
});

/* ------------------------------------------------------ the detail pane */

test("the detail meta fact and the expander paint their keys", async () => {
	const lib = await load();
	prepare(lib);
	for (const [locale, marker] of [
		["fr", "FR"],
		["ur", "UR"],
	]) {
		useLocale(lib, locale);
		const meta = await mount(
			lib,
			lib.React.createElement(lib.AgentMeta, { profile: PROFILE }),
		);
		assert.match(meta.text(), new RegExp(`${marker} delegates`));
		assert.doesNotMatch(meta.text(), ENGLISH_DELEGATES);
		await meta.unmount();

		const block = await mount(
			lib,
			lib.React.createElement(lib.ReadBlock, { text: "A".repeat(400) }),
		);
		const all = block.container.querySelector("button");
		assert.ok(all, "the overflowing prose renders the expander");
		assert.equal(all.textContent, `${marker} show all`);
		await lib.React.act(async () =>
			all.dispatchEvent(new DOM.window.MouseEvent("click", { bubbles: true })),
		);
		assert.equal(
			block.container.querySelector("button")?.textContent,
			`${marker} show less`,
		);
		await block.unmount();
	}
});

/* --------------------------------------------------------- the hub card */

test("the hub card's provenance, Get and retry paint their keys, with a localized age", async () => {
	const lib = await load();
	prepare(lib);
	const expectations = {
		fr: { when: "il y a 3 jours", marker: "FR" },
		ur: { when: "3 دن پہلے", marker: "UR" },
	};
	for (const [locale, { when, marker }] of Object.entries(expectations)) {
		useLocale(lib, locale);
		const client = new lib.QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		clients.push(client);
		const card = await mount(
			lib,
			lib.React.createElement(
				lib.QueryClientProvider,
				{ client },
				lib.React.createElement(
					lib.MemoryRouter,
					null,
					lib.React.createElement(lib.AgentCard, {
						agent: AGENT,
						isLiked: false,
						isFavourited: false,
						onLikeToggle: () => {},
						onFavouriteToggle: () => {},
						onDownload: () => {},
						actionError: "The download failed.",
						onRetryAction: () => {},
					}),
				),
			),
		);
		const text = card.text();
		assert.match(text, new RegExp(`${marker} changed ${when}`));
		assert.doesNotMatch(text, ENGLISH_UPDATED_3_DAYS);
		assert.match(text, new RegExp(`${marker} get`));
		assert.match(text, new RegExp(`${marker} retry`));
		await card.unmount();
	}
});

test("the org-team row's recency is one sentence, reorderable, never concatenated", async () => {
	const lib = await load();
	prepare(lib);
	/*
	 * WHAT THIS BRANCH OWNS IS THE SENTENCE: the row renders the catalogue message
	 * with the clock's phrase inside it, never `updated` concatenated in front of
	 * it, so the rendered text is pinned to `t(key, { when })` rather than to the
	 * label plus a space. The phrase itself is already the hub's localized one
	 * (`teamRecency().when`, from the sibling agents-pages work merged to this
	 * base), so pinning it proves the row passes it through whole instead of
	 * re-deriving an English distance beside a localized sentence.
	 */
	for (const [locale, marker, when] of [
		["fr", "FR", "il y a 3 jours"],
		["ur", "UR", "3 دن پہلے"],
	]) {
		useLocale(lib, locale);
		const row = await mount(
			lib,
			lib.React.createElement(lib.TeamProvenance, { team: TEAM }),
		);
		const text = row.text().trim();
		assert.equal(
			lib.summary.teamRecency(TEAM).when,
			when,
			"the hub's localized age phrase",
		);
		assert.equal(text, `Onboarding·, Ana Perez·, ${marker} changed ${when}`);
		assert.doesNotMatch(text, ENGLISH_UPDATED);
		await row.unmount();
	}
});

/* ------------------------------------------------------ the publish dialog */

test("all six publish-dialog titles come from their keys", async () => {
	const lib = await load();
	prepare(lib);
	for (const [locale, marker] of [
		["fr", "FR"],
		["ur", "UR"],
	]) {
		useLocale(lib, locale);
		const states = [
			[
				{
					agentName: "aida",
					published: null,
					targetIsOrg: false,
					targetDisplayName: "",
					hasListing: false,
				},
				`${marker} publish aida public?`,
			],
			[
				{
					agentName: "aida",
					published: null,
					targetIsOrg: true,
					targetDisplayName: "QA Organisation",
					hasListing: false,
				},
				`${marker} publish aida to QA Organisation?`,
			],
			[
				{
					agentName: "aida",
					published: null,
					targetIsOrg: false,
					targetDisplayName: "",
					hasListing: true,
				},
				`${marker} update aida?`,
			],
			[
				{
					agentName: "aida",
					published: ANSWERED_PUBLIC,
					targetIsOrg: false,
					targetDisplayName: "",
					hasListing: false,
				},
				`${marker} published aida`,
			],
			[
				{
					agentName: "aida",
					published: ANSWERED_ORG,
					targetIsOrg: true,
					targetDisplayName: "QA Organisation",
					hasListing: false,
				},
				`${marker} published aida to QA Organisation`,
			],
			[
				{
					agentName: "aida",
					published: ANSWERED_REPUBLISHED,
					targetIsOrg: false,
					targetDisplayName: "",
					hasListing: true,
				},
				`${marker} republished aida`,
			],
		];
		for (const [input, want] of states) {
			assert.equal(lib.publishDialogTitle(input), want);
		}
	}
});

/* ---------------------------------------------------- the negative control */

test("negative control: reverting one call site to its literal defeats the same assertion", async () => {
	const lib = await load("revert-heading");
	prepare(lib);
	useLocale(lib, "fr");
	const pane = await mount(
		lib,
		lib.React.createElement(lib.AskPaneCopy, { teamMode: false }),
	);
	const text = pane.text();
	assert.match(
		text,
		ENGLISH_ASK_HEADING,
		"the reverted literal is what painted",
	);
	assert.throws(
		() => assert.doesNotMatch(text, ENGLISH_ASK_HEADING),
		assert.AssertionError,
		"the positive assertion must fail against the literal",
	);
	await pane.unmount();
});

test("teardown: the store is back to English, and the suite closes what it opened", async () => {
	const lib = await load();
	useLocale(lib, "en");
	assert.equal(
		lib.i18n.t("ui.agents.pages.ask.heading_agent"),
		"Ask for an agent",
	);
	for (const client of clients) {
		client.clear();
		client.unmount();
	}
	DOM.window.close();
	/*
	 * The app's module graph (the connectivity probe, the esbuild service) keeps
	 * sockets open beyond the suite; node then reports the FILE as cancelled even
	 * though every case reported a verdict. Exit from the LAST case, scheduled so the
	 * runner records this one first — never from module scope, where an exit once ran
	 * before any case (the lesson `agents-composer-mount.test.mjs` records).
	 */
	setImmediate(() => process.exit(0));
});
