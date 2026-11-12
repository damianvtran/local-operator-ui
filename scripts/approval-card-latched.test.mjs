import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

/*
 * THE APPROVAL CARD ON A BRIDGE-LATCHED CONVERSATION, driven through the
 * SHIPPED `QuestionDock` in a DOM.
 *
 * The bug: a conversation holding a Team Bridge teammate-agent message is
 * latched by the backend, and the backend refuses `approvals auto` there
 * (`data.ok: false, approval_reason: "bridge_latched"`; the desktop command
 * carries no `bridge_ack`). The card nevertheless offered "Set auto for this
 * session" / "Set auto for all sessions". Both presses failed, and "all
 * sessions" wrote the machine default (`settings.edit`) before the session half
 * was refused. The card now mounts neither link on a latched gate and says why.
 *
 * WHAT IS PINNED, and why a static render alone cannot:
 *   - on a latched gate no "Set auto" control exists and NOTHING reaches
 *     `window.api.desktop.request` (no `settings.edit`, no `sessions.command`);
 *   - the one inline line carries the backend's own sentence;
 *   - Approve and Deny are still present, enabled, and still answer;
 *   - the negative control: an unlatched gate still renders both links and a
 *     press still sends the exact commands (the fix is not "hide always").
 *
 * THE FIXTURES ARE THE BACKEND'S OWN PAYLOADS. The two latched gates below are
 * `pending_gate` objects as `ServingSessionHandle._publish_pending_gate`
 * published them, captured from the core at 2ba8127d9 by parking a `bash`
 * approval on a handle whose session has `bridge_latched = True` (once with a
 * session auto granted before the latch, which adds `approval_suspended`). The
 * key spelling and value types are copied verbatim; only `session_name` and
 * the request ids are left as the capture produced them.
 *
 * WHAT THIS IS NOT: layout or colour proof (jsdom has no layout engine); the
 * before/after frames on the PR are that.
 *
 * Built like `secret-ask.test.mjs`: the world exists BEFORE the bundle imports,
 * because the theme layer and `zustand/persist` read `window` at module scope.
 */

const dom = new JSDOM("<!doctype html><div id='root'></div>", {
	url: "http://localhost/",
});
const { window } = dom;
const originals = new Map();
const mediaQueries = new Map();
const matchMediaStub = (query) => {
	if (!mediaQueries.has(query)) {
		mediaQueries.set(query, {
			matches: false,
			media: query,
			addEventListener: () => {},
			removeEventListener: () => {},
			addListener: () => {},
			removeListener: () => {},
			dispatchEvent: () => false,
		});
	}
	return mediaQueries.get(query);
};
for (const [key, value] of Object.entries({
	window,
	document: window.document,
	localStorage: window.localStorage,
	sessionStorage: window.sessionStorage,
	HTMLElement: window.HTMLElement,
	HTMLInputElement: window.HTMLInputElement,
	HTMLButtonElement: window.HTMLButtonElement,
	HTMLFormElement: window.HTMLFormElement,
	Element: window.Element,
	Node: window.Node,
	Event: window.Event,
	KeyboardEvent: window.KeyboardEvent,
	InputEvent: window.InputEvent,
	MouseEvent: window.MouseEvent,
	getComputedStyle: window.getComputedStyle.bind(window),
	IS_REACT_ACT_ENVIRONMENT: true,
	requestAnimationFrame: (callback) => setTimeout(() => callback(0), 0),
	cancelAnimationFrame: (id) => clearTimeout(id),
	ResizeObserver: class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
	matchMedia: matchMediaStub,
})) {
	originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
	Object.defineProperty(globalThis, key, {
		configurable: true,
		writable: true,
		value,
	});
}
/*
 * NEVER hand a DOM node to assert.equal / deepEqual: on failure node:assert
 * serialises the whole jsdom object graph (measured: a red run of this file grew
 * without bound and the host's memory guard killed it). Assert on booleans and
 * on text.
 */
// A null context is what the one caller that measures a cell already handles.
window.HTMLCanvasElement.prototype.getContext = () => null;

/*
 * THE DESKTOP BRIDGE, RECORDED. `desktopRequest` prefers `window.api.desktop`
 * when it exists, so every policy press the card could make lands here. The
 * reply is a refusal-shaped `sessions.command` receipt / a `settings.edit` row:
 * what comes back is not the subject, what was SENT is.
 */
const sent = [];
window.api = {
	desktop: {
		request: async (request) => {
			sent.push(request);
			if (request.op === "settings.edit") {
				return {
					status: 200,
					body: { result: { key: request.key, value: request.value } },
				};
			}
			return {
				status: 200,
				body: {
					result: { text: "ok", outcome: { kind: "notice", text: "ok" } },
				},
			};
		},
	},
};

const bundle = await build({
	stdin: {
		contents: [
			'export { QuestionDock } from "./src/renderer/src/features/chat/components/trace/question-dock";',
			'export { approvalGateIsBridgeLatched, APPROVAL_ESCAPE_COPY } from "./src/renderer/src/features/chat/components/trace/approval-escape";',
			'export { approvalVerdict } from "./src/renderer/src/features/chat/approval-words";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	loader: { ".css": "empty" },
	jsx: "automatic",
	// One copy of React, shared with this file's renderer.
	external: [
		"react",
		"react-dom",
		"react-dom/client",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
});

const bundlePath = new URL(
	`./_approval-card-latched-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import(
	"@tanstack/react-query"
);
const { act } = React;
const h = React.createElement;
const {
	QuestionDock,
	approvalGateIsBridgeLatched,
	APPROVAL_ESCAPE_COPY,
	approvalVerdict,
} = await import(bundlePath.href);
await unlink(bundlePath);

const document = window.document;
const SESSION = "aaaaaaaaaaaa";
const queryClient = new QueryClient({
	defaultOptions: { queries: { retry: false } },
});

/*
 * The backend's published `pending_gate` for a `bash` approval on a latched
 * conversation (core 2ba8127d9, `_publish_pending_gate`): `bridge_latched` and
 * `taint_raised` come from `PendingRequest.to_json()`; `approval_suspended` is
 * added only when a session auto predates the latch.
 */
const LATCHED_GATE = {
	request_id: "20a17fe5eed4cebf",
	kind: "approval",
	title: "bash",
	detail:
		"This conversation includes a message from a teammate's agent (Agent messages). Check what this sends and where before you allow it.\necho hi",
	options: [],
	secret: false,
	question_index: 0,
	question_total: 1,
	recommended: null,
	persist: false,
	approval_mode: "ask",
	approval_provenance: "global",
	approval_global_mode: "ask",
	taint_raised: false,
	bridge_latched: true,
	session_name: "",
};
const SUSPENDED_GATE = {
	...LATCHED_GATE,
	request_id: "f569f45323d159a9",
	approval_provenance: "session",
	approval_suspended: "bridge",
};
// The same card as an unlatched conversation publishes it: the two bridge
// fields are `false`/absent, which is what every card was before the contract.
const { taint_raised: _omitted, ...LATCHED_REST } = LATCHED_GATE;
const UNLATCHED_GATE = {
	...LATCHED_REST,
	request_id: "0123456789abcdef",
	detail: "echo hi",
	bridge_latched: false,
};

const SET_AUTO_FOR = /Set auto for/;
const NOTE =
	"Allow all and auto are off in this conversation. To turn auto on, type /approvals auto in the terminal, or use /new for a fresh conversation.";

let root;
const render = async (gate, onAnswer = () => {}) => {
	root ??= createRoot(document.getElementById("root"));
	await act(async () => {
		root.render(
			h(
				QueryClientProvider,
				{ client: queryClient },
				h(QuestionDock, { gate, sessionId: SESSION, onAnswer }),
			),
		);
	});
	await act(async () => {
		await Promise.resolve();
	});
};

const buttons = () => [...document.querySelectorAll("button")];
const buttonNamed = (text) =>
	buttons().find((button) => button.textContent.includes(text));
const press = async (button) => {
	await act(async () => {
		button.dispatchEvent(
			new window.MouseEvent("click", { bubbles: true, cancelable: true }),
		);
	});
	// The press is async (a command, then a settings write): let it settle.
	for (let i = 0; i < 5; i++) {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
	}
};

after(async () => {
	await act(async () => {
		root?.unmount();
	});
	for (const [key, descriptor] of originals) {
		if (descriptor === undefined) delete globalThis[key];
		else Object.defineProperty(globalThis, key, descriptor);
	}
});

test("the English copy is the backend's own sentence, so the two surfaces agree", () => {
	assert.equal(APPROVAL_ESCAPE_COPY.bridgeLatched(), NOTE);
});

test("the predicate reads bridge_latched OR approval_suspended, and absent means unlatched", () => {
	assert.equal(approvalGateIsBridgeLatched({ bridge_latched: true }), true);
	assert.equal(
		approvalGateIsBridgeLatched({ approval_suspended: "bridge" }),
		true,
	);
	assert.equal(approvalGateIsBridgeLatched({}), false);
	assert.equal(approvalGateIsBridgeLatched({ bridge_latched: false }), false);
	assert.equal(approvalGateIsBridgeLatched(UNLATCHED_GATE), false);
	assert.equal(approvalGateIsBridgeLatched(LATCHED_GATE), true);
	assert.equal(approvalGateIsBridgeLatched(SUSPENDED_GATE), true);
});

test("a latched approval offers no auto link, says why once, and still answers", async () => {
	sent.length = 0;
	const answered = [];
	await render(LATCHED_GATE, (label) => answered.push(label));

	assert.ok(!buttonNamed("Set auto"), "no Set auto control");
	assert.doesNotMatch(document.body.textContent, SET_AUTO_FOR);
	const notes = document.querySelectorAll("[data-approval-latched-note]");
	assert.equal(notes.length, 1, "exactly one inline note");
	assert.equal(notes[0].textContent, NOTE);
	assert.ok(
		!document.querySelector("[data-approval-escape-status]"),
		"the escape's status slot is not mounted either",
	);

	const approve = buttonNamed("Approve");
	const deny = buttonNamed("Deny");
	assert.ok(approve && deny, "Approve and Deny are still offered");
	assert.equal(approve.disabled, false);
	assert.equal(deny.disabled, false);

	await press(approve);
	await press(deny);
	assert.equal(answered.length, 2, "both presses reached onAnswer");
	assert.deepEqual(
		answered.map((label) => approvalVerdict(label)),
		[true, false],
		"Approve answers yes and Deny answers no",
	);
	assert.deepEqual(sent, [], "nothing was sent to the desktop bridge");
});

test("a gate with only approval_suspended: bridge hides the links too", async () => {
	sent.length = 0;
	const { bridge_latched: _omitted, ...gate } = SUSPENDED_GATE;
	await render(gate);
	assert.ok(!buttonNamed("Set auto"), "no Set auto control");
	assert.equal(
		document.querySelectorAll("[data-approval-latched-note]").length,
		1,
	);
	assert.ok(buttonNamed("Approve") && buttonNamed("Deny"));
	assert.deepEqual(sent, []);
});

test("the full published suspended payload (latched AND suspended) hides them", async () => {
	await render(SUSPENDED_GATE);
	assert.ok(!buttonNamed("Set auto"), "no Set auto control");
	assert.equal(
		document.querySelectorAll("[data-approval-latched-note]").length,
		1,
	);
});

test("NEGATIVE CONTROL: an unlatched approval still offers both links and they still send their commands", async () => {
	sent.length = 0;
	await render(UNLATCHED_GATE);
	const session = buttonNamed("Set auto for this session");
	const all = buttonNamed("Set auto for all sessions");
	assert.ok(session && all, "both links render on an unlatched card");
	assert.equal(
		document.querySelectorAll("[data-approval-latched-note]").length,
		0,
		"no latched note on an unlatched card",
	);

	await press(session);
	assert.equal(sent.length, 1);
	assert.equal(sent[0].op, "sessions.command");
	assert.equal(sent[0].command, "approvals");
	assert.equal(sent[0].args, "auto");

	sent.length = 0;
	await press(buttonNamed("Set auto for all sessions"));
	assert.deepEqual(
		sent.map((request) => request.op),
		["settings.edit", "sessions.command"],
		"the default is written first, then this conversation is asked to follow",
	);
	assert.equal(sent[0].key, "tool_approval_mode");
	assert.equal(sent[0].value, "auto");
});

test("NEGATIVE CONTROL: bridge flags that are explicitly false or absent leave the card as before", async () => {
	await render({
		...UNLATCHED_GATE,
		taint_raised: false,
		bridge_latched: false,
	});
	assert.ok(buttonNamed("Set auto for this session"));
	// taint_raised alone does not latch: it says why THIS call asked, not that
	// the conversation is latched.
	await render({ ...UNLATCHED_GATE, taint_raised: true });
	assert.ok(buttonNamed("Set auto for this session"));
});
