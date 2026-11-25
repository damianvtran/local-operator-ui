import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

/*
 * The approval card and the composer's approvals picker read ONE live mode
 * (design round 1, D1 / QA Q1; agent review M1). Mounted for real in jsdom with
 * the shipped `ApprovalEscape` and `ApprovalModePicker` under one QueryClient,
 * against a stubbed desktop route whose `approvals` entity row the test moves.
 * Pinned: opening the picker sends nothing (operator report 2026-11-25: a press
 * used to switch the mode outright), each row takes its own route, a picker
 * choice flips the card's mode line and links, a refused choice says why inside
 * the popover, and an unknown mode still renders the trigger.
 *
 * Rig trimmed from `approvals-slash-pick.test.mjs` (globals before the bundle
 * import, because stores read `localStorage` at module scope).
 */
const dom = new JSDOM("<!doctype html><div id='root'></div>", {
	url: "http://localhost/",
});
const { window } = dom;
const realSetTimeout = globalThis.setTimeout;
for (const [key, value] of Object.entries({
	window,
	document: window.document,
	localStorage: window.localStorage,
	sessionStorage: window.sessionStorage,
	HTMLElement: window.HTMLElement,
	HTMLButtonElement: window.HTMLButtonElement,
	Element: window.Element,
	Node: window.Node,
	Event: window.Event,
	MouseEvent: window.MouseEvent,
	getComputedStyle: window.getComputedStyle.bind(window),
	IS_REACT_ACT_ENVIRONMENT: true,
	MutationObserver: window.MutationObserver,
	// Radix's popper measures its anchor; jsdom has no layout, so a no-op
	// observer is the whole contract it needs here.
	ResizeObserver: class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
	DOMRect: window.DOMRect,
	// Radix dispatches its own focus/dismiss events on the document; they must be
	// jsdom's classes, not Node's globals.
	CustomEvent: window.CustomEvent,
	KeyboardEvent: window.KeyboardEvent,
	FocusEvent: window.FocusEvent,
	requestAnimationFrame: (callback) => realSetTimeout(() => callback(0), 0),
	cancelAnimationFrame: (id) => clearTimeout(id),
})) {
	Object.defineProperty(globalThis, key, {
		configurable: true,
		writable: true,
		value,
	});
}
/*
 * `:modal` IS A JSDOM LANDMINE (same fix as `browser-approvals-route.test.mjs`):
 * floating-ui's top-layer probe calls `matches(":modal")`, which jsdom 26.1.0
 * answers by recursing through its own selector engine (measured here: ~20 s of
 * CPU per popover open). A browser without `:modal` throws a SyntaxError, which
 * floating-ui's own try/catch is written for, so the probe answers that way.
 */
const nativeMatches = window.Element.prototype.matches;
window.Element.prototype.matches = function matches(selector) {
	if (String(selector).includes(":modal")) {
		throw new window.DOMException(
			":modal is not supported here",
			"SyntaxError",
		);
	}
	return nativeMatches.call(this, selector);
};
window.Element.prototype.scrollIntoView = () => {};
window.matchMedia = (media) => ({
	matches: false,
	media,
	addListener() {},
	removeListener() {},
	addEventListener() {},
	removeEventListener() {},
});
window.electron = {
	ipcRenderer: {
		on: () => () => {},
		removeListener() {},
		send() {},
		invoke: async () => ({}),
	},
};

const SESSION = "abcdef123456";
const world = {
	mode: "ask",
	defaultMode: "ask",
	refuse: null,
	commands: [],
	edits: [],
	reads: 0,
};
const answer = (request) => {
	if (request.op === "commands.entities") {
		world.reads += 1;
		return {
			entities: [{ value: "auto" }, { value: "ask" }],
			current: world.mode,
		};
	}
	if (request.op === "settings.list")
		return {
			settings: [{ key: "tool_approval_mode", value: world.defaultMode }],
		};
	if (request.op === "settings.edit") {
		world.edits.push(`${request.key}=${request.value}`);
		world.defaultMode = request.value;
		return { key: request.key, value: request.value };
	}
	if (request.op === "sessions.command") {
		world.commands.push(`${request.command} ${request.args}`);
		if (world.refuse) return { result: { kind: "block", text: world.refuse } };
		world.mode = request.args;
		return { result: { kind: "notice", text: `Approvals: ${request.args}` } };
	}
	return {};
};
const reset = (over = {}) => {
	Object.assign(world, {
		mode: "ask",
		defaultMode: "ask",
		refuse: null,
		commands: [],
		edits: [],
		reads: 0,
		...over,
	});
};
globalThis.fetch = async (_url, init) => {
	const request = JSON.parse(init?.body ?? "{}");
	return {
		ok: true,
		status: 200,
		json: async () => ({ status: 200, body: { result: answer(request) } }),
	};
};

const bundle = await build({
	stdin: {
		contents: [
			'export { ApprovalEscape } from "./src/renderer/src/features/chat/components/trace/approval-escape";',
			'export { ApprovalModePicker } from "./src/renderer/src/features/chat/session-status/approval-mode";',
			'export { QueryClient, QueryClientProvider } from "@tanstack/react-query";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
	jsx: "automatic",
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
		"@assets": `${process.cwd()}/src/renderer/src/assets`,
	},
	loader: {
		".css": "empty",
		".svg": "text",
		".png": "dataurl",
		".webp": "dataurl",
	},
	define: { "import.meta.env": "{}" },
	banner: {
		js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
	},
	write: false,
});
const bundlePath = new URL(
	`./_approval-live-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { ApprovalEscape, ApprovalModePicker, QueryClient, QueryClientProvider } =
	await import(bundlePath.href);
await unlink(bundlePath);
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = React;
const h = React.createElement;

let root;
let client;
after(() => {
	root?.unmount();
	client?.clear();
	dom.window.close();
});
const settle = async () => {
	for (let pass = 0; pass < 12; pass++) {
		await act(async () => {
			await new Promise((resolve) => realSetTimeout(resolve, 0));
			await new Promise((resolve) => setImmediate(resolve));
		});
	}
};
const $ = (selector) => window.document.querySelector(selector);
const policyLine = () => $("[data-approval-policy-line]")?.textContent ?? "";
const click = async (element) => {
	assert.ok(element, "the control is mounted");
	await act(async () => {
		element.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	});
	await settle();
};

/** The card as the dock mounts it: gate stamped "ask, session" at raise time. */
async function mount() {
	root?.unmount();
	client?.clear();
	client = new QueryClient({
		defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
	});
	root = createRoot(window.document.getElementById("root"));
	await act(async () => {
		root.render(
			h(
				QueryClientProvider,
				{ client },
				h(ApprovalModePicker, { sessionId: SESSION }),
				h(ApprovalEscape, {
					sessionId: SESSION,
					approvalMode: "ask",
					approvalProvenance: "session",
				}),
			),
		);
	});
	await settle();
}

const trigger = () => $("[data-approval-mode-trigger]");
const popover = () => $("[data-approval-mode-popover]");
const choice = (key) => $(`[data-approval-choice="${key}"]`);
/** Open the popover the way a person does: one click on the trigger. */
const openPicker = async () => {
	await click(trigger());
	assert.ok(popover(), "the popover is open");
};

test("opening the picker sends no command and re-reads the mode in the background", async () => {
	reset();
	await mount();
	const readsBefore = world.reads;
	await openPicker();
	assert.deepEqual(world.commands, [], "a click on the trigger never switches");
	assert.deepEqual(world.edits, []);
	assert.equal(trigger().getAttribute("aria-expanded"), "true");
	assert.ok(
		world.reads > readsBefore,
		"opening re-reads the entity row so a stale null catches up",
	);
	// Both scopes, both modes, the current ones checked.
	assert.equal(choice("session:ask").getAttribute("aria-checked"), "true");
	assert.equal(choice("session:auto").getAttribute("aria-checked"), "false");
	assert.equal(choice("all:ask").getAttribute("aria-checked"), "true");
	assert.match(popover().textContent, /dangerous-delete review still apply/);
});

test("D1/Q1: a session choice takes the live-gate route and flips the card's mode line", async () => {
	reset();
	await mount();
	assert.match(policyLine(), /Approvals: Ask — session override/);
	assert.equal(
		$("[data-approval-escape-ask]"),
		null,
		"no way back while asking",
	);
	assert.equal(trigger().dataset.mode, "ask");

	await openPicker();
	await click(choice("session:auto"));
	assert.deepEqual(world.commands, ["approvals auto"]);
	assert.deepEqual(world.edits, [], "this session never writes the default");
	assert.equal(trigger().dataset.mode, "auto");
	assert.equal(popover(), null, "a saved choice closes the popover");
	assert.match(policyLine(), /Approvals: Auto — session override/);
	const back = $("[data-approval-escape-ask]");
	assert.ok(back, "Always ask appears once the live mode is auto");
	assert.equal(back.getAttribute("title"), "This session only");

	await openPicker();
	await click(choice("session:ask"));
	assert.deepEqual(world.commands, ["approvals auto", "approvals ask"]);
	assert.match(policyLine(), /Approvals: Ask — session override/);
	assert.equal($("[data-approval-escape-ask]"), null);
});

test("all-sessions choices write the default, then move this conversation, in both directions", async () => {
	reset();
	await mount();
	await openPicker();
	await click(choice("all:auto"));
	assert.deepEqual(world.edits, ["tool_approval_mode=auto"]);
	assert.deepEqual(world.commands, ["approvals auto"]);
	assert.equal(trigger().dataset.mode, "auto");

	await openPicker();
	assert.equal(choice("all:auto").getAttribute("aria-checked"), "true");
	await click(choice("all:ask"));
	assert.deepEqual(world.edits, [
		"tool_approval_mode=auto",
		"tool_approval_mode=ask",
	]);
	assert.deepEqual(world.commands, ["approvals auto", "approvals ask"]);
	assert.equal(trigger().dataset.mode, "ask");
});

test("a choice that changes nothing sends nothing", async () => {
	reset();
	await mount();
	await openPicker();
	await click(choice("session:ask"));
	assert.deepEqual(world.commands, []);
	assert.equal(popover(), null);
	await openPicker();
	await click(choice("all:ask"));
	assert.deepEqual(world.edits, []);
	assert.deepEqual(world.commands, []);
});

test("D1: the card's confirmation clears when the picker moves the mode away from it", async () => {
	reset();
	await mount();
	await click($("[data-approval-escape-session]"));
	assert.match(
		$("[data-approval-escape-status]").textContent,
		/Auto for this session/,
	);
	assert.equal($("[data-approval-escape-session]").dataset.state, "done");

	await openPicker();
	await click(choice("session:ask"));
	assert.equal(world.mode, "ask");
	assert.equal($("[data-approval-escape-status]").textContent, "");
	assert.equal($("[data-approval-escape-session]").dataset.state, "idle");
	assert.match(policyLine(), /Approvals: Ask/);
});

test("M1: a refused choice shows the backend's reason inside the popover and keeps the mode", async () => {
	reset({ refuse: "this conversation holds a teammate's message" });
	await mount();
	await openPicker();
	await click(choice("session:auto"));
	assert.deepEqual(world.commands, ["approvals auto"]);
	assert.equal(trigger().dataset.mode, "ask");
	assert.ok(popover(), "a refusal keeps the popover open");
	const refusal = $("[data-approval-mode-refusal]");
	assert.ok(refusal, "the refusal is on screen");
	assert.equal(refusal.dataset.approvalModeRefusal, "refused");
	assert.match(
		refusal.textContent,
		/Unchanged: this conversation holds a teammate's message/,
	);
	assert.match(
		policyLine(),
		/Approvals: Ask/,
		"the card never claims the refused mode",
	);
});

test("a saved default with a refused live command states both halves", async () => {
	reset({ refuse: "operator consent required" });
	await mount();
	await openPicker();
	await click(choice("all:auto"));
	assert.deepEqual(world.edits, ["tool_approval_mode=auto"]);
	const refusal = $("[data-approval-mode-refusal]");
	assert.equal(refusal.dataset.approvalModeRefusal, "default-only");
	assert.match(
		refusal.textContent,
		/Default approvals for all sessions that follow it: Auto/,
	);
	assert.match(refusal.textContent, /Unchanged: operator consent required/);
	assert.equal(trigger().dataset.mode, "ask");
});

test("an unknown mode still renders the trigger, and it still opens", async () => {
	reset({ mode: null });
	await mount();
	assert.ok(
		trigger(),
		"the trigger does not disappear when the mode is unknown",
	);
	assert.equal(trigger().dataset.mode, "unknown");
	assert.match(trigger().textContent, /Approvals/);
	await openPicker();
	assert.equal(choice("session:ask").getAttribute("aria-checked"), "false");
	assert.equal(choice("session:auto").getAttribute("aria-checked"), "false");
	assert.deepEqual(world.commands, []);
});
