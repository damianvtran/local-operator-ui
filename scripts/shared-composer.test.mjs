import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { installFocusScrollModel } from "./focus-scroll-model.mjs";

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
const mic = { next: null, calls: 0, recorders: [] };
const fakeStream = () => ({ getTracks: () => [{ stop: () => {} }] });
/*
 * A stream whose track stop is observable, for the cases that are ABOUT the
 * teardown (the unmount settle): `fakeStream` discards it, so a case asserting
 * "the microphone was closed" needs its own reading rather than a no-op
 * substitute, and the fake recorder above is captured in `mic.recorders` so
 * "no recorder was ever built" is answerable too.
 */
const stoppingStream = () => {
	const stopped = [];
	return {
		stopped,
		stream: {
			getTracks: () => [
				{
					stop: () => {
						stopped.push("track");
					},
				},
			],
		},
	};
};

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
			/*
			 * Recorded so a case can ask whether a recorder was built at all, and
			 * what state it was left in - the question the unmount settle's first arm
			 * ("no recorder on a dead tree") is exactly about. Other cases ignore it.
			 */
			mic.recorders.push(this);
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

/*
 * THE FOCUSING STEPS' SCROLL HALF, MODELLED (see `focus-scroll-model.mjs`).
 * jsdom moves focus and never scrolls - no layout engine - so without this the
 * difference between a plain `focus()` and `focus({preventScroll: true})` is
 * invisible here, and that difference is what the shared composer's focus
 * contract now rests on: it may claim the caret, never the host page's scroll.
 */
const focusModel = installFocusScrollModel(window);

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

const ipcListeners = new Map();
window.electron = {
	ipcRenderer: {
		// Kept so a case can send the channel main sends (`start-speech-to-text`).
		on: (channel, listener) => {
			ipcListeners.set(channel, listener);
			return () => {};
		},
		removeListener: (channel) => {
			ipcListeners.delete(channel);
		},
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
/*
 * THE `$skill` BODY READ, AS THE CASES ABOUT ITS LATENCY HOLD IT (bug 1).
 *
 * A `skills.list` carrying a `name` is the body read the press used to await.
 * `hold` is a promise the mock does not answer past (a gate the case releases),
 * `latency` answers after a real delay (the structural gate's d), and
 * `unreadable` names a body the daemon refuses - the arm whose notice says the
 * message went as written. `started`/`answered` are the ORDER readings: a press
 * that waited for the wire is visible as "no `onSendMessage` yet" while
 * `started` is already non-empty.
 */
const skillRead = {
	started: [],
	answered: 0,
	hold: null,
	latency: 0,
	unreadable: new Set(),
	reset() {
		this.started = [];
		this.answered = 0;
		this.hold = null;
		this.latency = 0;
		this.unreadable = new Set();
	},
};
globalThis.fetch = async (_url, init) => {
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
		return answer({
			desktop_available: true,
			/*
			 * The sessionless `$skill` reads, advertised the way a live daemon
			 * and the story bridge advertise them - case 1c's mount has a folder,
			 * so the catalogue read and the send's body read turn on this answer
			 * alone, and nothing else in this file passes a `cwd`.
			 */
			features: { catalogues: 1, skill_catalogue: 1 },
		});
	if (request.op === "skills.list") {
		/*
		 * The two shapes one op serves (`skill-picker.tsx`): no `name` is the
		 * vocabulary read, a `name` is the resolved body the send expands.
		 * The body carries no frontmatter block so `skillBodyHasContent` reads
		 * it as content, exactly as a real SKILL.md's instruction half would.
		 */
		if (typeof request.name === "string") {
			/*
			 * THE READ'S OWN INSTRUMENT (see `skillRead`): recorded when it STARTS,
			 * because "the press waited for the read" is a statement about starts and
			 * answers, not about the body that eventually comes back.
			 */
			skillRead.started.push(request.name);
			if (skillRead.hold) await skillRead.hold;
			if (skillRead.latency > 0)
				await new Promise((resolve) =>
					realSetTimeout(resolve, skillRead.latency),
				);
			skillRead.answered += 1;
			if (skillRead.unreadable.has(request.name))
				throw new Error(`skills.list ${request.name} refused`);
			/*
			 * One body per name, because the seam test drives several mentions in
			 * one message and their ORDER is the claim: a stub that answered every
			 * name with the same body would make text order unobservable. `hollow`
			 * answers front matter only, which `skillBodyHasContent` reads as empty
			 * — the skipped-body arm the send has to notice.
			 */
			const bodies = {
				"release-notes": "# release-notes\n\nWrite the release notes.\n",
				research: "# research\n\nRead the code first.\n",
				hollow: "---\nname: hollow\ndescription: A stub\n---\n",
			};
			return answer({ data: { detail: bodies[request.name] ?? null } });
		}
		return answer({
			data: {
				skills: [
					{ name: "release-notes" },
					{ name: "research" },
					{ name: "hollow" },
				],
			},
		});
	}
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
			export { resolvePushToTalkBinding, isDictationActive } from "./src/renderer/src/shared/hooks/use-speech-to-text-manager";
			export { useConversationInputStore } from "./src/renderer/src/shared/store/conversation-input-store";
			export { useCanonicalSessionsStore, paneDraftKey } from "./src/renderer/src/shared/store/canonical-sessions-store";
			export { paintPendingSend, __registerEchoTarget, discardPendingSends } from "./src/renderer/src/shared/hooks/use-canonical-session";
			export {
				dictatedSends,
				useDictatedSendStore,
				resetDictatedSendsForTests,
			} from "./src/renderer/src/features/chat/dictated-send";
			export { t } from "@shared/i18n";
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
	isDictationActive,
	t,
	resolvePushToTalkBinding,
	useConversationInputStore,
	useCanonicalSessionsStore,
	dictatedSends,
	useDictatedSendStore,
	resetDictatedSendsForTests,
	paneDraftKey,
	paintPendingSend,
	__registerEchoTarget,
	discardPendingSends,
} = await import(bundlePath.href);
await unlink(bundlePath);

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = React;
const h = React.createElement;

after(() => {
	for (const id of liveTimers) clearTimeout(id);
	focusModel.restore();
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
	/*
	 * THE HOST PAGE'S SCROLLER, and it is the geometry the focus contract is
	 * about: a composer that claims the caret without `preventScroll` asks its
	 * host's page to move. Inline rather than a class because no stylesheet is
	 * applied here, and the model in `focus-scroll-model.mjs` is what turns a
	 * non-prevented call into that movement.
	 */
	container.style.overflowY = "auto";
	window.document.body.appendChild(container);
	root = createRoot(container);
	/*
	 * `undefined` is the ordinary ACCEPTED outcome (`SendOutcome`). A plain object
	 * is the off-record-ask shape and the guard reads any object as one, so a
	 * `{ ok: true }` stub crashes the first case that actually submits
	 * (`.offRecord.then`).
	 */
	const mountProps = {
		conversationId,
		messages,
		isLoading: false,
		onSendMessage: async () => undefined,
		...composerProps,
	};
	await act(async () => {
		root.render(h(MessageInput, mountProps));
	});
	await settle();
	return {
		container,
		/*
		 * A RE-RENDER WITH NEW PROPS, keeping whatever the case did not name: a
		 * transition INTO a busy turn is a state the composer is rendered into, and
		 * there is no event in jsdom that produces one (the acknowledgment's U7 case
		 * is the caller).
		 */
		rerender: async (next) => {
			await act(async () => {
				root.render(h(MessageInput, { ...mountProps, ...next }));
			});
			await settle();
		},
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
		/*
		 * The empty chat's splash, the surface `transcriptless` exists to withhold.
		 * The HOST is always in the DOM (the band's own class rides `bandCentred`,
		 * and swapping the element would remount the siblings' subtree), so the
		 * visible splash is its inner child - the one without `hidden`. Returning
		 * null for a hidden splash is what makes this a reading about what the user
		 * sees rather than about a node's existence.
		 */
		splash: () => {
			const host = container.querySelector("[data-lo-composer-splash]");
			const inner = host?.firstElementChild ?? null;
			return inner !== null && !inner.className.includes("hidden")
				? inner
				: null;
		},
	};
}

after(async () => {
	await act(async () => {
		root?.unmount();
	});
});

test("the composer notice renders the keyed connect-provider action", async () => {
	/*
	 * A source pin alone mistook the i18n getter for a missing action (#1552).
	 * Read the shipped composer's notice, not the empty-chat connect card: an
	 * action removed from the notice must fail even if that other door survives.
	 */
	const frame = await mount({
		sendError: { message: "No model provider is configured yet" },
	});
	try {
		const labels = Array.from(
			frame.container.querySelectorAll("[data-composer-notice] button"),
			(button) => button.textContent,
		);
		assert.deepEqual(labels, [t("ui.chat.composer.connect_provider")]);
	} finally {
		await act(async () => root.unmount());
	}
});

/* ------------------------------------------------------------------ */
/* 1. The mount blocker: no QueryClient provider, no throw              */
/* ------------------------------------------------------------------ */

test("session metadata rerenders preserve the composer's existing draft caret", async () => {
	try {
		const frame = await mount({ autoFocus: false });
		const field = frame.textarea();
		assert.ok(field);
		const setter = Object.getOwnPropertyDescriptor(
			window.HTMLTextAreaElement.prototype,
			"value",
		).set;
		await act(async () => {
			setter.call(field, "focusproof");
			field.dispatchEvent(new window.Event("input", { bubbles: true }));
		});
		field.focus();
		field.setSelectionRange(2, 6);
		for (let revision = 0; revision < 4; revision++) {
			await frame.rerender({
				messages: [],
				sessionStatus: {
					frontend: null,
					servingLocality: revision % 2 ? "remote" : "local",
				},
			});
			assert.equal(
				frame.textarea(),
				field,
				"session metadata cannot replace the input node",
			);
			assert.equal(document.activeElement, field);
			assert.equal(field.value, "focusproof");
			assert.deepEqual([field.selectionStart, field.selectionEnd], [2, 6]);
		}
	} finally {
		await act(async () => root?.unmount());
	}
});

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

/**
 * A composer bundle whose ONE difference is the provider gate: the real
 * `useOptionalQueryClient`, wrapped to report `provided: true`.
 *
 * Built rather than imported because the gate itself is the question: the
 * shared composer mounts WITHOUT a provider by contract (case 1), so every
 * `provided`-gated read is off in the main bundle — and a mount that must see
 * those reads answer (the forced-open control, and the send seam behind the
 * `$skill` body read) needs the gate forced from outside the module graph.
 * `@shared/hooks/use-optional-query-client` is the ONLY module the alias
 * replaces: everything else resolves exactly as the main bundle resolves, so
 * the mounted component is the shipped composer.
 */
let providedBundleSeq = 0;
async function buildProvidedComposerBundle() {
	const seq = ++providedBundleSeq;
	const stubPath = new URL(
		`./_shared-composer-forced-stub-${process.pid}-${seq}.mjs`,
		import.meta.url,
	);
	await writeFile(
		stubPath,
		[
			`import { useOptionalQueryClient as real } from ${JSON.stringify(`${worktree}/src/renderer/src/shared/hooks/use-optional-query-client`)};`,
			"export const useOptionalQueryClient = () => ({ ...real(), provided: true });",
		].join("\n"),
	);
	const bundle = await build({
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
			"@shared/hooks/use-optional-query-client": stubPath.pathname,
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
		`./_shared-composer-forced-${process.pid}-${seq}.mjs`,
		import.meta.url,
	);
	await writeFile(bundlePath, bundle.outputFiles[0].text);
	const module = await import(bundlePath.href);
	await unlink(bundlePath);
	await unlink(stubPath);
	return module;
}

/* ------------------------------------------------------------------ */
/* 1b. The negative control: the same instrument, gate forced open      */
/* ------------------------------------------------------------------ */

test("forcing the fallback to report provided:true fires the ops case 1 refuses", async () => {
	/*
	 * THE CONTROL THAT MAKES CASE 1's ZEROS READINGS RATHER THAN SILENCE. The
	 * reviewer's reproduction (review round 1, MINOR 1): with the seam answering
	 * `provided: true`, this mount fires the capability census and the host-gated
	 * lists - 28 fetches in that reproduction - while every other assertion
	 * stayed green. This case mounts the forced bundle (the most specific alias
	 * wins over `@shared`) exactly the way the rig mounts, and reads the SAME
	 * instrument: non-zero here is what makes case 1's zeros the gate's rather
	 * than a broken recorder.
	 */
	const { MessageInput: ForcedMessageInput } =
		await buildProvidedComposerBundle();

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
				onSendMessage: async () => undefined,
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
/* 1c. The draft send seam: the composed `$skill` payload survives it   */
/* ------------------------------------------------------------------ */

test("the draft send seam composes the new `$skill` block for every mention (B1)", async () => {
	/*
	 * THE SUBMIT SEAM, EXECUTED — the only mount-level test of it. On a draft
	 * pane the composer hands the store a `beforeAdmission` seam, and the store
	 * LETS ITS RETURN REPLACE the text the press built
	 * (`admitChatDraft`: `(await beforeAdmission(id)) ?? text`); this case drives
	 * the SHIPPED composer's `submitNow`, takes the seam the host is handed,
	 * invokes it the way the store does, and reads the first argument the host
	 * received. The store's half — "the seam's answer is what is sent" — is
	 * pinned in `canonical-chat.test.mjs`; together they cover the chain that
	 * failed end to end in QA round 1 (Q-1).
	 *
	 * THE ROWS ARE THE CONTRACT NOW: the payload is the typed text verbatim and
	 * one `<operator-skills>` tail block carrying one body per fired name, in
	 * text order, deduped by resolved name. A skill whose body is empty is
	 * skipped with its notice and the rest still attach; when none attach, the
	 * message is still sent, unchanged. The expected blocks below are written
	 * out here (not produced by `renderSkillBlock`) so the bytes are a fixture,
	 * not a mirror of the implementation.
	 */
	const EXPECTED_BODIES = {
		research: "# research\n\nRead the code first.\n",
		"release-notes": "# release-notes\n\nWrite the release notes.\n",
	};
	const SKILL_PREAMBLE =
		"The user invoked the following skills directly. Follow them for this request. Their reference files, if any, are listed at the end of each body and are read with `skill://<name>/<path>`.";
	const expectedBlock = (entries) =>
		`<operator-skills>\n\n${SKILL_PREAMBLE}\n\n${entries
			.map(([name, body]) => `<skill name="${name}">\n${body}\n</skill>`)
			.join("\n\n")}\n\n</operator-skills>`;

	const { MessageInput: ProvidedMessageInput } =
		await buildProvidedComposerBundle();
	const valueSetter = Object.getOwnPropertyDescriptor(
		window.HTMLTextAreaElement.prototype,
		"value",
	).set;

	/**
	 * Mount a draft composer, wait for its own vocabulary read, type `draft`,
	 * press Send once, and read what the host was handed.
	 *
	 * A UNIQUE `cwd` per case is what makes the wait a reading rather than a
	 * sleep: the sessionless catalogue key includes the folder, so each mount
	 * fires its own `skills.list` and the case waits for THAT one instead of
	 * trusting a cache another mount primed.
	 */
	const sendDraft = async (draft) => {
		const sent = [];
		const notes = [];
		const container = window.document.createElement("div");
		window.document.body.appendChild(container);
		const seamRoot = createRoot(container);
		let handle = null;
		const cwd = `~/seam-${++mountSeq}`;
		/*
		 * The baseline is read BEFORE the render: the vocabulary query fires
		 * during the mount's own settle, so a baseline taken afterwards would
		 * count that read and then wait for a second one that never comes.
		 */
		const before = transportOps.filter((op) => op === "skills.list").length;
		await act(async () => {
			seamRoot.render(
				h(ProvidedMessageInput, {
					conversationId: `shared-composer-seam-${++mountSeq}`,
					messages: [],
					isLoading: false,
					/*
					 * A DRAFT PANE, BY CONSTRUCTION: no `sessionStatus` means
					 * `credentialSessionId` is undefined — the ONE condition that hands
					 * the host a seam (`message-input.tsx`).
					 */
					cwd,
					onSlashNote: (text) => notes.push(text),
					ref: (node) => {
						handle = node;
					},
					onSendMessage: async (...args) => {
						sent.push(args);
						// The ordinary accepted outcome: `undefined`, never an object
						// (the off-record-ask shape the guard reads into any object).
						return undefined;
					},
				}),
			);
		});
		await settle();
		const reads = () =>
			transportOps.filter((op) => op === "skills.list").length;
		for (let pass = 0; pass < 40 && reads() === before; pass++) {
			await settle();
		}
		assert.ok(
			reads() > before,
			`the sessionless vocabulary read fired for ${cwd}`,
		);
		await settle();
		assert.ok(handle?.submitNow, "the composer's handle is mounted");

		const field = container.querySelector("textarea");
		await act(async () => {
			valueSetter.call(field, draft);
			field.dispatchEvent(new window.Event("input", { bubbles: true }));
		});
		await settle();
		assert.equal(field.value, draft);

		await act(async () => {
			handle.submitNow();
		});
		await settle();
		assert.equal(sent.length, 1, "the message always sends");
		const [content, , , typed, seam] = sent[0];
		assert.equal(typed, draft, "the fourth argument is the typed text");
		/*
		 * AND THE SEAM'S ANSWER IS THE PAYLOAD (the regression proper): the store
		 * sends this string verbatim - `?? text` is only for a seam that declines.
		 */
		const rendered =
			typeof seam === "function" ? await seam("1234567890ab") : undefined;
		await act(async () => {
			seamRoot.unmount();
		});
		container.remove();
		return { content, notes, rendered, seam, typed };
	};

	// ONE MENTION: the payload is the typed line and the block, byte for byte.
	{
		const draft = "$release-notes QA fixture: summarise today.";
		const run = await sendDraft(draft);
		assert.equal(
			run.content,
			`${draft}\n\n${expectedBlock([
				["release-notes", EXPECTED_BODIES["release-notes"]],
			])}`,
			"the first argument is the composed payload, not the raw line",
		);
		assert.equal(
			typeof run.seam,
			"function",
			"a draft pane hands the host a seam",
		);
		assert.equal(
			run.rendered,
			run.content,
			"the seam composes rather than replaces - the payload survives it",
		);
		assert.notEqual(run.rendered, run.typed, "and it is not the typed line");
		assert.deepEqual(run.notes, [], "a readable body says nothing");
	}

	// TWO MENTIONS: one block, bodies in TEXT order, not vocabulary order.
	{
		const draft = "compare $research and $release-notes now";
		const run = await sendDraft(draft);
		assert.equal(
			run.content,
			`${draft}\n\n${expectedBlock([
				["research", EXPECTED_BODIES.research],
				["release-notes", EXPECTED_BODIES["release-notes"]],
			])}`,
		);
	}

	// DEDUPE BY RESOLVED NAME: `$Research` is the same skill, so one body.
	{
		const draft = "$research then $Research again";
		const run = await sendDraft(draft);
		assert.equal(
			run.content,
			`${draft}\n\n${expectedBlock([["research", EXPECTED_BODIES.research]])}`,
			"the second spelling adds no second body",
		);
		assert.equal(
			run.content.match(/<skill name=/g)?.length,
			1,
			"one element, not two",
		);
	}

	// ONE EMPTY BODY: skipped with its notice, the other still attaches.
	{
		const draft = "$hollow and $research fix";
		const run = await sendDraft(draft);
		assert.equal(
			run.content,
			`${draft}\n\n${expectedBlock([["research", EXPECTED_BODIES.research]])}`,
			"the empty skill is not in the block",
		);
		assert.deepEqual(run.notes, [
			"skill `hollow` has an empty body — sending your message as written",
		]);
	}

	// ALL EMPTY: no block at all, and the message STILL sends unchanged.
	{
		const draft = "$hollow please";
		const run = await sendDraft(draft);
		assert.equal(run.content, draft, "the typed line goes through untouched");
		assert.deepEqual(run.notes, [
			"skill `hollow` has an empty body — sending your message as written",
		]);
	}
});

/* ------------------------------------------------------------------ */
/* 1e. The press does not wait for the bodies (bug 1)                  */
/* ------------------------------------------------------------------ */

test("an attached composer reaches the host before the `$skill` bodies are read, and the seam composes them (bug 1)", async () => {
	/*
	 * THE OPERATOR'S REPORT: "I press enter and it's ... up to a second when there
	 * are skills noted in the message too. this shouldn't be the case, it should
	 * be instant or at least appear instant and run in the background if needed".
	 *
	 * WHAT WAS SLOW, IN THIS FILE'S OWN TERMS. The press used to loop over the
	 * planned names and `await readSkillBody` once per name BEFORE `onSendMessage`,
	 * so the bubble and the box waited on one desktop IPC and one daemon catalogue
	 * scan per name. Nothing else on the press path fetches: the credential rewrite
	 * early-returns when the text cites nothing.
	 *
	 * THE CONTRACT PINNED HERE. On a pane whose host honours `admissionSeamHonoured`
	 * the first argument is the TYPED line, the bodies ride the fifth (the seam),
	 * and the host is reached while the reads are still in flight. The base has
	 * `sent.length === 0` under the same gate, which is the defect this case
	 * exists for.
	 *
	 * AND THE STRUCTURAL GATE THE BRIEF ASKS FOR: the same press at injected
	 * read latencies d in {0, 70, 250, 1000} ms. A press that waits for the read
	 * cannot pass a single one of them, and the assertion is about SHAPE and ORDER
	 * (`onSendMessage` issued while `started` is non-empty and `answered` is 0),
	 * never about milliseconds - jsdom has no clock worth quoting.
	 */
	const EXPECTED_BODIES = {
		research: "# research\n\nRead the code first.\n",
		"release-notes": "# release-notes\n\nWrite the release notes.\n",
	};
	const SKILL_PREAMBLE =
		"The user invoked the following skills directly. Follow them for this request. Their reference files, if any, are listed at the end of each body and are read with `skill://<name>/<path>`.";
	const expectedBlock = (entries) =>
		`<operator-skills>\n\n${SKILL_PREAMBLE}\n\n${entries
			.map(([name, body]) => `<skill name="${name}">\n${body}\n</skill>`)
			.join("\n\n")}\n\n</operator-skills>`;
	const NOTE_EMPTY =
		"skill `hollow` has an empty body — sending your message as written";
	const NOTE_FAILED =
		"could not load skill `hollow` — sending your message as written";

	const { MessageInput: ProvidedMessageInput } =
		await buildProvidedComposerBundle();
	const valueSetter = Object.getOwnPropertyDescriptor(
		window.HTMLTextAreaElement.prototype,
		"value",
	).set;

	/** One promise and its handle, for a gate a case releases by hand. */
	const deferred = () => {
		let release;
		const promise = new Promise((resolve) => {
			release = resolve;
		});
		return { promise, release };
	};

	/**
	 * An ATTACHED pane (`sessionStatus` present, not a draft - the one condition
	 * that makes `credentialSessionId` defined), typed into and pressed ONCE.
	 *
	 * The reading is taken while whatever the case gated is still held, so
	 * `whileHeld` describes the press and not the settle: `sent` is what the host
	 * was handed by then, `started`/`answered` are the reads'. The gate is then
	 * released and the seam is invoked the way `admitChatDraft` does, which is the
	 * only place the composed payload can come from now.
	 */
	const pressAttached = async (
		draft,
		{
			admissionSeamHonoured = true,
			gate = null,
			latency = 0,
			unreadable = [],
		} = {},
	) => {
		skillRead.reset();
		skillRead.hold = gate?.promise ?? null;
		skillRead.latency = latency;
		for (const name of unreadable) skillRead.unreadable.add(name);
		const sent = [];
		const notes = [];
		const container = window.document.createElement("div");
		window.document.body.appendChild(container);
		const paneRoot = createRoot(container);
		let handle = null;
		const cwd = `~/attached-${++mountSeq}`;
		const before = transportOps.filter((op) => op === "skills.list").length;
		await act(async () => {
			paneRoot.render(
				h(ProvidedMessageInput, {
					conversationId: `shared-composer-attached-${++mountSeq}`,
					messages: [],
					isLoading: false,
					// Attached: a session exists, so the pane stores credentials itself.
					sessionStatus: { frontend: null },
					admissionSeamHonoured,
					cwd,
					onSlashNote: (text) => notes.push(text),
					ref: (node) => {
						handle = node;
					},
					onSendMessage: async (...args) => {
						sent.push(args);
						return undefined;
					},
				}),
			);
		});
		await settle();
		const reads = () =>
			transportOps.filter((op) => op === "skills.list").length;
		for (let pass = 0; pass < 40 && reads() === before; pass++) {
			await settle();
		}
		assert.ok(
			reads() > before,
			`the sessionless vocabulary read fired for ${cwd}`,
		);
		const field = container.querySelector("textarea");
		await act(async () => {
			valueSetter.call(field, draft);
			field.dispatchEvent(new window.Event("input", { bubbles: true }));
		});
		await settle();
		assert.ok(handle?.submitNow, "the composer's handle is mounted");
		await act(async () => {
			handle.submitNow();
		});
		/*
		 * ONE SETTLE, NOT A WAIT ON THE READ. `settle` flushes microtasks and a few
		 * zero-delay macrotasks; a gated or delayed read cannot answer inside it, so
		 * what is read here is the press's own reach.
		 */
		await settle();
		const whileHeld = {
			sent: sent.length,
			started: [...skillRead.started],
			answered: skillRead.answered,
		};
		skillRead.hold = null;
		gate?.release();
		await settle();
		const [content, , , typed, seam] = sent[0] ?? [];
		const rendered =
			typeof seam === "function" ? await seam("1234567890ab") : undefined;
		await act(async () => {
			paneRoot.unmount();
		});
		container.remove();
		return { content, notes, rendered, seam, typed, whileHeld };
	};

	// ONE MENTION, HELD: the host is reached while the body read is in flight.
	{
		const draft = "$release-notes QA fixture: summarise today.";
		const run = await pressAttached(draft, { gate: deferred() });
		assert.equal(
			run.whileHeld.sent,
			1,
			"the press reaches the host while the body read is still held - on the base this is 0, which is the reported lag",
		);
		assert.deepEqual(
			run.whileHeld.started,
			["release-notes"],
			"and the read it did not wait for had already started",
		);
		assert.equal(run.content, draft, "the first argument is the typed line");
		assert.equal(
			run.typed,
			draft,
			"the fourth argument is still the typed text",
		);
		assert.equal(
			typeof run.seam,
			"function",
			"an attached pane whose bodies are still owed hands the host a seam",
		);
		assert.equal(
			run.rendered,
			`${draft}\n\n${expectedBlock([
				["release-notes", EXPECTED_BODIES["release-notes"]],
			])}`,
			"the seam composes the payload the press used to compose",
		);
		assert.deepEqual(run.notes, [], "a readable body says nothing");
	}

	// THREE MENTIONS, HELD: every read is issued before any of them answers.
	{
		const draft = "compare $research and $release-notes and $hollow now";
		const run = await pressAttached(draft, { gate: deferred() });
		assert.equal(run.whileHeld.sent, 1, "still one press, still immediate");
		assert.deepEqual(
			run.whileHeld.started,
			["research", "release-notes", "hollow"],
			"all three reads are issued together, in text order",
		);
		assert.equal(
			run.whileHeld.answered,
			0,
			"and none of them had answered when the host was reached",
		);
		assert.equal(
			run.rendered,
			`${draft}\n\n${expectedBlock([
				["research", EXPECTED_BODIES.research],
				["release-notes", EXPECTED_BODIES["release-notes"]],
			])}`,
			"the block carries the readable bodies in text order, the stub skipped",
		);
		assert.deepEqual(run.notes, [NOTE_EMPTY]);
	}

	// DEDUPE BY RESOLVED NAME: one read, one body.
	{
		const draft = "$research then $Research again";
		const run = await pressAttached(draft, { gate: deferred() });
		assert.deepEqual(
			run.whileHeld.started,
			["research"],
			"the second spelling costs no second read",
		);
		assert.equal(
			run.rendered,
			`${draft}\n\n${expectedBlock([["research", EXPECTED_BODIES.research]])}`,
		);
	}

	// ALL EMPTY: no block, the note still raised, the message goes as written.
	{
		const draft = "$hollow please";
		const run = await pressAttached(draft, { gate: deferred() });
		assert.equal(run.rendered, draft, "the typed line goes through untouched");
		assert.deepEqual(
			run.notes,
			[NOTE_EMPTY],
			"the notice is raised from the seam, after the box has been handed back",
		);
	}

	// A READ THE DAEMON REFUSES: per-name notice, no block, message as written.
	{
		const draft = "$hollow fix";
		const run = await pressAttached(draft, {
			gate: deferred(),
			unreadable: ["hollow"],
		});
		assert.equal(run.rendered, draft);
		assert.deepEqual(run.notes, [NOTE_FAILED]);
	}

	// A HOST THAT DOES NOT HONOUR THE SEAM: the pre-change contract, whole.
	{
		const draft = "$research fix";
		const run = await pressAttached(draft, {
			admissionSeamHonoured: false,
			gate: deferred(),
		});
		assert.equal(
			run.whileHeld.sent,
			0,
			"a host that cannot take the seam is not sent a line it would have to compose itself - the press waits, as it always did",
		);
		assert.equal(
			run.content,
			`${draft}\n\n${expectedBlock([["research", EXPECTED_BODIES.research]])}`,
			"and its first argument is the composed payload",
		);
		assert.equal(
			run.seam,
			undefined,
			"an attached pane with nothing left to settle hands no seam",
		);
	}

	// THE STRUCTURAL GATE: the press's reach does not depend on the read's delay.
	for (const d of [0, 70, 250, 1000]) {
		const draft = "$research what changed";
		const run = await pressAttached(draft, { latency: d });
		assert.equal(
			run.whileHeld.sent,
			1,
			`d=${d}ms: the host is reached before the body read answers`,
		);
		assert.deepEqual(
			run.whileHeld.started,
			["research"],
			`d=${d}ms: the read the press skipped had started`,
		);
		assert.equal(
			run.rendered,
			`${draft}\n\n${expectedBlock([["research", EXPECTED_BODIES.research]])}`,
			`d=${d}ms: the payload is composed identically whatever the delay`,
		);
	}
	/*
	 * THE "AND HAD NOT ANSWERED YET" HALF IS HELD, NOT TIMED (round-1 finding,
	 * reviewer M1). It used to be asserted inside the loop above, against a real
	 * 70/250/1000 ms timer, with the reading taken after one `settle` - so on a
	 * loaded machine the read could answer inside that settle and fail a behaviour
	 * that was correct. The gate deferred is the same fact with no race in it, and
	 * it is the instrument the held case at the top of this test already uses; the
	 * loop keeps its ordering claims, which are about the press and the read
	 * STARTING, and never about how fast the wire is.
	 */
	{
		const draft = "$research what changed";
		const run = await pressAttached(draft, { gate: deferred() });
		assert.equal(
			run.whileHeld.sent,
			1,
			"the host was reached while the read was held",
		);
		assert.deepEqual(
			run.whileHeld.started,
			["research"],
			"the read the press skipped had started",
		);
		assert.equal(
			run.whileHeld.answered,
			0,
			"and had not answered when the host was reached",
		);
	}
});

/* ------------------------------------------------------------------ */
/* 1d. Q-3: an unpaired daemon hears NO catalogue read, per mount      */
/* ------------------------------------------------------------------ */

test("an unpaired daemon gets zero `skills.list` reads across a fresh mount and a forced remount (QA round 2, Q-3)", async () => {
	/*
	 * THE Q-3 REGRESSION. The pairing gate removed reads AFTER a refusal was
	 * known, but a fresh mount starts with no answer YET — and "not refused
	 * yet" is not "good to ask": QA measured one refused `skills.list` per
	 * mount, six a run (four at boot, two in a forced-remount window). The
	 * composer under test is the shipped tree again (the forced-provider bundle
	 * — the only way `skills.list` can fire at all in a providerless harness),
	 * with the pairing bridge answering as main does for a daemon that refused
	 * this app's credential. The instrument is `transportOps`, which case 1c
	 * shows reporting non-zero on this exact op; the paired control at the end
	 * re-proves the instrument mid-case rather than borrowing another case's
	 * reading.
	 */
	const { MessageInput: ProvidedMessageInput } =
		await buildProvidedComposerBundle();
	const backend = {
		getStatus: async () => ({
			pairing: { available: false, cause: "credential-refused" },
		}),
		onStatusChange: () => () => {},
	};
	window.api = { backend };
	const skillsReads = () =>
		transportOps.filter((op) => op === "skills.list").length;

	const mountOnce = async (suffix) => {
		useConversationInputStore.setState({ inputByConversation: {} });
		const container = window.document.createElement("div");
		window.document.body.appendChild(container);
		const mountRoot = createRoot(container);
		await act(async () => {
			mountRoot.render(
				h(ProvidedMessageInput, {
					conversationId: `shared-composer-q3-${suffix}-${++mountSeq}`,
					messages: [],
					isLoading: false,
					cwd: "~",
					onSendMessage: async () => undefined,
				}),
			);
		});
		await settle();
		return mountRoot;
	};

	transportOps.length = 0;
	const first = await mountOnce("first");
	assert.equal(
		skillsReads(),
		0,
		"a fresh mount on the refused daemon fires no catalogue read",
	);
	await act(async () => {
		first.unmount();
	});
	/* The forced-remount window: a new composer against the same refused daemon. */
	const second = await mountOnce("second");
	assert.equal(
		skillsReads(),
		0,
		"and the remount fires none either — the unknown answer fails closed",
	);
	await act(async () => {
		second.unmount();
	});

	/*
	 * THE CONTROL, mid-case: the same counter against a PAIRED daemon must read
	 * non-zero, or the zeros above would be a recorder that cannot count.
	 */
	backend.getStatus = async () => ({
		pairing: { available: true, cause: null },
	});
	const paired = await mountOnce("paired");
	assert.ok(
		skillsReads() >= 1,
		"the paired control fires it on the same counter — the zeros are the gate's",
	);
	await act(async () => {
		paired.unmount();
	});
	window.api = undefined;
});

/* ------------------------------------------------------------------ */
/* 2. The density prop: explicit, and it reaches the surface            */
/* ------------------------------------------------------------------ */

test("transcriptless withholds the empty-chat splash a host with no transcript must not claim", async () => {
	/*
	 * THE MINI VIEW'S PROP (restyle slice 2). A host that passes `messages: []`
	 * because it has NO transcript - not because the transcript is loading - must
	 * not be shown the greeting, the mark and the suggestion chips: those are the
	 * empty CHAT's splash, and a hotkey-summoned quick-send box claiming one would
	 * be asserting a conversation it does not have. `isHydrating` is a different
	 * fact (a page is still owed), so it cannot stand in - which is why the host
	 * declares its shape outright.
	 */
	const plain = await mount({ messages: [] });
	assert.ok(
		plain.splash() !== null,
		"an empty transcript-bearing host keeps the splash it always had",
	);
	await act(async () => {
		root.unmount();
	});

	const quickSend = await mount({ messages: [], transcriptless: true });
	assert.equal(
		quickSend.splash(),
		null,
		"the transcriptless host gets the box and its own chrome, never the greeting",
	);
	assert.ok(
		quickSend.textarea() !== null,
		"and the composer itself is still mounted: the box is the point",
	);
	await act(async () => {
		root.unmount();
	});
});

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
		/*
		 * The probe is the host's read now, carrying the shared capability and the
		 * copy's class (`canUseRadientSpeech` + `speechBlock` — see
		 * `@shared/lib/speech-gate`; issue #674). A live capability is what this
		 * case needs, so the block is inert.
		 */
		recordingProbe: {
			canUseRadientSpeech: true,
			speechBlock: "could-not-check",
		},
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

/*
 * INSTANT ACKNOWLEDGMENT (operator feedback via Aida, 2026-10-01: the mic
 * "sometimes lags on click"). The acquisition window is the slow part of the
 * click path - a cold `getUserMedia` has measured 830 ms to over 2.6 s on this
 * fleet - and NOTHING used to change on screen during it, so the press read as
 * dropped. The three cases below drive the SHIPPED React wiring with a
 * DEFERRED stream: they hold the acquisition pending and read what the
 * composer shows DURING that window, then let the stream land, fail, or be
 * released-under. They pin the lifecycle, not the pixels: whether the
 * acknowledgment reads clearly is the evidence rig's half.
 */
test("the mic acknowledges the press while the stream is still pending, and the acknowledgment becomes the recording state", async () => {
	mic.calls = 0;
	let release = () => {};
	mic.next = () =>
		new Promise((resolve) => {
			release = () => resolve(fakeStream());
		});
	const frame = await mount({
		recordingProbe: {
			canUseRadientSpeech: true,
			speechBlock: "could-not-check",
		},
	});
	const preparing = () =>
		frame.container.querySelector("[data-preparing-indicator]");
	const micControl = () =>
		frame.container.querySelector('[aria-label="Start recording"]');
	const confirm = () =>
		frame.container.querySelector('[aria-label="Insert transcript"]');

	assert.ok(micControl(), "the mic control is mounted");
	await act(async () => {
		micControl().click();
	});
	assert.equal(mic.calls, 1, "the press reached the microphone");
	assert.ok(
		preparing(),
		"the acknowledgment is on screen while getUserMedia is still pending",
	);
	assert.equal(
		micControl()?.getAttribute("aria-busy"),
		"true",
		"the control itself carries the busy state",
	);
	assert.equal(
		micControl()?.disabled,
		false,
		"the control stays pressable while it acknowledges (design round 1, D1): the guard is the handler's, not a `disabled` that makes the control the user just pressed inert",
	);
	assert.equal(
		isDictationActive(),
		true,
		"the Escape ladder's presence covers the press window, not only a live take (UX round 1, U1)",
	);
	assert.equal(
		confirm(),
		null,
		"no recording control exists before the stream resolves",
	);
	/*
	 * The distinction the assertion above buys: a second press inside the window
	 * is refused by the HANDLER's own guard, which is the door the hold contract
	 * also reaches - so `disabled` was never what protected the attempt.
	 */
	await act(async () => {
		micControl().click();
	});
	assert.equal(
		mic.calls,
		1,
		"a second press inside the window does not double the acquisition",
	);

	/* The indicator's own analyser acquisition resolves too, once recording starts. */
	mic.next = async () => fakeStream();
	await act(async () => {
		release();
	});
	await settle();
	assert.equal(preparing(), null, "the acknowledgment gives way");
	assert.ok(confirm(), "the recording state arrives");

	await act(async () => {
		root.unmount();
	});
	mic.next = null;
});

/*
 * ESCAPE SETTLES THE ACKNOWLEDGMENT WINDOW (UX round 1, U1). The key was inert
 * while the stream was pending, so a press the user took back still landed; and
 * because the ladder reads `isDictationActive()` at KEY TIME, the composer has
 * to claim the window for the press rather than leave the turn to answer it.
 * The stream is still released afterwards, which is the arm that must discard
 * it: an Escape is a settle, not a leak.
 */
test("Escape settles the acknowledgment window and the discarded stream never becomes a recording", async () => {
	mic.calls = 0;
	let release = () => {};
	mic.next = () =>
		new Promise((resolve) => {
			release = () => resolve(fakeStream());
		});
	const frame = await mount({
		recordingProbe: {
			canUseRadientSpeech: true,
			speechBlock: "could-not-check",
		},
	});
	const preparing = () =>
		frame.container.querySelector("[data-preparing-indicator]");
	const micControl = () =>
		frame.container.querySelector('[aria-label="Start recording"]');
	const confirm = () =>
		frame.container.querySelector('[aria-label="Insert transcript"]');

	await act(async () => {
		micControl().click();
	});
	assert.ok(preparing(), "the acknowledgment is up before the escape");

	const escapeKey = new window.KeyboardEvent("keydown", {
		key: "Escape",
		bubbles: true,
		cancelable: true,
	});
	await act(async () => {
		window.dispatchEvent(escapeKey);
	});
	assert.equal(
		escapeKey.defaultPrevented,
		true,
		"the composer claims the key, so the page's ladder does not read it as the turn's",
	);
	assert.equal(
		preparing(),
		null,
		"the acknowledgment answers the key in the frame it arrives in",
	);
	assert.equal(
		micControl()?.getAttribute("aria-busy"),
		null,
		"and the control returns to rest",
	);

	/* The pending acquisition lands anyway - the marked attempt is what it lands on. */
	mic.next = async () => fakeStream();
	await act(async () => {
		release();
	});
	await settle();
	assert.equal(
		confirm(),
		null,
		"a cancelled press never becomes a recording state",
	);
	assert.equal(
		preparing(),
		null,
		"nor does it come back when the stream resolves",
	);

	await act(async () => {
		root.unmount();
	});
	mic.next = null;
});

/*
 * THE WINDOW RE-OPENS, AND A PRESS THAT LOOKS AVAILABLE IS NOT DEAD (UX round 2,
 * U6). A release inside the acquisition used to leave the attempt in the ref, so
 * the control painted at rest and silently swallowed the next press - both
 * doors, no acknowledgment, no acquisition - for the rest of the wait. The
 * abandoned attempt is now dropped from the ref, which makes the next press a
 * fresh one, and the abandoned stream is discarded by IDENTITY in the resolve
 * arm (which is what keeps the fix from orphaning a live recorder).
 */
test("a release inside the window re-opens it: the next press is a fresh attempt, and the abandoned stream is discarded", async () => {
	mic.calls = 0;
	const resolvers = [];
	const stopped = [];
	mic.next = () =>
		new Promise((resolve) => {
			resolvers.push(() =>
				resolve({ getTracks: () => [{ stop: () => stopped.push(1) }] }),
			);
		});
	const frame = await mount({
		recordingProbe: {
			canUseRadientSpeech: true,
			speechBlock: "could-not-check",
		},
	});
	const preparing = () =>
		frame.container.querySelector("[data-preparing-indicator]");
	const micControl = () =>
		frame.container.querySelector('[aria-label="Start recording"]');
	const confirm = () =>
		frame.container.querySelector('[aria-label="Insert transcript"]');

	/* The hold door: pressed and released inside the acquisition. */
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
	assert.ok(preparing(), "the hold's press is acknowledged");
	await act(async () => {
		window.dispatchEvent(
			new window.KeyboardEvent("keyup", {
				code,
				bubbles: true,
				cancelable: true,
			}),
		);
	});
	assert.equal(
		preparing(),
		null,
		"the release ends the acknowledgment window (MAJOR 1)",
	);

	/* THE PRESS THAT LOOKS AVAILABLE MUST NOT BE DEAD. */
	await act(async () => {
		micControl().click();
	});
	assert.equal(
		mic.calls,
		2,
		"a second press inside the abandoned window reaches the microphone",
	);
	assert.ok(
		preparing(),
		"and it is acknowledged in its own frame, like any other press",
	);

	/* The abandoned acquisition lands: it must be stopped, and it must not record. */
	await act(async () => {
		resolvers[0]();
	});
	await settle();
	assert.equal(
		confirm(),
		null,
		"the abandoned stream never becomes a recording",
	);
	assert.ok(
		stopped.length >= 1,
		"and its tracks are stopped rather than left live (the orphan the release used to avoid by keeping the ref)",
	);
	assert.ok(
		preparing(),
		"the second press's own acknowledgment is still the one on screen",
	);

	/* While the second press's own acquisition still lands normally. */
	mic.next = async () => fakeStream();
	await act(async () => {
		resolvers[1]();
	});
	await settle();
	assert.ok(
		confirm(),
		"the second press becomes a recording when its stream arrives",
	);

	await act(async () => {
		root.unmount();
	});
	mic.next = null;
});

/*
 * AN ABANDONED PRESS'S REFUSAL IS NOT THE SUCCESSOR'S (convergence round 1,
 * MAJOR). The resolve arm's identity check was the U6 fix, and the CATCH arm
 * needed the same one: an abandoned acquisition that REJECTS used to null
 * `recordingAttemptRef` and clear the face, so the second press's acknowledgment
 * vanished and its own arriving stream was then discarded by the very check
 * meant to protect it (reviewer's probe: `press2BecameRecording=false`), with a
 * stale error toast about a press the user had already replaced. Both legs of the
 * U6 case above RESOLVE, which is why this one is separate.
 */
test("a refusal belonging to an abandoned press leaves the successor's attempt alone", async () => {
	mic.calls = 0;
	const pending = [];
	mic.next = () =>
		new Promise((resolve, reject) => {
			pending.push({ resolve, reject });
		});
	const frame = await mount({
		recordingProbe: {
			canUseRadientSpeech: true,
			speechBlock: "could-not-check",
		},
	});
	const preparing = () =>
		frame.container.querySelector("[data-preparing-indicator]");
	const micControl = () =>
		frame.container.querySelector('[aria-label="Start recording"]');
	const confirm = () =>
		frame.container.querySelector('[aria-label="Insert transcript"]');
	const lane = () =>
		frame.container.querySelector("[data-recording-indicator]");

	/* Press 1 on the hold door, released inside the window: abandoned. */
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
	await act(async () => {
		window.dispatchEvent(
			new window.KeyboardEvent("keyup", {
				code,
				bubbles: true,
				cancelable: true,
			}),
		);
	});

	/* Press 2 on the click door: a fresh attempt, acknowledged. */
	await act(async () => {
		micControl().click();
	});
	assert.equal(mic.calls, 2, "the second press acquired the microphone");
	assert.ok(preparing(), "and it is acknowledged");

	/* Now the ABANDONED acquisition refuses, after the successor exists. */
	await act(async () => {
		pending[0].reject(new Error("NotAllowedError"));
	});
	await settle();
	assert.ok(
		preparing(),
		"the successor's acknowledgment is still on screen - the refusal is not its own",
	);
	assert.equal(
		confirm(),
		null,
		"and the refusal did not settle it into a recording",
	);

	/* And the successor's own stream still lands, which is what the guard protects. */
	await act(async () => {
		pending[1].resolve(fakeStream());
	});
	await settle();
	assert.ok(
		confirm(),
		"the second press becomes a recording when its own stream arrives",
	);
	assert.ok(lane(), "with the lane the user confirms or cancels");

	await act(async () => {
		root.unmount();
	});
	mic.next = null;
});

/*
 * AN UNMOUNT SETTLES THE PRESS IT OWNS (round 2 follow-up, M3). The attempt and
 * the recorder live in refs the composer owns, and nothing else nulls them, so
 * before this the two arms below were the same leak in two shapes: an unmount
 * inside the acquisition window left the ref pointing at the attempt, the
 * arriving stream passed the resolve arm's identity check, and a recorder was
 * built and started for a tree that no longer exists - a live microphone with no
 * control left to end it - while an unmount mid-take left the running recorder
 * behind the same way. Both cases drive the shipped wiring, and both fail on the
 * pre-fix tree: the stream's track is never stopped, and in the first a recorder
 * is constructed at all.
 */
test("an unmount inside the acquisition window abandons the press, and the stream it lands on is stopped", async () => {
	mic.calls = 0;
	mic.recorders = [];
	const { stream, stopped } = stoppingStream();
	let release = () => {};
	mic.next = () =>
		new Promise((resolve) => {
			release = () => resolve(stream);
		});
	const frame = await mount({
		recordingProbe: {
			canUseRadientSpeech: true,
			speechBlock: "could-not-check",
		},
	});
	const preparing = () =>
		frame.container.querySelector("[data-preparing-indicator]");

	await act(async () => {
		frame.container.querySelector('[aria-label="Start recording"]').click();
	});
	assert.equal(mic.calls, 1, "the press reached the microphone");
	assert.ok(preparing(), "and it is acknowledged while the stream is pending");

	await act(async () => {
		root.unmount();
	});

	/* The acquisition lands AFTER the unmount - the window this arm exists for. */
	await act(async () => {
		release();
	});
	await settle();
	assert.deepEqual(
		stopped,
		["track"],
		"the abandoned press's stream was stopped rather than left open",
	);
	assert.equal(
		mic.recorders.length,
		0,
		"and no recorder was ever built for the unmounted tree",
	);
	mic.next = null;
});

test("an unmount during a live take stops the recorder rather than leaving the microphone open", async () => {
	mic.calls = 0;
	mic.recorders = [];
	const { stream, stopped } = stoppingStream();
	mic.next = async () => stream;
	const frame = await mount({
		recordingProbe: {
			canUseRadientSpeech: true,
			speechBlock: "could-not-check",
		},
	});
	const confirm = () =>
		frame.container.querySelector('[aria-label="Insert transcript"]');

	await act(async () => {
		frame.container.querySelector('[aria-label="Start recording"]').click();
	});
	await settle();
	assert.ok(confirm(), "the press reached the recording state");
	assert.equal(mic.recorders.length, 1, "one recorder carries the take");
	assert.equal(mic.recorders[0].state, "recording", "and it is running");

	await act(async () => {
		root.unmount();
	});
	await settle();
	assert.equal(
		mic.recorders[0].state,
		"inactive",
		"the unmount stopped the take instead of leaving it running",
	);
	assert.deepEqual(stopped, ["track"], "and its track with it");
	mic.next = null;
});

/*
 * THE ACKNOWLEDGMENT SURVIVES A BUSY TURN, AND THE TAKE IT WAS WAITING FOR IS
 * KEPT (UX round 2, U7). Two decisions, both recorded in `message-input.tsx`:
 * the acknowledgment's control and caption stay on screen while the composer is
 * acquiring (the turn going busy used to remove them - the same silence this
 * change exists to remove, one transition later), and a take that lands after
 * that transition still becomes the recording state, because discarding it
 * would throw away speech the user asked for while the composer stays writable
 * mid-turn.
 */
test("the acknowledgment survives the turn going busy, and the deferred take still lands", async () => {
	mic.calls = 0;
	let release = () => {};
	mic.next = () =>
		new Promise((resolve) => {
			release = () => resolve(fakeStream());
		});
	const frame = await mount({
		recordingProbe: {
			canUseRadientSpeech: true,
			speechBlock: "could-not-check",
		},
	});
	const preparing = () =>
		frame.container.querySelector("[data-preparing-indicator]");
	const micControl = () =>
		frame.container.querySelector('[aria-label="Start recording"]');
	const confirm = () =>
		frame.container.querySelector('[aria-label="Insert transcript"]');
	const lane = () =>
		frame.container.querySelector("[data-recording-indicator]");

	await act(async () => {
		micControl().click();
	});
	assert.ok(preparing(), "the press is acknowledged");

	/* The turn goes busy inside the window. */
	await frame.rerender({ isLoading: true, currentJobId: "job-u7" });
	assert.ok(
		preparing(),
		"the acknowledgment survives the turn going busy rather than being removed",
	);
	assert.ok(
		micControl(),
		"and its control stays with it, so the two halves still agree",
	);
	assert.equal(
		micControl()?.getAttribute("aria-busy"),
		"true",
		"the control is still the busy one",
	);

	mic.next = async () => fakeStream();
	await act(async () => {
		release();
	});
	await settle();
	assert.ok(
		confirm(),
		"the deferred take lands as the recording state rather than vanishing",
	);
	assert.ok(lane(), "with the lane the user confirms or cancels");
	assert.equal(preparing(), null, "and the acknowledgment gives way to it");

	await act(async () => {
		root.unmount();
	});
	mic.next = null;
});

test("a refused acquisition clears the acknowledgment and the control returns to rest", async () => {
	mic.calls = 0;
	mic.next = () => Promise.reject(new Error("denied"));
	const frame = await mount({
		recordingProbe: {
			canUseRadientSpeech: true,
			speechBlock: "could-not-check",
		},
	});
	const preparing = () =>
		frame.container.querySelector("[data-preparing-indicator]");
	const micControl = () =>
		frame.container.querySelector('[aria-label="Start recording"]');

	await act(async () => {
		micControl().click();
	});
	await settle();
	assert.equal(
		preparing(),
		null,
		"the acknowledgment does not outlive the refusal",
	);
	assert.ok(micControl(), "the mic is back to rest");
	assert.equal(
		micControl()?.getAttribute("aria-busy"),
		null,
		"the busy state is off again",
	);

	await act(async () => {
		root.unmount();
	});
	mic.next = null;
});

test("a release inside the acquisition window clears the acknowledgment without a recording state", async () => {
	mic.calls = 0;
	let release = () => {};
	mic.next = () =>
		new Promise((resolve) => {
			release = () => resolve(fakeStream());
		});
	const frame = await mount({
		recordingProbe: {
			canUseRadientSpeech: true,
			speechBlock: "could-not-check",
		},
	});
	const preparing = () =>
		frame.container.querySelector("[data-preparing-indicator]");
	const micControl = () =>
		frame.container.querySelector('[aria-label="Start recording"]');
	const confirm = () =>
		frame.container.querySelector('[aria-label="Insert transcript"]');

	/* The hold door: the real manager's capture dispatch, released mid-acquisition. */
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
	assert.ok(preparing(), "the hold's press is acknowledged too");
	await act(async () => {
		window.dispatchEvent(
			new window.KeyboardEvent("keyup", {
				code,
				bubbles: true,
				cancelable: true,
			}),
		);
	});

	/*
	 * THE RELEASE IS THE SETTLE, BEFORE THE STREAM LANDS (agent review round 2,
	 * MAJOR 1). This assertion used to be taken only after `release()`, so it
	 * passed while the release arm returned early and left the face up for the
	 * whole remaining acquisition: the state the reviewer reproduced
	 * (`AFTER-RELEASE preparing present: true`). The stream is deliberately still
	 * PENDING here - a hold shorter than the acquisition is the case.
	 */
	assert.equal(
		preparing(),
		null,
		"the release itself ends the acknowledgment, while the stream is still pending",
	);
	assert.equal(
		micControl()?.getAttribute("aria-busy"),
		null,
		"and the control drops its busy state with it",
	);

	await act(async () => {
		release();
	});
	await settle();
	assert.equal(
		preparing(),
		null,
		"the acknowledgment does not come back when the stream lands",
	);
	assert.equal(
		confirm(),
		null,
		"a release inside the acquisition window never becomes a recording",
	);

	await act(async () => {
		root.unmount();
	});
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
		t(COMPOSER_PLACEHOLDER.idle),
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
		t(COMPOSER_PLACEHOLDER.busy),
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
		t(COMPOSER_PLACEHOLDER.unavailable),
		"and a state sentence still outranks it",
	);
	/*
	 * The press's own sentence (design round 1, D6): while a Stop is in flight
	 * the empty box says so - the square it was pressed on is pixel-identical
	 * and the rung is 420 px above it, so this is the answer where the finger
	 * is. It reads AHEAD of the send/steer sentences because the press is the
	 * newer act, and absent means nothing changes for every mount that predates
	 * the field.
	 */
	assert.equal(
		composerPlaceholder({
			...base,
			stopping: true,
			sendingUnsettled: true,
			awaitingReply: true,
		}),
		t(COMPOSER_PLACEHOLDER.stopping),
		"a Stop press in flight is answered where the finger is",
	);
	assert.equal(
		composerPlaceholder({
			...base,
			sendingUnsettled: true,
			awaitingReply: true,
		}),
		t(COMPOSER_PLACEHOLDER.sending),
		"and without a press the send sentence is unchanged",
	);

	await act(async () => {
		root.unmount();
	});
});

/* ------------------------------------------------------------------ */
/* 4b. The caret, and whether a claim may take the host page with it    */
/* ------------------------------------------------------------------ */
/*
 * OPERATOR RULE, 2026-10-08: "the composer auto-focuses mostly, but on the
 * projects page it shouldn't, and we should stay scrolled at the top when
 * clicking in". The two halves of that are here - the default keeps the claim,
 * and the claim never moves the page - while the projects strip's own opt-out
 * is asserted where the strip is mounted (`projects-quick-send.test.mjs`).
 * jsdom has no layout, so "moves the page" is read off the focus calls
 * themselves through `focus-scroll-model.mjs`: a call that does not prevent the
 * scroll is what a real engine turns into movement.
 */

test("a default-props mount still takes the caret on its own, and the claim never moves the page", async () => {
	/*
	 * TEARDOWN IN `finally`, because this rig's `after` hook unmounts only the LAST
	 * tree: a case that fails before its own unmount leaves a mounted composer
	 * behind, and the dictation machinery under it is what holds the file's process
	 * alive (measured while writing this case: a red run sat five minutes on
	 * multiplying Timeouts before the runner reaped it).
	 */
	let frame;
	try {
		frame = await mount({ messages: [] });
		const field = frame.textarea();
		assert.ok(field, "the composer's field is mounted");
		assert.equal(
			window.document.activeElement,
			field,
			"a host that says nothing gets today's behaviour: the chat-shaped mount claims the caret",
		);
		const claims = focusModel.calls.filter((call) => call.element === field);
		assert.ok(
			claims.length >= 1,
			"the mount's own focus call is this case's subject, so it has to have been recorded",
		);
		assert.equal(
			claims[0].prevented,
			true,
			"and it carries preventScroll - taking focus is not a request to scroll the host's page, and a plain focus is what centred the projects strip",
		);
		assert.equal(
			frame.container.scrollTop,
			0,
			"so a scrolled container is left exactly where it was",
		);
	} finally {
		await act(async () => {
			root?.unmount();
		});
	}
});

test("with autoFocus={false} the end of a dictation take still hands the caret back", async () => {
	/*
	 * WHY THE OPT-OUT CANNOT BE `if (!autoFocus) return`. A take leaves the caret
	 * on the microphone - a click put it there, or the push-to-talk chord drove the
	 * manager - and the composer's own focus effect is what returns it to the box
	 * when the take ends. Leave it on the mic and Enter re-triggers a recording
	 * instead of sending: the wrong control in the middle of an interaction this
	 * box owns. So the host's answer gates the CLAIM and never the HAND-BACK, and
	 * this case drives the real capture dispatch - the same synthetic media stack
	 * the dictation cases above use - through an opted-out mount.
	 */
	mic.calls = 0;
	mic.next = async () => fakeStream();
	let frame;
	try {
		frame = await mount({
			messages: [],
			autoFocus: false,
			recordingProbe: {
				canUseRadientSpeech: true,
				speechBlock: "could-not-check",
			},
		});
		const field = frame.textarea();
		assert.ok(field, "the composer's field is mounted");
		assert.notEqual(
			window.document.activeElement,
			field,
			"an opted-out mount does not claim the caret",
		);

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
		/*
		 * THE TAKE IS PROVED LIVE BEFORE IT IS ENDED, or the case could pass on a
		 * dispatch that never recorded anything: the confirm control only renders
		 * while `isRecording` (`{isRecording && (...)}` in the composer), which is the
		 * state the hand-back's falling edge is read off.
		 */
		assert.ok(
			frame.container.querySelector('[aria-label="Insert transcript"]'),
			"the hold reached the capture path, so the take this case ends is a real one",
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
		assert.equal(
			window.document.activeElement,
			field,
			"the end of the take hands the caret back to the box",
		);
		const handback = focusModel.calls
			.filter((call) => call.element === field)
			.at(-1);
		assert.ok(
			handback,
			"the hand-back is a focus call, so it has to be recorded for the flag below to mean anything",
		);
		assert.equal(
			handback.prevented,
			true,
			"with preventScroll, because a hand-back restores a caret rather than navigating",
		);
	} finally {
		await act(async () => {
			root?.unmount();
		});
		mic.next = null;
	}
});

test("the push-to-talk chord asks the box to be on screen (agent review round 1, MINOR-1)", async () => {
	/*
	 * WHY AN OFF-SCREEN BOX MUST REFUSE THE CHORD. The push-to-talk binding is a
	 * WINDOW-level hold whose only feedback - the recording state, the confirm
	 * control - renders inside this composer; on the projects page the strip
	 * starts below the fold by design, so a chord at the top of the page used to
	 * start a take nothing on screen showed. The composer now carries an
	 * IntersectionObserver on its own textarea and the STT registration's
	 * `isActive` reads it, FAIL-OPEN: with no report the chord keeps its old
	 * answer, which is what keeps the chat and mini hosts exactly as they were.
	 *
	 * A CONTROLLABLE OBSERVER, installed for this case only: the harness defines
	 * no observer at all (Node's realm has none, jsdom has none), so the
	 * fail-open arm below is also the environment every OTHER case in this file
	 * runs in - if the no-observer path refused a chord, the dictation cases
	 * above would already be red.
	 */
	const previousObserver = globalThis.IntersectionObserver;
	const observers = [];
	globalThis.IntersectionObserver = class {
		constructor(callback) {
			this.callback = callback;
			this.target = null;
			observers.push(this);
		}
		observe(element) {
			this.target = element;
		}
		unobserve() {}
		disconnect() {}
	};
	mic.calls = 0;
	mic.next = async () => fakeStream();
	let frame;
	try {
		frame = await mount({
			messages: [],
			recordingProbe: {
				canUseRadientSpeech: true,
				speechBlock: "could-not-check",
			},
		});
		const field = frame.textarea();
		assert.ok(field, "the composer's field is mounted");
		/* The mechanism is IN PLACE, or the fail-open arm below would pass on a
		 * composer that never observed anything rather than one that did and had
		 * no report yet. */
		const observer = observers.find((entry) => entry.target === field);
		assert.ok(
			observer,
			"the composer attached an observer to its own textarea",
		);
		const report = async (isIntersecting) => {
			await act(async () => {
				observer.callback([{ isIntersecting, target: field }], observer);
			});
			await settle();
		};
		const { code } = resolvePushToTalkBinding();
		const hold = async () => {
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
		};
		const release = async () => {
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
		};
		/** No take is running or settling: recording and transcribing controls gone. */
		const quiet = async () => {
			for (let pass = 0; pass < 30; pass++) {
				const busy = frame.container.querySelector(
					'[aria-label="Insert transcript"], [data-preparing-indicator], [data-transcribing-indicator]',
				);
				if (busy === null) return true;
				await settle();
			}
			return false;
		};

		/*
		 * ARM 1 - NO REPORT YET (the fail-open arm, and the state every host with a
		 * no-op rig runs in): the chord keeps its answer.
		 */
		const resting = mic.calls;
		await hold();
		assert.equal(
			mic.calls,
			resting + 1,
			"with no report observed the chord starts a take exactly as it did before",
		);
		await release();
		assert.ok(await quiet(), "the first take settles before the next arm");

		/*
		 * ARM 2 - REPORTED OFF SCREEN: the chord must NOT reach the capture path,
		 * and nothing may render as if it had.
		 */
		await report(false);
		const offScreen = mic.calls;
		await hold();
		assert.equal(
			mic.calls,
			offScreen,
			"a box the reader cannot see must not answer the chord",
		);
		assert.equal(
			frame.container.querySelector('[aria-label="Insert transcript"]'),
			null,
			"and no take's feedback exists off screen",
		);
		assert.equal(
			frame.container.querySelector("[data-preparing-indicator]"),
			null,
			"the press's own acknowledgment must not fire either",
		);
		await release();

		/*
		 * ARM 3 - REPORTED ON SCREEN: the take starts as it always did.
		 */
		await report(true);
		await hold();
		assert.equal(
			mic.calls,
			offScreen + 1,
			"on screen the chord starts the take - the gate is the box's visibility, not dictation itself",
		);
		assert.ok(
			frame.container.querySelector('[aria-label="Insert transcript"]'),
			"and the take's own feedback is what the gate protects",
		);
		await release();
	} finally {
		await act(async () => {
			root?.unmount();
		});
		mic.next = null;
		globalThis.IntersectionObserver = previousObserver;
	}
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

/*
 * THE START RECORDING CHORD TAKES OVER A HOLD THAT IS ALREADY RECORDING (QA
 * round 2, Q1). Main claims the chord, so the renderer hears the
 * `start-speech-to-text` channel instead of a key. With a hold on a modifier
 * the chord also begins with (Command or Control), the hold has engaged first;
 * the chord must then end that take and start its own. The manager asked the
 * registry for an ACTIVE handler after the abort, but the composer's `isActive`
 * reads render state (`isRecording`), which the abort cannot have updated yet,
 * so a take that had already started left the chord with no recording at all.
 * The stub handler in `hold-main-claimed-chord.test.mjs` has no such state,
 * which is why it could not see this.
 */
test("the Start recording chord replaces a hold that is already recording", async () => {
	mic.calls = 0;
	mic.recorders.length = 0;
	mic.next = async () => fakeStream();
	const frame = await mount({
		recordingProbe: {
			canUseRadientSpeech: true,
			speechBlock: "could-not-check",
		},
	});
	const confirm = () =>
		frame.container.querySelector('[aria-label="Insert transcript"]');
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
	assert.ok(confirm(), "the hold is recording");
	assert.equal(mic.calls, 1);

	const chord = ipcListeners.get("start-speech-to-text");
	assert.ok(chord, "the manager listens for the channel main sends");
	await act(async () => {
		chord();
	});
	await settle();
	assert.equal(mic.calls, 2, "the chord asked for its own take");
	assert.ok(confirm(), "a recording is up after the chord");
	assert.equal(
		mic.recorders.filter((recorder) => recorder.state === "recording").length,
		1,
		"exactly one live recorder: the hold's was ended",
	);

	// The modifier's release no longer owns the take: the chord's take stays.
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
	assert.ok(confirm(), "releasing the old hold does not end the chord's take");

	await act(async () => {
		root.unmount();
	});
	mic.next = null;
});

test("the band and splash never transition their layout, so reduced motion paints the first send's final frame (QA round 1, Q3)", async () => {
	/*
	 * The reduced-motion cap (styles/index.css) gives EVERY element a 0.01 ms
	 * transition-duration, and an element with no transition of its own still has
	 * the initial `transition-property: all` - so the first send's `grow` ->
	 * `shrink-0` flip painted its START value for one frame: the band still
	 * greeting-tall, the echo laid out 104 px up under the header, then dropped
	 * (built app, 3/3 reduced-motion runs). jsdom has no layout, so the reading is
	 * the class both elements carry in BOTH states the flip moves between.
	 */
	const frame = await mount({ messages: [] });
	try {
		const host = () =>
			frame.container.querySelector("[data-lo-composer-splash]");
		assert.match(
			frame.band().className,
			/\bgrow\b/,
			"the empty chat claims the column",
		);
		for (const node of [frame.band(), host()])
			assert.match(node.className, /\btransition-none\b/);
		await frame.rerender({ messages: [{ id: "m1" }] });
		assert.match(
			frame.band().className,
			/\bshrink-0\b/,
			"the conversation docks the band",
		);
		for (const node of [frame.band(), host()])
			assert.match(node.className, /\btransition-none\b/);
	} finally {
		await act(async () => root.unmount());
	}
});

/* ------------------------------------------------------------------ */
/* 4. A dictated send finishes in the chat it started in (bug 2)        */
/* ------------------------------------------------------------------ */

/*
 * THE OPERATOR'S REPORT, driven through the shipped composer.
 *
 * "you use the voice to text transcription and when it's transcribing after you hit
 * the immediate send and switch to another session it actually doesn't send it and
 * stores it in the input box."
 *
 * The chat page remounts its panel per conversation, so a switch after the press
 * destroys the composer whose send was armed. These cases drive both shapes the
 * harness can produce - a real unmount (`root.unmount`) and a re-pointed mount (a
 * rerender with another `conversationId`) - and the two windows the defect lives
 * in: a transcript that lands after the switch, and a recorder `onstop` that fires
 * after it.
 *
 * WHAT IS NOT COVERED HERE: the page's own send. `originBound` is asserted as the
 * seventh argument the composer passes, and `dictated-send.test.mjs` pins the
 * page's gate at the source; whether a real daemon receives the POST is a built-app
 * measurement (`scripts/session-switch-latency.mjs`), not a jsdom one.
 */

const A = "dictated-origin-a";
const B = "dictated-origin-b";

const extraRoots = [];
after(async () => {
	for (const extra of extraRoots) {
		await act(async () => {
			extra.unmount();
		});
	}
});

const OK_TRANSCRIPT = (text) => ({
	status: 200,
	kind: "json",
	body: { result: { text } },
});
const REFUSED = (status, detail) => ({ status, kind: "error", detail });

/*
 * THE TRANSCRIPTION, AS THE RELAY SEES IT: `desktopMedia` reads
 * `window.api.desktop.media`, so a case answers there. `gate` holds every answer
 * until the case releases it - that is the "switch while it transcribes" window,
 * and holding it is how a case keeps the take in flight across an unmount.
 */
const transcription = {
	calls: [],
	answers: [],
	gate: null,
	install(answers) {
		this.calls = [];
		this.answers = answers;
		window.api = {
			desktop: {
				media: async (request, bytes) => {
					this.calls.push({ request, bytes: Array.from(bytes) });
					if (this.gate) await this.gate;
					return this.answers[
						Math.min(this.calls.length - 1, this.answers.length - 1)
					];
				},
			},
		};
	},
	hold() {
		let release = () => {};
		this.gate = new Promise((resolve) => {
			release = resolve;
		});
		return () => {
			this.gate = null;
			release();
		};
	},
	restore() {
		this.gate = null;
		window.api = undefined;
	},
};

const RESET = { inputByConversation: {} };

/**
 * A mount that KEEPS the store between cases' mounts, because the whole subject is
 * a draft carried across two of them. The shared `mount` helper resets the rows.
 */
async function mountAt(conversationId, props = {}) {
	const { component = MessageInput, ...composerProps } = props;
	const Component = component;
	const container = window.document.createElement("div");
	window.document.body.appendChild(container);
	const mountRoot = createRoot(container);
	extraRoots.push(mountRoot);
	const mountProps = {
		conversationId,
		messages: [],
		isLoading: false,
		onSendMessage: async () => undefined,
		...composerProps,
	};
	await act(async () => {
		mountRoot.render(h(Component, mountProps));
	});
	await settle();
	return {
		container,
		root: mountRoot,
		textarea: () => container.querySelector("textarea"),
		record: (label) => container.querySelector(`[aria-label="${label}"]`),
		unmount: async () => {
			await act(async () => {
				mountRoot.unmount();
			});
			await settle();
		},
		rerender: async (next) => {
			await act(async () => {
				mountRoot.render(h(Component, { ...mountProps, ...next }));
			});
			await settle();
		},
	};
}

/** Press the mic, let the stream land, and the composer is recording. */
async function startTake(frame) {
	await act(async () => {
		frame.record("Start recording").click();
	});
	await settle();
	assert.ok(
		frame.container.querySelector("[data-recording-indicator]"),
		"the take is live before the press under test",
	);
	/*
	 * AND IT IS LONG ENOUGH TO KEEP. A release under `MIN_DICTATION_CLIP_MS` is
	 * DISCARDED by design (a stray tap is not a message), so a case that pressed
	 * within the clip window would transcribe nothing and prove nothing - the
	 * first cut of this suite did exactly that and every case failed on an empty
	 * relay.
	 */
	await act(async () => {
		await new Promise((resolve) => realSetTimeout(resolve, 300));
	});
}

/** Press "Send recording" and let the recorder hand its blob over. */
async function sendRecording(frame) {
	await act(async () => {
		frame.container.querySelector('[aria-label="Send recording"]').click();
	});
	await settle();
}

/** The spy every case uses: records its arguments, paints the echo, accepts. */
function spySends() {
	const calls = [];
	const spy = async (
		content,
		attachments,
		onEchoPainted,
		typed,
		seam,
		inputMode,
		options,
	) => {
		calls.push({ content, attachments, typed, seam, inputMode, options });
		/*
		 * THE ECHO'S PAINT, which the page performs when the bubble lands: it is
		 * what empties the origin's row through `beginInFlight`. A spy that skipped
		 * it would leave the text in the box and make "the send took the words"
		 * untestable.
		 */
		onEchoPainted?.();
		return true;
	};
	return { calls, spy };
}

test("a transcript that lands after the panel was unmounted is sent from the origin's own composer (case 1)", async () => {
	useConversationInputStore.setState(RESET);
	resetDictatedSendsForTests();
	mic.calls = 0;
	mic.recorders = [];
	mic.next = async () => fakeStream();
	const { calls, spy } = spySends();
	transcription.install([OK_TRANSCRIPT("hello there")]);
	const release = transcription.hold();

	const first = await mountAt(A, {
		dictatedAwayDelivery: true,
		onSendMessage: spy,
		recordingProbe: {
			canUseRadientSpeech: true,
			speechBlock: "could-not-check",
		},
	});
	await startTake(first);
	await sendRecording(first);
	assert.equal(transcription.calls.length, 1, "the take reached the relay");

	/* THE SWITCH: the origin's panel is gone, and the other one is mounted. */
	await first.unmount();
	const second = await mountAt(B, {
		dictatedAwayDelivery: true,
		onSendMessage: async () => undefined,
		recordingProbe: {
			canUseRadientSpeech: true,
			speechBlock: "could-not-check",
		},
	});

	await act(async () => {
		release();
	});
	await settle();

	assert.equal(calls.length, 1, "exactly one send, from the replaced composer");
	const call = calls[0];
	assert.match(call.content, /hello there/, "the dictation is what was sent");
	assert.equal(call.typed, call.content, "the typed line travels beside it");
	assert.deepEqual(
		call.options,
		{ originBound: true },
		"and the page is told it is bound to the origin, not to the pane on screen",
	);
	assert.equal(
		useConversationInputStore.getState().getCurrentInput(A),
		"",
		"the origin's draft was emptied by the echo, not left holding the words",
	);
	assert.equal(
		useConversationInputStore.getState().getCurrentInput(B),
		"",
		"and the chat the user switched TO was never written to",
	);
	assert.equal(second.textarea().value, "", "nor its box");
	assert.equal(dictatedSends.has(A), false, "the intent is retired");
	transcription.restore();
	mic.next = null;
});

test("a re-pointed composer sends the words to the conversation they started in (case 2)", async () => {
	useConversationInputStore.setState(RESET);
	resetDictatedSendsForTests();
	mic.calls = 0;
	mic.recorders = [];
	mic.next = async () => fakeStream();
	const { calls, spy } = spySends();
	transcription.install([OK_TRANSCRIPT("hello there")]);
	const release = transcription.hold();

	const frame = await mountAt(A, {
		dictatedAwayDelivery: true,
		onSendMessage: spy,
		recordingProbe: {
			canUseRadientSpeech: true,
			speechBlock: "could-not-check",
		},
	});
	await startTake(frame);
	await sendRecording(frame);

	/* THE OTHER SHAPE: one mount, two conversations - the prop moves under it. */
	await frame.rerender({ conversationId: B });
	await act(async () => {
		release();
	});
	await settle();

	assert.equal(calls.length, 1, "one send");
	assert.match(calls[0].content, /hello there/);
	assert.deepEqual(calls[0].options, { originBound: true });
	assert.equal(
		useConversationInputStore.getState().getCurrentInput(B),
		"",
		"the box now showing conversation B was not written to",
	);
	assert.equal(frame.textarea().value, "", "and neither was its textarea");
	assert.equal(useConversationInputStore.getState().getCurrentInput(A), "");
	transcription.restore();
	mic.next = null;
});

test("returning mid-flight shows the busy face, refuses the keyboard, and completes once (case 3)", async () => {
	useConversationInputStore.setState(RESET);
	resetDictatedSendsForTests();
	mic.calls = 0;
	mic.recorders = [];
	mic.next = async () => fakeStream();
	const { calls, spy } = spySends();
	transcription.install([OK_TRANSCRIPT("hello there")]);
	const release = transcription.hold();

	const first = await mountAt(A, {
		dictatedAwayDelivery: true,
		onSendMessage: spy,
		recordingProbe: {
			canUseRadientSpeech: true,
			speechBlock: "could-not-check",
		},
	});
	await startTake(first);
	await sendRecording(first);
	await first.unmount();

	/* BACK TO THE ORIGIN while the take is still being written down. */
	/*
	 * THE RETURNING PANE CARRIES THE SPY TOO, and that is the design rather than a
	 * convenience: a remount registers a FRESHER deliverer for the same
	 * conversation, so the words land through the pane the reader came back to (a
	 * live closure, with this render's gates) instead of through the dead one. The
	 * real page's `send` is the same stable function either way.
	 */
	const back = await mountAt(A, {
		dictatedAwayDelivery: true,
		onSendMessage: spy,
		recordingProbe: {
			canUseRadientSpeech: true,
			speechBlock: "could-not-check",
		},
	});
	assert.ok(
		back.container.querySelector('[aria-label="Processing audio"]'),
		"the busy face is up in the same frame the origin returns",
	);
	assert.equal(
		back.record("Start recording"),
		null,
		"and the microphone is not offered while a send is landing",
	);

	await act(async () => {
		back.textarea().dispatchEvent(
			new window.KeyboardEvent("keydown", {
				key: "Enter",
				bubbles: true,
				cancelable: true,
			}),
		);
	});
	await settle();
	assert.equal(
		calls.length,
		0,
		"Enter cannot start a second send over the first",
	);

	await act(async () => {
		release();
	});
	await settle();
	assert.equal(calls.length, 1, "the away send completes exactly once");
	assert.equal(back.textarea().value, "", "and the box is empty when it does");
	assert.equal(useConversationInputStore.getState().getCurrentInput(A), "");
	await back.unmount();
	transcription.restore();
	mic.next = null;
});

test("a take whose onstop fires after the unmount still reaches the relay (case 4)", async () => {
	useConversationInputStore.setState(RESET);
	resetDictatedSendsForTests();
	mic.calls = 0;
	mic.recorders = [];
	mic.next = async () => fakeStream();
	const { calls, spy } = spySends();
	transcription.install([OK_TRANSCRIPT("late bytes")]);

	const frame = await mountAt(A, {
		dictatedAwayDelivery: true,
		onSendMessage: spy,
		recordingProbe: {
			canUseRadientSpeech: true,
			speechBlock: "could-not-check",
		},
	});
	await startTake(frame);
	/* Hold the recorder's own `stop`, so the blob can land after the unmount. */
	const recorder = mic.recorders[0];
	const held = recorder.onstop;
	recorder.stop = () => {
		recorder.state = "inactive";
	};
	try {
		await sendRecording(frame);
		assert.equal(
			transcription.calls.length,
			0,
			"no take yet - the blob is held",
		);
		await frame.unmount();
		await act(async () => {
			held();
		});
		await settle();
		assert.equal(
			transcription.calls.length,
			1,
			"the dead tree's blob was transcribed",
		);
		assert.equal(calls.length, 1, "and its send followed");
		assert.match(calls[0].content, /late bytes/);
	} finally {
		transcription.restore();
		mic.next = null;
	}
});

test("a retry burst survives the unmount that used to abort it (case 5)", async () => {
	useConversationInputStore.setState(RESET);
	resetDictatedSendsForTests();
	mic.calls = 0;
	mic.recorders = [];
	mic.next = async () => fakeStream();
	const { calls, spy } = spySends();
	transcription.install([
		REFUSED(503, "upstream is restarting"),
		OK_TRANSCRIPT("second attempt"),
	]);

	const frame = await mountAt(A, {
		dictatedAwayDelivery: true,
		onSendMessage: spy,
		recordingProbe: {
			canUseRadientSpeech: true,
			speechBlock: "could-not-check",
		},
	});
	await startTake(frame);
	await sendRecording(frame);
	await frame.unmount();
	/* The burst waits 500 ms before its second attempt; this waits it out. */
	await act(async () => {
		await new Promise((resolve) => realSetTimeout(resolve, 700));
	});
	await settle();
	assert.equal(
		transcription.calls.length,
		2,
		"the burst tried again after the switch",
	);
	assert.equal(calls.length, 1, "and the recovered transcript was sent");
	assert.match(calls[0].content, /second attempt/);
	transcription.restore();
	mic.next = null;
});

test("a draft edited while the words were in flight is merged, never sent (case 6)", async () => {
	useConversationInputStore.setState(RESET);
	resetDictatedSendsForTests();
	mic.calls = 0;
	mic.recorders = [];
	mic.next = async () => fakeStream();
	const { calls, spy } = spySends();
	transcription.install([OK_TRANSCRIPT("the words")]);
	const release = transcription.hold();

	const frame = await mountAt(A, {
		dictatedAwayDelivery: true,
		onSendMessage: spy,
		recordingProbe: {
			canUseRadientSpeech: true,
			speechBlock: "could-not-check",
		},
	});
	await startTake(frame);
	await sendRecording(frame);
	await frame.unmount();
	useConversationInputStore.getState().setCurrentInput(A, "x");
	await act(async () => {
		release();
	});
	await settle();

	assert.equal(
		calls.length,
		0,
		"nothing is posted over words the user changed",
	);
	assert.equal(
		useConversationInputStore.getState().getCurrentInput(A),
		"x the words",
		"the transcript joins what they wrote",
	);
	assert.equal(
		useDictatedSendStore.getState().refused[A]?.reason,
		"edited",
		"and the refusal names the edit",
	);
	transcription.restore();
	mic.next = null;
});

test("a refused send keeps the words in the origin's draft and frees the intent (case 7)", async () => {
	useConversationInputStore.setState(RESET);
	resetDictatedSendsForTests();
	mic.calls = 0;
	mic.recorders = [];
	mic.next = async () => fakeStream();
	transcription.install([OK_TRANSCRIPT("kept words")]);
	const release = transcription.hold();

	const frame = await mountAt(A, {
		dictatedAwayDelivery: true,
		onSendMessage: async () => false,
		recordingProbe: {
			canUseRadientSpeech: true,
			speechBlock: "could-not-check",
		},
	});
	await startTake(frame);
	await sendRecording(frame);
	await frame.unmount();
	await act(async () => {
		release();
	});
	await settle();

	const kept = useConversationInputStore.getState().getCurrentInput(A);
	assert.match(
		kept,
		/kept words/,
		"the dictation is in the draft a returning user will find",
	);
	assert.ok(
		useDictatedSendStore.getState().refused[A],
		"and the refusal is stated rather than swallowed",
	);
	assert.equal(
		dictatedSends.has(A),
		false,
		"the conversation may dictate again",
	);
	resetDictatedSendsForTests();
	assert.equal(
		typeof dictatedSends.begin(A, { draftAtPress: "", owner: "later" }),
		"string",
		"a fresh press is accepted once the refusal is cleared",
	);
	transcription.restore();
	mic.next = null;
});

test("a refused transcription while away is named, and no take is offered back (case 8)", async () => {
	useConversationInputStore.setState(RESET);
	resetDictatedSendsForTests();
	mic.calls = 0;
	mic.recorders = [];
	mic.next = async () => fakeStream();
	transcription.install([REFUSED(402, "insufficient_quota")]);
	const release = transcription.hold();

	const frame = await mountAt(A, {
		dictatedAwayDelivery: true,
		onSendMessage: async () => true,
		recordingProbe: {
			canUseRadientSpeech: true,
			speechBlock: "could-not-check",
		},
	});
	await startTake(frame);
	await sendRecording(frame);
	await frame.unmount();
	await act(async () => {
		release();
	});
	await settle();

	assert.equal(
		useDictatedSendStore.getState().refused[A]?.reason,
		"transcription",
		"the failure is recorded as the transcription's, not as a send's",
	);
	assert.equal(
		useConversationInputStore.getState().getCurrentInput(A),
		"",
		"nothing was written into the draft - there were no words",
	);
	const back = await mountAt(A, {
		dictatedAwayDelivery: true,
		onSendMessage: async () => true,
		recordingProbe: {
			canUseRadientSpeech: true,
			speechBlock: "could-not-check",
		},
	});
	assert.equal(
		back.container.querySelector("[data-dictation-retry]"),
		null,
		"a dead composer cannot offer the take back",
	);
	await back.unmount();
	transcription.restore();
	mic.next = null;
});

test("the words take the same route as a typed send, $skill seam included (case 10)", async () => {
	useConversationInputStore.setState(RESET);
	resetDictatedSendsForTests();
	const readSeam = async (sessionId) => {
		const call = lastSeamCall;
		return call ? await call(sessionId) : undefined;
	};
	let lastSeamCall = null;
	const { MessageInput: ProvidedMessageInput } =
		await buildProvidedComposerBundle();
	/*
	 * A DISTINCT ORIGIN PER RUN, because the provided bundle carries its own copy of
	 * the record: two runs on one conversation would fight over the one intent a
	 * conversation may hold, and the second press would be refused for the wrong
	 * reason.
	 */
	const run = async ({ away, origin }) => {
		useConversationInputStore.setState(RESET);
		resetDictatedSendsForTests();
		mic.calls = 0;
		mic.recorders = [];
		mic.next = async () => fakeStream();
		skillRead.reset();
		transcription.install([OK_TRANSCRIPT("use $release-notes")]);
		const calls = [];
		const spy = async (
			content,
			attachments,
			onEchoPainted,
			typed,
			seam,
			inputMode,
		) => {
			calls.push({ content, typed, inputMode, seam });
			onEchoPainted?.();
			return true;
		};
		/*
		 * `ProvidedMessageInput`, because the `$skill` READ needs a query client
		 * (`skillReadProvided`): without one the composer correctly keeps the read
		 * off, and a parity case over an off path would prove nothing. `sessionStatus`
		 * makes the pane an attached one, which is the state the press's read runs in.
		 */
		const frame = await mountAt(origin, {
			component: ProvidedMessageInput,
			dictatedAwayDelivery: true,
			admissionSeamHonoured: true,
			cwd: "/tmp/dictated-send-cwd",
			onSendMessage: spy,
			recordingProbe: {
				canUseRadientSpeech: true,
				speechBlock: "could-not-check",
			},
		});
		await startTake(frame);
		await sendRecording(frame);
		if (away) {
			await frame.unmount();
			await settle();
		} else {
			await settle();
			/* The stay path's own effect sends one tick later; give it the tick. */
			await act(async () => {
				await new Promise((resolve) => realSetTimeout(resolve, 20));
			});
			await settle();
		}
		assert.equal(calls.length, 1, away ? "away: one send" : "stay: one send");
		const call = calls[0];
		lastSeamCall = call.seam;
		const composed = await readSeam(origin);
		grade = {
			content: call.content,
			typed: call.typed,
			inputMode: call.inputMode,
			seam: call.seam,
			composed,
		};
		await frame.unmount();
		transcription.restore();
		mic.next = null;
	};
	let grade = null;
	await run({ away: false, origin: `${A}-stay` });
	const stay = grade;
	await run({ away: true, origin: `${A}-away` });
	const away = grade;
	assert.deepEqual(
		[away.content, away.typed, away.inputMode],
		[stay.content, stay.typed, stay.inputMode],
		"the same message, the same typed line, the same input mode either way",
	);
	assert.equal(
		away.composed,
		stay.composed,
		"and the seam composes the identical payload, $skill bodies and all",
	);
	assert.ok(
		typeof stay.composed === "string" && stay.composed.length > 0,
		"the seam answered (a $skill read that never ran would be undefined here)",
	);
	/*
	 * WHAT THIS CASE DOES NOT REACH, stated rather than implied: the `$skill` BODY
	 * read. The composer's vocabulary comes from `useSkillCompletion`, whose read is
	 * gated on the pairing probe answering a clean `null`; this harness has no
	 * backend bridge, so the vocabulary stays empty, `planSkillMentions` plans
	 * nothing, and the seam composes an unexpanded payload on both paths. The seam
	 * itself - which is bug 1's channel, and the thing a copy of the send would have
	 * duplicated - is exercised: both paths hand the host a seam, and both seams
	 * answer with the same string.
	 */
	assert.ok(
		typeof stay.seam === "function",
		"the press handed the host a seam on both paths",
	);
	assert.equal(
		(stay.composed.match(/operator-skills/g) ?? []).length,
		(away.composed.match(/operator-skills/g) ?? []).length,
		"neither path invents a skill block the other does not have",
	);
});

test("a host without the flag keeps today's behaviour: a take released after an unmount is dropped (case 11)", async () => {
	useConversationInputStore.setState(RESET);
	resetDictatedSendsForTests();
	mic.calls = 0;
	mic.recorders = [];
	mic.next = async () => fakeStream();
	const { calls, spy } = spySends();
	transcription.install([OK_TRANSCRIPT("as today")]);

	const frame = await mountAt(A, {
		/* NO `dictatedAwayDelivery`: the mini view, config, library, quick-send. */
		onSendMessage: spy,
		recordingProbe: {
			canUseRadientSpeech: true,
			speechBlock: "could-not-check",
		},
	});
	await startTake(frame);
	/*
	 * THE RECORDER'S RELEASE IS HELD (round-1 finding, reviewer M3). The dead-tree
	 * branch this case is about only runs when `onstop` arrives AFTER the unmount,
	 * so the take's own event has to be delivered by the case rather than by the
	 * fixture's microtask - otherwise the composer is still mounted when it fires
	 * and this measures the ordinary transcription instead.
	 */
	const recorder = mic.recorders.at(-1);
	let deliver = null;
	recorder.stop = function () {
		this.state = "inactive";
		deliver = () => {
			this.ondataavailable?.({
				data: new Blob(["0123456789"], { type: "audio/webm" }),
			});
			this.onstop?.();
		};
	};
	await act(async () => {
		frame.container.querySelector('[aria-label="Send recording"]').click();
	});
	await settle();
	await frame.unmount();
	await act(async () => {
		deliver?.();
	});
	await settle();

	assert.equal(
		calls.length,
		0,
		"an opted-out host sends nothing after an unmount",
	);
	/*
	 * THE TAKE IS NOT TRANSCRIBED EITHER. The dead tree's `onstop` used to
	 * transcribe on any press (`dictatedSendRef` is written by every press, on
	 * every host) and appended the words to the draft - a behaviour these hosts
	 * never had, since only an ARMED INTENT (the opt-in's record) authorises a
	 * take from a tree that is gone. The media stub is the instrument: uncalled
	 * means the bytes went nowhere, which is the pre-existing behaviour this PR
	 * promised to leave alone.
	 */
	assert.equal(deliver !== null, true, "the release did reach the recorder");
	assert.deepEqual(
		transcription.calls,
		[],
		"no transcription request is made on a host that never opted in",
	);
	assert.equal(
		useConversationInputStore.getState().getCurrentInput(A),
		"",
		"and nothing was appended to the draft",
	);
	assert.equal(dictatedSends.has(A), false, "no intent was ever armed");
	transcription.restore();
	mic.next = null;
});

test("the stay path is unchanged, seam argument and all (case 12)", async () => {
	useConversationInputStore.setState(RESET);
	resetDictatedSendsForTests();
	mic.calls = 0;
	mic.recorders = [];
	mic.next = async () => fakeStream();
	const { calls, spy } = spySends();
	transcription.install([OK_TRANSCRIPT("stayed here")]);

	const frame = await mountAt(A, {
		dictatedAwayDelivery: true,
		onSendMessage: spy,
		recordingProbe: {
			canUseRadientSpeech: true,
			speechBlock: "could-not-check",
		},
	});
	await startTake(frame);
	await sendRecording(frame);
	await act(async () => {
		await new Promise((resolve) => realSetTimeout(resolve, 20));
	});
	await settle();

	assert.equal(calls.length, 1, "one send, without any switch");
	assert.equal(calls[0].options, undefined, "and no seventh argument at all");
	assert.equal(frame.textarea().value, "", "the box is cleared by the echo");
	assert.equal(useConversationInputStore.getState().getCurrentInput(A), "");
	await frame.unmount();
	transcription.restore();
	mic.next = null;
});

test("the away path raises no React warning and no console error (case 13)", async () => {
	useConversationInputStore.setState(RESET);
	resetDictatedSendsForTests();
	mic.calls = 0;
	mic.recorders = [];
	mic.next = async () => fakeStream();
	const { spy } = spySends();
	transcription.install([OK_TRANSCRIPT("quietly")]);
	const release = transcription.hold();
	const errors = [];
	const original = console.error;
	console.error = (...args) => {
		errors.push(args.map(String).join(" "));
	};
	try {
		const frame = await mountAt(A, {
			dictatedAwayDelivery: true,
			onSendMessage: spy,
			recordingProbe: {
				canUseRadientSpeech: true,
				speechBlock: "could-not-check",
			},
		});
		await startTake(frame);
		await sendRecording(frame);
		await frame.unmount();
		await act(async () => {
			release();
		});
		await settle();
	} finally {
		console.error = original;
		transcription.restore();
		mic.next = null;
	}
	/*
	 * The audio-meter canvas is jsdom's, not the app's: `getContext` is unimplemented
	 * there and it says so on every mount, on the untouched tree as much as on this
	 * one. Everything else - a React update on a dead pane, a `flushSync` warning, a
	 * caught error the continuation logged - fails the case.
	 */
	assert.deepEqual(
		errors.filter(
			(line) =>
				!line.startsWith("Transcription attempt") &&
				!line.startsWith("Error: Not implemented: HTMLCanvasElement"),
		),
		[],
		"an unmounted pane's continuation says nothing on the console",
	);
});

/*
 * THE PAGE'S HALF OF A SEND, AS THE SHIPPING PAGE PLAYS IT.
 *
 * The earlier cases stub `onSendMessage` and call `onEchoPainted` inline, which
 * is only the app's shape while a transcript for the identity is MOUNTED. The
 * real page paints through `paintPendingSend`, whose application is synchronous
 * with a target and RETAINED without one (the reader is in another chat), and it
 * settles through `finishDraft`, which is what ends the in-flight record. A case
 * about what an away send leaves behind has to run both halves, or it tests a
 * page that does not exist.
 */
function pageSend({ origin, posts }) {
	const echoes = [];
	const send = async (content, _attachments, onEchoPainted) => {
		posts.push(content);
		paintPendingSend(origin, {
			id: crypto.randomUUID(),
			text: content,
			images: [],
			onPainted: () => {
				echoes.push(content);
				onEchoPainted?.();
			},
		});
		useCanonicalSessionsStore
			.getState()
			.finishDraft(
				paneDraftKey(null, origin, useCanonicalSessionsStore.getState().drafts),
				origin,
			);
		return true;
	};
	return { echoes, send };
}

/** The row an away send must leave behind: empty, and holding nothing in flight. */
function originRow(id) {
	const row = useConversationInputStore.getState().inputByConversation[id];
	return {
		text: row?.currentInput ?? "",
		inFlight: row?.inFlight?.text ?? null,
	};
}

test("an away send the reader walked away from leaves that chat's box empty and nothing in flight (case 14)", async () => {
	useConversationInputStore.setState(RESET);
	resetDictatedSendsForTests();
	discardPendingSends(A);
	mic.calls = 0;
	mic.recorders = [];
	mic.next = async () => fakeStream();
	const posts = [];
	const { echoes, send } = pageSend({ origin: A, posts });
	transcription.install([OK_TRANSCRIPT("hello there")]);
	const release = transcription.hold();

	const first = await mountAt(A, {
		dictatedAwayDelivery: true,
		onSendMessage: send,
		recordingProbe: {
			canUseRadientSpeech: true,
			speechBlock: "could-not-check",
		},
	});
	await startTake(first);
	await sendRecording(first);

	/* THE SWITCH: the origin's panel is gone, so the echo has no target. */
	await first.unmount();
	const second = await mountAt(B, {
		dictatedAwayDelivery: true,
		onSendMessage: async () => undefined,
		recordingProbe: {
			canUseRadientSpeech: true,
			speechBlock: "could-not-check",
		},
	});
	await act(async () => {
		release();
	});
	await settle();

	assert.equal(posts.length, 1, "the away send happened exactly once");
	assert.deepEqual(
		echoes,
		[],
		"and its echo was RETAINED: no transcript for the origin was mounted",
	);
	/*
	 * THE DEFECT (round-1 F1, UX U1 = QA Q1). The clear used to be the echo's
	 * alone, so the row kept the sent words here - currentInput `hello there`,
	 * no record - until the origin was next mounted, at which point the drained
	 * callback emptied the row into `inFlight` after the send had settled. Both
	 * halves are asserted: the text must be gone NOW (nothing else will empty it
	 * once the send has settled), and no record may survive (the next launch
	 * folds one back into the box, and Enter over it re-sends the message).
	 */
	assert.deepEqual(
		originRow(A),
		{ text: "", inFlight: null },
		"the accepted away send emptied the origin's row and recorded nothing",
	);
	assert.deepEqual(
		useConversationInputStore.getState().getSubmittedMessages(A),
		["hello there"],
		"and the delivered message went into the box's history, as every send's does",
	);

	/* THE RETURN: the origin's transcript mounts and drains the retained echo. */
	const back = await mountAt(A, {
		dictatedAwayDelivery: true,
		onSendMessage: send,
		recordingProbe: {
			canUseRadientSpeech: true,
			speechBlock: "could-not-check",
		},
	});
	/*
	 * Kept in a `finally` for the reason the whole file has one: a registration
	 * that outlives its case makes the NEXT case's paint apply synchronously, and
	 * the next case is about a retained paint.
	 */
	const unregister = __registerEchoTarget(A, () => {});
	try {
		await settle();
		assert.deepEqual(
			echoes,
			["hello there"],
			"the retained paint reached the origin's next mount",
		);
		assert.equal(back.textarea().value, "", "the returned box is empty");
		assert.deepEqual(
			originRow(A),
			{ text: "", inFlight: null },
			"and the row is still empty with nothing in flight",
		);

		/* AND ENTER OVER IT SENDS NOTHING: the words were delivered, not drafted. */
		await act(async () => {
			back.textarea().dispatchEvent(
				new window.KeyboardEvent("keydown", {
					key: "Enter",
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		await settle();
		assert.equal(posts.length, 1, "no second POST from an empty box");
	} finally {
		unregister();
	}
	await back.unmount();
	await second.unmount();
	transcription.restore();
	mic.next = null;
});

test("the same, on a host whose one composer is re-pointed at another chat (case 15)", async () => {
	useConversationInputStore.setState(RESET);
	resetDictatedSendsForTests();
	discardPendingSends(A);
	mic.calls = 0;
	mic.recorders = [];
	mic.next = async () => fakeStream();
	const posts = [];
	const { echoes, send } = pageSend({ origin: A, posts });
	transcription.install([OK_TRANSCRIPT("hello there")]);
	const release = transcription.hold();

	const frame = await mountAt(A, {
		dictatedAwayDelivery: true,
		onSendMessage: send,
		recordingProbe: {
			canUseRadientSpeech: true,
			speechBlock: "could-not-check",
		},
	});
	await startTake(frame);
	await sendRecording(frame);
	/* THE PERSISTING HOST: one mount, the prop moves to the other chat. */
	await frame.rerender({ conversationId: B });
	await act(async () => {
		release();
	});
	await settle();

	assert.equal(posts.length, 1, "one send, to the origin");
	assert.deepEqual(
		echoes,
		[],
		"still no transcript for the origin to paint into",
	);
	assert.deepEqual(
		originRow(A),
		{ text: "", inFlight: null },
		"the origin's row is empty with nothing in flight",
	);
	assert.equal(
		frame.textarea().value,
		"",
		"and the box now showing B holds nothing",
	);

	await frame.rerender({ conversationId: A });
	const unregister = __registerEchoTarget(A, () => {});
	await settle();
	assert.deepEqual(echoes, ["hello there"], "the drained paint ran on return");
	assert.equal(frame.textarea().value, "", "the returning box is empty");
	assert.deepEqual(
		originRow(A),
		{ text: "", inFlight: null },
		"and nothing was recorded at the drain",
	);
	await act(async () => {
		frame.textarea().dispatchEvent(
			new window.KeyboardEvent("keydown", {
				key: "Enter",
				bubbles: true,
				cancelable: true,
			}),
		);
	});
	await settle();
	assert.equal(posts.length, 1, "Enter over it sends nothing");
	unregister();
	await frame.unmount();
	transcription.restore();
	mic.next = null;
});

test("a return to a chat that is still opening is refused as still opening, not as unreachable (case 16)", async () => {
	useConversationInputStore.setState(RESET);
	resetDictatedSendsForTests();
	discardPendingSends(A);
	mic.calls = 0;
	mic.recorders = [];
	mic.next = async () => fakeStream();
	const posts = [];
	transcription.install([OK_TRANSCRIPT("hello there")]);
	const release = transcription.hold();

	const first = await mountAt(A, {
		dictatedAwayDelivery: true,
		onSendMessage: async (content) => {
			posts.push(content);
			return true;
		},
		recordingProbe: {
			canUseRadientSpeech: true,
			speechBlock: "could-not-check",
		},
	});
	await startTake(first);
	await sendRecording(first);
	await first.unmount();

	/*
	 * THE READER COMES BACK INTO A PANE THAT IS STILL OPENING (round-1 finding, UX
	 * U2): `isHydrating` is the hold the pane paints as "Loading conversation…", and
	 * the composer refuses input for as long as it lasts. This mount's deliverer is
	 * the one registered for the origin, so the words land under that hold - and the
	 * refusal must say the chat is still opening, because "that chat could not take
	 * a message" is a claim about a chat the reader is looking at.
	 */
	const back = await mountAt(A, {
		dictatedAwayDelivery: true,
		isHydrating: true,
		unavailable: true,
		onSendMessage: async (content) => {
			posts.push(content);
			return true;
		},
		recordingProbe: {
			canUseRadientSpeech: true,
			speechBlock: "could-not-check",
		},
	});
	await act(async () => {
		release();
	});
	await settle();

	assert.deepEqual(posts, [], "nothing was posted while the pane was opening");
	const refusal = useDictatedSendStore.getState().refused[A];
	assert.equal(
		refusal?.reason,
		"not-ready",
		"the reason is the pane's state - still opening - not an unreachable chat",
	);
	assert.ok(
		typeof refusal?.title === "string" && refusal.title.length > 0,
		"and the refusal names the chat it was bound to",
	);
	assert.equal(
		useConversationInputStore.getState().getCurrentInput(A),
		"hello there",
		"the words are waiting in that chat's draft",
	);
	await back.unmount();
	transcription.restore();
	mic.next = null;
});
