import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { installFocusScrollModel } from "./focus-scroll-model.mjs";

/*
 * THE QUICK-SEND STRIP'S BOX IS THE APP'S COMPOSER — mounted, and carrying the
 * selected session's own readings.
 *
 * WHY THIS FILE IS BEHAVIOURAL RATHER THAN A FRAME. The strip's control changed
 * shape (a hand-rolled `Input` + `Send` replaced by the shared `MessageInput`),
 * and the claims worth proving are statements about the seam a still cannot
 * show: what the composer's `onSendMessage` hands the strip's own `onSend`, that
 * a busy target still travels as a STEER, that a refusal leaves the draft in the
 * box, and that the readings row is built from a `sessions.get` read of the
 * SELECTED session rather than from anything the strip invented. The pixels —
 * the box's alignment and framing on the card — are the renderer driver's job.
 *
 * WHAT IS REAL: the shipped `ProjectQuickSend`, the shipped `MessageInput` and
 * its input store, and the shipped `useSessionSnapshot`. What is faked, and only
 * that: `onSend` (a recorder — the component's contract is with that prop, and
 * `admitChatDraft` behind it is the detail screen's own territory) and the
 * desktop transport, which answers with one canned `sessions.get` so the
 * readings half can be observed without a daemon.
 *
 * THE HARNESS SHIMS ARE `agents-composer-mount.test.mjs`'s recipe, verbatim in
 * shape: jsdom plus the composer's graph needs (storage at import time, a canvas
 * that answers, frames, an inert desktop bridge). A second recipe would be a
 * second set of lies about the same component.
 */

const DOM = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/projects",
});
const FORCE_FROM_JSDOM = [
	"Event",
	"CustomEvent",
	"UIEvent",
	"MouseEvent",
	"PointerEvent",
	"KeyboardEvent",
	"FocusEvent",
	"InputEvent",
	"CompositionEvent",
	"ClipboardEvent",
	"File",
	"FileReader",
	"Blob",
	"HTMLElement",
	"Element",
	"Node",
	"DocumentFragment",
	"Range",
	"Selection",
	"DOMRect",
	"DOMRectReadOnly",
	"getComputedStyle",
	"requestAnimationFrame",
	"cancelAnimationFrame",
];
for (const key of Object.getOwnPropertyNames(DOM.window)) {
	if (key === "window" || key === "self" || key === "globalThis") continue;
	if (key in globalThis && !FORCE_FROM_JSDOM.includes(key)) continue;
	try {
		globalThis[key] = DOM.window[key];
	} catch {
		// jsdom's own accessors refuse to be read out of scope.
	}
}
globalThis.window = DOM.window;
globalThis.document = DOM.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/*
 * EVERY TIMER THIS FILE'S RIG CREATES, TRACKED SO TEARDOWN CAN RELEASE IT (see
 * the `after` hook). Both realms are wrapped because the composer schedules
 * through `globalThis.setTimeout` in some paths (`withTimeout`) and through
 * `window.setTimeout` in others (the hint countdown), and jsdom schedules its own
 * on its window.
 */
const liveTimers = new Set();
for (const realm of [globalThis, DOM.window]) {
	const setT = realm.setTimeout?.bind(realm);
	const setI = realm.setInterval?.bind(realm);
	if (setT) {
		realm.setTimeout = (...args) => {
			const handle = setT(...args);
			liveTimers.add(handle);
			return handle;
		};
	}
	if (setI) {
		realm.setInterval = (...args) => {
			const handle = setI(...args);
			liveTimers.add(handle);
			return handle;
		};
	}
}

/*
 * A STORAGE THAT ANSWERS: the conversation-input store and the onboarding store
 * rehydrate at import time, and a jsdom window without storage throws inside
 * them before any test runs.
 */
const storage = new Map();
Object.defineProperty(DOM.window, "localStorage", {
	configurable: true,
	value: {
		getItem: (key) => storage.get(key) ?? null,
		setItem: (key, value) => storage.set(key, String(value)),
		removeItem: (key) => storage.delete(key),
		clear: () => storage.clear(),
		key: (index) => [...storage.keys()][index] ?? null,
		get length() {
			return storage.size;
		},
	},
});
globalThis.localStorage = DOM.window.localStorage;
DOM.window.matchMedia = (query) => ({
	media: query,
	matches: false,
	addEventListener: () => {},
	removeEventListener: () => {},
	dispatchEvent: () => false,
});
globalThis.matchMedia = DOM.window.matchMedia;
globalThis.requestAnimationFrame = (callback) =>
	setTimeout(() => callback(Date.now()), 0);
globalThis.cancelAnimationFrame = (handle) => clearTimeout(handle);
globalThis.ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
globalThis.IntersectionObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
DOM.window.Element.prototype.scrollIntoView = () => {};

/*
 * THE FOCUSING STEPS' SCROLL HALF, MODELLED (see `focus-scroll-model.mjs`).
 * jsdom moves focus and never scrolls - it has no layout engine - so without
 * this rig the difference between a plain `focus()` and `focus({preventScroll:
 * true})` is invisible here, and that difference IS this change: the composer
 * may claim the caret, but it may never move the reader's page. The model
 * records every call and moves the nearest scroll container by a fixed delta
 * when a call does not prevent the scroll; the live Chromium geometry is the
 * harness slice's half.
 */
const focusModel = installFocusScrollModel(DOM.window);
after(() => focusModel.restore());

/*
 * A CANVAS THAT ANSWERS, because the composer's graph measures text at MODULE
 * scope and jsdom's canvas throws "not implemented". Only `measureText` is read.
 */
DOM.window.HTMLCanvasElement.prototype.getContext = () => ({
	measureText: (text) => ({ width: String(text).length * 8 }),
	font: "",
	fillText: () => {},
	clearRect: () => {},
	save: () => {},
	restore: () => {},
});

/* The desktop bridge, inert — the composer's mount path reaches it. */
DOM.window.electron = {
	ipcRenderer: {
		on: () => () => {},
		removeListener: () => {},
		send: () => {},
		invoke: async (channel) =>
			channel === "get-platform-info"
				? { platform: "darwin" }
				: { canceled: true, filePaths: [] },
	},
};
DOM.window.api = {
	ipcRenderer: {
		invoke: async () => ({}),
		send: () => {},
		on: () => {},
		once: () => {},
		removeListener: () => {},
		removeAllListeners: () => {},
	},
	readFile: undefined,
	platform: "darwin",
};
globalThis.api = DOM.window.api;

/*
 * THE DESKTOP TRANSPORT, ANSWERING ONE OP. `desktopResult` posts to `/__desktop`
 * and unwraps `body.result`; the stub records every request so a case can assert
 * WHICH session the readings were asked about, and answers `sessions.get` with a
 * snapshot carrying a resolved model and a `cwd` — the two readings the strip
 * paints (`composer-readings.test.mjs`'s fixture shape, so this is a payload a
 * real backend sends rather than one invented here).
 */
const SNAPSHOT_CWD = "/Users/rig/selected-session";
const desktopRequests = [];
const jsonResponse = (payload) => ({
	ok: true,
	status: 200,
	json: async () => payload,
});
globalThis.fetch = async (_url, init) => {
	let request = {};
	try {
		request = JSON.parse(init?.body ?? "{}");
	} catch {
		request = {};
	}
	desktopRequests.push(request);
	if (request.op === "sessions.get") {
		return jsonResponse({
			/*
			 * THE DEV/PROD ENVELOPE: `desktopRequest`'s HTTP arm answers the JSON
			 * the dev proxy returns, which is `{status, body}` - the same shape
			 * main's IPC arm returns - and `desktopResult` unwraps `body.result`.
			 * A bare `{result}` here reads as a refusal, which is how this stub
			 * first answered and why the readings stayed empty.
			 */
			status: 200,
			body: {
				result: {
					payload: {
						frontend: {
							snapshot: {
								session_id: request.sessionId,
								cwd: SNAPSHOT_CWD,
								effective_model: {
									provider: "openrouter",
									model_id: "openai/gpt-5",
									display_name: "OpenAI: GPT-5",
									reasoning: true,
									reasoning_effort: "high",
									reasoning_efforts: ["minimal", "low", "medium", "high"],
									reasoning_default_effort: null,
									context_window: 400_000,
									max_context_window: null,
								},
								selected_model: null,
								context_tokens: null,
								context_is_estimate: null,
								cumulative_parent_cost: null,
								cost_knowledge: "unknown",
								streaming: false,
							},
						},
						cold: false,
					},
				},
			},
		});
	}
	/*
	 * EVERY OTHER OP ANSWERS THE CONFIG SHAPE, because the strip's model reading
	 * consults the configured hosting (`modelOptions`' `hosting` term) and an
	 * undefined `values` throws inside a render rather than failing closed.
	 */
	return jsonResponse({
		status: 200,
		body: { result: { values: { hosting: "test", model_name: "mock-model" } } },
	});
};

const bundle = await build({
	stdin: {
		contents: [
			'export { ProjectQuickSend } from "../src/renderer/src/features/projects/components/project-quick-send";',
			'export { createRoot } from "react-dom/client";',
			'export { QueryClient, QueryClientProvider } from "@tanstack/react-query";',
		].join("\n"),
		resolveDir: `${process.cwd()}/scripts`,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	jsx: "automatic",
	external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
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
		".ttf": "empty",
		".woff": "empty",
		".woff2": "empty",
		".eot": "empty",
	},
	define: { "import.meta.env": "{}" },
	banner: {
		js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
	},
});
const bundlePath = new URL("._projects-quick-send.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
after(() => unlink(bundlePath).catch(() => {}));

const { ProjectQuickSend, QueryClient, QueryClientProvider, createRoot } =
	await import(bundlePath.href);

/* ---------------------------------------------------------------- fixtures */

/** One linked session, the fields the strip reads. */
const link = (overrides = {}) => ({
	session_id: "s1",
	exists: true,
	title: "Payments cutover",
	created_at: null,
	archived: false,
	runtime: { state: "live", busy: false, heartbeat_age_s: 1, pid: 1 },
	subagents: null,
	todos: null,
	...overrides,
});

/** Bytes with a PNG signature; the reader only has to round-trip them. */
const PNG_BYTES = [
	137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
];
const PNG_DATA_URL = `data:image/png;base64,${Buffer.from(PNG_BYTES).toString("base64")}`;

const mounts = [];
const mountStrip = async (props = {}) => {
	/*
	 * THE STRIP SITS INSIDE THE PAGE'S SCROLLER, which is the geometry the whole
	 * fix is about: the detail screen's composer is at the foot of an
	 * `overflow-y-auto` column (`projects-page.tsx`), so a focus call that scrolls
	 * its element into view moves the READER. The scroller carries the overflow as
	 * an INLINE style rather than a class because a jsdom document applies no
	 * stylesheet and a Tailwind class would resolve to nothing, and the model in
	 * `focus-scroll-model.mjs` is what turns a call into that movement.
	 */
	const scroller = document.createElement("div");
	scroller.style.overflowY = "auto";
	scroller.style.height = "200px";
	document.body.append(scroller);
	const host = document.createElement("div");
	scroller.append(host);
	const root = createRoot(host);
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const sent = [];
	const tree = (next = {}) =>
		React.createElement(
			QueryClientProvider,
			{ client: queryClient },
			React.createElement(ProjectQuickSend, {
				links: [link()],
				target: "s1",
				onTargetChange: () => {},
				onSend: async (...args) => {
					sent.push(args);
					return true;
				},
				focusTick: 0,
				...props,
				...next,
			}),
		);
	await act(async () => {
		root.render(tree());
	});
	mounts.push({ root, queryClient });
	return {
		host,
		root,
		sent,
		queryClient,
		scroller,
		/*
		 * A RE-RENDER WITH NEW PROPS, keeping whatever the case did not name. Two of
		 * the cases below are about a strip whose state CHANGED under it - a target
		 * appearing, a row's message action bumping the tick - and neither is
		 * reachable from a mount alone.
		 */
		rerender: async (next = {}) => {
			await act(async () => {
				root.render(tree(next));
			});
			await settle();
		},
	};
};

after(async () => {
	for (const { root, queryClient } of mounts) {
		await act(async () => root.unmount());
		queryClient.clear();
	}
	/*
	 * AND RELEASE THE TIMERS THE HARNESS LET RUN. Mounting the composer schedules
	 * deferred work (jsdom's own selection-change timeout on every `focus()`, the
	 * component's five-second hint countdown, react-query's query GC), and a
	 * pending handle keeps the test process alive after the last case
	 * (`projects-quick-send.test.mjs`'s first head left this suite's lane bound to
	 * kill the file and name it as a stall, which reads as a product defect).
	 * Tracking every handle this file creates and clearing it here is a property
	 * of the rig, not a claim about the product: nothing asserted above depends on
	 * a timer surviving the run.
	 */
	for (const handle of liveTimers) {
		clearTimeout(handle);
		clearInterval(handle);
	}
	liveTimers.clear();
});

const box = (host) => host.querySelector("textarea");
const sendControl = (host) =>
	host.querySelector('button[aria-label="Send message"]');

/** Type into the composer's box the way a keyboard does. */
const type = async (host, text) => {
	const field = box(host);
	assert.ok(field, "the composer's box is mounted");
	const setter = Object.getOwnPropertyDescriptor(
		DOM.window.HTMLTextAreaElement.prototype,
		"value",
	)?.set;
	await act(async () => {
		setter?.call(field, text);
		field.dispatchEvent(new DOM.window.Event("input", { bubbles: true }));
	});
	return field;
};

const pressEnter = async (host) => {
	await act(async () => {
		box(host).dispatchEvent(
			new DOM.window.KeyboardEvent("keydown", {
				key: "Enter",
				bubbles: true,
				cancelable: true,
			}),
		);
		await settle();
	});
};

const pasteImage = async (host) => {
	const file = new DOM.window.File([new Uint8Array(PNG_BYTES)], "shot.png", {
		type: "image/png",
	});
	await act(async () => {
		const event = new DOM.window.Event("paste", {
			bubbles: true,
			cancelable: true,
		});
		Object.defineProperty(event, "clipboardData", {
			value: {
				items: [{ type: "image/png", kind: "file", getAsFile: () => file }],
				getData: () => "",
			},
		});
		box(host).dispatchEvent(event);
		await settle();
	});
};

const settle = async () => {
	await new Promise((resolve) => setTimeout(resolve, 0));
	await new Promise((resolve) => setTimeout(resolve, 20));
};

/* -------------------------------------------------------------------- cases */

test("the strip mounts the shared composer and its send carries the typed text", async () => {
	const { host, sent } = await mountStrip();
	assert.ok(
		box(host),
		"the shared composer's textarea is what the strip mounts",
	);
	assert.ok(
		sendControl(host),
		"and the shared composer's own send control, not a second one",
	);
	await type(host, "  steer it back  ");
	await pressEnter(host);
	assert.equal(sent.length, 1, "exactly one send left the strip");
	assert.deepEqual(sent[0], ["s1", "steer it back", "prompt", []]);
});

test("a pasted screenshot alone rides the seam as an attachment (issue #790)", async () => {
	const { host, sent } = await mountStrip();
	await pasteImage(host);
	assert.ok(
		host.querySelector("img"),
		"the pasted image is drawn by the composer's own preview",
	);
	await pressEnter(host);
	assert.equal(sent.length, 1, "an image alone is a message");
	assert.deepEqual(sent[0], ["s1", "", "prompt", [PNG_DATA_URL]]);
});

test("a busy target still travels as a steer", async () => {
	const { host, sent } = await mountStrip({
		links: [
			link({
				runtime: { state: "live", busy: true, heartbeat_age_s: 1, pid: 1 },
			}),
		],
	});
	assert.match(
		host.textContent ?? "",
		/The session is working — this message steers the running turn\./,
		"the caption the operator reads is on screen",
	);
	await type(host, "how is it going?");
	await pressEnter(host);
	assert.equal(sent.length, 1);
	assert.equal(
		sent[0][2],
		"steer",
		"the admission path is told this is a steer",
	);
});

test("a refused send keeps the draft in the box", async () => {
	const { host, sent } = await mountStrip({
		onSend: async (...args) => {
			sent.push(args);
			return false;
		},
	});
	await type(host, "keep me");
	await pressEnter(host);
	assert.equal(sent.length, 1);
	assert.equal(
		box(host).value,
		"keep me",
		"the composer's `false` answer puts the text back",
	);
});

test("the readings are read from the SELECTED session, not invented", async () => {
	desktopRequests.length = 0;
	const { host } = await mountStrip();
	await settle();
	const asked = desktopRequests.filter((r) => r.op === "sessions.get");
	assert.ok(
		asked.length >= 1,
		`the strip asked sessions.get (saw ${JSON.stringify(desktopRequests)})`,
	);
	assert.equal(asked[0].sessionId, "s1", "for the selected target");
	assert.match(
		host.textContent ?? "",
		/selected-session/,
		"and the snapshot it answered with is what the strip paints",
	);
});

test("the strip says it is sending while the admission is in flight", async () => {
	/*
	 * UX round 1, U1. The composer retires its text when a TRANSCRIPT receives it,
	 * and this strip has no transcript: without a line of its own the window
	 * between Enter and delivery says nothing at all, and a user who sees nothing
	 * happen presses again - where the only answer is the store's refusal to the
	 * SECOND press. The line lives in the strip's own caption row, so nothing here
	 * asserts a new row: it asserts that the row says so while the send is out and
	 * stops saying it once the send settles.
	 */
	let release;
	const pending = new Promise((resolve) => {
		release = resolve;
	});
	const { host } = await mountStrip({ onSend: () => pending });
	await type(host, "the blocker, please");
	await pressEnter(host);
	assert.match(
		host.textContent ?? "",
		/Sending…/,
		"the admission window carries its own sentence",
	);
	await act(async () => {
		release(true);
		await settle();
	});
	assert.doesNotMatch(
		host.textContent ?? "",
		/Sending…/,
		"and the sentence leaves with the send",
	);
});

test("a strip with nothing to send to refuses the box and says why", async () => {
	/*
	 * Review round 1, R5. The hand-rolled field this mounts replaced disabled its
	 * Send when no target was usable; the composer's own Send predicate cannot see
	 * that fact, so a typed message with no target was a silent no-op. The strip
	 * now refuses the input through the composer's own host-state channel, with the
	 * host's sentence in the placeholder and in the band.
	 */
	const { host } = await mountStrip({ links: [], target: null });
	const field = box(host);
	assert.ok(field, "the composer's box is mounted");
	assert.equal(field.readOnly, true, "the box refuses input");
	assert.equal(
		field.placeholder,
		"Choose a session to send to.",
		"and its placeholder is the host's own reason",
	);
	assert.match(
		host.textContent ?? "",
		/Choose a session to send to\./,
		"the reason is on the surface too",
	);
});

/* ------------------------------------------------------------------------ */
/* The caret, and which doors may move the reader's page (operator, 2026-10-08) */
/* ------------------------------------------------------------------------ */
/*
 * "When clicking into a project, because of the standard behaviour of the
 * composer, it scrolls the user down to centre on the composer and focuses it.
 * For projects the composer is an optional interaction, not the primary one, so
 * there should be an option that is context dependent: the composer auto-focuses
 * mostly, but on the projects page it shouldn't, and we should stay scrolled at
 * the top when clicking in."
 *
 * WHAT THESE CASES CAN AND CANNOT SEE, SAID PLAINLY. jsdom has no layout engine,
 * so the scroll is MODELLED rather than measured (`scripts/focus-scroll-model.mjs`):
 * every `focus()` call is recorded with the options it carried, and a call that
 * does not prevent the scroll moves the scroller by a fixed delta - which is what
 * a real engine's centring does in an unknown amount. That makes "movement
 * versus no movement" answerable, and it is the property this fix is; the
 * geometry (that the strip really is below the fold, and where a centre lands)
 * is the live-Chromium evidence's half, not this rig's.
 */

/** Focus the box the way a pointer press does: focus moves, the page does not. */
const clickInto = async (host) => {
	await act(async () => {
		box(host).focus({ preventScroll: true });
	});
};

/** Every focus call that reached the strip's own box, in order. */
const claimsOnBox = (host) =>
	focusModel.calls.filter((call) => call.element === box(host));

/*
 * THE PRECONDITION, ESTABLISHED RATHER THAN ASSUMED. Opening a project is a
 * navigation from elsewhere on the page, so the caret is not already sitting in
 * some composer's box - but this file's earlier cases leave their trees mounted
 * until the `after` hook, and one of them can hold the caret. Left in place that
 * would mask the regression rather than prove the fix: the composer's own guard
 * (`isInputFocused`) would skip the claim for a reason that has nothing to do
 * with the case, and both the caret assertion and the recorded-call assertion
 * would pass on the pre-fix source.
 */
const startFromNothing = () => {
	document.activeElement?.blur?.();
	assert.ok(
		!["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName ?? ""),
		"no text field holds the caret when the project opens",
	);
};

test("opening a project does not focus the Send-to box and does not scroll to it", async () => {
	startFromNothing();
	const { host, scroller } = await mountStrip();
	const field = box(host);
	assert.ok(
		field,
		"the composer's box is mounted (the mount really rendered it)",
	);
	assert.notEqual(
		document.activeElement,
		field,
		"the strip is a secondary interaction and must not take the caret on its own initiative",
	);
	assert.equal(
		scroller.scrollTop,
		0,
		"and the page stays where the reader left it - the model moves this by a non-zero delta for any focus that does not prevent the scroll",
	);
	assert.deepEqual(
		claimsOnBox(host),
		[],
		"no focus call reached the box at all on the mounting path",
	);
});

test("a box that becomes writable does not take the caret from the control that made it writable", async () => {
	/*
	 * THE "Send to" TRANSITION, the second half of the operator's report. With no
	 * target the strip refuses the box (`hostNotice.blocksInput`), so choosing a
	 * session flips it writable - and the composer's claim used to re-fire on that
	 * transition, taking the caret off the Select trigger mid-interaction (Radix
	 * returns focus to that trigger when its menu closes; the composer must not
	 * take it from there).
	 */
	const frame = await mountStrip({ links: [], target: null });
	assert.equal(
		box(frame.host).readOnly,
		true,
		"the box refuses input while there is nothing to send to",
	);
	startFromNothing();
	/*
	 * AND THE CARET IS ON THE CONTROL THAT MAKES IT WRITABLE, which is where a
	 * pick leaves it: the user pressed this trigger, and Radix returns focus to it
	 * when the menu closes.
	 */
	const trigger = frame.host.querySelector(
		'[aria-label="Select the session to message"]',
	);
	assert.ok(trigger, "the Send-to select trigger is mounted");
	await act(async () => {
		trigger.focus({ preventScroll: true });
	});
	await frame.rerender({ links: [link()], target: "s1" });
	assert.equal(
		box(frame.host).readOnly,
		false,
		"and becomes writable once a target exists",
	);
	assert.notEqual(
		document.activeElement,
		box(frame.host),
		"the transition must not move the caret into the box",
	);
	assert.deepEqual(
		claimsOnBox(frame.host),
		[],
		"no focus call reached the box on the transition at all",
	);
	assert.equal(frame.scroller.scrollTop, 0, "nor scroll the page to it");
});

test("the row's message action still hands the box over, and may bring it into view", async () => {
	/*
	 * The opt-out is about the composer claiming the caret when the reader has
	 * asked for nothing. The row's message action EXISTS to hand the box over, so
	 * it keeps a plain focus: the press working, not the page moving on its own.
	 */
	const frame = await mountStrip();
	await frame.rerender({ focusTick: 1 });
	assert.equal(
		document.activeElement,
		box(frame.host),
		"the press that exists to hand the box over must land in it",
	);
	assert.ok(
		frame.scroller.scrollTop > 0,
		"and a focus the user asked for is allowed to bring the box into view",
	);
});

test("the post-send hand-back restores the caret without dragging a reader back down", async () => {
	/*
	 * The pointer press focuses Send, and the browser drops focus to `<body>` when
	 * the send settles, so the strip hands the caret back - the renderer driver's
	 * `project-detail` scene asserts `document.activeElement` for exactly this.
	 * What the hand-back must not do is move a reader who scrolled away while the
	 * send was in flight: a send can take seconds, and restoring a caret is not
	 * navigation.
	 */
	const frame = await mountStrip();
	await clickInto(frame.host);
	await type(frame.host, "one more thing, please");
	frame.scroller.scrollTop = 120;
	await pressEnter(frame.host);
	assert.equal(
		document.activeElement,
		box(frame.host),
		"the caret comes back to the box the press belonged to",
	);
	assert.equal(
		frame.scroller.scrollTop,
		120,
		"and the hand-back must not scroll the page back to the strip",
	);
});
