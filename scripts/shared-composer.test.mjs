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
		if (typeof request.name === "string")
			return answer({
				data: { detail: "# release-notes\n\nWrite the release notes.\n" },
			});
		return answer({
			data: { skills: [{ name: "release-notes" }, { name: "research" }] },
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

test("a draft's first-message seam answers with the composed `$skill` payload (QA round 1, Q-1)", async () => {
	/*
	 * THE BLOCKER'S REGRESSION. On a draft pane the composer hands the store a
	 * `beforeAdmission` seam, and the store LETS ITS RETURN REPLACE the text the
	 * press built (`admitChatDraft`: `(await beforeAdmission(id)) ?? text`). The
	 * seam used to answer with the substituted raw line, so a first-message
	 * `$skill` reached the model as prose - QA measured it live (S12: the
	 * daemon's transcript holds the typed line; the read had succeeded, the
	 * payload had been built, and the replacement discarded it). This case
	 * drives the SHIPPED composer's own submit on a draft mount, takes the seam
	 * the host is handed, invokes it the way the store does (with the session a
	 * create would return), and reads its answer: the composed payload, byte for
	 * byte the first argument the host received.
	 *
	 * The store's half - "the seam's answer is what is sent" - is pinned in
	 * `canonical-chat.test.mjs`; together the two cases cover the chain that
	 * failed end to end. THIS case discriminates the composer's half: restored
	 * to `return settled.text`, the final assertion fails (mutation-checked).
	 */
	transportOps.length = 0;
	const { MessageInput: ProvidedMessageInput } =
		await buildProvidedComposerBundle();

	const sent = [];
	let handle = null;
	const container = window.document.createElement("div");
	window.document.body.appendChild(container);
	const seamRoot = createRoot(container);
	await act(async () => {
		seamRoot.render(
			h(ProvidedMessageInput, {
				conversationId: `shared-composer-seam-${++mountSeq}`,
				messages: [],
				isLoading: false,
				/*
				 * A DRAFT PANE, BY CONSTRUCTION: no `sessionStatus` means
				 * `credentialSessionId` is undefined - the ONE condition that hands
				 * the host a seam (`message-input.tsx`).
				 */
				cwd: "~",
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
	assert.ok(handle?.submitNow, "the composer's handle is mounted");

	/*
	 * THE VOCABULARY MUST HAVE LANDED BEFORE THE PRESS: the send parses the
	 * TYPED line against `skillNamesRef` at call time, and a press before the
	 * sessionless read settles would send prose for a harness reason rather than
	 * a product one. The wait is BOUNDED and the read is asserted afterwards, so
	 * a mount that fetched nothing fails loudly instead of sleeping green.
	 */
	for (let pass = 0; pass < 40; pass++) {
		if (transportOps.includes("skills.list")) break;
		await settle();
	}
	assert.ok(
		transportOps.filter((op) => op === "skills.list").length >= 1,
		"the sessionless vocabulary read fired (folder + capability + provider)",
	);
	await settle();

	const field = container.querySelector("textarea");
	const valueSetter = Object.getOwnPropertyDescriptor(
		window.HTMLTextAreaElement.prototype,
		"value",
	).set;
	await act(async () => {
		valueSetter.call(field, "$release-notes QA fixture: summarise today.");
		field.dispatchEvent(new window.Event("input", { bubbles: true }));
	});
	await settle();
	assert.equal(field.value, "$release-notes QA fixture: summarise today.");

	await act(async () => {
		handle.submitNow();
	});
	await settle();
	assert.equal(sent.length, 1, "one send reached the host");
	const [content, , , typed, seam] = sent[0];
	assert.equal(typed, "$release-notes QA fixture: summarise today.");
	assert.match(
		content,
		/<skill name="release-notes" invocation="\$release-notes QA fixture: summarise today\.">/,
		"the first argument is the composed payload, not the raw line",
	);
	assert.equal(typeof seam, "function", "a draft pane hands the host a seam");
	/*
	 * AND THE SEAM'S ANSWER IS THE PAYLOAD (the regression proper): the store
	 * sends this string verbatim - `?? text` is only for a seam that declines.
	 */
	const rendered = await seam("1234567890ab");
	assert.equal(
		rendered,
		content,
		"the seam composes rather than replaces - the payload survives it",
	);
	assert.notEqual(rendered, typed, "and it is not the typed line");
	await act(async () => {
		seamRoot.unmount();
	});
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
		frame.container.querySelector('[aria-label="Confirm recording"]');

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
		frame.container.querySelector('[aria-label="Confirm recording"]');

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
		frame.container.querySelector('[aria-label="Confirm recording"]');

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
		frame.container.querySelector('[aria-label="Confirm recording"]');
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
		frame.container.querySelector('[aria-label="Confirm recording"]');

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
		frame.container.querySelector('[aria-label="Confirm recording"]');
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
		frame.container.querySelector('[aria-label="Confirm recording"]');

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
		COMPOSER_PLACEHOLDER.stopping,
		"a Stop press in flight is answered where the finger is",
	);
	assert.equal(
		composerPlaceholder({
			...base,
			sendingUnsettled: true,
			awaitingReply: true,
		}),
		COMPOSER_PLACEHOLDER.sending,
		"and without a press the send sentence is unchanged",
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
