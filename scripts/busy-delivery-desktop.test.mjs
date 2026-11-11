import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * T5, the desktop half of the busy-delivery contract (architect D10/D11):
 *
 * 1. `sendKeyOf` — the ONE predicate four Enter sites share. It answers the
 *    send/not-send question, the composing question, the newline question and
 *    the chord question. The S2 map is EMPTY (S4 fills it), so the chord arm
 *    is exercised through a synthetic map rather than through a stored
 *    binding: the map's presence is what makes a bound press matter.
 * 2. The gate — `resolveBusyDelivery` / `mustRefuseBusyDelivery` /
 *    `busyDefaultFromSettings` — decides which body leaves. These are the same
 *    functions chat-page's `send` calls; the page itself is not bundled, so
 *    the gate is pinned here and the CALL is pinned by the source scan below.
 * 3. The admission pin — a lost-response replay resends `delivery` verbatim,
 *    so the hashed body does not change and the server does not 409. Driven
 *    through the real `admitChatDraft` with the real receipt fingerprint,
 *    mirroring canonical-chat.test.mjs's replay case.
 * 4. The refusal — the keyed notice and its code — and the source pins that
 *    keep the four Enter sites on the predicate, the gate at the one seam,
 *    and the draft kept when the gate refuses.
 */

// The store side of this suite mirrors canonical-chat.test.mjs's fixture: the
// network is faked, the registry and the store are the shipped modules.
const values = new Map();
globalThis.localStorage = {
	getItem: (key) => values.get(key) ?? null,
	setItem: (key, value) => values.set(key, value),
	removeItem: (key) => values.delete(key),
};
const calls = [];
globalThis.__canonicalRequest = async (request) => {
	calls.push(request);
	return {};
};
globalThis.__canonicalEcho = () => {};
const bundle = await build({
	stdin: {
		contents: `
			export * from "./src/renderer/src/shared/store/canonical-sessions-store";
			export { desktopRequestSchema, desktopEndpoint } from "./src/shared/desktop-contract";
			export {
				BUSY_DEFAULT_STALE_TIME,
				BUSY_DELIVERY_UNSUPPORTED_CODE,
				busyDefaultFromSettings,
				evaluateBusySend,
				mustRefuseBusyDelivery,
				resolveBusyDelivery,
				sendKeyOf,
				NO_SEND_CHORDS,
			} from "./src/renderer/src/features/chat/composer-send-key";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@shared/i18n": "./src/i18n",
		"@features": "./src/renderer/src/features",
	},
	plugins: [
		{
			name: "busy-delivery-transport-fixture",
			setup(builder) {
				builder.onResolve(
					{ filter: /@shared\/api\/local-operator\/desktop-api/ },
					() => ({ path: "transport", namespace: "fixture" }),
				);
				builder.onResolve(
					{ filter: /@shared\/hooks\/use-canonical-session/ },
					() => ({ path: "echo", namespace: "echo-fixture" }),
				);
				builder.onResolve(
					{ filter: /@shared\/api\/local-operator\/desktop-hooks/ },
					() => ({ path: "capabilities", namespace: "capability-fixture" }),
				);
				builder.onLoad(
					{ filter: /.*/, namespace: "capability-fixture" },
					() => ({
						contents:
							'export const desktopFeatureEnabled = () => false;\nexport const desktopKeys = { capabilities: ["desktop", "capabilities"] };',
						loader: "js",
					}),
				);
				builder.onResolve({ filter: /@shared\/api\/query-client/ }, () => ({
					path: "query-client",
					namespace: "query-fixture",
				}));
				builder.onLoad({ filter: /.*/, namespace: "query-fixture" }, () => ({
					contents: "export const queryClient = { getQueryData: () => null };",
					loader: "js",
				}));
				builder.onResolve(
					{ filter: /@shared\/hooks\/use-optional-query-client/ },
					() => ({
						path: "optional-query-client",
						namespace: "optional-query-fixture",
					}),
				);
				builder.onLoad(
					{ filter: /.*/, namespace: "optional-query-fixture" },
					() => ({
						contents:
							"export const useOptionalQueryClient = () => ({ client: { invalidateQueries: async () => {} }, provided: false });",
						loader: "js",
					}),
				);
				builder.onLoad({ filter: /.*/, namespace: "echo-fixture" }, () => ({
					contents: `
export const paintPendingSend = () => {};
export const movePendingSendIdentity = () => {};
export const replacePendingSendText = () => {};
export const discardPendingSends = () => {};
export const pendingSendForView = () => null;
export const settlePendingSend = () => {};
export const hasPendingSend = () => false;
export const retractPendingUser = () => {};
export const retractLocalEcho = () => "retracted";
export const peekLocalEcho = () => "local";
export const discardPendingEchoes = () => {};`,
					loader: "js",
					resolveDir: process.cwd(),
				}));
				builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
					contents: `export {DesktopControlError, UserFacingError, userFacingMessage} from ${JSON.stringify(
						`${process.cwd()}/src/renderer/src/shared/api/local-operator/desktop-api.ts`,
					)}
export const desktopResult = request => globalThis.__canonicalRequest(request);`,
					loader: "js",
					resolveDir: process.cwd(),
				}));
			},
		},
	],
});
const module = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const {
	useCanonicalSessionsStore: store,
	admitChatDraft,
	desktopRequestSchema,
	desktopEndpoint,
	BUSY_DEFAULT_STALE_TIME,
	BUSY_DELIVERY_UNSUPPORTED_CODE,
	busyDefaultFromSettings,
	evaluateBusySend,
	mustRefuseBusyDelivery,
	resolveBusyDelivery,
	sendKeyOf,
	NO_SEND_CHORDS,
	SEND_FAILURE_COPY,
} = module;

const KEY = (partial) => ({
	key: "Enter",
	shiftKey: false,
	ctrlKey: false,
	metaKey: false,
	altKey: false,
	isComposing: false,
	...partial,
});

const QUEUE = new Map([["primary+enter", "queue"]]);

/* ------------------------------------------------------------------ *
 * The predicate
 * ------------------------------------------------------------------ */

test("plain Enter sends with the default (no chord)", () => {
	assert.deepEqual(sendKeyOf(KEY({}), NO_SEND_CHORDS), { delivery: null });
});

test("Shift+Enter is a newline, never a send", () => {
	assert.equal(sendKeyOf(KEY({ shiftKey: true }), NO_SEND_CHORDS), null);
	assert.equal(sendKeyOf(KEY({ shiftKey: true }), QUEUE), null);
});

test("a composing Enter never sends — the IME case", () => {
	assert.equal(sendKeyOf(KEY({ isComposing: true }), NO_SEND_CHORDS), null);
	assert.equal(sendKeyOf(KEY({ isComposing: true }), QUEUE), null);
});

test("a modified Enter with no bindings still sends as today (default mode)", () => {
	// Ctrl/Cmd+Enter and Alt+Enter are Enters: the plain arm matches them, so
	// they send with the default exactly as they do today. "Steer" is what the
	// page resolves the default to when the row is unloaded; the predicate
	// itself reports the default, never a forced mode.
	assert.deepEqual(sendKeyOf(KEY({ ctrlKey: true }), NO_SEND_CHORDS), {
		delivery: null,
	});
	assert.deepEqual(sendKeyOf(KEY({ metaKey: true }), NO_SEND_CHORDS), {
		delivery: null,
	});
	assert.deepEqual(sendKeyOf(KEY({ altKey: true }), NO_SEND_CHORDS), {
		delivery: null,
	});
});

test("a bound chord selects its own mode", () => {
	// The send-chord grammar is Enter with primary/alt: a bound `primary+enter`
	// selects queue on the Enter press, and a bound `alt+enter` selects both.
	const bound = new Map([
		["primary+enter", "queue"],
		["alt+enter", "both"],
	]);
	assert.deepEqual(sendKeyOf(KEY({ metaKey: true }), bound), {
		delivery: "queue",
	});
	assert.deepEqual(sendKeyOf(KEY({ altKey: true }), bound), {
		delivery: "both",
	});
	// A chord the grammar cannot send (a plain letter chord) never fires, even
	// when the map binds it: only `isSendChordOf` chords may select a mode.
	const letter = new Map([["primary+j", "queue"]]);
	assert.equal(sendKeyOf(KEY({ key: "j", metaKey: true }), letter), null);
});

test("an unbound key never sends", () => {
	assert.equal(sendKeyOf(KEY({ key: "a" }), NO_SEND_CHORDS), null);
	assert.equal(
		sendKeyOf(KEY({ key: "j", metaKey: true }), NO_SEND_CHORDS),
		null,
	);
	assert.equal(sendKeyOf(KEY({ key: "Escape" }), NO_SEND_CHORDS), null);
});

/* ------------------------------------------------------------------ *
 * The default and the gate
 * ------------------------------------------------------------------ */

test("an unloaded or absent settings row reads steer", () => {
	assert.equal(busyDefaultFromSettings(undefined), "steer");
	assert.equal(busyDefaultFromSettings([]), "steer");
	assert.equal(
		busyDefaultFromSettings([{ key: "hosting", value: "openrouter" }]),
		"steer",
	);
});

test("a bound but unknown value degrades to steer, never an unknown mode", () => {
	assert.equal(
		busyDefaultFromSettings([
			{ key: "delivery.busy_default", value: "sometimes" },
		]),
		"steer",
	);
	assert.equal(
		busyDefaultFromSettings([{ key: "delivery.busy_default", value: 42 }]),
		"steer",
	);
});

test("the registry value is honoured when present", () => {
	assert.equal(
		busyDefaultFromSettings([{ key: "delivery.busy_default", value: "queue" }]),
		"queue",
	);
	assert.equal(
		busyDefaultFromSettings([{ key: "delivery.busy_default", value: "both" }]),
		"both",
	);
});

const GATE = (overrides) => ({
	chordDelivery: null,
	defaultMode: "steer",
	busy: true,
	busyDeliverySupported: true,
	...overrides,
});

test("idle sends ignore delivery entirely", () => {
	assert.equal(
		resolveBusyDelivery(GATE({ busy: false, defaultMode: "queue" })),
		undefined,
	);
	assert.equal(
		resolveBusyDelivery(GATE({ busy: false, chordDelivery: "both" })),
		undefined,
	);
	assert.equal(
		mustRefuseBusyDelivery(GATE({ busy: false, defaultMode: "queue" })),
		false,
	);
});

test("steer rides no key: an absent body already means steer", () => {
	assert.equal(resolveBusyDelivery(GATE({})), undefined);
	assert.equal(
		resolveBusyDelivery(GATE({ chordDelivery: "steer", defaultMode: "queue" })),
		undefined,
	);
});

test("a chord mode wins over the default", () => {
	assert.equal(
		resolveBusyDelivery(GATE({ chordDelivery: "both", defaultMode: "queue" })),
		"both",
	);
});

test("the default rides the body when the feature is advertised", () => {
	assert.equal(resolveBusyDelivery(GATE({ defaultMode: "queue" })), "queue");
	assert.equal(resolveBusyDelivery(GATE({ defaultMode: "both" })), "both");
});

test("a resolved queue/both without the feature is refused, never downgraded", () => {
	assert.equal(
		mustRefuseBusyDelivery(
			GATE({ defaultMode: "queue", busyDeliverySupported: false }),
		),
		true,
	);
	assert.equal(
		mustRefuseBusyDelivery(
			GATE({ chordDelivery: "both", busyDeliverySupported: false }),
		),
		true,
	);
	assert.equal(
		resolveBusyDelivery(
			GATE({ defaultMode: "queue", busyDeliverySupported: false }),
		),
		undefined,
		"the resolved value is never the legacy body either — the caller refuses before admission",
	);
	assert.equal(
		mustRefuseBusyDelivery(GATE({ busyDeliverySupported: false })),
		false,
		"steer never refuses",
	);
});

/* ------------------------------------------------------------------ *
 * The contract and the admission pin
 * ------------------------------------------------------------------ */

function resetStore() {
	calls.length = 0;
	store.setState({
		sessions: [],
		statusUnavailable: [],
		activeSessionId: "111111111111",
		activeDraftKey: null,
		drafts: {},
		validatingSessionId: null,
		error: null,
	});
}

const SEND_INPUT = {
	text: "Review this",
	attachments: [],
	images: [],
	mode: "steer",
	cwd: "/tmp",
};

test("sessions.message accepts delivery and still rejects unknown keys", () => {
	const base = {
		op: "sessions.message",
		sessionId: "111111111111",
		requestId: "22222222-2222-4222-8222-222222222222",
		text: "hi",
		mode: "steer",
	};
	assert.equal(
		desktopRequestSchema.safeParse({ ...base, delivery: "queue" }).success,
		true,
	);
	assert.equal(
		desktopRequestSchema.safeParse({ ...base, delivery: "sideways" }).success,
		false,
		"a mode outside steer|queue|both is rejected at the schema",
	);
	assert.equal(
		desktopRequestSchema.safeParse({ ...base, bogus: 1 }).success,
		false,
		"the schema stays .strict() otherwise",
	);
});

test("a busy send carries delivery on the body; a legacy send carries no key", async () => {
	resetStore();
	const key = store.getState().stageDraft({ kind: "agent", name: "reviewer" });
	await admitChatDraft(
		key,
		{ ...SEND_INPUT, delivery: "queue" },
		"111111111111",
	);
	const callsAfter = calls.filter((call) => call.op === "sessions.message");
	const last = callsAfter.at(-1);
	assert.equal(last.delivery, "queue");
	assert.equal(last.mode, "steer");
	// The WIRE body is where absence matters: an older harness's .strict()
	// schema must never see the key, so the endpoint mapping omits it entirely.
	const wire = desktopEndpoint(last);
	assert.equal(wire.body.delivery, "queue");
	// A legacy send (no delivery) carries no key on the wire either.
	resetStore();
	const legacyKey = store
		.getState()
		.stageDraft({ kind: "agent", name: "reviewer" });
	await admitChatDraft(legacyKey, { ...SEND_INPUT }, "111111111111");
	const legacyLast = calls
		.filter((call) => call.op === "sessions.message")
		.at(-1);
	assert.equal(legacyLast.delivery, undefined);
	assert.equal(desktopEndpoint(legacyLast).body.delivery, undefined);
	assert.ok(!("delivery" in desktopEndpoint(legacyLast).body));
});

test("a lost admission response replays the SAME delivery (no 409)", async () => {
	resetStore();
	// The REAL receipt rule: sha256 of the whole body (`delivery` included);
	// the same requestId with a different fingerprint is a 409 forever.
	const receipts = new Map();
	let dropResponse = true;
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		if (request.op === "sessions.create")
			return { session_id: "222222222222", binding: null };
		const { requestId, ...body } = request;
		const fingerprint = JSON.stringify(body, Object.keys(body).sort());
		const seen = receipts.get(requestId);
		if (seen && seen.fingerprint !== fingerprint)
			throw new Error("Request ID was already used with different input");
		if (seen) return { ...seen.result, replayed: true };
		const result = { status: "admitted" };
		receipts.set(requestId, { fingerprint, result });
		if (dropResponse) throw new Error("connection reset");
		return result;
	};
	const key = store.getState().stageDraft({ kind: "agent", name: "reviewer" });
	await assert.rejects(
		admitChatDraft(key, { ...SEND_INPUT, delivery: "queue" }),
		/connection reset/,
	);
	dropResponse = false;
	// A retry that re-derives delivery (or drops it) hashes a different body
	// for the same request id. The pin must resend the first body verbatim —
	// including when the recomputed value would be absent (the legacy body).
	await admitChatDraft(key, { ...SEND_INPUT });
	const admissions = calls.filter((call) => call.op === "sessions.message");
	assert.equal(admissions.at(-1).requestId, admissions[0].requestId);
	assert.equal(admissions.at(-1).delivery, "queue");
	assert.deepEqual(admissions.at(-1), admissions[0]);
	// And the restore path for the refusal row keeps its submitted delivery.
	const drafts = store.getState().drafts;
	for (const draft of Object.values(drafts)) {
		if (draft.submittedDelivery !== undefined)
			assert.equal(draft.submittedDelivery, "queue");
	}
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		return {};
	};
});

/* ------------------------------------------------------------------ *
 * The refusal notice and the source pins
 * ------------------------------------------------------------------ */

test("the refusal notice is keyed, coded, and offers no retry", () => {
	assert.equal(BUSY_DELIVERY_UNSUPPORTED_CODE, "busy_delivery_unsupported");
	// The keyed sentence resolves from the catalogue (asserted against the
	// generated key set, so a renamed key fails here as a type error too).
	assert.equal(
		SEND_FAILURE_COPY.deliveryUnsupported,
		"Cannot change delivery while busy, so it wasn't sent. Send it as a steer, or update the backend.",
	);
});

import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const codeOf = (path) =>
	read(path)
		.replace(/\/\*[\s\S]*?\*\//g, " ")
		.replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

const MESSAGE_INPUT =
	"src/renderer/src/shared/components/composer/message-input.tsx";
const HOOK = "src/renderer/src/shared/hooks/use-message-input.ts";
const CHAT_PAGE = "src/renderer/src/features/chat/components/chat-page.tsx";

test("all four Enter sites go through sendKeyOf, and no site tests Enter inline", () => {
	// The four sites F4 names, as the predicates they now share. A fifth
	// inline test is the drift this pin exists to catch.
	for (const [name, path] of [
		["message-input", MESSAGE_INPUT],
		["use-message-input", HOOK],
	]) {
		const source = codeOf(path);
		assert.match(
			source,
			/sendKeyOf\(/,
			`${name} must decide the send key through the ONE predicate`,
		);
		assert.doesNotMatch(
			source,
			/event\.key === "Enter" &&/,
			`${name} must not test Enter inline beside the predicate`,
		);
		assert.doesNotMatch(
			source,
			/e\.key === "Enter" &&/,
			`${name} must not test Enter inline beside the predicate`,
		);
	}
});

test("the hook's key handler carries the composing test through the predicate", () => {
	const source = codeOf(HOOK);
	assert.match(
		source,
		/isComposing: e\.nativeEvent\.isComposing/,
		"the hook's key handler unwraps nativeEvent.isComposing into the predicate — the CJK/IME case had no test here before",
	);
});

test("the gate lives at the one seam (chat-page send), and refuses before admission", () => {
	const source = codeOf(CHAT_PAGE);
	assert.match(
		source,
		/evaluateBusySend\(/,
		"the page resolves the send through the extracted assembly, not an inline gate",
	);
	assert.match(
		source,
		/busyDefaultFromSettings\(/,
		"the page resolves the default at send time",
	);
	// Refusal precedes admission: the notice is set before admitChatDraft runs,
	// so the draft is kept and nothing is sent as steer. The ORDER is the
	// seam's own (refuse before resolving); the page acts on it.
	const evaluateAt = source.indexOf("evaluateBusySend");
	const refusedAt = source.indexOf("evaluation.refused");
	const admitAt = source.indexOf("await admitChatDraft");
	assert.ok(
		evaluateAt !== -1 &&
			refusedAt !== -1 &&
			admitAt !== -1 &&
			evaluateAt < refusedAt &&
			refusedAt < admitAt,
		"the refusal must be decided before admission",
	);
	// The default is read from the shared settings query, not a local copy.
	assert.match(
		source,
		/desktopKeys\.settings/,
		"the default comes from the shared settings query",
	);
	// The send decision reads the live turn state, not the render closure
	// captured before the awaits.
	assert.match(
		source,
		/busy: turnAliveRef\.current/,
		"the gate reads turnAliveRef, the value after the awaits",
	);
	assert.match(
		source,
		/staleTime: BUSY_DEFAULT_STALE_TIME/,
		"the settings query runs the exported freshness constant, never a second literal",
	);
});

test("the exported staleTime constant is the neighbours' 10s window", () => {
	assert.equal(BUSY_DEFAULT_STALE_TIME, 10_000);
});

test("the seam refuses before it resolves, in the page's own order", () => {
	// A queue chord on an unsupported backend must refuse with NO body —
	// resolving first would hand the caller a `queue` to send as a
	// downgraded steer. The evaluation object itself carries no delivery
	// when refused, so a caller cannot act on one.
	const refused = evaluateBusySend({
		chordDelivery: "queue",
		settings: undefined,
		busy: true,
		busyDeliverySupported: false,
	});
	assert.deepEqual(refused, { refused: true, delivery: undefined });
	const admitted = evaluateBusySend({
		chordDelivery: "queue",
		settings: undefined,
		busy: true,
		busyDeliverySupported: true,
	});
	assert.deepEqual(admitted, { refused: false, delivery: "queue" });
});
