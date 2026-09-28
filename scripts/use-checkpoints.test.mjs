import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * THE CHECKPOINT HOOK'S POLICY — one manifest read, a bounded warm, and the
 * poll that waits only for what the reader asked about (design D2/D5/D10).
 *
 * The hook is driven through a real client renderer rather than restated,
 * because its state IS its effects: when the fetch starts, when the poll arms
 * and disarms, and what a failure does to the manifest already on screen.
 * `renderToStaticMarkup` — what `warm-session.test.mjs` uses for its
 * effect-free twin — would run none of that.
 *
 * Fake timers are the point, not a convenience: the poll's contract is
 * "1.5 s apart, ~45 s at most", and a suite that literally waited 45 s would
 * be replaced by one that counts requests. Both `setTimeout` and `Date` are
 * mocked, so the deadline arithmetic moves with the ticks.
 */

const bundle = await build({
	stdin: {
		contents: `
			import { createElement } from "react";
			import { useCheckpoints } from "./src/renderer/src/features/chat/canonical/use-checkpoints";
			export { CHECKPOINT_POLL_INTERVAL_MS, CHECKPOINT_POLL_CEILING_MS } from "./src/renderer/src/features/chat/canonical/use-checkpoints";
			/*
			 * The probe: one client render per mount, and every render hands its
			 * answer to the tracker so a test reads the LAST one after any
			 * sequence of interactions.
			 */
			export function Harness({ sessionId, track }) {
				track(useCheckpoints(sessionId));
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
			name: "checkpoints-transport-fixture",
			setup(builder) {
				// Only the network is faked, as `warm-session.test.mjs` does: the
				// rest of the real module stays real, and `desktopResult` becomes
				// this file's scripted backend.
				builder.onResolve({ filter: /desktop-api$/ }, () => ({
					path: "transport",
					namespace: "checkpoints-fixture",
				}));
				builder.onLoad(
					{ filter: /.*/, namespace: "checkpoints-fixture" },
					() => ({
						contents: `export * from ${JSON.stringify(
							`${process.cwd()}/src/renderer/src/shared/api/local-operator/desktop-api.ts`,
						)}
export const desktopResult = (request) => globalThis.__checkpointRequest(request);`,
						loader: "js",
						resolveDir: process.cwd(),
					}),
				);
			},
		},
	],
});
// Written beside this file rather than imported as a data: URL, for the reason
// `warm-session.test.mjs` gives: react stays external, and a data: URL has no
// base path from which to resolve it.
const bundlePath = new URL("./_use-checkpoints.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { Harness, CHECKPOINT_POLL_INTERVAL_MS } = await import(bundlePath.href);
await unlink(bundlePath);
const { createRoot } = await import("react-dom/client");

/** A manifest around a checkpoint list, with a ready index unless asked. */
const manifest = (checkpoints, index = { state: "ready" }) => ({
	session_id: "s1",
	index,
	checkpoints,
});

const user = (over = {}) => ({
	id: "u1",
	kind: "user",
	turn: 1,
	ts: 1780000000,
	seq: 10,
	text: "a message",
	...over,
});

const completion = (over = {}) => ({
	id: "c1",
	kind: "completion",
	turn: 1,
	ts: 1780000001,
	seq: 50,
	text: "an answer",
	naming: { state: "pending", name: null, summary: null },
	...over,
});

/**
 * A scripted backend. An array answers step by step, the last entry repeating
 * for a case that runs off the end; a function answers per request, for a test
 * whose op decides the shape. Every request is recorded. An answer that is an
 * `Error` is thrown, which is how a case models a missing route.
 */
function backend(script) {
	const requests = [];
	let index = 0;
	globalThis.__checkpointRequest = async (request) => {
		requests.push(request);
		let step;
		if (typeof script === "function") {
			step = script(request);
		} else if (Array.isArray(script)) {
			step = script[Math.min(index, script.length - 1)];
			index += 1;
		} else {
			// One answer for every request: an `Error` here models a route the
			// installed backend simply does not have.
			step = script;
		}
		if (step instanceof Error) throw step;
		return step;
	};
	return requests;
}

/** console.warn capture, since the hook's degradation contract is one warn. */
function captureWarnings() {
	const warns = [];
	const original = console.warn;
	console.warn = (...args) => {
		warns.push(args);
	};
	return {
		warns,
		restore: () => {
			console.warn = original;
		},
	};
}

/**
 * A DOM and a root for one case, rendering the probe harness; the tracker hands
 * every render's result to the test.
 */
async function mountHook(sessionId) {
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
	const render = async (id) => {
		await act(async () => {
			root.render(React.createElement(Harness, { sessionId: id, track }));
		});
	};
	await render(sessionId);
	return {
		latest: () => latest,
		flush: async () => {
			await act(async () => {});
		},
		switchTo: async (id) => {
			await render(id);
		},
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

test("the manifest is read once per conversation and its checkpoints surface", async () => {
	const checkpoints = [user(), completion()];
	const requests = backend([manifest(checkpoints)]);
	const rail = await mountHook("s1");
	try {
		assert.equal(rail.latest().state, "ready");
		assert.equal(rail.latest().building, false);
		assert.deepEqual(rail.latest().checkpoints, checkpoints);
		assert.deepEqual(requests, [
			{ op: "sessions.checkpoints", sessionId: "s1" },
		]);
	} finally {
		await rail.close();
	}
});

test("a missing op degrades without spamming: one warn per failure per conversation", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
	const capture = captureWarnings();
	const requests = backend(new Error("404: unknown route"));
	const rail = await mountHook("s1");
	try {
		assert.equal(rail.latest().state, "error");
		assert.equal(rail.latest().building, false);
		assert.deepEqual(rail.latest().checkpoints, []);
		assert.equal(capture.warns.length, 1, "the load failure speaks once");
		/* A refresh while already broken keeps the state and does not re-log. */
		await act(async () => {
			rail.latest().refresh();
		});
		await rail.flush();
		assert.equal(rail.latest().state, "error");
		assert.equal(capture.warns.length, 1, "the sentence is latched");
		/*
		 * A warm failure is dropped the same way: decoration lost, no crash —
		 * and it speaks ONCE in its own words, because a naming failure and a
		 * hidden rail are different facts. Repeats stay silent either way.
		 */
		await act(async () => {
			rail.latest().warm(["c1"]);
		});
		await rail.flush();
		assert.equal(
			rail.latest().state,
			"error",
			"a warm cannot un-hide the rail",
		);
		assert.equal(capture.warns.length, 2);
		await act(async () => {
			rail.latest().warm(["c1"]);
			rail.latest().refresh();
		});
		await rail.flush();
		assert.equal(capture.warns.length, 2, "neither sentence repeats");
		/* A new conversation earns its own latches. */
		await rail.switchTo("s2");
		assert.equal(rail.latest().state, "error");
		assert.equal(capture.warns.length, 3);
		assert.equal(requests.at(-1).sessionId, "s2");
	} finally {
		capture.restore();
		await rail.close();
	}
});

test("a refresh failure keeps the last manifest in view", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
	const checkpoints = [user(), completion()];
	const requests = backend([manifest(checkpoints), new Error("blip")]);
	const capture = captureWarnings();
	const rail = await mountHook("s1");
	try {
		await act(async () => {
			rail.latest().refresh();
		});
		await rail.flush();
		assert.equal(rail.latest().state, "ready", "the viewer keeps what it had");
		assert.deepEqual(rail.latest().checkpoints, checkpoints);
		assert.equal(capture.warns.length, 1);
		assert.equal(requests.length, 2);
	} finally {
		capture.restore();
		await rail.close();
	}
});

test("warm is bounded, and the poll stops when the pending set empties", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
	const many = Array.from({ length: 20 }, (_, i) => `id-${i}`);
	/*
	 * A per-op backend rather than a script: the FIRST manifest read shows the
	 * naming pending, every read after it is settled, and both warm arms answer
	 * with a proper accepted/pending pair — a script that ran out would feed a
	 * warm request a manifest and the shape error would drown the assertions
	 * (it did, before this comment).
	 */
	let reads = 0;
	const requests = backend((request) => {
		if (request.op === "sessions.checkpoints.warm") {
			return { accepted: ["c1"], pending: ["c1"] };
		}
		reads += 1;
		return manifest([
			user(),
			completion(
				reads === 1
					? {}
					: { naming: { state: "ready", name: "Named", summary: "" } },
			),
		]);
	});
	const rail = await mountHook("s1");
	try {
		await act(async () => {
			rail.latest().warm(many);
		});
		await rail.flush();
		assert.equal(requests.length, 2, "warm answered before any poll");
		assert.equal(requests[1].op, "sessions.checkpoints.warm");
		assert.equal(
			requests[1].ids.length,
			16,
			"the hover/open arm is clamped to the wire bound",
		);
		/* One interval later the poll carries the settled name. */
		t.mock.timers.tick(CHECKPOINT_POLL_INTERVAL_MS);
		await rail.flush();
		assert.equal(requests.length, 3);
		assert.equal(requests[2].op, "sessions.checkpoints");
		/* The set is empty now: further intervals arm no further reads. */
		t.mock.timers.tick(CHECKPOINT_POLL_INTERVAL_MS * 3);
		await rail.flush();
		assert.equal(requests.length, 3, "the poll stops when the set empties");
		/* The no-ids arm omits both fields, so the backend's default applies. */
		await act(async () => {
			rail.latest().warm();
		});
		await rail.flush();
		assert.equal(requests.length, 4);
		assert.deepEqual(requests[3], {
			op: "sessions.checkpoints.warm",
			sessionId: "s1",
		});
	} finally {
		await rail.close();
	}
});

test("the poll stops at its 45s ceiling, and a later gesture may ask again", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
	const pendingManifest = manifest([completion()]);
	const requests = backend((request) =>
		request.op === "sessions.checkpoints.warm"
			? { accepted: ["c1"], pending: ["c1"] }
			: pendingManifest,
	);
	const rail = await mountHook("s1");
	try {
		await act(async () => {
			rail.latest().warm(["c1"]);
		});
		await rail.flush();
		assert.equal(requests.length, 2, "mount read plus the warm");
		/*
		 * 45 s at 1.5 s intervals: the 30th tick lands exactly on the deadline
		 * and stops, so ticks 1..29 poll — 29 reads after the first two calls.
		 */
		for (let i = 0; i < 30; i++) {
			t.mock.timers.tick(CHECKPOINT_POLL_INTERVAL_MS);
			await rail.flush();
		}
		assert.equal(requests.length, 31, "29 polls, then the ceiling");
		/* Nothing more is owed: further time changes nothing. */
		for (let i = 0; i < 5; i++) {
			t.mock.timers.tick(CHECKPOINT_POLL_INTERVAL_MS);
			await rail.flush();
		}
		assert.equal(requests.length, 31);
		/* A fresh gesture opens a fresh episode, ceiling and all. */
		await act(async () => {
			rail.latest().warm(["c1"]);
		});
		await rail.flush();
		assert.equal(requests.length, 32);
		t.mock.timers.tick(CHECKPOINT_POLL_INTERVAL_MS);
		await rail.flush();
		assert.equal(requests.length, 33, "the new episode polls again");
	} finally {
		await rail.close();
	}
});

test("switching conversations drops the previous poll with the session", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
	const requests = backend((request) =>
		request.op === "sessions.checkpoints.warm"
			? { accepted: ["c1"], pending: ["c1"] }
			: manifest([completion()], { state: "building" }),
	);
	const rail = await mountHook("s1");
	try {
		assert.equal(rail.latest().building, true, "a building index shows");
		await act(async () => {
			rail.latest().warm(["c1"]);
		});
		await rail.flush();
		const before = requests.length;
		await rail.switchTo("s2");
		const afterSwitch = requests.length;
		assert.ok(afterSwitch > before, "the new conversation reads its own");
		t.mock.timers.tick(CHECKPOINT_POLL_INTERVAL_MS * 4);
		await rail.flush();
		assert.deepEqual(
			requests.slice(afterSwitch).map((request) => request.sessionId),
			Array(requests.length - afterSwitch).fill("s2"),
			"nothing after the switch addresses the old conversation",
		);
	} finally {
		await rail.close();
	}
});
