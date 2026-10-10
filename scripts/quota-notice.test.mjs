import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React from "react";

/*
 * The pre-emptive quota notice, driven through the SHIPPED line, hook and
 * transport — not through restatements of them.
 *
 * What this file is evidence FOR. The rules the notice ships (which wire states
 * show, the dismiss signature, the resend classification and phases, the
 * capability gate, the 404's silence) live in `quota-notice.ts` and
 * `use-quota-notice.ts`; the mount lives in the shared composer
 * (`message-input.tsx`). The pure rules are asserted directly, and every
 * renderer claim is driven through the REAL component over a stubbed
 * `/__desktop` fetch — so "the line shows the server's sentence", "the press
 * spends the proxy op with a fresh request id", "a 409 re-reads and shows the
 * verified copy" are facts about the shipped wiring, not about a model of it.
 *
 * What is faked, and only that: the transport below `desktopRequest` (a fetch
 * stub answering the ops the mount issues), and — because task:desktop runs
 * with no Electron — the `window.api` bridge, which is absent here exactly as
 * the credential-composer suite's rig leaves it, so the dev-proxy path is
 * exercised.
 *
 * What this is NOT: proof of pixels. jsdom has no layout engine; the frames in
 * `docs/evidence/chat-quota-notice/` are that half.
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
	UIEvent: window.UIEvent,
	MouseEvent: window.MouseEvent,
	PointerEvent: window.PointerEvent,
	KeyboardEvent: window.KeyboardEvent,
	InputEvent: window.InputEvent,
	ClipboardEvent: window.ClipboardEvent,
	navigator: window.navigator,
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
 * `window.matchMedia`, which jsdom does not implement at all, and the
 * window's OWN timers — the tip row the empty band can render schedules on
 * `window.setInterval`, which is jsdom's function and not the global one this
 * fixture wrapped. One cached object per query, because `matchMedia` is read
 * through `useSyncExternalStore`, whose snapshot must be referentially stable;
 * a fresh object per call re-renders forever (`credential-composer.test.mjs`
 * measured that hang).
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

/*
 * The sentences asserted on, hoisted because this suite's own lint reads a
 * call-scope regex literal as a cost (and the assertions read better as names).
 */
const DEEPSEEK_DEPLETED_BODY =
	/No balance on DeepSeek — top up at the DeepSeek platform\./;
const UUID_SHAPE =
	/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SENT_SENTENCE = /Sent\. Check your inbox and spam folder/;
const RATE_LIMITED_SENTENCE =
	/Requested recently\. Try again in about 2 minutes\./;
/*
 * The verified/no-grant sentence VERBATIM, as `radient_recovery.recovery_line`
 * builds it: the top-up URL is part of the sentence, and the first-top-up
 * bonus is its own line (the `\n` exercises the line's `whitespace-pre-line`
 * for this body, which the unverified frame alone used to report).
 */
const NOTHING_TO_RESEND_BODY =
	/You're out of credits\. Top up in the Radient console: https:\/\/console\.radienthq\.com\/dashboard\/billing\nGet an extra \$5 free on your first top-up of \$10 or more\./;

/* ------------------------------------------------------------------ */
/* The transport, answered from this file                               */
/* ------------------------------------------------------------------ */

/**
 * Every request the shipped transport issued, in order.
 *
 * The dev-proxy path posts the OP-LEVEL request (the vocabulary
 * `desktop-contract.ts` validates), so the log is where "exactly one call",
 * "a forced re-read", "a fresh request id" become assertions rather than
 * claims.
 */
const calls = [];

/** The per-test answer, keyed by op; the default agrees with nothing. */
let answerImpl = () => ({ status: 404, body: { detail: "no stub" } });

const ok = (result) => ({ status: 200, body: { result } });

const quotaNoticeCalls = () =>
	calls.filter((call) => call.op === "quota.notice");
const resendCalls = () =>
	calls.filter(
		(call) =>
			call.op === "radient.request" &&
			call.control?.operation === "signup.resend",
	);

globalThis.fetch = async (_url, init) => {
	let request = {};
	try {
		request = JSON.parse(init?.body ?? "{}");
	} catch {
		request = {};
	}
	calls.push(request);
	/* Awaited rather than destructured synchronously: a case may hold its
	 * answer (U9's `forcedDelayMs`), and `await` passes a plain object through. */
	const answer = await answerImpl(request);
	const { status, body } = answer;
	/*
	 * The OUTER response is always HTTP 200, because that is what the development
	 * proxy is: a passthrough that carries the daemon's own status INSIDE the
	 * envelope (`{status, body}`), which `desktopResult` reads. A stub that
	 * answered the inner status as the HTTP status would never reach
	 * `desktopResult`'s refusal path at all — `desktopRequest` throws its
	 * generic compatibility sentence for any non-ok response and the body is
	 * dropped — so the refusal codes this suite classifies on would be
	 * invisible to every caller here.
	 */
	return {
		ok: true,
		status: 200,
		json: async () => ({ status, body }),
	};
};

/* ------------------------------------------------------------------ */
/* The bundle                                                           */
/* ------------------------------------------------------------------ */

const bundle = await build({
	stdin: {
		contents: `
			export { QuotaNoticeLine } from "./src/renderer/src/features/chat/quota-notice/quota-notice-line.tsx";
			export { MessageInput } from "./src/renderer/src/shared/components/composer/message-input.tsx";
			export {
				quotaNoticeQueryKey,
				quotaNoticeQueryOptions,
			} from "./src/renderer/src/features/chat/quota-notice/use-quota-notice.ts";
			export {
				QUOTA_NOTICE_DISMISSAL_KEY,
				QUOTA_NOTICE_SHOWN_STATES,
				QUOTA_REFRESH_CHECKING_SENTENCE,
				QUOTA_REFRESH_FAILED_SENTENCE,
				QUOTA_REFRESH_UNCHANGED_SENTENCE,
				QUOTA_RESEND_COOLDOWN_MS,
				QUOTA_RESEND_FAILED_SENTENCE,
				QUOTA_RESEND_RATE_LIMITED_SENTENCE,
				QUOTA_RESEND_SENDING_SENTENCE,
				QUOTA_RESEND_SENT_SENTENCE,
				__resetQuotaResendEpisodes,
				advanceQuotaNoticeDismissals,
				classifyResendFailure,
				parseQuotaNoticeDismissals,
				quotaNoticeActions,
				quotaNoticeDismissed,
				quotaNoticeShows,
				quotaRefreshSentence,
				quotaResendEpisodeFor,
				quotaResendView,
				readQuotaNoticeDismissals,
				rememberQuotaResendEpisode,
				writeQuotaNoticeDismissals,
			} from "./src/renderer/src/features/chat/quota-notice/quota-notice.ts";
			export { DesktopControlError } from "./src/renderer/src/shared/api/local-operator/desktop-api.ts";
			export { defaultQueryOptions } from "./src/renderer/src/shared/api/query-client.ts";
			export { QUOTA_NOTICE_SCHEMA } from "./src/shared/desktop-contract.ts";
			export { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
	`./_quota-notice-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const {
	QUOTA_NOTICE_DISMISSAL_KEY,
	QUOTA_NOTICE_SCHEMA,
	QUOTA_NOTICE_SHOWN_STATES,
	QUOTA_REFRESH_CHECKING_SENTENCE,
	QUOTA_REFRESH_FAILED_SENTENCE,
	QUOTA_REFRESH_UNCHANGED_SENTENCE,
	QUOTA_RESEND_FAILED_SENTENCE,
	QUOTA_RESEND_RATE_LIMITED_SENTENCE,
	QUOTA_RESEND_SENDING_SENTENCE,
	QUOTA_RESEND_SENT_SENTENCE,
	QuotaNoticeLine,
	DesktopControlError,
	MessageInput,
	QueryClient,
	QueryClientProvider,
	__resetQuotaResendEpisodes,
	advanceQuotaNoticeDismissals,
	classifyResendFailure,
	defaultQueryOptions,
	parseQuotaNoticeDismissals,
	quotaNoticeActions,
	quotaNoticeDismissed,
	quotaNoticeShows,
	quotaRefreshSentence,
	quotaResendEpisodeFor,
	quotaResendView,
	readQuotaNoticeDismissals,
	rememberQuotaResendEpisode,
	writeQuotaNoticeDismissals,
} = await import(bundlePath.href);
await unlink(bundlePath);

const { createRoot } = await import("react-dom/client");
const { act } = React;
const h = React.createElement;

/* ------------------------------------------------------------------ */
/* Fixtures                                                             */
/* ------------------------------------------------------------------ */

const notice = (over = {}) =>
	QUOTA_NOTICE_SCHEMA.parse({
		state: "depleted",
		provider: "deepseek",
		kind: "balance",
		model_free: false,
		title: "No balance on DeepSeek",
		body: "No balance on DeepSeek — top up at the DeepSeek platform.",
		actions: [
			{
				id: "open_url",
				label: "Top up at the DeepSeek platform",
				url: "https://platform.deepseek.com/top_up",
			},
			{ id: "refresh", label: "I topped up", url: null },
		],
		resets_at_ms: null,
		checked_at_ms: 1,
		age_ms: 0,
		source: "live",
		...over,
	});

const unverified = () =>
	notice({
		state: "unverified",
		provider: "radient",
		kind: "radient",
		title: "Verify your email to claim your free credits",
		body: "You haven't verified your email yet.",
		actions: [
			{
				id: "open_url",
				label: "Open verification page",
				url: "https://console.radienthq.com/dashboard/verification",
			},
			{
				id: "resend_verification",
				label: "Resend verification email",
				url: null,
			},
			{ id: "refresh", label: "I verified", url: null },
		],
	});

/** The default world a mount needs: capabilities, config, census, notice. */
const world = ({
	features = { quota_notice: 1 },
	notice: answer = notice(),
} = {}) => {
	/*
	 * The transport log is per-case, not per-file: several cases assert EXACT
	 * call counts ("one call, no retry", "exactly one press"), and a log that
	 * carried earlier cases' calls forward would make every one of them count
	 * the suite instead of the case.
	 */
	calls.length = 0;
	/*
	 * The dismissal map and the resend episodes are cleared per case: both
	 * outlive a mount (localStorage, module state), so the dismiss case's write
	 * would otherwise hide the line in every later case naming the same pair,
	 * and a remembered cooldown would leak into the next remount case.
	 */
	try {
		window.localStorage.removeItem(QUOTA_NOTICE_DISMISSAL_KEY);
	} catch {
		/* A blocked store has nothing to clear. */
	}
	__resetQuotaResendEpisodes();
	const state = {
		notice: answer,
		providers: [],
		hosting: "deepseek",
		model: "deepseek-chat",
		features,
		failForced: false,
		forcedDelayMs: 0,
	};
	answerImpl = async (request) => {
		if (request.op === "capabilities")
			return ok({
				desktop_contract: 1,
				desktop_available: true,
				desktop_auth: "bearer",
				features: state.features,
			});
		if (request.op === "config.get")
			return ok({
				values: { hosting: state.hosting, model_name: state.model },
			});
		if (request.op === "providers.list")
			return ok({ providers: state.providers });
		if (request.op === "quota.notice") {
			/* `failForced` fails only the user's forced re-read, so the line's
			 * automatic answer still paints and the cue has something to sit on. */
			if (state.failForced && request.refresh === true)
				return {
					status: 500,
					body: { detail: "quota-notice test: forced read failed" },
				};
			/* `forcedDelayMs` holds the forced read so the in-flight cue is
			 * observable before the answer lands (U9's checking arm). */
			if (state.forcedDelayMs > 0 && request.refresh === true)
				await new Promise((resolve) =>
					setTimeout(resolve, state.forcedDelayMs),
				);
			return ok(state.notice);
		}
		if (request.op === "radient.request") return state.resend?.() ?? ok({});
		return {
			status: 404,
			body: { detail: `quota-notice test: unexpected ${request.op}` },
		};
	};
	return state;
};

/* ------------------------------------------------------------------ */
/* The rig                                                              */
/* ------------------------------------------------------------------ */

let root;
let client;
const mounted = [];

/*
 * ONE CONTAINER PER MOUNT, and the previous one is torn down first: jsdom keeps
 * a detached container's markup queryable by `document.querySelector`, so a
 * suite that reuses the element (or leaves one attached) would read a PREVIOUS
 * case's line back as this one's.
 */
function mount(element) {
	/*
	 * Per-MOUNT isolation as well as per-case (see `world`): several cases answer
	 * the transport directly instead of through `world`, and a log that carried
	 * the previous case's calls into them made their exact-count assertions count
	 * the suite.
	 */
	calls.length = 0;
	for (const previous of mounted.splice(0)) {
		act(() => {
			previous.root.unmount();
		});
		previous.container.remove();
	}
	client = new QueryClient({ defaultOptions: defaultQueryOptions });
	const container = window.document.createElement("div");
	window.document.body.appendChild(container);
	root = createRoot(container);
	mounted.push({ root, container });
	act(() => {
		root.render(h(QueryClientProvider, { client }, element));
	});
	return root;
}

/** Let every pending query, effect and microtask settle inside act. */
const settle = async () => {
	for (let pass = 0; pass < 6; pass++) {
		await act(async () => {
			await new Promise((resolve) => realSetTimeout(resolve, 0));
		});
	}
};

const line = () => window.document.querySelector("[data-quota-notice-line]");
const bySelector = (selector) => window.document.querySelector(selector);
const text = () => line()?.textContent ?? "";

const press = async (selector) => {
	const el = bySelector(selector);
	assert.ok(el, `expected ${selector} to be present`);
	await act(async () => {
		el.click();
	});
	await settle();
};

after(() => {
	for (const { root: mountedRoot, container } of mounted.splice(0)) {
		mountedRoot.unmount();
		container.remove();
	}
	for (const id of liveTimers) {
		clearTimeout(id);
		clearInterval(id);
	}
	dom.window.close();
});

/* ------------------------------------------------------------------ */
/* The pure rules                                                       */
/* ------------------------------------------------------------------ */

test("the shown states are the wire's warning states, by positive list", () => {
	for (const state of ["depleted", "limit_reached", "unverified"])
		assert.equal(quotaNoticeShows({ state }), true, state);
	for (const state of ["ok", "unknown", "not_applicable"])
		assert.equal(quotaNoticeShows({ state }), false, state);
	assert.equal(quotaNoticeShows(null), false);
	assert.equal(quotaNoticeShows(undefined), false);
	// A future diagnostic state must not start showing a notice by omission.
	assert.equal(quotaNoticeShows({ state: "some_future_state" }), false);
	// And the list itself is the three, so a wire state the notice cannot
	// render cannot be added to the shown set silently.
	assert.deepEqual(
		[...QUOTA_NOTICE_SHOWN_STATES],
		["depleted", "limit_reached", "unverified"],
	);
});

test("a dismissal is a per-provider map, validated on read, re-armed by a state change", () => {
	// The stored shape: provider -> the state the reader dismissed.
	const stored = JSON.stringify({
		radient: "unverified",
		deepseek: "depleted",
	});
	const map = parseQuotaNoticeDismissals(stored);
	assert.deepEqual(map, { radient: "unverified", deepseek: "depleted" });
	assert.equal(quotaNoticeDismissed(map, "radient", "unverified"), true);
	assert.equal(quotaNoticeDismissed(map, "deepseek", "depleted"), true);
	// A different state for the same provider is not dismissed, and neither is
	// a different provider carrying the same state.
	assert.equal(quotaNoticeDismissed(map, "radient", "depleted"), false);
	assert.equal(quotaNoticeDismissed(map, "anthropic", "depleted"), false);

	// Hand-edited, truncated or legacy values never read as dismissals.
	assert.deepEqual(parseQuotaNoticeDismissals(""), {});
	assert.deepEqual(parseQuotaNoticeDismissals("radient\nunverified"), {});
	assert.deepEqual(parseQuotaNoticeDismissals("{garbage"), {});
	assert.deepEqual(parseQuotaNoticeDismissals("true"), {});
	assert.deepEqual(parseQuotaNoticeDismissals("[]"), {});
	assert.deepEqual(parseQuotaNoticeDismissals('{"radient": ""}'), {});

	/*
	 * The re-arm rule (R1-M2/U3): an observed answer for provider P clears P's
	 * entry the moment it names a DIFFERENT state — including a non-shown one,
	 * which is what lets `depleted -> ok -> depleted` show the line again.
	 */
	const afterOk = advanceQuotaNoticeDismissals(map, "radient", "ok");
	assert.deepEqual(afterOk, { deepseek: "depleted" });
	// Same state: the episode has not left, so the entry stays, by IDENTITY
	// (a caller skips its write and its re-render on it).
	assert.equal(advanceQuotaNoticeDismissals(map, "radient", "unverified"), map);
	// A provider with no entry is left alone.
	assert.equal(advanceQuotaNoticeDismissals(map, "anthropic", "depleted"), map);
	// Two interleaved providers: advancing one never touches the other's entry.
	const interleaved = advanceQuotaNoticeDismissals(map, "radient", "depleted");
	assert.deepEqual(interleaved, { deepseek: "depleted" });
	assert.equal(quotaNoticeDismissed(interleaved, "deepseek", "depleted"), true);
});

test("the resend phases show their own sentences, and expire on their own clock", () => {
	const now = 1_000;
	assert.deepEqual(quotaResendView({ kind: "idle" }, now), {
		disabled: false,
		sentence: null,
		offered: true,
	});
	// In flight says so (U8/N2): the disabled control is not silent.
	assert.deepEqual(quotaResendView({ kind: "sending" }, now), {
		disabled: true,
		sentence: QUOTA_RESEND_SENDING_SENTENCE,
		offered: true,
	});
	assert.deepEqual(quotaResendView({ kind: "sent", until: now + 1 }, now), {
		disabled: true,
		sentence: QUOTA_RESEND_SENT_SENTENCE,
		offered: true,
	});
	assert.deepEqual(
		quotaResendView({ kind: "rate_limited", until: now + 1 }, now),
		{
			disabled: true,
			sentence: QUOTA_RESEND_RATE_LIMITED_SENTENCE,
			offered: true,
		},
	);
	// The retryable failure stays offered WITH its sentence (U1).
	assert.deepEqual(quotaResendView({ kind: "failed" }, now), {
		disabled: false,
		sentence: QUOTA_RESEND_FAILED_SENTENCE,
		offered: true,
	});
	// An expired deadline reads exactly as idle, without a second transition.
	assert.deepEqual(quotaResendView({ kind: "sent", until: now }, now), {
		disabled: false,
		sentence: null,
		offered: true,
	});
	assert.deepEqual(quotaResendView({ kind: "degraded" }, now), {
		disabled: false,
		sentence: null,
		offered: false,
	});
});

test("the refresh cues are their own sentences, and idle says nothing (U2)", () => {
	assert.equal(quotaRefreshSentence("idle"), null);
	assert.equal(
		quotaRefreshSentence("checking"),
		QUOTA_REFRESH_CHECKING_SENTENCE,
	);
	assert.equal(
		quotaRefreshSentence("unchanged"),
		QUOTA_REFRESH_UNCHANGED_SENTENCE,
	);
	assert.equal(quotaRefreshSentence("failed"), QUOTA_REFRESH_FAILED_SENTENCE);
});

test("the resend episode survives the mount and expires on its own clock (U8)", () => {
	__resetQuotaResendEpisodes();
	const now = 5_000;
	assert.equal(quotaResendEpisodeFor("radient", now), null);
	rememberQuotaResendEpisode("radient", { kind: "sent", until: now + 1 });
	assert.deepEqual(quotaResendEpisodeFor("radient", now), {
		kind: "sent",
		until: now + 1,
	});
	// A different provider has no episode; an expired one reads as gone.
	assert.equal(quotaResendEpisodeFor("deepseek", now), null);
	assert.equal(quotaResendEpisodeFor("radient", now + 1), null);
	// ...and is DROPPED on that read, so the map tracks live episodes only.
	assert.equal(quotaResendEpisodeFor("radient", now + 2), null);
	// The retryable failure is remembered too, and never expires by itself.
	rememberQuotaResendEpisode("deepseek", { kind: "failed" });
	assert.deepEqual(quotaResendEpisodeFor("deepseek", now + 10_000_000), {
		kind: "failed",
	});
	__resetQuotaResendEpisodes();
});

test("a resend refusal is classified by code, never by status", () => {
	const withCode = (code, status = 400) => {
		const error = new DesktopControlError(status, "refused");
		Object.defineProperty(error, "code", { value: code });
		return error;
	};
	assert.deepEqual(
		classifyResendFailure(withCode("signup_resend_rate_limited", 429)),
		{ kind: "rate_limited" },
	);
	assert.deepEqual(
		classifyResendFailure(withCode("signup_resend_nothing_to_resend", 409)),
		{ kind: "nothing_to_resend" },
	);
	// An older backend answers the OP with a masked 422: degrade to the link.
	assert.deepEqual(
		classifyResendFailure(new DesktopControlError(422, "masked")),
		{
			kind: "degraded",
		},
	);
	assert.deepEqual(
		classifyResendFailure(withCode("radient_credential_refused", 401)),
		{ kind: "degraded" },
	);
	assert.deepEqual(
		classifyResendFailure(withCode("radient_no_credential", 409)),
		{ kind: "degraded" },
	);
	// Everything else is retryable: a blip, an upstream failure — and the
	// desktop plane's own refusals, which say nothing about the account.
	assert.deepEqual(
		classifyResendFailure(withCode("radient_upstream_failed", 502)),
		{ kind: "retryable" },
	);
	assert.deepEqual(
		classifyResendFailure(new DesktopControlError(null, "dead")),
		{
			kind: "retryable",
		},
	);
	assert.deepEqual(classifyResendFailure(new Error("boom")), {
		kind: "retryable",
	});
});

test("the degraded resend is the only action the local rule may remove", () => {
	const actions = unverified().actions;
	assert.deepEqual(
		quotaNoticeActions(actions, false).map((action) => action.id),
		["open_url", "refresh"],
	);
	assert.deepEqual(
		quotaNoticeActions(actions, true).map((action) => action.id),
		["open_url", "resend_verification", "refresh"],
	);
});

/* ------------------------------------------------------------------ */
/* The real path                                                        */
/* ------------------------------------------------------------------ */

test("the capability gate keeps an older backend from ever being asked", async () => {
	world({ features: {} });
	mount(h(QuotaNoticeLine));
	await settle();
	assert.equal(quotaNoticeCalls().length, 0, "no quota.notice call was made");
	assert.equal(line(), null);
});

test("a depleted verdict paints the sentence and its actions; I topped up forces a re-read", async () => {
	const state = world();
	mount(h(QuotaNoticeLine));
	await settle();
	assert.equal(quotaNoticeCalls().length, 1);
	assert.ok(line());
	assert.equal(
		bySelector("[data-quota-notice-state]")?.getAttribute(
			"data-quota-notice-state",
		),
		"depleted",
	);
	assert.match(text(), DEEPSEEK_DEPLETED_BODY);
	assert.ok(
		bySelector("[data-quota-notice-open-url]"),
		"the top-up link is offered",
	);
	assert.ok(
		bySelector("[data-quota-notice-refresh-action]"),
		"I topped up is offered",
	);

	// "I topped up": one FORCED re-read (refresh=true), and the answer that comes
	// back is what repaints the line.
	state.notice = notice({ state: "ok", title: "", body: "", actions: [] });
	await press("[data-quota-notice-refresh-action]");
	const forced = quotaNoticeCalls().filter((call) => call.refresh === true);
	assert.equal(forced.length, 1, "exactly one forced read");
	assert.equal(forced[0].provider, "deepseek");
	assert.equal(forced[0].model, "deepseek-chat");
	assert.equal(line(), null, "a silent verdict leaves no line");
});

test("the resend press spends the proxy op once, with a fresh id, and shows the receipt", async () => {
	const state = world({ notice: unverified() });
	state.hosting = "radient";
	state.model = "radient/auto";
	state.resend = () => ok({ data: { msg: "ok", result: { status: 200 } } });
	mount(h(QuotaNoticeLine));
	await settle();
	assert.ok(bySelector("[data-quota-notice-resend-action]"));

	await press("[data-quota-notice-resend-action]");
	const resends = resendCalls();
	assert.equal(resends.length, 1, "exactly one proxy call");
	assert.match(resends[0].control.request_id, UUID_SHAPE);
	assert.equal(
		bySelector("[data-quota-notice-line]")?.getAttribute(
			"data-quota-notice-resend-phase",
		),
		"sent",
	);
	assert.match(text(), SENT_SENTENCE);

	// The cooldown disables the control, so a second press is a no-op.
	await press("[data-quota-notice-resend-action]");
	assert.equal(
		resendCalls().length,
		1,
		"the cooldown swallowed the second press",
	);
});

test("a rate-limited resend shows the server's own cooldown sentence, not a credential refusal", async () => {
	const state = world({ notice: unverified() });
	state.hosting = "radient";
	state.model = "radient/auto";
	state.resend = () => ({
		status: 429,
		body: {
			detail: {
				code: "signup_resend_rate_limited",
				message: "A verification email was requested recently",
			},
		},
	});
	mount(h(QuotaNoticeLine));
	await settle();
	await press("[data-quota-notice-resend-action]");
	assert.equal(
		bySelector("[data-quota-notice-line]")?.getAttribute(
			"data-quota-notice-resend-phase",
		),
		"rate_limited",
	);
	assert.match(text(), RATE_LIMITED_SENTENCE);
});

test("nothing to resend re-reads the notice and the verified copy replaces the line", async () => {
	const state = world({ notice: unverified() });
	state.hosting = "radient";
	state.model = "radient/auto";
	state.resend = () => ({
		status: 409,
		body: {
			detail: {
				code: "signup_resend_nothing_to_resend",
				message: "There are no free credits waiting to be claimed",
			},
		},
	});
	mount(h(QuotaNoticeLine));
	await settle();
	const before = quotaNoticeCalls().length;

	state.notice = notice({
		state: "depleted",
		provider: "radient",
		kind: "radient",
		title: "No credit left on Radient",
		/* The core builder's words, URL and bonus line included (review R1-m3):
		 * a paraphrase here would let the line pass on copy the backend never
		 * sends. */
		body: "You're out of credits. Top up in the Radient console: https://console.radienthq.com/dashboard/billing\nGet an extra $5 free on your first top-up of $10 or more.",
		actions: [
			{
				id: "open_url",
				label: "Top up at Radient",
				url: "https://console.radienthq.com/dashboard/billing",
			},
			{ id: "refresh", label: "I topped up", url: null },
		],
	});
	await press("[data-quota-notice-resend-action]");
	assert.equal(
		quotaNoticeCalls().length,
		before + 1,
		"the 409 triggered one forced re-read",
	);
	assert.equal(
		quotaNoticeCalls().at(-1).refresh,
		true,
		"and the re-read is the forced kind",
	);
	assert.match(text(), NOTHING_TO_RESEND_BODY);
	assert.equal(bySelector("[data-quota-notice-resend-action]"), null);
});

test("an older backend's masked 422 degrades to the verification-page link", async () => {
	const state = world({ notice: unverified() });
	state.hosting = "radient";
	state.model = "radient/auto";
	state.resend = () => ({
		status: 422,
		body: { detail: "The request has invalid fields." },
	});
	mount(h(QuotaNoticeLine));
	await settle();
	await press("[data-quota-notice-resend-action]");
	assert.equal(
		bySelector("[data-quota-notice-resend-action]"),
		null,
		"the resend offer is gone",
	);
	assert.ok(
		bySelector("[data-quota-notice-open-url]"),
		"the verification link stands",
	);
	// And the degrade is stable: no new proxy call was attempted.
	assert.equal(resendCalls().length, 1);
});

test("a 404 is silence, not a retry and not a crash", async () => {
	answerImpl = (request) => {
		if (request.op === "capabilities")
			return ok({
				desktop_contract: 1,
				desktop_available: true,
				desktop_auth: "bearer",
				features: { quota_notice: 1 },
			});
		if (request.op === "config.get")
			return ok({
				values: { hosting: "deepseek", model_name: "deepseek-chat" },
			});
		if (request.op === "providers.list") return ok({ providers: [] });
		if (request.op === "quota.notice")
			return { status: 404, body: { detail: "Not Found" } };
		return { status: 404, body: { detail: `unexpected ${request.op}` } };
	};
	mount(h(QuotaNoticeLine));
	await settle();
	assert.equal(quotaNoticeCalls().length, 1, "one call, no retry");
	assert.equal(line(), null);
});

test("a login re-asks: the census's credential change is the signal", async () => {
	const state = world();
	mount(h(QuotaNoticeLine));
	await settle();
	const before = quotaNoticeCalls().length;

	// A credential lands (the app invalidates this key on every credential
	// write); the census re-reads and its credential signal changes.
	state.providers = [
		{ id: "deepseek", has_credential: true, stored_credentials: 1 },
	];
	await act(async () => {
		await client.invalidateQueries({
			queryKey: ["desktop", "auth", "providers"],
		});
	});
	await settle();
	assert.equal(
		quotaNoticeCalls().length,
		before + 1,
		"the notice was re-asked",
	);
});

test("focus re-asks while a notice is on screen, and stays put once it is gone", async () => {
	const state = world();
	mount(h(QuotaNoticeLine));
	await settle();
	const before = quotaNoticeCalls().length;

	await act(async () => {
		window.dispatchEvent(new window.Event("focus"));
	});
	await settle();
	assert.equal(
		quotaNoticeCalls().length,
		before + 1,
		"a visible notice re-asks on focus",
	);

	// The account recovers: nothing shows, and focus spends no call.
	state.notice = notice({ state: "ok", title: "", body: "", actions: [] });
	await press("[data-quota-notice-refresh-action]");
	assert.equal(line(), null);
	const quiet = quotaNoticeCalls().length;
	await act(async () => {
		window.dispatchEvent(new window.Event("focus"));
	});
	await settle();
	assert.equal(quotaNoticeCalls().length, quiet, "no notice, no focus read");
});

test("dismiss hides one pair, re-arms on recovery, and leaves other providers alone", async () => {
	const state = world({ notice: unverified() });
	state.hosting = "radient";
	state.model = "radient/auto";
	mount(h(QuotaNoticeLine));
	await settle();
	await press("[data-quota-notice-dismiss]");
	assert.equal(line(), null, "the dismissal hides the line");
	assert.equal(
		window.localStorage.getItem(QUOTA_NOTICE_DISMISSAL_KEY),
		JSON.stringify({ radient: "unverified" }),
	);

	/*
	 * THE RECOVERY CYCLE (R1-M2 / U3): dismissed -> ok -> depleted again must
	 * SHOW. The `ok` answer clears the entry (its state left the dismissed
	 * one), so the second depletion has nothing hiding it.
	 */
	state.notice = notice({
		state: "ok",
		provider: "radient",
		title: "",
		body: "",
		actions: [],
	});
	await act(async () => {
		window.dispatchEvent(new window.Event("focus"));
	});
	await settle();
	assert.equal(line(), null, "ok shows nothing");
	assert.equal(
		window.localStorage.getItem(QUOTA_NOTICE_DISMISSAL_KEY),
		JSON.stringify({}),
		"the ok answer cleared the spent dismissal",
	);

	state.notice = notice({
		state: "depleted",
		provider: "radient",
		kind: "radient",
		title: "No credit left on Radient",
		body: "You're out of credits. Top up in the Radient console.",
		actions: [{ id: "refresh", label: "I topped up", url: null }],
	});
	/*
	 * The transition is driven by a query invalidation rather than a focus:
	 * with the `ok` answer on screen nothing is visible, and the hook's focus
	 * listener deliberately asks only while a notice shows. Invalidation is
	 * the app's own re-read path (a session open refetches on the same terms).
	 */
	await act(async () => {
		await client.invalidateQueries({ queryKey: ["desktop", "quota-notice"] });
	});
	await settle();
	assert.ok(
		line(),
		"the second depletion shows — the dismissal did not survive recovery",
	);

	/*
	 * TWO INTERLEAVED PAIRS: dismissing one provider leaves the other visible,
	 * and each pair's own lifecycle stays its own.
	 */
	await press("[data-quota-notice-dismiss]");
	state.hosting = "deepseek";
	state.model = "deepseek-chat";
	state.notice = notice();
	await act(async () => {
		window.dispatchEvent(new window.Event("focus"));
	});
	await settle();
	assert.ok(
		line(),
		"the other provider's notice is not hidden by the first dismissal",
	);
	await press("[data-quota-notice-dismiss]");
	assert.equal(
		window.localStorage.getItem(QUOTA_NOTICE_DISMISSAL_KEY),
		JSON.stringify({ radient: "depleted", deepseek: "depleted" }),
		"both pairs stay dismissed at once",
	);
});

test("the pane's own model is the one checked, and a pick change re-asks (Q3/R1-M1)", async () => {
	const state = world();
	mount(h(QuotaNoticeLine));
	await settle();
	// No pane selection: the config default answers (the documented fallback).
	assert.deepEqual(
		[quotaNoticeCalls()[0].provider, quotaNoticeCalls()[0].model],
		["deepseek", "deepseek-chat"],
	);

	// The same mount's pane picks Anthropic: the key follows the pick, so one
	// new read goes out for the account the send would actually use.
	act(() => {
		root.render(
			h(
				QueryClientProvider,
				{ client },
				h(QuotaNoticeLine, {
					selection: { provider: "anthropic", model_id: "claude-sonnet-5-5" },
				}),
			),
		);
	});
	await settle();
	assert.equal(
		quotaNoticeCalls().length,
		2,
		"the pick change re-asks exactly once",
	);
	assert.equal(quotaNoticeCalls()[1].provider, "anthropic");
	assert.equal(quotaNoticeCalls()[1].model, "claude-sonnet-5-5");
});

test("three same-task presses spend one resend op (Q1)", async () => {
	const state = world({ notice: unverified() });
	state.hosting = "radient";
	state.model = "radient/auto";
	// The op never settles: the press stays in flight for the whole case.
	state.resend = () => new Promise(() => {});
	mount(h(QuotaNoticeLine));
	await settle();

	await act(async () => {
		const button = bySelector("[data-quota-notice-resend-action]");
		button.click();
		button.click();
		button.click();
	});
	assert.equal(
		resendCalls().length,
		1,
		"the in-flight ref swallowed the repeats",
	);
});

test("a failed press says so, stays offered, and a retry can still win (U1)", async () => {
	const state = world({ notice: unverified() });
	state.hosting = "radient";
	state.model = "radient/auto";
	state.resend = () => ({
		status: 502,
		body: {
			detail: {
				code: "radient_upstream_failed",
				message: "Radient could not be reached",
			},
		},
	});
	mount(h(QuotaNoticeLine));
	await settle();
	await press("[data-quota-notice-resend-action]");
	assert.equal(
		bySelector("[data-quota-notice-line]")?.getAttribute(
			"data-quota-notice-resend-phase",
		),
		"failed",
	);
	assert.match(text(), /Could not send\. Try again\./);
	assert.equal(
		bySelector("[data-quota-notice-resend-action]")?.hasAttribute("disabled"),
		false,
		"the button is offered again",
	);

	state.resend = () => ok({ data: { msg: "ok", result: { status: 200 } } });
	await press("[data-quota-notice-resend-action]");
	assert.match(text(), /Sent\. Check your inbox and spam folder\./);
	assert.equal(resendCalls().length, 2);
});

test("the re-read's outcome is readable, changed or not (U2)", async () => {
	const state = world();
	mount(h(QuotaNoticeLine));
	await settle();

	// Unchanged: the same depleted answer comes back, and the cue says so.
	await press("[data-quota-notice-refresh-action]");
	assert.match(text(), /Checked just now — no change yet\./);

	// Changed: the answer flips to ok, the line goes, and no stale cue remains.
	state.notice = notice({ state: "ok", title: "", body: "", actions: [] });
	await press("[data-quota-notice-refresh-action]");
	assert.equal(line(), null, "the changed answer cleared the line");
});

test("a re-read that fails says so and keeps the last answer (U2)", async () => {
	const state = world();
	// The automatic read answers; the FORCED one fails at the transport level.
	state.failForced = true;
	mount(h(QuotaNoticeLine));
	await settle();
	assert.ok(line(), "the automatic read painted the line");
	await press("[data-quota-notice-refresh-action]");
	assert.match(text(), /Could not check\. Try again\./);
	assert.ok(line(), "the last answer stands");
});

test("a sentence does not outlive the state it describes (U4)", async () => {
	const state = world({ notice: unverified() });
	state.hosting = "radient";
	state.model = "radient/auto";
	state.resend = () => ({
		status: 429,
		body: {
			detail: {
				code: "signup_resend_rate_limited",
				message: "A verification email was requested recently",
			},
		},
	});
	mount(h(QuotaNoticeLine));
	await settle();
	await press("[data-quota-notice-resend-action]");
	assert.match(text(), /Requested recently\. Try again in about 2 minutes\./);

	// The account tops up while the sentence is on screen: the verdict flips,
	// and the rate-limit sentence must not sit beside a top-up action.
	state.notice = notice({
		state: "depleted",
		provider: "deepseek",
		kind: "balance",
		title: "No balance on DeepSeek",
		body: "No balance on DeepSeek — top up at the DeepSeek platform.",
		actions: [{ id: "refresh", label: "I topped up", url: null }],
	});
	await act(async () => {
		window.dispatchEvent(new window.Event("focus"));
	});
	await settle();
	assert.ok(line());
	assert.doesNotMatch(text(), /Requested recently/);
});

test("a keyboard press keeps focus on the line (U5)", async () => {
	const state = world({ notice: unverified() });
	state.hosting = "radient";
	state.model = "radient/auto";
	state.resend = () => ok({ data: { msg: "ok", result: { status: 200 } } });
	mount(h(QuotaNoticeLine));
	await settle();
	/* jsdom's `click()` carries `detail: 0`, the same field a keyboard press
	 * sets, so this drives the keyboard path the browser's Space/Enter does. */
	await press("[data-quota-notice-resend-action]");
	assert.equal(
		window.document.activeElement?.getAttribute("data-quota-notice-status"),
		"",
		"focus moved to the status sentence, not to <body>",
	);
});

test("the cooldown survives a New-chat remount (U8)", async () => {
	const state = world({ notice: unverified() });
	state.hosting = "radient";
	state.model = "radient/auto";
	state.resend = () => ok({ data: { msg: "ok", result: { status: 200 } } });
	mount(h(QuotaNoticeLine));
	await settle();
	await press("[data-quota-notice-resend-action]");
	assert.equal(resendCalls().length, 1);

	// New chat: a fresh mount, same provider. The episode is remembered.
	mount(h(QuotaNoticeLine));
	await settle();
	assert.equal(
		bySelector("[data-quota-notice-line]")?.getAttribute(
			"data-quota-notice-resend-phase",
		),
		"sent",
		"the remount reads the live episode",
	);
	assert.match(text(), /Sent\. Check your inbox and spam folder\./);
	/* The remount reset the transport log; count from it, not from the pre-remount total. */
	const afterRemount = resendCalls().length;
	await press("[data-quota-notice-resend-action]");
	assert.equal(
		resendCalls().length,
		afterRemount,
		"the restored cooldown swallowed the press",
	);
});

/*
 * THE MOUNT: the line lives on the shared composer's empty band, and only
 * there. Driven through the shipped `MessageInput` because that is the hunk
 * this PR adds — a props-level test of the line could not tell a missing mount
 * from a hidden one.
 */
test("the composer shows the line on the empty band and hides it once a message exists", async () => {
	world({ notice: unverified() });
	const base = {
		isLoading: false,
		onSendMessage: async () => {},
	};
	mount(h(MessageInput, { ...base, messages: [] }));
	await settle();
	assert.ok(
		window.document.querySelector("[data-quota-notice-line]"),
		"the empty band shows the line",
	);

	// A conversation with content: the band is no longer empty, so the line is
	// not mounted at all (and its read therefore never runs).
	mount(
		h(MessageInput, {
			...base,
			messages: [
				{
					id: "m1",
					role: "user",
					content: "hello",
					created_at: "2026-01-01T00:00:00Z",
				},
			],
		}),
	);
	await settle();
	assert.equal(
		window.document.querySelector("[data-quota-notice-line]"),
		null,
		"a session with content shows no line",
	);
});

test("the composer hands the pane's own model to the row (QA S1)", async () => {
	world({ notice: unverified() });
	mount(
		h(MessageInput, {
			isLoading: false,
			messages: [],
			onSendMessage: async () => {},
			/*
			 * The pane's pick, as the preview publishes it: a draft's selection
			 * that deliberately does NOT write the machine default (the config
			 * stub still says deepseek/deepseek-chat).
			 */
			sessionStatus: {
				frontend: {
					selected_model: {
						provider: "anthropic",
						model_id: "claude-sonnet-5-5",
					},
					effective_model: null,
				},
			},
		}),
	);
	await settle();
	const notices = quotaNoticeCalls();
	assert.equal(notices.length, 1);
	assert.equal(
		notices[0].provider,
		"anthropic",
		"the pane's provider, not the default's",
	);
	assert.equal(notices[0].model, "claude-sonnet-5-5");
});

test("a re-read takes the status slot while checking and holds it when settled (U9)", async () => {
	const state = world({ notice: unverified() });
	state.hosting = "radient";
	state.model = "radient/auto";
	state.resend = () => ok({ data: { msg: "ok", result: { status: 200 } } });
	state.forcedDelayMs = 600;
	mount(h(QuotaNoticeLine));
	await settle();
	await press("[data-quota-notice-resend-action]");
	assert.match(text(), /Sent\. Check your inbox and spam folder\./);

	// Press "I verified" while the Sent sentence holds the slot. The held read
	// is in flight, so the cue must take the slot over the resend sentence.
	await act(async () => {
		bySelector("[data-quota-notice-refresh-action]")?.click();
	});
	await settle();
	assert.match(text(), /Checking…/);
	assert.doesNotMatch(text(), /Sent\. Check your inbox/);

	// The held read settles unchanged: the cue holds; the older sentence stays out.
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 700));
	});
	await settle();
	assert.match(text(), /Checked just now — no change yet\./);
	assert.doesNotMatch(text(), /Sent\. Check your inbox/);

	// A NEWER resend press takes the slot back once its cooldown has passed:
	// the cue is cleared as that press starts, so an older sentence never wins.
	const realNow = Date.now;
	try {
		Date.now = () => realNow() + 130_000;
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 1100));
		});
		await settle();
		assert.equal(
			bySelector("[data-quota-notice-resend-action]")?.hasAttribute("disabled"),
			false,
			"the cooldown expired",
		);
		state.resend = () => ({
			status: 429,
			body: {
				detail: {
					code: "signup_resend_rate_limited",
					message: "A verification email was requested recently",
				},
			},
		});
		await press("[data-quota-notice-resend-action]");
		assert.match(text(), /Requested recently\./);
		assert.doesNotMatch(text(), /Checked just now/);
	} finally {
		Date.now = realNow;
	}
});

test("a keyboard re-read keeps focus on the line while it says Checking… (U9)", async () => {
	const state = world({ notice: unverified() });
	state.hosting = "radient";
	state.model = "radient/auto";
	state.resend = () => ok({ data: { msg: "ok", result: { status: 200 } } });
	state.forcedDelayMs = 600;
	mount(h(QuotaNoticeLine));
	await settle();
	/* jsdom's `click()` carries `detail: 0`: the keyboard path throughout. */
	await press("[data-quota-notice-resend-action]");
	/* Drop the U5 focus deliberately, so the next transition has to bring it back. */
	window.document.activeElement?.blur?.();
	await settle();
	await act(async () => {
		bySelector("[data-quota-notice-refresh-action]")?.click();
	});
	await settle();
	assert.equal(
		window.document.activeElement?.getAttribute("data-quota-notice-status"),
		"",
		"focus rode the Checking… cue instead of falling to <body>",
	);
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 700));
	});
	await settle();
});

test("a keyboard Dismiss returns focus to the composer (N5)", async () => {
	world({ notice: unverified() });
	mount(
		h(MessageInput, {
			isLoading: false,
			messages: [],
			onSendMessage: async () => {},
		}),
	);
	await settle();
	assert.ok(line(), "the line is on the empty band");
	await press("[data-quota-notice-dismiss]");
	assert.equal(line(), null, "the dismissal cleared the line");
	assert.equal(
		window.document.activeElement?.tagName,
		"TEXTAREA",
		"focus moved to the composer rather than <body>",
	);
});

test("effective_model wins over selected_model through the composer (R2-m3)", async () => {
	world({ notice: unverified() });
	mount(
		h(MessageInput, {
			isLoading: false,
			messages: [],
			onSendMessage: async () => {},
			sessionStatus: {
				frontend: {
					/* Both present: the pair the chip shows is the effective one. */
					effective_model: { provider: "deepseek", model_id: "deepseek-chat" },
					selected_model: {
						provider: "anthropic",
						model_id: "claude-sonnet-5-5",
					},
				},
			},
		}),
	);
	await settle();
	const notices = quotaNoticeCalls();
	assert.equal(notices.length, 1);
	assert.equal(notices[0].provider, "deepseek", "effective, not selected");
	assert.equal(notices[0].model, "deepseek-chat");
});
