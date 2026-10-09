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
			 * The manifest MEMORY is window state, and it survives a mount -
			 * which is exactly what most of the arms here must not inherit: each
			 * scripts a window's own first read (of a working op, of a missing
			 * one, of a blip). freshWindow is how an arm says so, and the arms
			 * that are ABOUT the memory do not call it.
			 */
			export { __resetCheckpointManifestCache, CHECKPOINT_MANIFEST_FRESH_MS, loadCheckpointManifest } from "./src/renderer/src/features/chat/canonical/checkpoint-manifest-cache";
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
const {
	Harness,
	CHECKPOINT_POLL_INTERVAL_MS,
	__resetCheckpointManifestCache,
	CHECKPOINT_MANIFEST_FRESH_MS,
	loadCheckpointManifest,
} = await import(bundlePath.href);
await unlink(bundlePath);
const { createRoot } = await import("react-dom/client");

/**
 * Start this arm's window with no manifest memory at all.
 *
 * Called by every arm that scripts its own first read (which is all of them but
 * the memory arm): without it, one test's successful answer would seed the next
 * test's first render, and the assertion it makes about a failing read would be
 * about a window that had already read successfully.
 */
const freshWindow = () => __resetCheckpointManifestCache();

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
	freshWindow();
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
	freshWindow();
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
	freshWindow();
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
	freshWindow();
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
	freshWindow();
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
	freshWindow();
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

test("a read resolving after unmount neither applies nor re-arms a poll", async (t) => {
	/*
	 * Review round 1, M1: the cleanup stopped the loop but never invalidated the
	 * epoch, so an in-flight read resolving after unmount fell through its
	 * guard unchanged, applied its answer, and the re-arm started a fresh poll
	 * episode for a conversation no longer on screen (up to the 45 s ceiling).
	 *
	 * The held promise is the reproduction: the SECOND manifest read — the
	 * poll's — stays pending while the component unmounts, and is then resolved
	 * with an answer that still names `c1` pending. With the latch in place the
	 * continuation must drop at its guard; without it, requests grow again
	 * within two intervals. The count is the assertion because it is the only
	 * observable the defect has.
	 */
	t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
	freshWindow();
	let releaseHeld = null;
	let reads = 0;
	const requests = backend((request) => {
		if (request.op === "sessions.checkpoints.warm") {
			return { accepted: ["c1"], pending: ["c1"] };
		}
		reads += 1;
		if (reads === 1) return manifest([completion()]);
		return new Promise((resolve) => {
			releaseHeld = () => {
				resolve(manifest([completion()]));
			};
		});
	});
	const rail = await mountHook("s1");
	try {
		await act(async () => {
			rail.latest().warm(["c1"]);
		});
		await rail.flush();
		/* One interval in, the poll's read goes out and is held. */
		t.mock.timers.tick(CHECKPOINT_POLL_INTERVAL_MS);
		await rail.flush();
		assert.ok(releaseHeld, "the poll's read is in flight");
		/* The pane unmounts while that read is still pending... */
		await rail.close();
		/* ...and the read lands anyway. */
		await act(async () => {
			releaseHeld();
		});
		const settled = requests.length;
		t.mock.timers.tick(CHECKPOINT_POLL_INTERVAL_MS * 3);
		await rail.flush();
		assert.equal(
			requests.length,
			settled,
			"a post-unmount read must not re-arm a poll episode",
		);
	} finally {
		await rail.close().catch(() => {});
	}
});

test("a manifest this window already holds: the rail paints from it, and a failed re-read cannot blank it", async (t) => {
	/*
	 * THE MEMORY, and the two claims it makes (first-paint audit, F10's sibling:
	 * the rail used to be drawn one round trip after the rows, on every open).
	 *
	 * 1. A conversation this window has read paints its ticks from the first
	 *    render — the mount below is measured with NO answer scripted yet, so a
	 *    "ready" state and a non-empty tick list can only have come from the
	 *    memory. That is what puts the rail in the same commit as the rows.
	 * 2. The re-read still runs (the manifest stays the authority), and when it
	 *    FAILS the rail keeps what it was painting. That is the same rule the
	 *    "refresh failure" arm above pins, and it matters more here: blanking on
	 *    a failed re-read would take the rail away from a reader who was already
	 *    looking at it, one frame after it appeared.
	 */
	freshWindow();
	const checkpoints = [user(), completion()];
	const first = backend([manifest(checkpoints)]);
	/* The window's first read of this conversation. */
	const before = await mountHook("s1");
	assert.equal(before.latest().state, "ready");
	await before.close();
	assert.equal(first.length, 1, "the first window read it once");

	/* The second mount is the same window, so the memory is intact. */
	t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
	const capture = captureWarnings();
	const requests = backend(new Error("blip"));
	const after = await mountHook("s1");
	try {
		assert.equal(
			after.latest().state,
			"ready",
			"the ticks are there in the first render, before any answer",
		);
		assert.deepEqual(after.latest().checkpoints, checkpoints);
		assert.equal(after.latest().building, false);
		await after.flush();
		assert.equal(requests.length, 1, "the read still went out");
		assert.equal(
			after.latest().state,
			"ready",
			"a failed re-read keeps the manifest this window holds",
		);
		assert.deepEqual(after.latest().checkpoints, checkpoints);
	} finally {
		capture.restore();
		await after.close();
	}
});

test("one request serves the open-time prefetch and the hook's own mount", async (t) => {
	/*
	 * WHY THIS IS PINNED. The open-time prefetch (`use-open-prefetch.ts`) and
	 * the transcript's mount ask for the same manifest a few tens of
	 * milliseconds apart, and the whole reason the prefetch is free is that they
	 * share one request (`checkpoint-manifest-cache.ts`'s in-flight map). Two
	 * requests would mean the rail's read is paid for twice on every open — the
	 * opposite of what moving it earlier was for.
	 *
	 * The held promise is the instrument: while the first load is in flight, the
	 * second caller must join it rather than open its own.
	 */
	freshWindow();
	t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
	let release = null;
	let reads = 0;
	const requests = backend(() => {
		reads += 1;
		return new Promise((resolve) => {
			release = () => resolve(manifest([completion()]));
		});
	});
	/*
	 * The loader is bundled with the hook (one module registry), so what the
	 * prefetch under test calls is the shipped function rather than a
	 * restatement of it.
	 */
	const prefetched = loadCheckpointManifest("s1");
	const rail = await mountHook("s1");
	try {
		await rail.flush();
		assert.equal(reads, 1, "the mount joined the prefetch's request");
		assert.equal(rail.latest().state, "loading");
		await act(async () => {
			release();
		});
		await rail.flush();
		await prefetched;
		assert.equal(reads, 1, "one request for both asks");
		assert.equal(rail.latest().state, "ready");
	} finally {
		await rail.close();
	}
});

test("a manifest this open already read is SERVED, not re-read (QA round 1, Q-2)", async (t) => {
	/*
	 * The measured regression: the open spent TWO `/checkpoints` reads on 29/36
	 * opens against base's one, because the cache deduped only while the first
	 * read was still IN FLIGHT - once the open's own read settled, the mount's ask
	 * started a second request for a fact this window had read milliseconds
	 * earlier. The memory it seeds from is that answer, so the first load of the
	 * epoch serves from it instead.
	 */
	let reads = 0;
	const requests = backend(() => {
		reads += 1;
		return Promise.resolve(manifest([completion()]));
	});
	/* The open's own read, settled BEFORE the mount - the 29/36 shape. */
	await loadCheckpointManifest("s1");
	assert.equal(reads, 1, "the open read the manifest");

	const rail = await mountHook("s1");
	try {
		await rail.flush();
		assert.equal(
			reads,
			1,
			"the mount did not re-read what this open had just read",
		);
		assert.equal(rail.latest().state, "ready", "it paints the memory");
		assert.equal(
			rail.latest().checkpoints.length,
			1,
			"and the memory's ticks are the rail's",
		);
	} finally {
		await rail.close();
	}
});

test("a manifest from an earlier visit is still VERIFIED (QA round 1, Q-2's control)", async (t) => {
	/*
	 * The other half of the gate, and the reason it is a clock rather than a flag:
	 * a memory older than the freshness window is a previous visit's, so the
	 * mount's first load asks for the authority as it always did. Without this the
	 * arm above could be passing because the refresh was removed rather than
	 * because a FRESH memory was recognised.
	 */
	let reads = 0;
	const requests = backend(() => {
		reads += 1;
		return Promise.resolve(manifest([completion()]));
	});
	await loadCheckpointManifest("s1");
	const readAt = Date.now();
	/*
	 * The clock is moved BEFORE the mount, because the mount is where the first
	 * load runs (an effect inside `mountHook`): installing the mock afterwards
	 * would leave the gate reading the real clock and the arm would pass for the
	 * wrong reason.
	 */
	t.mock.method(Date, "now", () => readAt + CHECKPOINT_MANIFEST_FRESH_MS + 1);
	const rail = await mountHook("s1");
	try {
		await rail.flush();
		assert.equal(reads, 2, "an old memory is refreshed, not trusted");
		assert.equal(
			rail.latest().state,
			"ready",
			"and the rail stays painted throughout",
		);
	} finally {
		await rail.close();
	}
});
