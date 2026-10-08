import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * THE RUN'S BOX IS THE APP'S COMPOSER — mounted, and holding the one line that
 * says what it is.
 *
 * WHY THIS FILE EXISTS RATHER THAN A FRAME. Two of Scope B's decisions are
 * statements about the DOM that a still cannot prove and a reviewer should not
 * have to take on trust:
 *
 *  1. the aside sentence is a PERMANENT NODE inside the composer's notice band,
 *     verbatim, and it is what the box's `aria-describedby` names — the design's
 *     U4 requirement, and the reason it is not a placeholder (`transcriptless`
 *     plus `placeholderOverride` would have made it one);
 *  2. the send seam is the composer's own (`onSendMessage(content, attachments)`)
 *     and it reaches the run with the attachments the composer collected — the
 *     one state the note forbids is a control whose payload the send drops.
 *
 * WHAT IS REAL: the shipped `ConfigComposer`, the shipped `MessageInput` and its
 * input store. What is faked, and only that: the run handle, which is a plain
 * object — the composer's contract is with that object, not with the hook.
 *
 * WHAT IT IS NOT: evidence about pixels. jsdom has no layout engine, so nothing
 * here says how the box sits on the page; that is the frames' job.
 */

const DOM = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/agents",
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
 * A STORAGE THAT ANSWERS. Two persisted stores in this graph (the onboarding
 * store, the conversation-input store) rehydrate at import time, and a jsdom
 * window without storage throws inside them before any test runs.
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
/*
 * FRAMES, BECAUSE JSDOM HAS NONE WITHOUT `pretendToBeVisual`. The composer's send
 * path schedules its optimistic paint on one, so a missing `requestAnimationFrame`
 * fails a send a browser would have made.
 */
globalThis.requestAnimationFrame = (callback) =>
	setTimeout(() => callback(Date.now()), 0);
globalThis.cancelAnimationFrame = (handle) => clearTimeout(handle);
globalThis.ResizeObserver = class {
	observe() {}
	disconnect() {}
};
/*
 * A CANVAS THAT ANSWERS, because the composer's graph measures text at MODULE
 * scope (the maths renderer's default console width) and jsdom's canvas throws
 * "not implemented" — an import-time failure that would read as a broken test
 * rather than a missing shim. Only `measureText` is ever called.
 */
DOM.window.HTMLCanvasElement.prototype.getContext = () => ({
	measureText: (text) => ({ width: String(text).length * 8 }),
	font: "",
	fillText: () => {},
	clearRect: () => {},
	save: () => {},
	restore: () => {},
});

/*
 * THE DESKTOP BRIDGE, INERT. The composer's mount path reaches it (the catalogue
 * read behind the credential probe, the transcription manager's own probe); this
 * file is about what the box renders and what its send seam carries, and a call
 * that answers "nothing" is the honest stand-in for a bridge this rig does not
 * have.
 */
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

const bundle = await build({
	stdin: {
		contents: [
			'export { ConfigComposer } from "../src/renderer/src/features/agents/config-run/config-composer";',
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
	/*
	 * THE COMPOSER'S GRAPH REACHES ASSETS AND FONTS (the brand mark, the maths
	 * renderer's own faces). They are not what this file is about, and the rig's
	 * recipe is `shared-composer.test.mjs`'s: every one of them loads as an
	 * empty/text/dataurl module so the bundle stays about behaviour.
	 */
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
	/*
	 * THE BUNDLE KEEPS A CJS DEPENDENCY (react-error-boundary, reached through the
	 * composer's own error boundary), and a CJS file inside an ESM bundle needs a
	 * `require` that resolves from THIS file — the recipe `shared-composer.test.mjs`
	 * states for the same reason.
	 */
	banner: {
		js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
	},
});
const bundlePath = new URL(
	"._agents-composer-mount.bundle.mjs",
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
after(() => unlink(bundlePath).catch(() => {}));
const { ConfigComposer, QueryClient, QueryClientProvider, createRoot } =
	await import(bundlePath.href);

/** One run handle, with the sends it received. */
const handle = (overrides = {}) => {
	const sent = [];
	const run = {
		enabled: true,
		disabledReason: null,
		status: "idle",
		sessionId: null,
		frontend: null,
		topic: "",
		error: null,
		stopError: null,
		about: null,
		touched: [],
		step: null,
		elapsed: "0s",
		activity: [],
		results: [],
		answer: "",
		canRetry: false,
		starting: false,
		attached: false,
		start: async (text, about, attachments) => {
			sent.push({ text, about, attachments });
			return true;
		},
		stop: async () => undefined,
		retry: async () => undefined,
		dismiss: () => undefined,
		...overrides,
	};
	return { run, sent };
};

/*
 * EVERY MOUNT IS TRACKED SO IT CAN BE TORN DOWN (see the `after` hook below).
 * The file used to end in a module-scope `process.exit(0)`, which under
 * `node --test` runs before any registered case — this file reported green
 * without executing one (code review round 1, B1). Closing what it opened is the
 * cure; exiting was the symptom's hiding place.
 */
const mounts = [];

/** The same mount with the page's own gate set — see the M1 case below. */
/**
 * The same mount, but its blocked reason can be CHANGED after it is up — the
 * only way to reach "the reader was already typing when the page locked", which
 * is a state a draft-surviving key makes reachable in the product.
 */
const mountToggle = async (run) => {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const render = async (blockedReason) => {
		await act(async () => {
			root.render(
				React.createElement(
					QueryClientProvider,
					{ client: queryClient },
					React.createElement(ConfigComposer, {
						run,
						about: null,
						onClearAbout: () => undefined,
						blockedReason,
					}),
				),
			);
		});
	};
	await render(undefined);
	mounts.push({ root, queryClient });
	return { host, root, render };
};

const mountBlocked = async (run, blockedReason) => {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	await act(async () => {
		root.render(
			React.createElement(
				QueryClientProvider,
				{ client: queryClient },
				React.createElement(ConfigComposer, {
					run,
					about: null,
					onClearAbout: () => undefined,
					blockedReason,
				}),
			),
		);
	});
	mounts.push({ root, queryClient });
	return { host, root };
};

const mount = async (run, { hero = false } = {}) => {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	/*
	 * THE COMPOSER READS QUERY STATE (the credential probe, the composer's own
	 * error boundary), so a client is part of mounting it — the same shape the app
	 * provides, with retries off because nothing here presses a query's control.
	 */
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	await act(async () => {
		root.render(
			React.createElement(
				QueryClientProvider,
				{ client: queryClient },
				React.createElement(ConfigComposer, {
					run,
					hero,
					about: null,
					onClearAbout: () => undefined,
				}),
			),
		);
	});
	mounts.push({ root, queryClient });
	return { host, root };
};

/** Type into the composer's box the way a keyboard does. */
const type = async (host, text) => {
	const box = host.querySelector("textarea");
	assert.ok(box, "the shared composer's box is mounted");
	const setter = Object.getOwnPropertyDescriptor(
		DOM.window.HTMLTextAreaElement.prototype,
		"value",
	)?.set;
	await act(async () => {
		setter?.call(box, text);
		box.dispatchEvent(new DOM.window.Event("input", { bubbles: true }));
	});
	return box;
};

test("the aside sentence is the box's own description, verbatim", async () => {
	const { run } = handle();
	const { host, root } = await mount(run);
	const note = host.querySelector('[data-testid="config-composer-note"]');
	assert.ok(note, "the standing sentence renders inside the composer");
	assert.equal(
		note.textContent?.trim(),
		"Runs in the background. This does not appear in your conversation.",
		"verbatim, because the operator reads it to trust the control",
	);
	const box = host.querySelector("textarea");
	assert.ok(
		(box?.getAttribute("aria-describedby") ?? "").includes(
			"config-composer-note",
		),
		`the box describes itself with it (got ${box?.getAttribute("aria-describedby")})`,
	);
	assert.equal(
		note.getAttribute("id"),
		"config-composer-note",
		"the node carries the id the box names",
	);
	await act(async () => root.unmount());
});

test("a send from the shared box reaches the run with its attachments", async () => {
	const { run, sent } = handle();
	const { host, root } = await mount(run);
	const box = await type(host, "Add a reviewer that only reads tests");
	await act(async () => {
		box.dispatchEvent(
			new DOM.window.KeyboardEvent("keydown", {
				key: "Enter",
				bubbles: true,
			}),
		);
	});
	assert.equal(sent.length, 1, "the seam fired once");
	assert.equal(sent[0].text, "Add a reviewer that only reads tests");
	assert.equal(
		sent[0].about,
		null,
		"no row is selected, so no target is named",
	);
	assert.ok(
		Array.isArray(sent[0].attachments),
		"attachments arrive as the composer's own list, never dropped",
	);
	await act(async () => root.unmount());
});

test("a send the run refuses leaves the text in the box", async () => {
	/*
	 * THE DRAFT RULE, THROUGH THE SEAM (§3.3.1): `false` is the composer's own
	 * "put the text back". A run that answers false is the message-call failure —
	 * the request never reached the run — and the operator's sentence must still be
	 * there to send again.
	 */
	const { run } = handle({ start: async () => false });
	const { host, root } = await mount(run);
	const box = await type(host, "Add a team called shipping");
	await act(async () => {
		box.dispatchEvent(
			new DOM.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
		);
	});
	assert.equal(
		host.querySelector("textarea")?.value,
		"Add a team called shipping",
		"the refused text is still in the box",
	);
	await act(async () => root.unmount());
});

/** See the note above `mounts`: close what this file opened. */
after(async () => {
	for (const { root, queryClient } of mounts) {
		await act(async () => root.unmount());
		queryClient.clear();
		queryClient.unmount();
	}
});

test("a blocked page refuses the box, and the send never fires", async () => {
	/*
	 * M1 (code review round 1): the page's dirty-edit gate used to reach only the
	 * example chips, so the operator could type a request the page would then
	 * refuse to send. The gate is `hostNotice.blocksInput`, which joins the one
	 * `isInputDisabled` term every writer and submitter reads — so this types into
	 * a blocked page, presses Enter, and asserts nothing reached the run.
	 */
	const { run, sent } = handle();
	const { host, root } = await mountBlocked(
		run,
		"Finish or cancel your edit first.",
	);
	try {
		const box = await type(host, "Add a reviewer that only reads tests");
		assert.equal(
			box.disabled || box.readOnly,
			true,
			"the box refuses input while the page is blocked",
		);
		await act(async () => {
			box.dispatchEvent(
				new DOM.window.KeyboardEvent("keydown", {
					key: "Enter",
					bubbles: true,
				}),
			);
		});
		assert.equal(sent.length, 0, "a blocked page sends nothing");
		assert.match(
			box.getAttribute("placeholder") ?? "",
			/Finish or cancel your edit first\./,
			"and the reason is the box's own placeholder (an attribute — a\n" +
				"placeholder is never text, which is what the old assertion read)",
		);
	} finally {
		await act(async () => root.unmount());
	}
});

test("a blocked box says the page's reason, never chat's 'Agent is busy'", async () => {
	/*
	 * D1 (design review round 1): the composer's own sentence for a refused box is
	 * chat's "Agent is busy", and nothing is busy here — the page is holding a
	 * dirty edit. The host supplies its own line through the same notice prop,
	 * and this asserts the words on the box, because the earlier case proved only
	 * that the box refuses.
	 *
	 * D5's running sentence rides the same seam (`Working on your request…` while
	 * `live`), but provoking it needs the canonical sending state rather than a
	 * handle, so it is asserted here only for the blocked state.
	 */
	const { run } = handle();
	const { host, root } = await mountBlocked(
		run,
		"Finish or cancel your edit first.",
	);
	try {
		const box = host.querySelector("textarea");
		const placeholder = box?.getAttribute("placeholder") ?? "";
		assert.match(
			placeholder,
			/Finish or cancel your edit first\./,
			`the page's own sentence (got ${placeholder})`,
		);
		assert.doesNotMatch(
			placeholder,
			/busy/i,
			"chat's sentence is unreachable from this page",
		);
	} finally {
		await act(async () => root.unmount());
	}
});

test("the disabled gate's box never claims an agent is busy", async () => {
	/*
	 * D9 (design review round 3) = U1 (UX review round 3). The band owns the
	 * backend's refusal sentence (round 2's D7), and the box still has to say
	 * something TRUE in that state. With no host line the composer's own chain
	 * answers with `COMPOSER_PLACEHOLDER.busy` — chat's "Agent is busy" — over a
	 * box refused because the backend is unreachable and no turn is running: the
	 * exact defect round 1's D1 named, on the exact state D1 named.
	 *
	 * The fix can only travel through `hostNotice.placeholder` (`hostLine`), the
	 * slot that outranks `inputDisabled`; the invitation slot is read LAST by
	 * `composerPlaceholder`, so a refused box never reaches it. That is what makes
	 * this case discriminating: it asserts the WORDS on the box, so a change that
	 * re-opens D1 fails here instead of in a frame.
	 */
	const reason =
		"The backend could not be reached, so the composer is unavailable for now.";
	const { run } = handle({ enabled: false, disabledReason: reason });
	const { host, root } = await mount(run);
	try {
		const box = host.querySelector("textarea");
		assert.ok(box, "the shared composer's box is mounted");
		const placeholder = box.getAttribute("placeholder") ?? "";
		assert.doesNotMatch(
			placeholder,
			/busy/i,
			`nothing is busy on the disabled gate (got ${placeholder})`,
		);
		assert.equal(
			placeholder,
			"Configure agents by conversation",
			"the box speaks the host's own line for the state",
		);
		assert.equal(
			box.disabled || box.readOnly,
			true,
			"and the box still refuses input",
		);
		/*
		 * D7 STAYS TRUE IN THE SAME BREATH: the band is the reason's single carrier,
		 * so the fix must not route `run.disabledReason` through the box as well.
		 */
		const note = host.querySelector('[data-testid="config-composer-note"]');
		assert.equal(
			note?.textContent?.trim(),
			reason,
			"the band still carries the reason",
		);
		assert.notEqual(placeholder, reason, "and the box does not repeat it");
	} finally {
		await act(async () => root.unmount());
	}
});

test("the invitation is true on both tabs: object-free in the hero, both objects when docked", async () => {
	/*
	 * U2 (UX review round 3): the heading above the box is per-pane ("Ask for an
	 * agent" / "Ask for a team") while the box serves both, so an invitation that
	 * names ONE object first makes the Teams pane's focal control ask for an AGENT.
	 *
	 * UX review round 1 (this PR), U2 narrows what that pinned. The HERO arm keeps
	 * the object-free words (its heading and chips stand beside it). The DOCKED arm
	 * lost both, so under an open team "Describe what you want" read like messaging
	 * that team; it now names the job. The round-3 rule survives as: it never names
	 * ONE object, so it cannot contradict whichever tab is open - it must name
	 * both, or neither.
	 */
	const hero = await mount(handle().run, { hero: true });
	try {
		const placeholder =
			hero.host.querySelector("textarea")?.getAttribute("placeholder") ?? "";
		assert.doesNotMatch(
			placeholder,
			/agent|team/i,
			`the hero invitation names no object (got ${placeholder})`,
		);
	} finally {
		await act(async () => hero.root.unmount());
	}
	const { run } = handle();
	const { host, root } = await mount(run);
	try {
		const placeholder =
			host.querySelector("textarea")?.getAttribute("placeholder") ?? "";
		assert.match(
			placeholder,
			/change/i,
			`the docked box names the job, a change (got ${placeholder})`,
		);
		assert.ok(
			/agent/i.test(placeholder) === /team/i.test(placeholder),
			`and names both objects or neither, never one (got ${placeholder})`,
		);
	} finally {
		await act(async () => root.unmount());
	}
});

test("an accepted send empties the box, so a second Enter cannot send twice", async () => {
	/*
	 * U1 (a BLOCKER on this page, because a run WRITES the registries). This host
	 * paints no transcript, so the echo that normally retires the box never fires;
	 * the accepted send has to retire it. Before the fix the text stayed, and the
	 * next Enter posted the same request a second time — a second run, a second
	 * write.
	 */
	const { run, sent } = handle();
	const { host, root } = await mount(run);
	try {
		const box = await type(host, "Add a reviewer that only reads tests");
		await act(async () => {
			box.dispatchEvent(
				new DOM.window.KeyboardEvent("keydown", {
					key: "Enter",
					bubbles: true,
				}),
			);
		});
		assert.equal(sent.length, 1, "the first send went once");
		assert.equal(box.value ?? "", "", "and the box is empty afterwards");
		await act(async () => {
			box.dispatchEvent(
				new DOM.window.KeyboardEvent("keydown", {
					key: "Enter",
					bubbles: true,
				}),
			);
		});
		assert.equal(sent.length, 1, "a second Enter sends nothing more");
	} finally {
		await act(async () => root.unmount());
	}
});

test("the box's key outlives the page, so a draft survives leaving and returning", async () => {
	/*
	 * U2: the key was minted per mount, which took the persisted draft with it.
	 * Same key, two mounts, one draft.
	 */
	const first = await mount(handle().run);
	await act(async () => {
		await type(first.host, "half a request");
	});
	await act(async () => first.root.unmount());
	const second = await mount(handle().run);
	try {
		const box = second.host.querySelector("textarea");
		assert.equal(
			box?.value ?? "",
			"half a request",
			"the draft came back with the page",
		);
	} finally {
		await act(async () => second.root.unmount());
	}
});

test("while a run is live the box refuses input, in the run's words", async () => {
	/*
	 * m-b: the `|| live` term in `blocksInput` and the run's own placeholder were
	 * asserted nowhere — the existing cases all mount an idle run, where the box
	 * is supposed to accept input. This mounts the live state and reads BOTH
	 * halves off the box: the refusal and the sentence.
	 */
	const { run } = handle({ status: "running", sessionId: "session-live" });
	const { host, root } = await mount(run);
	try {
		const box = host.querySelector("textarea");
		assert.ok(box, "the box is mounted");
		assert.equal(
			box.disabled || box.readOnly,
			true,
			"a live run's box refuses input",
		);
		const placeholder = box.getAttribute("placeholder") ?? "";
		assert.match(
			placeholder,
			/Working on your request/,
			`the run's own sentence (got ${placeholder})`,
		);
		assert.doesNotMatch(placeholder, /busy/i, "and never chat's");
	} finally {
		await act(async () => root.unmount());
	}
});

test("a live run cannot be sent a second request from the box", async () => {
	/*
	 * m-b: the earlier "second Enter" case passed on the empty box alone. This one
	 * puts text in the box WHILE the run is live and presses Enter, so it fails if
	 * the live term is not in the refusal — the door U1 was really about, since a
	 * second request here is a second registry write.
	 */
	const { run, sent } = handle({
		status: "running",
		sessionId: "session-live",
	});
	const { host, root } = await mount(run);
	try {
		const box = host.querySelector("textarea");
		await act(async () => {
			await type(host, "Add a reviewer that only reads tests");
		});
		await act(async () => {
			box.dispatchEvent(
				new DOM.window.KeyboardEvent("keydown", {
					key: "Enter",
					bubbles: true,
				}),
			);
		});
		assert.equal(sent.length, 0, "a live run takes no second request");
	} finally {
		await act(async () => root.unmount());
	}
});

test("a blocked box that already holds a draft still says why", async () => {
	/*
	 * F4: the reason can only be read off a PLACEHOLDER while the box is EMPTY,
	 * and a draft now survives leaving the page (constant key, U2) - so a reader
	 * can arrive with text in the box and then open an Edit, which leaves them
	 * holding a readOnly box with their own words in it and no explanation on
	 * screen. The sentence moves out of the placeholder for that state, exactly
	 * once: the placeholder is not painted on a non-empty control, so the two can
	 * never both show.
	 *
	 * UX review round 1 (this PR), U3 MOVED WHERE IT GOES. The band used to print
	 * it as its own meta line (`#composer-host-blocked-reason`) ABOVE the status
	 * row, which stacked it on the row's standing promise and made the dock a line
	 * taller than an empty box's. The status row's sentence slot now carries it
	 * (`#config-composer-note`, already the box's description), so "exactly once"
	 * and "the box is described by it" are asserted against that node, and the old
	 * band node is asserted ABSENT - a second copy returning is the regression.
	 */
	const { run } = handle();
	const { host, root, render } = await mountToggle(run);
	try {
		const box = await type(host, "half a request");
		assert.notEqual(box.value, "", "the box holds the draft");
		await render("Finish or cancel your edit first.");
		const text = host.textContent ?? "";
		const shown = text.match(/Finish or cancel your edit first\./g) ?? [];
		assert.equal(shown.length, 1, "the reason is said exactly once");
		const note = host.querySelector("#config-composer-note");
		assert.match(
			note?.textContent ?? "",
			/Finish or cancel your edit first\./,
			"and it is said by the status row's sentence",
		);
		assert.equal(
			host.querySelectorAll("#composer-host-blocked-reason").length,
			0,
			"the band does not print a second copy above the row",
		);
		assert.ok(
			(box.getAttribute("aria-describedby") ?? "").includes(
				"config-composer-note",
			),
			`the box is described by it (got ${box.getAttribute("aria-describedby")})`,
		);
		assert.ok(
			!(box.getAttribute("aria-describedby") ?? "").includes(
				"composer-host-blocked-reason",
			),
			"and not by an id whose node is not rendered",
		);
	} finally {
		await act(async () => root.unmount());
	}
});

test("an unblocked box with a draft explains nothing", async () => {
	/*
	 * The other half of the same rule: this is a sentence about a BLOCKED page.
	 * An unblocked box holding a draft must not carry it as text and must not
	 * borrow it as its placeholder.
	 */
	const { run } = handle();
	const { host, root, render } = await mountToggle(run);
	try {
		const box = await type(host, "half a request");
		await render(undefined);
		assert.doesNotMatch(
			host.textContent ?? "",
			/Finish or cancel your edit first\./,
			"nothing is explained while nothing is blocked",
		);
		assert.doesNotMatch(
			box.getAttribute("placeholder") ?? "",
			/Finish or cancel your edit first\./,
			"and the box invites rather than refuses",
		);
		assert.ok(
			!(box.getAttribute("aria-describedby") ?? "").includes(
				"composer-host-blocked-reason",
			),
			"and the reason's id is absent from the box's description",
		);
	} finally {
		await act(async () => root.unmount());
	}
});
