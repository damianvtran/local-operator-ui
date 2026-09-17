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

/*
 * `window.matchMedia`, which jsdom does not implement at all.
 *
 * It becomes reachable from here for the first time with the CENTRING band's
 * case below: the tip row that band renders reads a media query (reduced
 * motion), and every other composer in this file is bottom-anchored and never
 * mounts it. Reporting `matches: false` is the honest default — it is the state
 * a browser with the preference unset reports, and the query is not what any
 * assertion here is about.
 */
/*
 * ONE object per query, and it is load-bearing rather than tidy: `matchMedia` is
 * read through `useSyncExternalStore`, whose `getSnapshot` must return the same
 * value between renders or React re-renders forever. A stub that built a fresh
 * object per call hung this file's centring-band case (measured: the file timed
 * out at 80s with no assertion ever running).
 */
/*
 * AND THE WINDOW'S OWN TIMERS, not only the globals above. The tip row that the
 * CENTRING band renders schedules its rotation on `window.setInterval`, which is
 * jsdom's own function and not the global one this fixture wrapped — so it was
 * never recorded and never cleared, and the file hung after the mount with the
 * process held open (measured: 45-84s per run, no assertion involved).
 */
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
		/*
		 * THE RUNTIME'S OWN MODE, not a simplification: `slash_commands.py`
		 * declares `ArgumentMode.OPTIONAL` for `/credential`, and the planner reads
		 * this field as one of its three vocabularies — so a stub saying `none` would
		 * have the suite assert a shape the app cannot produce (`/credential
		 * --forget-all` typed whole is a whole-draft command there).
		 */
		arguments: "optional",
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
			export { CHAT_MEASURE } from "./src/renderer/src/features/chat/chat-measure";
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
	CHAT_MEASURE,
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
	/*
	 * THE TRANSCRIPT IS A PARAMETER, because it decides the BAND's own shape and
	 * not only the content above it: `messages: []` is the state in which the band
	 * claims the column and centres the composer's group (see the mirror's case
	 * below), and every other case here pins the bottom-anchored composer, which is
	 * what a populated pane has.
	 */
	messages = [{ id: "m", role: "system", timestamp: new Date(0) }],
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
		/*
		 * The composer BOX (the control the focus ring is promoted to), which since
		 * round 3 is the element the sentence sits ABOVE rather than inside.
		 */
		box: () =>
			window.document.querySelector('[data-tour-tag="chat-input-textarea"]'),
		/*
		 * §5's disclosure AS IT IS PERSISTED, read from the store the app writes:
		 * `undefined` when the conversation holds no draft at all, and the store's
		 * own 0 when it holds one that discloses nothing. A count written with text
		 * it does not describe is visible here and nowhere else.
		 */
		disclosure: () => {
			const raw = window.localStorage.getItem("conversation-input-store");
			if (!raw) return undefined;
			const parsed = JSON.parse(raw);
			return parsed?.state?.inputByConversation?.[conversationId]
				?.unredactedChars;
		},
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
					messages,
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
	/*
	 * AND IT DESCRIBES THE GESTURE THE OPERATOR IS STANDING IN (UX round 3, U15).
	 * The round-2 sentence ("a new chat has no open conversation yet, so Enter
	 * cannot store a credential") was true when U8 was open and false about this
	 * pane once it was repaired: typing a secret into the span and sending now
	 * stores it. What is still true is narrower - with the span EMPTY, Enter falls
	 * through to the dispatcher, which runs `/credential` and answers that it needs
	 * an open conversation - so the sentence names that and the action that works.
	 * Pinned on the WORDS, not on the constant, because the constant is what the
	 * last round's copy change edited in place.
	 */
	assert.match(
		frame.notice(),
		/Enter runs \/credential/,
		"the draft pane's empty-span sentence says what Enter actually does",
	);
	assert.ok(
		!/cannot store a credential/.test(frame.notice()),
		"and does not attribute the empty span's dead end to the missing conversation, which this pane no longer is",
	);
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

test("a token the PICKER wrote is the dispatcher's wherever an edit moves it", async () => {
	/*
	 * The PICKED half of the gesture rule, driven rather than asserted: the
	 * operator's own report kept the pick ("if you don't actually hit enter on the
	 * suggested command or click it"), so a token the picker wrote is a command
	 * wherever it sits — and #238's property is what needs it to be one, because
	 * the dispatcher refuses `/credential`'s arguments, so a secret can never land
	 * in command text. Tab writes the token without running it (this composer's own
	 * completing key), and the edit then MOVES it, which is the shape a buffer's
	 * text cannot tell from one typed there: the pick's own record is the
	 * difference, and this case is what pins it (review round 10, MINOR-3 —
	 * deleting the recording lines left the suite green).
	 */
	const ran = [];
	const frame = await mount({
		conversationId: "conv-picked-moved",
		onSlashCommand: async (command) => {
			ran.push(command);
			return "consumed";
		},
	});
	await type(frame, "/cred");
	await key(frame, { key: "Tab", text: undefined });
	assert.match(frame.value(), /^\/(credential|cred) $/);
	assert.equal(ran.length, 0, "completing the row did not run it");
	/*
	 * A SECOND pick, from a fresh draft: the read is a /g `exec`, so a caller that
	 * did not reset `lastIndex` would answer `null` here and the record would never
	 * be set (review round 10, MINOR-2). One pick alone cannot tell the two apart.
	 */
	await act(async () => writeValue(frame.textarea(), "", 0));
	await type(frame, "/cred");
	await key(frame, { key: "Tab", text: undefined });
	assert.match(frame.value(), /^\/(credential|cred) $/);
	await act(async () => {
		const field = frame.textarea();
		const next = `please ${field.value}SECRET`;
		writeValue(field, next, next.length);
	});
	await settle();
	await enter(frame);
	await settle();
	assert.equal(
		ran.length,
		1,
		"a PICKED token dispatches where an edit moved it, so its arguments are refused",
	);
	assert.equal(frame.sent.length, 0, "and the token never travels as prose");
});

test("a pick does not outlive its conversation as a claim about a later typed draft", async () => {
	/*
	 * The switch retires BOTH gesture records (review round 10, MINOR-1). A pick
	 * that only armed the sibling's clear left `pickedToken` holding `/credential`,
	 * so the NEXT conversation planned a hand-typed draft containing that text as a
	 * pick — the reviewer's probe answered `splice` where it must be prose. A second
	 * `mount` without `remount` IS the switch this rig can express: same instance,
	 * same refs, a new conversation.
	 *
	 * The draft is shaped so the CAPTURE cannot mask the difference: the arm needs
	 * the token at the end of the buffer, and `please /credential and more` does not
	 * end with it — so what Enter does here is the planner's answer, which is the
	 * fact under test.
	 */
	const ran = [];
	const frame = await mount({
		conversationId: "conv-pick-then-switch",
		onSlashCommand: async (command) => {
			ran.push(command);
			return "consumed";
		},
	});
	await type(frame, "/cred");
	await key(frame, { key: "Tab", text: undefined });
	assert.match(frame.value(), /^\/(credential|cred) $/);

	const next = await mount({
		conversationId: "conv-typed-after-switch",
		onSlashCommand: async (command) => {
			ran.push(command);
			return "consumed";
		},
	});
	await type(next, "please /credential and more");
	await enter(next);
	await settle();
	assert.deepEqual(
		ran,
		[],
		"a typed draft is prose, whatever the last pick wrote",
	);
	/*
	 * WHAT ENTER DID, stated honestly: nothing was dispatched, and the typed token
	 * opened the CAPTURE — this composer's designed route for a secret after a
	 * space — so the box holds the masked citation rather than running anything.
	 * The capture is why this case observes the no-dispatch half rather than the
	 * plan itself: a typed credential token never reaches the planner, which is the
	 * property #238 exists to keep.
	 */
	assert.match(
		next.value(),
		/^please (\/credential and more|\[Credential #1, \d+ chars\] )$/,
		"the sentence survives, with its secret masked",
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

test("the notice is tied to the field, sits ABOVE the composer box in the band's flow, and reserves nothing", async () => {
	const frame = await mount({ conversationId: "conv-7" });
	/*
	 * ROUND 3'S PLACEMENT (design D1; UX U14; code review MAJOR 1; QA Q1/Q2).
	 *
	 * The sentence used to ride the composer's own control row, on the argument
	 * that the row is 32px tall and is sized by its icon buttons, so a 19.5px line
	 * inside it adds no height. Measured on the running app that holds only where
	 * the row has free space to spare, and a working-directory chip removes it: at
	 * 1380 the sentence needs ~353.86px and the row has 296.55px, so it wrapped to
	 * two lines and grew the row 32 -> 39px, moving the typed line 3.5px (band
	 * centred) or 7px (band bottom-anchored); at 950 it became a 168x78 block and
	 * squeezed the cwd chip's label from 236px to 96px; at 800 - this app's own
	 * `WINDOW_MIN_WIDTH` - it was a 76.7px-wide ribbon 175.5px tall with the row
	 * tripled. The band pins the box's BOTTOM edge, so anything inside the box that
	 * makes it taller pushes the typed line up.
	 *
	 * So the sentence lives OUTSIDE the box and ABOVE it, in the band's own flow on
	 * the composer's measure, where the pinned edge cannot be pushed by it.
	 * MEASURED, not asserted structurally: a 20px line injected above the box moves
	 * `textarea.y` by 0.00px on a populated pane (757.00 -> 757.00 at 1380; the
	 * 20px injected line is the design record's §7.5 table), and the same line
	 * injected below it moves it by a full 20px (757.00 -> 737.00). The 751.30 this
	 * comment used to quote was the PRE-REMEDIATION rig's figure, taken before the
	 * sentence left the composer, and the state the paragraph below is about did
	 * not exist there (code review round 4, MINOR 3). jsdom
	 * has no layout engine, so what this test pins is the STRUCTURE that produces
	 * that; the numbers are the live rig's.
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
	/*
	 * The two halves that make the placement what it is: the sentence is out of
	 * the box (so the box's own height cannot change when it arrives), and it is
	 * between the box and whatever the transcript above it is doing (so the box is
	 * the element the flow's bottom edge pins). The box is asserted to be the
	 * notice's NEXT SIBLING, which is the structural form of "above the box".
	 */
	const box = frame.box();
	assert.ok(box, "the composer box is mounted");
	assert.ok(
		!box.contains(idle),
		"the sentence is not inside the composer box: a line in there grows the box, and the box grows upward",
	);
	assert.equal(
		box.previousElementSibling,
		idle,
		"the sentence is the box's own previous sibling, i.e. immediately above it",
	);
	/*
	 * And the slash popup shares that anchoring wrapper, so the completion list
	 * clears the sentence instead of painting over it: the popup is `absolute
	 * bottom-full`, so its bottom edge IS the wrapper's top edge, and the wrapper's
	 * top edge is the sentence's own while there is one. The popup renders only
	 * when it has something to list, so this test asserts the half it can see in an
	 * idle document (the wrapper is a positioned ancestor, and the sentence and the
	 * box share it) and `canonical-chat.test.mjs`'s clipping guard asserts the half
	 * that is readable in the source: the popup's own parent is that wrapper.
	 */
	const wrapper = idle.parentElement;
	assert.equal(
		box.parentElement,
		wrapper,
		"the sentence and the box share one anchoring wrapper",
	);
	assert.ok(
		/(^|["\s])relative(["\s]|$)/.test(
			`${wrapper.getAttribute("class") ?? ""} `,
		),
		"the wrapper is the positioned ancestor the popup's `bottom-full` resolves against",
	);
	assert.ok(
		!(idle.className || "").includes("min-h-"),
		"no reserved line box is pinned on the element",
	);
	/*
	 * And the field states its own DISPLAY, which is the composer-height half of
	 * round 3 (design D1; code review MAJOR 1's sibling; QA Q2). jsdom has no layout
	 * engine, so this is the structural stand-in for a measured fact: the overlay's
	 * wrapper is a block container, and a textarea left at its default
	 * `inline-block` sits in a LINE BOX inside it. Live, that came out as a 39.7px
	 * wrapper around a 34px field and a composer box 5.7px taller than `origin/main`
	 * in EVERY state, idle included (61.4..179.1 against 61.4..173.4 at the
	 * 1024x300 story; 124.69 against 117.69 on the app at 1380), moving the ring,
	 * the control row and the box's bottom edge. `block` removes the line box, and
	 * with it the diff: the app now measures 112.00px against `origin/main`'s
	 * 112.00px with the field at the same `y` in all four states.
	 */
	assert.ok(
		/\bblock\b/.test(frame.textarea().className),
		"the field declares its own `block` box, so the wrapper cannot place it in a line box",
	);
	/*
	 * The idle slot is HIDDEN rather than merely empty, which is the other half of
	 * "reserves nothing": an empty `<output>` with the sentence's padding would
	 * still be a box the band has to lay out. `hidden` is asserted on the CLASS
	 * because jsdom does not apply the stylesheet.
	 */
	assert.ok(
		/\bhidden\b/.test(idle.className),
		`an empty sentence renders no box at all: ${idle.className}`,
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
	assert.equal(
		frame.notice(),
		"masked as you type — Enter turns it into a pill, Esc cancels",
	);
	assert.ok(
		!/\bhidden\b/.test(idle.className),
		"a sentence takes the box back",
	);
	assert.ok(
		!/chip/.test(frame.notice()),
		"the marker is a pill here; this composer's chip is the directory control",
	);
});

/*
 * THE DISCLOSURE IS RETIRED BY AN EDIT, AND IS NEVER PERSISTED WITH TEXT IT DOES
 * NOT DESCRIBE (UX round 3, U12; code review round 3, MINOR 1).
 *
 * Both halves in one case, because each half alone leaves the other broken: a
 * count that keeps describing text the operator has since changed survives a
 * reload as a plaintext draft under a sentence about different characters, and a
 * rendered sentence that cannot come down says so over a box holding nothing.
 * The numbers are the ones the UX round measured on the running app - four
 * backspaces after `/credential BACKSPACE-1`, and a select-all-Delete followed by
 * ordinary prose.
 */
test("an edit retires the disclosure, and the draft never carries a count it does not describe", async () => {
	const frame = await mount({ conversationId: "conv-retire" });
	await openCapture(frame);
	await type(frame, "BACKSPACE-1");
	await esc(frame);
	assert.equal(
		frame.notice(),
		unredactedNotice(11),
		"the Esc discloses the eleven characters it put back",
	);
	assert.equal(
		frame.disclosure(),
		11,
		"and the count is persisted WITH the text it describes",
	);

	// Repro A: four backspaces take the box to "/credential BACKSPA".
	for (let i = 0; i < 4; i++) await key(frame, { key: "Backspace" });
	assert.equal(frame.value(), "/credential BACKSPA");
	assert.equal(
		frame.notice(),
		"",
		"the sentence comes down on the edit instead of still claiming eleven characters",
	);
	assert.equal(
		frame.disclosure(),
		0,
		"and the count is not written beside the seven-character remnant",
	);

	// Repro B: cleared, retyped, and reloaded.
	await type(frame, "hi /credential STALE-1");
	assert.equal(
		frame.disclosure(),
		0,
		"typing the characters back does not re-raise a count: the disclosure is retired for good by the first edit",
	);
	const field = frame.textarea();
	await act(async () => {
		field.setSelectionRange(0, field.value.length);
	});
	await key(frame, { key: "Delete" });
	assert.equal(frame.value(), "");
	assert.equal(frame.notice(), "", "an empty draft renders no sentence");
	assert.equal(frame.disclosure(), 0, "and writes none");

	await type(frame, "just some prose");
	assert.equal(
		frame.disclosure(),
		0,
		"ordinary prose is never written with a count it does not describe",
	);
	assert.equal(frame.notice(), "");

	// The reload that used to bring the false sentence back.
	const reloaded = await mount({
		conversationId: "conv-retire",
		keepWorld: true,
		remount: true,
	});
	assert.equal(reloaded.value(), "just some prose");
	assert.equal(
		reloaded.notice(),
		"",
		"a reload restores the prose without the claim that it is plaintext secret characters",
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
		/*
		 * ROUND 3 (UX U13) SPLIT THE WARNING ROLE IN TWO, so the background no
		 * longer identifies a span on its own: the armed TOKEN is the wash alone
		 * (the ordinary word the operator just typed, marked), and the not-stored
		 * CHIP is the wash PLUS an edge (a citation nothing holds, marked as one
		 * the operator cannot rely on). The class list is what tells them apart,
		 * and both are asserted below rather than collapsed into one flag.
		 */
		unbacked:
			span.className.includes("bg-warning-wash") &&
			span.className.includes("outline-warning-border"),
		/*
		 * THE EDGE'S STYLE, which round 4 made the not-stored chip's second
		 * distinction (design round 4, D2; code review round 4, MINOR 2; UX round 4,
		 * U17). Hue alone does not separate the chip from a live pill: measured over
		 * the twelve palettes the two washes sit at 1.01-1.11 fill contrast and a
		 * greyscale reading of 34 vs 35 of 255. A dashed edge costs no token and
		 * survives monochrome.
		 */
		dashed: span.className.includes("outline-dashed"),
		armed:
			span.className.includes("bg-warning-wash") &&
			!span.className.includes("outline-warning-border"),
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
		painted().filter((s) => s.unbacked).length,
		1,
		"an unbacked marker is painted in the not-stored state, not left as literal text",
	);
	/*
	 * AND NOT WITH THE LIVE PILL'S OWN TREATMENT (UX round 3, U13). Round 2
	 * painted both states with the same wash and edge, so a chip nothing held was
	 * pixel-identical to one that was fine and the operator learned the value was
	 * gone only from the citation in their own sent message. The two states must
	 * differ on screen before the send: this assertion is the half that fails if
	 * the not-stored kind is folded back into `pill`.
	 */
	assert.equal(
		painted().filter((s) => s.pill).length,
		0,
		"the unbacked marker is NOT painted with the live pill's treatment",
	);
	/*
	 * AND THE CHIP'S EDGE IS DASHED, which is the second distinction and the one
	 * that does not need colour to be seen (design round 4, D2; code review round
	 * 4, MINOR 2; UX round 4, U17). The warning pair against the info pair is a
	 * HUE difference and almost nothing else - the two washes sit at 1.01-1.11
	 * fill contrast across the twelve palettes, and a greyscale reading of them is
	 * 34 vs 35 of 255 - so a reader who cannot separate a warm brown from a cool
	 * blue had no cue at all before pressing Enter. This assertion fails if the
	 * edge goes back to `outline-solid`.
	 */
	assert.equal(
		painted().filter((s) => s.dashed).length,
		1,
		"the not-stored chip's edge is dashed, so its meaning survives its hue",
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
	/*
	 * A conversation id of its own, and not `2e0e7dbc066a`: the rig reuses ONE
	 * root, so two cases that name the same conversation re-render the same
	 * component instance — and the arm-time names fetch is guarded by a ref that
	 * would then already be stamped (`fetchedNamesFor`), silently removing the
	 * read the §8 case below asserts. Distinct ids keep each case's refs its own.
	 */
	const frame = await mount({
		conversationId: "7a1b2c3d4e5f",
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

/* ------------------------------------------------------------------ */
/* Round 4 — the popup's anchor, the centring band's sentence, and the   */
/* mint lane's stale count                                              */
/* ------------------------------------------------------------------ */

/*
 * THE POPUP'S ANCHOR CARRIES THE MEASURE, and this is the structural half of a
 * MEASURED defect (design round 4, D1 — the round's only MAJOR).
 *
 * The slash list renders `absolute bottom-full left-0 right-0`, so its width and
 * its x come from its CONTAINING BLOCK and nothing else. Round 3 moved that
 * anchor from the composer box (which carries `CHAT_MEASURE`) to the wrapper
 * that also holds the sentence, and the wrapper was `w-full` with no measure of
 * its own — so the list silently started resolving against the COLUMN. Measured
 * on the same story and viewport against live `origin/main`: the list was
 * x 63..961 (w 898, the box's own edge) on `main` and x 48..976 (w 928) here,
 * and in a 1332px column 241..1139 (898) became 48..1332 (1284) — a 192px
 * overhang on each side, visible the moment anyone types `/`.
 *
 * jsdom has no layout engine, so what this case pins is the STRUCTURE that
 * produces those numbers: the anchor carries the same measure the box does.
 * Deleting `CHAT_MEASURE` from the wrapper — the mutation this exists for —
 * fails it, and the live x-ranges are the rig's business (the record's §7.5 and
 * the PR's remediation comment carry them).
 */
test("the popup's anchoring wrapper carries the composer's shared measure, not the column's", async () => {
	const frame = await mount();
	const box = frame.box();
	const wrapper = box.parentElement;
	const wrapperClass = ` ${wrapper.getAttribute("class") ?? ""} `;
	for (const part of CHAT_MEASURE.split(" ").filter(Boolean)) {
		assert.ok(
			wrapperClass.includes(part),
			`the anchoring wrapper must carry \`${part}\` of \`CHAT_MEASURE\`: the list's \`left-0 right-0\` resolves against THIS element, so a wrapper without the measure is a second, wider measure for the list (design round 4, D1). Wrapper class was: ${wrapperClass}`,
		);
	}
	/*
	 * The other half of the same rule, and the half that makes the measure above
	 * beat rather than match: the list is `left-0 right-0`, which is what pins its
	 * width to its containing block instead of its content.
	 */
	await openCapture(frame);
	await key(frame, { key: "Backspace" });
	const list = window.document.querySelector('[role="listbox"]');
	assert.ok(list, "the slash list is open on `/cred`");
	assert.equal(
		list.parentElement,
		wrapper,
		"the list's containing block is that wrapper",
	);
	assert.ok(
		/(^|["\s])left-0( |$)/.test(` ${list.getAttribute("class") ?? ""} `) &&
			/(^|["\s])right-0( |$)/.test(` ${list.getAttribute("class") ?? ""} `),
		"and it spans its containing block (`left-0 right-0`), so the wrapper's measure IS the list's width",
	);
});

/*
 * THE CENTRING BAND'S SENTENCE IS MIRRORED BELOW THE GROUP (UX round 4, U16).
 *
 * On an empty chat the band claims the column and centres its group, so a line
 * added anywhere in it moves the whole group by HALF the line — the composer the
 * operator is typing in included. Measured on the app at 1380 with real
 * keystrokes: `textarea.y` 402.25 idle -> 416.00 armed, toggling twice while one
 * command is typed (`/cred` 416.00, `/crede` 402.25, `/credential` 416.00),
 * where live `origin/main` holds 402.25 through all eleven keystrokes.
 *
 * The device is a hidden MIRROR of the sentence at the end of the group: the
 * group grows by the line on both sides of the box, so the centring shift
 * cancels for everything between the two lines. Both halves must measure the
 * same height, which is why they share one class list — asserted below, because
 * the mechanism is arithmetic and two class lists would be two definitions of
 * that height. Deleting the mirror (the mutation this exists for) fails the
 * first assertion; rendering it on a populated pane fails the last.
 *
 * jsdom has no layout engine, so this pins the STRUCTURE; the live y-values are
 * the design record §7.5's and the PR's.
 */
const mirrorOf = () =>
	[...window.document.querySelectorAll("output")].find(
		(el) => el.getAttribute("aria-hidden") === "true",
	) ?? null;

const classTokens = (el) =>
	new Set((el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean));

test("on the band that centres the composer, the sentence is mirrored below the group", async () => {
	const centred = await mount({
		conversationId: "conv-centred",
		messages: [],
	});
	const idleMirror = mirrorOf();
	assert.ok(
		idleMirror,
		"the centring band renders its mirror node in every state",
	);
	assert.ok(
		idleMirror.className.includes("hidden"),
		"and `hidden` while there is no sentence, so the idle composer reserves nothing and stays `origin/main`'s geometry to the pixel",
	);
	assert.equal(idleMirror.textContent, "");

	await openCapture(centred);
	await type(centred, "sk-live-CANARY-4417");
	const notice = window.document.getElementById("composer-credential-notice");
	assert.ok(
		(notice.textContent ?? "").length > 0,
		"the sentence is up, which is the state the mirror is for",
	);
	const mirror = mirrorOf();
	assert.ok(
		mirror,
		"the centring band mirrors the sentence: without it the group grows by one line and the composer moves by half of it (UX round 4, U16)",
	);
	assert.equal(
		mirror.textContent,
		notice.textContent,
		"the mirror carries the same sentence, which is what makes its height the sentence's height",
	);
	assert.equal(
		mirror.id,
		"",
		"the mirror is not the element `aria-describedby` names",
	);
	assert.ok(
		mirror.classList.contains("invisible"),
		"it is invisible: it is the same sentence twice, and the sentence is already painted above the box",
	);
	const noticeTokens = classTokens(notice);
	const mirrorTokens = classTokens(mirror);
	mirrorTokens.delete("invisible");
	assert.deepEqual(
		[...mirrorTokens].sort(),
		[...noticeTokens].sort(),
		"and it carries the sentence's OWN class list, so the two lines cannot measure different heights (one `credentialNoticeLine`, two consumers)",
	);
	/*
	 * Below the BOX, and that is the arithmetic: the line above the box is what
	 * grows the group, the line below it is what cancels the centring shift for
	 * everything between them.
	 */
	assert.ok(
		centred.box().compareDocumentPosition(mirror) &
			window.Node.DOCUMENT_POSITION_FOLLOWING,
		"the mirror is below the composer box in the group",
	);

	/*
	 * AND NOT ON A POPULATED PANE, where the band is bottom-anchored: there a
	 * mirrored line below the box would grow the band downward and push the typed
	 * line up by the line's full height, which is the defect U14/D1 removed.
	 */
	const populated = await mount({ conversationId: "conv-centred-populated" });
	await openCapture(populated);
	await type(populated, "sk-live-CANARY-4417");
	assert.ok(
		window.document.getElementById("composer-credential-notice").textContent
			.length > 0,
		"the same state on a populated pane does raise the sentence",
	);
	assert.equal(
		mirrorOf(),
		null,
		"and renders no mirror: the sentence stays in the flow, where the transcript above yields instead",
	);
});

/*
 * THE MINT LANE CANNOT CARRY A STALE COUNT (code review round 4, NIT 2).
 *
 * The UX remediation claims a retired disclosure "cannot ride a minted marker
 * either", and until this case no test minted: the only new coverage was the
 * Esc → backspaces → cleared → prose → reload lane. The mechanism is by
 * construction (`applyCapture` writes `disclosureOver(buffer)`, which cannot
 * match a minted buffer), so this is coverage rather than a defect — but a claim
 * about a lane nothing exercises is exactly what the round-4 review flagged.
 *
 * The shape is QA's D-3, which is the live version of the same walk: a real Esc
 * leaves nineteen characters disclosed, the box is cleared with real keys and a
 * second capture is typed and minted, and the count the mint persists is 0 —
 * including across a reload, which is where a stale count used to come back.
 */
test("a retired count cannot ride a minted marker, across the mint and a reload", async () => {
	const frame = await mount({ conversationId: "conv-mint-lane" });
	await openCapture(frame);
	await type(frame, "sk-live-CANARY-4417");
	await esc(frame);
	assert.equal(
		frame.disclosure(),
		19,
		"the Esc persists the count WITH the characters it describes",
	);

	// Clear the box with real keys, then mint a fresh capture into it.
	const field = frame.textarea();
	await act(async () => {
		field.setSelectionRange(0, field.value.length);
	});
	await key(frame, { key: "Delete" });
	assert.equal(frame.notice(), "", "the empty box discloses nothing");
	await openCapture(frame);
	await type(frame, "sk-live-CANARY-8888");
	await enter(frame);
	assert.match(
		frame.value(),
		/^\[Credential #1, 19 chars\] $/,
		"the span minted a marker rather than sending",
	);
	assert.equal(
		painted().filter((s) => s.pill).length,
		1,
		"and the marker is painted: a live pill, not the not-stored chip",
	);
	assert.equal(
		frame.notice(),
		"",
		"the sentence is gone over a marker: the characters it described are not in the box any more",
	);
	assert.equal(
		frame.disclosure(),
		0,
		"and the count the mint persisted is 0 — the stale nineteen can never ride this marker",
	);

	const reloaded = await mount({
		conversationId: "conv-mint-lane",
		keepWorld: true,
		remount: true,
		onSendMessage: async () => true,
	});
	assert.equal(reloaded.value(), "[Credential #1, 19 chars] ");
	assert.equal(
		reloaded.notice(),
		"",
		"a reload restores the marker without raising a claim about plaintext characters",
	);
	assert.equal(reloaded.disclosure(), 0, "and re-persists no count");
});

test("a real keystroke that moves a cancelled token hands it to the dispatcher (Q16)", async () => {
	/*
	 * QA round 8's Q16, driven the way the operator drives it: `/credential <secret>`
	 * typed, Escape, then a REAL keystroke edit that moves the token (Home, then
	 * characters through the composer's own key pipeline, with the value written the
	 * way a browser writes it). The dispatch is the assertion — and it is the point,
	 * because `/credential`'s arguments are REFUSED, so a secret can never land in
	 * command text; `frame.sent.length === 0` is the property that says the secret
	 * did not travel as prose.
	 *
	 * WHAT THIS CASE DOES NOT PIN, stated because review round 11 measured it: the
	 * two mutations of the record's lifetime that Q16 is about — restoring the
	 * arm-time clear, and testing the record's run rather than its word — leave this
	 * case green, because the harness's edit path never produces the buffer state the
	 * app reaches (a masked citation, or the token with its trailing space gone). The
	 * harness proves the gesture survives an edit through the composer's own
	 * handlers; the app-level half is QA's re-run on this head, and the record's
	 * lifetime is keyed on the token's WORD for that reason (`message-input.tsx`).
	 */
	const ran = [];
	const frame = await mount({
		conversationId: "conv-q16-moved",
		onSlashCommand: async (command) => {
			ran.push(command);
			return "consumed";
		},
	});
	await type(frame, "/credential ");
	await type(frame, "SECRET");
	await esc(frame);
	await key(frame, { key: "Home" });
	for (const ch of "please ") {
		await key(frame, { key: ch });
	}
	const field = frame.textarea();
	await act(async () => {
		const next = `please ${field.value}`;
		writeValue(field, next, next.length);
	});
	await settle();
	assert.equal(frame.value(), "please /credential SECRET");
	await enter(frame);
	await settle();
	assert.equal(ran.length, 1, "the moved token reaches the dispatcher");
	assert.equal(
		frame.sent.length,
		0,
		"so the secret never travels as message text",
	);

	/*
	 * AND WITH THE CARET INSIDE THE TOKEN, which is the state that fires the
	 * capture's ARM. The record has to survive that re-sync too, because the arm is
	 * the token's own consequence rather than a new gesture — this is the half the
	 * app was failing on, and the harness reaches it only with the caret placed by
	 * hand, which is why the suite stayed green while the app sent. Re-adding the
	 * arm-time clear (M-Q16) is what this half fails on.
	 */
	const armed = await mount({
		conversationId: "conv-q16-armed",
		onSlashCommand: async (command) => {
			ran.push(command);
			return "consumed";
		},
	});
	await type(armed, "/credential ");
	await type(armed, "SECRET");
	await esc(armed);
	const armField = armed.textarea();
	await act(async () => {
		// `please /credential |SECRET` — the caret right after the token, which is
		// the arm's own precondition.
		writeValue(
			armField,
			"please /credential SECRET",
			"please /credential ".length,
		);
	});
	await settle();
	await enter(armed);
	await settle();
	assert.equal(ran.length, 2, "the armed caret still reaches the dispatcher");
	assert.equal(armed.sent.length, 0, "and the secret is not sent as text");
});

test("a token moved to the END of the buffer still reaches the dispatcher (round 12, MAJOR)", async () => {
	/*
	 * The record is built as the token PLUS its separator
	 * (`credential-capture.ts`: `text: buffer.slice(tokenStart, span.start)`, so
	 * `"/credential "`), so a draft that ends in the bare token does not contain the
	 * record's run — and a run-shaped test at the plan seam therefore fell through to
	 * prose and SENT the secret as message text. This is the moved-token case the
	 * harness can drive: no arm, no mask, just a buffer and Enter. Removing the
	 * seam's `.trim()` is what fails it.
	 */
	const ran = [];
	const frame = await mount({
		conversationId: "conv-q16-tail",
		onSlashCommand: async (command) => {
			ran.push(command);
			return "consumed";
		},
	});
	await type(frame, "/credential ");
	await type(frame, "SECRET");
	await esc(frame);
	const field = frame.textarea();
	await act(async () => {
		writeValue(
			field,
			"SECRET please /credential",
			"SECRET please /credential".length,
		);
	});
	await settle();
	assert.equal(frame.value(), "SECRET please /credential");
	await enter(frame);
	await settle();
	assert.equal(ran.length, 1, "the token moved to the end still dispatches");
	assert.equal(
		ran[0]?.name,
		"credential",
		"and it is the credential command, whose arguments are refused",
	);
	assert.equal(
		frame.sent.length,
		0,
		"so the secret is never sent as message text",
	);
});

test("the caret immediately before a moved token does not make it prose (QA round 10)", async () => {
	/*
	 * QA round 10's isolated variable: the CARET. Typing a prefix leaves the caret
	 * immediately BEFORE the token, and `activeSlash`'s claim branch returns the
	 * running candidate — `null` — when the caret sits exactly at the claiming
	 * token's `/` (`column > index` is false at equality), so `slashTokenSpan`
	 * answers null and the planner returns `send` three lines before the gesture,
	 * the span and the pick rule are consulted. Same draft, same live record, moved
	 * caret: SENT, with the secret as message text.
	 *
	 * The caret placement IS the fact under test, so it is written directly: the
	 * app leaves it there after a typed prefix, which is the shape every other case
	 * in this file misses (`writeValue(..., next.length)` always ends at the end).
	 */
	const ran = [];
	const frame = await mount({
		conversationId: "conv-caret-before",
		onSlashCommand: async (command) => {
			ran.push(command);
			return "consumed";
		},
	});
	await type(frame, "/credential ");
	await type(frame, "SECRET");
	await esc(frame);
	const field = frame.textarea();
	await act(async () => {
		// `please |/credential SECRET` — the caret at the token's own slash.
		writeValue(field, "please /credential SECRET", "please ".length);
	});
	await settle();
	assert.equal(frame.value(), "please /credential SECRET");
	await enter(frame);
	await settle();
	assert.equal(ran.length, 1, "a gesture-owned token dispatches, caret or not");
	assert.equal(
		frame.sent.length,
		0,
		"so the secret is never sent as message text",
	);
});
