/**
 * The New chat header's agent/team chip (operator request, 2026-11-11: "make it
 * so that new chat also allows for the selection of agent/team").
 *
 * Three layers, each pinned through the code the app runs:
 *
 *  - the pure rules (`chat-header-draft-target-model.ts`): when the chip shows,
 *    what it lists, what a pick does;
 *  - the store: a pick restages the draft (default included) carrying the
 *    composer's text, and the first send's `sessions.create` carries the staged
 *    target - or none for the default agent;
 *  - the mounted chip (`chat-header-draft-target.tsx`): its label names the
 *    staged target, its menu lists the rosters, and choosing a row restages the
 *    real store.
 */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const DOM = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/chat",
});
const globalise = (name, value) => {
	try {
		globalThis[name] = value;
	} catch {
		Object.defineProperty(globalThis, name, { value, configurable: true });
	}
};
for (const name of [
	"window",
	"document",
	"navigator",
	"localStorage",
	"HTMLElement",
	"HTMLInputElement",
	"HTMLButtonElement",
	"Element",
	"Node",
	"KeyboardEvent",
	"MouseEvent",
	"Event",
	"CustomEvent",
	"FocusEvent",
	"getComputedStyle",
	"MutationObserver",
]) {
	globalise(name, name === "window" ? DOM.window : DOM.window[name]);
}
globalise("PointerEvent", DOM.window.PointerEvent ?? DOM.window.MouseEvent);
globalise("IS_REACT_ACT_ENVIRONMENT", true);
globalise("requestAnimationFrame", (callback) => setTimeout(callback, 0));
globalise("cancelAnimationFrame", (handle) => clearTimeout(handle));
globalise("matchMedia", (query) => ({
	matches: false,
	media: String(query),
	onchange: null,
	addEventListener: () => {},
	removeEventListener: () => {},
	addListener: () => {},
	removeListener: () => {},
	dispatchEvent: () => false,
}));
globalise(
	"ResizeObserver",
	class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
);
DOM.window.Element.prototype.scrollTo = () => {};
DOM.window.Element.prototype.scrollIntoView = () => {};
DOM.window.Element.prototype.hasPointerCapture = () => false;
DOM.window.Element.prototype.releasePointerCapture = () => {};
after(() => {
	DOM.window.close();
});

const ROOT = process.cwd();
const CACHE = join(ROOT, "node_modules/.cache/draft-target-chip");
const ANY_MODULE = /.*/;
const BARE_DRAFT_KEY = /^draft:[0-9a-f-]{36}$/;
const TEAM_LABEL = /Local Operator Dev/;
const SEAM_NAMES =
	/^(@shared\/api\/local-operator\/desktop-api|@shared\/themes)$/;

const requests = [];
globalThis.__desktopResult = async (request) => {
	requests.push(request);
	if (request.op === "sessions.create")
		return {
			session_id: "abcdefabcdef",
			binding: { agent: null, team: null },
		};
	if (request.op === "profiles.list") return { profiles: PROFILES };
	if (request.op === "teams.list") return { teams: TEAMS };
	return {};
};

const stubs = {
	"@shared/api/local-operator/desktop-api": `
		export * from "${resolve("src/renderer/src/shared/api/local-operator/desktop-api.ts")}";
		export const desktopResult = (request) => globalThis.__desktopResult(request);
	`,
	"@shared/themes": `
		export const DEFAULT_THEME = "localOperatorDark";
		export const isThemeName = (id) => id === "localOperatorDark";
		export const themes = {};
	`,
};

const bundle = await build({
	stdin: {
		contents: `
			export * from "./src/renderer/src/features/chat/components/chat-header-draft-target-model";
			export { ChatHeaderDraftTarget } from "./src/renderer/src/features/chat/components/chat-header-draft-target";
			export { ChatHeader } from "./src/renderer/src/features/chat/components/chat-header";
			export { useCanonicalSessionsStore, admitChatDraft } from "./src/renderer/src/shared/store/canonical-sessions-store";
			export { useConversationInputStore } from "./src/renderer/src/shared/store/conversation-input-store";
			export { QueryClient, QueryClientProvider } from "@tanstack/react-query";
		`,
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	jsx: "automatic",
	// The header's graph reads `import.meta.env` at module load (the app
	// config); Node has none, so it is the empty object Vite would give a key
	// it does not define.
	define: { "import.meta.env": "{}" },
	loader: { ".css": "empty" },
	alias: {
		"@shared": resolve("src/renderer/src/shared"),
		"@features": resolve("src/renderer/src/features"),
		"@renderer": resolve("src/renderer/src"),
		"@mui/material/styles": "@mui/material/node/styles/index.js",
	},
	plugins: [
		{
			name: "draft-target-seams",
			setup(builder) {
				builder.onResolve({ filter: SEAM_NAMES }, (args) => ({
					path: args.path,
					namespace: "draft-target-seam",
				}));
				builder.onLoad(
					{ filter: ANY_MODULE, namespace: "draft-target-seam" },
					(args) => ({
						contents: stubs[args.path],
						loader: "js",
						resolveDir: ROOT,
					}),
				);
			},
		},
	],
	write: false,
});
mkdirSync(CACHE, { recursive: true });
const bundlePath = join(CACHE, `draft-target-${process.pid}.mjs`);
writeFileSync(bundlePath, bundle.outputFiles[0].text);

const {
	ChatHeader,
	ChatHeaderDraftTarget,
	QueryClient,
	QueryClientProvider,
	admitChatDraft,
	draftTargetChipClass,
	draftTargetChipShown,
	draftTargetGlyphClass,
	draftTargetIsCurrent,
	draftTargetLabel,
	draftTargetPick,
	draftTargetRoster,
	useCanonicalSessionsStore,
	useConversationInputStore,
} = await import(pathToFileURL(bundlePath).href);
const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");

const PROFILES = [
	{ name: "scout", kind: "role", source: "custom", description: "" },
	{ name: "reviewer", kind: "role", source: "installed", description: "" },
	{ name: "packaged", kind: "role", source: "builtin", description: "" },
];
const TEAMS = [
	{ id: "t1", name: "lopdev", label: "Local Operator Dev", manager: "manager" },
	{ id: "t2", name: "ops", manager: "lead" },
];
const CAPABILITIES = {
	desktop_available: true,
	features: { profile_catalogue: 1, team_catalogue: 1 },
};

const store = () => useCanonicalSessionsStore.getState();
const input = () => useConversationInputStore.getState();

function reset() {
	requests.length = 0;
	useCanonicalSessionsStore.setState({
		sessions: [],
		activeSessionId: null,
		activeDraftKey: null,
		drafts: {},
		validatingSessionId: null,
		error: null,
	});
	useConversationInputStore.setState({ inputByConversation: {} });
}

const SEND = {
	text: "Review this",
	attachments: [],
	images: [],
	mode: "prompt",
	cwd: "/tmp",
};

// ------------------------------------------------------------------ rules

test("the chip shows on a new chat only", () => {
	assert.equal(draftTargetChipShown({ draftKey: "draft:1" }), true);
	assert.equal(
		draftTargetChipShown({ sessionId: "abcdefabcdef", draftKey: null }),
		false,
		"a live session keeps its identity switchers instead",
	);
	assert.equal(
		draftTargetChipShown({
			draftKey: "draft:agent:scout",
			draftSessionId: "abcdefabcdef",
		}),
		false,
		"a draft whose create already answered is a conversation",
	);
	assert.equal(draftTargetChipShown({}), false, "no draft, no chip");
});

test("the roster drops packaged-not-installed agents and labels teams", () => {
	const roster = draftTargetRoster({ profiles: PROFILES, teams: TEAMS });
	assert.deepEqual(
		roster.agents.map((row) => row.name),
		["scout", "reviewer"],
	);
	assert.deepEqual(roster.teams, [
		{ kind: "team", name: "lopdev", label: "Local Operator Dev" },
		{ kind: "team", name: "ops", label: "ops" },
	]);
	assert.deepEqual(draftTargetRoster({}), { agents: [], teams: [] });
});

test("the label names the staged target, null for the default", () => {
	const lookup = (name) => (name === "lopdev" ? "Local Operator Dev" : name);
	assert.equal(draftTargetLabel(undefined, lookup), null);
	assert.equal(
		draftTargetLabel({ kind: "agent", name: "scout" }, lookup),
		"scout",
	);
	assert.equal(
		draftTargetLabel({ kind: "team", name: "lopdev" }, lookup),
		"Local Operator Dev",
	);
});

test("re-picking the staged row is a no-op; anything else restages", () => {
	const scout = { kind: "agent", name: "scout" };
	assert.equal(draftTargetIsCurrent(undefined, null), true);
	assert.equal(draftTargetIsCurrent(scout, scout), true);
	assert.equal(
		draftTargetIsCurrent(scout, { kind: "team", name: "scout" }),
		false,
	);
	assert.equal(
		draftTargetPick(undefined, null),
		null,
		"default twice mints nothing",
	);
	assert.equal(draftTargetPick(scout, scout), null);
	assert.deepEqual(draftTargetPick(undefined, scout), { target: scout });
	assert.deepEqual(draftTargetPick(scout, null), { target: undefined });
});

// ------------------------------------------------------------------ store + send

test("an agent pick carries the typed text and the send creates an agent-bound session", async () => {
	reset();
	const from = store().stageDraft(undefined, true);
	input().setComposerText(from, "half a thought");
	const key = store().restageDraft({ kind: "agent", name: "scout" });
	assert.equal(key, "draft:agent:scout");
	assert.equal(input().getCurrentInput(key), "half a thought", "text survives");
	assert.equal(input().getCurrentInput(from), "");
	await admitChatDraft(key, SEND);
	const create = requests.find((request) => request.op === "sessions.create");
	assert.deepEqual(create?.target, { kind: "agent", name: "scout" });
});

test("a team pick sends a team-bound create", async () => {
	reset();
	store().stageDraft(undefined, true);
	const key = store().restageDraft({ kind: "team", name: "lopdev" });
	await admitChatDraft(key, SEND);
	const create = requests.find((request) => request.op === "sessions.create");
	assert.deepEqual(create?.target, { kind: "team", name: "lopdev" });
});

test("choosing the default clears the target, keeps the text, and the create names none", async () => {
	reset();
	const from = store().stageDraft({ kind: "team", name: "lopdev" });
	input().setComposerText(from, "keep me");
	const key = store().restageDraft(undefined);
	assert.match(key, BARE_DRAFT_KEY, "a fresh bare draft");
	assert.equal(store().activeDraftKey, key);
	assert.equal(store().drafts[key]?.target, undefined);
	assert.equal(input().getCurrentInput(key), "keep me");
	assert.equal(input().getCurrentInput(from), "");
	await admitChatDraft(key, SEND);
	const create = requests.find((request) => request.op === "sessions.create");
	assert.ok(create, "the send created a session");
	assert.equal("target" in create, false, "a default create carries no target");
});

// ------------------------------------------------------------------ mounted chip

async function mount(target, extra = {}) {
	document.body.innerHTML = "";
	const client = new QueryClient({
		// `gcTime: Infinity` schedules no collection timer, so the test process
		// exits when its tests do instead of idling out react-query's 5 min gc.
		defaultOptions: {
			queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
		},
	});
	// The rosters as the sidebar's own reads leave them in the shared cache:
	// the chip's `useProfiles`/`useTeams` answer from these keys.
	client.setQueryData(["desktop", "profiles"], PROFILES);
	client.setQueryData(["desktop", "teams"], TEAMS);
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	const render = (props) =>
		root.render(
			React.createElement(
				QueryClientProvider,
				{ client },
				React.createElement(ChatHeaderDraftTarget, {
					capabilities: CAPABILITIES,
					...props,
				}),
			),
		);
	await act(async () => render({ target, ...extra }));
	await act(async () => new Promise((done) => setTimeout(done, 0)));
	return {
		chip: () => document.querySelector("[data-draft-target-chip]"),
		render: async (props) => {
			await act(async () => render(props));
			await act(async () => new Promise((done) => setTimeout(done, 0)));
		},
		unmount: async () => act(async () => root.unmount()),
	};
}

async function openMenu(chip) {
	await act(async () => {
		chip.focus();
		chip.dispatchEvent(
			new DOM.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
		);
	});
	await act(async () => new Promise((done) => setTimeout(done, 10)));
	return document.querySelector("[data-draft-target-menu]");
}

/*
 * Every mount tears down in `finally` (agent review round 1, NIT-1): a failed
 * assertion left the root mounted and the file ended SIGKILLed ~19 s later
 * instead of reporting which assertion broke.
 */
async function withMount(target, extra, body) {
	const view = await mount(target, extra);
	try {
		await body(view);
	} finally {
		await view.unmount();
	}
}

async function waitForRow(menu, id) {
	// The rosters load on the first open (lazy, like the project picker), so
	// the rows land a few ticks after the menu does.
	for (
		let tick = 0;
		tick < 50 && !menu.querySelector(`[data-draft-target-row="${id}"]`);
		tick += 1
	)
		await act(async () => new Promise((done) => setTimeout(done, 5)));
}

const rowIds = (menu) =>
	[...menu.querySelectorAll("[data-draft-target-row]")].map((row) =>
		row.getAttribute("data-draft-target-row"),
	);

const OPACITY = /(^|\s)([\w-]+:)*opacity-/;
const HOVER_GROUND = /(^|\s)hover:bg-/;
const MENU_HEIGHT_BOUND =
	/max-h-\[min\(26rem,var\(--radix-dropdown-menu-content-available-height\)\)\]/;
const INK_DISABLED = /\btext-ink-disabled\b/;
const HOVER_ROW = /hover:bg-row-hover/;
const OPEN_ELEVATED = /data-\[state=open\]:bg-elevated/;
const AGENTS_HEADING = /Agents/;
const MIN_H_5 = /\bmin-h-5\b/;
const WRAP_OR_CLIP = /flex-wrap|overflow-clip/;
const YIELDS = /\bmin-w-0\b.*\btruncate\b/;
const MIN_W_0 = /\bmin-w-0\b/;
const SHRINK_2 = /\bshrink-\[2\]/;
const TRUNCATE = /\btruncate\b/;
const SHRINK_0 = /\bshrink-0\b/;
const WRAP_AND_CLIP = /flex-wrap overflow-clip/;
const OVERFLOW_X_CLIP = /\boverflow-x-clip\b/;

test("the chip reads the default, opens the rosters, and a pick restages the store", async () => {
	reset();
	store().stageDraft(undefined, true);
	await withMount(undefined, {}, async (view) => {
		const chip = view.chip();
		assert.ok(chip, "the chip renders");
		assert.equal(chip.textContent.replace("\u200b", ""), "Default agent");
		assert.equal(
			chip.getAttribute("aria-label"),
			"Start this chat with Default agent. Choose an agent or team",
		);
		const menu = await openMenu(chip);
		assert.ok(menu, "Enter on the trigger opens the menu");
		await waitForRow(menu, "agent:reviewer");
		/*
		 * Default, then Teams, then Agents (UX round 1, U-2): with a real roster
		 * of agents, teams listed last sat below the menu's fold - and finding
		 * teams from New chat is the operator's request.
		 */
		assert.deepEqual(rowIds(menu), [
			"default",
			"team:lopdev",
			"team:ops",
			"agent:scout",
			"agent:reviewer",
		]);
		assert.ok(
			menu
				.querySelector('[data-draft-target-row="default"]')
				.hasAttribute("data-draft-target-current"),
			"the default row is marked current",
		);
		assert.match(menu.textContent, TEAM_LABEL, "teams by label");
		assert.equal(
			menu
				.querySelector('[data-draft-target-row="team:lopdev"]')
				.getAttribute("title"),
			"Local Operator Dev",
			"a truncated row keeps its full name one hover away (design D-2)",
		);
		/*
		 * The list is bounded by the room Radix found, not a fixed height alone
		 * (U-2): a short window scrolls inside the menu.
		 */
		assert.match(menu.className, MENU_HEIGHT_BOUND);
		await act(async () => {
			menu.querySelector('[data-draft-target-row="team:lopdev"]').click();
		});
		assert.deepEqual(store().drafts[store().activeDraftKey]?.target, {
			kind: "team",
			name: "lopdev",
		});
		await view.render({ target: { kind: "team", name: "lopdev" } });
		assert.equal(
			view.chip().textContent.replace("\u200b", ""),
			"Local Operator Dev",
			"a staged team reads by its label (the sidebar's 'New chat with <team>' arrives the same way)",
		);
	});
});

test("a busy chip does not open, and steps colour rather than opacity", async () => {
	reset();
	store().stageDraft(undefined, true);
	await withMount(undefined, { busy: true }, async (view) => {
		const chip = view.chip();
		assert.equal(chip.getAttribute("aria-disabled"), "true");
		/*
		 * Design round 1, D-1: "Disabled changes colour, never opacity". Every
		 * painted part of the busy chip takes `ink-disabled`, and no hover ground
		 * answers a pointer the chip will refuse.
		 */
		const classes = [chip, ...chip.querySelectorAll("svg")].map(
			(node) => node.getAttribute("class") ?? "",
		);
		for (const cls of classes) {
			assert.doesNotMatch(cls, OPACITY, `no opacity on a busy part: ${cls}`);
			assert.doesNotMatch(cls, HOVER_GROUND, `no hover ground: ${cls}`);
		}
		assert.match(classes[0], INK_DISABLED, "the label");
		assert.equal(classes.length, 3, "the glyph and the chevron");
		for (const cls of classes.slice(1)) assert.match(cls, INK_DISABLED);
		const menu = await openMenu(chip);
		assert.equal(menu, null);
	});
	/* A negative control: the pins fire on the class list this replaced. */
	assert.match("cursor-default opacity-60 hover:bg-transparent", OPACITY);
	assert.match("cursor-default opacity-60 hover:bg-transparent", HOVER_GROUND);
	/* And the idle chip keeps its grounds: open is the live chips' `elevated` (D-3). */
	assert.match(draftTargetChipClass(false), HOVER_ROW);
	assert.match(draftTargetChipClass(false), OPEN_ELEVATED);
	assert.doesNotMatch(draftTargetChipClass(false), OPACITY);
	assert.equal(draftTargetGlyphClass(false), "size-3 shrink-0 text-ink-dim");
});

test("a backend with only the team catalogue offers teams and no agents", async () => {
	reset();
	store().stageDraft(undefined, true);
	await withMount(
		undefined,
		{
			capabilities: {
				desktop_available: true,
				features: { team_catalogue: 1 },
			},
		},
		async (view) => {
			assert.ok(view.chip(), "one catalogue is enough for the chip");
			const menu = await openMenu(view.chip());
			assert.ok(menu);
			await waitForRow(menu, "team:ops");
			assert.deepEqual(rowIds(menu), ["default", "team:lopdev", "team:ops"]);
			assert.doesNotMatch(
				menu.textContent,
				AGENTS_HEADING,
				"no Agents section",
			);
		},
	);
});

test("a backend with neither catalogue renders no chip", async () => {
	reset();
	await withMount(
		undefined,
		{ capabilities: { desktop_available: true, features: {} } },
		async (view) => {
			assert.equal(view.chip(), null);
		},
	);
});

// ------------------------------------------------------------------ header row

/*
 * THE CHIPS STAY ON THE PAINTED LINE (UX round 1, U-1). A pick lengthens the
 * title to "New chat with <name>", and the draft row used to keep the title
 * block's `flex-wrap overflow-clip`: both chips folded onto the clipped second
 * line at 800-900px - unpainted, yet still in the Tab order. The row now takes
 * the live identity controls' no-wrap arm, so the title and the path truncate
 * and the chips (shrink-0) keep their room.
 *
 * Node has no layout engine, so this pins the class contract that decides the
 * geometry; the PR's 640/800/900 frames and their `elementFromPoint` reads are
 * the painted proof.
 */
const { renderToStaticMarkup } = await import("react-dom/server");
const { MemoryRouter } = await import("react-router-dom");

function headerRow(props) {
	const markup = renderToStaticMarkup(
		React.createElement(
			MemoryRouter,
			{ initialEntries: ["/chat"] },
			React.createElement(ChatHeader, {
				agentName: "New chat with Local Operator Dev",
				description: "/srv/work/local-operator-ui",
				deviceSlot: React.createElement("button", { "data-device-chip": "" }),
				...props,
			}),
		),
	);
	const host = document.createElement("div");
	host.innerHTML = markup;
	const device = host.querySelector("[data-device-chip]");
	assert.ok(device, "the device chip is drawn");
	return {
		row: device.parentElement,
		path: host.querySelector("[data-header-path]"),
		title: host.querySelector("[data-header-title]"),
	};
}

test("a staged draft's header row does not wrap its chips onto the clipped line", () => {
	const { row, path, title } = headerRow({
		draftTargetSlot: React.createElement("button", {
			"data-draft-target-chip": "team",
		}),
	});
	assert.ok(
		row.querySelector(":scope > [data-draft-target-chip]"),
		"both chips share the title row",
	);
	assert.match(row.className, MIN_H_5);
	assert.doesNotMatch(row.className, WRAP_OR_CLIP);
	assert.match(
		row.className,
		OVERFLOW_X_CLIP,
		"but it stops at its own edge, so a chip never paints over the action cluster",
	);
	assert.match(title.className, YIELDS, "the title yields");
	assert.match(path.className, MIN_W_0, "the path yields too");
	assert.match(path.className, SHRINK_2, "and first");
	assert.match(path.className, TRUNCATE);
	assert.doesNotMatch(path.className, SHRINK_0);
});

test("negative control: without the agent/team chip the row keeps its wrap-and-clip", () => {
	const { row, path } = headerRow({});
	assert.match(row.className, WRAP_AND_CLIP);
	assert.match(path.className, SHRINK_0, "the path folds away whole");
	assert.doesNotMatch(path.className, TRUNCATE);
});
