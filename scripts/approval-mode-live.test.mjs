import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

/*
 * The approval card and the composer chip read ONE live mode (design round 1,
 * D1 / QA Q1; agent review M1). Mounted for real in jsdom with the shipped
 * `ApprovalEscape` and `ApprovalModeChip` under one QueryClient, against a
 * stubbed desktop route whose `approvals` entity row the test moves - so the
 * property pinned is the one the frames showed broken: a chip press flips the
 * card's mode line and links, and a refused press says why.
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
	requestAnimationFrame: (callback) => realSetTimeout(() => callback(0), 0),
	cancelAnimationFrame: (id) => clearTimeout(id),
})) {
	Object.defineProperty(globalThis, key, {
		configurable: true,
		writable: true,
		value,
	});
}
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
const world = { mode: "ask", refuse: null, commands: [] };
const answer = (request) => {
	if (request.op === "commands.entities")
		return {
			entities: [{ value: "auto" }, { value: "ask" }],
			current: world.mode,
		};
	if (request.op === "sessions.command") {
		world.commands.push(`${request.command} ${request.args}`);
		if (world.refuse) return { result: { kind: "block", text: world.refuse } };
		world.mode = request.args;
		return { result: { kind: "notice", text: `Approvals: ${request.args}` } };
	}
	return {};
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
			'export { ApprovalModeChip } from "./src/renderer/src/features/chat/session-status/approval-mode-chip";',
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
const { ApprovalEscape, ApprovalModeChip, QueryClient, QueryClientProvider } =
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
				h(ApprovalModeChip, { sessionId: SESSION }),
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

test("D1/Q1: a chip press flips the card's mode line and its links", async () => {
	world.mode = "ask";
	world.refuse = null;
	world.commands = [];
	await mount();
	assert.match(policyLine(), /Approvals: Ask — session override/);
	assert.equal(
		$("[data-approval-escape-ask]"),
		null,
		"no way back while asking",
	);
	assert.equal($("[data-approval-mode-chip]").dataset.mode, "ask");

	await click($("[data-approval-mode-chip]"));
	assert.deepEqual(world.commands, ["approvals auto"]);
	assert.equal($("[data-approval-mode-chip]").dataset.mode, "auto");
	assert.match(policyLine(), /Approvals: Auto — session override/);
	const back = $("[data-approval-escape-ask]");
	assert.ok(back, "Always ask appears once the live mode is auto");
	// D5: the session-scoped handle says it is session-scoped.
	assert.equal(back.getAttribute("title"), "This session only");

	await click($("[data-approval-mode-chip]"));
	assert.deepEqual(world.commands, ["approvals auto", "approvals ask"]);
	assert.match(policyLine(), /Approvals: Ask — session override/);
	assert.equal($("[data-approval-escape-ask]"), null);
});

test("D1: the card's confirmation clears when the chip moves the mode away from it", async () => {
	world.mode = "ask";
	world.refuse = null;
	world.commands = [];
	await mount();
	await click($("[data-approval-escape-session]"));
	assert.match(
		$("[data-approval-escape-status]").textContent,
		/Auto for this session/,
	);
	assert.equal($("[data-approval-escape-session]").dataset.state, "done");

	await click($("[data-approval-mode-chip]"));
	assert.equal(world.mode, "ask");
	assert.equal($("[data-approval-escape-status]").textContent, "");
	assert.equal($("[data-approval-escape-session]").dataset.state, "idle");
	assert.match(policyLine(), /Approvals: Ask/);
});

test("M1: a refused chip press shows the backend's reason and keeps the mode", async () => {
	world.mode = "ask";
	world.refuse = "this conversation holds a teammate's message";
	world.commands = [];
	await mount();
	await click($("[data-approval-mode-chip]"));
	assert.deepEqual(world.commands, ["approvals auto"]);
	assert.equal($("[data-approval-mode-chip]").dataset.mode, "ask");
	const refusal = $("[data-approval-mode-refusal]");
	assert.ok(refusal, "the refusal is on screen");
	assert.match(
		refusal.textContent,
		/Unchanged: this conversation holds a teammate's message/,
	);
	assert.match(
		$("[data-approval-mode-chip]").getAttribute("title"),
		/Unchanged:/,
	);
	assert.match(
		policyLine(),
		/Approvals: Ask/,
		"the card never claims the refused mode",
	);
});
