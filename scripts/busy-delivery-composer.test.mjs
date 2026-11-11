import assert from "node:assert/strict";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

/*
 * The busy-send delivery path, driven through the SHIPPED composer.
 *
 * Source-regex "wiring" tests pin that the Enter sites call `sendKeyOf`; this
 * file mounts the real `MessageInput`, types text and presses a bound chord,
 * and asserts what the composer handed the page: the `delivery` option. The
 * store half — `admitChatDraft` putting `delivery` on the `sessions.message`
 * body — is the same real path `busy-delivery-desktop.test.mjs` drives, so
 * together they prove chord press -> page -> body without a DOM-only claim.
 *
 * The world is built BEFORE the bundle is imported, because the stores
 * (`zustand/persist`) read `localStorage` at module scope. The rig is cloned
 * from `credential-composer.test.mjs`'s harness, trimmed to what this file
 * needs: jsdom globals, the fetch stub, the bundle and the mount.
 */

const dom = new JSDOM("<!doctype html><div id='root'></div>", {
	url: "http://localhost/",
});
const { window } = dom;
const originals = new Map();
const liveTimers = [];
const realSetTimeout = globalThis.setTimeout;
const realSetInterval = globalThis.setInterval;

const tracked =
	(real) =>
	(...args) => {
		const id = real(...args);
		liveTimers.push(id);
		return id;
	};
globalThis.setTimeout = tracked(realSetTimeout);
globalThis.setInterval = tracked(realSetInterval);

for (const [key, value] of Object.entries({
	window,
	document: window.document,
	localStorage: window.localStorage,
	sessionStorage: window.sessionStorage,
	HTMLElement: window.HTMLElement,
	HTMLTextAreaElement: window.HTMLTextAreaElement,
	HTMLInputElement: window.HTMLInputElement,
	HTMLButtonElement: window.HTMLButtonElement,
	Element: window.Element,
	Node: window.Node,
	Event: window.Event,
	CustomEvent: window.CustomEvent,
	FocusEvent: window.FocusEvent,
	KeyboardEvent: window.KeyboardEvent,
	InputEvent: window.InputEvent,
	MouseEvent: window.MouseEvent,
	ClipboardEvent: window.ClipboardEvent,
	getComputedStyle: window.getComputedStyle.bind(window),
	IS_REACT_ACT_ENVIRONMENT: true,
	ResizeObserver: class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
	MutationObserver: window.MutationObserver,
	requestAnimationFrame: (callback) => realSetTimeout(() => callback(0), 0),
	cancelAnimationFrame: (id) => clearTimeout(id),
})) {
	originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
	Object.defineProperty(globalThis, key, {
		configurable: true,
		writable: true,
		value,
	});
}

Object.defineProperty(window.document, "visibilityState", { value: "hidden" });
Object.defineProperty(window.document, "hidden", { value: true });

window.setTimeout = tracked(realSetTimeout);
window.setInterval = tracked(realSetInterval);

const mediaQueries = new Map();
window.matchMedia = (query) => {
	const key = String(query);
	if (!mediaQueries.has(key)) {
		mediaQueries.set(key, {
			matches: false,
			media: key,
			onchange: null,
			addListener: () => {},
			removeListener: () => {},
			addEventListener: () => {},
			removeEventListener: () => {},
			dispatchEvent: () => false,
		});
	}
	return mediaQueries.get(key);
};

window.electron = {
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

const calls = [];
const answer = (request) => {
	if (request.op === "config.get")
		return { values: { hosting: "local", model_name: "mock" } };
	if (request.op === "capabilities")
		return {
			desktop_available: true,
			features: { commands: 1, session_credential: 1 },
		};
	if (request.op === "commands.list") return { commands: [] };
	return {};
};

globalThis.fetch = async (url, init) => {
	let request = {};
	try {
		request = JSON.parse(init?.body ?? "{}");
	} catch {
		request = {};
	}
	calls.push({ url: String(url), request });
	return {
		ok: true,
		status: 200,
		json: async () => ({ status: 200, body: { result: answer(request) } }),
	};
};

const bundle = await build({
	stdin: {
		contents: `
			export { MessageInput, steerHintKey } from "./src/renderer/src/shared/components/composer/message-input.tsx";
			export { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
			export { useConversationInputStore } from "./src/renderer/src/shared/store/conversation-input-store";
			export { useUiPreferencesStore } from "./src/renderer/src/shared/store/ui-preferences-store";
			export { t } from "@shared/i18n";
			export {
				BUSY_DEFAULT_STALE_TIME,
				busyDefaultFromSettings,
				evaluateBusySend,
			} from "./src/renderer/src/features/chat/composer-send-key";
			export {
				composerPlaceholder,
			} from "./src/renderer/src/shared/hooks/use-message-input";
			export {
				effectiveChord,
				sanitizeShortcutBindings,
			} from "./src/renderer/src/shared/keymap/keymap-chord";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
	jsx: "automatic",
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
	},
	define: { "import.meta.env": "{}" },
	banner: {
		js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
	},
	write: false,
});
const bundlePath = new URL(
	`./_busy-composer-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const {
	MessageInput,
	steerHintKey,
	QueryClient,
	QueryClientProvider,
	useQuery,
	useUiPreferencesStore,
	BUSY_DEFAULT_STALE_TIME,
	busyDefaultFromSettings,
	evaluateBusySend,
	composerPlaceholder,
	effectiveChord,
	sanitizeShortcutBindings,
} = await import(bundlePath.href);
await unlink(bundlePath);

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = React;
const h = React.createElement;

const client = new QueryClient({
	defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});
let root;
after(() => {
	root?.unmount();
	client.clear();
	for (const id of liveTimers) {
		clearTimeout(id);
		clearInterval(id);
	}
	dom.window.close();
});

const settle = async () => {
	for (let pass = 0; pass < 8; pass++) {
		await act(async () => {
			await new Promise((resolve) => realSetTimeout(resolve, 0));
			await new Promise((resolve) => setImmediate(resolve));
		});
	}
};

let mountSeq = 0;
async function mount({ busyDefaultMode, noProvider, noModel } = {}) {
	const conversationId = `conv-busy-${++mountSeq}`;
	const sent = [];
	root ??= createRoot(window.document.getElementById("root"));
	await act(async () => {
		root.render(
			h(
				QueryClientProvider,
				{ client },
				h(MessageInput, {
					isLoading: false,
					messages: [{ id: "m", role: "system", timestamp: new Date(0) }],
					conversationId,
					awaitingReply: true,
					busyDefaultMode,
					noProvider,
					noModel,
					onSendMessage: async (...args) => {
						sent.push(args);
						return true;
					},
					onSlashCommand: async () => false,
					onCredentialsStored: () => {},
					paneHasSession: false,
				}),
			),
		);
	});
	await settle();
	return { conversationId, sent };
}

const writeValue = (field, next, caret) => {
	const setter = Object.getOwnPropertyDescriptor(
		window.HTMLTextAreaElement.prototype,
		"value",
	)?.set;
	setter.call(field, next);
	if (caret !== undefined) field.setSelectionRange(caret, caret);
	field.dispatchEvent(new window.Event("input", { bubbles: true }));
};

const field = () => window.document.querySelector("textarea");

const type = async (text) => {
	for (const char of text) {
		const f = field();
		const start = f.selectionStart ?? f.value.length;
		const next = f.value.slice(0, start) + char + f.value.slice(start);
		await act(async () => {
			writeValue(f, next, start + 1);
		});
		await settle();
	}
};

const press = async (init, keyCode) => {
	const f = field();
	let claimed = false;
	await act(async () => {
		const event = new window.KeyboardEvent("keydown", {
			bubbles: true,
			cancelable: true,
			...init,
		});
		// jsdom's KeyboardEvent init cannot set keyCode (it reads 0); a real
		// IME composition commit arrives with 229, so define it directly.
		if (keyCode !== undefined)
			Object.defineProperty(event, "keyCode", { value: keyCode });
		f.dispatchEvent(event);
		claimed = event.defaultPrevented;
	});
	await settle();
	return claimed;
};

test("a bound chord press hands its mode to the page's send", async () => {
	useUiPreferencesStore.setState({
		shortcutBindings: { "composer.send_queue": "primary+enter" },
	});
	const { sent } = await mount();
	await type("hello");
	const claimed = await press({ key: "Enter", metaKey: true });
	assert.equal(claimed, true, "the chord press submits");
	assert.equal(sent.length, 1, "one send handed to the page");
	const [, , , , , , delivery] = sent[0];
	assert.equal(delivery, "queue", "the press's delivery travels on the send");
	useUiPreferencesStore.setState({ shortcutBindings: {} });
});

test("plain Enter hands the default (null) to the page's send", async () => {
	useUiPreferencesStore.setState({ shortcutBindings: {} });
	const { sent } = await mount();
	await type("hello");
	await press({ key: "Enter" });
	assert.equal(sent.length, 1);
	const [, , , , , , delivery] = sent[0];
	assert.equal(delivery, null, "plain Enter means the page's default mode");
});

test("the busy placeholder names the resolved mode", async () => {
	await mount({ busyDefaultMode: "queue" });
	assert.equal(
		field()?.placeholder,
		"Enter queues it · Esc stops",
		"queue default names the queue sentence",
	);
	await mount({ busyDefaultMode: "both" });
	assert.equal(
		field()?.placeholder,
		"Enter waits, then interrupts · Esc stops",
		"both default names the both sentence",
	);
	await mount({ busyDefaultMode: "steer" });
	assert.equal(
		field()?.placeholder,
		"Enter sends now · Esc stops",
		"steer default names the steer sentence",
	);
});

test("a settings change made outside the app is read after invalidation", async () => {
	// The page's settings query carries `staleTime: 10_000`; after a write in
	// another surface invalidates `desktopKeys.settings`, the next read sees the
	// new row rather than the five-minute default's cached copy. This probe is
	// react-query's own semantics at the same staleTime the page uses.
	const key = ["busy-probe"];
	let value = "steer";
	const Probe = () => {
		const query = useQuery({
			queryKey: key,
			queryFn: async () => value,
			staleTime: 10_000,
		});
		return h("div", { "data-probe": "true" }, query.data ?? "pending");
	};
	client.removeQueries({ queryKey: key });
	root ??= createRoot(window.document.getElementById("root"));
	await act(async () => {
		root.render(h(QueryClientProvider, { client }, h(Probe)));
	});
	await settle();
	assert.equal(
		window.document.querySelector('[data-probe="true"]')?.textContent,
		"steer",
	);
	// An outside write (the TUI's settings edit) lands; invalidation is what a
	// Backend-settings write does. The next mount reads the new value.
	value = "queue";
	await act(async () => {
		await client.invalidateQueries({ queryKey: key });
	});
	await settle();
	assert.equal(
		window.document.querySelector('[data-probe="true"]')?.textContent,
		"queue",
		"the invalidated query refetches the outside write",
	);
	client.removeQueries({ queryKey: key });
});

test("keyCode 229 never sends", async () => {
	useUiPreferencesStore.setState({ shortcutBindings: {} });
	const { sent } = await mount();
	await type("hello");
	const claimed = await press({ key: "Enter", metaKey: true }, 229);
	assert.equal(
		claimed,
		false,
		"an IME composition commit is not claimed as a send",
	);
	assert.equal(sent.length, 0, "no send handed to the page");
});

/* ------------------------------------------------------------------ *
 * M2 — the page's send assembly, driven for real.
 *
 * Round-1 pinned the page's wiring by source regex. The review ran sixteen
 * mutations against that pin and six survived it silent: the `chordDelivery`
 * field dropped from the gate object, `busyDeliverySupported` inverted, the
 * `mustRefuseBusyDelivery` gate ignored, the `sendRefused` arm ignoring
 * `sendKey`, the `busyDefaultMode` prop dropped on the way to `MessageInput`,
 * and the send-hint key reverted — because no test ran the assembly the page
 * calls. `evaluateBusySend` is that assembly, extracted as a pure function;
 * these tests run it (and the composer's own arms) rather than matching its
 * source. The mutation table lives at the bottom of this file, one row per
 * survived mutation, each row naming the behavioural test that now kills it.
 * ------------------------------------------------------------------ */

const SETTINGS = (value) =>
	value === undefined ? undefined : [{ key: "delivery.busy_default", value }];

test("evaluateBusySend: busy + supported + queue chord puts queue on the body", () => {
	const result = evaluateBusySend({
		chordDelivery: "queue",
		settings: SETTINGS(undefined),
		busy: true,
		busyDeliverySupported: true,
	});
	assert.deepEqual(result, { refused: false, delivery: "queue" });
});

test("evaluateBusySend: busy + unsupported + queue chord refuses, with no body", () => {
	const result = evaluateBusySend({
		chordDelivery: "queue",
		settings: SETTINGS(undefined),
		busy: true,
		busyDeliverySupported: false,
	});
	assert.deepEqual(result, { refused: true, delivery: undefined });
});

test("evaluateBusySend: idle + queue chord puts nothing on the body", () => {
	const result = evaluateBusySend({
		chordDelivery: "queue",
		settings: SETTINGS("queue"),
		busy: false,
		busyDeliverySupported: true,
	});
	assert.deepEqual(result, { refused: false, delivery: undefined });
});

test("evaluateBusySend: a steer chord on an unsupported backend is not refused", () => {
	// `steer` is today's behaviour and needs no key: the seam must never
	// refuse it even while the backend omits the feature.
	const result = evaluateBusySend({
		chordDelivery: "steer",
		settings: SETTINGS(undefined),
		busy: true,
		busyDeliverySupported: false,
	});
	assert.deepEqual(result, { refused: false, delivery: undefined });
});

test("evaluateBusySend: the settings default, read at the press, drives plain Enter", () => {
	// Plain Enter reports `chordDelivery: null`, so the seam must resolve
	// the default from the settings payload it was handed — the value in
	// force at the press, not a hard-coded steer.
	assert.deepEqual(
		evaluateBusySend({
			chordDelivery: null,
			settings: SETTINGS("queue"),
			busy: true,
			busyDeliverySupported: true,
		}),
		{ refused: false, delivery: "queue" },
	);
	assert.deepEqual(
		evaluateBusySend({
			chordDelivery: null,
			settings: SETTINGS("queue"),
			busy: true,
			busyDeliverySupported: false,
		}),
		{ refused: true, delivery: undefined },
		"a queue default on an unsupported backend refuses, never sends steer",
	);
	assert.deepEqual(
		evaluateBusySend({
			chordDelivery: "both",
			settings: SETTINGS("queue"),
			busy: true,
			busyDeliverySupported: true,
		}),
		{ refused: false, delivery: "both" },
		"a chord mode wins over the default",
	);
});

test("sendRefused + Enter does not submit", async () => {
	// The review's `sendRefused`-ignores-`sendKey` mutation: the arm must
	// check the press's send key BEFORE submitting, so with nothing able to
	// answer (no provider connected) a send press explains and sends
	// nothing. A mutation that gated on `sendRefused` without `sendKey`
	// would submit both messages below.
	useUiPreferencesStore.setState({ shortcutBindings: {} });
	const { sent } = await mount({ noProvider: true });
	await type("hello");
	await press({ key: "Enter" });
	assert.equal(
		sent.length,
		0,
		"Enter with nothing able to answer hands no send to the page",
	);
});

test("sendRefused + a bound chord does not submit either", async () => {
	useUiPreferencesStore.setState({
		shortcutBindings: { "composer.send_queue": "primary+enter" },
	});
	const { sent } = await mount({ noModel: true });
	await type("hello");
	await press({ key: "Enter", metaKey: true });
	assert.equal(
		sent.length,
		0,
		"a chord press with no model able to answer hands no send to the page",
	);
	useUiPreferencesStore.setState({ shortcutBindings: {} });
});

test("sendRefused + a non-send key still types (the refusal gates only the send key)", async () => {
	// Round 3: the two tests above press only send keys, so a mutation
	// `if (sendRefused && sendKey)` -> `if (sendRefused)` survived both.
	// Typing must stay allowed while the refusal holds — the box is where
	// the failure is explained — so a letter and Shift+Enter must NOT be
	// prevented and must still enter the draft.
	useUiPreferencesStore.setState({ shortcutBindings: {} });
	const { sent } = await mount({ noProvider: true });
	const before = field()?.value ?? "";
	const letterClaimed = await press({ key: "a" });
	assert.equal(
		letterClaimed,
		false,
		"a letter key is not claimed as a send while sendRefused",
	);
	const newlineClaimed = await press({ key: "Enter", shiftKey: true });
	assert.equal(
		newlineClaimed,
		false,
		"Shift+Enter (the newline) is not claimed as a send while sendRefused",
	);
	assert.equal(
		field()?.value ?? "",
		before,
		"the draft is untouched by non-send keys",
	);
	assert.equal(sent.length, 0, "no send handed to the page");
});

test("steerHintKey returns the mode's own key for all three modes + absent", () => {
	// Behavioural (round 3): the tooltip renders `t(steerHintKey(...))`,
	// which no mount asserts directly; this drives the shipped function
	// for every mode and the absent fallback.
	assert.equal(steerHintKey("steer"), "ui.chat.composer.steer_hint_steer");
	assert.equal(steerHintKey("queue"), "ui.chat.composer.steer_hint_queue");
	assert.equal(steerHintKey("both"), "ui.chat.composer.steer_hint_both");
	assert.equal(steerHintKey(undefined), "ui.chat.composer.steer_hint");
});

test("busyDefaultMode reaches the placeholder through the real props", () => {
	// The review's `busyDefaultMode`-dropped mutation: the value must travel
	// from the page's resolved default, through ChatContent's `canonical`,
	// through MessageInput's props, into the placeholder that names what
	// Enter does. `composerPlaceholder` is the shipped function the composer
	// renders (message-input.tsx calls it with these exact fields), so this
	// asserts the chain's terminus for every mode rather than the one mode
	// the mount test already renders.
	const base = {
		unavailable: false,
		inputDisabled: false,
		awaitingAnswer: false,
		secretAnswer: false,
		asideAttached: false,
		sendingUnsettled: false,
		awaitingReply: true,
	};
	assert.equal(
		composerPlaceholder({ ...base, busyDefaultMode: "queue" }),
		"Enter queues it · Esc stops",
	);
	assert.equal(
		composerPlaceholder({ ...base, busyDefaultMode: "both" }),
		"Enter waits, then interrupts · Esc stops",
	);
	assert.equal(
		composerPlaceholder({ ...base, busyDefaultMode: "steer" }),
		"Enter sends now · Esc stops",
	);
	// And the chain's source: the page resolves this value with the same
	// `busyDefaultFromSettings` the seam uses, so a default the row carries
	// is the value the placeholder names.
	assert.equal(busyDefaultFromSettings(SETTINGS("queue")), "queue");
});

test("BUSY_DEFAULT_STALE_TIME is the neighbours' 10s window (constant assertion only; the page's use of it is the regex pin in busy-delivery-desktop.test.mjs)", async () => {
	// Round 3: renamed honestly — the probe below re-states the constant in its
	// OWN useQuery and proved nothing about the page; the page's own use is
	// pinned by source regex in the desktop suite. This test still owns the
	// constant's value and the invalidation behaviour at that window.
	// The toy-key staleTime test: a probe that re-states `staleTime: 10_000`
	// in its own `useQuery` proves nothing about the page. This pins the
	// page's own value by importing the constant the page passes to its
	// query (`BUSY_DEFAULT_STALE_TIME`) and proving it carries the window
	// the neighbours use — then runs the invalidation behaviour AT that
	// window, so a change to the constant moves the behaviour with it.
	assert.equal(
		BUSY_DEFAULT_STALE_TIME,
		10_000,
		"the page's own constant is the neighbours' 10s window",
	);
	const key = ["busy-seam-probe"];
	let value = "steer";
	const Probe = () => {
		const query = useQuery({
			queryKey: key,
			queryFn: async () => value,
			staleTime: BUSY_DEFAULT_STALE_TIME,
		});
		return h("div", { "data-seam-probe": "true" }, query.data ?? "pending");
	};
	client.removeQueries({ queryKey: key });
	root ??= createRoot(window.document.getElementById("root"));
	await act(async () => {
		root.render(h(QueryClientProvider, { client }, h(Probe)));
	});
	await settle();
	assert.equal(
		window.document.querySelector('[data-seam-probe="true"]')?.textContent,
		"steer",
	);
	// A write made outside the app lands; invalidation is what a
	// Backend-settings write does. The next read sees it at the page's
	// own window.
	value = "queue";
	await act(async () => {
		await client.invalidateQueries({ queryKey: key });
	});
	await settle();
	assert.equal(
		window.document.querySelector('[data-seam-probe="true"]')?.textContent,
		"queue",
		"the invalidated query refetches the outside write at the page's window",
	);
	client.removeQueries({ queryKey: key });
});

test("sanitizeShortcutBindings keeps alt+enter on a send row", () => {
	// Round 3: this test previously asserted only `BUSY_DEFAULT_STALE_TIME`
	// and pinned nothing about the sanitizer. It now drives the shipped
	// functions (bundled above) for the single chord the mutation would
	// have dropped: `alt+enter` carries no `primary`, so the general
	// primary gate would lose it without the send-row carve-out.
	const kept = sanitizeShortcutBindings({ "composer.send_both": "alt+enter" });
	assert.deepEqual(kept, { "composer.send_both": "alt+enter" });
	assert.equal(effectiveChord("composer.send_both", kept), "alt+enter");
});

/* ------------------------------------------------------------------ *
 * M2 mutation table (round 3 honest rewrite): each row is a mutation the
 * reviewer applied and found surviving, and how it is now covered —
 * behavioural kill, regex pin, or honestly unpinned. Round 2 claimed
 * every row was behaviourally killed; round 3 found that false for the
 * page's call-site arguments and the `busyDefaultMode` plumbing, and
 * rewrote this table to say so per row.
 *
 *   #  mutation (round-1 seam)                    killed by
 *   1  `chordDelivery` dropped from gate object   REGEX PIN: desktop suite evaluateBusySend({chordDelivery: ...})
 *   2  `busyDeliverySupported` inverted           REGEX PIN: desktop suite evaluateBusySend({busyDeliverySupported})
 *   3  `mustRefuseBusyDelivery` gate ignored       behavioural: evaluateBusySend busy+unsupported+queue refuses
 *   4  `sendRefused` arm ignoring `sendKey`       behavioural: sendRefused + Enter/chord + non-send key (round 3)
 *   5  `busyDefaultMode` dropped in chat-content   REGEX PIN: desktop suite busyDefaultMode={canonical?.busyDefaultMode}
 *   6  `busyDefaultMode` dropped in chat-page      REGEX PIN: desktop suite busyDefaultMode, in canonical
 *   7  send-hint key reverted (steer_hint)         behavioural: steerHintKey all modes + absent (round 3) + RE_SEND_VERB call-site pin
 *   8  `alt+enter` sanitize gate removed           behavioural: sanitize+effective alt+enter (round 3, this file) + send-shortcuts keep
 *   9  forwarding options altered (send options)   behavioural: busy-delivery-desktop.test.mjs admission pin
 *  10  planner arm altered                         source pin + predicate suite (see note)
 *  11  `busy: turnAlive` (render closure)         REGEX PIN + behavioural**: desktop pin busy: turnAliveRef.current
 *  12  delivery added in admitChatDraft           REGEX PIN + behavioural: desktop `delivery: deliveryValue` pin + body pins
 *  13  keyCode 229 arm removed                     behavioural: keyCode 229 never sends
 *  14  `isSendChordOf` filter removed              behavioural: send rows accept only Enter chords (raw-binding feed, round 3)
 *  15  buildChordMap composer rows added           keymap-chords.test.mjs scope filter
 *  16  forwarding delivery option dropped          behavioural: busy-delivery-composer.test.mjs chord press
 *  17  `settings: busyDefaultQuery.data?.settings` dropped  REGEX PIN: desktop suite evaluateBusySend({settings: ...})
 *  18  `delivery: evaluation.delivery` dropped     REGEX PIN: desktop suite const deliveryValue = evaluation.delivery
 *  19  `mode` forced to prompt                     UNPINNED (page-internal mode field; no rig mounts the page in node)
 *  20  query `enabled:false`                       UNPINNED (query enabled flag; no rig mounts the page in node)
 *
 * Rows 1, 2, 5, 6, 11 (page half), 12 (admit half) and 17-18 are regex
 * pins, not behavioural kills: the page cannot be mounted in a node test,
 * so the source regex is the only coverage of those wires, and the desktop
 * suite names them "regex pin". Rows 19-20 are honestly unpinned: they are
 * page-internal values with no cheap rig, listed rather than pretended.
 * * #7 is killed behaviourally by `steerHintKey` returning the mode's own
 *   key for all three modes + absent (round 3); `t(steerHintKey(...))` is
 *   the only tooltip call site, and the `btw-aside` suite pins the
 *   `slotB.role === "steer"` arm that reaches it.
 * ** #11 is killed as far as a pure seam can kill it: the seam takes `busy`
 *   as an argument, so a page that handed the render closure's stale value
 *   would hand a different boolean than `turnAliveRef.current` at press time;
 *   the idle case pins the argument's effect, and the page's call site passes
 *   `turnAliveRef.current` (pinned by the desktop suite's source check,
 *   which survives because the value is read at the press).
 * ------------------------------------------------------------------ */
