import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

/*
 * THE SHARED COMPOSER'S HOST CONTRACT, driven through the SHIPPED component.
 *
 * `message-input.tsx` was carved out of `features/chat` into
 * `shared/components/composer` so the mini view and the projects row can mount
 * the REAL chat composer. That only means anything if the composer can mount in
 * a document that is not the chat shell, and the shell's two conveniences it
 * used to assume are the ones this file pins:
 *
 *   1. A QueryClient provider. The composer used to call `useQueryClient()`
 *      unconditionally (for the credential-store invalidation) and reached three
 *      more react-query reads through hooks (`useRadientCredentialProbe`,
 *      `useSlashCompletion`, `useAtResolution`, `useRadientSessionIssue`) - all
 *      on the mount path, all throwing "No QueryClient set" without a provider.
 *      Now: the invalidation is the host's callback (`onCredentialsStored`), the
 *      credential probe is a host prop (`recordingProbe`), and the remaining
 *      reads degrade to their off state through `useOptionalQueryClient`, so the
 *      composer mounts with NO provider and nothing fetches. Case 1 is that
 *      property end to end, and its per-op counts are the half that can go
 *      quiet: case 1b forces the fallback to report `provided: true` and shows
 *      the SAME instrument reading non-zero (review round 1, MINOR 1 - the
 *      first cut asserted a mount and a band, which stayed green while that
 *      forced fallback fired 28 capability fetches).
 *   2. The chat page's own wiring. Case 6 pins the chat host to the new seams,
 *      because a seam the page silently stops passing is a mount that throws in
 *      the next document even though every case here is green.
 *
 * The remaining cases are the other three bootstrap items the lift owed: the
 * explicit density prop, the dictation-state callback, the host placeholder
 * override - plus the transcript props a standalone host passes (`messages: []`
 * renders the composer alone; the props are UNCHANGED by the lift, so nothing
 * here is a new default), which is case 1's mount itself.
 *
 * WHAT THIS IS NOT: layout evidence (jsdom has no layout engine), or proof of a
 * real browser's key handling. The dictation case drives the SHARED manager's
 * real capture dispatch with a synthetic media stack, which is the same
 * instrument `mini-view-dictation.test.mjs` uses for the mini's registration.
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
 * The composer's queries and the STT manager schedule real timers, and a jsdom
 * window has no lifecycle that retires them: left alone, the process never
 * exits. Every timer created below is recorded and cleared on the way out -
 * the fixture's business, not the component's.
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

/*
 * The microphone, as the shared manager's dispatch needs it: a delegating
 * `getUserMedia` (each case decides when the stream resolves) and a recorder
 * whose `onstop` fires as a microtask after `stop`, which is the real machine's
 * order. The mini's dictation suite drives the same pair.
 */
const mic = { next: null, calls: 0 };
const fakeStream = () => ({ getTracks: () => [{ stop: () => {} }] });

for (const [key, value] of Object.entries({
	window,
	document: window.document,
	localStorage: window.localStorage,
	sessionStorage: window.sessionStorage,
	navigator: {
		platform: "MacIntel",
		/*
		 * react-dom reads `navigator.userAgent` at module scope, and it is
		 * imported through the bundle BELOW this bootstrap: an override with no
		 * userAgent crashed the whole file before a single mount (measured).
		 */
		userAgent: window.navigator.userAgent,
		mediaDevices: {
			getUserMedia: (constraints) => {
				mic.calls += 1;
				return mic.next(constraints);
			},
		},
	},
	MediaRecorder: class FakeMediaRecorder {
		constructor(stream) {
			this.stream = stream;
			this.state = "inactive";
			this.ondataavailable = null;
			this.onstop = null;
		}
		start() {
			this.state = "recording";
		}
		stop() {
			if (this.state === "inactive") return;
			this.state = "inactive";
			queueMicrotask(() => {
				this.ondataavailable?.({
					data: new Blob(["0123456789"], { type: "audio/webm" }),
				});
				this.onstop?.();
			});
		}
	},
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
 * A hidden document: React Query's probes pause when the document is not
 * visible, and a jsdom document reports itself visible with no focus - left
 * visible they would refetch forever and the process would never exit.
 */
Object.defineProperty(window.document, "visibilityState", { value: "hidden" });
Object.defineProperty(window.document, "hidden", { value: true });

window.setTimeout = tracked(realSetTimeout);
window.setInterval = tracked(realSetInterval);

/*
 * `matchMedia`, which jsdom does not implement at all. One object per query
 * (through `useSyncExternalStore`, whose `getSnapshot` must be stable or React
 * re-renders forever), reporting the preference unsets - which is not what any
 * assertion here is about.
 */
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

/*
 * The desktop transport, answered from this file. The composer reaches it
 * through `fetch("/__desktop")` when no preload bridge answers, and the STT
 * manager's registration reads `settings.list` on its own (no query involved);
 * everything else the mount asks - the `config.get` the connectivity gate reads
 * on every render, the capability census - is answered with the inert truth.
 *
 * EVERY OP IS ALSO RECORDED, because "the providerless mount fetches nothing"
 * is only a claim while there is an instrument that could have seen it fetch:
 * case 1 asserts zero calls per op from this list, and case 1b shows the same
 * list reporting non-zero once the provider gate is forced open (review round
 * 1, MINOR 1).
 */
const transportOps = [];
globalThis.fetch = async (url, init) => {
	let request = {};
	try {
		request = JSON.parse(init?.body ?? "{}");
	} catch {
		request = {};
	}
	transportOps.push(request.op);
	const answer = (result) => ({
		ok: true,
		status: 200,
		json: async () => ({ status: 200, body: { result } }),
	});
	if (request.op === "config.get")
		return answer({ values: { hosting: "local", model_name: "mock" } });
	if (request.op === "settings.list") return answer({ settings: [] });
	if (request.op === "capabilities")
		return answer({ desktop_available: true, features: {} });
	return answer({});
};

/* ------------------------------------------------------------------ */
/* The bundle                                                           */
/* ------------------------------------------------------------------ */

const worktree = process.cwd();
const bundle = await build({
	stdin: {
		contents: `
			export { MessageInput } from "./src/renderer/src/shared/components/composer/message-input";
			export {
				COMPOSER_PLACEHOLDER,
				composerPlaceholder,
			} from "./src/renderer/src/shared/hooks/use-message-input";
			export { resolvePushToTalkBinding } from "./src/renderer/src/shared/hooks/use-speech-to-text-manager";
			export { useConversationInputStore } from "./src/renderer/src/shared/store/conversation-input-store";
		`,
		resolveDir: worktree,
		loader: "tsx",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
	jsx: "automatic",
	alias: {
		"@shared": `${worktree}/src/renderer/src/shared`,
		"@features": `${worktree}/src/renderer/src/features`,
		"@assets": `${worktree}/src/renderer/src/assets`,
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
	`./_shared-composer-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const {
	COMPOSER_PLACEHOLDER,
	MessageInput,
	composerPlaceholder,
	resolvePushToTalkBinding,
	useConversationInputStore,
} = await import(bundlePath.href);
await unlink(bundlePath);

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = React;
const h = React.createElement;

after(() => {
	for (const id of liveTimers) clearTimeout(id);
	dom.window.close();
});

/* ------------------------------------------------------------------ */
/* The rig                                                              */
/* ------------------------------------------------------------------ */

/** Let every pending effect and microtask settle inside act. */
const settle = async () => {
	for (let pass = 0; pass < 4; pass++) {
		await act(async () => {
			await Promise.resolve();
		});
	}
	for (let pass = 0; pass < 4; pass++) {
		await act(async () => {
			await new Promise((resolve) => realSetTimeout(resolve, 0));
		});
	}
};

let mountSeq = 0;
let root;

/**
 * Mount the composer, WITHOUT a QueryClient provider - the property this file
 * exists for. A case that wants a provider would contradict its own subject.
 */
async function mount({
	conversationId = `shared-composer-${++mountSeq}`,
	messages = [],
	...composerProps
} = {}) {
	useConversationInputStore.setState({ inputByConversation: {} });
	const container = window.document.createElement("div");
	window.document.body.appendChild(container);
	root = createRoot(container);
	await act(async () => {
		root.render(
			h(MessageInput, {
				conversationId,
				messages,
				isLoading: false,
				onSendMessage: async () => ({ ok: true }),
				...composerProps,
			}),
		);
	});
	await settle();
	return {
		container,
		/*
		 * CONTAINER-SCOPED, not `document`-scoped, and it is load-bearing: a case
		 * that throws before its own unmount leaves its tree mounted, and a
		 * document-level query then reads the FIRST composer on the page - the
		 * previous test's. Measured while this file was being written: the density
		 * case read a wide band for a small-view mount purely because test 1's
		 * composer was still up.
		 */
		textarea: () => container.querySelector("textarea"),
		band: () => container.querySelector("[data-lo-composer-band]"),
	};
}

after(async () => {
	await act(async () => {
		root?.unmount();
	});
});

/* ------------------------------------------------------------------ */
/* 1. The mount blocker: no QueryClient provider, no throw              */
/* ------------------------------------------------------------------ */

test("the composer mounts in a document with no QueryClient, on the props a standalone host passes", async () => {
	/*
	 * THE REGRESSION: on the pre-lift tree this mount throws "No QueryClient
	 * set, useQueryClient to set one" - from `useQueryClient()` first, and from
	 * the credential probe and the slash/at/radient reads behind it once that
	 * one is gone. `messages: []` is the standalone consumer's value (the mini
	 * has no transcript), passed by the HOST: the lift adds no default and moves
	 * no props.
	 */
	transportOps.length = 0;
	const frame = await mount({ messages: [] });
	assert.ok(frame.textarea(), "the composer's field is mounted");
	assert.ok(
		frame.band() !== null,
		"the composer band is mounted (the standalone props render)",
	);

	/*
	 * AND NOTHING FETCHED ON ITS BEHALF (review round 1, MINOR 1). The mount
	 * being PAINTED is not the claim; the claim is that the provider gate
	 * (`enabled: provided` on every host-gated read) leaves them off - and a
	 * fallback answering `provided: true` fired the census from a client nobody
	 * reads while every assertion above stayed green. Per-op counts, so a
	 * passing case names exactly what it refuses: the four ops the composer's
	 * subtree asks for as queries. `config.get`/`settings.list` may appear -
	 * they are read OUTSIDE react-query, and their presence is what says this
	 * instrument was consulted at all.
	 */
	const countOf = (op) => transportOps.filter((entry) => entry === op).length;
	for (const op of [
		"capabilities",
		"commands.list",
		"accounts.list",
		"commands.entities",
	]) {
		assert.equal(countOf(op), 0, `the providerless mount must not fetch ${op}`);
	}
	assert.ok(
		transportOps.length > 0,
		"the transport was consulted at all, so the zeros above are readings rather than silence",
	);

	await act(async () => {
		root.unmount();
	});
});

/* ------------------------------------------------------------------ */
/* 1b. The negative control: the same instrument, gate forced open      */
/* ------------------------------------------------------------------ */

test("forcing the fallback to report provided:true fires the ops case 1 refuses", async () => {
	/*
	 * THE CONTROL THAT MAKES CASE 1's ZEROS READINGS RATHER THAN SILENCE. The
	 * reviewer's reproduction (review round 1, MINOR 1): with the seam answering
	 * `provided: true`, this mount fires the capability census and the host-gated
	 * lists - 28 fetches in that reproduction - while every other assertion
	 * stayed green. This case builds ONE more bundle whose only difference is
	 * that stub (the most specific alias wins over `@shared`), mounts it exactly
	 * the way the rig mounts, and reads the SAME instrument: non-zero here is
	 * what makes case 1's zeros the gate's rather than a broken recorder.
	 */
	const forcedStub = new URL(
		`./_shared-composer-forced-stub-${process.pid}.mjs`,
		import.meta.url,
	);
	await writeFile(
		forcedStub,
		[
			`import { useOptionalQueryClient as real } from ${JSON.stringify(`${worktree}/src/renderer/src/shared/hooks/use-optional-query-client`)};`,
			"export const useOptionalQueryClient = () => ({ ...real(), provided: true });",
		].join("\n"),
	);
	const forced = await build({
		stdin: {
			contents:
				'export { MessageInput } from "./src/renderer/src/shared/components/composer/message-input";',
			resolveDir: worktree,
			loader: "tsx",
		},
		bundle: true,
		format: "esm",
		platform: "node",
		external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
		jsx: "automatic",
		alias: {
			/*
			 * Redirect the seam alone; everything else resolves exactly as the main
			 * bundle resolves. `useOptionalQueryClient` is the ONLY module this stub
			 * replaces, so the mount under test is the shipped composer.
			 */
			"@shared/hooks/use-optional-query-client": forcedStub.pathname,
			"@shared": `${worktree}/src/renderer/src/shared`,
			"@features": `${worktree}/src/renderer/src/features`,
			"@assets": `${worktree}/src/renderer/src/assets`,
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
	const forcedBundlePath = new URL(
		`./_shared-composer-forced-${process.pid}.mjs`,
		import.meta.url,
	);
	await writeFile(forcedBundlePath, forced.outputFiles[0].text);
	const { MessageInput: ForcedMessageInput } = await import(
		forcedBundlePath.href
	);
	await unlink(forcedBundlePath);
	await unlink(forcedStub);

	transportOps.length = 0;
	const container = window.document.createElement("div");
	window.document.body.appendChild(container);
	const forcedRoot = createRoot(container);
	await act(async () => {
		forcedRoot.render(
			h(ForcedMessageInput, {
				conversationId: `shared-composer-forced-${++mountSeq}`,
				messages: [],
				isLoading: false,
				onSendMessage: async () => ({ ok: true }),
			}),
		);
	});
	await settle();
	assert.ok(
		transportOps.filter((op) => op === "capabilities").length > 0,
		"the capability census fires once the gate is forced open - the same instrument case 1 reads as zero",
	);
	await act(async () => {
		forcedRoot.unmount();
	});
});

/* ------------------------------------------------------------------ */
/* 2. The density prop: explicit, and it reaches the surface            */
/* ------------------------------------------------------------------ */

test("isSmallView is an explicit density prop that reaches the band and the controls", async () => {
	const wide = await mount({ isSmallView: false });
	const wideClass = wide.band()?.className ?? "";
	assert.match(wideClass, /\bpb-4\b/, "the wide composer keeps its roomy band");

	await act(async () => {
		root.unmount();
	});
	const small = await mount({ isSmallView: true });
	const smallClass = small.band()?.className ?? "";
	assert.match(
		smallClass,
		/\bpb-1\b/,
		"the compact composer takes the small-view band padding - the density prop is the only switch",
	);
	assert.doesNotMatch(
		smallClass,
		/\bpb-4\b/,
		"and the roomy padding is gone in the same frame",
	);
	await act(async () => {
		root.unmount();
	});
});

/* ------------------------------------------------------------------ */
/* 3. The dictation-state callback, over the shared manager's dispatch  */
/* ------------------------------------------------------------------ */

test("onDictationStateChange reports the take's start and end", async () => {
	mic.calls = 0;
	mic.next = async () => fakeStream();
	const states = [];
	const frame = await mount({
		recordingProbe: { hasRadientApiKey: true, isUnavailable: false },
		onDictationStateChange: (active) => states.push(active),
	});

	/*
	 * THE REAL DISPATCH: the shared manager owns the push-to-talk binding, and
	 * its capture-phase keydown is what engages the registered handler. The
	 * key is read from the shipped resolution rather than hard-coded, so a
	 * default that moves cannot leave this case pressing a key nobody listens
	 * for.
	 */
	const { code } = resolvePushToTalkBinding();
	await act(async () => {
		window.dispatchEvent(
			new window.KeyboardEvent("keydown", {
				code,
				bubbles: true,
				cancelable: true,
			}),
		);
	});
	await settle();
	assert.ok(mic.calls > 0, "the hold reached the microphone");
	assert.deepEqual(
		states,
		[false, true],
		"the host hears the resting state, then one start edge - the frame's guards can defer to a live take",
	);

	await act(async () => {
		window.dispatchEvent(
			new window.KeyboardEvent("keyup", {
				code,
				bubbles: true,
				cancelable: true,
			}),
		);
	});
	await settle();
	assert.deepEqual(
		states,
		[false, true, false],
		"the end edge reaches the host too, so a guard cannot stay deferred",
	);

	await act(async () => {
		root.unmount();
	});
	const mountedText = frame.textarea();
	assert.ok(mountedText === null, "unmount completed");
	mic.next = null;
});

/* ------------------------------------------------------------------ */
/* 4. The placeholder override                                          */
/* ------------------------------------------------------------------ */

test("placeholderOverride replaces the invitation; every state sentence outranks it", async () => {
	const frame = await mount({ placeholderOverride: "Send a quick message" });
	assert.equal(
		frame.textarea()?.getAttribute("placeholder"),
		"Send a quick message",
		"the host's sentence is the box's placeholder",
	);

	await act(async () => {
		root.unmount();
	});
	const plain = await mount();
	assert.equal(
		plain.textarea()?.getAttribute("placeholder"),
		COMPOSER_PLACEHOLDER.idle,
		"without the override the app's own invitation stands",
	);

	await act(async () => {
		root.unmount();
	});
	const busy = await mount({
		placeholderOverride: "Send a quick message",
		isLoading: true,
		currentJobId: "job-1",
	});
	assert.equal(
		busy.textarea()?.getAttribute("placeholder"),
		COMPOSER_PLACEHOLDER.busy,
		"a refused box still says why rather than showing the host's invitation",
	);

	/*
	 * And the term BY VALUE, on the shipped function: the override is the
	 * INVITATION slot, not a blanket rewrite.
	 */
	const base = {
		unavailable: false,
		secretAnswer: false,
		inputDisabled: false,
		awaitingAnswer: false,
		asideAttached: false,
		sendingUnsettled: false,
		awaitingReply: false,
		noProvider: false,
	};
	assert.equal(
		composerPlaceholder({ ...base, idle: "Host copy" }),
		"Host copy",
		"the invitation slot takes the host's sentence",
	);
	assert.equal(
		composerPlaceholder({ ...base, idle: "Host copy", unavailable: true }),
		COMPOSER_PLACEHOLDER.unavailable,
		"and a state sentence still outranks it",
	);

	await act(async () => {
		root.unmount();
	});
});

/* ------------------------------------------------------------------ */
/* 5. The seams are the composer's, not react-query's                   */
/* ------------------------------------------------------------------ */

test("the shared composer owns no react-query read on its mount path", async () => {
	const raw = await readFileSync(
		"src/renderer/src/shared/components/composer/message-input.tsx",
		"utf8",
	);
	/*
	 * Comments stripped before scanning, and that is load-bearing rather than tidy:
	 * the seams are DESCRIBED in docblocks that name the very calls they replaced
	 * (`useQueryClient()`, `useRadientCredentialProbe()`) - a raw-source scan would
	 * match its own explanation.
	 */
	const source = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
	assert.doesNotMatch(
		source,
		/useQueryClient/,
		"the credential invalidation is the host's callback now (onCredentialsStored)",
	);
	assert.match(
		source,
		/onCredentialsStoredRef\.current\?\.\(sessionId\)/,
		"and the store seam calls it",
	);
	assert.doesNotMatch(
		source,
		/useRadientCredentialProbe/,
		"the credential probe is the host's read now (recordingProbe)",
	);
	assert.match(
		source,
		/onDictationStateChangeRef\.current\?\.\(isRecording\)/,
		"the dictation-state callback is wired",
	);
});

/* ------------------------------------------------------------------ */
/* 6. The chat host wires the new seams                                 */
/* ------------------------------------------------------------------ */

test("the chat keeps its behaviour: the page's probe and callback reach the composer", async () => {
	const content = await readFileSync(
		"src/renderer/src/features/chat/components/chat-content.tsx",
		"utf8",
	);
	assert.match(
		content,
		/useRadientCredentialProbe\(\)/,
		"the chat host answers the credential probe that used to live inside the composer",
	);
	assert.match(
		content,
		/recordingProbe=\{recordingProbe\}/,
		"and passes its answer down",
	);
	assert.match(
		content,
		/onCredentialsStored=/,
		"the credential-store invalidation is wired at the host",
	);
});
