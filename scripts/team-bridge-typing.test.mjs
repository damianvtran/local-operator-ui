import assert from "node:assert/strict";
import Module from "node:module";
import { after, beforeEach, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * Team Bridge typing indicators: the emitter state machine, the reader's
 * cadence/back-off/expiry rules and the indicator line's copy forms, through
 * the SHIPPED modules with a fake API at the contract boundary (the desktop
 * routes are built in a parallel lop PR, so nothing here reaches a backend).
 * Timers and Date are node's mock timers, so every cadence assertion is exact.
 */
const dom = new JSDOM("<!doctype html><div id='root'></div>", {
	url: "http://localhost/",
});
for (const key of [
	"window",
	"document",
	"HTMLElement",
	"Element",
	"Node",
	"navigator",
])
	Object.defineProperty(globalThis, key, {
		configurable: true,
		value: dom.window[key],
	});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");

const bundle = await build({
	stdin: {
		contents: `
		export * from './src/renderer/src/features/team-bridge/team-bridge-typing-model';
		export * from './src/renderer/src/features/team-bridge/use-team-bridge-typing-emitter';
		export * from './src/renderer/src/features/team-bridge/use-team-bridge-typing';
		export * from './src/renderer/src/features/team-bridge/team-bridge-typing-line';
		export {desktopRequestSchema,desktopEndpoint} from './src/shared/desktop-contract';
		export {teamBridgeTypingStateSchema,teamBridgeTypingHeartbeatSchema} from './src/shared/team-bridge-contract';
	`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	write: false,
	format: "cjs",
	platform: "node",
	external: ["react", "react-dom"],
	tsconfig: "tsconfig.app.json",
	alias: { "@shared": `${process.cwd()}/src/renderer/src/shared` },
	jsx: "automatic",
	loader: { ".css": "empty" },
	define: { "import.meta.env": "{}" },
});
const mod = new Module(`${process.cwd()}/.team-bridge-typing-test.cjs`);
mod.filename = `${process.cwd()}/.team-bridge-typing-test.cjs`;
mod.paths = Module._nodeModulePaths(process.cwd());
mod._compile(bundle.outputFiles[0].text, mod.filename);
const m = mod.exports;
after(() => dom.window.close());

const FIXED_LINE_CLASS = /\bh-4\b/;
const ANIMATION_CLASS = /animate/;

const TARGET = {
	conversationId: "bcv_typing01",
	tenantId: "org_fixture",
	accountId: "acct_self",
};

/** The fake emitter API: records every call, answers the contract's 200. */
function emitterApi(answer = { ttl_ms: 8000, resend_after_ms: 3000 }) {
	const calls = [];
	return {
		calls,
		puts: () => calls.filter((call) => call.verb === "PUT"),
		deletes: () => calls.filter((call) => call.verb === "DELETE"),
		api: {
			typingSet: (target) => {
				calls.push({ verb: "PUT", target, at: Date.now() });
				return Promise.resolve(answer);
			},
			typingClear: (target) => {
				calls.push({ verb: "DELETE", target, at: Date.now() });
				return Promise.resolve();
			},
		},
	};
}

/** Settle promise callbacks queued by a resolved fake call. */
async function flush() {
	for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

async function mountEmitter(t, { target = TARGET, text = "", api }) {
	const host = document.createElement("div");
	const root = createRoot(host);
	const handle = { current: null };
	function Harness(props) {
		handle.current = m.useTeamBridgeTypingEmitter(
			props.target,
			props.text,
			props.api,
		);
		return null;
	}
	const render = async (props) =>
		act(async () => root.render(React.createElement(Harness, props)));
	await render({ target, text, api });
	t.after(async () => {
		try {
			await act(async () => root.unmount());
		} catch {
			// already unmounted by the case itself
		}
	});
	return {
		handle,
		rerender: render,
		unmount: () => act(async () => root.unmount()),
		tick: async (ms) => {
			await act(async () => {
				t.mock.timers.tick(ms);
				await flush();
			});
		},
	};
}

beforeEach(() => {
	m.resetTypingEmitterSessionForTests();
	m.resetTypingReaderSessionForTests();
	m.useTeamBridgeShareTypingStore.getState().setShareTyping(null);
});

test("emitter: a restored draft and a mounted non-empty value never report typing", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
	const fake = emitterApi();
	const view = await mountEmitter(t, {
		text: "restored draft from storage",
		api: fake.api,
	});
	await view.tick(20_000);
	await view.rerender({
		target: TARGET,
		text: "restored again",
		api: fake.api,
	});
	await view.tick(20_000);
	assert.deepEqual(fake.calls, []);
});

test("emitter: first keystroke PUTs at once, then once per resend interval while typing", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
	const fake = emitterApi();
	const view = await mountEmitter(t, { api: fake.api });
	await act(async () => {
		view.handle.current.onFocus();
		view.handle.current.onInput("h");
		await flush();
	});
	assert.equal(fake.puts().length, 1);
	assert.deepEqual(fake.puts()[0].target, TARGET);
	// Keystrokes inside the interval add no PUT.
	for (let at = 500; at < 3000; at += 500) {
		await view.tick(500);
		await act(async () => view.handle.current.onInput("hello".slice(0, 2)));
	}
	assert.equal(fake.puts().length, 1, "no PUT before resend_after_ms");
	await view.tick(500); // t = 3000
	assert.equal(fake.puts().length, 2);
	await act(async () => view.handle.current.onInput("hel"));
	await view.tick(3000); // t = 6000, last input at 3000 (< 5 s idle)
	assert.equal(fake.puts().length, 3);
	const gaps = fake
		.puts()
		.slice(1)
		.map((call, i) => call.at - fake.puts()[i].at);
	assert.ok(
		gaps.every((gap) => gap >= 3000),
		`PUT gaps ${gaps}`,
	);
	assert.equal(fake.deletes().length, 0);
});

test("emitter: 5 s with no keystroke stops with one DELETE and no further PUT", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
	const fake = emitterApi();
	const view = await mountEmitter(t, { api: fake.api });
	await act(async () => view.handle.current.onInput("draft"));
	await view.tick(4999);
	assert.equal(fake.deletes().length, 0);
	await view.tick(1);
	assert.equal(fake.deletes().length, 1);
	assert.deepEqual(fake.deletes()[0].target, TARGET);
	const puts = fake.puts().length;
	await view.tick(30_000);
	assert.equal(fake.puts().length, puts);
	assert.equal(fake.deletes().length, 1);
});

for (const [name, act_] of [
	["blur", (view) => view.handle.current.onBlur()],
	["an accepted send", (view) => view.handle.current.onSent()],
	["clearing the text by input", (view) => view.handle.current.onInput("   ")],
]) {
	test(`emitter: ${name} sends DELETE immediately`, async (t) => {
		t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
		const fake = emitterApi();
		const view = await mountEmitter(t, { api: fake.api });
		await act(async () => view.handle.current.onInput("draft"));
		await view.tick(1000);
		await act(async () => act_(view));
		assert.equal(fake.deletes().length, 1);
		await view.tick(30_000);
		assert.equal(fake.puts().length, 1, "no PUT after the stop");
		assert.equal(fake.deletes().length, 1, "exactly one DELETE");
	});
}

test("emitter: a host-side clear (send retiring the text) stops without an input event", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
	const fake = emitterApi();
	const view = await mountEmitter(t, { text: "", api: fake.api });
	await act(async () => view.handle.current.onInput("draft"));
	await view.rerender({ target: TARGET, text: "draft", api: fake.api });
	assert.equal(fake.deletes().length, 0);
	await view.rerender({ target: TARGET, text: "", api: fake.api });
	assert.equal(fake.deletes().length, 1);
});

test("emitter: switching conversation or thread DELETEs the OLD target, and the switch itself never PUTs", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
	const fake = emitterApi();
	const view = await mountEmitter(t, { text: "", api: fake.api });
	await act(async () => view.handle.current.onInput("draft"));
	const thread = { ...TARGET, threadRootId: "bcm_root01" };
	await view.rerender({ target: thread, text: "draft", api: fake.api });
	assert.equal(fake.deletes().length, 1);
	assert.deepEqual(fake.deletes()[0].target, TARGET);
	await view.tick(20_000);
	assert.equal(fake.puts().length, 1, "the switch reported no typing");
	await act(async () => view.handle.current.onInput("draft2"));
	assert.deepEqual(fake.puts()[1].target, thread);
});

test("emitter: unmount mid-typing DELETEs", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
	const fake = emitterApi();
	const view = await mountEmitter(t, { api: fake.api });
	await act(async () => view.handle.current.onInput("draft"));
	await view.unmount();
	assert.equal(fake.deletes().length, 1);
});

test("emitter: a stop/start churn inside one interval never exceeds one PUT per resend interval", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
	const fake = emitterApi();
	const view = await mountEmitter(t, { api: fake.api });
	await act(async () => view.handle.current.onInput("a"));
	await view.tick(1000);
	await act(async () => view.handle.current.onBlur());
	await view.tick(500);
	await act(async () => view.handle.current.onInput("ab"));
	assert.equal(fake.puts().length, 1, "restart waits out the interval");
	await view.tick(1500); // t = 3000
	assert.equal(fake.puts().length, 2);
	assert.equal(fake.puts()[1].at - fake.puts()[0].at, 3000);
});

test("emitter: no target (capability off, new DM) and share_typing=false send nothing", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
	const fake = emitterApi();
	const view = await mountEmitter(t, { target: null, api: fake.api });
	await act(async () => view.handle.current.onInput("draft"));
	await view.tick(10_000);
	await act(async () => view.handle.current.onBlur());
	assert.deepEqual(fake.calls, []);

	m.useTeamBridgeShareTypingStore.getState().setShareTyping(false);
	const off = await mountEmitter(t, { api: fake.api });
	await act(async () => off.handle.current.onInput("draft"));
	await off.tick(10_000);
	assert.deepEqual(fake.calls, []);
});

test("emitter: lop's {shared:false} answer silences the emitter with no DELETE", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
	const fake = emitterApi({ shared: false });
	const view = await mountEmitter(t, { api: fake.api });
	await act(async () => {
		view.handle.current.onInput("draft");
		await flush();
	});
	assert.equal(m.useTeamBridgeShareTypingStore.getState().shareTyping, false);
	await view.tick(10_000);
	await act(async () => view.handle.current.onInput("draft more"));
	await act(async () => view.handle.current.onBlur());
	assert.equal(fake.puts().length, 1);
	assert.equal(fake.deletes().length, 0);
});

test("emitter: a refused PUT is dropped silently; outdated_hub silences the session", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
	const calls = [];
	const api = {
		typingSet: () => {
			calls.push("PUT");
			return Promise.reject(
				Object.assign(new Error("old hub"), {
					status: 409,
					code: "outdated_hub",
				}),
			);
		},
		typingClear: () => {
			calls.push("DELETE");
			return Promise.resolve();
		},
	};
	const view = await mountEmitter(t, { api });
	await act(async () => {
		view.handle.current.onInput("draft");
		await flush();
	});
	await view.tick(10_000);
	await act(async () => view.handle.current.onInput("again"));
	await view.tick(10_000);
	assert.deepEqual(calls, ["PUT"]);
});

/* ---------------------------------------------------------------- reader */

function readerApi(answers) {
	const calls = [];
	return {
		calls,
		api: {
			typing: (conversationId, tenantId) => {
				calls.push({ conversationId, tenantId, at: Date.now() });
				const next = answers.length > 1 ? answers.shift() : answers[0];
				return typeof next === "function" ? next() : Promise.resolve(next);
			},
		},
	};
}

const typingAnswer = (typers, extra = {}) => ({
	enabled: true,
	poll_after_ms: 3000,
	message_seq: 10,
	truncated: false,
	typers,
	...extra,
});

async function mountReader(t, props) {
	const host = document.createElement("div");
	const root = createRoot(host);
	const handle = { current: null };
	function Harness(p) {
		handle.current = m.useTeamBridgeTyping(p);
		return null;
	}
	const render = async (p) =>
		act(async () => root.render(React.createElement(Harness, p)));
	await render(props);
	await act(async () => flush());
	t.after(async () => {
		try {
			await act(async () => root.unmount());
		} catch {
			// already unmounted by the case itself
		}
	});
	return {
		handle,
		rerender: render,
		tick: async (ms) => {
			await act(async () => {
				t.mock.timers.tick(ms);
				await flush();
			});
		},
	};
}

const READER = {
	conversationId: "bcv_typing01",
	tenantId: "org_fixture",
	enabled: true,
	windowActive: true,
};

test("reader: an unfocused/hidden window or a closed conversation never GETs", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
	const fake = readerApi([typingAnswer([])]);
	const view = await mountReader(t, {
		...READER,
		windowActive: false,
		api: fake.api,
	});
	await view.tick(60_000);
	await view.rerender({ ...READER, enabled: false, api: fake.api });
	await view.tick(60_000);
	assert.equal(fake.calls.length, 0);
	await view.rerender({ ...READER, api: fake.api });
	await act(async () => flush());
	assert.equal(fake.calls.length, 1, "focus + open resumes at once");
});

test("reader: polls at poll_after_ms and expires a typer at its own deadline without a poll", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
	const typer = {
		account_id: "acct_sana",
		kind: "human",
		thread_root_id: null,
		expires_in_ms: 2000,
	};
	const fake = readerApi([
		typingAnswer([typer]),
		// The next poll never settles: the line must still clear on its own.
		() => new Promise(() => {}),
	]);
	const view = await mountReader(t, { ...READER, api: fake.api });
	assert.equal(fake.calls.length, 1);
	const shown = () =>
		m.typingNamesForScope(view.handle.current.entries, {
			scope: null,
			now: view.handle.current.now,
			labelFor: () => "Sana",
		});
	assert.deepEqual(shown(), ["Sana"]);
	await view.tick(2000);
	assert.deepEqual(shown(), [], "expired at fetchedAt + expires_in_ms");
	await view.tick(1000);
	assert.equal(fake.calls.length, 2, "second GET at poll_after_ms");
});

test("reader: a message_seq advance asks the host to refetch history, once per advance", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
	const advances = [];
	const fake = readerApi([
		typingAnswer([], { message_seq: 10 }),
		typingAnswer([], { message_seq: 10 }),
		typingAnswer([], { message_seq: 12 }),
		typingAnswer([], { message_seq: 12 }),
	]);
	const view = await mountReader(t, {
		...READER,
		api: fake.api,
		onMessageSeqAdvance: (seq) => advances.push(seq),
	});
	await view.tick(3000);
	await view.tick(3000);
	await view.tick(3000);
	assert.equal(fake.calls.length, 4);
	assert.deepEqual(advances, [12]);
});

test("reader: enabled:false backs off to the server's poll_after_ms", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
	const fake = readerApi([
		{ enabled: false, poll_after_ms: 60_000, typers: [] },
	]);
	const view = await mountReader(t, { ...READER, api: fake.api });
	await view.tick(59_999);
	assert.equal(fake.calls.length, 1);
	await view.tick(1);
	assert.equal(fake.calls.length, 2);
});

test("reader: 429 honours retry_after_ms, a refocus does not bypass it, outdated_hub stops for the session", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
	const limited = () =>
		Promise.reject(
			Object.assign(new Error("slow down"), {
				status: 429,
				retryAfterMs: 10_000,
			}),
		);
	const outdated = () =>
		Promise.reject(
			Object.assign(new Error("old"), { status: 409, code: "outdated_hub" }),
		);
	const fake = readerApi([limited, outdated, typingAnswer([])]);
	const view = await mountReader(t, { ...READER, api: fake.api });
	assert.equal(fake.calls.length, 1);
	// Alt-tab away and back inside the back-off: no extra read.
	await view.rerender({ ...READER, windowActive: false, api: fake.api });
	await view.rerender({ ...READER, api: fake.api });
	await view.tick(9_999);
	assert.equal(fake.calls.length, 1);
	await view.tick(1);
	assert.equal(fake.calls.length, 2);
	await view.tick(600_000);
	assert.equal(fake.calls.length, 2, "outdated_hub: no further reads");
});

/* ------------------------------------------------------------ model + view */

test("names: scoped to the composer, no self, no agents, unresolvable labels skipped, expired dropped", () => {
	const entries = m.typingEntries(
		[
			{
				account_id: "acct_a",
				kind: "human",
				thread_root_id: null,
				expires_in_ms: 5000,
			},
			{
				account_id: "acct_self",
				kind: "human",
				thread_root_id: null,
				expires_in_ms: 5000,
			},
			{
				account_id: "acct_bot",
				kind: "agent",
				thread_root_id: null,
				expires_in_ms: 5000,
			},
			{
				account_id: "acct_ghost",
				kind: "human",
				thread_root_id: null,
				expires_in_ms: 5000,
			},
			{
				account_id: "acct_t",
				kind: "human",
				thread_root_id: "bcm_root",
				expires_in_ms: 5000,
			},
			{
				account_id: "acct_old",
				kind: "human",
				thread_root_id: null,
				expires_in_ms: 10,
			},
		],
		1000,
	);
	const labels = {
		acct_a: "Ana",
		acct_self: "Me",
		acct_bot: "Bot",
		acct_t: "Tom",
		acct_old: "Old",
	};
	const labelFor = (id) => labels[id] ?? null;
	assert.deepEqual(
		m.typingNamesForScope(entries, {
			scope: null,
			now: 2000,
			selfAccountId: "acct_self",
			labelFor,
		}),
		["Ana"],
	);
	assert.deepEqual(
		m.typingNamesForScope(entries, {
			scope: "bcm_root",
			now: 2000,
			selfAccountId: "acct_self",
			labelFor,
		}),
		["Tom"],
	);
});

test("line: 0/1/2/3/4+ typers render the four copy forms with bold names and a fixed one-line box", async (t) => {
	const host = document.createElement("div");
	const root = createRoot(host);
	t.after(() => act(async () => root.unmount()));
	const cases = [
		[[], "", 0],
		[["Sana"], "Sana is typing", 1],
		[["Sana", "Ryan"], "Sana and Ryan are typing", 2],
		[["Sana", "Ryan", "Ana"], "Sana, Ryan and Ana are typing", 3],
		[["Sana", "Ryan", "Ana", "Bo"], "Several people are typing", 0],
	];
	for (const [names, text, bold] of cases) {
		await act(async () =>
			root.render(
				React.createElement(m.TeamBridgeTypingLineView, {
					names,
					scope: "main",
				}),
			),
		);
		const line = host.querySelector("[data-team-bridge-typing]");
		assert.ok(line, "the line is mounted even with nobody typing");
		assert.equal(line.textContent, text);
		assert.equal(line.querySelectorAll("strong").length, bold);
		assert.deepEqual(
			[...line.querySelectorAll("strong")].map((node) => node.textContent),
			bold ? names.slice(0, bold) : [],
		);
		// <output> carries the implicit `status` role.
		assert.equal(line.tagName, "OUTPUT");
		assert.equal(line.getAttribute("aria-live"), "polite");
		assert.equal(line.getAttribute("aria-atomic"), "true");
		assert.match(line.className, FIXED_LINE_CLASS);
		assert.doesNotMatch(line.className, ANIMATION_CLASS);
	}
});

test("contract: the three typing ops validate and map onto the desktop routes", () => {
	const get = m.desktopRequestSchema.parse({
		op: "team_bridge.typing.get",
		conversation_id: "bcv_1",
		tenant_id: "org_1",
	});
	assert.deepEqual(m.desktopEndpoint(get), {
		path: "/v1/desktop/team-bridge/conversations/bcv_1/typing?tenant_id=org_1",
		method: "GET",
	});
	const put = m.desktopRequestSchema.parse({
		op: "team_bridge.typing.set",
		conversation_id: "bcv_1",
		tenant_id: "org_1",
		expected_account_id: "acct_1",
		thread_root_id: "bcm_r",
	});
	assert.deepEqual(m.desktopEndpoint(put), {
		path: "/v1/desktop/team-bridge/conversations/bcv_1/typing",
		method: "PUT",
		body: {
			expected_account_id: "acct_1",
			tenant_id: "org_1",
			thread_root_id: "bcm_r",
		},
	});
	const del = m.desktopRequestSchema.parse({
		op: "team_bridge.typing.clear",
		conversation_id: "bcv_1",
		tenant_id: "org_1",
		expected_account_id: "acct_1",
	});
	assert.deepEqual(m.desktopEndpoint(del), {
		path: "/v1/desktop/team-bridge/conversations/bcv_1/typing?tenant_id=org_1&expected_account_id=acct_1",
		method: "DELETE",
	});
	// The owner guard is required on both writes.
	assert.equal(
		m.desktopRequestSchema.safeParse({
			op: "team_bridge.typing.set",
			conversation_id: "bcv_1",
			tenant_id: "org_1",
		}).success,
		false,
	);
	const share = m.desktopRequestSchema.parse({
		op: "agent_messages.settings.share_typing",
		expected_account_id: "acct_1",
		share_typing: false,
	});
	assert.deepEqual(m.desktopEndpoint(share), {
		path: "/v1/desktop/team-bridge/settings",
		method: "PUT",
		body: { expected_account_id: "acct_1", share_typing: false },
	});
	// Responses: the hub's shapes, a flag-off read, and lop's {shared:false}.
	assert.equal(
		m.teamBridgeTypingStateSchema.parse({
			enabled: false,
			poll_after_ms: 60000,
			typers: [],
		}).enabled,
		false,
	);
	assert.deepEqual(m.teamBridgeTypingHeartbeatSchema.parse({ shared: false }), {
		shared: false,
	});
	assert.equal(
		m.teamBridgeTypingStateSchema.parse({
			enabled: true,
			poll_after_ms: 0,
			typers: [],
		}).poll_after_ms,
		1000,
		"a zero interval is floored, never a hot loop",
	);
});
