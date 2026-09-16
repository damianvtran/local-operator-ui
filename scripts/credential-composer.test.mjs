import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

/*
 * THE COMPOSER'S OWN CREDENTIAL WIRING, driven through the SHIPPED component.
 *
 * Every rule this file pins lives in `message-input.tsx`'s React wiring rather
 * than in the pure module: the teardown of a live capture on a whole-buffer
 * replacement, the submit seam the Send button and the Enter key share, the
 * caret the empty-span Escape leaves behind, the arming door a slash row opens,
 * the draft the mint has to persist, the store a first-message send has to
 * reach. `credential-capture.test.mjs` cannot see any of them — it drives the
 * module the way the composer does, which is a model of the call order and not
 * the call order itself, and that gap is exactly how the round-1 findings
 * survived 49 green cases.
 *
 * WHAT THIS IS NOT: proof of layout, of a real browser's key handling, or of
 * the agent receiving anything. jsdom has no layout engine and no clipboard, so
 * geometry is the evidence rig's business and the paste below is synthesised.
 * What it does prove is the React state machine: which handler claims a
 * keystroke, what the buffer holds afterwards, what the field is told, and what
 * the draft store was written.
 *
 * The world is built BEFORE the bundle is imported, because the stores
 * (`zustand/persist`) read `localStorage` at module scope.
 */

const dom = new JSDOM("<!doctype html><div id='root'></div>", {
	url: "http://localhost/",
});
const { window } = dom;
const originals = new Map();
const liveTimers = [];
const realSetTimeout = globalThis.setTimeout;
const realSetInterval = globalThis.setInterval;

/*
 * The composer's own queries (`capabilities`, `commands.list`,
 * `sessions.credential`, the connectivity probes) schedule real timers, and a
 * jsdom window has no lifecycle that retires them: left alone, the process
 * never exits. Every timer created below is recorded and cleared on the way
 * out, which is the fixture's business rather than the component's.
 */
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

/*
 * A hidden document, and it is not decoration: React Query's interval hooks
 * (the two 5s connectivity probes) pause only when the document is not visible,
 * and a jsdom document reports itself visible with no focus. Visible, they
 * refetch forever and the process never exits.
 */
Object.defineProperty(window.document, "visibilityState", { value: "hidden" });
Object.defineProperty(window.document, "hidden", { value: true });

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

/* ------------------------------------------------------------------ */
/* The desktop transport, answered from this file                       */
/* ------------------------------------------------------------------ */

/**
 * What the mocked bridge is asked for, in order.
 *
 * `desktopRequest` reaches the dev-server proxy over `fetch("/__desktop")` when
 * the app's own `window.api.desktop` bridge is absent, which is the path taken
 * here — so the whole desktop vocabulary the composer uses is answered from one
 * function and every call is recorded. That is what lets a test assert the STORE
 * REQUEST for a session id the composer was never given (UX round 1, U2).
 */
const calls = [];
const credentialStoreReply = { ok: true };
const credentialList = [{ key: "LOP_SECRET_ABCDEFGH", source: "command" }];

const COMMANDS = [
	{
		name: "credential",
		description: "Type or paste a secret after a space; masked",
		aliases: ["cred"],
		arguments: "none",
		echo: false,
		consumes_prompt: false,
		destination: "session.credential",
		execution: "native",
	},
	{
		name: "usage",
		description: "Show token and cost",
		aliases: [],
		arguments: "none",
		echo: false,
		consumes_prompt: false,
		destination: "panels.usage",
		execution: "owner",
	},
];

const answer = (request) => {
	/*
	 * The connectivity gate reads `config.values.hosting` on EVERY render, so an
	 * unanswered `config.get` is not a quiet background failure: `values` is
	 * missing and the composer throws before it paints.
	 */
	if (request.op === "config.get")
		return { values: { hosting: "local", model_name: "mock" } };
	if (request.op === "capabilities")
		return {
			desktop_available: true,
			features: { commands: 1, session_credential: 1 },
		};
	if (request.op === "commands.list") return { commands: COMMANDS };
	if (request.op === "sessions.credential") {
		/*
		 * THE RUNTIME'S OWN SHAPE, which is two envelopes deep and not one
		 * (code review round 2, MINOR 3). The route answers
		 * `reply({"data": result})` and `reply` builds `CRUDResponse(...,
		 * result=result)`, so the JSON body main fetches is
		 * `{"status":…,"result": {"data": …}}` and `desktopResult` hands the
		 * renderer that inner `result` — i.e. `{"data": <op result>}`. Answering
		 * the op result directly made `credentialNamesFrom` read `[]` here (it
		 * reads `answer.data.credentials`), so the §8 collision guard was INERT in
		 * every case that drives the shipped component while the pure suite used
		 * the real shape — the fixture at the top of this file was referenced by
		 * nothing that asserted, and nothing caught it.
		 */
		if (request.action === "list")
			return { data: { ok: true, credentials: credentialList } };
		if (request.action === "store") return { data: credentialStoreReply };
		return { data: { ok: true } };
	}
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
	/*
	 * `{status, body}`, not `{result}`: `desktopRequest` hands back the parsed
	 * JSON and `desktopResult` reads `.status` and `.body.result` off it, so a
	 * mock that answers the inner envelope directly leaves every desktop query
	 * in an error state — which is a silent way to make a test prove nothing.
	 */
	return {
		ok: true,
		status: 200,
		json: async () => ({ status: 200, body: { result: answer(request) } }),
	};
};

/* ------------------------------------------------------------------ */
/* The bundle                                                           */
/* ------------------------------------------------------------------ */

const bundle = await build({
	stdin: {
		contents: `
			export { MessageInput } from "./src/renderer/src/features/chat/components/message-input.tsx";
			export { QueryClient, QueryClientProvider } from "@tanstack/react-query";
			export { useConversationInputStore } from "./src/renderer/src/shared/store/conversation-input-store";
			export {
				CREDENTIAL_ARMED_NOTICE,
				CREDENTIAL_EMPTY_SPAN_DRAFT_NOTICE,
				CREDENTIAL_EMPTY_SPAN_NOTICE,
				CREDENTIAL_KEY_ALPHABET,
				CREDENTIAL_TYPING_NOTICE,
				unredactedNotice,
			} from "./src/renderer/src/features/chat/components/credential-capture.ts";
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
const bundlePath = new URL(`./_composer-${process.pid}.mjs`, import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const {
	MessageInput,
	QueryClient,
	QueryClientProvider,
	useConversationInputStore,
	CREDENTIAL_ARMED_NOTICE,
	CREDENTIAL_EMPTY_SPAN_DRAFT_NOTICE,
	CREDENTIAL_EMPTY_SPAN_NOTICE,
	CREDENTIAL_KEY_ALPHABET,
	CREDENTIAL_TYPING_NOTICE,
	unredactedNotice,
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

/* ------------------------------------------------------------------ */
/* The rig                                                              */
/* ------------------------------------------------------------------ */

const SEND_LABEL = "Send message";

/** Let every pending query and effect settle inside act. */
const settle = async () => {
	for (let pass = 0; pass < 4; pass++) {
		await act(async () => {
			await Promise.resolve();
		});
	}
	/*
	 * ONE MACROTASK TOO, and it is load-bearing rather than belt-and-braces:
	 * jsdom delivers `selectionchange` from a QUEUED TASK (the same deferral its
	 * own `SelectionImpl._associateRange` makes), so a selection this rig or the
	 * component set is reported to React's `onSelect` after whatever else was
	 * queued behind it. Left queued, the event lands after a LATER commit and is
	 * read with that commit's render closure and the older range — a shape a
	 * browser does not produce (its `select` fires synchronously inside
	 * `setSelectionRange`), and one that closes a span the composer had just
	 * opened.
	 */
	// Several, not one: every DOM write above queues its own selectionchange
	// task, and a report that is still queued when the next keystroke is
	// dispatched is delivered after THAT keystroke's commit — with the older
	// range and the older render's props, a pair a browser never produces.
	for (let pass = 0; pass < 8; pass++) {
		await act(async () => {
			await new Promise((resolve) => realSetTimeout(resolve, 0));
			await new Promise((resolve) => setImmediate(resolve));
		});
	}
};

/**
 * Mount ONE composer on the root, with a fresh conversation where asked.
 *
 * `sent` collects every `onSendMessage` call, so a test can assert what the
 * composer handed the page — payload, the echo callback, the typed text and the
 * `beforeAdmission` seam.
 */
let mountSeq = 0;
async function mount({
	conversationId = `conv-${++mountSeq}`,
	onSlashCommand,
	onSendMessage,
	sessionStatus,
	keepWorld = false,
	remount = false,
} = {}) {
	const sent = [];
	/*
	 * THE WORLD IS CLEARED BEFORE EVERY MOUNT. The draft store is persisted, so
	 * a composer mounted on a conversation an earlier test used adopts that
	 * test's draft — and a prefilled box is not the idle composer these tests
	 * are about. The conversation ids are unique per mount for the same reason.
	 */
	if (!keepWorld) {
		window.localStorage.clear();
		useConversationInputStore.setState({ inputByConversation: {} });
	}
	const frame = { conversationId };
	Object.assign(frame, {
		sent,
		textarea: () => window.document.querySelector("textarea"),
		notice: () =>
			window.document.getElementById("composer-credential-notice")
				?.textContent ?? null,
		button: () =>
			window.document.querySelector(`button[aria-label="${SEND_LABEL}"]`),
		value: () => window.document.querySelector("textarea").value,
		caret: () => {
			const field = window.document.querySelector("textarea");
			return { start: field.selectionStart, end: field.selectionEnd };
		},
		draft: () => {
			const raw = window.localStorage.getItem("conversation-input-store");
			if (!raw) return undefined;
			const parsed = JSON.parse(raw);
			return parsed?.state?.inputByConversation?.[conversationId]?.currentInput;
		},
	});
	/*
	 * A FULL RELOAD, which this rig could not express before: `root` is reused
	 * across mounts (that is what makes two mounts one app), so every "restored
	 * draft" case here was really a RE-RENDER of the same instance — and a
	 * component's refs survive a re-render, which is precisely the thing §6 says
	 * does not survive a reload. Design round 2's D2/UX round 2's U11 are about
	 * the reload, so the rig needs both: `remount` tears the root down and builds
	 * a new one (refs gone, localStorage kept), while a second `mount` without it
	 * is the conversation switch the code review called reachable.
	 */
	if (remount) {
		await act(async () => {
			root?.unmount();
		});
		root = undefined;
	}
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
					sessionStatus,
					onSendMessage: async (...args) => {
						sent.push(args);
						return onSendMessage ? onSendMessage(...args) : true;
					},
					onSlashCommand,
				}),
			),
		);
	});
	await settle();
	return frame;
}

/**
 * The native value setter, written past React's own value tracker.
 *
 * React installs an own `value` property on the node to dedupe change events; a
 * plain `field.value = x` updates the tracker too, so the synthetic change sees
 * nothing new and `onChange` never runs. This is the same bypass
 * `fireEvent.change` uses, and it is what makes the DOM edit route real.
 */
const writeValue = (field, next, caret) => {
	const setter = Object.getOwnPropertyDescriptor(
		window.HTMLTextAreaElement.prototype,
		"value",
	)?.set;
	/*
	 * THE ORDER IS THE BROWSER'S, and it is not cosmetic: the caret moves WITH
	 * the insertion and the `input` event follows it. Dispatching first and
	 * setting the selection afterwards lets this rig overwrite whatever the
	 * component did to the caret inside its own commit — which is not what a
	 * browser does, and it hid the empty-span Escape's stale caret: the
	 * component's own `setSelectionRange` ran during the flush and the rig's
	 * later write silently repaired it. A rig that repairs the defect it is
	 * asked to pin is worse than no rig.
	 */
	setter.call(field, next);
	if (caret !== undefined) field.setSelectionRange(caret, caret);
	field.dispatchEvent(new window.Event("input", { bubbles: true }));
};

/**
 * One keystroke, as the browser delivers it: `keydown` first, and the DOM edit
 * only if nobody claimed the key. That split IS the composer's capture rule
 * (`handleCredentialKeyDown` claims the key and calls `preventDefault`), so a
 * rig that always applied the edit would mask nothing and prove nothing.
 */
const key = async (frame, keys) => {
	const field = frame.textarea();
	const { key: name, text } = keys;
	let claimed = false;
	await act(async () => {
		const event = new window.KeyboardEvent("keydown", {
			key: name,
			bubbles: true,
			cancelable: true,
		});
		field.dispatchEvent(event);
		claimed = event.defaultPrevented;
	});
	if (claimed) return;
	const start = field.selectionStart ?? field.value.length;
	const end = field.selectionEnd ?? start;
	/*
	 * The browser's own default action, for the keys nobody claimed. A rig that
	 * only applied insertions could not press Backspace at all, and Backspace is
	 * a route the capture has to survive.
	 */
	if (text === undefined) {
		if (name === "Backspace" || name === "Delete") {
			if (start === end && name === "Backspace" && start === 0) return;
			const from =
				start === end ? (name === "Backspace" ? start - 1 : start) : start;
			const to =
				start === end ? (name === "Backspace" ? start : start + 1) : end;
			const next = field.value.slice(0, from) + field.value.slice(to);
			await act(async () => {
				writeValue(field, next, from);
			});
			await settle();
		}
		return;
	}
	const next = field.value.slice(0, start) + text + field.value.slice(end);
	const caret = start + text.length;
	await act(async () => {
		writeValue(field, next, caret);
	});
	await settle();
};

const type = async (frame, text) => {
	for (const char of text) await key(frame, { key: char, text: char });
};

/**
 * A paste, through the composer's own `onPaste` branch.
 *
 * The clipboard is synthesised — jsdom has none — which is honest about what it
 * proves: the capture's OWN route (the app consumes the event and writes the
 * buffer itself) and not the browser's default insertion, which a synthetic
 * event cannot produce. Rows that depend on that default are QA's.
 */
const paste = async (frame, text) => {
	const field = frame.textarea();
	await act(async () => {
		const event = new window.Event("paste", {
			bubbles: true,
			cancelable: true,
		});
		Object.defineProperty(event, "clipboardData", {
			value: {
				getData: () => text,
				types: ["text/plain"],
			},
		});
		field.dispatchEvent(event);
	});
	await settle();
};

const esc = (frame) => key(frame, { key: "Escape" });
const enter = (frame) => key(frame, { key: "Enter" });

const clickSend = async (frame) => {
	const button = frame.button();
	assert.ok(button, "the Send button is not mounted");
	await act(async () => {
		button.click();
	});
	await settle();
};

/**
 * The operator's arming gesture: prose, then the token and its opening space.
 *
 * The VALUE is not part of it: a paste into an empty open span mints in one
 * edit, so a helper that pasted would leave the composer in the minted state
 * and every assertion about masking would be about a state that had ended.
 */
const openCapture = async (frame, { prose = "" } = {}) => {
	if (prose) await type(frame, prose);
	await type(frame, "/credential ");
};

/* ------------------------------------------------------------------ */
/* B2 — the button and the key take ONE answer                          */
/* ------------------------------------------------------------------ */

test("the Send button and Enter take the same answer to an open masked span", async () => {
	const frame = await mount();
	await openCapture(frame, { prose: "deploy with " });
	await type(frame, "sk-live-CANARY-4417");

	// The masked state really is open: the notice says so and the value is not
	// in the buffer.
	assert.match(frame.notice(), /masked as you type/);
	assert.ok(!frame.value().includes("sk-live-CANARY-4417"));

	await clickSend(frame);

	// The button MINTS, exactly as Enter does, and does not submit: the mask
	// cells are gone from the box and a pill stands in their place.
	assert.equal(
		frame.sent.length,
		0,
		"the button did not submit the mask cells",
	);
	assert.equal(frame.value(), "deploy with [Credential #1, 19 chars] ");
	assert.equal(frame.notice(), "", "the capture is over, so the notice is not");

	// The KEY, from the same state, produces the same buffer — which is the
	// invariant the composer states about its own planner.
	const keyed = await mount({ conversationId: "conv-key" });
	await openCapture(keyed, { prose: "deploy with " });
	await type(keyed, "sk-live-CANARY-4417");
	await enter(keyed);
	assert.equal(keyed.value(), frame.value());
	assert.equal(keyed.notice(), frame.notice());
});

test("an empty span reaches the picker from the button as it does from the key", async () => {
	const ran = [];
	const dispatch = async (invocation) => {
		ran.push(invocation);
		return "consumed";
	};
	const frame = await mount({ onSlashCommand: dispatch });
	await type(frame, "/credential ");
	// The span is open and EMPTY, which is the state U10 is about: Enter does not
	// mint a pill here, it falls through to the dispatcher, so the notice names
	// the door instead of promising one.
	assert.equal(frame.notice(), CREDENTIAL_EMPTY_SPAN_DRAFT_NOTICE);
	await clickSend(frame);
	await settle();
	assert.equal(frame.sent.length, 0, "an empty span is not a message");
	assert.equal(ran.length, 1, "the token was dispatched, not swallowed");
	assert.equal(ran[0].command?.name ?? ran[0].name, "credential");
	// U3: the box is empty and the capture ended, so nothing claims to be
	// masking the operator's next keystroke.
	assert.equal(frame.value(), "");
	assert.equal(frame.notice(), "");
});

/* ------------------------------------------------------------------ */
/* B3 — the empty-span Escape leaves the caret where typing continues   */
/* ------------------------------------------------------------------ */

test("Escape on an EMPTY masked span does not rotate the next word", async () => {
	// The UX round measured this at 30, 100, 160 and 340 ms between keys, i.e.
	// it is not a race. Three delays stand in for the four.
	for (const delay of [0, 30, 160]) {
		const frame = await mount({ conversationId: `conv-esc-${delay}` });
		await type(frame, "/credential ");
		await esc(frame);
		await type(frame, "hello there");
		if (delay > 0) {
			await act(async () => {
				await new Promise((resolve) => realSetTimeout(resolve, delay));
			});
		}
		assert.equal(
			frame.value(),
			"/credential hello there",
			`every character lands where it was typed (${delay} ms between keys)`,
		);
		assert.equal(frame.caret().start, "/credential hello there".length);
	}
});

test("Escape mid-prose on an empty span types correctly too", async () => {
	const frame = await mount();
	await type(frame, "deploy with /credential ");
	await esc(frame);
	await type(frame, "abcde");
	assert.equal(frame.value(), "deploy with /credential abcde");
	// The control the UX round recorded passing: Backspace instead of Escape
	// already typed correctly, and must still.
	const backspaced = await mount({ conversationId: "conv-bs" });
	await type(backspaced, "/credential");
	await type(backspaced, " ");
	await key(backspaced, { key: "Backspace" });
	await type(backspaced, "abcde");
	assert.equal(backspaced.value(), "/credentialabcde");
});

/* ------------------------------------------------------------------ */
/* B1 — a whole-buffer replacement ends a live capture                  */
/* ------------------------------------------------------------------ */

test("a history recall ends a live capture instead of masking into it", async () => {
	const frame = await mount();
	useConversationInputStore
		.getState()
		.addSubmittedMessage(
			frame.conversationId,
			"run the migration again please",
		);
	await settle();
	await type(frame, "/credential ");
	await type(frame, "hunter2");
	assert.match(frame.notice(), /masked as you type/);

	await key(frame, { key: "ArrowUp", text: undefined });

	// The recalled prompt is in the box, the capture is GONE, and the next
	// keystroke is plain text rather than a mask cell.
	assert.equal(frame.value(), "run the migration again please");
	assert.equal(frame.notice(), "", "the capture was dropped with the buffer");
	await type(frame, "!");
	assert.equal(frame.value(), "run the migration again please!");
	await enter(frame);
	// Enter SENT the recalled prompt — it did not mint a pill over it. The
	// message the page received is the operator's own sentence, byte for byte.
	assert.equal(frame.sent.length, 1);
	assert.equal(frame.sent[0][0], "run the migration again please!");
	assert.equal(frame.value(), "", "the box retired the message it sent");
});

test("a conversation switch ends a live capture", async () => {
	const frame = await mount();
	await type(frame, "/credential ");
	await type(frame, "hunter2");
	assert.match(frame.notice(), /masked as you type/);

	const sent = frame.sent;
	await act(async () => {
		root.render(
			h(
				QueryClientProvider,
				{ client },
				h(MessageInput, {
					isLoading: false,
					messages: [{ id: "m", role: "system", timestamp: new Date(0) }],
					conversationId: "conv-2",
					onSendMessage: async (...args) => {
						sent.push(args);
						return true;
					},
				}),
			),
		);
	});
	await settle();

	assert.equal(frame.notice(), "", "the capture did not survive the switch");
	assert.ok(
		!frame.value().includes("•"),
		`the incoming conversation's draft is not masked: ${frame.value()}`,
	);
});

test("the submit's own clear ends a live capture", async () => {
	const frame = await mount({ onSlashCommand: async () => "consumed" });
	await type(frame, "/credential ");
	await type(frame, "hunter2");
	// The send is driven through the form, which is what the button does.
	await clickSend(frame);
	const minted = frame.value();
	assert.ok(minted.includes("[Credential #1, 7 chars]"), minted);
	await clickSend(frame);
	assert.equal(frame.value(), "", "the message left the box");
	assert.equal(frame.notice(), "");
});

/* ------------------------------------------------------------------ */
/* M2 — the picker-accepted token arms the capture                      */
/* ------------------------------------------------------------------ */

test("accepting the /credential row opens the capture, so the paste is captured", async () => {
	const frame = await mount({ onSlashCommand: async () => "consumed" });
	/*
	 * TAB IS THE COMPLETING KEY HERE, not Enter, and that is this composer's own
	 * rule rather than a convenience (main's routing, ported from
	 * `editor.py:_resolve_argument`): in the command phase, Tab completes the word
	 * and never submits, while Enter completes AND RUNS when the choice is
	 * unambiguous — so `/credential` + Enter opens the picker modal, and a short
	 * ambiguous query like `/cred` only grows to the matches' common prefix. Tab
	 * is the gesture whose whole outcome is the completed word, which is the
	 * route this test is about: the token the picker writes, and the capture its
	 * trailing space opens.
	 */
	await type(frame, "/cred");
	await key(frame, { key: "Tab", text: undefined });
	// The name or its alias, whichever the ranking made active: both are the one
	// command and both end in the trailing space that opens the capture.
	assert.match(frame.value(), /^\/(credential|cred) $/);
	assert.equal(frame.sent.length, 0, "completing a row is not a send");
	assert.equal(
		frame.notice(),
		CREDENTIAL_EMPTY_SPAN_DRAFT_NOTICE,
		"the picker-accepted trailing space opens the capture",
	);

	await paste(frame, "PICKED-SECRET-1");
	assert.equal(frame.value(), "[Credential #1, 15 chars] ");
	assert.equal(
		frame.notice(),
		"",
		"the paste minted instead of landing verbatim",
	);
});

/* ------------------------------------------------------------------ */
/* M3 — the first message of a new chat can store                       */
/* ------------------------------------------------------------------ */

test("a credential minted in a NEW chat is stored by the send that creates the session", async () => {
	calls.length = 0;
	let rendered;
	const frame = await mount({
		conversationId: undefined,
		// What a page does with the seam: the send creates the session, calls the
		// seam with the id it got back, and sends the text the seam returns.
		onSendMessage: async (_content, _attachments, _echo, _typed, seam) => {
			if (seam) rendered = await seam("draft-session-id");
			return true;
		},
	});
	await openCapture(frame);
	await paste(frame, "FIRST-MESSAGE-SECRET");
	assert.equal(frame.value(), "[Credential #1, 20 chars] ");

	await clickSend(frame);
	assert.equal(frame.sent.length, 1);
	const [content, , , , seam] = frame.sent[0];
	assert.equal(
		typeof seam,
		"function",
		"the draft send carries the seam the store needs",
	);
	assert.ok(
		content.includes("[Credential #1, 20 chars]"),
		"the unsubstituted payload is what the seam is handed",
	);

	assert.ok(
		/\[credential LOP_SECRET_[A-Z2-9]{8} \(20 chars\)/.test(String(rendered)),
		`the seam's answer cites the stored name: ${rendered}`,
	);
	const store = calls.find(
		(call) =>
			call.request.op === "sessions.credential" &&
			call.request.action === "store",
	);
	assert.ok(store, "the value was stored on the session the send created");
	assert.equal(store.request.sessionId, "draft-session-id");
	assert.equal(store.request.value, "FIRST-MESSAGE-SECRET");
});

/* ------------------------------------------------------------------ */
/* M4 — the minted pill reaches the persisted draft                     */
/* ------------------------------------------------------------------ */

test("a minted pill is persisted, and the value behind it never is", async () => {
	const frame = await mount({ conversationId: "conv-persist" });
	await type(frame, "keep this /credential ");
	// Typed rather than pasted: a paste into an EMPTY open span mints in one
	// edit, so it would never reach the masked state this test is about.
	await type(frame, "PERSISTED-SECRET");
	assert.equal(
		frame.draft(),
		"keep this /credential ",
		"§6: nothing is written while the mask is open",
	);
	assert.equal(frame.value(), "keep this /credential ••••••••••••••••");

	await enter(frame);
	assert.equal(frame.value(), "keep this [Credential #1, 16 chars] ");
	assert.equal(
		frame.draft(),
		frame.value(),
		"§6: the marker text IS persisted, so a remount repaints the pill",
	);
	assert.ok(!String(frame.draft()).includes("PERSISTED-SECRET"));

	// The remount that §6 is about: a fresh composer on the same conversation
	// adopts the persisted draft.
	const remounted = await mount({
		conversationId: "conv-persist",
		keepWorld: true,
	});
	assert.equal(
		remounted.value(),
		"keep this [Credential #1, 16 chars] ",
		"the remounted composer repaints the pill from the persisted draft",
	);
});

/* ------------------------------------------------------------------ */
/* M6 — after an Escape the text the operator reads is what is sent     */
/* ------------------------------------------------------------------ */

test("after an empty-span Escape the leading token is prose, not the command", async () => {
	/*
	 * A DISPATCHER IS MOUNTED, and the test is empty without it: `planFor`
	 * answers "send" whenever `onSlashCommand` is absent, so a composer with no
	 * dispatcher would send this draft as prose whether or not the cancelled
	 * token is excluded — the assertion below would pass on the broken code too
	 * (code review round 1's lesson about vacuous pins, applied to this one).
	 */
	const ran = [];
	const frame = await mount({
		conversationId: "conv-6",
		onSlashCommand: async (invocation) => {
			ran.push(invocation);
			return "consumed";
		},
	});
	await type(frame, "/credential ");
	await type(frame, "sk-live-CANARY-4417");
	await esc(frame);
	assert.equal(frame.value(), "/credential sk-live-CANARY-4417");
	assert.match(frame.notice(), /PLAIN TEXT/);

	await clickSend(frame);
	assert.equal(
		ran.length,
		0,
		"the cancelled token did not dispatch as a command",
	);
	assert.equal(frame.sent.length, 1, "the restored text was sent");
	assert.equal(
		frame.sent[0][0],
		"/credential sk-live-CANARY-4417",
		"what the notice promised Enter would expose is what was sent",
	);
});

test("after an Escape the token stops suppressing once an edit moves it", async () => {
	const ran = [];
	const frame = await mount({
		conversationId: "conv-6b",
		onSlashCommand: async (invocation) => {
			ran.push(invocation);
			return "consumed";
		},
	});
	await type(frame, "/credential ");
	await type(frame, "SECRET");
	await esc(frame);
	// An edit BEFORE the token moves it, so it is the dispatcher's again: this
	// is the "cleared by any edit that moves it" half of the rule.
	await act(async () => {
		const field = frame.textarea();
		const next = `please ${field.value}`;
		writeValue(field, next, next.length);
	});
	await settle();
	await clickSend(frame);
	/*
	 * The OTHER direction, and the reason the exception is scoped to the
	 * cancelled run: once an edit has moved the token, it is the dispatcher's
	 * again and `/credential <args>` keeps the behaviour it exists for — the
	 * arguments are stripped so a secret can never land in command text, and no
	 * message carries the token.
	 */
	assert.equal(
		ran.length,
		1,
		"the moved token dispatched as the command again",
	);
	assert.equal(frame.sent.length, 0, "the command consumed the draft");
	assert.ok(
		!frame.value().includes("SECRET"),
		`the command text carried no secret: ${frame.value()}`,
	);
});

/* ------------------------------------------------------------------ */
/* U7 + D3 — the notice is described to the field, and always occupies   */
/* its line                                                             */
/* ------------------------------------------------------------------ */

test("the notice is tied to the field, lives on the composer's own control row, and reserves nothing", async () => {
	const frame = await mount({ conversationId: "conv-7" });
	/*
	 * D3 + D4 (design round 2). The element exists with NO sentence — so it is
	 * discoverable and the field can name it the moment one arrives — but it is
	 * mounted on the row the composer ALREADY has, not in a band of its own above
	 * the textarea.
	 *
	 * That home is what makes the reservation unnecessary: the row is sized by
	 * its icon buttons (32px measured), so a 19.5px line inside it adds no height
	 * in any of the four states, and an EMPTY element generates no line box at all,
	 * so the idle composer is geometrically the composer that was here before this
	 * feature (before: `min-h-[19.5px]` pinned a line above the textarea even when
	 * the sentence was absent). jsdom has no layout engine, so what is asserted
	 * here is the STRUCTURE that produces it; the four measured `y` values are the
	 * design round's own numbers, taken from a rendered frame.
	 */
	const idle = window.document.getElementById("composer-credential-notice");
	assert.ok(idle, "the notice slot is mounted in the idle composer");
	assert.equal(idle.textContent, "");
	// `<output>` carries `status` implicitly, which is the role the UX round
	// read off the accessibility tree; there is no attribute to assert.
	assert.equal(idle.tagName, "OUTPUT");
	assert.equal(
		frame.textarea().getAttribute("aria-describedby"),
		null,
		"an idle composer is not described by an empty element",
	);
	// One of the composer's own rows, and the send control's own row at that:
	// nothing above the textarea is reserved for this sentence any more.
	const row = idle.parentElement;
	assert.ok(
		row.contains(frame.button()),
		"the notice shares the row that holds the composer's controls",
	);
	assert.ok(
		!row.contains(frame.textarea()),
		"and that row is NOT the textarea's, so a sentence in it cannot move the typed line",
	);
	assert.ok(
		!(idle.className || "").includes("min-h-"),
		"no reserved line box is pinned on the element: the row's own height absorbs it",
	);

	await type(frame, "/credential ");
	// Typed, not pasted: a paste into an empty open span mints, and this test is
	// about the state that is still masking.
	await type(frame, "SECRET");
	// U7: the sentence the field's value cannot read out is linked to the field.
	assert.equal(
		frame.textarea().getAttribute("aria-describedby"),
		"composer-credential-notice",
	);
	assert.match(frame.notice(), /masked as you type/);
	assert.ok(
		!/chip/.test(frame.notice()),
		"the marker is a pill here; this composer's chip is the directory control",
	);
});
/* ------------------------------------------------------------------ */
/* Round 2 — U8/Q5, D2/U11/MAJOR-1, U9, U10                             */
/* ------------------------------------------------------------------ */

/*
 * WHAT THE OVERLAY ACTUALLY PAINTED, read off the DOM.
 *
 * The overlay is a background-only mirror of the textarea's own text, one
 * `<span>` per paint segment, so the segments ARE the paint: a marker that no
 * payload backs is either a `pill` span (painted) or a `plain` one (not).
 * Code review round 2 asked for exactly this — the round-1 pin asserted
 * `frame.value()`, which is the marker TEXT and is identical whether or not
 * anything is painted underneath it, so the sentence in its message ("the
 * remounted composer repaints the pill") could not be falsified by the pin.
 */
const painted = () => {
	const overlay = [
		...window.document.querySelectorAll("div[aria-hidden='true']"),
	].find((el) => el.classList.contains("-z-10"));
	if (!overlay) return [];
	return [...overlay.children].map((span) => ({
		text: span.textContent,
		pill: span.className.includes("bg-info-wash"),
		armed: span.className.includes("bg-warning-wash"),
	}));
};

test("a credential in a NEW chat's FIRST message is stored against the session the send created", async () => {
	/*
	 * UX round 2's U8 / QA round 2's Q5, in-process: the seam this test drives is
	 * the one the real host drives, and the mount now carries the props the real
	 * New-chat pane carries.
	 *
	 * THE STATUS OBJECT IS THE FINDING. A draft pane is handed a [`sessionStatus`]
	 * by the page — built from `sessions.preview`, with `draft: true` — because
	 * the status strip renders the draft's own readings from it. Round 1's pin
	 * mounted the composer with NO status object at all, so it exercised the seam
	 * by accident: the production pane took the other branch of the same
	 * expression, believed it had a session, and stored against the pane's own
	 * non-session id. `desktopRequestSchema` refuses that id locally — it must be
	 * twelve hex digits — with a 422 that never reaches the wire, and the
	 * composer's 4xx branch recorded it as "the store refused", so the operator's
	 * first message arrived at the model as `[credential NOT stored …]` with no
	 * store request anywhere on the wire.
	 *
	 * So the mount below is the draft pane's own shape, and the assertion is the
	 * one that fails without the fix: the composer must HAND THE HOST A SEAM.
	 */
	const stored = [];
	// The rig's own convention (see the M3 case above): the request log is
	// module-level, so each case clears it and asserts only on its own calls.
	calls.length = 0;
	const frame = await mount({
		conversationId: "draft-pane-1",
		sessionStatus: { frontend: null, draft: true },
		onSendMessage: async (
			_payload,
			_attachments,
			_onEchoPainted,
			_typed,
			seam,
		) => {
			assert.ok(
				seam,
				"a draft pane must hand the host the before-admission seam",
			);
			const rendered = await seam("3b83870393a1");
			stored.push(rendered);
			return true;
		},
	});
	await openCapture(frame, { prose: "here is my key " });
	await type(frame, "sk-live-CANARY-4417");
	await enter(frame);
	await clickSend(frame);
	await settle();

	assert.equal(stored.length, 1, "the seam ran once");
	assert.match(
		stored[0],
		/\[credential LOP_SECRET_[A-Z2-9]{8} \(19 chars\)/,
		"the value reached the session the send created, so the citation names its key",
	);
	/*
	 * The wire, from the rig's own request log: ONE store, addressed to the CREATED
	 * session — and no store against the pane's own id, which is what the pre-fix
	 * composer attempted (and which the real transport refuses locally, since a
	 * session id must be twelve hex digits, so the request never appears at all).
	 */
	const posts = calls.filter(
		(c) =>
			c.request?.op === "sessions.credential" && c.request.action === "store",
	);
	assert.equal(posts.length, 1, "exactly one store for the whole gesture");
	assert.equal(
		posts[0].request.sessionId,
		"3b83870393a1",
		"addressed to the CREATED session, not to the pane's own id",
	);
	assert.equal(posts[0].request.value, "sk-live-CANARY-4417");
});

test("a marker whose payload did not survive is painted, and sent as the not-stored citation", async () => {
	/*
	 * Design round 2's D2 + UX round 2's U11 + code review round 2's MAJOR 1, all
	 * three faces of §6's one decision: the marker text is persisted and the
	 * payload map is not. §6 claimed a restored draft "repaints its pill" and that
	 * "a submit in that state finds nothing to store, so the citation says so".
	 * Neither was true: the marker painted as prose and was sent VERBATIM, so the
	 * model received a composer-local `[Credential #1, 19 chars]` naming a key
	 * nothing holds.
	 */
	// The rig's own convention (see the M3 case above): the request log is
	// module-level, so each case clears it and asserts only on its own calls.
	calls.length = 0;
	const frame = await mount({ conversationId: "conv-unbacked" });
	await openCapture(frame);
	await type(frame, "sk-live-CANARY-4417");
	await enter(frame);
	assert.equal(frame.value(), "[Credential #1, 19 chars] ");
	assert.equal(painted().filter((s) => s.pill).length, 1, "minted: one pill");

	// A RELOAD: same conversation, same persisted draft, and a composer whose
	// payload map is empty because it is a ref and refs do not survive one. The
	// host is a draft pane's, so the send carries its markers into the seam —
	// which is where the rewrite happens, and where the model's text comes from.
	const handed = [];
	const reloaded = await mount({
		conversationId: "conv-unbacked",
		keepWorld: true,
		remount: true,
		onSendMessage: async (_content, _attachments, _echo, _typed, seam) => {
			if (seam) handed.push(await seam("2e0e7dbc066a"));
			return true;
		},
	});
	assert.equal(reloaded.value(), "[Credential #1, 19 chars] ");
	assert.equal(
		painted().filter((s) => s.pill).length,
		1,
		"an unbacked marker is painted as a pill, not left as literal text",
	);

	await clickSend(reloaded);
	await settle();
	const sent = String(handed.at(-1));
	assert.ok(
		!sent.includes("[Credential #1, 19 chars]"),
		`the bare marker must not reach the model: ${sent}`,
	);
	assert.match(
		sent,
		/\[credential NOT stored — its value did not survive; ask the operator to paste it again\]/,
		"the marker is rewritten to the cause that actually applies",
	);
	assert.ok(
		!/LOP_SECRET_/.test(sent),
		"and no key is named: there is no name for a value that never arrived",
	);
});

test("a restored draft still discloses the characters an Esc unredacted", async () => {
	/*
	 * Design round 2's D2: the live state discloses itself and the persisted one
	 * did not, so a reload, a quit or a crash reached the one state §5 says must
	 * never be silent — an ordinary-looking composer holding plaintext — and the
	 * very next Enter exposed it. The characters are the operator's prose (§6) and
	 * stay in the draft; the disclosure now travels with them.
	 */
	const frame = await mount({ conversationId: "conv-disclose" });
	await openCapture(frame, { prose: "deploy with " });
	await type(frame, "sk-live-CANARY-4417");
	await esc(frame);
	assert.equal(
		frame.notice(),
		unredactedNotice(19),
		"the live state discloses, as round 1 pinned",
	);

	// The persisted draft carries the characters AND the count.
	const raw = JSON.parse(
		window.localStorage.getItem("conversation-input-store"),
	).state.inputByConversation["conv-disclose"];
	assert.equal(raw.currentInput, "deploy with /credential sk-live-CANARY-4417");
	assert.equal(
		raw.unredactedChars,
		19,
		"the count is persisted with the draft",
	);

	// A reload. Same conversation, empty payload map, characters restored.
	const reloaded = await mount({
		conversationId: "conv-disclose",
		keepWorld: true,
		remount: true,
	});
	assert.equal(reloaded.value(), "deploy with /credential sk-live-CANARY-4417");
	assert.equal(
		reloaded.notice(),
		unredactedNotice(19),
		"the disclosure survives the restore, in the same words the live state used",
	);
});

test("an Esc-cancelled token is prose even when the span was empty (U9)", async () => {
	/*
	 * The same visible buffer had opposite outcomes depending on whether the span
	 * had held characters: with characters in it the escape made the token inert,
	 * and with none the next words the operator typed were DISPATCHED — the
	 * picker opened, the words became its argument, the composer was stripped back
	 * to `deploy with`, nothing was sent and nothing said why.
	 */
	const dispatch = [];
	const frame = await mount({
		onSlashCommand: async (command) => {
			dispatch.push(command);
			return "consumed";
		},
	});
	await type(frame, "deploy with /credential ");
	await esc(frame);
	await type(frame, "mysecretname");
	assert.equal(frame.value(), "deploy with /credential mysecretname");
	await enter(frame);
	await settle();
	assert.deepEqual(
		dispatch,
		[],
		"an Esc-cancelled token never reaches the dispatcher",
	);
	const sent = frame.sent.at(-1)[0];
	assert.equal(
		typeof sent === "string" ? sent : sent.text,
		"deploy with /credential mysecretname",
		"the operator's own sentence is what was sent",
	);

	/*
	 * The other direction, unchanged and deliberately so: `/credential <args>`
	 * with no capture and no cancel is still the COMMAND's own line, and it still
	 * consumes its arguments so a secret can never land in command text.
	 */
	const dispatched = [];
	const control = await mount({
		conversationId: "conv-control",
		onSlashCommand: async (command) => {
			dispatched.push(command);
			return "consumed";
		},
	});
	await type(control, "/credential --forget-all");
	await enter(control);
	await settle();
	assert.equal(
		dispatched.length,
		1,
		"an uncancelled /credential still dispatches",
	);
	assert.equal(control.value(), "", "and its arguments never stay in the box");
});

test("the empty span's sentence names what Enter does in a LIVE session", async () => {
	/*
	 * UX round 2's U10: the bare token's cover sentence described neither Enter
	 * outcome. On a pane with a session, Enter falls through to the dispatcher and
	 * opens the credential picker; on a pane without one it cannot store at all.
	 * The two states say so, in their own words — and this is the live one.
	 */
	const frame = await mount({
		conversationId: "2e0e7dbc066a",
		sessionStatus: { frontend: null },
	});
	await openCapture(frame);
	assert.equal(frame.notice(), CREDENTIAL_EMPTY_SPAN_NOTICE);
	assert.match(frame.notice(), /picker/);
	assert.ok(
		!frame.notice().includes("new chat"),
		"a session pane does not warn about the draft pane's limitation",
	);
});

test("an empty-span Escape parks no caret, so the next word lands where it was typed", async () => {
	/*
	 * Code review round 2, MINOR 2: the round-1 U1 pin passed with the
	 * caret-parking guard DELETED, because the change that fixed U1 also retires
	 * the composer's caret marker from the `onSelect` the browser fires — two
	 * mechanisms, and jsdom's select-event ordering is what decides which one a
	 * black-box pin exercises. This case puts the guard on the critical path: the
	 * operator has moved the caret back into their own sentence, and an Esc whose
	 * own edit changes nothing must not snap it to the token's end. Deleting the
	 * guard makes the composer park `span.start + restored` (the token's end) and
	 * the next character lands there instead of under the operator's caret.
	 */
	const frame = await mount({ conversationId: "conv-caret" });
	await type(frame, "/credential ");
	const field = frame.textarea();
	await act(async () => {
		field.setSelectionRange(4, 4);
		field.dispatchEvent(new window.Event("select", { bubbles: true }));
	});
	await settle();
	await esc(frame);
	assert.deepEqual(
		frame.caret(),
		{ start: 4, end: 4 },
		"the caret stays where the operator put it: the cancel's own edit moved nothing",
	);
	await type(frame, "X");
	assert.equal(frame.value(), "/creXdential ");
	assert.deepEqual(frame.caret(), { start: 5, end: 5 });
});

test("the minted name dodges the session's own names, read through the mounted composer (§8)", async () => {
	/*
	 * Code review round 2, MINOR 3: with the harness answering the runtime's
	 * shape the guard is live, and this case puts it on the critical path instead
	 * of trusting the shape. `credentialList` already holds `LOP_SECRET_ABCDEFGH`,
	 * and the draw is pinned so the composer's FIRST candidate is exactly that
	 * name: the guard must skip it and mint the next one.
	 *
	 * The draw is the only way to reach a collision from outside — the real one is
	 * CSPRNG over 30^8, which is why QA recorded this as unpinnable end to end
	 * and why the guard is worth a pin here instead. `getRandomValues` is restored
	 * whatever happens.
	 */
	const strings = "ABCDEFGH";
	const drawValues = [...strings].map((c) =>
		CREDENTIAL_KEY_ALPHABET.indexOf(c),
	);
	assert.deepEqual(
		drawValues,
		[0, 1, 2, 3, 4, 5, 6, 7],
		"sanity: the seeded name is in alphabet order, so the draw is its indices",
	);
	// The rig's own convention (see the M3 case above): the request log is
	// module-level, so each case clears it and asserts only on its own calls.
	calls.length = 0;
	const frame = await mount({
		conversationId: "2e0e7dbc066a",
		// A live session: the arm-time `list` read is what populates the guard.
		sessionStatus: { frontend: null },
		onSendMessage: async () => true,
	});
	await openCapture(frame);
	await settle();
	assert.ok(
		calls.some(
			(c) =>
				c.request?.op === "sessions.credential" && c.request.action === "list",
		),
		"arming reads the session's names",
	);

	const real = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
	const remaining = [...drawValues, ...drawValues.map(() => 9)];
	globalThis.crypto.getRandomValues = (buffer) => {
		const next = remaining.shift();
		if (next === undefined) return real(buffer);
		buffer[0] = next;
		return buffer;
	};
	let receipt;
	try {
		await paste(frame, "sk-live-CANARY-4417");
		receipt = frame.sent;
	} finally {
		globalThis.crypto.getRandomValues = real;
	}
	assert.ok(receipt, "the paste minted");
	assert.equal(
		frame.value(),
		"[Credential #1, 19 chars] ",
		"the paste minted one credential",
	);
	const beforeSend = calls.filter(
		(c) =>
			c.request?.op === "sessions.credential" && c.request.action === "store",
	);
	assert.equal(beforeSend.length, 0, "minting does not store; the send does");
	await clickSend(frame);
	await settle();
	const key = calls
		.filter(
			(c) =>
				c.request?.op === "sessions.credential" && c.request.action === "store",
		)
		.at(-1)?.request.key;
	assert.ok(key, "the send stored a credential");
	assert.notEqual(
		key,
		"LOP_SECRET_ABCDEFGH",
		"the name the session already held was skipped rather than replaced",
	);
	assert.equal(
		key,
		"LOP_SECRET_KKKKKKKK",
		"the next candidate is the one that was used (the alphabet's own order:\n\t\t\t\t\t\t * `ABCDEFGH…`, so index 9 is `K`, not `J`)",
	);
	assert.deepEqual(
		credentialList,
		[{ key: "LOP_SECRET_ABCDEFGH", source: "command" }],
		"the session's own name is untouched: nothing was replaced",
	);
	assert.equal(
		CREDENTIAL_KEY_ALPHABET.length,
		30,
		"sanity: the alphabet indexed",
	);
});
