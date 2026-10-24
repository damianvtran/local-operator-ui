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
/*
 * The server-down switch for the offline case: when true, the `/health` fetch
 * rejects, which is how the connectivity gate (and the app's banner) learns
 * the server is offline. Reset by the case that sets it.
 */
let healthFails = false;

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
	if (healthFails && String(url).includes("/health")) {
		throw new Error("rig: the server is down");
	}
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
			export { MessageInput } from "./src/renderer/src/shared/components/composer/message-input.tsx";
			export { useRadientCredentialProbe } from "./src/renderer/src/shared/hooks/use-credentials";
			export { CredentialChipLayer } from "./src/renderer/src/features/chat/components/credential-chip-layer.tsx";
			export { CHAT_MEASURE } from "./src/renderer/src/features/chat/chat-measure";
			export { QueryClient, QueryClientProvider } from "@tanstack/react-query";
			export { useConversationInputStore } from "./src/renderer/src/shared/store/conversation-input-store";
			export { ASK_ITEM_SELECTOR } from "./src/renderer/src/features/chat/ask-queue";
			export { t } from "@shared/i18n";
			export {
				CREDENTIAL_ARMED_NOTICE,
				CREDENTIAL_EMPTY_SPAN_DRAFT_NOTICE,
				CREDENTIAL_EMPTY_SPAN_NOTICE,
				CREDENTIAL_KEY_ALPHABET,
				CREDENTIAL_TYPING_NOTICE,
				CREDENTIAL_DISCARDED_NOTICE,
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
	useRadientCredentialProbe,
	CREDENTIAL_ARMED_NOTICE,
	CREDENTIAL_EMPTY_SPAN_DRAFT_NOTICE,
	CREDENTIAL_EMPTY_SPAN_NOTICE,
	CREDENTIAL_KEY_ALPHABET,
	CREDENTIAL_TYPING_NOTICE,
	CREDENTIAL_DISCARDED_NOTICE,
	MASK_CELL,
	unredactedNotice,
	ASK_ITEM_SELECTOR,
	t,
} = await import(bundlePath.href);
await unlink(bundlePath);

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = React;
const h = React.createElement;

/**
 * The probe HOST, as the chat renders it. Since the composer's lift the probe is
 * the host's read (`recordingProbe` on the props) and the composer asks nothing
 * itself; `chat-content.tsx` supplies the shipped hook's answer. The mic cases
 * below mount through this host so they drive the same wiring, and the reading
 * is published for waits.
 */
const MicProbeHost = ({ baseProps }) => {
	const recordingProbe = useRadientCredentialProbe();
	globalThis.__composerProbe = recordingProbe;
	return h(MessageInput, { ...baseProps, recordingProbe });
};

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
	 * The credential-store seam the lift moved OUT of the composer: the callback
	 * the host supplies in place of the composer's own `useQueryClient()`
	 * invalidation (see the Q-5 case below, which uses it to pin that the seam
	 * fires and that the host's invalidation reaches the picker's key). Forwarded
	 * verbatim; a case that passes none is a host with no cache, which is a legal
	 * host.
	 */
	onCredentialsStored,
	/*
	 * The SECRET-GATE arm, as a prop: the page passes `true` exactly while a
	 * `secret` ask waits (`chat-content.tsx` reads it off the pending gate), and
	 * the composer must then refuse the credential — no keystrokes, no draft, no
	 * recall entry, nothing on the answer wire from this box. Mounted here the
	 * way the other refusal arms are, because this is the only place that mounts
	 * the shipped component without a page deciding them.
	 */
	secretAnswer = false,
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
	 * Whether a post-paint failure's `Send again` / `Edit` controls are on screen in
	 * this pane's transcript (UX round 1, U3). The real host computes it once
	 * (`ChatContent`'s `undeliveredOnScreen`); here it is a prop so the two states
	 * - a line on screen and an ordinary draft - are both reachable.
	 */
	deliveryRemediesReachable = false,
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
	/*
	 * The probe the lifted composer expects from its host. A case that needs the
	 * voice-input gate live mounts through `MicProbeHost`, which supplies the
	 * shipped `useRadientCredentialProbe()` reading the way `chat-content.tsx`
	 * does; the default host supplies none, the mini-view-shaped host whose
	 * absent probe reads as "no key".
	 */
	withRecordingProbe = false,
	/*
	 * THE QUEUED SECRET ASK'S PROP (the operator's ask, `a-9e0c`). A mount that
	 * passes it is the state a real page is in while a secret question waits in
	 * the asks panel: the box is NOT refused (`secretAnswer` above is the blocking
	 * gate, a different state), a notice says where the value goes, and a
	 * password-shaped send opens the confirm.
	 */
	secretAsk = null,
	/*
	 * The composer's imperative handle, when a case needs a door that is not a
	 * control: the failed-send Retry calls `submitNow()`, which the page reaches
	 * through `messageInputRef`. Handed in rather than kept by the rig so a case
	 * that does not ask for it mounts exactly what the page mounts.
	 */
	composerRef = null,
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
	const composerProps = {
		isLoading,
		messages,
		conversationId,
		sessionStatus,
		unavailable,
		secretAnswer,
		secretAsk,
		currentJobId,
		deliveryRemediesReachable,
		onSendMessage: async (...args) => {
			sent.push(args);
			return onSendMessage ? onSendMessage(...args) : true;
		},
		onSlashCommand,
		onSlashNote: (text) => {
			notes.push(text);
			onSlashNote?.(text);
		},
		onCredentialsStored,
		paneHasSession,
	};
	await act(async () => {
		root.render(
			h(
				QueryClientProvider,
				{ client },
				withRecordingProbe
					? h(MicProbeHost, { baseProps: composerProps })
					: h(MessageInput, { ...composerProps, ref: composerRef }),
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
/*
 * An arrow press that reports whether the composer CLAIMED it.
 *
 * `key` above is silent about that, and #673's whole point is which keys a
 * recall captures: on a draft the arrow must stay the textarea's own, so this
 * rig reads the one fact a value assertion cannot see. jsdom implements no
 * native navigation, so "not claimed" is the composer DELEGATING the movement,
 * not the movement itself — what a real caret does with it is the browser's own
 * behaviour, exercised by QA.
 */
const arrowKey = async (frame, name) => {
	const field = frame.textarea();
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

test("ArrowUp on a live capture never replaces the buffer, and the capture survives", async () => {
	/*
	 * ISSUE #673 FLIPPED THIS TEST. Its round-10 finding was that a history
	 * recall REPLACED the whole buffer while a masked capture was live — the
	 * capture was dropped with the buffer and the recalled prompt was what
	 * survived. The recall cannot fire here any more: a capture is a non-empty
	 * draft, and the engagement rule (issue #673) leaves the arrow to the
	 * textarea in exactly that state, so the replacement this test used to
	 * drive is now IMPOSSIBLE through this door. What it pins instead is the
	 * new contract, which is the half a user feels: the arrow is not captured
	 * (`arrowKey`), the captured buffer is intact, and the NEXT keystroke is
	 * still masked rather than plain text.
	 *
	 * The whole-buffer-replacement teardown itself keeps its coverage where a
	 * replacement is still reachable — `a conversation switch ends a live
	 * capture` below drives the same effect through an external writer.
	 */
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
	const masked = (text) => `/credential ${"•".repeat(text.length)}`;
	assert.equal(frame.value(), masked("hunter2"));

	assert.equal(
		await arrowKey(frame, "ArrowUp"),
		false,
		"the arrow stays the textarea's — a capture is not a recall gesture",
	);

	// The captured buffer is intact, the capture is still live, and the next
	// keystroke is a mask cell rather than plain text.
	assert.equal(frame.value(), masked("hunter2"));
	assert.match(frame.notice(), /masked as you type/);
	await type(frame, "!");
	assert.equal(frame.value(), masked("hunter2!"));
	assert.match(frame.notice(), /masked as you type/);
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

/* ------------------------------------------------------------------ */
/* The history walk's engagement (issue #673)                          */
/* ------------------------------------------------------------------ */

/*
 * THE OLD GATE WAS THE CARET'S LINE, NOT THE BOX'S CONTENT. Any caret on line 1
 * mid-draft took the recall branch: `preventDefault` ate the native move, the
 * draft was swapped for a recalled message, and recovering the sentence meant a
 * full walk round trip — the misfire that reads as data loss.
 *
 * The composer this file mounts is the only one in the tree, so the rule's
 * BEHAVIOUR is driven here: which handler claims the arrow, what the box holds
 * afterwards and whether the persisted draft survived are React-state facts
 * with no DOM-free substitute. The rule itself is asserted pure in
 * `scripts/composer-seeding.test.mjs`.
 */

test("an empty composer recalls, walks, and ArrowDown restores past the newest", async () => {
	const frame = await mount();
	const store = useConversationInputStore.getState();
	store.addSubmittedMessage(frame.conversationId, "the older entry");
	store.addSubmittedMessage(frame.conversationId, "the newer entry");
	await settle();

	assert.equal(
		await arrowKey(frame, "ArrowUp"),
		true,
		"the recall captures the arrow",
	);
	assert.equal(
		frame.value(),
		"the newer entry",
		"the newest entry recalls first",
	);
	assert.equal(await arrowKey(frame, "ArrowUp"), true);
	assert.equal(
		frame.value(),
		"the older entry",
		"and the walk reaches older ones",
	);
	assert.equal(await arrowKey(frame, "ArrowDown"), true);
	assert.equal(
		frame.value(),
		"the newer entry",
		"ArrowDown returns down the walk",
	);
	assert.equal(await arrowKey(frame, "ArrowDown"), true);
	assert.equal(frame.value(), "", "and past the newest restores the draft");
	await arrowKey(frame, "ArrowDown");
	assert.equal(
		frame.value(),
		"",
		"further downs are a no-op, not a corruption",
	);
});

test("a single-line draft at column 0 is never recalled over", async () => {
	const frame = await mount();
	useConversationInputStore
		.getState()
		.addSubmittedMessage(frame.conversationId, "the sent entry");
	await settle();
	await type(frame, "draft");
	// The caret position the old first-line gate misfired on, at its loudest:
	// column 0 of the only line, with the draft the user is editing.
	await placeCaret(frame, 0);

	assert.equal(
		await arrowKey(frame, "ArrowUp"),
		false,
		"the arrow stays the textarea's",
	);
	assert.equal(frame.value(), "draft", "the draft is not swapped for a recall");
	assert.equal(
		frame.draft(),
		"draft",
		"and the persisted draft is not stash-swapped either",
	);
});

test("a multi-line draft is never recalled over, caret on line 1 included", async () => {
	const frame = await mount();
	useConversationInputStore
		.getState()
		.addSubmittedMessage(frame.conversationId, "the sent entry");
	await settle();
	await type(frame, "one\ntwo");
	// The exact misfire of #673 — the caret on the draft's FIRST line, where
	// `line === 1` took the recall branch — plus a caret on line 2, so the
	// "anywhere" in the issue is exercised at both ends.
	for (const at of [0, 1, 4]) {
		await placeCaret(frame, at);
		assert.equal(
			await arrowKey(frame, "ArrowUp"),
			false,
			`a draft caret at offset ${at} does not capture the arrow`,
		);
		assert.equal(frame.value(), "one\ntwo", `draft intact with caret at ${at}`);
	}
	assert.equal(frame.draft(), "one\ntwo");
});

/* ------------------------------------------------------------------ */
/* The ArrowDown swallow (issue #764)                                  */
/* ------------------------------------------------------------------ */

/*
 * THE LAST-LINE GUARD COUNTS LOGICAL LINES; THE DEFECT LIVED IN VISUAL ONES.
 * `isCursorAtLastLine()` is `line === totalLines` over `\n` counts, so a
 * single-paragraph draft reports "last line" at EVERY caret position — and the
 * ArrowDown arm ran `preventDefault` unconditionally inside that guard while
 * its recall walk only runs once a recall is engaged (`historyIndex !== null`).
 * With none engaged the key was eaten doing nothing: ArrowDown could not
 * traverse a wrapped draft's visual rows, the report's central repro. The fix
 * is the mirror of #673's rule — the arm captures only the walk it can serve,
 * handing the key back BEFORE `preventDefault` when no recall is engaged.
 *
 * jsdom has no layout engine, so the WRAP itself is not reachable here; these
 * cases drive the state the wrap collapses to in the guard's arithmetic (one
 * logical line, "last" at any caret) and read the one fact a value assertion
 * cannot see — whether the composer claimed the key ("not claimed" is the
 * composer DELEGATING the move, per `arrowKey` above). The byte shape of the
 * defect is pinned in `scripts/composer-seeding.test.mjs`.
 */

test("ArrowDown on a draft with no recall engaged is never claimed (issue #764)", async () => {
	const frame = await mount();
	useConversationInputStore
		.getState()
		.addSubmittedMessage(frame.conversationId, "the sent entry");
	await settle();
	const draftText = "a draft that would wrap";
	await type(frame, draftText);
	/*
	 * At EVERY caret position: `line === totalLines` is true wherever the caret
	 * sits on a single-paragraph draft, which is the reproduction's "the guard
	 * fires everywhere" — and the swallowed key with it.
	 */
	for (const at of [0, 6, draftText.length]) {
		await placeCaret(frame, at);
		assert.equal(
			await arrowKey(frame, "ArrowDown"),
			false,
			`the arrow stays the textarea's with the caret at ${at}`,
		);
		assert.equal(
			frame.value(),
			draftText,
			`the draft is intact with the caret at ${at}`,
		);
	}
	assert.equal(
		frame.draft(),
		draftText,
		"and the persisted draft is untouched",
	);
});

test("with the recall engaged, ArrowDown still walks and is claimed (issue #764)", async () => {
	const frame = await mount();
	const store = useConversationInputStore.getState();
	store.addSubmittedMessage(frame.conversationId, "the older entry");
	store.addSubmittedMessage(frame.conversationId, "the newer entry");
	await settle();
	assert.equal(await arrowKey(frame, "ArrowUp"), true);
	assert.equal(await arrowKey(frame, "ArrowUp"), true);
	assert.equal(
		frame.value(),
		"the older entry",
		"the walk reached the older entry",
	);
	/*
	 * THE BOX HOLDS RECALLED TEXT AND MUST STILL WALK. That is the state where
	 * a guard reading the CONTENT — `historyRecallEngages` says a non-empty box
	 * never engages — would block the very walk it exists to protect; the fix
	 * keys the capture on the walk's own state instead.
	 */
	assert.equal(
		await arrowKey(frame, "ArrowDown"),
		true,
		"the engaged walk still claims the arrow",
	);
	assert.equal(frame.value(), "the newer entry", "and steps back down");
	assert.equal(await arrowKey(frame, "ArrowDown"), true);
	assert.equal(frame.value(), "", "past the newest restores the stashed draft");
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
	let inFlight = 0;
	let peakInFlight = 0;
	/*
	 * THE DISCRIMINATOR IS THE OVERLAP, NOT THE CLOCK (code review round 2, R2-n1).
	 * The case used to assert a wall-clock ceiling, which is a proxy that can go red
	 * on a loaded box — this host runs ~25 sessions. What the fix actually promises
	 * is that the cited credentials resolve AT THE SAME TIME, so the instrument is a
	 * counter of ops in flight at once: `Promise.all` issues both first attempts in
	 * one tick, so a concurrent resolution peaks at 2 and a serial one can only ever
	 * reach 1. `tracked` wraps each op's promise and decrements on either outcome.
	 */
	const tracked = (promise) => {
		inFlight += 1;
		peakInFlight = Math.max(peakInFlight, inFlight);
		const settledOne = () => {
			inFlight -= 1;
		};
		return promise.then(
			(value) => {
				settledOne();
				return value;
			},
			(error) => {
				settledOne();
				throw error;
			},
		);
	};
	/*
	 * THE INSTRUMENT IS CHECKED BEFORE IT IS TRUSTED: two ops issued one after the
	 * other must peak at ONE, so the assertion at the end is about the seam's own
	 * behaviour rather than about a counter that reads 2 for anything. It runs FIRST
	 * because the seam's hanging list reads never settle — run afterwards, the
	 * control would be measuring their residue rather than a sequential pair.
	 */
	{
		const control = peakInFlight;
		await tracked(Promise.resolve("first"));
		await tracked(Promise.resolve("second"));
		assert.equal(
			peakInFlight,
			1,
			"the in-flight counter reads a SEQUENTIAL pair as one, so it can tell the two apart",
		);
		peakInFlight = control;
	}
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
			return tracked(Promise.reject(new Error("socket closed")));
		if (request.action === "list") return tracked(new Promise(() => {}));
		return undefined;
	};
	await openCapture(frame);
	await paste(frame, "FIRST-SILENT-SECRET");
	await type(frame, "/credential ");
	await paste(frame, "SECOND-SILENT-SECRET");
	await clickSend(frame);
	await pageSent;
	if (settled) rendered = await settled;
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
	assert.ok(
		peakInFlight >= 2,
		`two cited credentials never overlapped (peak ${peakInFlight} in flight): the resolution is serial again`,
	);
});

test("a refusal after a SILENT attempt is not a refusal: the citation stays unconfirmed", async () => {
	/*
	 * CODE REVIEW ROUND 2's R2-m1, and the one row of the decision table the shipped
	 * code did not agree with. `withTimeout` clears its timer but does NOT cancel the
	 * request it wrapped, so a silent first attempt leaves a write that can still be
	 * in flight — or land — after anything read afterwards. So the re-issue's 4xx
	 * (which is also the status the route raises for the owner's own `disconnected`
	 * answer to a write it applied) plus a name list that does not carry the key
	 * proves nothing: the refusal citation needs an ANSWER and nothing outstanding.
	 *
	 * The round-1 code returned the refusal here. The TABLE was right and the code
	 * was wrong, which is the opposite of what a documentation-only fix assumes.
	 */
	let stores = 0;
	const rendered = await sendFirstMessage("SILENT-THEN-REFUSED", (request) => {
		if (request.op !== "sessions.credential") return undefined;
		if (request.action === "store") {
			stores += 1;
			// The first attempt is destroyed with nothing forwarded; the RE-ISSUE is
			// answered with the route's refusal while the first may still be out there.
			if (stores === 1) return Promise.reject(new Error("socket closed"));
			return transportSays(409, {
				detail: {
					code: "store_failed",
					message: "The credential operation did not complete.",
				},
			});
		}
		if (request.action === "list")
			return credentialResult({ data: { ok: true, credentials: [] } });
		return undefined;
	});

	assert.equal(opCount("store"), 2, "the silence is re-issued");
	assert.equal(opCount("list"), 1);
	assert.ok(
		!rendered.includes("NOT stored"),
		`a refusal after a silence was published as an outcome: ${rendered}`,
	);
	assert.match(
		rendered,
		/\[credential unconfirmed — it may be held as \$LOP_SECRET_[A-Z2-9]{8}, so check list_variables before assuming it is missing\]/,
	);
});

test("a list answer with nothing readable in it is unreadable, not an absence", async () => {
	/*
	 * CODE REVIEW ROUND 2's R2-m2, which is MAJOR-1's class one layer down:
	 * `credentialNamesFrom` is deliberately total (it returns `[]` for a body it
	 * cannot parse), so reading the answer through it alone made "a list that does
	 * not name the key" and "a list I could not read" the same `false` — and a
	 * `false` after an ANSWERED refusal is what confirms the not-stored citation.
	 *
	 * Both shapes below are 2xx answers that carry no name list, and neither is an
	 * absence: the seam may not claim the write failed on the strength of either.
	 */
	for (const [what, answer] of [
		["a 2xx with no credentials array", { data: { ok: true } }],
		[
			"a 2xx whose own answer is not ok",
			{ data: { ok: false, reason: "disconnected" } },
		],
	]) {
		const rendered = await sendFirstMessage("BLIND-LIST-SECRET", (request) => {
			if (request.op !== "sessions.credential") return undefined;
			if (request.action === "store")
				return transportSays(409, {
					detail: { code: "store_failed", message: "Did not complete." },
				});
			if (request.action === "list") return credentialResult(answer);
			return undefined;
		});
		assert.equal(opCount("list"), 1, what);
		assert.ok(
			!rendered.includes("NOT stored"),
			`${what}: an unreadable list was read as an absence: ${rendered}`,
		);
		assert.match(
			rendered,
			/\[credential unconfirmed — it may be held as \$LOP_SECRET_[A-Z2-9]{8}, so check list_variables before assuming it is missing\]/,
			what,
		);
	}
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

/*
 * RETIRED WITH THE ESC UNREDACT (operator-approved fix, 2026-10-22).
 *
 * The cases that stood here all took the same state as their SETUP: `/credential <secret>`
 * + Esc, which wrote the characters back into the box as prose. That state no longer exists
 * — the first Esc holds the mask, the second discards (see the "ESC NEVER PUTS A TYPED
 * SECRET IN THE DOCUMENT" cases) — so each could only pass by reconstructing the leak the
 * fix closes. What they pinned about the EMPTY-span cancel (the inert token, the caret, the
 * no-re-arm rule) is still pinned by the empty-span cases above, which a discard now
 * reaches as well. The held-press / restored-run machinery these exercised was keyed on
 * a cancel record with restored characters, which no cancel produces any more, so it was
 * unreachable and has been deleted (agent review round 1, R1-2). Retired, by name:
 * - a cancel that EXPOSED characters is HELD on Enter, never sent and never an argument (operator requirement)
 * - an Esc-cancelled credential's words are never taken as the command's argument (operator requirement)
 * - an edit retires the disclosure, and the draft never carries a count it does not describe
 * - the cancel's own record decides: an EMPTY span leaves prose, a span with characters does not
 * - a retired count cannot ride a minted marker, across the mint and a reload
 * - a real keystroke that moves a cancelled token hands it to the dispatcher (Q16)
 * - the Escape's door is closed one keystroke later, at every caret (QA round 2, Q-1)
 * - the unredact notice says what Enter will actually do (UX round 2, U7)
 * - the undo announces the real characters it hands back, and a held press arms none (code review round 3, MAJOR 1; operator requirement)
 * - a character typed in front of the cancelled token does not hand it to the model (QA round 4, Q-1)
 * - a word an edit has broken does not hand the run to the model (QA round 5, Q-1)
 * - a draft that no longer holds the run is prose, however much history the pane has (UX round 6, U24)
 * - an edit that removes the slash sends the plaintext, and that is main's behaviour (code review round 6, MAJOR 1)
 * - a live run keeps the record's reach, including over a slash the operator wrote (code review round 6, MINOR 1)
 * - a restored run is the command only as a token, not as a substring (UX round 7, U27)
 * - the held line is not claimed on the reload shape, where Enter really dispatches
 * - a fresh hold after the notice's own remedy raises its own sentence
 */

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
		"masked as you type — Enter makes a pill, Esc twice discards",
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
 * THE WAY BACK TO A FAILED MESSAGE'S CONTROLS (UX round 1, U3). The controls
 * live in the transcript ABOVE the box, which precedes the composer in DOM
 * order: a keyboard reader in the box reaches them with Shift+Tab and nothing on
 * screen says so. The hint is attached the way the mention notice is - a
 * described-by element that exists only while the line it speaks about is on
 * screen - so an ordinary draft is not described by an empty element and the
 * sentence cannot outlive the row.
 */
test("the composer names the failed row's controls only while the row is on screen", async () => {
	const idle = await mount({ conversationId: "conv-delivery-hint-idle" });
	assert.equal(
		idle.textarea().getAttribute("aria-describedby"),
		null,
		"an ordinary draft is not described by the delivery hint",
	);
	assert.equal(
		window.document.getElementById("composer-delivery-remedies-hint"),
		null,
		"nor is the element rendered while there is no line to point at",
	);
	const frame = await mount({
		conversationId: "conv-delivery-hint",
		deliveryRemediesReachable: true,
	});
	assert.ok(
		(frame.textarea().getAttribute("aria-describedby") ?? "").includes(
			"composer-delivery-remedies-hint",
		),
		"while a delivery row exists the box names the hint",
	);
	const hint = window.document.getElementById(
		"composer-delivery-remedies-hint",
	);
	assert.ok(hint, "and the hint element is in the document");
	assert.match(
		hint.textContent ?? "",
		/Shift\+Tab/,
		"its sentence says the one thing the round measured as missing: how to reach them",
	);
});

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

test("a draft persisted by the pre-fix unredact still discloses its characters on arrival", async () => {
	/*
	 * Design round 2's D2, kept for the drafts that already exist. Before the
	 * 2026-10-22 fix an Esc wrote the characters back as prose and persisted
	 * `unredactedChars` beside them; no Esc writes either any more, but a draft saved
	 * by an older build is still on disk and must not come back silent. Seeded
	 * through the store's own writer rather than through the retired gesture.
	 */
	const id = "conv-disclose-legacy";
	await act(async () => {
		useConversationInputStore
			.getState()
			.setCurrentInput(id, "deploy with /credential [redacted]", 19);
	});
	const reloaded = await mount({
		conversationId: id,
		keepWorld: true,
		remount: true,
	});
	assert.equal(reloaded.value(), "deploy with /credential [redacted]");
	assert.equal(
		reloaded.notice(),
		unredactedNotice(19),
		"a restored draft with no live record says what its Enter really does",
	);
});

/*
 * ESC NEVER PUTS A TYPED SECRET IN THE DOCUMENT (operator-approved fix, 2026-10-22).
 *
 * The audit's finding: Esc used to unredact the held characters into the textarea as
 * prose, and `persistDraft` then wrote that prose to `localStorage` — so a credential
 * the operator CANCELLED sat in plaintext in the draft store. The required behaviour is
 * neither "restore plaintext" nor "discard": the first Esc leaves the masked capture
 * exactly as it was (cells in the box, value in memory, nothing written), and a second
 * Esc discards it. Every assertion below reads the store the app actually writes and
 * the box the operator actually sees, with a value no reader could mistake for a real
 * secret.
 */
const DUMMY_SECRET = "dummy-not-a-secret-123";
const HELD_NOTICE = /^Esc again discards it — still masked/;

const persistedRaw = () =>
	window.localStorage.getItem("conversation-input-store") ?? "";

test("Esc during capture keeps the mask and the value, and writes no plaintext to the draft", async () => {
	const frame = await mount({ conversationId: "conv-esc-masked" });
	await openCapture(frame, { prose: "deploy with " });
	await type(frame, DUMMY_SECRET);
	const masked = frame.value();
	assert.equal(
		masked,
		`deploy with /credential ${MASK_CELL.repeat(DUMMY_SECRET.length)}`,
	);

	await esc(frame);
	assert.equal(
		frame.value(),
		masked,
		"the box still holds the mask cells, not the characters",
	);
	assert.ok(
		!persistedRaw().includes(DUMMY_SECRET),
		"no plaintext reached the persisted draft store",
	);
	assert.ok(
		!(frame.draft() ?? "").includes(DUMMY_SECRET),
		"and the conversation's own draft holds none either",
	);
	assert.match(
		frame.notice(),
		HELD_NOTICE,
		"the notice says the capture is still held and what the next Esc does",
	);

	// The value is still in memory: Enter mints a pill of the full held length.
	await enter(frame);
	assert.equal(
		frame.value(),
		`deploy with [Credential #1, ${DUMMY_SECRET.length} chars] `,
		"the held value survived the Esc and minted",
	);
	assert.ok(!persistedRaw().includes(DUMMY_SECRET));
});

test("a second Esc discards the capture, and no Esc path leaves plaintext anywhere", async () => {
	const frame = await mount({ conversationId: "conv-esc-discard" });
	await openCapture(frame, { prose: "deploy with " });
	await type(frame, DUMMY_SECRET);
	await esc(frame);
	await esc(frame);
	assert.equal(
		frame.value(),
		"deploy with /credential ",
		"the cells are gone and the token is left inert, as an empty-span cancel leaves it",
	);
	assert.doesNotMatch(frame.notice(), HELD_NOTICE, "the capture is over");
	assert.ok(!persistedRaw().includes(DUMMY_SECRET));
	assert.equal(
		frame.disclosure() ?? 0,
		0,
		"nothing was disclosed, so the draft carries no count",
	);

	// The undo stack: the composer's own undo key hands nothing back that was secret.
	await undoKey(frame);
	assert.ok(
		!frame.value().includes(DUMMY_SECRET),
		"undo restores no plaintext",
	);
	assert.ok(!persistedRaw().includes(DUMMY_SECRET));

	// The discarded value is gone, not merely hidden: a fresh span mints nothing of it.
	await type(frame, "x");
	assert.ok(!frame.value().includes(MASK_CELL));
	assert.ok(!persistedRaw().includes(DUMMY_SECRET));
});

test("an edit between the two Escapes re-arms the hold rather than discarding", async () => {
	const frame = await mount({ conversationId: "conv-esc-edit" });
	await openCapture(frame);
	await type(frame, DUMMY_SECRET);
	await esc(frame);
	await type(frame, "4");
	assert.equal(frame.notice(), CREDENTIAL_TYPING_NOTICE, "typing resumed");
	await esc(frame);
	assert.equal(
		frame.value(),
		`/credential ${MASK_CELL.repeat(DUMMY_SECRET.length + 1)}`,
		"one Esc after an edit holds again; it does not discard",
	);
	assert.ok(!persistedRaw().includes(DUMMY_SECRET));
});

test("after a discard, the words typed past the inert token are the operator's sentence, as after an empty-span cancel (U9)", async () => {
	/*
	 * Round 2's U9 reading, kept: an Esc-cancelled token is inert, so what the operator
	 * writes after it is their own prose and goes to the model rather than becoming the
	 * command's argument. A discard now leaves exactly the empty-span shape, so the span
	 * that HELD characters must answer the same way — and the discarded value must be in
	 * no message, which is the half the retired held-press cases used to guard.
	 */
	for (const held of ["", DUMMY_SECRET]) {
		const dispatch = [];
		const frame = await mount({
			onSlashCommand: async (command) => {
				dispatch.push(command);
				return "consumed";
			},
		});
		await type(frame, "deploy with /credential ");
		if (held) {
			await type(frame, held);
			await esc(frame);
		}
		await esc(frame);
		await type(frame, "mysecretname");
		assert.equal(frame.value(), "deploy with /credential mysecretname");
		await enter(frame);
		await settle();
		assert.deepEqual(dispatch, [], `nothing dispatched (held: ${held !== ""})`);
		const sent = frame.sent.at(-1)?.[0];
		assert.equal(
			typeof sent === "string" ? sent : sent?.text,
			"deploy with /credential mysecretname",
			"their own sentence is what goes to the model",
		);
		assert.ok(!JSON.stringify(frame.sent).includes(DUMMY_SECRET));
		assert.ok(!persistedRaw().includes(DUMMY_SECRET));
	}
});

test("a hold ends with its capture: a later identical capture is not pre-held (agent review round 1, R1-1)", async () => {
	/*
	 * The hold is keyed on (buffer, value). Left standing after the mint, a second
	 * capture that reached the same buffer and value lit the held sentence before
	 * any Esc, and its FIRST Esc then discarded with no warning (reproduced by the
	 * round-1 reviewer). The hold must end wherever the capture leaves typing.
	 */
	const frame = await mount({ conversationId: "conv-esc-stale" });
	await openCapture(frame);
	await type(frame, DUMMY_SECRET);
	await esc(frame);
	assert.match(frame.notice(), HELD_NOTICE);
	await enter(frame);
	assert.equal(frame.value(), `[Credential #1, ${DUMMY_SECRET.length} chars] `);
	// Clear the box and re-enter the same secret in the same shape.
	await act(async () => {
		writeValue(frame.textarea(), "", 0);
	});
	await settle();
	await openCapture(frame);
	await type(frame, DUMMY_SECRET);
	assert.equal(
		frame.notice(),
		CREDENTIAL_TYPING_NOTICE,
		"a fresh capture opens in the typing state, not pre-held",
	);
	await esc(frame);
	assert.equal(
		frame.value(),
		`/credential ${MASK_CELL.repeat(DUMMY_SECRET.length)}`,
		"its first Esc holds rather than discards",
	);
	assert.match(frame.notice(), HELD_NOTICE);
});

test("the second Esc says the value was discarded, and the next edit retires the line (design review round 1, D2)", async () => {
	const frame = await mount({ conversationId: "conv-esc-discarded-line" });
	await openCapture(frame, { prose: "deploy with " });
	await type(frame, DUMMY_SECRET);
	await esc(frame);
	await esc(frame);
	assert.equal(frame.value(), "deploy with /credential ");
	assert.equal(frame.notice(), CREDENTIAL_DISCARDED_NOTICE);
	assert.ok(
		!frame.notice().includes(String(DUMMY_SECRET.length)),
		"the line names no length",
	);
	await type(frame, "x");
	assert.notEqual(
		frame.notice(),
		CREDENTIAL_DISCARDED_NOTICE,
		"an edit retires it",
	);
	// An EMPTY-span Esc discarded nothing, so it owes no such line.
	const empty = await mount({ conversationId: "conv-esc-empty-no-line" });
	await openCapture(empty);
	await esc(empty);
	assert.notEqual(empty.notice(), CREDENTIAL_DISCARDED_NOTICE);
});

test("leaving a held capture by switch or reload persists no plaintext", async () => {
	const frame = await mount({ conversationId: "conv-esc-leave" });
	await openCapture(frame, { prose: "deploy with " });
	await type(frame, DUMMY_SECRET);
	await esc(frame);
	// Blur: focus leaves the box with the capture held.
	await act(async () => {
		frame.textarea().blur();
	});
	await settle();
	assert.ok(!persistedRaw().includes(DUMMY_SECRET), "blur writes nothing");
	// A conversation switch, then back.
	await mount({ conversationId: "conv-esc-elsewhere", keepWorld: true });
	assert.ok(!persistedRaw().includes(DUMMY_SECRET), "a switch writes nothing");
	// A full reload of the original conversation.
	const reloaded = await mount({
		conversationId: "conv-esc-leave",
		keepWorld: true,
		remount: true,
	});
	assert.ok(!reloaded.value().includes(DUMMY_SECRET));
	assert.ok(!persistedRaw().includes(DUMMY_SECRET), "a reload finds none");
	// And unmounting the composer entirely.
	await act(async () => {
		root?.unmount();
	});
	root = undefined;
	assert.ok(!persistedRaw().includes(DUMMY_SECRET), "closing writes nothing");
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
 * THE EMPTY CHAT DOCKS THE COMPOSER, SO THE SENTENCE NEEDS NO MIRROR (§G2).
 *
 * The band used to centre one group - greeting, composer and chips - on an empty
 * chat, so a line added above the box moved the whole group by HALF the line
 * (measured at 1380: `textarea.y` 402.25 idle -> 416.00 armed), and an invisible
 * mirror of the sentence below the group paid it back (UX round 4, U16). The same
 * centring moved the composer on the first send (y393 -> y774 at 1380x900). The
 * band now docks the composer at its foot in every state and centres only the
 * splash above it, so a line above the box grows the band upward and the splash
 * yields: nothing needs cancelling.
 *
 * jsdom has no layout engine, so this pins the STRUCTURE the arithmetic rests on:
 * the form is inside the band's foot, the foot is the band's LAST child (so the
 * band's bottom anchor is the box's), the splash precedes it, and no aria-hidden
 * copy of the sentence exists on either pane. The live y-values are the driver's
 * `first-send` scene's.
 */
const hiddenCopyOf = () =>
	[...window.document.querySelectorAll("output")].find(
		(el) => el.getAttribute("aria-hidden") === "true",
	) ?? null;

test("on an empty chat the composer is docked at the band's foot, and the sentence is not mirrored", async () => {
	const empty = await mount({
		conversationId: "conv-docked",
		messages: [],
	});
	const band = window.document.querySelector("[data-lo-composer-band]");
	const foot = window.document.querySelector("[data-lo-composer-foot]");
	const splash = window.document.querySelector("[data-lo-composer-splash]");
	assert.ok(band && foot && splash, "the band carries a splash and a foot");
	assert.equal(
		band.lastElementChild,
		foot,
		"the foot is the band's last child, so the band's bottom anchor is the composer's",
	);
	assert.ok(
		splash.compareDocumentPosition(foot) &
			window.Node.DOCUMENT_POSITION_FOLLOWING,
		"the splash (greeting, chips, tip) sits above the docked composer",
	);
	assert.ok(foot.contains(empty.box()), "the composer box is inside the foot");
	assert.ok(
		!band.className.split(/\s+/).includes("justify-center"),
		"the band itself centres nothing: centring it is what moved the composer on the first send",
	);

	await openCapture(empty);
	await type(empty, "[redacted]");
	const notice = window.document.getElementById("composer-credential-notice");
	assert.ok(
		(notice.textContent ?? "").length > 0,
		"the sentence is up, which is the state the mirror used to exist for",
	);
	assert.equal(
		hiddenCopyOf(),
		null,
		"no aria-hidden copy of the sentence: the docked box does not move when a line arrives above it",
	);

	const populated = await mount({ conversationId: "conv-docked-populated" });
	await openCapture(populated);
	await type(populated, "[redacted]");
	assert.equal(
		window.document.querySelector("[data-lo-composer-band]").lastElementChild,
		window.document.querySelector("[data-lo-composer-foot]"),
		"a populated pane docks the composer the same way, which is why the first send cannot move it",
	);
	assert.equal(hiddenCopyOf(), null);
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
	// Two presses: the first is held (the mask stays), the second discards.
	await esc(frame);
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
	assert.equal(
		field.placeholder,
		t("ui.chat.composer.placeholder.unavailable"),
		"the gone conversation's sentence is the catalogue's",
	);

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

test("a store reaches the host's invalidation seam for the picker's list (QA round 1, Q-5)", async () => {
	/*
	 * QA's second note, which the manager folded into this round: the picker's list
	 * is a CACHED read (`staleTime` five minutes, `shared/api/query-client.ts`) and the
	 * store path did not invalidate it, so a picker mounted after an inline store
	 * rendered "No credentials stored yet." while the same route answered with the
	 * name that had just been stored — the row the user opened the dialog for, off its
	 * own screen.
	 *
	 * THE REPAIR IS THE HOST'S NOW (the shared-composer lift): the composer used to
	 * call `useQueryClient()` itself here, which made a provider a mount requirement
	 * for every document, so the store path reports through `onCredentialsStored` and
	 * the chat page invalidates the same `desktopKeys.credentials(sessionId)` key it
	 * always did. This case mounts the composer alone, so it supplies the chat's own
	 * wiring verbatim and asserts BOTH halves: the seam fired with the session the
	 * store landed on, and that host wiring marked the picker's key stale — a seam
	 * that passed the wrong id would leave the seeded key fresh and fail here.
	 *
	 * The seeded entry is the point of the test: `invalidateQueries` over a key with
	 * nothing cached marks nothing, so a rig that skipped the seed would pass on the
	 * broken code.
	 */
	const storedFor = [];
	const frame = await mount({
		conversationId: "conv-q5",
		sessionStatus: { frontend: null },
		onCredentialsStored: async (sessionId) => {
			storedFor.push(sessionId);
			await client.invalidateQueries({
				queryKey: ["desktop", "credentials", sessionId],
			});
		},
	});
	const listKey = ["desktop", "credentials", "conv-q5"];
	client.setQueryData(listKey, { data: { ok: true, credentials: [] } });
	assert.equal(
		client.getQueryState(listKey)?.isInvalidated,
		false,
		"the seeded list starts fresh",
	);

	await openCapture(frame, { prose: "store this for me " });
	await type(frame, "[redacted]");
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
	assert.deepEqual(
		storedFor,
		["conv-q5"],
		"the seam reported the session the store landed on, once",
	);
	assert.equal(
		client.getQueryState(listKey)?.isInvalidated,
		true,
		"and the host's wiring marked the picker's own list stale",
	);
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

test("a secret gate refuses the composer the way an unavailable one is refused, and points at the ask panel's masked field", async () => {
	/*
	 * THE SECRET ASK'S COMPOSER CLOSURE. While a `secret` ask waits, the answer
	 * is the dock's masked field (`trace/question-dock.tsx`) and this box must
	 * not be the credential's way in: a value typed here would be painted in
	 * clear, written through the persisted draft store on every keystroke, and
	 * — before this change — sent as the question's answer. Those are the three
	 * exposures the operator's request names, and this state closes the first
	 * two at the keystroke and the third at the door.
	 *
	 * The SHAPE of the refusal is the base's own, deliberately: `readOnly` (never
	 * `disabled` — the focus loss the unavailable arm records), `aria-disabled`,
	 * and the term inside the one predicate every writer and submitter already
	 * answers to. What is NEW is what the state CLAIMS: the placeholder names
	 * the card above, because "Agent is busy" over a parked question is false
	 * about the state and "This conversation is gone" is false about the pane.
	 *
	 * The half this file cannot prove, stated rather than implied: that a real
	 * browser's read-only field fires no `input` event (the rig MODELS that
	 * refusal in its own `key` helper, which is what makes the no-draft
	 * assertion below meaningful only in the rig's model), and that the implicit
	 * Enter submission from a live field reaches the form. Both are engine
	 * facts; QA drives the engine, and `composer-refusal.test.mjs` pins the
	 * source halves.
	 */
	const frame = await mount({ secretAnswer: true });
	const field = frame.textarea();
	assert.equal(field.readOnly, true);
	assert.equal(
		field.disabled,
		false,
		"`disabled` on the composer is the focus loss this base removed",
	);
	assert.equal(field.getAttribute("aria-disabled"), "true");
	assert.equal(
		field.placeholder,
		t("ui.chat.composer.placeholder.secret_answer"),
		"the empty refusal says where the answer goes",
	);
	assert.equal(
		field.getAttribute("aria-describedby"),
		null,
		"an empty refused box is described by nothing: the placeholder carries the short form",
	);
	assert.equal(
		document.getElementById("composer-secret-closure-notice"),
		null,
		"and the draft-case sentence exists only when there is a draft it can serve",
	);
	assert.equal(
		frame.button().disabled,
		true,
		"the Send control carries the refusal",
	);

	/* Typing takes nothing: the rig applies the browser's own read-only refusal. */
	await type(frame, "ghp_not_a_real_token");
	assert.equal(frame.value(), "", "a refused box takes no keystrokes");
	assert.equal(frame.draft(), undefined, "and no draft reaches the store");

	/* Enter takes nothing (the keydown guard), and the form seam refuses a
	   submit that a press or a script reaches without a keydown. */
	await enter(frame);
	const form = frame.box().closest("form");
	assert.ok(form, "the composer is a form");
	await act(async () => {
		form.requestSubmit();
	});
	await settle();
	assert.equal(frame.sent.length, 0, "nothing reaches the page's send door");
	assert.equal(
		calls.filter((call) => call.request?.op === "sessions.answer").length,
		0,
		"and nothing reaches the answer op",
	);
	assert.equal(
		useConversationInputStore.getState().inputByConversation[
			frame.conversationId
		]?.submittedMessages?.length ?? 0,
		0,
		"no recall entry is written from the refused path",
	);
});

test("a draft written before the question survives it, and is never sent as its answer", async () => {
	/*
	 * THE STATE ORDERING THAT MATTERS: a gate can arrive while the box already
	 * holds the user's own text. Both ways to get that wrong are pinned here —
	 * clearing the box (destroying words nothing about this feature owns) and
	 * sending it (the pre-change behaviour: ANY send while a gate was pending
	 * became the gate's answer, so a draft someone wrote before the question
	 * was asked would have been posted as the credential). The draft is HELD,
	 * the press is REFUSED, and neither the draft nor the recall log moves.
	 */
	const conversationId = "conv-secret-held-draft";
	const before = await mount({ conversationId });
	await type(before, "draft written before the question");
	assert.equal(before.draft(), "draft written before the question");

	const frame = await mount({
		conversationId,
		keepWorld: true,
		remount: true,
		secretAnswer: true,
	});
	assert.equal(
		frame.value(),
		"draft written before the question",
		"the draft is adopted into the refused box, not cleared",
	);
	await enter(frame);
	await settle();
	assert.equal(
		frame.sent.length,
		0,
		"the held draft is not sent as the question's answer",
	);
	assert.equal(
		calls.filter((call) => call.request?.op === "sessions.answer").length,
		0,
	);
	assert.equal(
		frame.value(),
		"draft written before the question",
		"a refused press does not clear the user's words",
	);
	assert.equal(
		frame.draft(),
		"draft written before the question",
		"on disk either",
	);
});

test("the closed box with a draft carries a visible reason (UX round 1, U2)", async () => {
	/*
	 * The closure's explanation was a PLACEHOLDER, and a placeholder paints only
	 * while the box is empty - so the reader most likely to need the reason (a box
	 * already holding their words) saw a dimmed box and no words at all. The
	 * sentence now renders in the composer's own register above the box, and the
	 * field is DESCRIBED by it while it renders (`aria-describedby`, the same
	 * wiring the missing-session notice uses for its pane sentence).
	 */
	const conversationId = "conv-secret-closure-sentence";
	const before = await mount({ conversationId });
	await type(before, "half-written note from before the question");
	assert.equal(before.draft(), "half-written note from before the question");

	const frame = await mount({
		conversationId,
		keepWorld: true,
		remount: true,
		secretAnswer: true,
	});
	assert.equal(
		frame.value(),
		"half-written note from before the question",
		"the draft is adopted into the refused box",
	);
	const notice = document.getElementById("composer-secret-closure-notice");
	assert.ok(notice, "the closed box with a draft renders its explanation");
	assert.equal(
		notice.textContent,
		"Answer the secret request in the asks panel — this box is paused until it is answered, and your draft is kept.",
	);
	assert.match(
		frame.textarea().getAttribute("aria-describedby") ?? "",
		/composer-secret-closure-notice/,
		"and the field is described by it",
	);
});

/* ------------------------------------------------------------------ */
/* QA round 1, Q1 — an image-only draft is a message                    */
/* ------------------------------------------------------------------ */

/*
 * THE THIRD DOOR, DRIVEN THROUGH THE SHIPPED COMPOSER.
 *
 * `use-message-input.ts`'s own submit guard required TEXT while the two visible
 * gates — the Send predicate and the form's guard — arm and admit on `text OR
 * attachments`. QA round 1 (Q1) measured the consequence: an image-only press
 * was armed, passed both visible gates, and was then swallowed there with no
 * request, no copy and no toast; the zero-width-space discriminator (a
 * `"\u200B"` box passes `.trim()`) proved the swallow sat in that guard. These
 * two cases pin the fix the way the finding read them: an empty-text draft with
 * an attachment now REACHES `onSendMessage`, and nine images with no text reach
 * it whole — which is what makes the ceiling refusal past it reachable again
 * (its own arm is pinned in `desktop-renderer-transport.test.mjs`).
 */
test("an image-only draft fires the send both visible gates armed (QA round 1, Q1)", async () => {
	const frame = await mount();
	useConversationInputStore
		.getState()
		.addAttachment(frame.conversationId, { id: "q1-a", path: "/tmp/shot.png" });
	await settle();
	await clickSend(frame);
	assert.equal(
		frame.sent.length,
		1,
		"the empty-text press must fire - pre-fix the hook swallowed it in silence",
	);
	const [content, attachments] = frame.sent[0];
	assert.equal(content, "", "the payload carries no text");
	assert.deepEqual(
		attachments,
		["/tmp/shot.png"],
		"and carries the staged image",
	);
});

test("nine images with no text reach the send whole (QA round 1, Q1's blast radius)", async () => {
	const frame = await mount();
	const paths = Array.from(
		{ length: 9 },
		(_, index) => `/tmp/shot-${index}.png`,
	);
	for (const [index, path] of paths.entries()) {
		useConversationInputStore
			.getState()
			.addAttachment(frame.conversationId, { id: `q1-${index}`, path });
	}
	await settle();
	await clickSend(frame);
	assert.equal(
		frame.sent.length,
		1,
		"pre-fix the hook swallowed this press before any payload was built",
	);
	const [content, attachments] = frame.sent[0];
	assert.equal(content, "");
	assert.deepEqual(
		attachments,
		paths,
		"all nine reach the page; the host's imageOverflowRefusal is what refuses them now",
	);
});

/* ------------------------------------------------------------------ */
/* The mic gate reads the Radient session, not only the file (#674)     */
/* ------------------------------------------------------------------ */

/*
 * THE REPORTED STATE AND ITS COUNTERSTATES, driven through this file's own
 * rig. The report: a user signed in to Radient Cloud gets a permanently
 * disabled mic whose tooltip says "Sign in to Radient in the settings page to
 * enable audio recording" — the state they just left. The gate read the
 * legacy `/v1/credentials` key list alone; a sign-in lands in the backend's
 * auth store instead. The cases below pin the fixed matrix on the surface the
 * report is about: session-only → live, key-only → live (unchanged), neither →
 * off with the sign-in sentence, probe-dead → off with the offline sentence.
 *
 * The answers are the desktop transport's own shapes: capabilities advertises
 * the `radient` feature (which is what ENABLES the account read at all),
 * `credentials.list` is the legacy file the probe lists, and
 * `radient.request` carries the account read in the `{data: {msg, result}}`
 * chain `radientProxy` unwraps. The signed-out refusal goes through
 * `transportInner` rather than a bare `transportSays(409, …)`: the shim's
 * outer `!response.ok` check would throw the body away before it is read, and
 * with the body goes the daemon's own "Sign in to Radient…" sentence — the
 * 409-plus-prose pair the account read classifies as `signed-out` instead of
 * `unknown`.
 */

const MIC_TEST_ACCOUNT = {
	account: {
		id: "acct_mic_gate",
		tenant_id: "ten_mic_gate",
		email: "mic-gate@example.test",
		name: "Mic Gate",
		role: "owner",
		status: "active",
		created_at: "2026-01-02T03:04:05Z",
		updated_at: "2026-01-02T03:04:05Z",
	},
	identity: {
		email: "mic-gate@example.test",
		provider: "google",
		provider_id: "google-mic-gate",
	},
};

/** A refusal whose ENVELOPE survives the shim's outer `ok` check (see above). */
const transportInner = (status, detail) => ({
	ok: true,
	status: 200,
	json: async () => ({ status, body: { detail } }),
});

/** The transport for the mic-gate cases, per state under test. */
const micTransport =
	({ account = "signed-out", keys = [], credentialsFail = false } = {}) =>
	(request) => {
		if (request.op === "capabilities")
			return transportSays(200, {
				desktop_available: true,
				features: { commands: 1, session_credential: 1, radient: 1 },
			});
		if (request.op === "credentials.list") {
			if (credentialsFail)
				return transportSays(503, {
					detail: "rig: the server did not answer",
				});
			return transportSays(200, { keys });
		}
		if (request.op === "radient.request") {
			if (account === "signed-in")
				return transportSays(200, {
					data: { msg: "ok", result: MIC_TEST_ACCOUNT },
				});
			return transportInner(409, "Sign in to Radient to access your account");
		}
		return undefined;
	};

/** The composer's dictation control, as the DOM carries it. */
const micButton = () =>
	window.document.querySelector('button[aria-label="Start recording"]');

/** Flush React and the transport until `predicate` holds, or fail naming it. */
async function until(predicate, what, timeoutMs = 20_000) {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		await act(async () => {
			await new Promise((resolve) => realSetTimeout(resolve, 10));
		});
		const value = predicate();
		if (value) return value;
		if (Date.now() > deadline) {
			throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`);
		}
	}
}

/**
 * The mic's tooltip, read by focusing its trigger span and matched BY NAME:
 * the primitive keeps a previously opened panel mounted while the next opens,
 * so the first `[role=tooltip]` can be the previous case's sentence. `prefix`
 * asks for the enabled arm, whose text carries the binding after the prefix.
 *
 * THE DISPATCH HAPPENS ONCE AND THE POLL IS PLAIN. Re-dispatching inside an
 * `act` every attempt — the first shape — made these reads hostage to fleet
 * load: on 2026-09-29 (load average 95+) one act-wrapped dispatch measured
 * minutes, and the loop could outlast any bound. The panel opens once and
 * stays while the focus does; a re-dispatch every 30 attempts is the only
 * retry there is.
 */
async function openMicTooltip(expected, { prefix = false } = {}) {
	const trigger = micButton().parentElement;
	const seen = new Set();
	for (let attempt = 0; attempt < 200; attempt += 1) {
		if (attempt % 30 === 0) {
			trigger.dispatchEvent(
				new window.FocusEvent("focusin", { bubbles: true, cancelable: true }),
			);
		}
		// eslint-disable-next-line no-await-in-loop
		await new Promise((resolve) => realSetTimeout(resolve, 100));
		for (const panel of window.document.querySelectorAll('[role="tooltip"]')) {
			const text = (panel.textContent ?? "").trim();
			seen.add(text);
			if (prefix ? text.startsWith(expected) : text === expected) return text;
		}
	}
	throw new Error(
		`no tooltip read "${expected}"; sentences seen: ${JSON.stringify([...seen])}`,
	);
}

/**
 * Mount a composer on a FRESH machine: the shared `client` keeps the previous
 * case's key list and account otherwise, and a cached key answers for a machine
 * that does not have one (measured: the `neither` case read the key-only case's
 * cached key and left the mic live). This is the one place in this file that
 * clears the shared cache between cases, and it is deliberate — these four
 * cases are four different MACHINES.
 */
async function mountMicMachine() {
	await act(async () => {
		client.clear();
	});
	return mount({ withRecordingProbe: true });
}

test("a signed-in user gets a live mic with no key listed (issue #674)", async () => {
	transportOverride = micTransport({ account: "signed-in", keys: [] });
	try {
		await mountMicMachine();
		const mic = await until(
			() => micButton(),
			"the dictation control to render",
		);
		await until(
			() => !mic.hasAttribute("disabled"),
			"the mic of the reported state to go live",
		);
		assert.equal(
			mic.hasAttribute("disabled"),
			false,
			"a signed-in user's mic must be live without a listed key",
		);
		/*
		 * AND THE TOOLTIP IS THE ENABLED ONE. This is the control the report
		 * watched advise signing in while its user was signed in.
		 */
		await openMicTooltip("Start recording (", { prefix: true });
	} finally {
		transportOverride = null;
	}
});

test("a key-only install keeps the mic live, unchanged", async () => {
	transportOverride = micTransport({
		account: "signed-out",
		keys: ["RADIENT_API_KEY"],
	});
	try {
		await mountMicMachine();
		const mic = await until(
			() => micButton(),
			"the dictation control to render",
		);
		await until(
			() => !mic.hasAttribute("disabled"),
			"the key-only install's mic to be live",
		);
		assert.equal(mic.hasAttribute("disabled"), false);
	} finally {
		transportOverride = null;
	}
});

test("neither a session nor a key: the sign-in sentence, and only for that machine", async () => {
	transportOverride = micTransport({ account: "signed-out", keys: [] });
	try {
		await mountMicMachine();
		await until(() => micButton(), "the dictation control to render");
		await until(
			() => micButton().hasAttribute("disabled"),
			"the mic to settle off",
		);
		await openMicTooltip("Sign in to Radient in Settings to enable recording");
	} finally {
		transportOverride = null;
	}
});

test("the offline sentence is for the server being down, not for a failed probe", async () => {
	transportOverride = micTransport({ account: "signed-out", keys: [] });
	try {
		await mountMicMachine();
		await until(() => micButton(), "the dictation control to render");
		await until(
			() => micButton().hasAttribute("disabled"),
			"the mic to settle off",
		);
		/*
		 * Take the server down the way the app learns it: the health read answers
		 * offline, and the connectivity gate's reading is what the offline
		 * sentence states. A failed credentials probe is NOT that state (design
		 * round 1, D1/D3) — the sign-in case above is the answer for a machine
		 * whose probe merely could not ask.
		 */
		healthFails = true;
		await act(async () => {
			await client.invalidateQueries({ queryKey: ["server-health"] });
		});
		await openMicTooltip(
			"Recording is unavailable while Local Operator is offline",
		);
	} finally {
		healthFails = false;
		transportOverride = null;
	}
});

/*
 * THE QUEUED SECRET ASK LEAVES THE CHAT USABLE (the operator's ask, `a-9e0c`).
 *
 * The composer used to refuse ALL typing while a secret-only ask waited. The
 * operator overruled that: the value is typed into the asks panel, so locking the
 * conversation beside it bought nothing. What replaced the lock is a sentence that
 * says where the secret goes, a door to the panel, and a confirm on a
 * password-shaped send — because the hazard (a credential typed into the chat box
 * and sent as a message, visible while typed and persisted in the draft store) is
 * real, and refusing the box was the wrong shape for it.
 *
 * THE RIG'S BOUNDS, stated: jsdom has no native form submission, so the send door
 * here is `form.requestSubmit()` — the same seam the refused-state case above uses
 * — and the confirm's focus move is asserted through `document.activeElement`
 * rather than through a real browser's focus ring. Layout, colour and the band's
 * geometry are the evidence rig's business, not this file's.
 */
const queuedSecretAsk = (overrides = {}) => ({
	/*
	 * THE FIELD THE CONFIRM BINDS TO (`ask-queue.ts`'s `askSecretField`): the ask
	 * and its single question. A case that changes it between mounts is the ask
	 * changing under the confirm.
	 */
	key: "qa-secret-1:api_token",
	/* One secret question, so one value names one field (design round 1, D2). */
	fillable: true,
	onOpen: () => {},
	onFill: async () => "sent",
	...overrides,
});

const confirmControl = (label) => {
	const confirm = window.document.getElementById("composer-secret-confirm");
	if (!confirm) return null;
	return [...confirm.querySelectorAll("button")].find(
		(button) => button.textContent.trim() === label,
	);
};

/*
 * FOCUS IS ASSERTED AS AN IDENTITY, NEVER AS A COMPARED NODE (measured, and the
 * reason is worth keeping: `assert.equal(document.activeElement, <element>)` on
 * failure hands node's diff a DOM node, React's `__reactFiber$` own property
 * hangs off that node, and the inspector walks the whole fiber tree into one
 * 269 MB string. A green assertion never sees it; the failing one took the
 * process past 9 GB). Every focus assertion below is a boolean.
 */
const hasFocus = (element) =>
	element !== null && window.document.activeElement === element;
const boxHasFocus = (frame) => hasFocus(frame.textarea());

const confirmMessage = () =>
	window.document.getElementById("composer-secret-confirm-message")
		?.textContent ?? "";

const refusalText = () =>
	window.document.getElementById("composer-secret-ask-refusal")?.textContent ??
	null;

const submitDoor = async (frame) => {
	const form = frame.box().closest("form");
	assert.ok(form, "the composer is a form");
	await act(async () => {
		form.requestSubmit();
	});
	await settle();
};

const armConfirm = async (frame) => {
	await type(frame, "correct-horse-9");
	await enter(frame);
	await settle();
	assert.ok(
		window.document.getElementById("composer-secret-confirm"),
		"the confirm is up",
	);
};

test("a queued secret ask keeps the box usable and says where the secret goes", async () => {
	const opens = [];
	const frame = await mount({
		secretAsk: queuedSecretAsk({ onOpen: (...args) => opens.push(args) }),
	});
	const field = frame.textarea();
	assert.equal(field.readOnly, false, "the queued ask does not close the box");
	assert.equal(field.disabled, false);
	assert.equal(
		field.getAttribute("aria-disabled"),
		null,
		"and it makes no disabled claim",
	);

	await type(frame, "hello there");
	assert.equal(
		frame.value(),
		"hello there",
		"typing lands, which the lock refused",
	);
	assert.equal(
		frame.draft(),
		"hello there",
		"and the draft is an ordinary draft",
	);

	const notice = window.document.getElementById("composer-secret-ask-notice");
	assert.ok(notice, "the notice renders while the queued ask waits");
	assert.match(
		notice.textContent ?? "",
		/asking for a secret.*asks panel.*keep chatting/isu,
		"and it says where the value goes and that the box still works",
	);
	const open = [...notice.querySelectorAll("button")].find((button) =>
		(button.textContent ?? "").includes("Open asks"),
	);
	assert.ok(open, "the notice carries the door to the panel");
	assert.equal(
		open.getAttribute("data-lo-ask-item-toggle"),
		"",
		"and it carries the drawer's own door mark (UX round 2, U6): the chord only ASKS for the entry move, and the drawer runs it for a marked control",
	);
	assert.equal(
		open.matches(ASK_ITEM_SELECTOR),
		true,
		"the mark is the drawer's own selector, not a lookalike attribute the entry move would ignore",
	);
	await act(async () => {
		open.click();
	});
	assert.equal(opens.length, 1, "and the door calls the page's opener once");
	assert.deepEqual(
		opens[0],
		[],
		"a press asks for the entry move (UX round 1, U4), not a silent open",
	);
	assert.match(
		field.getAttribute("aria-describedby") ?? "",
		/composer-secret-ask-notice/,
		"the box is described by the sentence while it renders",
	);
});

test("a password-shaped send asks first, and sends nothing until answered", async () => {
	const frame = await mount({ secretAsk: queuedSecretAsk() });
	await type(frame, "correct-horse-9");
	/*
	 * THE KEY ROAD, which is where Enter actually leaves: the composer's handler
	 * falls through to the hook's own submit rather than the form's, so a guard on
	 * the form alone would never see a keystroke.
	 */
	await enter(frame);
	await settle();
	assert.equal(
		frame.sent.length,
		0,
		"Enter sends nothing while the confirm is up",
	);
	assert.ok(
		window.document.getElementById("composer-secret-confirm"),
		"the confirm renders",
	);
	assert.equal(
		window.document.getElementById("composer-secret-ask-notice"),
		null,
		"and it replaces the standing sentence rather than stacking on it",
	);
	assert.equal(
		frame.value(),
		"correct-horse-9",
		"the text is kept, not consumed",
	);
	assert.equal(
		hasFocus(confirmControl("Put in secret field")),
		true,
		"the default destination takes focus, so Enter means it",
	);
	const group = window.document.getElementById("composer-secret-confirm");
	assert.equal(
		group.tagName,
		"FIELDSET",
		"the confirm is a real group of controls, not a bare div (N1/D5)",
	);
	assert.equal(
		group.getAttribute("aria-labelledby"),
		"composer-secret-confirm-message",
		"and its name is the question beside the focused control",
	);
	assert.match(
		confirmMessage(),
		new RegExp(`\\b${"correct-horse-9".length} characters\\b`),
		"the confirm says how much it is about to submit (U5)",
	);

	await act(async () => {
		confirmControl("Cancel")?.click();
	});
	await settle();
	assert.equal(
		window.document.getElementById("composer-secret-confirm"),
		null,
		"Cancel closes the confirm",
	);
	assert.equal(
		frame.value(),
		"correct-horse-9",
		"and keeps the text — the accepted risk recorded on the PR: a cancelled password stays in the draft",
	);
	assert.equal(boxHasFocus(frame), true, "and returns the caret to the box");
	assert.equal(frame.sent.length, 0, "nothing was sent");
});

test("Send as message sends the line the confirm asked about, and returns the caret", async () => {
	const frame = await mount({ secretAsk: queuedSecretAsk() });
	await armConfirm(frame);
	/* The FORM door this time: the Send control and a scripted submit reach it. */
	await submitDoor(frame);
	assert.ok(window.document.getElementById("composer-secret-confirm"));
	await act(async () => {
		confirmControl("Send as message")?.click();
	});
	await settle();
	assert.equal(frame.sent.length, 1, "the explicit second press is the send");
	assert.equal(
		frame.sent[0][0],
		"correct-horse-9",
		"and it is the confirmed line that goes out",
	);
	assert.equal(
		window.document.getElementById("composer-secret-confirm"),
		null,
		"and the confirm is gone",
	);
	assert.equal(
		boxHasFocus(frame),
		true,
		"the pressed control unmounted, so the caret comes back to the box (U3/Q3)",
	);
});

test("an edit under the confirm retires it rather than riding under it", async () => {
	const fills = [];
	const frame = await mount({
		secretAsk: queuedSecretAsk({
			onFill: async (value) => {
				fills.push(value);
				return "sent";
			},
		}),
	});
	await armConfirm(frame);
	/* Typing changes the line the question was asked about (UX round 1, N2). */
	await type(frame, "X");
	await settle();
	assert.equal(
		window.document.getElementById("composer-secret-confirm"),
		null,
		"the confirm is retired, so no press can act on a line nobody confirmed",
	);
	assert.equal(fills.length, 0, "and nothing was put");
	assert.equal(frame.value(), "correct-horse-9X", "the edit is kept");
});

test("Put in secret field hands the value to the page's answer door and clears the draft", async () => {
	const fills = [];
	const frame = await mount({
		secretAsk: queuedSecretAsk({
			onFill: async (value, key) => {
				fills.push([value, key]);
				return "sent";
			},
		}),
	});
	await type(frame, "  correct-horse-9  ");
	assert.equal(frame.draft(), "  correct-horse-9  ");
	await submitDoor(frame);
	await act(async () => {
		confirmControl("Put in secret field")?.click();
	});
	await settle();
	assert.deepEqual(
		fills,
		[["correct-horse-9", "qa-secret-1:api_token"]],
		"the trimmed value is what is filled, bound to the field the confirm was raised for",
	);
	assert.equal(frame.sent.length, 0, "and it is never sent as a chat message");
	assert.equal(frame.value(), "", "the box is cleared");
	assert.equal(
		frame.draft() ?? "",
		"",
		"and the persisted draft is retired with it, so no reload restores the secret",
	);
	assert.equal(window.document.getElementById("composer-secret-confirm"), null);
	assert.equal(
		boxHasFocus(frame),
		true,
		"and the caret is back in the box (Q3)",
	);
});

test("a refused fill keeps the text, opens the panel and says why", async () => {
	const opens = [];
	const frame = await mount({
		secretAsk: queuedSecretAsk({
			onOpen: (...args) => opens.push(args),
			onFill: async () => "refused",
		}),
	});
	await armConfirm(frame);
	await act(async () => {
		confirmControl("Put in secret field")?.click();
	});
	await settle();
	assert.equal(
		frame.value(),
		"correct-horse-9",
		"the value the panel did not take is still the user's to retry",
	);
	assert.equal(frame.sent.length, 0);
	assert.equal(
		opens.length,
		1,
		"the panel is opened, so the owner's own refusal on the card is on screen",
	);
	assert.deepEqual(
		opens[0],
		[{ focus: false }],
		"and it is opened WITHOUT taking the caret (Q3): the refusal returns focus to the box",
	);
	assert.match(
		refusalText() ?? "",
		/did not take that value/i,
		"the composer says the value did not land (M1/U1)",
	);
	assert.equal(boxHasFocus(frame), true, "and the caret is back in the box");
});

test("a fill the lock refused says so, and is not reported as a refusal by the owner", async () => {
	const frame = await mount({
		secretAsk: queuedSecretAsk({ onFill: async () => "locked" }),
	});
	await armConfirm(frame);
	await act(async () => {
		confirmControl("Put in secret field")?.click();
	});
	await settle();
	assert.match(
		refusalText() ?? "",
		/still sending/i,
		"the lock has its own sentence (M1): the value is kept and the reason is named",
	);
	assert.equal(frame.value(), "correct-horse-9");
});

test("the confirm is bound to its ask: a different head retires it, and nothing is posted", async () => {
	const fills = [];
	const conversationId = "conv-secret-ask-rebound";
	const first = await mount({
		conversationId,
		secretAsk: queuedSecretAsk({
			onFill: async (value, key) => {
				fills.push([value, key]);
				return "sent";
			},
		}),
	});
	await armConfirm(first);
	/* The head ask changes under the open confirm (QA round 1, Q2). */
	const second = await mount({
		/* The same conversation, and the draft this test is about is NOT cleared. */
		conversationId,
		keepWorld: true,
		secretAsk: queuedSecretAsk({ key: "qa-secret-B:db_password" }),
	});
	assert.equal(
		window.document.getElementById("composer-secret-confirm"),
		null,
		"the question about the old ask is retired",
	);
	assert.match(refusalText() ?? "", /changed first/i, "and says why");
	assert.equal(fills.length, 0, "the value reaches no other ask");
	assert.equal(second.value(), "correct-horse-9", "and the text is kept");
	assert.equal(boxHasFocus(second), true);
});

test("the confirm retires when its ask leaves the queue", async () => {
	const conversationId = "conv-secret-ask-gone";
	const first = await mount({ conversationId, secretAsk: queuedSecretAsk() });
	await armConfirm(first);
	const second = await mount({
		conversationId,
		keepWorld: true,
		secretAsk: null,
	});
	assert.equal(
		window.document.getElementById("composer-secret-confirm"),
		null,
		"the confirm cannot outlive its ask (m1/Q1) — its default button was a dead control",
	);
	assert.match(refusalText() ?? "", /no longer waiting/i, "and says so");
	assert.equal(second.value(), "correct-horse-9", "the draft is kept");
	assert.equal(boxHasFocus(second), true);
});

test("a multi-secret ask is opened, not filled, and says which field to choose", async () => {
	const fills = [];
	const opens = [];
	const frame = await mount({
		secretAsk: queuedSecretAsk({
			key: "qa-secret-multi:*",
			fillable: false,
			onOpen: (...args) => opens.push(args),
			onFill: async (value) => {
				fills.push(value);
				return "multi";
			},
		}),
	});
	await armConfirm(frame);
	assert.equal(
		confirmControl("Put in secret field"),
		undefined,
		"the confirm is up, and its label does not promise a put (design round 1, D2)",
	);
	await act(async () => {
		confirmControl("Open asks panel")?.click();
	});
	await settle();
	assert.deepEqual(fills, [], "nothing is posted to a guessed question");
	assert.equal(opens.length, 1, "the panel is opened");
	assert.deepEqual(opens[0], [{ focus: false }]);
	assert.match(
		refusalText() ?? "",
		/more than one secret/i,
		"and the reason is visible",
	);
	assert.equal(frame.value(), "correct-horse-9", "the draft is kept");
	assert.equal(boxHasFocus(frame), true, "and the caret is back in the box");
});

test("while a Put is in flight its other controls are disabled and it says so", async () => {
	let release;
	const pending = new Promise((resolve) => {
		release = resolve;
	});
	const frame = await mount({
		secretAsk: queuedSecretAsk({ onFill: () => pending }),
	});
	await armConfirm(frame);
	await act(async () => {
		confirmControl("Put in secret field")?.click();
	});
	/* Deliberately NOT settled: this is the window a slow link shows (U2). */
	assert.equal(confirmControl("Put in secret field")?.disabled, true);
	assert.equal(confirmControl("Send as message")?.disabled, true);
	assert.equal(confirmControl("Cancel")?.disabled, true);
	assert.match(
		confirmMessage(),
		/Sending to the secret field/i,
		"the row says what it is waiting for",
	);
	/*
	 * U7 / D13: every control in the row is disabled, so Chromium blurs the one
	 * that was pressed and focus falls to <body>. The row itself takes it.
	 */
	const group = window.document.getElementById("composer-secret-confirm");
	assert.equal(
		hasFocus(group),
		true,
		"the row holds the keyboard while the put is in flight, not <body>",
	);
	/*
	 * m-B: Escape is CLAIMED and does nothing. The value is already posting, so a
	 * cancel would say one thing while the request did another, and an unclaimed
	 * key from <body> would fall to the interrupt ladder.
	 */
	const rowEscape = new window.KeyboardEvent("keydown", {
		key: "Escape",
		bubbles: true,
		cancelable: true,
	});
	await act(async () => {
		group.dispatchEvent(rowEscape);
	});
	assert.equal(
		rowEscape.defaultPrevented,
		true,
		"Escape is claimed while the put is pending",
	);
	assert.ok(
		window.document.getElementById("composer-secret-confirm"),
		"and the confirm it did not cancel is still up",
	);
	/* The box's own rung is gated the same way, for a click into it mid-flight. */
	frame.textarea().focus();
	const boxEscape = new window.KeyboardEvent("keydown", {
		key: "Escape",
		bubbles: true,
		cancelable: true,
	});
	await act(async () => {
		frame.textarea().dispatchEvent(boxEscape);
	});
	assert.equal(boxEscape.defaultPrevented, true, "and so is Escape in the box");
	assert.ok(window.document.getElementById("composer-secret-confirm"));
	await act(async () => {
		release("sent");
	});
	await settle();
	assert.equal(window.document.getElementById("composer-secret-confirm"), null);
	assert.equal(frame.sent.length, 0, "and Send as message never fired");
});

test("Cancel and Escape clear the last refusal with the attempt (UX round 2, U8)", async () => {
	const frame = await mount({
		secretAsk: queuedSecretAsk({ onFill: async () => "refused" }),
	});
	await armConfirm(frame);
	await act(async () => {
		confirmControl("Put in secret field")?.click();
	});
	await settle();
	assert.match(
		refusalText() ?? "",
		/did not take that value/i,
		"a receipt is up",
	);
	/* A new attempt hides it; cancelling that attempt must not bring it back. */
	await enter(frame);
	await settle();
	assert.ok(window.document.getElementById("composer-secret-confirm"));
	await act(async () => {
		confirmControl("Cancel")?.click();
	});
	await settle();
	assert.equal(
		refusalText(),
		null,
		"Cancel returns to the plain notice, not to the previous attempt's receipt",
	);

	/* The same for Escape, which is Cancel's keyboard spelling. */
	await enter(frame);
	await settle();
	await act(async () => {
		confirmControl("Put in secret field")?.click();
	});
	await settle();
	assert.match(refusalText() ?? "", /did not take that value/i);
	await enter(frame);
	await settle();
	frame.textarea().focus();
	await act(async () => {
		frame.textarea().dispatchEvent(
			new window.KeyboardEvent("keydown", {
				key: "Escape",
				bubbles: true,
				cancelable: true,
			}),
		);
	});
	await settle();
	assert.equal(refusalText(), null, "and Escape clears it too");
});

test("a retirement does not take a keyboard the user moved elsewhere (m-C)", async () => {
	const conversationId = "conv-secret-ask-elsewhere";
	await mount({ conversationId, secretAsk: queuedSecretAsk() });
	const frame = await mount({ conversationId, secretAsk: queuedSecretAsk() });
	await armConfirm(frame);
	/* The user answers the ask in the panel, so the keyboard is in the panel. */
	const elsewhere = window.document.createElement("button");
	window.document.body.appendChild(elsewhere);
	elsewhere.focus();
	assert.equal(hasFocus(elsewhere), true);
	await mount({
		conversationId,
		keepWorld: true,
		secretAsk: queuedSecretAsk({ key: "second-ask-key" }),
	});
	assert.match(
		refusalText() ?? "",
		/changed first/i,
		"the confirm retires as before",
	);
	assert.equal(
		hasFocus(elsewhere),
		true,
		"and the keyboard stays where the user moved it, not in the box",
	);
	elsewhere.remove();
});

test("the count is one phrase, keeps its place while sending, and does not split (D11/D12/N-a)", async () => {
	let release;
	const pending = new Promise((resolve) => {
		release = resolve;
	});
	const frame = await mount({
		secretAsk: queuedSecretAsk({ onFill: () => pending }),
	});
	await armConfirm(frame);
	assert.match(
		confirmMessage(),
		/\? 15 characters$/,
		"the count is separated by a real space, so textContent and the group's name read one sentence (N-a)",
	);
	const count = window.document.querySelector(
		"#composer-secret-confirm-message span:last-of-type",
	);
	assert.match(
		count?.className ?? "",
		/whitespace-nowrap/,
		"and it cannot break between the number and its unit (D11)",
	);
	await act(async () => {
		confirmControl("Put in secret field")?.click();
	});
	const sentCount = window.document.querySelector(
		"#composer-secret-confirm-message span:last-of-type",
	);
	assert.ok(
		sentCount,
		"the count keeps its place in the row while sending (D12)",
	);
	assert.match(sentCount?.className ?? "", /invisible/);
	assert.equal(
		sentCount?.getAttribute("aria-hidden"),
		"true",
		"and is hidden from the reader rather than removed from the layout",
	);
	await act(async () => {
		release("sent");
	});
	await settle();
});

test("the Retry door answers to the same guard", async () => {
	const ref = React.createRef();
	const frame = await mount({ secretAsk: queuedSecretAsk(), composerRef: ref });
	await type(frame, "correct-horse-9");
	await act(async () => {
		ref.current?.submitNow();
	});
	await settle();
	assert.equal(
		frame.sent.length,
		0,
		"Retry does not replay a password without asking",
	);
	assert.ok(window.document.getElementById("composer-secret-confirm"));

	/*
	 * AND THE QUESTION DOES NOT FOLLOW THE BOX INTO ANOTHER CONVERSATION. The same
	 * composer instance serves the next conversation (the element type and position
	 * are unchanged), and the confirm's text belongs to the draft it was asked in.
	 */
	const next = await mount({
		conversationId: "conv-secret-confirm-next",
		secretAsk: queuedSecretAsk(),
	});
	assert.equal(
		window.document.getElementById("composer-secret-confirm"),
		null,
		"a switch retires the confirm",
	);
	assert.equal(next.sent.length, 0);
});

test("Escape in the textarea cancels the confirm it left open", async () => {
	const frame = await mount({ secretAsk: queuedSecretAsk() });
	await armConfirm(frame);
	/* Focus back in the box while the question is still up (UX round 1, N1). */
	frame.textarea().focus();
	await settle();
	await act(async () => {
		frame.textarea().dispatchEvent(
			new window.KeyboardEvent("keydown", {
				key: "Escape",
				bubbles: true,
				cancelable: true,
			}),
		);
	});
	await settle();
	assert.equal(
		window.document.getElementById("composer-secret-confirm"),
		null,
		"Escape from the box answers the question the same way Cancel does",
	);
	assert.equal(frame.value(), "correct-horse-9", "and the draft survives");
	assert.equal(boxHasFocus(frame), true);
});

test("ordinary prose opens no confirm, even while a queued secret ask waits", async () => {
	const frame = await mount({ secretAsk: queuedSecretAsk() });
	await type(frame, "please look at this");
	await submitDoor(frame);
	assert.equal(frame.sent.length, 1);
	assert.equal(
		window.document.getElementById("composer-secret-confirm"),
		null,
		"ordinary prose opens no confirm",
	);
});
