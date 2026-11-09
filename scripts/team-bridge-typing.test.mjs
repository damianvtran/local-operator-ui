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
		export {DesktopControlError} from './src/renderer/src/shared/api/local-operator/desktop-api';
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
	["a send starting", (view) => view.handle.current.onSendStart()],
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

/**
 * The refusal `desktopResult` builds from lop's 429 body: `detail.retry_after_ms`
 * becomes `retryAfterMs` and the body rides along as `detail` (lop PR #3689
 * sends the int ms beside `retry_after_seconds`). `ms: undefined` is the older
 * lop that sent only seconds.
 */
function rateLimited({ ms, seconds }) {
	const detail = {
		code: "rate_limited",
		message: "Slow down",
		...(ms === undefined ? {} : { retry_after_ms: ms }),
		retry_after_seconds: seconds,
	};
	return new m.DesktopControlError(
		429,
		detail.message,
		undefined,
		detail.code,
		detail.retry_after_ms,
		detail,
	);
}

test("model: typingRetryAfterMs reads retry_after_ms, then retry_after_seconds", () => {
	assert.equal(
		m.typingRetryAfterMs(rateLimited({ ms: 2500, seconds: 3 })),
		2500,
	);
	assert.equal(m.typingRetryAfterMs(rateLimited({ seconds: 7 })), 7000);
	assert.equal(m.typingRetryAfterMs(new Error("plain")), undefined);
	assert.equal(m.typingRetryAfterMs(null), undefined);
});

test("emitter: a DELETE never overtakes a PUT still in flight (QA Q1)", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
	const calls = [];
	let answerPut;
	const api = {
		typingSet: () => {
			calls.push("PUT sent");
			return new Promise((resolve) => {
				answerPut = () => {
					calls.push("PUT answered");
					resolve({ ttl_ms: 8000, resend_after_ms: 3000 });
				};
			});
		},
		typingClear: () => {
			calls.push("DELETE sent");
			return Promise.resolve();
		},
	};
	const view = await mountEmitter(t, { api });
	await act(async () => view.handle.current.onInput("draft"));
	await act(async () => view.handle.current.onBlur());
	assert.deepEqual(calls, ["PUT sent"], "the DELETE waits for the PUT");
	await view.tick(600);
	await act(async () => {
		answerPut();
		await flush();
	});
	assert.deepEqual(calls, ["PUT sent", "PUT answered", "DELETE sent"]);
});

test("emitter: no PUT leaves while a send is in flight, typing resumes after it settles", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
	const fake = emitterApi();
	const view = await mountEmitter(t, { api: fake.api });
	await act(async () => view.handle.current.onInput("hello"));
	await view.tick(1000);
	await act(async () => view.handle.current.onSendStart());
	assert.equal(fake.deletes().length, 1);
	// Keystrokes while the message request is out never heartbeat.
	await act(async () => view.handle.current.onInput("hello again"));
	await view.tick(10_000);
	assert.equal(fake.puts().length, 1, "no PUT while sending");
	await act(async () => view.handle.current.onSendEnd());
	await act(async () => view.handle.current.onInput("next"));
	assert.equal(fake.puts().length, 2, "the next keystroke reports again");
});

test("emitter: the resend throttle is per target - a new conversation PUTs at once (R3)", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
	const fake = emitterApi({ ttl_ms: 8000, resend_after_ms: 10_000 });
	const view = await mountEmitter(t, { api: fake.api });
	await act(async () => view.handle.current.onInput("a"));
	await view.tick(500);
	const other = { ...TARGET, conversationId: "bcv_typing02" };
	await view.rerender({ target: other, text: "", api: fake.api });
	await act(async () => view.handle.current.onInput("b"));
	assert.equal(fake.puts().length, 2);
	assert.equal(fake.puts()[1].target.conversationId, "bcv_typing02");
	assert.equal(fake.puts()[1].at, 500, "no inherited remainder");
	// And the old room's server cadence (10 s) is not inherited either.
	await view.tick(3000);
	assert.equal(fake.puts().length, 3, "default 3 s resend for the new target");
});

test("emitter: a 429 from an older lop (retry_after_seconds only) holds PUTs that long", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
	const calls = [];
	const api = {
		typingSet: () => {
			calls.push(Date.now());
			return calls.length === 1
				? Promise.reject(rateLimited({ seconds: 4 }))
				: Promise.resolve({ ttl_ms: 8000, resend_after_ms: 3000 });
		},
		typingClear: () => Promise.resolve(),
	};
	const view = await mountEmitter(t, { api });
	await act(async () => {
		view.handle.current.onInput("a");
		await flush();
	});
	await view.tick(3999);
	await act(async () => view.handle.current.onInput("ab"));
	assert.equal(calls.length, 1, "inside the 4 s wait");
	await view.tick(1);
	await act(async () => view.handle.current.onInput("abc"));
	assert.equal(calls.length, 2);
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
		Promise.reject(rateLimited({ ms: 10_000, seconds: 10 }));
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

test("reader: a 429 from an older lop (retry_after_seconds only) waits that long, not a minute", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
	const fake = readerApi([
		() => Promise.reject(rateLimited({ seconds: 5 })),
		typingAnswer([]),
	]);
	const view = await mountReader(t, { ...READER, api: fake.api });
	await view.tick(4_999);
	assert.equal(fake.calls.length, 1);
	await view.tick(1);
	assert.equal(fake.calls.length, 2);
});

test("reader: a transient failure retries at the poll pace, doubling to the 60 s cap (N1)", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
	const blip = () =>
		Promise.reject(new m.DesktopControlError(502, "Bad gateway"));
	const offline = () =>
		Promise.reject(new m.DesktopControlError(null, "Network down"));
	const fake = readerApi([
		typingAnswer([]),
		blip,
		offline,
		blip,
		blip,
		blip,
		blip,
		blip,
		typingAnswer([]),
		blip,
		typingAnswer([]),
	]);
	await mountReader(t, { ...READER, api: fake.api });
	const view = {
		tick: async (ms) =>
			act(async () => {
				t.mock.timers.tick(ms);
				await flush();
			}),
	};
	// Read times (ms): 0 ok, 3000 blip, then +3, +6, +12, +24, +48, +60 (capped).
	for (let i = 0; i < 230; i += 1) await view.tick(1000);
	const at = fake.calls.map((call) => call.at);
	assert.deepEqual(
		at.slice(0, 9),
		[0, 3000, 6000, 12_000, 24_000, 48_000, 96_000, 156_000, 216_000],
	);
	// A success resets the doubling: the next blip waits one poll again.
	assert.equal(at[9], 219_000, "one poll after the success (a blip)");
	assert.equal(
		at[10],
		222_000,
		"first blip after a success waits one poll, not 60 s",
	);
});

test("reader: a refocus inside the poll interval waits out the remainder (R5)", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
	const fake = readerApi([typingAnswer([])]);
	const view = await mountReader(t, { ...READER, api: fake.api });
	assert.equal(fake.calls.length, 1);
	await view.tick(1000);
	for (let i = 0; i < 5; i += 1) {
		await view.rerender({ ...READER, windowActive: false, api: fake.api });
		await view.rerender({ ...READER, api: fake.api });
	}
	await act(async () => flush());
	assert.equal(fake.calls.length, 1, "rapid alt-tabbing sends no GET");
	await view.tick(1999);
	assert.equal(fake.calls.length, 1);
	await view.tick(1);
	assert.equal(fake.calls.length, 2, "the read lands at poll_after_ms");
	// Away longer than the interval: the return reads at once.
	await view.rerender({ ...READER, windowActive: false, api: fake.api });
	await view.tick(10_000);
	await view.rerender({ ...READER, api: fake.api });
	await act(async () => flush());
	assert.equal(fake.calls.length, 3);
});

test("reader: switching conversation drops the old room's typers on that render (R2)", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
	const typer = {
		account_id: "acct_sana",
		kind: "human",
		thread_root_id: null,
		expires_in_ms: 8000,
	};
	const fake = readerApi([
		typingAnswer([typer]),
		// The new room's first read never answers: nothing may linger meanwhile.
		() => new Promise(() => {}),
	]);
	const renders = [];
	const host = document.createElement("div");
	const root = createRoot(host);
	function Harness(p) {
		const state = m.useTeamBridgeTyping(p);
		renders.push({
			conversationId: p.conversationId,
			count: state.entries.length,
		});
		return null;
	}
	const render = (p) =>
		act(async () => root.render(React.createElement(Harness, p)));
	t.after(() => act(async () => root.unmount()));
	await render({ ...READER, api: fake.api });
	await act(async () => flush());
	assert.equal(renders.at(-1).count, 1);
	await render({ ...READER, conversationId: "bcv_other", api: fake.api });
	await act(async () => flush());
	assert.equal(fake.calls.length, 2, "the new room is read at once");
	assert.deepEqual(
		renders.filter((r) => r.conversationId === "bcv_other").map((r) => r.count),
		renders.filter((r) => r.conversationId === "bcv_other").map(() => 0),
		"no render of the new room ever shows the old room's typer",
	);
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
