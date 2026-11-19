#!/usr/bin/env node
/*
 * THE COMPOSER KEYSTROKE COST BENCH.
 *
 * A measuring instrument AND the regression pin for the composer's typing cost.
 * The operator's report (2026-11-08) was that the box gets slow to type in once
 * images are staged, "slower and slower the more attachments there are", with
 * the whole UI freezing — the shape of a per-keystroke cost that scales with the
 * staged payload and repaints surfaces that have no business repainting.
 *
 * WHAT IT DRIVES, and how faithful it is. The REAL store module
 * (`shared/store/conversation-input-store.ts`) and the REAL jsdom `localStorage`,
 * through the exact two writes `use-message-input.ts`'s `handleChange` makes per
 * keystroke (`setCurrentInput` then `resetCurrentHistoryIndex`; the `sed`-quoted
 * sequence is `keystroke()` below, and the call site is named beside it). The
 * hook's own `setInputValue` is React local state and is measured through the
 * composer-surface harness in B2, not here. The store is the persisted one the
 * real app writes: `partialize` runs over EVERY conversation's row on every
 * `set()`, which is why the fixtures seed other conversations' drafts too.
 *
 * THE BENCHES:
 *   B1  per-keystroke cost at 0 / 1 / 6 attachments, in the two shapes an
 *       attachment arrives in: a PASTED image (a `data:` URL of ~1.5 MB base64,
 *       which is the shape the operator's screenshot shows — six images and no
 *       filename caption strip) and a PICKED file (a short OS path). Reports
 *       ms/keystroke split into the store write, the JSON serialise and the
 *       `localStorage` write, plus bytes serialised and subscriber
 *       notifications per keystroke.
 *   B2  WHO REPAINTS PER KEYSTROKE. Components carrying the selectors copied
 *       VERBATIM from the real call sites — the chat page's `composerText`
 *       (`features/chat/components/chat-page.tsx:4179`) and the ask policy's
 *       boolean (`features/chat/use-ask-open-policy.ts`, `composerHasText`) —
 *       rendered against the real store, so the render count is the number of
 *       commits each selector asks React for. A component's own render cost is
 *       NOT modelled here: this counts the commits the subscription triggers.
 *   B3  the persistence window: how many bytes hit disk per keystroke, whether a
 *       burst of keystrokes coalesces to one write, and whether the persisted
 *       payload still restores the draft (the restart-restore contract).
 *   B6  the serialise alone: one `JSON.stringify` of the payload the six-image
 *       row produces, reported so the wall-clock rows can be read against an
 *       independent anchor.
 *   B7  THE ATTACHMENT ROW'S OWN COMMIT. The composer commits on every
 *       keystroke, and the row of staged chips lives inside that commit: this
 *       measures the REAL `AttachmentsPreview` through a real React root, per
 *       commit, at 0 / 1 / 6 pasted images and 6 picked paths. It is the row
 *       QA measured as missing (round 1 on PR #1773): the store half is B1, and
 *       the ~25 ms/keystroke the operator still felt at six pasted images was
 *       all in here — every chip re-deriving its name, kind and MIME type from a
 *       1.5 MB `data:` URL on every render. The pin asserts the row is flat in
 *       PAYLOAD (pasted within a small factor of picked) plus an absolute
 *       ceiling, so removing either the memo boundary or the bounded scans puts
 *       the cost back and fails here.
 *
 * BEFORE/AFTER. The counters are all module- or process-level, so the SAME file
 * runs against two trees: this branch (after) and its base (before). The only
 * variable is the code under test — no fixture, no machine setting, no clock
 * assumption changes between arms.
 *
 *   PERF_BENCH_ARM=before node --test scripts/composer-typing-perf.test.mjs
 *   PERF_BENCH_ARM=after  node --test scripts/composer-typing-perf.test.mjs
 *
 * `PERF_BENCH_ARM` labels the output and decides whether the pin asserts; the
 * `before` numbers are the finding, not a failure. Wall-clock lines are printed
 * on both arms; the ASSERTIONS are on invariants that do not depend on how fast
 * the host is (write counts, serialised bytes, render counts), with one generous
 * ceiling on the non-React per-keystroke cost — the operator's acceptance
 * criterion — set far above the measured maximum so a slow CI host cannot fail
 * it for being slow. Report JSON goes to stderr as `PERF_BENCH_REPORT <json>`.
 */
import assert from "node:assert/strict";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { createElement as h, useCallback, useState } from "react";

const ARM = process.env.PERF_BENCH_ARM ?? "after";
const KEYSTROKES = Number(process.env.PERF_BENCH_KEYSTROKES ?? 24);
/* ~1.5 MB of base64 after the prefix: one pasted screenshot from a Retina display. */
const PASTED_BYTES = Number(process.env.PERF_BENCH_PASTED_BYTES ?? 1_500_000);
const OTHER_CONVERSATIONS = 5;

/* ------------------------- the jsdom bootstrap --------------------------- */

/*
 * THE QUOTA IS RAISED ON PURPOSE, and this is a finding rather than a setting.
 * jsdom's 5,000,000-code-unit default is BELOW a six-image row (6 x 1.5 MB of
 * base64 is ~9 MB), so the default would make the bench throw
 * `The 5000000-code unit storage quota has been exceeded` on the first keystroke
 * and measure nothing. Chromium's own origin quota is ~10 MB, so a six-image row
 * is at that cliff edge too - the bench reports the bytes per write so the PR can
 * state it. What this file measures is the COST of the write, so the instrument
 * needs room to observe it.
 */
const bootstrapDOM = new JSDOM("<!doctype html>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
	storageQuota: 200_000_000,
});
const { window } = bootstrapDOM;
for (const [key, value] of Object.entries({
	localStorage: window.localStorage,
	window,
	document: window.document,
	IS_REACT_ACT_ENVIRONMENT: true,
})) {
	Object.defineProperty(globalThis, key, {
		configurable: true,
		writable: true,
		value,
	});
}

/*
 * THE TWO COSTS A KEYSTROKE MUST NOT PAY, instrumented at their real entry
 * points: the global serialise the persist middleware performs, and the
 * synchronous `localStorage` write. The storage is a DELEGATING wrapper rather
 * than a patched method - jsdom's `Storage` is a proxy, so an own property set on
 * it is not reliably the function the store ends up calling, and a counter that
 * silently measures nothing is worse than no counter.
 */
let counting = false;
const writes = {
	setItemCalls: 0,
	setItemBytes: 0,
	stringifyCalls: 0,
	stringifyBytes: 0,
};
const realStringify = JSON.stringify;
JSON.stringify = function countedStringify(...args) {
	const out = realStringify.apply(this, args);
	if (counting) {
		writes.stringifyCalls += 1;
		if (typeof out === "string") writes.stringifyBytes += out.length;
	}
	return out;
};
const realStorage = window.localStorage;
const countedStorage = {
	get length() {
		return realStorage.length;
	},
	key: (index) => realStorage.key(index),
	getItem: (key) => realStorage.getItem(key),
	setItem: (key, value) => {
		if (counting) {
			writes.setItemCalls += 1;
			if (typeof value === "string") writes.setItemBytes += value.length;
		}
		realStorage.setItem(key, value);
	},
	removeItem: (key) => realStorage.removeItem(key),
	clear: () => realStorage.clear(),
};
Object.defineProperty(globalThis, "localStorage", {
	configurable: true,
	writable: true,
	value: countedStorage,
});
/* jsdom exposes `window.localStorage` as a getter-only property. */
Object.defineProperty(window, "localStorage", {
	configurable: true,
	value: countedStorage,
});

const bundle = await build({
	stdin: {
		contents: [
			/*
			 * A NAMESPACE import, so the bench compiles on BOTH arms: the flush seam
			 * this fix adds does not exist on the base commit, and a named import would
			 * make the `before` arm fail to BUILD instead of failing to improve.
			 */
			'import * as storeModule from "./src/renderer/src/shared/store/conversation-input-store";',
			"export { storeModule };",
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	loader: {
		".css": "empty",
		".svg": "text",
		".png": "dataurl",
		".webp": "dataurl",
	},
	external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
});
const bundlePath = new URL(
	`./_composer-typing-perf-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { storeModule } = await import(bundlePath.href);
await unlink(bundlePath);

const { useConversationInputStore } = storeModule;
const FLUSH_SEAM = storeModule.flushComposerDraftPersist;
const DEBOUNCE_MS = storeModule.COMPOSER_DRAFT_PERSIST_DEBOUNCE_MS ?? 0;
const PERSIST_KEY = "conversation-input-store";
/*
 * The seam the pin needs. Asserted on the `after` arm only: on the base commit it
 * does not exist, and that absence IS the finding rather than a test failure.
 */
if (ARM === "after") {
	assert.equal(
		typeof FLUSH_SEAM,
		"function",
		"the composer draft persistence exposes its flush seam",
	);
}

const { createRoot } = await import("react-dom/client");
const { act } = await import("react");

const report = { arm: ARM, keystrokes: KEYSTROKES, pastedBytes: PASTED_BYTES };

/* --------------------------------- fixtures ------------------------------ */

const IDENTITY = "conv-under-test";

const pastedImagePath = (seed) =>
	`data:image/png;base64,${String(seed)
		.repeat(Math.ceil(PASTED_BYTES / String(seed).length))
		.slice(0, PASTED_BYTES)}`;
const pickedPath = (seed) =>
	`/Users/operator/Pictures/Screenshot 2026-11-08 at 10.0${seed}.00.png`;

/**
 * Stage `count` attachments on the composer's row, in the shape asked for, plus
 * `OTHER_CONVERSATIONS` other rows holding small drafts — the store persists
 * every conversation's row on every write, so a fixture with one row would
 * under-report the `partialize` pass.
 */
const stage = async ({ count, shape }) => {
	const rows = {
		[IDENTITY]: {
			currentInput: "",
			submittedMessages: [],
			currentHistoryIndex: null,
			replies: [],
			attachments: [],
		},
	};
	for (let i = 0; i < OTHER_CONVERSATIONS; i += 1) {
		rows[`conv-${i}`] = {
			currentInput: `an older draft in conversation ${i}`,
			submittedMessages: ["a submitted message"],
			currentHistoryIndex: null,
			replies: [],
			attachments: [],
		};
	}
	useConversationInputStore.setState({ inputByConversation: rows });
	for (let i = 0; i < count; i += 1) {
		useConversationInputStore.getState().addAttachment(IDENTITY, {
			id: `att-${i}`,
			path: shape === "pasted" ? pastedImagePath(i + 1) : pickedPath(i),
		});
	}
	/* Let a before-arm write settle so its own bytes cannot land in a window. */
	await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS + 20));
	writes.setItemCalls = 0;
	writes.setItemBytes = 0;
	writes.stringifyCalls = 0;
	writes.stringifyBytes = 0;
};

/**
 * ONE KEYSTROKE, as `use-message-input.ts:922-948` performs it: the hook's own
 * `setInputValue` (React local state; B2 measures its commit) and then the two
 * store writes, the second of which is the unconditional history reset.
 */
const keystroke = (value) => {
	const { setCurrentInput, resetCurrentHistoryIndex } =
		useConversationInputStore.getState();
	setCurrentInput(IDENTITY, value, 0);
	resetCurrentHistoryIndex(IDENTITY);
};

const typedText = (base, i) =>
	`${base}${"the quick brown fox jumps over the lazy dog ".repeat(4).slice(0, i)}`;

/* ------------------------------- B1: keystrokes -------------------------- */

const runKeystrokes = async ({ count, shape }) => {
	await stage({ count, shape });
	let notifications = 0;
	const unsubscribe = useConversationInputStore.subscribe(() => {
		notifications += 1;
	});
	const samples = [];
	counting = true;
	for (let i = 1; i <= KEYSTROKES; i += 1) {
		const before = process.hrtime.bigint();
		keystroke(typedText("", i));
		samples.push(Number(process.hrtime.bigint() - before) / 1e6);
	}
	counting = false;
	unsubscribe();
	const sorted = [...samples].sort((a, b) => a - b);
	const total = samples.reduce((sum, ms) => sum + ms, 0);
	const row = {
		attachments: count,
		shape,
		msPerKeystrokeMedian: Number(
			sorted[Math.floor(sorted.length / 2)].toFixed(3),
		),
		msPerKeystrokeMax: Number(sorted[sorted.length - 1].toFixed(3)),
		msPerKeystrokeMean: Number((total / samples.length).toFixed(3)),
		stringifyCallsPerKeystroke: Number(
			(writes.stringifyCalls / samples.length).toFixed(2),
		),
		bytesSerialisedPerKeystroke: Math.round(
			writes.stringifyBytes / samples.length,
		),
		setItemCallsPerKeystroke: Number(
			(writes.setItemCalls / samples.length).toFixed(2),
		),
		bytesWrittenPerKeystroke: Math.round(writes.setItemBytes / samples.length),
		notificationsPerKeystroke: Number(
			(notifications / samples.length).toFixed(2),
		),
	};
	return row;
};

/* ------------------------------- B2: renders ---------------------------- */

const renders = {
	chatPageString: 0,
	chatPageBool: 0,
	askPolicy: 0,
	composerSurface: 0,
};

/*
 * THE CHAT PAGE'S SELECTOR AS IT WAS (`chat-page.tsx` before this fix): the raw
 * draft string. It answers a new value on every keystroke, so a component holding
 * it commits on every keystroke whatever the page then does with the value.
 */
function ChatPageStringShaped() {
	renders.chatPageString += 1;
	const composerText = useConversationInputStore(
		(state) => state.inputByConversation[IDENTITY]?.currentInput ?? "",
	);
	return h("span", null, composerText.length > 0 ? "held" : "empty");
}

/*
 * AND AS IT IS NOW: the boolean the page actually reads (`composerHoldsEditText`,
 * beside `editText`). The comparison here is against a payload this bench does not
 * hold, so the harness's `null` stands in for "no delivery row"; what is being
 * measured is the SHAPE - a selector that answers a boolean cannot commit on a
 * keystroke that does not change the answer.
 */
function ChatPageBoolShaped() {
	renders.chatPageBool += 1;
	const holdsEditText = useConversationInputStore((state) => {
		const composed = state.inputByConversation[IDENTITY]?.currentInput ?? "";
		return composed.trim().length > 0 && composed === null;
	});
	return h("span", null, holdsEditText ? "held" : "empty");
}

/*
 * THE ASK POLICY'S SELECTOR, VERBATIM (`use-ask-open-policy.ts`,
 * `composerHasText`): a boolean, so it commits only when the answer flips.
 */
function AskPolicyShaped() {
	renders.askPolicy += 1;
	const composerHasText = useConversationInputStore((state) => {
		const row = state.inputByConversation[IDENTITY];
		return (
			(row?.currentInput ?? "").trim() !== "" ||
			(row?.pendingText ?? "").trim() !== ""
		);
	});
	return h("span", null, composerHasText ? "has-text" : "no-text");
}

/*
 * THE COMPOSER'S OWN SURFACE: `use-message-input`'s `setInputValue` is React
 * local state consumed at the top of `MessageInput`, so the composer commits per
 * keystroke BY DESIGN. Measured so the fix's claim is scoped: typed text stays
 * synchronous, and the composer is the only surface that pays a commit.
 */
function ComposerSurfaceShaped({ bump }) {
	renders.composerSurface += 1;
	const [value, setValue] = useState("");
	bump.current = setValue;
	return h("span", null, value.length > 0 ? "typing" : "idle");
}

const bus = { current: null };

const runRenderBench = async ({ count, shape }) => {
	await stage({ count, shape });
	renders.chatPageString = 0;
	renders.chatPageBool = 0;
	renders.askPolicy = 0;
	renders.composerSurface = 0;
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	const bump = { current: null };
	await act(async () => {
		root.render(
			h(
				"div",
				null,
				h(ChatPageStringShaped),
				h(ChatPageBoolShaped),
				h(AskPolicyShaped),
				h(ComposerSurfaceShaped, { bump }),
			),
		);
	});
	/* The composer's local setter is the harness's own state; one per keystroke. */
	bus.current = bump.current;
	/*
	 * ZEROED AFTER THE MOUNT. The mount is one commit per component; counting it in
	 * a per-keystroke figure would report 0.04/keystroke for a component that never
	 * commits again, and the metric has to be able to say exactly zero.
	 */
	renders.chatPageString = 0;
	renders.chatPageBool = 0;
	renders.askPolicy = 0;
	renders.composerSurface = 0;
	for (let i = 1; i <= KEYSTROKES; i += 1) {
		const value = typedText("", i);
		await act(async () => {
			bus.current(value);
			keystroke(value);
		});
	}
	await act(async () => {
		root.unmount();
	});
	container.remove();
	const per = (n) => Number((n / KEYSTROKES).toFixed(2));
	/*
	 * BOTH FIGURES, because they answer different questions: the per-keystroke rate
	 * says whether a surface pays for TYPING, and the burst total says whether it
	 * pays at all (a boolean that flips once is a correct commit, not a repaint).
	 */
	const row = {
		attachments: count,
		shape,
		/* The pre-fix shape, kept as the falsifier: it is expected to commit. */
		chatPageStringRendersPerKeystroke: per(renders.chatPageString),
		chatPageBoolRendersPerKeystroke: per(renders.chatPageBool),
		askPolicyRendersPerKeystroke: per(renders.askPolicy),
		composerSurfaceRendersPerKeystroke: per(renders.composerSurface),
		chatPageStringRenders: renders.chatPageString,
		chatPageBoolRenders: renders.chatPageBool,
		askPolicyRenders: renders.askPolicy,
		composerSurfaceRenders: renders.composerSurface,
	};
	return row;
};

/* --------------------------- B3: the write window ------------------------ */

const runPersistenceWindow = async () => {
	await stage({ count: 6, shape: "pasted" });
	const flush = () => (typeof FLUSH_SEAM === "function" ? FLUSH_SEAM() : null);
	const readPersisted = () => {
		const raw = window.localStorage.getItem(PERSIST_KEY);
		if (!raw) return null;
		try {
			/* persist stores `{ state, version }`; the rows live under `state`. */
			return JSON.parse(raw)?.state ?? null;
		} catch {
			return { unparsable: raw.length };
		}
	};
	const windowResult = { debounceMs: DEBOUNCE_MS };

	counting = true;
	for (let i = 1; i <= 5; i += 1) keystroke(typedText("", i));
	const duringBurst = { ...writes };
	windowResult.writesDuringBurst = duringBurst.setItemCalls;
	windowResult.bytesDuringBurst = duringBurst.setItemBytes;
	windowResult.stringifyCallsDuringBurst = duringBurst.stringifyCalls;

	/*
	 * THE DEBOUNCE WINDOW. Wait for the trailing write, and time it: a persistence
	 * window is a promise to the user, so the bench measures the latency rather
	 * than trusting the constant.
	 */
	const started = process.hrtime.bigint();
	const settleDeadline = Date.now() + 5_000;
	/* STILL COUNTING: the write this waits for is the one the timer performs. */
	while (
		writes.setItemCalls === duringBurst.setItemCalls &&
		Date.now() < settleDeadline
	) {
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	windowResult.msToFirstWrite = Math.round(
		Number(process.hrtime.bigint() - started) / 1e6,
	);
	windowResult.writesAfterSettle =
		writes.setItemCalls - duringBurst.setItemCalls;
	windowResult.bytesAfterSettle =
		writes.setItemBytes - duringBurst.setItemBytes;
	counting = false;
	const persisted = readPersisted();
	windowResult.persistedDraftRestoresStoredText = Boolean(
		persisted?.inputByConversation?.[IDENTITY]?.currentInput ===
			typedText("", 5),
	);
	windowResult.persistedAttachmentCount =
		persisted?.inputByConversation?.[IDENTITY]?.attachments?.length ?? 0;
	windowResult.persistedBytes =
		window.localStorage.getItem(PERSIST_KEY)?.length ?? 0;

	/* THE FLUSH SEAM, for the edges a debounce must not lose a write on. */
	if (typeof flush === "function") {
		writes.setItemCalls = 0;
		counting = true;
		keystroke(typedText("", 9));
		flush();
		counting = false;
		windowResult.writesOnExplicitFlush = writes.setItemCalls;
		windowResult.explicitFlushPersistsLatest =
			JSON.parse(window.localStorage.getItem(PERSIST_KEY) ?? "{}").state
				?.inputByConversation?.[IDENTITY]?.currentInput === typedText("", 9);
	} else {
		windowResult.writesOnExplicitFlush = null;
		windowResult.explicitFlushPersistsLatest = null;
	}

	/*
	 * THE RESTART RESTORE, through the door a fresh renderer walks: a store with no
	 * rows that hydrates the payload found on disk, through the shipped `merge`.
	 * The disk payload is captured FIRST and served to the store as its storage, so
	 * an in-memory reset cannot overwrite the very thing being restored - which is
	 * what a naive `setState({})` + `rehydrate()` measures instead.
	 */
	const bootPayload = window.localStorage.getItem(PERSIST_KEY);
	const realStorage = useConversationInputStore.persist.getOptions().storage;
	useConversationInputStore.persist.setOptions({
		storage: {
			getItem: () => JSON.parse(bootPayload ?? "null"),
			setItem: () => {},
			removeItem: () => {},
		},
	});
	useConversationInputStore.setState({ inputByConversation: {} });
	await useConversationInputStore.persist.rehydrate();
	/* Compared against what the CAPTURED payload held, not against a fixture: the
	 * flush leg above re-typed the box, so only the payload knows the answer. */
	const bootDraft =
		JSON.parse(bootPayload ?? "{}").state?.inputByConversation?.[IDENTITY]
			?.currentInput ?? null;
	windowResult.bootDraft = bootDraft;
	windowResult.rehydrateRestoresDraft =
		bootDraft !== null &&
		useConversationInputStore.getState().getCurrentInput(IDENTITY) ===
			bootDraft;
	useConversationInputStore.persist.setOptions({ storage: realStorage });
	return windowResult;
};

/* ------------------------- B4: the credential gate ----------------------- */

const SECRET = "sk-live-SECRET-0123456789abcdef";

/**
 * NOTHING SECRET RIDES THE TIMER.
 *
 * `partialize` is the credential gate: it blanks a payload's text while a masked
 * capture is open. Coalescing the write introduces a WINDOW, so the invariant this
 * checks is that the window does not widen the gate — a queued payload is
 * partialised at SCHEDULE time, and the capture's own carriers (`inFlight`,
 * `returned`, `pendingText`) are blanked there rather than at fire time. Checked
 * by reading the REAL disk contents at three points: pre-capture typing queued and
 * then replaced by a volatile in-flight payload, the payload returned after the
 * capture, and the flush that lands them. Runs on BOTH arms: it is the seam's own
 * contract, not a before/after deltas.
 */
const runSecretGate = async () => {
	await stage({ count: 1, shape: "pasted" });
	const disk = () => window.localStorage.getItem(PERSIST_KEY) ?? "";
	const flushSeam = () =>
		typeof FLUSH_SEAM === "function" ? FLUSH_SEAM() : null;
	const result = {};
	/* A keystroke queued the ordinary draft, then the capture opened. */
	keystroke("a draft typed before the capture");
	useConversationInputStore
		.getState()
		.beginInFlight(
			IDENTITY,
			{ text: SECRET, attachments: [], replies: [], volatileText: true },
			true,
		);
	flushSeam();
	await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS + 200));
	result.diskHasSecretInFlight = disk().includes(SECRET);
	result.diskHasPreCaptureTyping = disk().includes(
		"a draft typed before the capture",
	);
	/* The capture ended and the payload came home through the store's own action. */
	useConversationInputStore.getState().returnPayload(IDENTITY, {
		text: SECRET,
		attachments: [],
		replies: [],
		volatileText: true,
	});
	flushSeam();
	await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS + 200));
	result.diskHasSecretReturned = disk().includes(SECRET);
	return result;
};

/* -------------------------- B5: the call-site shape --------------------- */

/**
 * THE CHAT PAGE DOES NOT HOLD THE RAW DRAFT.
 *
 * A selector's shape is not observable from the store, so the one thing B2 cannot
 * prove is that the SHIPPED call site uses the bounded shape. This is a text-level
 * guard on the call site instead: the page must not contain the raw-draft selector
 * that re-rendered it per keystroke, and must contain the boolean one. Narrow on
 * purpose - it names the exact expression the fix replaced.
 */
const checkChatPageCallSite = async () => {
	const source = await readFile(
		"src/renderer/src/features/chat/components/chat-page.tsx",
		"utf8",
	);
	return {
		hasRawDraftSelector: source.includes(
			"const composerText = useConversationInputStore(",
		),
		hasBoundedSelector: source.includes("const composerHoldsEditText ="),
	};
};

/* --------------------------- B6: the serialise alone ------------------- */

/**
 * WHAT ONE SERIALISE PASS COSTS, on this host, for the payload the operator's own
 * shape produces. Reported so the numbers above can be compared like-for-like with
 * an independent anchor rather than only against each other: the row is the same
 * one `partialize` hands to storage, and the pass is the `JSON.stringify` a write
 * performs. Informational - it asserts nothing, because a wall-clock figure is not
 * an invariant and a slow host must not fail the pin.
 */
const SERIALISE_PASSES = 20;

const runSerialise = async () => {
	await stage({ count: 6, shape: "pasted" });
	const payload = {
		inputByConversation:
			useConversationInputStore.getState().inputByConversation,
	};
	const bytes = JSON.stringify(payload).length;
	const passes = [];
	for (let i = 0; i < SERIALISE_PASSES; i += 1) {
		const started = process.hrtime.bigint();
		JSON.stringify(payload);
		passes.push(Number(process.hrtime.bigint() - started) / 1e6);
	}
	passes.sort((a, b) => a - b);
	const median = passes[Math.floor(passes.length / 2)];
	return {
		bytes,
		passes: SERIALISE_PASSES,
		msMedian: Number(median.toFixed(2)),
		msMax: Number(passes[passes.length - 1].toFixed(2)),
		msPerMb: Number(((median / bytes) * 1_000_000).toFixed(2)),
	};
};

/* ------------- B7: the attachment row's own commit, per keystroke -------- */

/*
 * WHY THIS ROW EXISTS. B1 measured the store write and B2 counted the commits the
 * selectors ask for, and between them they said the keystroke was cheap — while
 * the composer still took ~25 ms per keystroke at six pasted images, which is the
 * number the operator feels (QA round 1 on PR #1773, measured end to end through
 * the real `MessageInput`). The cost was in the attachment row's own render, and
 * nothing in this file looked at it. This does: the REAL component, a real React
 * root, a real commit per keystroke.
 *
 * WHAT IS STUBBED AND WHY IT CANNOT FLATTER THE RESULT. The two seams the copy
 * test already stubs (`@shared/components/ui`, `@shared/hooks/use-file-blob-url`)
 * are replaced so the bench does not read private files or paint real bytes: the
 * file bridge answers `loading`, so a tile paints its 100px ground and no `<img>`.
 * That removes DECODE work (where a browser would differ from node) and keeps what
 * is measured — this component's own JavaScript per commit — which is
 * engine-independent: QA's CPython anchor and V8 agreed on the per-call costs of
 * exactly these helpers.
 */
const ATTACHMENT_COMMITS = Number(process.env.PERF_BENCH_COMMITS ?? 20);
const ATTACHMENT_MOUNTS = 5;
/*
 * The ceiling the six-image commit must stay under. Set from the measured
 * distribution in this PR (see the B7 rows in the report): the fixed row commits
 * in well under a millisecond on the machine that measured it, and the pre-fix
 * row cost an order of magnitude more than this line. It is a wide floor, not a
 * tuned threshold — a slow CI host must not fail the pin for being slow.
 */
const ATTACHMENT_COMMIT_CEILING_MS = 3;
const STUB_MODULES = /^@shared\/(components\/ui|hooks\/use-file-blob-url)$/;
const ANY_MODULE = /.*/;

const medianOf = (samples) => {
	const sorted = [...samples].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)];
};

let attachmentPreviewModule = null;

/**
 * The real `AttachmentsPreview`, bundled once and cached for every row.
 */
const loadAttachmentPreview = async () => {
	if (attachmentPreviewModule) return attachmentPreviewModule;
	const built = await build({
		stdin: {
			contents: [
				'import { AttachmentsPreview } from "./src/renderer/src/features/chat/components/attachments-preview";',
				"export { AttachmentsPreview };",
			].join("\n"),
			resolveDir: process.cwd(),
		},
		bundle: true,
		jsx: "automatic",
		/*
		 * CJS, REQUIRED FROM DISK rather than ESM imported: the component tree pulls
		 * `lucide-react`, whose build is CJS and whose `require("react")` cannot run
		 * inside an ESM output. This is the same seam the copy test next to the
		 * component uses; `react` stays external, so the bench and the component share
		 * one React instance.
		 */
		format: "cjs",
		platform: "node",
		write: false,
		/* The `@shared/*` and `@features/*` aliases live in the web tsconfig. */
		tsconfig: "tsconfig.web.json",
		loader: {
			".css": "empty",
			".svg": "text",
			".png": "dataurl",
			".webp": "dataurl",
		},
		external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
		plugins: [
			{
				name: "isolated-attachment-dependencies",
				setup(plugin) {
					plugin.onResolve({ filter: STUB_MODULES }, (args) => ({
						path: args.path,
						namespace: "attachment-fixture",
					}));
					plugin.onLoad(
						{ filter: ANY_MODULE, namespace: "attachment-fixture" },
						(args) => ({
							contents: args.path.endsWith("components/ui")
								? 'import React from "react"; export const Button = ({children, size, variant, ...props}) => React.createElement("button", props, children); export const Tooltip = ({children}) => children;'
								: 'export const useFileBlobUrl = () => ({status: "loading"}); export const previewFailureReason = () => "bridge failure";',
							resolveDir: process.cwd(),
						}),
					);
				},
			},
		],
	});
	const modulePath = new URL(
		`./_composer-attachment-row-${process.pid}.cjs`,
		import.meta.url,
	);
	await writeFile(modulePath, built.outputFiles[0].text);
	attachmentPreviewModule = createRequire(import.meta.url)(modulePath.pathname);
	await unlink(modulePath);
	return attachmentPreviewModule;
};

/**
 * The chips the composer would hold, from B1's own fixtures: six pasted images of
 * ~1.5 MB or six picked paths on one row.
 */
const stagedRow = (count, shape) =>
	Array.from({ length: count }, (_, i) => ({
		id: `att-${i}`,
		path: shape === "pasted" ? pastedImagePath(i + 1) : pickedPath(i),
	}));

/**
 * One composer commit's cost in the attachment row, at `count` staged chips.
 *
 * The props are built ONCE and kept: a text keystroke changes `currentInput`, and
 * the store spreads that row (`conversation-input-store.ts`, `setCurrentInput`),
 * so `attachments` keeps its identity while the box changes. A bench that rebuilt
 * the array per commit would measure a surface the app never has. The commit
 * itself is a fresh element with those same prop values, which is exactly what a
 * parent re-render hands a child.
 */
const runAttachmentCommitBench = async ({ count, shape }) => {
	const { AttachmentsPreview } = await loadAttachmentPreview();
	const props = {
		attachments: stagedRow(count, shape),
		onRemoveAttachment: () => {},
		disabled: false,
	};
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	const commit = async () => {
		const started = performance.now();
		await act(async () => {
			//
			root.render(h(AttachmentsPreview, props));
		});
		return performance.now() - started;
	};
	// Warmed twice, so the measured commits carry no first-render allocation.
	await commit();
	await commit();
	const samples = [];
	for (let i = 0; i < ATTACHMENT_COMMITS; i += 1) samples.push(await commit());
	const markupChars = container.innerHTML.length;
	await act(async () => {
		root.unmount();
	});
	container.remove();
	/*
	 * A MOUNT IS A DIFFERENT QUESTION: it is paid once per paste, and it also
	 * derives each pasted chip's byte size from its payload (`useAttachmentSize`),
	 * which is a stated once-per-paste cost rather than a per-keystroke one.
	 * Reported, not pinned.
	 */
	const mounts = [];
	for (let i = 0; i < ATTACHMENT_MOUNTS; i += 1) {
		const host = document.createElement("div");
		document.body.appendChild(host);
		const mountRoot = createRoot(host);
		const started = performance.now();
		await act(async () => {
			mountRoot.render(h(AttachmentsPreview, props));
		});
		mounts.push(performance.now() - started);
		await act(async () => {
			mountRoot.unmount();
		});
		host.remove();
	}
	return {
		attachments: count,
		shape,
		commits: ATTACHMENT_COMMITS,
		msPerCommitMedian: Number(medianOf(samples).toFixed(3)),
		msPerCommitMax: Number(Math.max(...samples).toFixed(3)),
		msPerMountMedian: Number(medianOf(mounts).toFixed(3)),
		markupChars,
	};
};

/** One chip rendered through the real component, as markup. */
const renderChip = async (path) => {
	const { AttachmentsPreview } = await loadAttachmentPreview();
	const host = document.createElement("div");
	document.body.appendChild(host);
	const root = createRoot(host);
	await act(async () => {
		root.render(
			h(AttachmentsPreview, {
				attachments: [{ id: "att-0", path }],
				onRemoveAttachment: () => {},
				disabled: false,
			}),
		);
	});
	const html = host.innerHTML;
	await act(async () => {
		root.unmount();
	});
	host.remove();
	return html;
};

/* --------------------------------- the run ------------------------------- */

const SHAPES = [
	{ count: 0, shape: "pasted" },
	{ count: 1, shape: "pasted" },
	{ count: 6, shape: "pasted" },
	{ count: 6, shape: "picked" },
];

test(`${ARM} B1: per-keystroke store cost`, async () => {
	report.B1 = [];
	for (const fixture of SHAPES) report.B1.push(await runKeystrokes(fixture));
	console.error(`PERF_BENCH_B1 ${JSON.stringify(report.B1)}`);
	for (const row of report.B1) {
		console.error(
			`  ${row.shape}/${row.attachments}att: median ${row.msPerKeystrokeMedian}ms, max ${row.msPerKeystrokeMax}ms, serialised ${row.bytesSerialisedPerKeystroke} B/keystroke, setItem ${row.setItemCallsPerKeystroke}/keystroke (${row.bytesWrittenPerKeystroke} B), notifications ${row.notificationsPerKeystroke}/keystroke`,
		);
	}
});

test(`${ARM} B2: which surfaces commit per keystroke`, async () => {
	report.B2 = [];
	for (const fixture of [
		{ count: 0, shape: "pasted" },
		{ count: 6, shape: "pasted" },
	]) {
		report.B2.push(await runRenderBench(fixture));
	}
	console.error(`PERF_BENCH_B2 ${JSON.stringify(report.B2)}`);
});

test(`${ARM} B3: the persistence window`, async () => {
	report.B3 = await runPersistenceWindow();
	console.error(`PERF_BENCH_B3 ${JSON.stringify(report.B3)}`);
});

test(`${ARM} B4: nothing secret rides the timer`, async () => {
	report.B4 = await runSecretGate();
	console.error(`PERF_BENCH_B4 ${JSON.stringify(report.B4)}`);
	assert.equal(
		report.B4.diskHasSecretInFlight,
		false,
		"an in-flight capture payload reached disk",
	);
	assert.equal(
		report.B4.diskHasSecretReturned,
		false,
		"a returned capture payload reached disk",
	);
	/*
	 * AND THE GATE IS NOT A BLANKET SILENCE: ordinary typing still persists, so a
	 * "secret never lands" result cannot be a store that writes nothing.
	 */
	assert.equal(
		report.B4.diskHasPreCaptureTyping,
		true,
		"the draft typed before the capture never reached disk either - the gate is swallowing everything",
	);
});

test(`${ARM} B5: the chat page holds the bounded selector`, async () => {
	report.B5 = await checkChatPageCallSite();
	console.error(`PERF_BENCH_B5 ${JSON.stringify(report.B5)}`);
	/* The shipped head's call site: asserted on the `after` arm, where it is the head. */
	if (ARM === "after") {
		assert.equal(
			report.B5.hasRawDraftSelector,
			false,
			"chat-page subscribes to the raw draft string",
		);
		assert.equal(
			report.B5.hasBoundedSelector,
			true,
			"chat-page lost its boolean draft selector",
		);
	}
});

test(`${ARM} B6: the serialise alone`, async () => {
	report.B6 = await runSerialise();
	console.error(`PERF_BENCH_B6 ${JSON.stringify(report.B6)}`);
});

test(`${ARM} B7: the attachment row's commit is flat in payload size`, async () => {
	report.B7 = [];
	for (const fixture of [
		{ count: 0, shape: "pasted" },
		{ count: 1, shape: "pasted" },
		{ count: 6, shape: "pasted" },
		{ count: 6, shape: "picked" },
	]) {
		report.B7.push(await runAttachmentCommitBench(fixture));
	}
	console.error(`PERF_BENCH_B7 ${JSON.stringify(report.B7)}`);
	for (const row of report.B7) {
		console.error(
			`  ${row.shape}/${row.attachments}att: commit median ${row.msPerCommitMedian}ms, max ${row.msPerCommitMax}ms, mount median ${row.msPerMountMedian}ms, markup ${row.markupChars} chars`,
		);
	}
	const pasted6 = report.B7.find(
		(row) => row.shape === "pasted" && row.attachments === 6,
	);
	const picked6 = report.B7.find(
		(row) => row.shape === "picked" && row.attachments === 6,
	);
	/*
	 * THE INVARIANT THIS ROW PROTECTS: what a keystroke costs in the attachment
	 * row is set by the ROW (how many chips, how much markup) and never by the
	 * BYTES sitting behind them. Six pasted images and six picked paths are the
	 * same row to this component — six chips, same 100px tiles — so the two
	 * figures must land in the same neighbourhood; the `+ 0.5` is slack for a
	 * host where the picked row is too fast to compare against (a ratio alone
	 * would let 0.02 vs 0.06 ms pass as "3x").
	 *
	 * The pre-fix row fails this by an order of magnitude, which is the whole
	 * finding: ~10.5 ms of engine-independent JS per keystroke, six tiles costing
	 * `isImage` + `isVideo` + two `mimeTypeForPath` calls each, scanning ~1.5 MB
	 * per call on every render of a box that is being typed into.
	 */
	assert.ok(
		pasted6.msPerCommitMedian <= picked6.msPerCommitMedian * 2 + 0.5,
		`a commit at 6 pasted images cost ${pasted6.msPerCommitMedian}ms against ${picked6.msPerCommitMedian}ms for 6 picked paths - the attachment row is paying for the payload, not the row`,
	);
	/*
	 * THE ABSOLUTE BUDGET, and the ceiling's provenance: the commit that holds
	 * six chips must stay inside the fraction of a keystroke's 16.7 ms frame that
	 * a preview row may claim. Measured on this machine after the fix the row is
	 * reported above (sub-millisecond); the pre-fix figure was an order of
	 * magnitude over this line, so it is a floor no host speed can fake rather
	 * than a tuned threshold.
	 */
	assert.ok(
		pasted6.msPerCommitMedian < ATTACHMENT_COMMIT_CEILING_MS,
		`a commit at 6 pasted images cost ${pasted6.msPerCommitMedian}ms (ceiling ${ATTACHMENT_COMMIT_CEILING_MS}ms)`,
	);
	/* The row still renders: a bail-out that painted nothing would measure fast. */
	assert.ok(
		pasted6.markupChars > 1_000,
		`the six-image row painted only ${pasted6.markupChars} characters of markup`,
	);
	console.error(`PERF_BENCH_REPORT ${JSON.stringify(report)}`);
});

/*
 * AND THE CLASSIFIERS STILL SAY WHAT THEY SAID. Bounding a scan to the tail or to
 * a `data:` header is only correct if the `endsWith` answers do not move, so this
 * reads them off the rendered markup instead of off the source: a media tile
 * carries ONE `<svg>` (its remove button), a file card carries TWO (the type glyph
 * as well). Uppercase extensions matter — `.PNG` and `.MP4` are still media — and a
 * `.pdf` is still a card. `data:` URLs are pinned in both shapes too, because the
 * header is now the only part of them read.
 */
test(`${ARM} B7b: bounding the scans did not move the classification`, async () => {
	const svgCount = (html) => (html.match(/<svg/g) ?? []).length;
	const png = await renderChip("/Users/operator/Shots/PHOTO.PNG");
	assert.equal(
		svgCount(png),
		1,
		"an uppercase .PNG stopped being a media tile",
	);
	assert.ok(png.includes("PHOTO.PNG"), "the tile lost its filename caption");
	const mp4 = await renderChip("/Users/operator/Clips/clip.MP4");
	assert.equal(
		svgCount(mp4),
		1,
		"an uppercase .MP4 stopped being a media tile",
	);
	const pdf = await renderChip("/tmp/report.pdf");
	assert.equal(svgCount(pdf), 2, "a .pdf stopped being a file card");
	assert.ok(pdf.includes("report.pdf"), "the card lost its filename");
	const pastedImage = await renderChip(pastedImagePath(1));
	assert.equal(svgCount(pastedImage), 1, "a pasted image stopped being a tile");
	const pastedPdf = await renderChip("data:application/pdf;base64,AA");
	assert.equal(svgCount(pastedPdf), 2, "a pasted PDF stopped being a card");
	assert.ok(
		pastedPdf.includes("Pasted application/pdf"),
		"a pasted PDF lost its header-derived name",
	);
});

test(`${ARM} the pin`, async () => {
	/* The measured worst row, so the assertion reads as the operator's criterion. */
	const pasted = report.B1.find(
		(row) => row.shape === "pasted" && row.attachments === 6,
	);
	const renders6 = report.B2.find((row) => row.attachments === 6);
	if (ARM !== "after") {
		console.error(
			"PERF_BENCH_PIN skipped on the before arm (the numbers are the finding)",
		);
		return;
	}
	/*
	 * THE BUDGET, in the operator's terms. Non-React per-keystroke work — the store
	 * write, its serialise and the disk write — must stay small and FLAT as
	 * attachments grow, and a keystroke must not write the draft to disk at all.
	 * The ceiling is 4 ms (acceptance criterion (a)); the measured pre-fix cost of
	 * one pasted image is two orders of magnitude above it, so the cap is a floor
	 * no host speed can fake, not a tuned threshold.
	 */
	assert.ok(
		pasted.msPerKeystrokeMedian < 4,
		`non-React keystroke cost at 6 pasted images: ${pasted.msPerKeystrokeMedian}ms (budget 4ms)`,
	);
	assert.equal(
		pasted.setItemCallsPerKeystroke,
		0,
		"a keystroke writes the draft to localStorage",
	);
	assert.equal(
		pasted.bytesSerialisedPerKeystroke,
		0,
		"a keystroke serialises the persisted state",
	);
	/*
	 * AND THE PAINT SURFACE. A draft write must not repaint the app: the chat
	 * page's string selector and the ask policy's boolean both hold values this
	 * write cannot change the meaning of, so neither may commit.
	 */
	assert.equal(
		renders6.chatPageBoolRendersPerKeystroke,
		0,
		`the chat page committed ${renders6.chatPageBoolRendersPerKeystroke} times per keystroke`,
	);
	/* The falsifier: the shape the fix removed is expected to commit, which is what
	 * makes the zero above a property of the shape rather than of the harness. */
	assert.ok(
		renders6.chatPageStringRendersPerKeystroke >= 1,
		"the raw-draft selector stopped committing - the harness is measuring nothing",
	);
	/*
	 * The ask policy's boolean flips ONCE across the burst (the box goes from empty
	 * to holding text), which is the answer changing rather than the draft moving.
	 */
	assert.ok(
		renders6.askPolicyRenders <= 1,
		`the ask policy committed ${renders6.askPolicyRenders} times across ${KEYSTROKES} keystrokes`,
	);
	assert.equal(
		renders6.composerSurfaceRendersPerKeystroke,
		1,
		"the composer's own surface is the one that still commits per keystroke",
	);
	/*
	 * AND THE CONTRACT THE DEBOUNCE OWES THE USER: the burst coalesces, the trailing
	 * write lands inside the stated window, the payload restores the draft, and an
	 * explicit flush is synchronous.
	 */
	assert.equal(
		report.B3.writesDuringBurst,
		0,
		"a keystroke burst wrote to disk mid-burst",
	);
	assert.ok(
		report.B3.writesAfterSettle >= 1,
		"the trailing write never landed",
	);
	assert.ok(
		Number(report.B3.msToFirstWrite) <= DEBOUNCE_MS + 1_000,
		`the trailing write landed after ${report.B3.msToFirstWrite}ms (window ${DEBOUNCE_MS}ms)`,
	);
	assert.ok(
		report.B3.persistedDraftRestoresStoredText,
		"the persisted payload lost the draft",
	);
	assert.ok(
		typeof report.B3.bootDraft === "string" && report.B3.bootDraft.length > 0,
		"the captured payload held no draft to boot from",
	);
	assert.equal(
		report.B3.persistedAttachmentCount,
		6,
		"the persisted payload lost the attachments",
	);
	assert.ok(
		report.B3.rehydrateRestoresDraft,
		"a fresh hydrate did not restore the draft",
	);
	assert.equal(
		report.B3.writesOnExplicitFlush,
		1,
		"the flush seam did not write synchronously",
	);
	assert.ok(
		report.B3.explicitFlushPersistsLatest,
		"the flush seam wrote a stale value",
	);
	console.error(`PERF_BENCH_REPORT ${JSON.stringify(report)}`);
});
