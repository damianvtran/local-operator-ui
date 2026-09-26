import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * R11 / INV-C5: the warm hook's POLICY, driven through the shipped hook.
 *
 * A warm is one `local_operator.session.runtime.process` at roughly 283 MB, so
 * the question this file answers is not "does it call the endpoint" but "how
 * often, and for which session". The two ways to get this wrong are both
 * invisible to a test that only checks the happy path:
 *
 *   - warming on MOUNT rather than on intent, which spawns a runtime for every
 *     sidebar row a user clicks through, and
 *   - warming per KEYSTROKE, which spends a round trip per character.
 *
 * The hook is driven with a real React renderer rather than by restating its
 * branching, because the latch is a ref whose behaviour across renders and
 * remounts IS the invariant. `renderToStaticMarkup` runs effects-free by
 * design, which suits this hook exactly: it returns a callback and deliberately
 * has no effect, so a version rewritten as a `useEffect` on sessionId - the
 * shape INV-C5 forbids - would fire zero requests here and fail loudly.
 */
const bundle = await build({
	stdin: {
		contents: `
			import { createElement, useState } from "react";
			import { renderToStaticMarkup } from "react-dom/server";
			import { useDraftWarmSession, useWarmSession, WARM_SESSION_CATALOGUE_VERSION } from "./src/renderer/src/shared/hooks/use-warm-session";
			export { WARM_SESSION_CATALOGUE_VERSION };

			/*
			 * A composer stand-in that reproduces the real trigger edge from
			 * message-input.tsx: the textarea calls onComposerInput only when the
			 * PREVIOUS value was empty and the new one is not. The keystrokes are
			 * replayed inside one render tree so the hook sees the same callback
			 * identity a mounted composer does.
			 */
			function Harness({ sessionId, capabilities, keystrokes }) {
				const warm = useWarmSession(sessionId, capabilities);
				const [value] = useState("");
				let previous = value;
				for (const next of keystrokes) {
					if (!previous && next) warm();
					previous = next;
				}
				return createElement("div", null, previous);
			}

			export const drive = (props) =>
				renderToStaticMarkup(createElement(Harness, props));

				/*
				* The draft twin's probe: the same shipped hook, mounted through a real
				* renderer because ITS contract is an effect (fire once the minted id's
				* own subscription is open) and renderToStaticMarkup runs no effects.
				*/
				export function DraftWarmProbe({ draftId, subscriptionId, capabilities }) {
				useDraftWarmSession(draftId, subscriptionId, capabilities);
				return null;
				}
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	mainFields: ["module", "main"],
	conditions: ["import"],
	// The renderer's aliases are tsconfig paths, not node resolutions.
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime"],
	write: false,
	plugins: [
		{
			name: "warm-transport-fixture",
			setup(builder) {
				// Only the network is faked. `desktopFeatureEnabled` is the REAL
				// function, because the gate this file asserts is that function's
				// answer and a stub would let a wrong minimum version pass.
				builder.onResolve({ filter: /desktop-api$/ }, () => ({
					path: "transport",
					namespace: "warm-fixture",
				}));
				builder.onLoad({ filter: /.*/, namespace: "warm-fixture" }, () => ({
					// Only `desktopResult` is faked - it is the network. Everything
					// else is re-exported from the real module because siblings in the
					// import graph (`backend-error`) depend on the actual classes.
					contents: `export * from ${JSON.stringify(
						`${process.cwd()}/src/renderer/src/shared/api/local-operator/desktop-api.ts`,
					)}
export const desktopResult = (request) => globalThis.__warmRequest(request);`,
					loader: "js",
					resolveDir: process.cwd(),
				}));
			},
		},
	],
});
// Written to disk rather than imported as a data: URL, because React stays
// external here and a data: URL has no base path from which to resolve it.
const bundlePath = new URL("./_warm-session.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { drive, WARM_SESSION_CATALOGUE_VERSION, DraftWarmProbe } = await import(
	bundlePath.href
);
await unlink(bundlePath);

const requests = [];
globalThis.__warmRequest = async (request) => {
	requests.push(request);
	return {};
};
const capable = (version = WARM_SESSION_CATALOGUE_VERSION) => ({
	desktop_available: true,
	features: { session_catalogue: version },
});
const reset = () => {
	requests.length = 0;
};

test("typing into a session warms it exactly once, however many characters are typed", () => {
	reset();
	drive({
		sessionId: "222222222222",
		capabilities: capable(),
		keystrokes: ["W", "Wa", "War", "Warm", "Warm ", "Warm i", "Warm it"],
	});
	assert.equal(
		requests.length,
		1,
		"the latch subsumes a debounce: N keystrokes are one statement of intent",
	);
	assert.deepEqual(requests[0], {
		op: "sessions.warm",
		sessionId: "222222222222",
	});
});

test("mounting a session warms nothing, so browsing the sidebar spawns no runtimes", () => {
	reset();
	// The defect this pins is a `useEffect` on sessionId, which is mount-warming
	// with extra steps: a user clicking through six rows would spawn six
	// runtimes at ~283 MB each. Intent is typing, never attention.
	for (const sessionId of [
		"111111111111",
		"222222222222",
		"333333333333",
		"444444444444",
		"555555555555",
		"666666666666",
	])
		drive({ sessionId, capabilities: capable(), keystrokes: [] });
	assert.equal(requests.length, 0);
});

test("the warm is gated on the capability that publishes the route", () => {
	reset();
	// An ungated call spends a round trip learning 404 forever against the
	// bundled venv and any external dev backend, both of which genuinely lag
	// the app. Version 2 is the catalogue WITHOUT the warm route.
	drive({
		sessionId: "222222222222",
		capabilities: capable(2),
		keystrokes: ["h", "hi"],
	});
	assert.equal(requests.length, 0, "session_catalogue 2 must not warm");

	// Unpaired: the route is bearer-gated, so an unpaired app collects 503s.
	drive({
		sessionId: "222222222222",
		capabilities: { ...capable(), desktop_available: false },
		keystrokes: ["h", "hi"],
	});
	assert.equal(requests.length, 0, "an unpaired app must not warm");

	// Capabilities still loading, or the query failed.
	for (const capabilities of [undefined, null])
		drive({ sessionId: "222222222222", capabilities, keystrokes: ["h"] });
	assert.equal(requests.length, 0, "no capabilities is not a licence to warm");

	drive({
		sessionId: "222222222222",
		capabilities: capable(),
		keystrokes: ["h"],
	});
	assert.equal(requests.length, 1, "and version 3 does warm");
});

test("a draft with no session yet warms nothing, because there is nothing to warm", () => {
	reset();
	// A staged draft mints no session id - the create round trip is what
	// produces one - so THIS hook has nothing to address before the send. The
	// draft's own warm is the twin hook below, and it can only fire once the
	// first keystroke's mint has handed the pane an id to warm.
	drive({
		sessionId: undefined,
		capabilities: capable(),
		keystrokes: ["h", "hi"],
	});
	assert.equal(requests.length, 0);
});

test("the warm targets only the session the composer belongs to, and re-arms on remount", () => {
	reset();
	// Each `drive` is a fresh mount, which is how a user navigating away and
	// back is modelled. Re-arming is correct rather than wasteful: an unused
	// runtime is reaped by the residency drain a few seconds after this window
	// stops being its interactive viewer, so the second visit genuinely needs a
	// second warm.
	drive({
		sessionId: "222222222222",
		capabilities: capable(),
		keystrokes: ["h"],
	});
	drive({
		sessionId: "333333333333",
		capabilities: capable(),
		keystrokes: ["h"],
	});
	drive({
		sessionId: "222222222222",
		capabilities: capable(),
		keystrokes: ["h"],
	});
	assert.deepEqual(
		requests.map((request) => request.sessionId),
		["222222222222", "333333333333", "222222222222"],
		"one warm per session per mount, always the composer's own session",
	);
	assert.ok(
		requests.every((request) => request.op === "sessions.warm"),
		"the hook issues no other operation",
	);
});

test("a warm that fails is swallowed and not retried on the next keystroke", async () => {
	reset();
	// This fires from TYPING, so a surfaced failure would put an error banner up
	// mid-word for a speculative optimisation the user never asked for. The send
	// that follows engages again through the same path and reports properly.
	const rejections = [];
	process.on("unhandledRejection", (error) => rejections.push(error));
	globalThis.__warmRequest = async (request) => {
		requests.push(request);
		throw new Error("backend has no such route");
	};
	assert.doesNotThrow(() =>
		drive({
			sessionId: "222222222222",
			capabilities: capable(),
			keystrokes: ["h", "", "hi"],
		}),
	);
	// The latch counts INTENT, not success: a failed warm must not re-fire on
	// the next empty-to-non-empty edge within the same mount.
	assert.equal(
		requests.length,
		1,
		"a failed warm is not retried per keystroke",
	);
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(rejections, [], "no unhandled rejection escapes the hook");
	globalThis.__warmRequest = async (request) => {
		requests.push(request);
		return {};
	};
});

test("the warm is wired to the composer inside the subscribed panel, not above it", async () => {
	/*
	 * The precondition that makes the whole feature work, asserted against the
	 * SHIPPED wiring rather than trusted to review.
	 *
	 * The desktop bridge is reference-counted and `_detach()` cancels an
	 * in-flight warm, so a warm issued while nothing else holds the bridge is
	 * cancelled the instant its own request returns - measured at 1634 ms
	 * versus 225 ms with a subscription held. `SessionPanel` holds the stream
	 * subscription; hoisting this call to `ChatPage` or a module-level latch
	 * would still compile, still pass every other test in this file, and buy
	 * nothing at all. So the structural facts are checked directly.
	 */
	const { readFile } = await import("node:fs/promises");
	const page = await readFile(
		"src/renderer/src/features/chat/components/chat-page.tsx",
		"utf8",
	);
	const panel = page.slice(page.indexOf("function SessionPanel"));
	assert.ok(
		panel.includes("useWarmSession("),
		"the warm hook must be called inside SessionPanel, which is what holds the subscription",
	);
	// The subscription and the warm must belong to the same component instance:
	// the panel's own stream is the reference that keeps the bridge alive.
	assert.ok(
		panel.indexOf("useCanonicalSessionStream(") <
			panel.indexOf("useWarmSession("),
		"the panel must subscribe before it warms",
	);
	// The draft twin obeys the same rule, and adds its own: it fires only once
	// the MINted id's own subscription is open (`canonical.subscriptionId`), which
	// is why it must also live in this component.
	assert.ok(
		panel.includes("useDraftWarmSession("),
		"the draft warm hook must be called inside SessionPanel too",
	);
	assert.ok(
		panel.indexOf("useCanonicalSessionStream(") <
			panel.indexOf("useDraftWarmSession("),
		"the panel must subscribe before the draft can warm anything",
	);
	assert.ok(
		panel.includes("canonical.subscriptionId"),
		"the draft warm is gated on the panel's open subscription",
	);
	// The draft's STREAM is addressed at the minted id until the session exists,
	// so the subscription that holds the bridge is the draft's own.
	assert.ok(
		panel.includes("sessionId ?? draft?.warmId"),
		"the stream must address the minted draft id until the create hop",
	);
	assert.ok(
		panel.includes("onComposerInput={onComposerInput}"),
		"the trigger must reach the composer, where the keystroke is observable",
	);
	// And the composer's edge branches: a session warms itself, a draft MINTS
	// the id its runtime will be warmed on. Both halves pinned, because losing
	// either one silently returns the pane to the pre-warm behaviour.
	assert.ok(panel.includes("ensureDraftWarm(draftKey)"));
	assert.ok(panel.includes("warm();"));
	// The capability is published by this panel (the surface that resolved it),
	// which is what lets the keystroke's mint give a store flag its answer.
	assert.ok(panel.includes("setDraftWarmable("));
	assert.ok(panel.includes('"session_draft_warm"'));
	// And NOT from the page above it, which renders whether or not a panel is
	// mounted and holds no subscription of its own.
	const above = page.slice(0, page.indexOf("function SessionPanel"));
	assert.ok(
		!above.includes("useWarmSession("),
		"nothing above SessionPanel may warm: it holds no bridge reference",
	);
	assert.ok(
		!above.includes("useDraftWarmSession("),
		"and nothing above it may warm a draft for the same reason",
	);
});

test("the send path is unchanged when the warm never lands", async () => {
	reset();
	/*
	 * The degraded case must be exactly today's behaviour, never worse. A warm
	 * that is cancelled by the bridge detaching, refused by an older backend, or
	 * never fired at all must leave the send engaging inline as it always did -
	 * so nothing may wait on warm state, and the composer must never be gated on
	 * it. A speculative optimisation that could DELAY a send would be a strictly
	 * worse trade than not warming.
	 */
	globalThis.__warmRequest = async (request) => {
		requests.push(request);
		throw new Error("warm cancelled by bridge detach");
	};
	// The hook returns a plain callback and resolves synchronously: it hands the
	// caller nothing to await, so no send path can be made to wait on it.
	const returned = drive({
		sessionId: "222222222222",
		capabilities: capable(),
		keystrokes: ["h", "hi"],
	});
	assert.equal(typeof returned, "string", "the render completes synchronously");
	assert.equal(requests.length, 1);
	// Nothing in the hook's module surface exposes warm STATE, which is what a
	// send path would have to read in order to gate on it.
	const surface = await (await import("node:fs/promises")).readFile(
		"src/renderer/src/shared/hooks/use-warm-session.ts",
		"utf8",
	);
	assert.ok(
		!/export\s+(const|function)\s+(isWarm|warmState|useWarmState)/.test(
			surface,
		),
		"the hook must publish no warm state for a send path to gate on",
	);
	assert.ok(
		!surface.includes("await desktopResult"),
		"the warm must stay fire-and-forget: an awaited warm is a delayed send",
	);
	globalThis.__warmRequest = async (request) => {
		requests.push(request);
		return {};
	};
});

/* ---- the draft twin: one warm, once the minted id's subscription opens ---- */

/*
 * WHY jsdom AND A REAL ROOT, WHEN THE REST OF THIS FILE IS EFFECTS-FREE.
 * `useWarmSession` returns a callback and is driven during render; the draft
 * twin's contract IS an effect - fire exactly once, and only once the minted
 * draft id's own stream subscription is open, because a warm whose only bridge
 * user is its own request is cancelled the moment it returns (measured: 1634 ms
 * with no subscription against 225 ms with one). A static-markup render runs
 * no effects, so it would pass just as happily against a hook that never
 * fired; this half needs a live renderer - the setup `browser-queue-expiry.test.mjs`
 * established for exactly this class of hook.
 */
let draftRender = null;

async function draftRenderer() {
	if (draftRender) return draftRender;
	const { JSDOM } = await import("jsdom");
	const dom = new JSDOM("<!doctype html>");
	globalThis.window = dom.window;
	globalThis.document = dom.window.document;
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;
	// Imported AFTER the document exists: React DOM feature-detects its host at
	// import time.
	const [reactDom, react] = await Promise.all([
		import("react-dom/client"),
		import("react"),
	]);
	draftRender = {
		dom,
		createRoot: reactDom.createRoot,
		act: react.act,
		createElement: react.createElement,
	};
	return draftRender;
}

/** Mount the probe; `move` re-renders it the way the pane's props move. */
async function mountDraft(props) {
	const { dom, createRoot, act, createElement } = await draftRenderer();
	const host = dom.window.document.createElement("div");
	dom.window.document.body.appendChild(host);
	const root = createRoot(host);
	const move = async (next) => {
		await act(async () => {
			root.render(createElement(DraftWarmProbe, next));
		});
	};
	await move(props);
	return {
		move,
		unmount: async () => {
			await act(async () => root.unmount());
		},
	};
}

/** The capability that publishes the draft routes, and nothing else. */
const draftCapable = () => ({
	desktop_available: true,
	features: { session_draft_warm: 1 },
});
const SUB_A = "0123456789abcdef0123456789abcdef";
const SUB_B = "fedcba9876543210fedcba9876543210";

test("nothing warms until the minted id's own subscription is open", async () => {
	reset();
	const view = await mountDraft({
		draftId: "aaaaaaaaaaaa",
		subscriptionId: null,
		capabilities: draftCapable(),
	});
	assert.equal(
		requests.length,
		0,
		"a warm with no other bridge user is cancelled the moment its own response returns",
	);
	// The stream opens - the panel mounted it for the draft id as soon as the
	// mint landed.
	await view.move({
		draftId: "aaaaaaaaaaaa",
		subscriptionId: SUB_A,
		capabilities: draftCapable(),
	});
	assert.deepEqual(
		requests,
		[{ op: "sessions.warm", sessionId: "aaaaaaaaaaaa" }],
		"and once it is open, the MINTED id - not a session id - is what warms",
	);
	await view.unmount();
});

test("a pane with no minted id warms nothing; the warm follows the mint", async () => {
	reset();
	const view = await mountDraft({
		draftId: undefined,
		subscriptionId: null,
		capabilities: draftCapable(),
	});
	assert.equal(requests.length, 0, "the subscription alone warms nothing");
	// The first keystroke's mint answers: the id lands while the stream is up.
	await view.move({
		draftId: "bbbbbbbbbbbb",
		subscriptionId: SUB_A,
		capabilities: draftCapable(),
	});
	assert.deepEqual(requests, [
		{ op: "sessions.warm", sessionId: "bbbbbbbbbbbb" },
	]);
	await view.unmount();
});

test("the latch is per minted id: a stream restart is no second warm, a re-mint is", async () => {
	reset();
	const view = await mountDraft({
		draftId: "aaaaaaaaaaaa",
		subscriptionId: SUB_A,
		capabilities: draftCapable(),
	});
	assert.equal(requests.length, 1);
	// A stream restart replaces the subscription id for the SAME draft. The
	// backend's lease loop is the retry net under a live lease, so the renderer
	// must not spend a second round trip per reconnect.
	await view.move({
		draftId: "aaaaaaaaaaaa",
		subscriptionId: SUB_B,
		capabilities: draftCapable(),
	});
	assert.equal(requests.length, 1, "a restart is not a new draft");
	// The drop rule replaced the id (the selection changed): the new runtime is
	// the one that needs warming.
	await view.move({
		draftId: "cccccccccccc",
		subscriptionId: SUB_B,
		capabilities: draftCapable(),
	});
	assert.deepEqual(requests.at(-1), {
		op: "sessions.warm",
		sessionId: "cccccccccccc",
	});
	await view.unmount();
});

test("no capability means no warm, byte-for-byte today's pane", async () => {
	reset();
	// A backend that predates the draft routes: the session catalogue only.
	const view = await mountDraft({
		draftId: "aaaaaaaaaaaa",
		subscriptionId: SUB_A,
		capabilities: capable(),
	});
	assert.equal(
		requests.length,
		0,
		"session_catalogue alone must not warm a draft",
	);
	await view.unmount();
	// Unpaired is not a licence either.
	const second = await mountDraft({
		draftId: "aaaaaaaaaaaa",
		subscriptionId: SUB_A,
		capabilities: {
			desktop_available: false,
			features: { session_draft_warm: 1 },
		},
	});
	assert.equal(requests.length, 0);
	await second.unmount();
});

test("a failed warm is swallowed, and a new visit re-arms the latch", async () => {
	reset();
	const rejections = [];
	const record = (error) => rejections.push(error);
	process.on("unhandledRejection", record);
	globalThis.__warmRequest = async (request) => {
		requests.push(request);
		throw new Error("warm cancelled");
	};
	try {
		const view = await mountDraft({
			draftId: "dddddddddddd",
			subscriptionId: SUB_A,
			capabilities: draftCapable(),
		});
		assert.equal(requests.length, 1, "the attempt is made");
		await view.unmount();
		await new Promise((resolve) => setImmediate(resolve));
		assert.deepEqual(rejections, [], "its failure is the hook's to swallow");
		// An unused runtime is reaped after the pane leaves, so coming back is a
		// new visit that genuinely needs a new warm: the latch re-arms.
		const again = await mountDraft({
			draftId: "dddddddddddd",
			subscriptionId: SUB_A,
			capabilities: draftCapable(),
		});
		assert.equal(
			requests.length,
			2,
			"remount re-arms, exactly like the session hook",
		);
		await again.unmount();
	} finally {
		process.off("unhandledRejection", record);
		globalThis.__warmRequest = async (request) => {
			requests.push(request);
			return {};
		};
	}
});
