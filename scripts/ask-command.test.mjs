import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * THE ASK CARD'S SUGGESTED COMMAND: the rules, the store's one-shot intent, the
 * delivery procedure, and the shipped panel's Insert / Run… doors.
 *
 * The rules are pure (`features/chat/ask-command.ts`) and get a table each: the
 * core's validation re-applied (`askCommandOf`), the placement predicate that
 * decides whether the agent works on THIS computer (`askAgentPlacement`), and the
 * gate that offers Run only on the device a command is meant for
 * (`askCommandRunnable`). The panel half drives the real `AskPanel` in jsdom:
 * Insert is one press with no dialog, Run… opens a confirmation whose default
 * focus is Cancel and whose confirm is the only way to `submit: true`.
 *
 * Companions: `console-pane-render.test.mjs` pins the pane's half (fresh surface,
 * paste, Enter only for submit, own conversation, once per press) and
 * `console-host.test.mjs` the IPC's `paste` option.
 */

const bootstrap = new JSDOM("<!doctype html><div id='root'></div>", {
	url: "http://localhost/",
});
globalThis.window = bootstrap.window;
globalThis.document = bootstrap.window.document;
globalThis.localStorage = bootstrap.window.localStorage;
for (const name of [
	"Node",
	"Element",
	"HTMLElement",
	"SVGElement",
	"Event",
	"CustomEvent",
	"KeyboardEvent",
	"MouseEvent",
	"PointerEvent",
	"FocusEvent",
	"InputEvent",
	"DOMRect",
	"DocumentFragment",
	"MutationObserver",
	"HTMLButtonElement",
	"NodeFilter",
	"HTMLInputElement",
	"HTMLTextAreaElement",
]) {
	if (bootstrap.window[name] !== undefined)
		globalThis[name] = bootstrap.window[name];
}
for (const name of [
	"getComputedStyle",
	"requestAnimationFrame",
	"cancelAnimationFrame",
]) {
	if (typeof bootstrap.window[name] === "function")
		globalThis[name] = bootstrap.window[name].bind(bootstrap.window);
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
bootstrap.window.HTMLCanvasElement.prototype.getContext = () => null;
// Radix measures its content; jsdom has no layout engine.
globalThis.ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};

const { createRoot } = await import("react-dom/client");

const bundle = await build({
	stdin: {
		contents: [
			'export { AskPanel } from "./src/renderer/src/features/chat/components/asks/ask-panel";',
			'export { askQueueView } from "./src/renderer/src/features/chat/ask-queue";',
			'export { ASK_COMMAND_MAX_CHARS, askCommandOf, askAgentPlacement, askCommandRunnable, askCommandNotice, askCommandDialogDevice, isLoopbackBackendUrl } from "./src/renderer/src/features/chat/ask-command";',
			'export { deliverConsoleCommand, waitForConsoleReady, CONSOLE_COMMAND_READY_CAP_MS, CONSOLE_COMMAND_QUIET_MS } from "./src/renderer/src/features/console/model/console-command";',
			'export { useUiPreferencesStore, persistedUiPreferences } from "./src/renderer/src/shared/store/ui-preferences-store";',
			'export { fileAskCommand, fileFleetAskCommand } from "./src/renderer/src/features/chat/ask-command-actions";',
			'export { useCanonicalSessionsStore } from "./src/renderer/src/shared/store/canonical-sessions-store";',
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
	define: { "import.meta.env": "{}" },
	external: [
		"react",
		"react-dom",
		"react-dom/client",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
});

const bundlePath = new URL("./_ask-command.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const lib = await import(bundlePath.href);
await unlink(bundlePath);
const {
	AskPanel,
	askQueueView,
	ASK_COMMAND_MAX_CHARS,
	askCommandOf,
	askAgentPlacement,
	askCommandRunnable,
	askCommandNotice,
	askCommandDialogDevice,
	isLoopbackBackendUrl,
	deliverConsoleCommand,
	waitForConsoleReady,
	CONSOLE_COMMAND_READY_CAP_MS,
	CONSOLE_COMMAND_QUIET_MS,
	useUiPreferencesStore,
	persistedUiPreferences,
	fileAskCommand,
	fileFleetAskCommand,
	useCanonicalSessionsStore,
} = lib;

/* ------------------------------------------------------------ askCommandOf */

test("askCommandOf accepts a stripped one-line command and reads its target", () => {
	assert.deepEqual(askCommandOf({ command: "glab auth login" }), {
		command: "glab auth login",
		target: "unknown",
	});
	assert.deepEqual(
		askCommandOf({ command: "cd ~/repo && make", command_target: "agent" }),
		{ command: "cd ~/repo && make", target: "agent" },
	);
	assert.deepEqual(askCommandOf({ command: "ls", command_target: "user" }), {
		command: "ls",
		target: "user",
	});
	// Anything but the two spellings is UNKNOWN, never a guess.
	for (const target of ["Agent", "both", "", 1, null]) {
		assert.equal(
			askCommandOf({ command: "ls", command_target: target }).target,
			"unknown",
			JSON.stringify(target),
		);
	}
	// Non-ASCII printable text is fine: a path or a message can carry it.
	assert.equal(
		askCommandOf({ command: "echo café 日本" }).command,
		"echo café 日本",
	);
});

test("askCommandOf refuses empty, unstripped, non-string and absent commands", () => {
	for (const command of [
		undefined,
		null,
		42,
		{},
		"",
		" ",
		" ls",
		"ls ",
		"\u00a0ls",
	]) {
		assert.equal(askCommandOf({ command }), null, JSON.stringify(command));
	}
	assert.equal(askCommandOf(null), null);
	assert.equal(askCommandOf({}), null);
});

test("askCommandOf counts code points, as Python's len does, up to 500", () => {
	assert.equal(ASK_COMMAND_MAX_CHARS, 500);
	assert.ok(askCommandOf({ command: "a".repeat(500) }));
	assert.equal(askCommandOf({ command: "a".repeat(501) }), null);
	// 500 emoji are 1000 UTF-16 units but 500 characters: allowed.
	assert.ok(askCommandOf({ command: "😀".repeat(500) }));
	assert.equal(askCommandOf({ command: "😀".repeat(501) }), null);
});

test("askCommandOf refuses every Cc, Cf, Zl and Zp character, anywhere", () => {
	const refused = {
		newline: "\n",
		carriage_return: "\r",
		tab: "\t",
		escape: "\u001b",
		nul: "\u0000",
		delete: "\u007f",
		c1_next_line: "\u0085",
		c1_csi: "\u009b",
		bidi_override: "\u202e",
		bidi_isolate: "\u2066",
		zero_width_space: "\u200b",
		zero_width_joiner: "\u200d",
		bom: "\ufeff",
		soft_hyphen: "\u00ad",
		line_separator: "\u2028",
		paragraph_separator: "\u2029",
	};
	for (const [name, character] of Object.entries(refused)) {
		assert.equal(
			askCommandOf({ command: `echo a${character}b` }),
			null,
			`${name} in the middle`,
		);
	}
	// The bracketed-paste terminator cannot ride in: ESC is refused.
	assert.equal(askCommandOf({ command: "x\u001b[201~; rm -rf ~" }), null);
});

/* ------------------------------------------------------- the placement rule */

test("isLoopbackBackendUrl: only this computer's own addresses", () => {
	for (const url of [
		"http://127.0.0.1:4711",
		"http://localhost:1111",
		"http://[::1]:8080",
	]) {
		assert.equal(isLoopbackBackendUrl(url), true, url);
	}
	for (const url of [
		"http://10.0.0.5:4711",
		"https://mac-mini.local:4711",
		"http://127.0.0.1.example.com",
		"not a url",
		"",
		null,
		undefined,
	]) {
		assert.equal(isLoopbackBackendUrl(url), false, String(url));
	}
});

const LOCAL_URL = "http://127.0.0.1:4711";

test("askAgentPlacement: every branch of the predicate", () => {
	const sessions = [
		{ session_id: "plain" },
		{ session_id: "local", locality: "local", owner_device: "" },
		{
			session_id: "peer",
			locality: "remote",
			owner_device: "dev-0123456789abcdef",
			owner_device_name: "Damian's Mac mini",
		},
		{ session_id: "peer-unnamed", locality: "remote", owner_device: "" },
		{ session_id: "moved" },
	];
	const placementFacts = {
		moved: { locality: "remote", owner_device: "dev-aaaabbbbcccc1234" },
	};
	const read = (sessionId, backendUrl = LOCAL_URL) =>
		askAgentPlacement({ sessionId, backendUrl, sessions, placementFacts });

	// (3) a row from a plain listing of a loopback backend is this computer's.
	assert.deepEqual(read("plain"), { kind: "here" });
	assert.deepEqual(read("local"), { kind: "here" });
	// (2) the row's own locality, named by its device.
	assert.deepEqual(read("peer"), {
		kind: "elsewhere",
		device: "Damian's Mac mini",
	});
	assert.deepEqual(read("peer-unnamed"), { kind: "elsewhere", device: null });
	// (2) a placement fact outranks a row that carries no locality (a move).
	assert.deepEqual(read("moved"), { kind: "elsewhere", device: "cccc1234" });
	// (3) an id the catalogue does not hold proves nothing.
	assert.deepEqual(read("never-listed"), { kind: "unknown" });
	assert.deepEqual(read(null), { kind: "unknown" });
	// (1) a backend on another host: every conversation's agent is there.
	assert.deepEqual(read("plain", "http://10.0.0.5:4711"), {
		kind: "elsewhere",
		device: null,
	});
	assert.deepEqual(read("plain", null), { kind: "elsewhere", device: null });
});

test("Run is offered only where the command will run on its intended device", () => {
	const here = { kind: "here" };
	const elsewhere = { kind: "elsewhere", device: "Mac mini" };
	const unknown = { kind: "unknown" };
	const hint = (target) => ({ command: "ls", target });
	const table = [
		["user", here, true],
		["user", elsewhere, true],
		["user", unknown, true],
		["agent", here, true],
		["agent", elsewhere, false],
		["agent", unknown, false],
		["unknown", here, false],
		["unknown", elsewhere, false],
		["unknown", unknown, false],
	];
	for (const [target, placement, expected] of table) {
		assert.equal(
			askCommandRunnable(hint(target), placement),
			expected,
			`${target} @ ${placement.kind}`,
		);
		// A runnable command carries no notice; a withheld one always says why.
		assert.equal(
			askCommandNotice(hint(target), placement) === null,
			expected,
			`${target} @ ${placement.kind} notice`,
		);
	}
	assert.deepEqual(askCommandNotice(hint("agent"), elsewhere), {
		kind: "elsewhere",
		device: "Mac mini",
	});
	assert.deepEqual(
		askCommandNotice(hint("agent"), { kind: "elsewhere", device: null }),
		{ kind: "elsewhere_unnamed" },
	);
	assert.deepEqual(askCommandNotice(hint("agent"), unknown), {
		kind: "unplaced",
	});
	assert.deepEqual(askCommandNotice(hint("unknown"), here), {
		kind: "target_unknown",
	});
	assert.deepEqual(askCommandDialogDevice(here), { kind: "local" });
	assert.deepEqual(askCommandDialogDevice(unknown), { kind: "local" });
	assert.deepEqual(askCommandDialogDevice(elsewhere), {
		kind: "remote_user",
		device: "Mac mini",
	});
});

/* ------------------------------------------------------------ the intent */

test("the intent is one-shot: a fresh nonce per press, cleared only by its own nonce, never persisted", () => {
	const store = useUiPreferencesStore.getState();
	store.requestConsoleCommand({
		sessionId: "s-1",
		command: "ls",
		submit: false,
	});
	const first = useUiPreferencesStore.getState().consoleCommandIntent;
	assert.equal(first.sessionId, "s-1");
	assert.equal(first.submit, false);
	store.requestConsoleCommand({
		sessionId: "s-1",
		command: "ls",
		submit: true,
	});
	const second = useUiPreferencesStore.getState().consoleCommandIntent;
	assert.notEqual(second.nonce, first.nonce, "two presses are two intents");
	// A late clear for the FIRST press must not wipe the second one.
	store.clearConsoleCommandIntent(first.nonce);
	assert.equal(
		useUiPreferencesStore.getState().consoleCommandIntent?.nonce,
		second.nonce,
	);
	assert.equal(
		"consoleCommandIntent" in
			persistedUiPreferences(useUiPreferencesStore.getState()),
		false,
		"a relaunch cannot replay — or re-run — a command",
	);
	store.clearConsoleCommandIntent(second.nonce);
	assert.equal(useUiPreferencesStore.getState().consoleCommandIntent, null);
});

/* ------------------------------------------------------------ the delivery */

const fakeClock = () => {
	let now = 0;
	return {
		now: () => now,
		sleep: async (ms) => {
			now += ms;
		},
		advance: (ms) => {
			now += ms;
		},
	};
};

test("delivery waits for output plus a quiet window, then pastes; Enter only for submit", async () => {
	const clock = fakeClock();
	const writes = [];
	const api = {
		input: async (surface, text, options) =>
			writes.push(["input", surface, text, options]),
		keys: async (surface, keys) => writes.push(["keys", surface, keys]),
	};
	let outputAt = null;
	// The prompt arrives 40 ms in.
	const lastOutputAt = () => {
		if (outputAt === null && clock.now() >= 40) outputAt = 40;
		return outputAt;
	};
	const readiness = await deliverConsoleCommand(
		api,
		{ surface: "con:1", command: "ls -la", submit: false, lastOutputAt },
		clock,
	);
	assert.equal(readiness, "ready");
	assert.ok(clock.now() >= 40 + CONSOLE_COMMAND_QUIET_MS);
	assert.ok(clock.now() < CONSOLE_COMMAND_READY_CAP_MS);
	assert.deepEqual(writes, [["input", "con:1", "ls -la", { paste: true }]]);

	writes.length = 0;
	await deliverConsoleCommand(
		api,
		{ surface: "con:2", command: "ls", submit: true, lastOutputAt: () => 0 },
		fakeClock(),
	);
	assert.deepEqual(writes, [
		["input", "con:2", "ls", { paste: true }],
		["keys", "con:2", ["enter"]],
	]);
});

test("a shell that never prints is written to at the cap — the pty buffers typeahead", async () => {
	const clock = fakeClock();
	assert.equal(await waitForConsoleReady(() => null, clock), "capped");
	assert.ok(clock.now() >= CONSOLE_COMMAND_READY_CAP_MS);
	// A shell that keeps printing never goes quiet: the cap still bounds it.
	const busy = fakeClock();
	assert.equal(await waitForConsoleReady(() => busy.now(), busy), "capped");
});

/* ------------------------------------------------------------ the panel */

/* The English copy these assertions read, hoisted (biome `useTopLevelRegex`). */
const DIALOG_TITLE = /Run this command\?/;
const NOTICE_ELSEWHERE =
	/The agent works on Mac mini\. This runs here, not there\./;
const DEVICE_REMOTE_USER = /not on Mac mini, where the agent works/;

const { createElement } = React;
const NOW = 1_700_000_000_000;

const commandAsk = (overrides = {}, question = {}) => ({
	ask_id: "ask-1",
	created_at: NOW - 60_000,
	expires_at: NOW + 600_000,
	timeout_s: 900,
	urgent: false,
	status: "open",
	delivered: false,
	questions: [
		{
			id: "q1",
			question: "glab is signed out. Sign in, then tell me when it's done.",
			options: [{ label: "Done" }],
			command: "glab auth login",
			command_target: "agent",
			...question,
		},
	],
	...overrides,
});

const panelElement = (asks, extra = {}) =>
	createElement(AskPanel, {
		view: askQueueView({
			asks,
			asks_open: asks.filter((ask) => ask.status === "open").length,
		}),
		nowMs: NOW,
		answering: false,
		drafts: {},
		onDraftChange: () => undefined,
		onAnswer: () => undefined,
		onDecline: () => undefined,
		...extra,
	});

async function mount(element) {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	const render = async (next) => {
		await act(async () => root.render(next));
	};
	await render(element);
	return {
		container,
		render,
		async unmount() {
			await act(async () => root.unmount());
			container.remove();
		},
	};
}

const click = async (node) => {
	await act(async () => {
		node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	});
};
const dialog = () => document.body.querySelector('[role="dialog"]');
const here = () => ({ kind: "here" });

test("the row shows the command verbatim; Insert files it with no dialog and no Enter", async () => {
	const calls = [];
	const rig = await mount(
		panelElement([commandAsk()], {
			onCommand: (ask, command, submit) =>
				calls.push([ask.ask_id, command, submit]),
			commandPlacementOf: here,
		}),
	);
	try {
		const row = rig.container.querySelector("[data-ask-command]");
		assert.ok(row, "the row is drawn for an answerable ask");
		assert.equal(
			row.querySelector("[data-ask-command-text]").textContent,
			"glab auth login",
		);
		await click(row.querySelector("[data-ask-command-insert]"));
		assert.deepEqual(calls, [["ask-1", "glab auth login", false]]);
		assert.equal(dialog(), null, "Insert opens no dialog");
	} finally {
		await rig.unmount();
	}
});

test("Run… needs the confirm: Cancel holds the focus, and only the confirm submits", async () => {
	const calls = [];
	const rig = await mount(
		panelElement([commandAsk()], {
			onCommand: (ask, command, submit) =>
				calls.push([ask.ask_id, command, submit]),
			commandPlacementOf: here,
		}),
	);
	try {
		const run = rig.container.querySelector("[data-ask-command-run]");
		assert.ok(run, "Run… is offered: agent command, agent on this computer");
		await click(run);
		const open = dialog();
		assert.ok(open, "the press opens the confirmation");
		assert.deepEqual(calls, [], "nothing is typed before the confirm");
		assert.match(open.textContent, DIALOG_TITLE);
		assert.equal(
			open.querySelector("[data-ask-command-text]").textContent,
			"glab auth login",
			"the exact command, verbatim",
		);
		assert.equal(
			open.querySelector("[data-ask-command-device]").dataset.askCommandDevice,
			"local",
		);
		await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
		assert.ok(
			document.activeElement?.hasAttribute("data-cancel-action"),
			`Cancel takes the focus by default (focused: ${document.activeElement?.outerHTML?.slice(0, 80)})`,
		);
		// Cancel submits nothing.
		await click(open.querySelector("[data-cancel-action]"));
		assert.deepEqual(calls, []);
		assert.equal(dialog(), null);
		// Confirm is the only way to submit.
		await click(rig.container.querySelector("[data-ask-command-run]"));
		await click(dialog().querySelector("[data-confirm-action]"));
		assert.deepEqual(calls, [["ask-1", "glab auth login", true]]);
	} finally {
		await rig.unmount();
	}
});

test("an agent command in a conversation whose agent is elsewhere offers Insert only, and says why", async () => {
	const rig = await mount(
		panelElement([commandAsk()], {
			onCommand: () => undefined,
			commandPlacementOf: () => ({ kind: "elsewhere", device: "Mac mini" }),
		}),
	);
	try {
		const row = rig.container.querySelector("[data-ask-command]");
		assert.equal(row.querySelector("[data-ask-command-run]"), null);
		assert.ok(row.querySelector("[data-ask-command-insert]"));
		assert.match(
			row.querySelector("[data-ask-command-notice]").textContent,
			NOTICE_ELSEWHERE,
		);
	} finally {
		await rig.unmount();
	}
});

test("a user command in a remote conversation runs here, and the dialog says not there", async () => {
	const rig = await mount(
		panelElement([commandAsk({}, { command_target: "user" })], {
			onCommand: () => undefined,
			commandPlacementOf: () => ({ kind: "elsewhere", device: "Mac mini" }),
		}),
	);
	try {
		await click(rig.container.querySelector("[data-ask-command-run]"));
		const line = dialog().querySelector("[data-ask-command-device]");
		assert.equal(line.dataset.askCommandDevice, "remote_user");
		assert.match(line.textContent, DEVICE_REMOTE_USER);
	} finally {
		await rig.unmount();
	}
});

test("no placement supplied, or no target on the row, fails closed to Insert only", async () => {
	for (const [label, ask, extra] of [
		["no placement", commandAsk(), {}],
		[
			"no target",
			commandAsk({}, { command_target: undefined }),
			{ commandPlacementOf: here },
		],
	]) {
		const rig = await mount(
			panelElement([ask], { onCommand: () => undefined, ...extra }),
		);
		try {
			const row = rig.container.querySelector("[data-ask-command]");
			assert.equal(row.querySelector("[data-ask-command-run]"), null, label);
			assert.ok(row.querySelector("[data-ask-command-notice]"), label);
		} finally {
			await rig.unmount();
		}
	}
});

test("a forged command, a settled ask, or a read-only mount draws no terminal door", async () => {
	const forged = await mount(
		panelElement([commandAsk({}, { command: "ls\nrm -rf ~" })], {
			onCommand: () => undefined,
			commandPlacementOf: here,
		}),
	);
	try {
		assert.equal(forged.container.querySelector("[data-ask-command]"), null);
	} finally {
		await forged.unmount();
	}
	const readOnly = await mount(
		panelElement([commandAsk()], { commandPlacementOf: here }),
	);
	try {
		const row = readOnly.container.querySelector("[data-ask-command]");
		assert.ok(row, "the command is still shown, with Copy");
		assert.equal(row.querySelector("[data-ask-command-insert]"), null);
		assert.equal(row.querySelector("[data-ask-command-run]"), null);
	} finally {
		await readOnly.unmount();
	}
	const settled = await mount(
		panelElement(
			[
				commandAsk({
					status: "answered",
					answers: { q1: ["Done"] },
					delivered: true,
				}),
			],
			{ onCommand: () => undefined, commandPlacementOf: here },
		),
	);
	try {
		assert.equal(settled.container.querySelector("[data-ask-command]"), null);
	} finally {
		await settled.unmount();
	}
});

test("an ask that closes under the open dialog withholds the confirm, with a note", async () => {
	const calls = [];
	const props = {
		onCommand: (_ask, _command, submit) => calls.push(submit),
		commandPlacementOf: here,
	};
	const rig = await mount(panelElement([commandAsk()], props));
	try {
		await click(rig.container.querySelector("[data-ask-command-run]"));
		assert.ok(dialog());
		await rig.render(
			panelElement(
				[
					commandAsk({
						status: "answered",
						answers: { q1: ["Done"] },
						delivered: true,
					}),
				],
				props,
			),
		);
		const open = dialog();
		assert.ok(
			open,
			"the dialog stays up rather than vanishing under the reader",
		);
		assert.ok(open.querySelector("[data-ask-command-closed]"));
		const confirm = open.querySelector("[data-confirm-action]");
		assert.equal(confirm.disabled, true);
		assert.equal(
			open.querySelector("[data-cancel-action]").disabled,
			false,
			"the way out stays live",
		);
		await click(confirm);
		assert.deepEqual(calls, []);
	} finally {
		await rig.unmount();
	}
});

test("fileAskCommand files only the ask's own validated command, and refuses a submit Run would not offer", () => {
	const store = useUiPreferencesStore.getState();
	const reset = () => {
		const pending = useUiPreferencesStore.getState().consoleCommandIntent;
		if (pending) store.clearConsoleCommandIntent(pending.nonce);
		useUiPreferencesStore.getState().setConsolePaneOpen(false);
	};
	const ask = commandAsk();
	reset();
	assert.equal(
		fileAskCommand({
			sessionId: "s-1",
			ask,
			command: "rm -rf ~",
			submit: false,
		}),
		false,
		"a string that is not the ask's own command is refused",
	);
	assert.equal(useUiPreferencesStore.getState().consoleCommandIntent, null);
	// An unknown conversation is not provably here, so an agent command's submit fails closed.
	assert.equal(
		fileAskCommand({
			sessionId: "s-unknown",
			ask,
			command: "glab auth login",
			submit: true,
		}),
		false,
	);
	assert.equal(useUiPreferencesStore.getState().consoleCommandIntent, null);
	// Insert is always allowed for a valid command.
	assert.equal(
		fileAskCommand({
			sessionId: "s-unknown",
			ask,
			command: "glab auth login",
			submit: false,
		}),
		true,
	);
	const filed = useUiPreferencesStore.getState().consoleCommandIntent;
	assert.equal(filed?.sessionId, "s-unknown");
	assert.equal(filed?.submit, false);
	reset();
	// A user-target command may submit wherever the agent is.
	const userAsk = commandAsk({}, { command_target: "user" });
	assert.equal(
		fileAskCommand({
			sessionId: "s-unknown",
			ask: userAsk,
			command: "glab auth login",
			submit: true,
		}),
		true,
	);
	assert.equal(
		useUiPreferencesStore.getState().consoleCommandIntent?.submit,
		true,
	);
	reset();
	assert.ok(
		useCanonicalSessionsStore,
		"the placement read is the real store's",
	);
});

test("the fleet press waves the ask off BEFORE opening its conversation, then files", () => {
	// Regression (measured in the built app): opening the conversation first let the
	// ask-open policy re-open the session drawer over the console, so nothing was typed.
	const order = [];
	const navigate = () => undefined;
	const ask = commandAsk();
	const filed = fileFleetAskCommand(
		{
			sessionId: "s-9",
			ask,
			command: "glab auth login",
			submit: false,
			navigate,
		},
		{
			dismissals: {
				record: (id, reading) => order.push(["record", id, reading]),
			},
			open: (nav, id) => order.push(["open", id, nav === navigate]),
			file: (request) => {
				order.push([
					"file",
					request.sessionId,
					request.command,
					request.submit,
				]);
				return true;
			},
		},
	);
	assert.equal(filed, true);
	assert.deepEqual(order, [
		["record", "s-9", { outstandingIds: ["ask-1"], listComplete: true }],
		["open", "s-9", true],
		["file", "s-9", "glab auth login", false],
	]);
});
