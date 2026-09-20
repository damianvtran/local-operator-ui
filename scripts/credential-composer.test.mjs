import assert from "node:assert/strict";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
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

/*
 * THE TRANSPORT'S ANSWER FOR THIS CASE, when the healthy fixture above is not
 * what the case is about.
 *
 * The store's outcome is the subject of the M3b cases below, and every one of
 * them needs a transport that answers — or refuses to answer — DIFFERENTLY for
 * the store than for everything else the composer asks in the same mount. An
 * override that returns `undefined` leaves the default fixture in charge, so a
 * case only has to name the requests it is changing. It is cleared by the
 * `after` hook so one case's transport cannot leak into the next.
 */
let transportOverride = null;

/** A response the way the mocked bridge builds one, for an override to return. */
const transportSays = (status, result) => ({
	ok: status >= 200 && status < 300,
	status,
	json: async () => ({ status, body: { result } }),
});

/** The op result the fixture answers with, wrapped as the transport wraps it. */
const credentialResult = (result) => transportSays(200, result);

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

/*
 * The catalogue this mount answers with, so one case can drive a pane whose
 * command list does not resolve the credential word (code review round 2, MINOR 4:
 * the receipt must not promise a dialog that never opens). Reset by every mount.
 */
let commandRows = COMMANDS;

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
	if (request.op === "commands.list") return { commands: commandRows };
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

/**
 * The REAL fetch, kept before the fixture below replaces the global one.
 *
 * One case drives a real loopback HTTP server instead of a stub — the same
 * instrument `desktop-contract.test.mjs` uses on the main-process half — and it
 * needs a way to reach the socket that is not the composer's own stubbed one.
 */
const nodeFetch = globalThis.fetch.bind(globalThis);

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
	return transportOverride?.(request) ?? transportSays(200, answer(request));
};

/* ------------------------------------------------------------------ */
/* The bundle                                                           */
/* ------------------------------------------------------------------ */

const bundle = await build({
	stdin: {
		contents: `
			export { MessageInput } from "./src/renderer/src/features/chat/components/message-input.tsx";
			export { CredentialChipLayer } from "./src/renderer/src/features/chat/components/credential-chip-layer.tsx";
			export { CHAT_MEASURE } from "./src/renderer/src/features/chat/chat-measure";
			export { QueryClient, QueryClientProvider } from "@tanstack/react-query";
			export { useConversationInputStore } from "./src/renderer/src/shared/store/conversation-input-store";
			export {
				CREDENTIAL_ARMED_NOTICE,
				CREDENTIAL_EMPTY_SPAN_DRAFT_NOTICE,
				CREDENTIAL_EMPTY_SPAN_NOTICE,
				CREDENTIAL_KEY_ALPHABET,
				CREDENTIAL_TYPING_NOTICE,
				MASK_CELL,
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
	CredentialChipLayer,
	MessageInput,
	QueryClient,
	QueryClientProvider,
	useConversationInputStore,
	CREDENTIAL_ARMED_NOTICE,
	CREDENTIAL_EMPTY_SPAN_DRAFT_NOTICE,
	CREDENTIAL_EMPTY_SPAN_NOTICE,
	CREDENTIAL_KEY_ALPHABET,
	CREDENTIAL_TYPING_NOTICE,
	MASK_CELL,
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
	transportOverride = null;
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
	 * THE TWO REFUSAL ARMS, as props: `unavailable` is a conversation this
	 * machine does not have and `isLoading && currentJobId` is the busy arm on a
	 * backend that does not negotiate `canonical_stream`. Both are the composer's
	 * own predicate (`isInputDisabled`), and this is the only place that mounts
	 * the shipped component without a page deciding them.
	 */
	unavailable = false,
	isLoading = false,
	currentJobId,
	/*
	 * The composer's note seam (`onSlashNote`), recorded the way `onSendMessage` is.
	 * Every OTHER outcome that rewrites the box narrates itself through it — a staged
	 * line, a list that owns the key — and the locked run's own sentence goes the same
	 * way (design round 1, D1), so a rig that did not forward it could not tell "the
	 * composer said nothing" from "the composer said it to nobody".
	 */
	onSlashNote,
	/*
	 * Whether the pane can address a session, which is what the note seams read
	 * (`chat-page.tsx`: `paneHasSession = Boolean(sessionId)`). A prop of its own
	 * rather than a reading of `sessionStatus`, because that is how the real host
	 * passes it.
	 */
	paneHasSession = false,
	/*
	 * The command catalogue this mount sees, defaulting to the runtime's own. A case
	 * that passes `[]` is a host whose list query has not arrived: the composer's
	 * vocabularies are empty and the dispatcher cannot resolve the word even though it
	 * can run commands.
	 */
	commands = COMMANDS,
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
	commandRows = commands;
	/*
	 * AND THE CATALOGUE IS RE-ASKED, because the cache outlives the mount: `commands.list`
	 * has a five-minute `staleTime` and this rig shares ONE client across mounts, so a
	 * mount that answers an EMPTY catalogue would otherwise read the previous mount's
	 * rows and the assertion would be about the wrong pane (measured: the first cut of
	 * the MINOR 4 case was).
	 */
	await client.invalidateQueries({ queryKey: ["desktop", "commands"] });
	const frame = { conversationId };
	const notes = [];
	Object.assign(frame, {
		sent,
		notes,
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
					isLoading,
					messages,
					conversationId,
					sessionStatus,
					unavailable,
					currentJobId,
					onSendMessage: async (...args) => {
						sent.push(args);
						return onSendMessage ? onSendMessage(...args) : true;
					},
					onSlashCommand,
					onSlashNote: (text) => {
						notes.push(text);
						onSlashNote?.(text);
					},
					paneHasSession,
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
	/*
	 * THE BROWSER'S OWN REFUSAL, modelled: a read-only field applies no edit and
	 * fires no `input` event, so a rig that wrote anyway would prove the opposite
	 * of what the composer does. What that means for the refusal test below is
	 * stated where it is used - the assertion it carries is the ATTRIBUTE, and
	 * what a real keystroke does to a read-only box is QA's and the driver's.
	 */
	if (field.readOnly) return;
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

/**
 * Move the caret without changing the text.
 *
 * jsdom implements no Home/End/arrow navigation, so a real key would leave the
 * selection where it was; this is the DOM write a click makes, and it keeps the
 * text — which matters because the records this suite drives are predicates over
 * the text and its offsets (`holdsCancelledToken`).
 */
const placeCaret = async (frame, at) => {
	const field = frame.textarea();
	await act(async () => {
		writeValue(field, field.value, at);
	});
	await settle();
};

/**
 * The undo key a locked run's sentence promises (UX round 1, U3).
 *
 * `key` above builds a bare keystroke, and the modifier IS the variable here: the
 * handler answers `metaKey` or `ctrlKey` (`handleLockedRunUndo`), so a rig that
 * pressed a bare `z` would prove nothing. Both are set because the assertion is
 * about what the composer does with the key, not about which platform sends which.
 */
const undoKey = async (frame) => {
	const field = frame.textarea();
	let claimed = false;
	await act(async () => {
		const event = new window.KeyboardEvent("keydown", {
			key: "z",
			metaKey: true,
			bubbles: true,
			cancelable: true,
		});
		field.dispatchEvent(event);
		claimed = event.defaultPrevented;
	});
	await settle();
	return claimed;
};
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
/* M3b — a store the session never answered is RESOLVED, not guessed    */
/* ------------------------------------------------------------------ */

/*
 * THE OPERATOR'S DEFECT, 2026-09-19, and the invariant these cases pin: the
 * model is never told "NOT stored" when the session's store holds the key.
 *
 * What they reported: an API key pasted into the composer through the inline
 * capture, a chip drawn correctly, a send — and a message that reached the model
 * reading `[credential NOT stored — the session could not be reached; try
 * again]`, while `list_variables` in that same session listed the key and every
 * bash child carried it in its environment. The value was stored; the app said
 * it was not.
 *
 * The mechanism was measured rather than inferred. The store has to ENGAGE the
 * session's runtime before it can answer (`desktop_lifecycle.py` →
 * `bridge.remote.bind_runtime()`), and on a real isolated backend that cost
 * 4.2 s cold and 5.6-8.2 s with six cold sessions in flight — every one of them
 * answering 200 OK afterwards. The seam abandoned the store at 5 s (the TUI's
 * in-process bound, copied onto a transport that is not in-process) and wrote a
 * not-stored citation on the strength of that silence alone.
 *
 * So these cases drive the seam's own wire responses, one arm of the
 * classification each:
 *
 *  - an answer that was LOST while the write landed;
 *  - a 5xx that a re-issue repaired;
 *  - a session that never answered at all, where the citation must say so;
 *  - a 4xx whose session HOLDS the key, which is the reviewer's own counterexample
 *    and the reason a 4xx is no longer a verdict (round 1, MAJOR-1);
 *  - a 4xx whose session does NOT hold it, where the not-stored citation stands;
 *  - a 4xx whose witness read cannot answer either, where nothing may be asserted.
 *
 * The first four are the same assertion from four directions — no citation may
 * claim the store refused a write the store actually holds — and the last two are
 * the guard on the other side: resolving an inconclusive outcome must not soften a
 * refusal that was actually made, and must not invent one either.
 */

/**
 * Send one first message that cites a freshly pasted secret, and return what the
 * seam handed the send.
 *
 * The M3 gesture exactly, because that is where this defect happened: a NEW chat
 * has no session until the send creates one, so the store runs inside
 * `beforeAdmission` with the id the create resolved — the window in which a cold
 * runtime is engaged. The arming read the composer makes when the capture opens
 * is a no-op here (`credentialSessionId` is undefined on a draft pane), which is
 * what lets the call counts below be read as the SEND's own.
 */
async function sendFirstMessage(value, override = null) {
	calls.length = 0;
	transportOverride = override;
	let rendered;
	let handed;
	const pageSent = new Promise((resolve) => {
		handed = resolve;
	});
	let settled = null;
	const frame = await mount({
		conversationId: undefined,
		onSendMessage: async (_content, _attachments, _echo, _typed, seam) => {
			handed(seam ?? null);
			if (seam) settled = seam("draft-session-id");
			return true;
		},
	});
	await openCapture(frame);
	await paste(frame, value);
	await clickSend(frame);
	/*
	 * THE GESTURE IS NOT OVER WHEN THE CLICK RETURNS, which is the composer's own
	 * shape rather than the rig's: the store runs inside the seam the page's send
	 * calls, so the click can settle while the store is still waiting on a cold
	 * runtime. A case that asserts the CITATION has to wait for the promise that
	 * seam returned, not for the click — and the editor cases above get away with
	 * not doing so only because their store answers immediately.
	 */
	const seam = await pageSent;
	if (settled) rendered = await settled;
	assert.equal(
		seam === null || typeof seam === "function",
		true,
		"the draft send offered the store seam",
	);
	transportOverride = null;
	return String(rendered);
}

/** How many times one credential op crossed the transport in this test. */
const opCount = (action) =>
	calls.filter(
		(call) =>
			call.request.op === "sessions.credential" &&
			call.request.action === action,
	).length;

/** The stored citation, which is what a landed key must produce. */
const STORED_CITATION_SHAPE =
	/\[credential LOP_SECRET_[A-Z2-9]{8} \(\d+ chars\)/;

test("a store whose answer was lost, but whose write landed, cites the name", async () => {
	/*
	 * THE OPERATOR'S CASE. The transport loses the response and the write lands
	 * anyway — which is not a hypothesis here: the operator's own session is the
	 * one that stored the key and told the model it had not. The seam may not
	 * publish that silence as an outcome, and the session's own list is what
	 * settles it.
	 */
	let landed = "";
	const rendered = await sendFirstMessage("FIRST-MESSAGE-SECRET", (request) => {
		if (request.op !== "sessions.credential") return undefined;
		if (request.action === "store") {
			// The write lands and the answer never comes back.
			landed = request.key;
			return Promise.reject(new Error("socket closed"));
		}
		if (request.action === "list")
			return credentialResult({
				data: {
					ok: true,
					credentials: landed ? [{ key: landed, source: "command" }] : [],
				},
			});
		return undefined;
	});

	assert.ok(
		!rendered.includes("NOT stored"),
		`a stored key was cited as missing: ${rendered}`,
	);
	assert.match(rendered, STORED_CITATION_SHAPE);
	assert.equal(opCount("store"), 2, "the silent attempt was re-issued");
	assert.equal(opCount("list"), 1, "the session's own list answered it");
});

test("a store that failed once and answered on the re-issue is cited as stored", async () => {
	/*
	 * The re-issue is a REPAIR as well as a question: the same key and value are
	 * idempotent, so an attempt that answers `ok` has put the value in the store
	 * whether or not the first one did — and the model gets the confident citation
	 * it needs to use the name. A 5xx is the arm that reaches this without a lost
	 * socket (the relay saying it could not), and it needs no list read at all.
	 */
	let attempts = 0;
	const rendered = await sendFirstMessage(
		"SECOND-ATTEMPT-SECRET",
		(request) => {
			if (request.op !== "sessions.credential" || request.action !== "store")
				return undefined;
			attempts += 1;
			if (attempts === 1)
				return transportSays(503, {
					detail: {
						code: "runtime_unreachable",
						message: "The runtime is not up.",
					},
				});
			return credentialResult({ data: { ok: true, key: request.key } });
		},
	);

	assert.equal(opCount("store"), 2);
	assert.equal(opCount("list"), 0, "an answered re-issue needs no list read");
	assert.ok(!rendered.includes("NOT stored"), rendered);
	assert.match(rendered, STORED_CITATION_SHAPE);
});

test("a store nobody answered is cited as unconfirmed, never as NOT stored", async () => {
	/*
	 * THE HONEST FLOOR, and the one case where the sentence must not name an
	 * outcome at all: both store attempts and the list read are silent, so nothing
	 * on the wire ever said whether the write landed. The citation has to say what
	 * is true (nobody knows), name the key it is talking about, and hand the agent
	 * the check that settles it — `list_variables`, which is how the operator's own
	 * session recovered a key a citation had denied.
	 *
	 * The list read is left hanging rather than refused, which is also the one
	 * place in this file that exercises the seam's RESOLUTION bound: a retry that
	 * never answers has to give up and reach this arm rather than park the send.
	 */
	const rendered = await sendFirstMessage(
		"NOBODY-ANSWERED-SECRET",
		(request) => {
			if (request.op !== "sessions.credential") return undefined;
			if (request.action === "store")
				return Promise.reject(new Error("socket closed"));
			if (request.action === "list") return new Promise(() => {});
			return undefined;
		},
	);

	assert.ok(
		!rendered.includes("NOT stored"),
		`silence was published as an outcome: ${rendered}`,
	);
	assert.match(
		rendered,
		/\[credential unconfirmed — it may be held as \$LOP_SECRET_[A-Z2-9]{8}, so check list_variables before assuming it is missing\]/,
	);
	assert.equal(opCount("store"), 2);
	assert.equal(opCount("list"), 1, "the list read was attempted and gave up");
});

test("a 409 whose session does NOT hold the key keeps the not-stored citation", async () => {
	/*
	 * THE OTHER SIDE OF THE LINE, with the witness read now in the path (code review
	 * round 1, MAJOR-1). A 409 proves that something ANSWERED; it does not prove the
	 * value is absent, because the route raises the same status for the store's own
	 * refusal AND for the owner's `disconnected` answer to a store it already applied
	 * (`desktop_lifecycle.py` → `attached.py`'s `credential_op`, which returns that
	 * shape both when the viewer is away and when the client RAISED).
	 *
	 * Here the session's own list answers and does not name the key: two pieces of
	 * evidence agree, the refusal stands, and it is not weakened into "unconfirmed" —
	 * that would trade one false statement for another.
	 */
	const rendered = await sendFirstMessage("REFUSED-SECRET", (request) => {
		if (request.op !== "sessions.credential") return undefined;
		if (request.action === "store")
			return transportSays(409, {
				detail: {
					code: "store_failed",
					message: "The credential operation did not complete.",
				},
			});
		if (request.action === "list")
			return credentialResult({ data: { ok: true, credentials: [] } });
		return undefined;
	});

	assert.equal(opCount("store"), 1, "an answered refusal needs no re-issue");
	assert.equal(opCount("list"), 1, "and it does need the witness read");
	assert.match(
		rendered,
		/\[credential NOT stored — its value did not survive; ask the operator to paste it again\]/,
	);
});

test("a 409 whose session HOLDS the key is cited as stored, not as a lost value", async () => {
	/*
	 * THE REVIEWER'S COUNTEREXAMPLE (round 1, MAJOR-1), and the reason the 4xx arm is
	 * no longer a verdict. The probe they ran against the shipped component answered
	 * the store with the route's real 409 shape while offering a list that held the
	 * key — and the head before this round cited
	 * `[credential NOT stored — its value did not survive…]` with ONE store op and
	 * ZERO list ops. That is the operator's own defect one status class over: the
	 * write landed, and the model was told it had not.
	 */
	let landed = "";
	const rendered = await sendFirstMessage("PROBE-SECRET", (request) => {
		if (request.op !== "sessions.credential") return undefined;
		if (request.action === "store") {
			// The write lands and the owner's own answer is lost, which is what the
			// route turns into this 409.
			landed = request.key;
			return transportSays(409, {
				detail: {
					code: "store_failed",
					message: "The credential operation did not complete.",
				},
			});
		}
		if (request.action === "list")
			return credentialResult({
				data: {
					ok: true,
					credentials: landed ? [{ key: landed, source: "command" }] : [],
				},
			});
		return undefined;
	});

	assert.equal(
		opCount("store"),
		1,
		"the refusal is an answer, so nothing is re-issued",
	);
	assert.equal(
		opCount("list"),
		1,
		"and the witness read is what tells this 409 apart",
	);
	assert.ok(
		!rendered.includes("NOT stored"),
		`a key the store holds was cited as missing: ${rendered}`,
	);
	assert.match(rendered, STORED_CITATION_SHAPE);
});

test("a 409 whose witness read cannot answer is cited as unconfirmed", async () => {
	/*
	 * THE THIRD ARM, and the one that keeps the other two honest: the store answered a
	 * 4xx (which may be a refusal or a lost reply) and the read that would settle it
	 * cannot answer either. Neither outcome is proven, so neither may be cited — the
	 * seam says what it knows.
	 */
	const rendered = await sendFirstMessage("BLIND-SECRET", (request) => {
		if (request.op !== "sessions.credential") return undefined;
		if (request.action === "store")
			return transportSays(409, {
				detail: { code: "store_failed", message: "Did not complete." },
			});
		if (request.action === "list")
			return Promise.reject(new Error("socket closed"));
		return undefined;
	});

	assert.equal(opCount("store"), 1);
	assert.equal(opCount("list"), 1);
	assert.ok(
		!rendered.includes("NOT stored"),
		`an unproven outcome was published: ${rendered}`,
	);
	assert.match(
		rendered,
		/\[credential unconfirmed — it may be held as \$LOP_SECRET_[A-Z2-9]{8}, so check list_variables before assuming it is missing\]/,
	);
});

test("two cited credentials pay the resolution ONCE, not twice", async () => {
	/*
	 * THE WORST CASE IS SHARED (code review round 1, MINOR-1). One credential that
	 * nothing ever answers costs the transport's 25 s plus two 5 s resolution steps,
	 * and the loop this replaces awaited that PER PAYLOAD — so the operator's own
	 * two-key message parked the composer behind ~70 s. Both credentials here are
	 * silent (their stores reject outright and their reads hang for the 5 s bound), so
	 * the measured wall time is the discriminator: ~one resolution concurrently,
	 * ~two if the sequence ever comes back.
	 */
	const started = Date.now();
	calls.length = 0;
	let rendered;
	let handed;
	const pageSent = new Promise((resolve) => {
		handed = resolve;
	});
	let settled = null;
	const frame = await mount({
		conversationId: undefined,
		onSendMessage: async (_content, _attachments, _echo, _typed, seam) => {
			handed(seam ?? null);
			if (seam) settled = seam("draft-session-id");
			return true;
		},
	});
	transportOverride = (request) => {
		if (request.op !== "sessions.credential") return undefined;
		if (request.action === "store")
			return Promise.reject(new Error("socket closed"));
		if (request.action === "list") return new Promise(() => {});
		return undefined;
	};
	await openCapture(frame);
	await paste(frame, "FIRST-SILENT-SECRET");
	await type(frame, "/credential ");
	await paste(frame, "SECOND-SILENT-SECRET");
	await clickSend(frame);
	await pageSent;
	if (settled) rendered = await settled;
	const elapsed = Date.now() - started;
	transportOverride = null;

	assert.equal(
		opCount("store"),
		4,
		"both credentials were attempted twice — the re-issue rides every silent store",
	);
	assert.equal(
		opCount("list"),
		2,
		"and both credentials got their witness read",
	);
	assert.equal(
		(String(rendered).match(/\[credential unconfirmed/g) ?? []).length,
		2,
		String(rendered),
	);
	/*
	 * The discriminator, with its arithmetic: each credential spends the 5 s
	 * resolution bound on its hanging read, so SERIAL resolution costs two of those
	 * (~10 s), plus the mount (~2 s) — while concurrent resolution costs one (~5 s)
	 * plus the mount. 11 s separates them with room for a loaded machine, and the
	 * mount is inside the measurement deliberately, so a regression that serialises
	 * the loop cannot hide in the overhead.
	 */
	assert.ok(
		elapsed < 11_000,
		`two silent credentials took ${elapsed} ms: the resolution bound is being paid per credential`,
	);
});

/* ------------------------------------------------------------------ */
/* M3c — the same store, over REAL loopback HTTP, at the latency the    */
/* operator's machine measured                                          */
/* ------------------------------------------------------------------ */

test("a store slower than the TUI's five seconds is cited for what it did", async (t) => {
	/*
	 * WHY REAL HTTP AND WHY SIX SECONDS. The mechanism this change corrects was
	 * measured, not inferred: a store has to engage the session's runtime before it
	 * can answer, and against a real isolated backend that cost 4.2 s cold, 5.6-8.2 s
	 * with six cold sessions in flight, and ~13 s on the operator's loaded host —
	 * every one of those writes landing. The stubs in the cases above pin the
	 * CLASSIFICATION for each wire shape; this one pins the BOUND, on a socket.
	 *
	 * Six seconds is chosen to sit in that measured band and just past the TUI's
	 * 5 s, so the pre-fix seam abandons a store that then answers `ok`: the citation
	 * says NOT stored about a key the server holds. With the bound the transport
	 * itself allows for this op, the same six seconds is simply the answer arriving.
	 *
	 * The route's own shape is reproduced rather than simplified — the `{status,
	 * body:{result}}` envelope `desktopRequest` reads, answered by a real server on a
	 * real port — because a stub that answered the inner result directly would leave
	 * the composer in an error state and prove nothing.
	 */
	const server = createServer(async (req, res) => {
		const chunks = [];
		for await (const chunk of req) chunks.push(chunk);
		let request = {};
		try {
			request = JSON.parse(Buffer.concat(chunks).toString() || "{}");
		} catch {
			request = {};
		}
		const reply = (result) => {
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ status: 200, body: { result } }));
		};
		if (request.action === "store") {
			// The cold engage the operator's own send waited behind.
			await new Promise((resolve) => realSetTimeout(resolve, 6000));
			return reply({ data: { ok: true, key: request.key } });
		}
		if (request.action === "list")
			return reply({ data: { ok: true, credentials: [] } });
		return reply(answer(request));
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(() => server.close());
	const { port } = server.address();

	const rendered = await sendFirstMessage("SLOW-STORE-SECRET", (request) =>
		nodeFetch(`http://127.0.0.1:${port}/__desktop`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(request),
		}),
	);

	assert.ok(
		!rendered.includes("NOT stored"),
		`a store that took 6 s and landed was published as missing: ${rendered}`,
	);
	assert.match(rendered, STORED_CITATION_SHAPE);
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

test("a cancel that EXPOSED characters is the command's, never the model's (UX round 1, U1)", async () => {
	/*
	 * THE PIN THIS ROUND MOVED, and it is worth being explicit about which one and
	 * why. It used to read "after an empty-span Escape the leading token is prose"
	 * and assert that the restored text was SENT — "what the notice promised Enter
	 * would expose is what was sent". That is the round-2 U9 reading of the §5
	 * exception, and on the shape it was written for it still holds (see the next
	 * test: an EMPTY span, then a tail typed as prose, is still sent as the
	 * operator's own sentence).
	 *
	 * What it also covered, and what UX round 1 measured as a BLOCKER on the live
	 * app, is this shape: the characters really were masked, Escape unmasked them
	 * (`21 characters are now PLAIN TEXT in the composer`), and the next Enter put
	 * `/credential <the secret>` into the conversation — on this head and on `main`
	 * alike. The app's own notice never promised a SEND for words a capture was
	 * holding: `unredactedNotice`'s comment says Enter means different things by
	 * shape, and for a capture that was the whole line it is the token that
	 * dispatches the picker. So the exception now yields to the locked rule for
	 * exactly the drafts the app itself just unmasked, and this case pins that:
	 * the run is the dispatcher's, and the secret is in no message.
	 *
	 * A DISPATCHER IS MOUNTED, which this test needed before this round too: with no
	 * `onSlashCommand` the planner answers "send" for everything, so a rig without
	 * one would pass on the broken code (round-1's lesson about vacuous pins).
	 */
	const ran = [];
	const frame = await mount({
		conversationId: "conv-6",
		/*
		 * A LIVE PANE, which is the shape UX round 1 measured the leak on and the one
		 * whose sentence can promise the dialog: `paneHasSession` false gets the
		 * dispatcher's own refusal clause instead (asserted at the end).
		 */
		sessionStatus: { frontend: null },
		paneHasSession: true,
		onSlashCommand: async (invocation) => {
			ran.push(invocation);
			return "consumed";
		},
	});
	await type(frame, "/credential ");
	await type(frame, "sk-live-CANARY-4417");
	await esc(frame);
	assert.equal(frame.value(), "/credential sk-live-CANARY-4417");
	assert.match(
		frame.notice(),
		/PLAIN TEXT/,
		"the app says these characters are exposed",
	);

	await clickSend(frame);
	assert.equal(
		ran.length,
		1,
		"the unlocked characters hand the run to the dispatcher",
	);
	assert.equal(ran[0].name, "credential");
	assert.equal(
		ran[0].args,
		"sk-live-CANARY-4417",
		"and they travel as the command's argument, which the dispatcher strips",
	);
	assert.equal(
		frame.sent.length,
		0,
		"so the characters the notice called exposed are in no message",
	);
	assert.ok(
		!JSON.stringify(frame.sent).includes("CANARY"),
		"and no sent payload carries them",
	);
	assert.equal(frame.value(), "", "the whole-draft run leaves nothing behind");
	/*
	 * AND IT SAYS SO (design round 1, D1). The note names what happened, never the
	 * value, and promises the key that puts the words back (UX round 1, U3).
	 */
	assert.equal(frame.notes.length, 1, "one sentence, on the same press");
	assert.match(frame.notes[0], /taken as its argument/);
	assert.match(frame.notes[0], /not stored/);
	assert.match(frame.notes[0], /Name and Value fields/);
	assert.match(
		frame.notes[0],
		/*
		 * EITHER SPELLING: the chord is the platform's (`lockedRunUndoCap`), so an
		 * assertion on the mac spelling alone is a test that passes on the author's box
		 * and fails on the Linux runner — which is exactly what this one did (CI's run
		 * on `f9f7304a5` reported `Press Ctrl+Z in the composer` as the actual string).
		 */
		/Press (⌘Z|Ctrl\+Z) in the composer to put the words back\./,
		"and names where the key is honoured (UX round 2, U9: the dialog it opens has the focus)",
	);
	assert.ok(
		!frame.notes[0].includes("CANARY"),
		"and the sentence never echoes the value",
	);

	/*
	 * UX round 1's U4: the same press on a pane with NO conversation used to say only
	 * what the command needs, while the user's sentence had been taken apart just the
	 * same. The sentence is the same sentence, with the dispatcher's own refusal
	 * clause in place of the dialog's fields (`NO_CONVERSATION_CLAUSE`, quoted from
	 * the dispatcher so the note and the refusal the user then reads are one text).
	 */
	const draft = [];
	const sessionless = await mount({
		conversationId: "conv-6-draft",
		onSlashCommand: async (invocation) => {
			draft.push(invocation);
			return "consumed";
		},
	});
	await type(sessionless, "/credential ");
	await type(sessionless, "sk-live-CANARY-4417");
	await esc(sessionless);
	await clickSend(sessionless);
	assert.equal(draft.length, 1, "the sessionless pane runs the same route");
	assert.equal(sessionless.sent.length, 0, "and sends nothing");
	assert.equal(sessionless.notes.length, 1);
	/*
	 * ONE SENTENCE ABOUT THE REFUSAL, NOT TWO (UX round 2, U12). This pane used to read
	 * the receipt's own clause and the dispatcher's refusal in the same beat, in two
	 * vocabularies; the receipt now defers to the dispatcher for why nothing ran, and
	 * says only what happened to the words.
	 */
	assert.ok(
		!/needs an open conversation/i.test(sessionless.notes[0]),
		"the receipt does not restate the dispatcher's own refusal",
	);
	assert.match(sessionless.notes[0], /taken as its argument/);
	assert.match(sessionless.notes[0], /to put the words back/);
	assert.ok(
		!/Name and Value fields/.test(sessionless.notes[0]),
		"and the sentence does not promise a dialog that pane cannot open",
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
		unredactedNotice(11, "credential"),
		"the Esc discloses the eleven characters it put back — and says what the next Enter does with them, which for a locked draft is that the command takes them",
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
		 * the generated palettes the two washes sit at 1.00-1.63 fill contrast and a
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
	 * HUE difference and almost nothing else - the two washes sit at 1.00-1.63
	 * fill contrast across the generated palettes, and a greyscale reading of
	 * them is 34 vs 35 of 255 - so a reader who cannot separate a warm brown from
	 * a cool blue had no cue at all before pressing Enter. This assertion fails
	 * if the edge goes back to `outline-solid`.
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
		unredactedNotice(19, "credential"),
		"the live state discloses, as round 1 pinned — with the locked run's own clause (UX round 2, U7)",
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
		unredactedNotice(19, "credential"),
		"the disclosure survives the restore, in the same words the live state used",
	);
});

test("the cancel's own record decides: an EMPTY span leaves prose, a span with characters does not", async () => {
	/*
	 * THIS PIN HAS MOVED TWICE, and both moves are the same question asked of a
	 * different fact — so the third answer is the one written on the gesture itself.
	 *
	 * (1) Round 2's U9 reading was "an Esc-cancelled token is prose even when the span
	 * was empty", asserted of a tail the operator types in the open: the escape leaves
	 * an inert token, so what they write after it is their own sentence.
	 * (2) QA round 2's Q-1 then measured the cost of the exception's own gate: it read
	 * the DISCLOSURE, a whole-buffer equality that ANY keystroke clears, so
	 * `/credential ` + Escape + one character + Enter put a plaintext secret into a
	 * message record and a provider request — on that head and on `main` alike. The
	 * branch's answer was to ask the planner for every draft holding a locked run,
	 * which closed that door and, as code review round 3 measured, deleted the
	 * operator's words on shape (1): `/credential ` + Escape + `mysecretname` + Enter
	 * took the tail as the command's argument instead of sending their sentence.
	 * (3) THIS HEAD asks the fact neither reading had: WHAT THE CANCEL ITSELF PUT BACK
	 * (`token.restored`, recorded by `cancelTypedCredential` at the moment of the
	 * gesture). An empty span restores nothing, so the words written after it are the
	 * operator's by §5's own reading and go to the model; a span that HELD characters
	 * restored a secret, and no later keystroke can make that untrue.
	 *
	 * Both directions are driven below, and the second is the one that must never
	 * regress: a cancelled span whose characters came back keeps its tail out of the
	 * message.
	 */
	const dispatch = [];
	const prose = await mount({
		onSlashCommand: async (command) => {
			dispatch.push(command);
			return "consumed";
		},
	});
	await type(prose, "deploy with /credential ");
	await esc(prose);
	await type(prose, "mysecretname");
	assert.equal(
		prose.value(),
		"deploy with /credential mysecretname",
		"the empty span restored nothing, so these are the words the operator wrote",
	);
	await enter(prose);
	await settle();
	assert.deepEqual(
		dispatch,
		[],
		"nothing is dispatched for a bare cancelled token",
	);
	const sent = prose.sent.at(-1)[0];
	assert.equal(
		typeof sent === "string" ? sent : sent.text,
		"deploy with /credential mysecretname",
		"and their own sentence is what goes to the model",
	);

	/*
	 * The direction Q-1 measured, which this head keeps: the span HELD characters, so
	 * the tail is the command's and never the model's — at both carets.
	 */
	const CANARY = "LOP_R4_EMPTY_SPAN_CANARY_31ba";
	for (const at of [0, "end"]) {
		const ran = [];
		const frame = await mount({
			conversationId: `conv-r4-span-${at}`,
			paneHasSession: true,
			sessionStatus: { frontend: null },
			onSlashCommand: async (command) => {
				ran.push(command);
				return "consumed";
			},
		});
		await type(frame, "deploy with /credential ");
		await type(frame, CANARY);
		await esc(frame);
		await placeCaret(frame, at === 0 ? 0 : frame.value().length);
		await type(frame, "x");
		await enter(frame);
		await settle();
		assert.equal(
			ran.length,
			1,
			`the restored span's run is the dispatcher's (caret ${at})`,
		);
		assert.equal(ran[0].name, "credential");
		assert.ok(ran[0].args.includes(CANARY.slice(0, -1)));
		assert.equal(frame.sent.length, 0, "nothing is sent as a message");
		assert.ok(
			!JSON.stringify(frame.sent).includes(CANARY),
			"and no payload carries it",
		);
	}
});
test("an uncancelled /credential still dispatches, and keeps its arguments out of the box", async () => {
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

/* ------------------------------------------------------------------ */
/* The refusal: a composer that will not take input, keeping its box   */
/* ------------------------------------------------------------------ */

test("a refused composer is read-only rather than disabled, and refuses Enter itself", async () => {
	const missing = await mount({ unavailable: true });
	const field = missing.textarea();
	/*
	 * THE ATTRIBUTE IS THE ASSERTION, and it is the whole of what this file can
	 * honestly say about the edit: the rig below applies no default action to a
	 * read-only field (no `input` event, so `onChange` never runs), which is what
	 * a browser does — but that makes the rig, not the composer, the thing doing
	 * the refusing. What jsdom CAN prove is the half a green DOM rig would
	 * otherwise carry alone: `readOnly` does not stop `keydown`, so the guard in
	 * `handleComposerKeyDown` is what stands between this state and a message
	 * sent for a conversation this machine does not have.
	 *
	 * What it must NOT be is `disabled`, and that is the defect being fixed:
	 * Chromium blurs a control that becomes disabled, so the caret went to
	 * `document.body` and on this arm never came back (the predicate never flips
	 * again for the panel), and a disabled textarea cannot be focused, selected
	 * or copied — the reader lost access to the words they were typing in the one
	 * state that also tells them the conversation is gone.
	 */
	assert.equal(field.readOnly, true);
	assert.equal(
		field.disabled,
		false,
		"`disabled` on the composer is the focus loss this change removes",
	);
	assert.equal(
		field.getAttribute("aria-disabled"),
		"true",
		"the refusal has to reach a screen reader through the attribute it has left",
	);
	assert.equal(field.placeholder, "This conversation is gone");

	await type(missing, "still typing");
	assert.equal(missing.value(), "", "a read-only field takes no edit");
	await enter(missing);
	assert.equal(
		missing.sent.length,
		0,
		"Enter must not submit while the composer refuses input — the guard, not the attribute, is what refuses this one",
	);

	/* The busy arm, which only a backend without `canonical_stream` reaches. */
	const busy = await mount({ isLoading: true, currentJobId: "job-1" });
	assert.equal(busy.textarea().readOnly, true);
	await type(busy, "typed while busy");
	assert.equal(busy.value(), "");
	await enter(busy);
	assert.equal(busy.sent.length, 0);

	/*
	 * And the refusal is a STATE rather than a permanent attribute: a live
	 * composer takes input, submits, and says nothing to a screen reader about
	 * being unavailable — absent, not `aria-disabled="false"`.
	 */
	const live = await mount({});
	assert.equal(live.textarea().readOnly, false);
	assert.equal(live.textarea().hasAttribute("aria-disabled"), false);
	await type(live, "hello");
	assert.equal(live.value(), "hello");
	await enter(live);
	assert.equal(
		live.sent.length,
		1,
		"the live composer is not refusing anything",
	);
});

/* ------------------------------------------------------------------ */
/* The settle: what the user typed while a send was in flight           */
/* ------------------------------------------------------------------ */

test("text typed while a send is in flight survives the settle", async () => {
	/*
	 * THE MEASURED DEFECT, at the level the mechanism lives at. The seeding
	 * effect was documented as "on mount or conversation change" and its deps
	 * array also changed on every submit SETTLE — `addSubmittedMessage` installs
	 * a new array identity and `retireDraft` nulls the history index in the same
	 * turn — so it then re-seeded the box from `getCurrentInput`, which
	 * `retireDraft` had just written to `""`. In the operator's own run that
	 * destroyed 16 of 16 characters typed during the hold (5 of 16 at a shorter
	 * one), with the caret still in the box: "a UI update lands and my typing
	 * goes nowhere".
	 *
	 * This is the regression test for it, and it is DIFFERENT in kind from the
	 * documented clear it was mistaken for: `clearOnce` clears only the text the
	 * submit itself carried (`clearSubmittedText`), which is what keeps this
	 * typing, and that guard is untouched by the change.
	 */
	let release;
	const held = new Promise((resolve) => {
		release = resolve;
	});
	const frame = await mount({ onSendMessage: () => held.then(() => true) });

	await type(frame, "first message");
	await enter(frame);
	assert.equal(
		frame.sent.length,
		1,
		"the send is in flight and deliberately held",
	);

	const typed = "what I typed while it was in flight";
	await type(frame, typed);
	const beforeSettle = frame.value();
	assert.ok(
		beforeSettle.includes(typed),
		"the typing reaches the box while the send is held",
	);

	await act(async () => {
		release();
		await held;
	});
	await settle();

	assert.equal(
		frame.value(),
		beforeSettle,
		"the settle must not write the store's own value over what the user has typed since",
	);
});

test("a credential typed MID-SENTENCE is the command's, never the model's (the lock handoff)", async () => {
	/*
	 * THE COMPOSER'S OWN HANDOFF, and the only case in the repository that fails
	 * when it is deleted — which is why it lives here rather than beside the rule.
	 *
	 * The defect: `credential-capture.ts` owns the words whose argument is a
	 * SECRET (`CREDENTIAL_WORDS`, the spellings its own arming matcher is built
	 * from), and until this fix nothing handed them to the planner. So a
	 * `/credential <secret>` typed into a sentence planned as PROSE and the secret
	 * reached the provider as message text, where nothing undoes it; the
	 * whole-draft form was already safe, because it is a command with or without
	 * the set. `slash-submit.test.mjs` cannot see the handoff at all — it drives
	 * the planner with a vocabulary the test wrote, so deleting the composer's
	 * argument leaves every one of its cases green. That is the shape of finding a
	 * reviewer raises, and the reason this case drives the SHIPPED component.
	 *
	 * The draft is WRITTEN rather than typed: typing `/credential ` arms the
	 * capture (§1), and this case is about what the planner answers for a draft
	 * the capture is not holding. `writeValue` splits Enter's two owners the way
	 * the app does — the capture declines (nothing is being masked), the planner
	 * answers.
	 *
	 * Every caret is driven, column 0 first: a check that asked `slashTokenSpan`
	 * for the caret's token answers `send` at column 0, which is the hole this
	 * case exists to catch.
	 */
	const CANARY = "LOP_TYPED_LEAK_CANARY_4417";
	const ran = [];
	const frame = await mount({
		conversationId: "conv-locked-word-midsentence",
		onSlashCommand: async (command) => {
			ran.push(command);
			return "consumed";
		},
	});
	const field = frame.textarea();
	for (const [name, draft, survivor] of [
		["credential", `please /credential ${CANARY}`, "please"],
		["cred", `please /cred ${CANARY}`, "please"],
		[
			"credential",
			`please store this key for me /credential ${CANARY}`,
			"please store this key for me",
		],
	]) {
		for (const caret of [0, Math.floor(draft.length / 2), draft.length]) {
			const before = ran.length;
			await act(async () => {
				writeValue(field, draft, caret);
			});
			await settle();
			assert.equal(
				frame.value(),
				draft,
				`the field holds the draft (caret ${caret})`,
			);
			await enter(frame);
			await settle();
			assert.equal(
				ran.length,
				before + 1,
				`${JSON.stringify(draft)} at caret ${caret} reaches the dispatcher`,
			);
			assert.equal(
				ran.at(-1)?.name,
				name,
				"and it is the credential command, whose arguments the dispatcher strips",
			);
			assert.equal(
				ran.at(-1)?.args,
				CANARY,
				"which is the tail the operator typed as its argument",
			);
			assert.equal(
				frame.value(),
				survivor,
				`the sentence the word sat in survives the run (caret ${caret})`,
			);
		}
	}
	assert.equal(
		frame.sent.length,
		0,
		"no draft in which the word carried a secret was ever sent as a message",
	);
	assert.ok(
		!JSON.stringify(frame.sent).includes(CANARY),
		"and the canary is in no payload the model path was handed",
	);
});

test("the words a locked run took come back on the undo key (UX round 1, U3)", async () => {
	/*
	 * U3, from the walk that raised it: the tail is not run and not kept — the
	 * dispatcher strips a credential's argument, so the words after the token are
	 * neither the command's nor the draft's — and the one reflex a user has did
	 * nothing, because `Command+Z` in a textarea is the platform's own undo, which
	 * knows nothing about a box a component wrote. The sentence the run now raises
	 * promises a key, so the key has to work: this pins both shapes the run leaves
	 * behind (a survivor, and an emptied box) and the one-edit rule that ends it.
	 */
	const ran = [];
	const frame = await mount({
		conversationId: "conv-locked-undo",
		paneHasSession: true,
		sessionStatus: { frontend: null },
		onSlashCommand: async (invocation) => {
			ran.push(invocation);
			return "consumed";
		},
	});
	const field = frame.textarea();
	const CANARY = "LOP_TYPED_LEAK_CANARY_4417";

	// 1. A SPLICE: the survivor stays, and the draft comes back whole.
	const prose = `please store this key /credential ${CANARY}`;
	await act(async () => {
		writeValue(field, prose, prose.length);
	});
	await settle();
	await enter(frame);
	await settle();
	assert.equal(ran.length, 1, "the run happened");
	assert.equal(
		frame.value(),
		"please store this key",
		"with the token and its tail spliced out",
	);
	assert.equal(
		await undoKey(frame),
		true,
		"and the undo key is the composer's",
	);
	assert.equal(
		frame.value(),
		prose,
		"which puts the draft back, word for word",
	);
	assert.deepEqual(
		frame.caret(),
		{ start: prose.length, end: prose.length },
		"at the caret it had",
	);
	// Used once: a second press is the platform's own undo again.
	assert.equal(await undoKey(frame), false, "the record is spent");

	// 2. A WHOLE-DRAFT run clears the box; the same key restores all of it.
	const whole = `/credential ${CANARY}`;
	await act(async () => {
		writeValue(field, whole, 0);
	});
	await settle();
	await enter(frame);
	await settle();
	assert.equal(frame.value(), "", "the whole-draft form leaves an empty box");
	assert.equal(await undoKey(frame), true);
	assert.equal(
		frame.value(),
		whole,
		"and the undo brings the whole draft back",
	);

	/*
	 * 3. ONE EDIT ENDS IT, the same discipline the cancelled-token record keeps: a
	 * box the user has typed in since is the platform's own history, and the
	 * keystroke must not be stolen from it.
	 */
	await act(async () => {
		writeValue(field, prose, prose.length);
	});
	await settle();
	await enter(frame);
	await settle();
	assert.equal(frame.value(), "please store this key");
	await type(frame, "!");
	assert.equal(await undoKey(frame), false, "an edit retires the record");
	assert.equal(
		frame.value(),
		"please store this key!",
		"and the undo does not touch a box the user has written in",
	);
});

test("a store invalidates the list the picker reads (QA round 1, Q-5)", async () => {
	/*
	 * QA's second note, which the manager folded into this round: the picker's list
	 * is a CACHED read (`staleTime` five minutes, `shared/api/query-client.ts`) and the
	 * store path did not invalidate it, so a picker mounted after an inline store
	 * rendered "No credentials stored yet." while the same route answered with the
	 * name that had just been stored — the row the user opened the dialog for, off its
	 * own screen. The key is `desktopKeys.credentials` (one builder, read by the picker
	 * and invalidated here), so the two cannot drift apart.
	 *
	 * The seeded entry is the point of the test: `invalidateQueries` over a key with
	 * nothing cached marks nothing, so a rig that skipped the seed would pass on the
	 * broken code.
	 */
	const frame = await mount({
		conversationId: "conv-q5",
		sessionStatus: { frontend: null },
	});
	const listKey = ["desktop", "credentials", "conv-q5"];
	client.setQueryData(listKey, { data: { ok: true, credentials: [] } });
	assert.equal(
		client.getQueryState(listKey)?.isInvalidated,
		false,
		"the seeded list starts fresh",
	);

	await openCapture(frame, { prose: "store this for me " });
	await type(frame, "sk-live-Q5-4417");
	await enter(frame);
	assert.match(
		frame.value(),
		/\[Credential #1, \d+ chars\]/,
		"the mint landed",
	);
	await enter(frame);
	await settle();

	assert.ok(
		calls.some(
			(call) =>
				call.request.op === "sessions.credential" &&
				call.request.action === "store",
		),
		"the send stored the credential",
	);
	assert.equal(
		client.getQueryState(listKey)?.isInvalidated,
		true,
		"and the store marked the picker's own list stale",
	);
});

test("the Escape's door is closed one keystroke later, at every caret (QA round 2, Q-1)", async () => {
	/*
	 * QA ROUND 2's MAJOR, and the shape is the one the app's own notice invites: the
	 * Escape shows the characters as plain text so the operator can edit them, and ONE
	 * keystroke later the old guard had already let go — `unredactedOverBuffer` is a
	 * whole-buffer equality that any keystroke clears, while `holdsCancelledToken`
	 * matches the cancelled token's own text (`/credential `) at its old offset and says
	 * nothing about the secret. Measured on the real app: `POST /messages` with the
	 * canary in the record and in the provider body, byte-identical on `main`.
	 *
	 * The fix is the one the finding names: the planner is asked whenever the draft
	 * holds a locked run, so nothing here depends on the disclosure bookkeeping. Every
	 * shape below is driven at BOTH carets, and the pasted provenance is driven with it,
	 * because the draft's arrival is what the exception used to read.
	 */
	const CANARY = "LOP_R2_EDIT_CANARY_4f66";
	const edits = [
		["one character appended", (frame) => type(frame, "x")],
		[
			"a character replaced inside the tail",
			async (frame) => {
				await key(frame, { key: "Backspace" });
				await type(frame, "x");
			},
		],
	];
	for (const [label, edit] of edits) {
		for (const at of [0, "end"]) {
			const ran = [];
			const frame = await mount({
				conversationId: `conv-q1-${label.replace(/\W/g, "")}-${at}`,
				paneHasSession: true,
				sessionStatus: { frontend: null },
				onSlashCommand: async (command) => {
					ran.push(command);
					return "consumed";
				},
			});
			await type(frame, "please /credential ");
			await type(frame, CANARY);
			await esc(frame);
			await placeCaret(frame, at === 0 ? 0 : frame.value().length);
			await edit(frame);
			const draft = frame.value();
			await enter(frame);
			await settle();
			assert.equal(
				ran.length,
				1,
				`${label} at caret ${at}: the run is the dispatcher's`,
			);
			assert.equal(ran[0].name, "credential", `${label} at caret ${at}`);
			assert.ok(
				ran[0].args.includes(CANARY.slice(0, -1)),
				`${label} at caret ${at}: and the words go as its argument (${JSON.stringify(ran[0].args)})`,
			);
			assert.equal(
				frame.sent.length,
				0,
				`${label} at caret ${at}: nothing is sent as a message either`,
			);
			assert.ok(
				!JSON.stringify(frame.sent).includes(CANARY),
				`${label} at caret ${at}: and no sent payload carries it`,
			);
			assert.ok(
				draft.includes("LOP_R2_EDIT_CANARY") && !frame.value().includes(CANARY),
				`${label} at caret ${at}: the draft held it and the box does not`,
			);
		}
	}

	/*
	 * The ARRIVAL provenance, edited after it arrived: no cancel, no record, no
	 * disclosure — the planner's own reading of the draft. Both writes are the DOM's
	 * own bulk route (`writeValue`), which is what a paste into an unarmed box, a
	 * restored draft and a session switch all produce; the composer's KEYSTROKE route
	 * would arm the capture and mask the tail instead, which is a different branch and
	 * is pinned by the masked cases above.
	 */
	const pasted = [];
	const frame = await mount({
		conversationId: "conv-q1-paste",
		paneHasSession: true,
		sessionStatus: { frontend: null },
		onSlashCommand: async (command) => {
			pasted.push(command);
			return "consumed";
		},
	});
	const arrival = `please /credential ${CANARY}`;
	await act(async () => {
		writeValue(frame.textarea(), arrival, 0);
	});
	await settle();
	const edited = `${arrival} and then finish`;
	await act(async () => {
		writeValue(frame.textarea(), edited, edited.length);
	});
	await settle();
	assert.equal(
		frame.value(),
		edited,
		"the edited arrival is what the box holds",
	);
	await enter(frame);
	await settle();
	assert.equal(pasted.length, 1, "the pasted draft's run is the dispatcher's");
	assert.ok(pasted[0].args.startsWith(CANARY));
	assert.equal(frame.sent.length, 0);
	assert.ok(!JSON.stringify(frame.sent).includes(CANARY));
});

test("a restored masked draft offers no undo, and says the value is re-entered (UX round 2, U8)", async () => {
	/*
	 * U8's shape, and the one this suite can build: a draft that ARRIVED holding mask
	 * cells — a reloaded or restored masked draft, whose value §6 deliberately does not
	 * persist, so nothing anywhere holds the characters those bullets stood for (the
	 * typed shape does not reach this path at all: a live mask answers Enter by minting,
	 * measured on this rig).
	 *
	 * The choice the finding asked for, and the one this pins: the app does NOT fabricate
	 * a mask it cannot restore. Putting the bullets back would be a box that looks
	 * recovered and holds nothing — the user types beside them and gets plain text next
	 * to characters that stand for nothing — so no undo is armed and the sentence drops
	 * its promise of the key, leaving the instruction that is true: the value belongs in
	 * the dialog's fields. Where the characters ARE real (the Escape's own shape, the
	 * plaintext arrival) the undo exists and returns them, which the other cases here
	 * pin.
	 */
	const cells = MASK_CELL.repeat(17);
	const ran = [];
	const frame = await mount({
		conversationId: "conv-u8-cells",
		paneHasSession: true,
		sessionStatus: { frontend: null },
		onSlashCommand: async (command) => {
			ran.push(command);
			return "consumed";
		},
	});
	const field = frame.textarea();
	const restored = `please /credential ${cells} and then finish`;
	await act(async () => {
		writeValue(field, restored, 0);
	});
	await settle();
	await enter(frame);
	await settle();
	assert.equal(ran.length, 1, "the run still happens");
	assert.equal(ran[0].name, "credential");
	assert.equal(frame.sent.length, 0, "nothing is sent");
	assert.equal(frame.value(), "please", "the box keeps the prose");
	assert.equal(frame.notes.length, 1);
	assert.match(frame.notes[0], /taken as its argument/);
	assert.ok(
		!/to put the words back/.test(frame.notes[0]),
		"and the sentence does not promise a key that would hand back the bullets",
	);
	assert.match(
		frame.notes[0],
		/Name and Value fields/,
		"it says where the value belongs instead",
	);
	assert.equal(await undoKey(frame), false, "and the key is not claimed");
	assert.equal(
		frame.value(),
		"please",
		"so the box is left as the run left it",
	);
});

test("the receipt names the dialog only where one opens (code review round 2, MINOR 4)", async () => {
	/*
	 * With an empty catalogue the locked run still happens — that is F1's fix, and the
	 * dispatcher answers `Unknown command /credential` and opens nothing. The receipt
	 * used to name the dialog's Name and Value fields on that pane, which is a door that
	 * never opened; it now carries the plain sentence and leaves the dispatcher's own
	 * miss to explain why nothing ran.
	 */
	const ran = [];
	const frame = await mount({
		conversationId: "conv-minor4",
		commands: [],
		paneHasSession: true,
		sessionStatus: { frontend: null },
		onSlashCommand: async (command) => {
			ran.push(command);
			return "consumed";
		},
	});
	const field = frame.textarea();
	await act(async () => {
		writeValue(field, "please /credential CANARY-MINOR-4", 0);
	});
	await settle();
	await enter(frame);
	await settle();
	assert.equal(ran.length, 1, "the run still reaches the dispatcher");
	assert.equal(ran[0].name, "credential", "with the spelling the user typed");
	assert.equal(frame.value(), "please", "and its tail is taken");
	assert.ok(
		!/Name and Value fields/.test(frame.notes[0]),
		"but the receipt does not name a dialog this pane cannot open",
	);
	assert.match(frame.notes[0], /taken as its argument/);
	assert.match(frame.notes[0], /to put the words back/);
});

test("the unredact notice says what Enter will actually do (UX round 2, U7)", async () => {
	/*
	 * The app's most trust-sensitive sentence, and the change made it false in the safe
	 * direction: it promised an exposure that a locked run no longer performs. It is now
	 * shape-dependent, read from the SAME planner call the press will use, and the two
	 * variants are pinned as text.
	 */
	const locked = await mount({ conversationId: "conv-u7-locked" });
	await type(locked, "please /credential ");
	await type(locked, "U7-CANARY-1");
	await esc(locked);
	assert.equal(
		locked.notice(),
		"11 characters are now PLAIN TEXT in the composer — Enter will take them as /credential's argument, not send them",
		"a locked draft says what the press does with them",
	);

	/*
	 * THE OTHER VARIANT IS THE HELPER'S OWN DEFAULT, and it is pinned as text rather
	 * than driven, because on this head it is not reachable from a live disclosure: the
	 * only three places a disclosure is set (the Escape, §6's restore, and the undo)
	 * all describe a buffer that holds the credential token and a tail, so the planner
	 * answers a locked run for every one of them. It stays as the sentence a caller
	 * without the locked handoff gets — the host that knows nothing about credentials —
	 * which is the same fallback that keeps `commandLockedWords` empty by default.
	 */
	assert.equal(
		unredactedNotice(11),
		"11 characters are now PLAIN TEXT in the composer — Enter will expose them",
		"a caller with no locked run still gets the plain sentence",
	);
});

test("the locked run's record is retired by events, not by content (code review round 2, MINOR 1)", async () => {
	/*
	 * The record used to hold the box's TEXT and restore only while the box still
	 * equalled it, which made "one edit ends it" true only while the user happened to
	 * type something different. Three states the reviewer reproduced on the shipped
	 * component, each of them a `⌘Z` hijacked for a box the user had left behind.
	 */
	const CANARY = "LOP_R2_LIFECYCLE_CANARY_9821";
	const locked = `please store this key /credential ${CANARY}`;

	// 1. An edit that returns the box to the same text.
	const edited = await mount({
		conversationId: "conv-minor1-edit",
		onSlashCommand: async () => "consumed",
	});
	await act(async () => {
		writeValue(edited.textarea(), locked, locked.length);
	});
	await settle();
	await enter(edited);
	await settle();
	assert.equal(edited.value(), "please store this key");
	await type(edited, "x");
	await key(edited, { key: "Backspace" });
	assert.equal(
		edited.value(),
		"please store this key",
		"the box is back where it was",
	);
	assert.equal(
		await undoKey(edited),
		false,
		"and the record is gone with the edit",
	);
	assert.equal(edited.value(), "please store this key");

	// 2. A later send.
	const sent = await mount({
		conversationId: "conv-minor1-send",
		onSlashCommand: async () => "consumed",
	});
	await act(async () => {
		writeValue(sent.textarea(), locked, locked.length);
	});
	await settle();
	await enter(sent);
	await settle();
	assert.equal(sent.value(), "please store this key");
	await type(sent, " hello");
	await clickSend(sent);
	assert.equal(sent.sent.length, 1, "the later message was sent");
	assert.equal(
		await undoKey(sent),
		false,
		"and the record does not outlive it",
	);
	assert.ok(
		!sent.value().includes("credential"),
		"so no consumed line is put back after the send",
	);

	// 3. A conversation switch — same root, different conversation.
	const first = await mount({
		conversationId: "conv-minor1-a",
		onSlashCommand: async () => "consumed",
	});
	await act(async () => {
		writeValue(first.textarea(), locked, locked.length);
	});
	await settle();
	await enter(first);
	await settle();
	assert.equal(first.value(), "please store this key");
	const second = await mount({ conversationId: "conv-minor1-b" });
	await settle();
	assert.equal(
		await undoKey(second),
		false,
		"the next conversation's box claims nothing",
	);
	assert.equal(second.value(), "", "and stays empty");
});

test("the undo announces the real characters it hands back (code review round 3, MAJOR 1)", async () => {
	/*
	 * THE PIN THIS FINDING EXISTS FOR: a state that is real AND undisclosed must not
	 * exist. The undo puts the operator's own characters back — for a credential run,
	 * that is a live value sitting in the box in plain text — and `plain` used to be
	 * read off a LIVE mask's length, which is unreachable (a live span answers Enter by
	 * minting), so the count was always 0, the announcement never fired, and the
	 * restore was silent while its own code and the round-2 reply claimed otherwise.
	 * `plain` is now the run's own argument count, so the notice fires wherever the
	 * restore is real.
	 *
	 * BOTH SHAPES ARE DRIVEN because their provenance differs and the fact does not:
	 * the Escape's own shape (the app put the characters there) and an arrival (the
	 * characters were never hidden at all).
	 */
	const CANARY = "LOP_R4_UNDO_CANARY_5c02";
	const typedFrame = await mount({
		conversationId: "conv-r4-undo-typed",
		onSlashCommand: async () => "consumed",
	});
	await type(typedFrame, "please /credential ");
	await type(typedFrame, CANARY);
	await esc(typedFrame);
	assert.equal(
		typedFrame.notice(),
		unredactedNotice(CANARY.length, "credential"),
		"the Escape announces what it puts back",
	);
	await enter(typedFrame);
	await settle();
	assert.match(typedFrame.notes.at(-1), /to put the words back/);
	assert.equal(await undoKey(typedFrame), true, "the undo is claimed");
	assert.equal(
		typedFrame.value(),
		`please /credential ${CANARY}`,
		"the real characters come back",
	);
	assert.ok(
		!typedFrame.value().includes(MASK_CELL),
		"as characters, not as the mask cells the composer painted",
	);
	assert.equal(
		typedFrame.notice(),
		unredactedNotice(CANARY.length, "credential"),
		"so the restored value is announced rather than left silent",
	);
	assert.equal(
		typedFrame.disclosure(),
		CANARY.length,
		"and the count is persisted with the text it describes",
	);

	const arrival = `please /credential ${CANARY}`;
	const arrived = await mount({
		conversationId: "conv-r4-undo-arrived",
		onSlashCommand: async () => "consumed",
	});
	await act(async () => {
		writeValue(arrived.textarea(), arrival, arrival.length);
	});
	await settle();
	await enter(arrived);
	await settle();
	assert.equal(
		await undoKey(arrived),
		true,
		"an arrival's undo is claimed too",
	);
	assert.equal(arrived.value(), arrival);
	assert.equal(
		arrived.notice(),
		unredactedNotice(CANARY.length, "credential"),
		"and a restore of characters that were never hidden is announced on the same rule",
	);
	assert.equal(arrived.disclosure(), CANARY.length);
});

test("a mask cell in the operator's own prose does not disarm the undo (code review round 3, MINOR 2)", async () => {
	/*
	 * `restorable` used to scan the WHOLE buffer for the mask character, so a `•` the
	 * operator typed — a bulleted sentence that happens to carry the token — armed no
	 * record: the undo was silently unavailable and the sentence told them the value
	 * must be re-entered, which is untrue when their value is still in the clipboard
	 * and still in the box's own text.
	 *
	 * The scan is now scoped to the run the locked word owns, which is the only place
	 * this app paints a cell (§6 persists them there), so a cell inside the run is a
	 * mask whose value did not survive — the U8 case, pinned above — and a cell outside
	 * it is the operator's own character.
	 */
	const CANARY = "LOP_R4_BULLET_CANARY_7d31";
	const draft = `please ${MASK_CELL} store this key /credential ${CANARY}`;
	const frame = await mount({
		conversationId: "conv-r4-bullet",
		onSlashCommand: async () => "consumed",
	});
	await act(async () => {
		writeValue(frame.textarea(), draft, draft.length);
	});
	await settle();
	await enter(frame);
	await settle();
	assert.equal(
		frame.value(),
		`please ${MASK_CELL} store this key`,
		"the run takes its tail",
	);
	assert.match(
		frame.notes.at(-1),
		/to put the words back/,
		"and the sentence promises the key, because this run's own span holds no cell",
	);
	assert.equal(await undoKey(frame), true, "so the key is claimed");
	assert.equal(
		frame.value(),
		draft,
		"and the operator's whole draft comes back",
	);
});

test("a character typed in front of the cancelled token does not hand it to the model (QA round 4, Q-1)", async () => {
	/*
	 * QA ROUND 4's BLOCKER, on the shape the app's own notice invites and on the one
	 * keystroke that used to break it: `/credential <value>` -> Escape -> Home -> ONE
	 * character in front of the slash -> Enter.
	 *
	 * The character destroys the tokenizer's left boundary, so the planner's locked rule
	 * found no word at all, the draft no longer started with `/` so the leading-slash
	 * refusal had no part of it, and the press put the value into a message record and a
	 * provider request body — the value the APP had just un-masked in its own notice. It
	 * is pre-existing rather than a regression (byte-identical on `main`), and it is the
	 * door this PR exists to close.
	 *
	 * Driven at four carets including column 0 and at both word spellings, because the
	 * rule is asked of the DRAFT and a caret-led check has nothing to claim at either end
	 * of it. The `see ` case is the contrast: a prefix that restores a whitespace boundary
	 * planned as the command before this change and still does.
	 */
	const CANARY = "LOP_R4_PREFIX_CANARY_7c31";
	for (const [word, prefix] of [
		["credential", "x"],
		["cred", "x"],
		["credential", "see "],
		["credential", "xplease "],
	]) {
		for (const at of [0, 1, "mid", "end"]) {
			const ran = [];
			const frame = await mount({
				conversationId: `conv-q4-${word}-${at}-${prefix.trim() || "none"}`,
				paneHasSession: true,
				sessionStatus: { frontend: null },
				onSlashCommand: async (command) => {
					ran.push(command);
					return "consumed";
				},
			});
			await type(frame, `/${word} `);
			await type(frame, CANARY);
			await esc(frame);
			await placeCaret(frame, 0);
			await type(frame, prefix);
			const draft = frame.value();
			assert.ok(
				draft.includes(CANARY),
				`/${word} + ${JSON.stringify(prefix)} at caret ${at}: the box holds the characters`,
			);
			await placeCaret(
				frame,
				at === "end"
					? draft.length
					: at === "mid"
						? Math.floor(draft.length / 2)
						: at,
			);
			await enter(frame);
			await settle();
			assert.equal(
				ran.length,
				1,
				`/${word} + ${JSON.stringify(prefix)} at caret ${at}: the run is the dispatcher's`,
			);
			assert.equal(
				ran[0].name,
				word,
				`/${word} + ${JSON.stringify(prefix)} at caret ${at}`,
			);
			assert.ok(
				ran[0].args.includes(CANARY.slice(0, -1)),
				`/${word} + ${JSON.stringify(prefix)} at caret ${at}: and the words go as its argument`,
			);
			assert.equal(
				frame.sent.length,
				0,
				`/${word} + ${JSON.stringify(prefix)} at caret ${at}: nothing is sent as a message`,
			);
			assert.ok(
				!JSON.stringify(frame.sent).includes(CANARY),
				`/${word} + ${JSON.stringify(prefix)} at caret ${at}: and no sent payload carries it`,
			);
			assert.ok(
				!(frame.draft() ?? "").includes(CANARY),
				`/${word} + ${JSON.stringify(prefix)} at caret ${at}: and the persisted draft holds no value`,
			);
			assert.ok(
				!JSON.stringify(calls).includes(CANARY),
				`/${word} + ${JSON.stringify(prefix)} at caret ${at}: and no credential was minted from it`,
			);
		}
	}

	/*
	 * THE RECORD-LESS PROVENANCE OF THE SAME SHAPE — the DOM's own bulk route, no capture,
	 * no cancel — and it is the RESIDUAL this fix deliberately keeps (the PR body states it):
	 * without a record the boundary rule holds, so `x/credential <secret>` typed or pasted by
	 * hand is prose and is sent, exactly as it is on `main`.
	 *
	 * It is not closable at this seam. The only fact that tells this draft apart from
	 * `the docs/credential rotation policy is stale` is a cancel the app itself performed,
	 * because as far as any rule over words can see, both are prose; reading an in-word slash
	 * as the command for EVERY draft is what UX round 5 measured the cost of (U19, U20), and
	 * it is what this commit un-did. So the pin says what the apparatus does and names why,
	 * rather than asserting a safety this rule cannot have.
	 */
	const pasted = [];
	const frame = await mount({
		conversationId: "conv-q4-paste",
		paneHasSession: true,
		sessionStatus: { frontend: null },
		onSlashCommand: async (command) => {
			pasted.push(command);
			return "consumed";
		},
	});
	const arrival = `x/credential ${CANARY}`;
	await act(async () => {
		writeValue(frame.textarea(), arrival, 1);
	});
	await settle();
	await enter(frame);
	await settle();
	assert.equal(
		pasted.length,
		0,
		"with no record, an in-word slash is punctuation, so nothing dispatches",
	);
	assert.equal(
		frame.sent.length,
		1,
		"and the draft is the operator's prose: it is sent, as it is on main",
	);
});

test("a word an edit has broken does not hand the run to the model (QA round 5, Q-1)", async () => {
	/*
	 * QA ROUND 5's BLOCKER, on the same one-keystroke-after-the-app's-own-Escape invitation,
	 * at the positions QA drove on the real app. Each leaves the box holding the characters
	 * the Escape had just un-masked, with a word this planner's vocabulary can no longer see
	 * and — for the inside cases — nothing the composer's own `recordWord` can see either, so
	 * before this commit the gesture degraded to prose and the canary reached a message record
	 * and a provider request body on this head, on the pre-fold head and on `main` alike.
	 *
	 * The cancel's own record is the only fact that survives those edits: it names the WORD
	 * that was holding characters here. So the run is taken as that word's argument — the
	 * dispatcher's business, never the model's — and every assertion below is the same shape
	 * as the intact-word pin above: what ran, what was sent, what the store holds.
	 */
	const CANARY = "LOP_R5_BROKEN_WORD_CANARY_9f42";
	const edits = [
		["inside the word", { at: 12, type: "x" }],
		["inside the word, later column", { at: 10, type: "z" }],
		["immediately after the word", { at: 17, type: "x" }],
		["one Backspace inside the word", { at: 12, backspace: true }],
	];
	for (const [label, edit] of edits) {
		const ran = [];
		const frame = await mount({
			conversationId: `conv-q5-${label.replace(/\W/g, "")}`,
			paneHasSession: true,
			sessionStatus: { frontend: null },
			onSlashCommand: async (command) => {
				ran.push(command);
				return "consumed";
			},
		});
		await type(frame, "please /credential ");
		await type(frame, CANARY);
		await esc(frame);
		await placeCaret(frame, edit.at);
		if (edit.backspace) await key(frame, { key: "Backspace" });
		else await type(frame, edit.type);
		const draft = frame.value();
		assert.ok(
			draft.includes(CANARY),
			`${label}: the box holds the characters the Escape un-masked`,
		);
		await enter(frame);
		await settle();
		assert.equal(ran.length, 1, `${label}: the run is the dispatcher's`);
		assert.equal(ran[0].name, "credential", `${label}: as the recorded word`);
		assert.ok(
			ran[0].args.includes(CANARY.slice(0, -1)),
			`${label}: and the characters go as its argument`,
		);
		assert.equal(
			frame.sent.length,
			0,
			`${label}: nothing is sent as a message`,
		);
		assert.ok(
			!JSON.stringify(frame.sent).includes(CANARY),
			`${label}: and no sent payload carries it`,
		);
		assert.ok(
			!(frame.draft() ?? "").includes(CANARY),
			`${label}: nor does the persisted draft`,
		);
		assert.ok(
			!JSON.stringify(calls).includes(CANARY),
			`${label}: and no credential was minted from it`,
		);
	}

	/*
	 * The space-prefixed form and the form with a sentence after the run, both of which the
	 * same edit reaches: the first is QA's `I6`, the second its `I7`.
	 */
	for (const [label, prefix, suffix] of [
		["space-prefixed, inside the word", "see ", ""],
		["with a sentence after the run", "please ", " and then ship it"],
	]) {
		const ran = [];
		const frame = await mount({
			conversationId: `conv-q5-${label.replace(/\W/g, "")}`,
			paneHasSession: true,
			sessionStatus: { frontend: null },
			onSlashCommand: async (command) => {
				ran.push(command);
				return "consumed";
			},
		});
		await type(frame, `${prefix}/credential `);
		await type(frame, CANARY + suffix);
		await esc(frame);
		await placeCaret(frame, prefix.length + 7);
		await type(frame, "x");
		await enter(frame);
		await settle();
		assert.equal(ran.length, 1, `${label}: the run is the dispatcher's`);
		assert.equal(ran[0].name, "credential", `${label}`);
		assert.ok(ran[0].args.includes(CANARY.slice(0, -1)), `${label}`);
		assert.equal(frame.sent.length, 0, `${label}: nothing is sent`);
		assert.ok(!JSON.stringify(frame.sent).includes(CANARY), `${label}`);
	}
});

test("an in-word slash in prose stays prose and still sends (UX round 5, U19/U20)", async () => {
	/*
	 * THE OTHER HALF OF THE SAME SEAM, and the reason the boundary is the RECORD's rather
	 * than every draft's. UX drove this on the real app: `the docs/credential rotation policy
	 * is stale` is a sentence a person writes, and a rule that reads any in-word slash as the
	 * command truncated it to `the docs`, answered with a Credential dialog asking for a
	 * secret the user does not have, and left the sentence unsendable — Enter, ⌘Z, Enter took
	 * the tail again every time.
	 *
	 * None of these drafts carries a cancel record, so the boundary rule holds and every one
	 * of them is the operator's own sentence: dispatched to nothing, sent as written, and the
	 * box emptied by the send.
	 */
	for (const sentence of [
		"the docs/credential rotation policy is stale",
		"see scripts/cred for the rotation policy",
		"https://example.com/credential/rotation",
	]) {
		const ran = [];
		const frame = await mount({
			conversationId: `conv-u19-${sentence.length}`,
			paneHasSession: true,
			sessionStatus: { frontend: null },
			onSlashCommand: async (command) => {
				ran.push(command);
				return "consumed";
			},
		});
		await type(frame, sentence);
		assert.ok(
			frame.notice().includes("masked as you type") === false,
			`${JSON.stringify(sentence)}: nothing armed over this prose`,
		);
		await enter(frame);
		await settle();
		assert.equal(
			ran.length,
			0,
			`${JSON.stringify(sentence)}: no command was run`,
		);
		assert.equal(
			frame.sent.length,
			1,
			`${JSON.stringify(sentence)}: it is sent`,
		);
		const sentText = frame.sent.at(-1)[0];
		assert.equal(
			typeof sentText === "string" ? sentText : sentText.text,
			sentence,
			`${JSON.stringify(sentence)}: as written, in full`,
		);
		assert.equal(frame.value(), "", "and the send emptied the box");
	}
});

test("a draft that no longer holds the run is prose, however much history the pane has (UX round 6, U24)", async () => {
	/*
	 * UX ROUND 6's MAJOR, and the code reviewer's MINOR 1 — the same seam, filed from both
	 * sides: the record's reach was keyed on the PANE'S HISTORY rather than on the draft's
	 * text, so a user who cancelled a credential, cleared the box and wrote a fresh
	 * sentence got the run's rule applied to the sentence — truncated to `the docs`, a
	 * Credential dialog asking for a secret they do not have, and a line that could never
	 * be sent (round 5's loop, on a draft holding NONE of the app's characters). The control
	 * — the same sentence, no Escape — was never consumed.
	 *
	 * The bound is now the bytes: `carriesRestoredRun` hands the record's word to the
	 * planner only while the run the cancel put back is still in the box, which is exactly
	 * the state every shape this branch closes is in at its press. So this test pins the
	 * property the reviewer asked for — a draft whose text no longer contains the restored
	 * run is prose, however much history the pane has — by driving the exact steps and the
	 * control in the same conversation shape.
	 */
	const CANARY = "LOP_R6_U24_CANARY_4a17";
	const sentence = "the docs/credential rotation policy is stale";
	for (const [label, withEscape] of [
		["after an Escape and a cleared box", true],
		["with no Escape at all (the control)", false],
	]) {
		const ran = [];
		const frame = await mount({
			conversationId: `conv-u24-${withEscape ? "escaped" : "control"}`,
			paneHasSession: true,
			sessionStatus: { frontend: null },
			onSlashCommand: async (command) => {
				ran.push(command);
				return "consumed";
			},
		});
		if (withEscape) {
			await type(frame, "/credential ");
			await type(frame, CANARY);
			await esc(frame);
			const held = frame.value();
			assert.ok(
				held.includes(CANARY),
				`${label}: the app un-masked the characters`,
			);
			for (let i = 0; i < held.length; i++)
				await key(frame, { key: "Backspace" });
			assert.equal(frame.value(), "", `${label}: the box is cleared`);
		}
		await type(frame, sentence);
		assert.equal(
			frame.value(),
			sentence,
			`${label}: the sentence is what the box holds`,
		);
		await enter(frame);
		await settle();
		assert.equal(
			ran.length,
			0,
			`${label}: no command was run over the sentence`,
		);
		assert.equal(frame.sent.length, 1, `${label}: the sentence is sent`);
		const sentText = frame.sent.at(-1)[0];
		assert.equal(
			typeof sentText === "string" ? sentText : sentText.text,
			sentence,
			`${label}: in full, byte for byte`,
		);
		assert.equal(frame.value(), "", `${label}: and the send emptied the box`);
	}
});

test("an edit that removes the slash sends the plaintext, and that is main's behaviour (code review round 6, MAJOR 1)", async () => {
	/*
	 * THE THIRD RESIDUAL, pinned rather than implied, and it is `main`'s behaviour:
	 * measured on `3a5b66c54` in the same probe, the identical drafts — including the
	 * intact `please /credential <plaintext>` — are `{kind:"send"}` there too.
	 *
	 * The rule speaks through slash tokens. Remove the slash, or the word, or the whole
	 * token, and there is nothing left for it to see: the composer dispatches nothing and
	 * the draft goes to the model as the operator's message. What this branch changes is
	 * the family's SIZE — the shapes where a slash token survives (an edit in front of it,
	 * inside the word, immediately after it) are all closed — and what it must not do is
	 * claim the class. This test exists so the claim and the behaviour stay in the same
	 * file, and so a later change to either one has to face the other.
	 */
	const CANARY = "LOP_R6_REMOVED_SLASH_CANARY_5d2c";
	const deletions = [
		["the slash deleted", 8, 1],
		["the word deleted", 8, 11],
		["the whole token deleted", 8, 12],
	];
	for (const [label, caret, count] of deletions) {
		const ran = [];
		const frame = await mount({
			conversationId: `conv-r6-removed-${caret}-${count}`,
			paneHasSession: true,
			sessionStatus: { frontend: null },
			onSlashCommand: async (command) => {
				ran.push(command);
				return "consumed";
			},
		});
		await type(frame, "please /credential ");
		await type(frame, CANARY);
		await esc(frame);
		await placeCaret(frame, caret);
		for (let i = 0; i < count; i++) await key(frame, { key: "Backspace" });
		const draft = frame.value();
		assert.ok(
			draft.includes(CANARY) && !draft.includes("/credential"),
			`${label}: the box holds the characters with no locked word left`,
		);
		await enter(frame);
		await settle();
		assert.equal(
			ran.length,
			0,
			`${label}: nothing is dispatched — main's behaviour`,
		);
		assert.equal(frame.sent.length, 1, `${label}: the draft is sent`);
		assert.ok(
			JSON.stringify(frame.sent).includes(CANARY),
			`${label}: and the plaintext is what travels (this is the residual, not a claim)`,
		);
	}
});

test("a live run keeps the record's reach, including over a slash the operator wrote (code review round 6, MINOR 1)", async () => {
	/*
	 * THE WINDOW THE REVIEWER NAMED, pinned so it cannot widen without a test noticing:
	 * while the box still holds the characters the app put back, the record's word is handed
	 * to the planner, and the draft's first slash token is read as that word's run — so a
	 * path the operator writes *around* the restored characters is taken as the token.
	 *
	 * That is the documented cost of the mechanism and it is bounded the same way every
	 * other shape is: the characters are still in the box at the press, the tail goes to the
	 * dispatcher rather than the model, the receipt says what happened and the undo returns
	 * the words. The alternative is the leak this branch exists to close.
	 */
	const CANARY = "LOP_R6_WINDOW_CANARY_1b93";
	const ran = [];
	const frame = await mount({
		conversationId: "conv-r6-window",
		paneHasSession: true,
		sessionStatus: { frontend: null },
		onSlashCommand: async (command) => {
			ran.push(command);
			return "consumed";
		},
	});
	await type(frame, "/credential ");
	await type(frame, CANARY);
	await esc(frame);
	// The word is replaced with a path, so no locked word is left — only the run and a slash.
	await placeCaret(frame, 12);
	for (let i = 0; i < 11; i++) await key(frame, { key: "Backspace" });
	await placeCaret(frame, 0);
	await type(frame, "see src/button.tsx ");
	const draft = frame.value();
	assert.ok(
		draft.includes(CANARY),
		"the restored characters are still in the box",
	);
	assert.ok(
		!draft.includes("/credential"),
		"and no locked word is left to find",
	);
	await enter(frame);
	await settle();
	/*
	 * REWRITTEN BY UX ROUND 7's U27, and this is the residual rather than a window now.
	 *
	 * This shape deletes the WORD out of `/credential ` and leaves its `/` against the
	 * restored characters, so the draft is `see src/button.tsx /<the run>`: the run's left
	 * context is no longer the space the cancel put it in, which is exactly the condition
	 * U27 asks the bound to test (`standsAsToken`: start-or-whitespace on the left,
	 * end-or-whitespace on the right). A rule that still claimed this draft would claim
	 * `prod` inside `prod/staging` — the substring test U27 removed — so it is recorded
	 * instead of covered: the draft is prose and its bytes travel as a message, which is
	 * `main`'s behaviour for the same draft, measured here and stated in the body's
	 * residual list. What is NOT recorded is the shape the round-6 pin was written for: a
	 * live run whose own context survives is still the dispatcher's, and that is pinned by
	 * the paste cells and the escaped-shape tests above.
	 */
	assert.equal(
		ran.length,
		0,
		"the run's context was destroyed by the edit, so the draft is prose",
	);
	assert.equal(frame.sent.length, 1, "and it is sent");
	assert.ok(
		JSON.stringify(frame.sent).includes(CANARY),
		"including the characters — main's behaviour for this draft, recorded as a residual",
	);
});

test("a pasted credential run is the command, and a pasted sentence about a path is not (QA round 6, Q-1)", async () => {
	/*
	 * QA ROUND 6's BLOCKER, and the last provenance with no record. The typed capture arms
	 * for typing and the picker records its own write; a PASTED `/credential <secret>` had
	 * neither, so it sat in the box in the clear, `Esc` afterwards changed nothing, and one
	 * keystroke later the in-word forms reached a message record and a provider body —
	 * `main` sends them, and against this branch's own pre-round-5 head the shape was
	 * covered by a boundary relaxation that was then narrowed for the prose half.
	 *
	 * The fix is a record rather than a re-widening: the paste's own run is recorded at the
	 * paste, and its word is handed to the planner only while those bytes are still in the
	 * draft. A paste is not ambiguous the way a typed word is — a pasted `/credential
	 * <secret>` IS the command — which is why the same sentence ARRIVING BY PASTE with no
	 * tail, or after the pasted value has been cleared, is prose and sends in full.
	 */
	const CANARY = "LOP_R6_Q1_PASTE_CANARY_9b31";
	const pasted = `please /credential ${CANARY}`;
	const cells = [
		{
			label: "PP1, a character typed in front of the slash",
			edit: async (frame) => {
				await placeCaret(frame, 0);
				await type(frame, "x");
			},
			box: `x${pasted}`,
		},
		{
			label: "PP2, a character typed inside the word",
			edit: async (frame) => {
				await placeCaret(frame, pasted.indexOf("/credential") + 5);
				await type(frame, "x");
			},
			box: `please /credxential ${CANARY}`,
		},
		{ label: "PP3, the paste untouched", edit: async () => {}, box: pasted },
	];
	for (const { label, edit, box } of cells) {
		const ran = [];
		const frame = await mount({
			conversationId: `conv-q1-${label.slice(0, 3)}`,
			paneHasSession: true,
			sessionStatus: { frontend: null },
			onSlashCommand: async (command) => {
				ran.push(command);
				return "consumed";
			},
		});
		await writeValue(frame.textarea(), pasted, pasted.length);
		await paste(frame, pasted);
		await edit(frame);
		assert.equal(
			frame.value(),
			box,
			`${label}: the box is the shape under test`,
		);
		await enter(frame);
		await settle();
		assert.equal(ran.length, 1, `${label}: the run is the dispatcher's`);
		assert.equal(ran[0].name, "credential", `${label}: the word`);
		assert.equal(ran[0].args, CANARY, `${label}: the tail is its argument`);
		assert.equal(frame.sent.length, 0, `${label}: nothing is sent`);
		assert.ok(
			!JSON.stringify(frame.sent).includes(CANARY),
			`${label}: the secret travels in no message`,
		);
	}

	/*
	 * THE CONTROLS. A sentence ABOUT a path that arrives by paste is not credentialed —
	 * there is no tail to record — and a pasted value the operator has cleared no longer
	 * reaches anything. Without these two, the fix could be a re-widening wearing a new
	 * name, which is the outcome the manager asked to avoid by name.
	 */
	const controls = [
		{
			label: "a pasted sentence about a path",
			setup: async (frame) => {
				const sentence = "the docs/credential rotation policy is stale";
				await writeValue(frame.textarea(), sentence, sentence.length);
				await paste(frame, sentence);
			},
			box: "the docs/credential rotation policy is stale",
		},
		{
			label: "the pasted value cleared out of the box",
			setup: async (frame) => {
				await writeValue(frame.textarea(), pasted, pasted.length);
				await paste(frame, pasted);
				for (let i = 0; i < pasted.length; i++)
					await key(frame, { key: "Backspace" });
				await type(frame, "the docs/credential rotation policy is stale");
			},
			box: "the docs/credential rotation policy is stale",
		},
	];
	for (const { label, setup, box } of controls) {
		const ran = [];
		const frame = await mount({
			conversationId: `conv-q1-ctl-${label.length}`,
			paneHasSession: true,
			sessionStatus: { frontend: null },
			onSlashCommand: async (command) => {
				ran.push(command);
				return "consumed";
			},
		});
		await setup(frame);
		assert.equal(
			frame.value(),
			box,
			`${label}: the box is the shape under test`,
		);
		await enter(frame);
		await settle();
		assert.equal(ran.length, 0, `${label}: no command runs over a sentence`);
		assert.equal(frame.sent.length, 1, `${label}: the sentence is sent`);
		assert.ok(
			JSON.stringify(frame.sent).includes(box),
			`${label}: in full, byte for byte`,
		);
	}
});

test("a restored run is the command only as a token, not as a substring (UX round 7, U27)", async () => {
	/*
	 * UX ROUND 7's MAJOR. The bound was `draft.includes(restoredText)` — no position, no
	 * length, no word — so a SHORT restored value re-armed the exception on a sentence the
	 * operator wrote afterwards: `/credential prod` -> Escape -> wipe -> `the prod/staging
	 * split is stale` took the tail, truncated the sentence and opened a Credential dialog
	 * asking for a secret that never existed.
	 *
	 * The rule is now this codebase's own tokenizer rule, the one `CREDENTIAL_TOKEN` spells:
	 * start-or-whitespace on the left, end-or-whitespace on the right. `prod` inside
	 * `prod/staging` fails on the right — the `/` is not whitespace — while a restored run
	 * still standing where the cancel put it passes on both sides, which is the state every
	 * shape this branch closes is in at its press. The positive half is pinned by this
	 * branch's own escaped-shape tests; this is the negative half.
	 */
	const SHORT = "prod";
	const sentence = "the prod/staging split is stale";
	const ran = [];
	const frame = await mount({
		conversationId: "conv-u27-prod",
		paneHasSession: true,
		sessionStatus: { frontend: null },
		onSlashCommand: async (command) => {
			ran.push(command);
			return "consumed";
		},
	});
	await type(frame, "/credential ");
	await type(frame, SHORT);
	await esc(frame);
	const held = frame.value();
	assert.ok(held.includes(SHORT), "the app un-masked the characters");
	for (let i = 0; i < held.length; i++) await key(frame, { key: "Backspace" });
	assert.equal(frame.value(), "", "the box is cleared");
	await type(frame, sentence);
	await enter(frame);
	await settle();
	assert.equal(ran.length, 0, "no command runs over the operator's sentence");
	assert.equal(frame.sent.length, 1, "the sentence is sent");
	assert.ok(
		JSON.stringify(frame.sent).includes(sentence),
		"in full, byte for byte",
	);
});

/* ------------------------------------------------------------------ */
/* The layer, mounted on its own                                        */
/* ------------------------------------------------------------------ */

/*
 * THE DROP IS REPORTED AT THE COMMIT THAT REMOVES THE CONTROL (code review round 6, R6-1,
 * which names this row as the instrument that can actually see R5-1).
 *
 * WHY IT TAKES STUBBED RECTS, and why every other row in this file is blind to the state:
 * jsdom has no layout engine, so `getClientRects()` is empty and the layer measures nothing
 * - which is exactly why the round-4 guard could not be caught here either. With the rects
 * stubbed, the ORDERING becomes visible: the pre-fix guard asked `document.activeElement`
 * and `!held.isConnected` INSIDE the measure that produced the boxes, when the button React
 * is about to remove is still connected, so it never fired and focus went to `<body>`; the
 * head records the held control and reports from a layout effect keyed on the boxes, i.e.
 * after the commit that removes it. Reverting the layer to the round-4 guard fails this row.
 */
function stubRect(element, box) {
	const rect = {
		...box,
		right: box.left + box.width,
		bottom: box.top + box.height,
		x: box.left,
		y: box.top,
		toJSON: () => box,
	};
	element.getBoundingClientRect = () => rect;
	element.getClientRects = () => [rect];
	return element;
}

test("the layer reports the drop at the commit that removes the control it was standing on", async () => {
	const host = window.document.createElement("div");
	window.document.body.appendChild(host);
	const mirror = window.document.createElement("div");
	const field = window.document.createElement("textarea");
	const run = window.document.createElement("span");
	/*
	 * The span carries the PLAN INDEX of its own segment, which is the mirror's contract with
	 * this layer - `paintPlan` splits "deploy with [Credential #1, 19 chars]" into the prose and
	 * the marker, so the marker's run is index 1 and a chip is drawn for it alone.
	 */
	run.setAttribute("data-credential-run", "1");
	run.textContent = "[Credential #1, 19 chars]";
	mirror.appendChild(run);
	host.append(mirror, field);
	stubRect(mirror, { left: 0, top: 0, width: 400, height: 200 });
	stubRect(field, { left: 0, top: 0, width: 400, height: 100 });
	// The run starts INSIDE the frame, on a strip a chip is drawn for.
	stubRect(run, { left: 10, top: 80, width: 120, height: 17 });

	let dropped = 0;
	const layerRoot = createRoot(host);
	await act(async () => {
		layerRoot.render(
			h(CredentialChipLayer, {
				text: "deploy with [Credential #1, 19 chars]",
				payloads: new Map([
					[
						1,
						{
							index: 1,
							key: "LOP_SECRET_4CE3Y48G",
							value: "v",
							marker: "[Credential #1, 19 chars]",
						},
					],
				]),
				mirrorRef: { current: mirror },
				fieldRef: { current: field },
				// The control only exists while the composer is taking edits, which is
				// `onClear !== null` - the same predicate the `x` is offered under.
				onClear: () => {},
				onControlUnmounted: () => {
					dropped += 1;
				},
			}),
		);
	});
	const layer = host.querySelector("[data-credential-chips]");
	assert.ok(layer, "the layer draws a chip for a run inside the frame");
	const control = layer.querySelector("button");
	assert.ok(control, "and the chip carries its control");

	await act(async () => {
		control.focus();
	});
	assert.equal(
		window.document.activeElement,
		control,
		"the control holds focus",
	);

	/*
	 * THE RUN LEAVES THE FRAME, which is what the clip rule answers: the field's own scroll is
	 * the route in the app, and it is what this dispatch stands for.
	 */
	stubRect(run, { left: 10, top: 400, width: 120, height: 17 });
	await act(async () => {
		field.dispatchEvent(new window.Event("scroll"));
	});

	assert.equal(
		dropped,
		1,
		"the layer reported the drop at the commit that removed the focused control (R5-1)",
	);
	assert.equal(
		host.querySelector("[data-credential-chips]"),
		null,
		"and the chip is gone, so the state it reports is the state it left",
	);
	layerRoot.unmount();
	host.remove();
});

/* Hoisted like this file's other regexes (code review round 4, R4-8): the floor's own literal. */
const STRIP_FLOOR = /const CHIP_MIN_VISIBLE_STRIP_PX = (\d+);/;

/*
 * THE RIG'S COPY OF THE FLOOR IS PINNED TO THE LAYER'S (code review round 6, R6-6). The rig
 * re-declares `CHIP_MIN_VISIBLE_STRIP_PX` rather than importing it, so its failure message can
 * name the number it measured against - which means nothing ties the two literals together, and
 * raising the layer's floor would leave the rig asserting the weaker one silently, with the same
 * class of drift every round since 3 has been about. Read as text rather than imported: the rig
 * is a script main-process Node runs, and the layer is a renderer module this suite already
 * bundles.
 */
test("the geometry rig's strip floor is the layer's own number", async () => {
	const layer = await readFile(
		"src/renderer/src/features/chat/components/credential-chip-layer.tsx",
		"utf8",
	);
	const rig = await readFile("scripts/credential-chip-geometry.mjs", "utf8");
	const literal = (source) => STRIP_FLOOR.exec(source)?.[1] ?? null;
	assert.equal(
		literal(rig),
		literal(layer),
		"the rig asserts the layer's own strip floor: change one and the other has to move with it",
	);
});
