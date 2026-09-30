import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * THE SEARCH HOOK'S POLICY — the debounce, the stale-response guard, the ONE
 * follow-up a building index earns, and the cursor arithmetic as the reader
 * meets it.
 *
 * The hook is driven through a real client renderer rather than restated,
 * because its state IS its effects: when the request starts, what an answer
 * does to the list already on screen, and what a conversation switch invalidates.
 * Fake timers are the point rather than a convenience — the contract is
 * "200 ms after the last keystroke" and "exactly one follow-up", and a suite
 * that waited on real clocks would be replaced by one that counts requests.
 * Both `setTimeout` and `Date` are mocked, so the timer arithmetic moves with
 * the ticks.
 *
 * What is faked: the network (`desktopResult`), the shape
 * `use-checkpoints.test.mjs` uses. Everything else is the shipped module.
 */

const bundle = await build({
	stdin: {
		contents: `
			import { createElement } from "react";
			import { useThreadSearch, THREAD_SEARCH_DEBOUNCE_MS, THREAD_SEARCH_FOLLOW_UP_MS } from "./src/renderer/src/features/chat/canonical/use-thread-search";
			export { THREAD_SEARCH_DEBOUNCE_MS, THREAD_SEARCH_FOLLOW_UP_MS };
			/* One client render per mount; every render hands its answer to the tracker, so a test reads the LAST one. */
			export function Harness({ sessionId, enabled, track }) {
				track(useThreadSearch({ sessionId, enabled }));
				return null;
			}
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	jsx: "automatic",
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	mainFields: ["module", "main"],
	conditions: ["import"],
	external: ["react", "react-dom", "react/jsx-runtime"],
	write: false,
	plugins: [
		{
			name: "find-transport-fixture",
			setup(builder) {
				builder.onResolve({ filter: /desktop-api$/ }, () => ({
					path: "transport",
					namespace: "find-fixture",
				}));
				builder.onLoad({ filter: /.*/, namespace: "find-fixture" }, () => ({
					contents:
						"export const desktopResult = (request) => globalThis.__findRequest(request);",
					loader: "js",
				}));
			},
		},
	],
});
// Written beside this file rather than imported as a data: URL, for the reason
// `warm-session.test.mjs` gives: react stays external, and a data: URL has no
// base path from which to resolve it.
const bundlePath = new URL("./_use-thread-search.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { Harness, THREAD_SEARCH_DEBOUNCE_MS, THREAD_SEARCH_FOLLOW_UP_MS } =
	await import(bundlePath.href);
await unlink(bundlePath);
const { createRoot } = await import("react-dom/client");

const SESSION = "abcdef123456";
const OTHER = "eeeeee123456";

/** A 200 with no hits unless a case says otherwise. */
const answer = (over = {}) => ({
	query: "q",
	state: "ready",
	partial: false,
	hits: [],
	truncated: false,
	...over,
});

const hit = (id, over = {}) => ({
	id,
	role: "user",
	ts: 1780000000,
	snippet: `about ${id}`,
	ranges: [],
	tier: "exact",
	...over,
});

/**
 * A scripted backend. An array answers step by step, the last entry repeating;
 * a function answers per request; an `Error` is thrown (a failing route).
 */
function backend(script) {
	const requests = [];
	let index = 0;
	globalThis.__findRequest = async (request) => {
		requests.push(request);
		const step =
			typeof script === "function"
				? script(request)
				: Array.isArray(script)
					? script[Math.min(index, script.length - 1)]
					: script;
		index += 1;
		if (step instanceof Error) throw step;
		return step;
	};
	return requests;
}

/**
 * A backend whose answers are resolved BY THE TEST, in whatever order it
 * chooses — the only way to hand the hook two answers out of order.
 */
function deferredBackend() {
	const requests = [];
	const pending = [];
	globalThis.__findRequest = (request) =>
		new Promise((resolve, reject) => {
			requests.push(request);
			pending.push({ resolve, reject });
		});
	return {
		requests,
		resolve: (index, value) => pending[index].resolve(value),
		reject: (index, error) => pending[index].reject(error),
	};
}

/** console.warn capture, since the hook's failure contract is one warn. */
function captureWarnings() {
	const warns = [];
	const original = console.warn;
	console.warn = (...args) => {
		warns.push(args[0]);
	};
	return {
		warns,
		restore: () => {
			console.warn = original;
		},
	};
}

/** A DOM and a root for one case, rendering the probe harness. */
async function mountHook(initial) {
	const dom = new JSDOM("<!doctype html><div id='root'></div>", {
		url: "http://localhost/",
	});
	const { window } = dom;
	const originals = new Map();
	const shims = {
		window,
		document: window.document,
		IS_REACT_ACT_ENVIRONMENT: true,
	};
	for (const [name, value] of Object.entries(shims)) {
		originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
		Object.defineProperty(globalThis, name, {
			configurable: true,
			writable: true,
			value,
		});
	}
	const root = createRoot(window.document.getElementById("root"));
	let latest = null;
	const track = (result) => {
		latest = result;
	};
	const render = async (props) => {
		await act(async () => {
			root.render(React.createElement(Harness, { ...props, track }));
		});
	};
	await render(initial);
	return {
		latest: () => latest,
		flush: async () => {
			await act(async () => {});
		},
		render,
		close: async () => {
			await act(async () => {
				root.unmount();
			});
			for (const [name, descriptor] of originals) {
				if (descriptor) Object.defineProperty(globalThis, name, descriptor);
				else Reflect.deleteProperty(globalThis, name);
			}
			dom.window.close();
		},
	};
}

const type = async (search, text) => {
	await act(async () => {
		search.latest().setQuery(text);
	});
};

/**
 * Advance the mocked clock INSIDE `act`. A tick runs the debounce timer, whose
 * callback asks — a synchronous state update, so the test has to be inside the
 * renderer's act scope for it (the sibling hook suite's zero act warnings come
 * from the same discipline).
 */
const tick = async (t, ms) => {
	await act(async () => {
		t.mock.timers.tick(ms);
	});
};

test("the box is debounced: one request per settled value, and the answer lands", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
	const requests = backend([answer({ query: "led", hits: [hit("m1")] })]);
	const search = await mountHook({ sessionId: SESSION, enabled: true });
	try {
		await type(search, "le");
		await tick(t, THREAD_SEARCH_DEBOUNCE_MS - 1);
		await search.flush();
		assert.equal(
			requests.length,
			0,
			"nothing is asked inside the debounce window",
		);
		await tick(t, 1);
		await search.flush();
		assert.equal(requests.length, 1);
		assert.deepEqual(requests[0], {
			op: "sessions.find",
			sessionId: SESSION,
			q: "le",
			limit: 100,
		});
		assert.equal(search.latest().state, "ready");
		assert.deepEqual(
			search.latest().hits.map((entry) => entry.id),
			["m1"],
		);
	} finally {
		await search.close();
	}
});

test("a keystroke re-arms the debounce: the settled value is the last one", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
	const requests = backend(answer);
	const search = await mountHook({ sessionId: SESSION, enabled: true });
	try {
		await type(search, "l");
		await tick(t, 150);
		await type(search, "le");
		await tick(t, 150);
		await search.flush();
		assert.equal(
			requests.length,
			0,
			"the second keystroke restarted the window",
		);
		await tick(t, THREAD_SEARCH_DEBOUNCE_MS - 150);
		await search.flush();
		assert.equal(requests.length, 1);
		assert.equal(requests[0].q, "le");
	} finally {
		await search.close();
	}
});

test("while a request is in flight the state is loading and the previous list is kept", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
	const deferred = deferredBackend();
	const search = await mountHook({ sessionId: SESSION, enabled: true });
	try {
		await type(search, "ledger");
		await tick(t, THREAD_SEARCH_DEBOUNCE_MS);
		await search.flush();
		deferred.resolve(0, answer({ query: "ledger", hits: [hit("m1")] }));
		await search.flush();
		assert.equal(search.latest().state, "ready");

		// A narrower question: the list keeps the previous answer's rows while
		// the next request runs, and the state says a request is out.
		await type(search, "ledger recon");
		await tick(t, THREAD_SEARCH_DEBOUNCE_MS);
		await search.flush();
		assert.equal(search.latest().state, "loading");
		assert.deepEqual(
			search.latest().hits.map((entry) => entry.id),
			["m1"],
			"a list that blanks on every keystroke reads slower than it is",
		);
		deferred.resolve(1, answer({ query: "ledger recon", hits: [] }));
		await search.flush();
		assert.equal(search.latest().state, "ready");
		assert.deepEqual(search.latest().hits, []);
	} finally {
		await search.close();
	}
});

test("a stale answer cannot land: only the newest ask's answer is applied", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
	const deferred = deferredBackend();
	const search = await mountHook({ sessionId: SESSION, enabled: true });
	try {
		await type(search, "led");
		await tick(t, THREAD_SEARCH_DEBOUNCE_MS);
		await search.flush();
		await type(search, "ledger");
		await tick(t, THREAD_SEARCH_DEBOUNCE_MS);
		await search.flush();
		assert.equal(deferred.requests.length, 2);

		// The SECOND answer lands first, the first arrives after it.
		deferred.resolve(1, answer({ query: "ledger", hits: [hit("m2")] }));
		await search.flush();
		assert.deepEqual(
			search.latest().hits.map((entry) => entry.id),
			["m2"],
		);
		deferred.resolve(0, answer({ query: "led", hits: [hit("m1")] }));
		await search.flush();
		assert.deepEqual(
			search.latest().hits.map((entry) => entry.id),
			["m2"],
			"the question the reader moved on from cannot overwrite the answer they are reading",
		);
		assert.equal(search.latest().state, "ready");
	} finally {
		await search.close();
	}
});

test("an empty box drops the answer immediately, without a request or a debounce", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
	const requests = backend(answer({ hits: [hit("m1")] }));
	const search = await mountHook({ sessionId: SESSION, enabled: true });
	try {
		await type(search, "ledger");
		await tick(t, THREAD_SEARCH_DEBOUNCE_MS);
		await search.flush();
		assert.equal(search.latest().state, "ready");
		await type(search, "");
		await search.flush();
		assert.equal(search.latest().state, "idle");
		assert.deepEqual(search.latest().hits, []);
		assert.equal(requests.length, 1, "clearing the box spends nothing");
	} finally {
		await search.close();
	}
});

test("closing the panel drops the question and any in-flight answer; reopening starts fresh", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
	const deferred = deferredBackend();
	const search = await mountHook({ sessionId: SESSION, enabled: true });
	try {
		await type(search, "ledger");
		await tick(t, THREAD_SEARCH_DEBOUNCE_MS);
		await search.flush();
		assert.equal(deferred.requests.length, 1);

		await search.render({ sessionId: SESSION, enabled: false });
		await search.flush();
		assert.equal(search.latest().state, "idle");
		assert.equal(search.latest().query, "", "a closed panel keeps no question");

		// The answer to the question nobody is asking any more must not land.
		deferred.resolve(0, answer({ query: "ledger", hits: [hit("m1")] }));
		await search.flush();
		assert.equal(search.latest().state, "idle");
		assert.deepEqual(search.latest().hits, []);

		await search.render({ sessionId: SESSION, enabled: true });
		await search.flush();
		assert.equal(search.latest().state, "idle");
		assert.equal(search.latest().query, "");
	} finally {
		await search.close();
	}
});

test("a conversation switch clears the box and re-bases the search", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
	const deferred = deferredBackend();
	const search = await mountHook({ sessionId: SESSION, enabled: true });
	try {
		await type(search, "ledger");
		await tick(t, THREAD_SEARCH_DEBOUNCE_MS);
		await search.flush();
		assert.equal(deferred.requests[0].sessionId, SESSION);

		await search.render({ sessionId: OTHER, enabled: true });
		await search.flush();
		assert.equal(
			search.latest().query,
			"",
			"a question does not cross conversations",
		);

		deferred.resolve(0, answer({ query: "ledger", hits: [hit("m1")] }));
		await search.flush();
		assert.deepEqual(
			search.latest().hits,
			[],
			"the old conversation's answer cannot land",
		);

		await type(search, "recon");
		await tick(t, THREAD_SEARCH_DEBOUNCE_MS);
		await search.flush();
		assert.equal(deferred.requests[1].sessionId, OTHER);
	} finally {
		await search.close();
	}
});

test("a building index earns exactly one follow-up; the reader's retry resets the latch", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
	const requests = backend([
		answer({ state: "building", partial: false, hits: [] }),
		answer({ state: "building", partial: false, hits: [] }),
		answer({ query: "ledger", hits: [hit("m1")] }),
	]);
	const search = await mountHook({ sessionId: SESSION, enabled: true });
	try {
		await type(search, "ledger");
		await tick(t, THREAD_SEARCH_DEBOUNCE_MS);
		await search.flush();
		assert.equal(search.latest().state, "building");

		// ONE follow-up, after the delay — and only one, however long the test waits.
		await tick(t, THREAD_SEARCH_FOLLOW_UP_MS);
		await search.flush();
		assert.equal(requests.length, 2, "the building state earns one re-ask");
		assert.equal(search.latest().state, "building");
		await tick(t, THREAD_SEARCH_FOLLOW_UP_MS * 4);
		await search.flush();
		assert.equal(
			requests.length,
			2,
			"never a poll: the index's own ceiling is not a loop",
		);

		// The reader's own gesture asks again, and a ready answer lands.
		await act(async () => {
			search.latest().refresh();
		});
		await search.flush();
		assert.equal(requests.length, 3);
		assert.equal(search.latest().state, "ready");
		assert.deepEqual(
			search.latest().hits.map((entry) => entry.id),
			["m1"],
		);
	} finally {
		await search.close();
	}
});

test("unsupported is a fact about the conversation, not an error, and it is never re-asked", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
	const requests = backend(answer({ state: "unsupported" }));
	const search = await mountHook({ sessionId: SESSION, enabled: true });
	try {
		await type(search, "ledger");
		await tick(t, THREAD_SEARCH_DEBOUNCE_MS);
		await search.flush();
		assert.equal(search.latest().state, "unsupported");
		await tick(t, THREAD_SEARCH_FOLLOW_UP_MS * 4);
		await search.flush();
		assert.equal(
			requests.length,
			1,
			"a peer's journal does not appear by asking again",
		);
	} finally {
		await search.close();
	}
});

test("a failure is a stated state: one warn per generation, no list, and a retry that asks again", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
	const capture = captureWarnings();
	const requests = backend(new Error("404: unknown route"));
	const search = await mountHook({ sessionId: SESSION, enabled: true });
	try {
		await type(search, "ledger");
		await tick(t, THREAD_SEARCH_DEBOUNCE_MS);
		await search.flush();
		assert.equal(search.latest().state, "error");
		assert.deepEqual(search.latest().hits, []);
		assert.equal(capture.warns.length, 1);

		await act(async () => {
			search.latest().refresh();
		});
		await search.flush();
		assert.equal(requests.length, 2, "the retry asks again");
		assert.equal(
			capture.warns.length,
			1,
			"the same failure speaks once per generation",
		);
	} finally {
		await search.close();
		capture.restore();
	}
});

test("the cursor resets to the best-ranked row per answer, wraps, and empties with the list", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
	const requests = backend([
		answer({ query: "ledger", hits: [hit("m1"), hit("m2"), hit("m3")] }),
		answer({ query: "ledger x", hits: [] }),
	]);
	const search = await mountHook({ sessionId: SESSION, enabled: true });
	try {
		await type(search, "ledger");
		await tick(t, THREAD_SEARCH_DEBOUNCE_MS);
		await search.flush();
		assert.equal(search.latest().cursor, 0);
		assert.equal(search.latest().activeHit.id, "m1");

		await act(async () => {
			search.latest().moveCursor(1);
		});
		assert.equal(search.latest().cursor, 1);
		await act(async () => {
			search.latest().moveCursor(-1);
		});
		await act(async () => {
			search.latest().moveCursor(-1);
		});
		assert.equal(
			search.latest().cursor,
			2,
			"back from the top wraps to the last",
		);

		// A new answer re-points the cursor at the new ranking's best row.
		await type(search, "ledger x");
		await tick(t, THREAD_SEARCH_DEBOUNCE_MS);
		await search.flush();
		assert.equal(search.latest().cursor, -1);
		assert.equal(search.latest().activeHit, null);
		assert.equal(requests.length, 2);
	} finally {
		await search.close();
	}
});
