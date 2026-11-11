/**
 * S4, the send-shortcut slice of the busy-delivery contract (architect D4-D8,
 * T5-T7) — the desktop half of "shortcuts needs to be configurable along with
 * modes".
 *
 *  1. The predicate with chord bindings: a bound modified Enter selects its
 *     mode on mac (Cmd) and elsewhere (Ctrl) alike, Shift+Enter stays the
 *     newline, an IME composition never sends.
 *  2. The gate: a chord mode the backend cannot honour is refused, never
 *     sent as steer (D11); a chord on an idle session sends a normal prompt.
 *  3. The replay pin: `submittedDelivery` equals the first body, so a retry
 *     after a lost response does not 409 — the D10 pin through the worked
 *     example.
 *  4. The recorder: `primary+enter` is accepted for a send row, bare Enter
 *     ends the edit, and a conflict with another action is refused with the
 *     existing sentence (D7/D12).
 *  5. The mirror check (T7): the renderer's send ids are a subset of the
 *     backend fixture's `keymap.send_*` ids — the shared string is the seam
 *     (D4/D5), so it is pinned from both sides.
 *
 * The bundle is `busy-delivery-desktop.test.mjs`'s own fixture narrowed to the
 * predicate and the admission seam, plus the keymap modules the recorder
 * half needs. The wiring is pinned by the source scans at the end: every
 * Enter site answers from the stored bindings, and the section renders the
 * Sending group.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/* ------------------------------------------------------------------ *
 * The bundle: predicate + gate + admission + keymap
 * ------------------------------------------------------------------ */

const values = new Map();
globalThis.localStorage = {
	getItem: (key) => values.get(key) ?? null,
	setItem: (key, value) => values.set(key, value),
	removeItem: (key) => values.delete(key),
};
globalThis.__canonicalRequest = async () => ({});
globalThis.__canonicalEcho = () => {};
const calls = [];
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

const bundle = await build({
	stdin: {
		contents: `
			export * from "./src/renderer/src/shared/store/canonical-sessions-store";
			export {
				BUSY_DELIVERY_UNSUPPORTED_CODE,
				busyDefaultFromSettings,
				mustRefuseBusyDelivery,
				resolveBusyDelivery,
				sendKeyOf,
				sendChordBindings,
				NO_SEND_CHORDS,
			} from "./src/renderer/src/features/chat/composer-send-key";
			export {
				captureRefusal,
				effectiveChord,
				isSendChordOf,
				normalizeChord,
				sanitizeShortcutBindings,
			} from "./src/renderer/src/shared/keymap/keymap-chord";
			export { chordFromEvent } from "./src/renderer/src/shared/keymap/chord-capture";
			export { SEND_ACTION_IDS } from "./src/renderer/src/shared/keymap/keymap-registry";
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
			name: "send-shortcuts-fixture",
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
	busyDefaultFromSettings,
	mustRefuseBusyDelivery,
	resolveBusyDelivery,
	sendKeyOf,
	sendChordBindings,
	NO_SEND_CHORDS,
	SEND_ACTION_IDS,
	captureRefusal,
	chordFromEvent,
	effectiveChord,
	isSendChordOf,
	normalizeChord,
	sanitizeShortcutBindings,
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

/* ------------------------------------------------------------------ *
 * T5 — the predicate with chord bindings (D10, D8)
 * ------------------------------------------------------------------ */

test("sendChordBindings: an unbound row answers nothing", () => {
	assert.equal(sendChordBindings({}).size, 0);
	// `null` is the deliberate no-chord state, not "the default".
	assert.equal(sendChordBindings({ "composer.send_queue": null }).size, 0);
});

test("a bound primary+enter selects its own mode on both platforms", () => {
	const bindings = sendChordBindings({
		"composer.send_queue": "primary+enter",
	});
	assert.equal(bindings.get("primary+enter"), "queue");
	// The repo's `primary` resolution: ⌘ on macOS, Ctrl elsewhere — one
	// stored chord, both presses. Both spellings reach `primary+enter`.
	assert.deepEqual(sendKeyOf(KEY({ metaKey: true }), bindings), {
		delivery: "queue",
	});
	assert.deepEqual(sendKeyOf(KEY({ ctrlKey: true }), bindings), {
		delivery: "queue",
	});
	// The plain Enter beside them keeps the default.
	assert.deepEqual(sendKeyOf(KEY({}), bindings), { delivery: null });
});

test("alt+enter and primary+shift+enter are also send chords", () => {
	const alt = sendChordBindings({ "composer.send_both": "alt+enter" });
	assert.deepEqual(sendKeyOf(KEY({ altKey: true }), alt), {
		delivery: "both",
	});
	const shifted = sendChordBindings({
		"composer.send_steer": "primary+shift+enter",
	});
	// The recorder accepts the spelling, but Shift+Enter is the newline: the
	// predicate refuses it even when a chord names it (D7).
	assert.equal(
		chordFromEvent({
			key: "Enter",
			ctrlKey: false,
			metaKey: true,
			altKey: false,
			shiftKey: true,
		}),
		"primary+shift+enter",
	);
	assert.equal(
		sendKeyOf(KEY({ metaKey: true, shiftKey: true }), shifted),
		null,
		"Shift+Enter stays the newline, even when a chord names it",
	);
});

test("Shift+Enter is a newline, never a send — with or without a chord", () => {
	const bindings = sendChordBindings({
		"composer.send_queue": "primary+enter",
	});
	assert.equal(sendKeyOf(KEY({ shiftKey: true }), NO_SEND_CHORDS), null);
	assert.equal(sendKeyOf(KEY({ shiftKey: true }), bindings), null);
	assert.equal(
		sendKeyOf(KEY({ metaKey: true, shiftKey: true }), bindings),
		null,
	);
});

test("a composing (IME) modified Enter never sends, chord or not", () => {
	const bindings = sendChordBindings({
		"composer.send_queue": "primary+enter",
	});
	assert.equal(sendKeyOf(KEY({ isComposing: true }), NO_SEND_CHORDS), null);
	assert.equal(
		sendKeyOf(KEY({ isComposing: true, metaKey: true }), bindings),
		null,
	);
	assert.equal(
		sendKeyOf(KEY({ isComposing: true, ctrlKey: true }), bindings),
		null,
	);
});

test("a chord mode the backend cannot honour is refused, never sent as steer", () => {
	const gate = (overrides) => ({
		chordDelivery: null,
		defaultMode: "steer",
		busy: true,
		busyDeliverySupported: true,
		...overrides,
	});
	// A chord-bound queue against a backend without the feature: refuse.
	assert.equal(
		resolveBusyDelivery(
			gate({ chordDelivery: "queue", busyDeliverySupported: false }),
		),
		undefined,
	);
	assert.equal(
		mustRefuseBusyDelivery(
			gate({ chordDelivery: "queue", busyDeliverySupported: false }),
		),
		true,
	);
	// A chord-bound steer is today's behaviour and never refuses.
	assert.equal(
		mustRefuseBusyDelivery(
			gate({ chordDelivery: "steer", busyDeliverySupported: false }),
		),
		false,
	);
	// With the feature, the chord mode rides the body.
	assert.equal(resolveBusyDelivery(gate({ chordDelivery: "queue" })), "queue");
});

test("an idle session ignores the chord mode — a normal prompt", () => {
	assert.equal(
		resolveBusyDelivery({
			chordDelivery: "queue",
			defaultMode: "steer",
			busy: false,
			busyDeliverySupported: true,
		}),
		undefined,
	);
	assert.equal(
		mustRefuseBusyDelivery({
			chordDelivery: "queue",
			defaultMode: "steer",
			busy: false,
			busyDeliverySupported: false,
		}),
		false,
	);
});

test("a plain Enter always follows the delivery.busy_default read", () => {
	// Plain Enter resolves to the default, never to a bound chord's mode.
	const bindings = sendChordBindings({
		"composer.send_steer": "primary+enter",
	});
	assert.deepEqual(sendKeyOf(KEY({}), bindings), { delivery: null });
	assert.equal(busyDefaultFromSettings(undefined), "steer");
	assert.equal(
		busyDefaultFromSettings([{ key: "delivery.busy_default", value: "both" }]),
		"both",
	);
});

/* ------------------------------------------------------------------ *
 * T5 — the replay pin equals the first body (F6, D10)
 * ------------------------------------------------------------------ */

test("a replay after a lost response keeps delivery (no 409)", async () => {
	/*
	 * The admission hash pins `submittedDelivery` beside `submittedMode`: a
	 * lost-response replay resends the SAME hashed body, so the server sees
	 * the same content and does not answer 409. The worked example mirrors
	 * S2's own replay case (`busy-delivery-desktop.test.mjs`): admit with a
	 * chord delivery, drop the response, retry on the same draft, and the
	 * second admission replays the first body verbatim — `submittedDelivery`
	 * on the draft equals the first body's delivery.
	 */
	resetStore();
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
	const SEND_INPUT = {
		text: "hello",
		attachments: [],
		images: [],
		mode: "steer",
		cwd: "/tmp",
	};
	const key = store.getState().stageDraft({ kind: "agent", name: "reviewer" });
	await assert.rejects(
		admitChatDraft(key, { ...SEND_INPUT, delivery: "queue" }),
		/connection reset/,
	);
	dropResponse = false;
	await admitChatDraft(key, { ...SEND_INPUT });
	const admissions = calls.filter((call) => call.op === "sessions.message");
	assert.equal(admissions.at(-1).requestId, admissions[0].requestId);
	assert.deepEqual(admissions.at(-1), admissions[0]);
	for (const draft of Object.values(store.getState().drafts)) {
		if (draft.submittedDelivery !== undefined)
			assert.equal(draft.submittedDelivery, "queue");
	}
	globalThis.__canonicalRequest = async (request) => {
		calls.push(request);
		return {};
	};
});

/* ------------------------------------------------------------------ *
 * T6 — the recorder (D12, D7)
 * ------------------------------------------------------------------ */

test("the recorder accepts primary+enter for a send row", () => {
	assert.equal(normalizeChord("primary+enter"), "primary+enter");
	assert.equal(
		captureRefusal("primary+enter", "composer.send_queue", {}),
		null,
	);
	assert.equal(
		captureRefusal("primary+alt+enter", "composer.send_both", {}),
		null,
	);
	assert.equal(captureRefusal("alt+enter", "composer.send_both", {}), null);
	// A shifted Enter is the newline, never a send chord: the grammar refuses
	// it with its own sentence, not with a silent accept.
	assert.equal(
		captureRefusal("primary+shift+enter", "composer.send_steer", {}),
		"Use Ctrl/⌘ or Alt with Enter. Shift+Enter adds a newline.",
	);
	assert.equal(
		captureRefusal("shift+enter", "composer.send_steer", {}),
		"Use Ctrl/⌘ or Alt with Enter. Shift+Enter adds a newline.",
	);
});

test("a send row pressing any non-Enter key hears the send sentence", () => {
	// A plain letter (no primary) on a send row does NOT fall through to the
	// general needs-a-modifier sentence, and it does NOT name a reserved
	// job or a conflict with another row. Every non-send chord is dead on a
	// send row — `sendKeyOf` can never fire on it — so naming any other
	// job would accept the press as a binding and claim the chord beside
	// it. It hears the sending sentence instead.
	assert.equal(
		captureRefusal("j", "composer.send_queue", {}),
		"Use Ctrl/⌘ or Alt with Enter.",
	);
	assert.equal(
		captureRefusal("primary+backspace", "composer.send_queue", {}),
		"Use Ctrl/⌘ or Alt with Enter.",
	);
	assert.equal(
		captureRefusal("primary+up", "composer.send_queue", {}),
		"Use Ctrl/⌘ or Alt with Enter.",
	);
	assert.equal(
		captureRefusal("primary+1", "composer.send_queue", {}),
		"Use Ctrl/⌘ or Alt with Enter.",
	);
	assert.equal(
		captureRefusal("alt+j", "composer.send_queue", {}),
		"Use Ctrl/⌘ or Alt with Enter.",
	);
	assert.equal(
		captureRefusal("alt+backspace", "composer.send_queue", {}),
		"Use Ctrl/⌘ or Alt with Enter.",
	);
	assert.equal(
		captureRefusal("shift+j", "composer.send_queue", {}),
		"Use Ctrl/⌘ or Alt with Enter.",
	);
	assert.equal(
		captureRefusal("primary+alt+shift+enter", "composer.send_queue", {}),
		"Use Ctrl/⌘ or Alt with Enter. Shift+Enter adds a newline.",
		"a shifted Enter spelling keeps the newline sentence",
	);
});

test("bare Enter ends the edit rather than spelling a chord", () => {
	// `chordFromEvent` refuses the bare press; the row's edit-ender is the
	// other half (the section's modified-Enter allowlist).
	assert.equal(
		chordFromEvent({
			key: "Enter",
			ctrlKey: false,
			metaKey: false,
			altKey: false,
			shiftKey: false,
		}),
		null,
	);
	// A bare Enter on a send row names what it needs: Ctrl/⌘ or Alt with Enter.
	assert.equal(
		captureRefusal("enter", "composer.send_queue", {}),
		"Use Ctrl/⌘ or Alt with Enter.",
	);
	// A bare Enter on a panel row is the plain send: there is no chord to bind.
	assert.equal(
		captureRefusal("enter", "panel.console", {}),
		"Use a Sending row for a key that sends a message.",
	);
});

test("a panel row pressing a modified Enter hears the Sending sentence", () => {
	assert.equal(
		captureRefusal("primary+enter", "panel.console", {}),
		"Use a Sending row for a key that sends a message.",
	);
	assert.equal(
		captureRefusal("primary+shift+enter", "panel.console", {}),
		"Use a Sending row for a key that sends a message.",
	);
	assert.equal(
		captureRefusal("alt+enter", "panel.console", {}),
		"Use a Sending row for a key that sends a message.",
	);
});

test("a conflict with another action is refused with the existing sentence", () => {
	const bindings = { "composer.send_queue": "primary+enter" };
	/*
	 * A second send row pressing the first's chord hears the conflict
	 * sentence: the send arm must not skip the conflict checks. A panel row
	 * pressing a send chord hears the Sending sentence, not the conflict one,
	 * because a panel row cannot bind a send key at all.
	 */
	assert.equal(
		captureRefusal("primary+enter", "composer.send_steer", bindings),
		"Already assigned to Send as queue.",
	);
	assert.equal(
		captureRefusal("primary+enter", "composer.send_queue", bindings),
		null,
		"the send row's own chord is never a conflict with itself (U3)",
	);
	assert.equal(
		captureRefusal("primary+enter", "panel.console", bindings),
		"Use a Sending row for a key that sends a message.",
	);
	// And the reverse: a send row pressing a panel chord hears the send
	// sentence, NOT the conflict with Open console. `primary+j` has
	// `primary`, so the general path below would name the conflict — but a
	// chord that can never send is not a binding worth naming a conflict
	// over, and this press is not a panel row at all.
	assert.equal(
		captureRefusal("primary+j", "composer.send_queue", {}),
		"Use Ctrl/⌘ or Alt with Enter.",
	);
	// An external claim (the recording row) is also a conflict for a send row.
	assert.equal(
		captureRefusal(
			"primary+enter",
			"composer.send_steer",
			{},
			"linux",
			new Map([["primary+enter", "Start recording"]]),
		),
		"Already assigned to Start recording.",
	);
});

/**
 * M1 property test: every modifier combination × every key, on every send row.
 *
 * Half the defect was a fall-through in `captureRefusal`'s send arm: a
 * non-send chord (`primary+backspace`, `primary+j`, `primary+g`,
 * `primary+alt+j`, `primary+shift+j`, `primary+1`, `primary+alt+shift+enter`
 * — anywhere except a shifted Enter) dropped out of the send arm into the
 * general path, which accepted any non-reserved chord carrying `primary`.
 * The row then SHOWED e.g. `Ctrl+Backspace`, kept it across reload, and
 * claimed it against other rows, while `sendKeyOf` fired never: for a dead
 * chord the two readers disagreed and a `Ctrl+Backspace` press did nothing
 * the next day. The sanitizer and `effectiveChord` then kept the dead
 * chord alive because they only tested `chordHasPrimary` / RESERVED.
 *
 * The predicate `isSendChordOf` is now the ONE gate for send rows at
 * capture, sanitize, effective, and send. This test enumerates the whole
 * grammar — 16 modifier combinations × 43 spellable keys (letters, digits,
 * Enter, Backspace, Delete, Space, arrows, and the named keys
 * `normalizeChord` accepts) — and asserts the four readers agree on every
 * combination on every send row:
 *
 *   capture accepts  <=>  sanitize keeps  <=>  effectiveChord returns it
 *                       <=>  sendKeyOf fires with that row's mode
 *
 * A stored binding that capture would refuse must not survive reload, and
 * a binding reload keeps must fire. Zero disagreements across all rows.
 */
test("send rows accept only Enter chords: capture, sanitize, effective and send agree", () => {
	const MODIFIERS = ["primary", "alt", "shift"];
	// Generate the 16 combinations: for bitmask 0..15, include modifier when bit set.
	const modifierCombos = [];
	for (let mask = 0; mask < 16; mask++) {
		const combo = MODIFIERS.filter((_, bit) => (mask & (1 << bit)) !== 0);
		modifierCombos.push(combo);
	}
	assert.equal(modifierCombos.length, 16, "16 modifier combinations");
	const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");
	const DIGITS = "0123456789".split("");
	const NAMED = [
		"space",
		"backspace",
		"delete",
		"insert",
		"home",
		"end",
		"pageup",
		"pagedown",
		"up",
		"down",
		"left",
		"right",
		"enter",
	];
	const KEYS = [...LETTERS, ...DIGITS, ...NAMED];
	assert.equal(KEYS.length, 26 + 10 + 13, "letters + digits + named keys");
	const MODES = {
		"composer.send_steer": "steer",
		"composer.send_queue": "queue",
		"composer.send_both": "both",
	};
	const SEND_IDS = Object.keys(MODES);
	// How an event is built from a canonical chord, for the `sendKeyOf` arm:
	// a key decides its `event.key`, modifiers decide the flags. `primary`
	// alone maps to metaKey (the mac reading); ctrlKey would spell the same
	// canonical chord, and the Enter arms already pin both platforms.
	const toEvent = (chord) => {
		const tokens = chord.split("+");
		const key = tokens[tokens.length - 1];
		const mods = new Set(tokens.slice(0, -1));
		const keyEvents = {
			enter: "Enter",
			space: " ",
			backspace: "Backspace",
			delete: "Delete",
			insert: "Insert",
			home: "Home",
			end: "End",
			pageup: "PageUp",
			pagedown: "PageDown",
			up: "ArrowUp",
			down: "ArrowDown",
			left: "ArrowLeft",
			right: "ArrowRight",
		};
		const eventKey = keyEvents[key] ?? key;
		return {
			key: eventKey,
			shiftKey: mods.has("shift"),
			ctrlKey: false,
			metaKey: mods.has("primary"),
			altKey: mods.has("alt"),
			isComposing: false,
		};
	};
	let disagreements = 0;
	const disagreed = [];
	for (const id of SEND_IDS) {
		for (const combo of modifierCombos) {
			for (const key of KEYS) {
				const canonical = [...combo, key].join("+");
				const expected = isSendChordOf(canonical);
				const captureSays = captureRefusal(canonical, id, {}) === null;
				const kept = sanitizeShortcutBindings({ [id]: canonical });
				const sanitizeSays = kept[id] === canonical;
				const effectiveSays = effectiveChord(id, kept) === canonical;
				const bindings = sendChordBindings(kept);
				const fired = sendKeyOf(toEvent(canonical), bindings);
				const sendSays =
					fired !== null && fired.delivery === MODES[id];
				if (
					captureSays !== expected ||
					sanitizeSays !== expected ||
					effectiveSays !== expected ||
					sendSays !== expected
				) {
					disagreements += 1;
					disagreed.push({
					id,
					canonical,
					expected,
					captureSays,
					sanitizeSays,
					effectiveSays,
					sendSays,
					fired,
					kept,
				});
				}
			}
		}
	}
	assert.equal(
		disagreements,
		0,
		`send-row readers disagree on ${disagreements} chords: ${JSON.stringify(disagreed.slice(0, 8), null, 2)}`,
	);
});

test("the sanitizer keeps send chords and drops hand-edited bare Enter", () => {
	assert.deepEqual(
		sanitizeShortcutBindings({ "composer.send_queue": "primary+enter" }),
		{ "composer.send_queue": "primary+enter" },
	);
	assert.deepEqual(
		sanitizeShortcutBindings({ "composer.send_queue": "alt+enter" }),
		{ "composer.send_queue": "alt+enter" },
		"an Alt-only send chord survives — it carries no primary and still sends",
	);
	assert.deepEqual(
		sanitizeShortcutBindings({ "composer.send_queue": "primary+alt+enter" }),
		{ "composer.send_queue": "primary+alt+enter" },
	);
	assert.deepEqual(
		sanitizeShortcutBindings({ "composer.send_queue": "primary+j" }),
		{},
		"a primary+letter on a send row never arms — it can never send",
	);
	assert.deepEqual(
		sanitizeShortcutBindings({
			"composer.send_queue": "primary+backspace",
		}),
		{},
		"a primary+backspace on a send row never arms",
	);
	assert.deepEqual(
		sanitizeShortcutBindings({
			"composer.send_queue": "primary+alt+shift+enter",
		}),
		{},
		"a shifted Enter spelling never arms",
	);
	assert.deepEqual(
		sanitizeShortcutBindings({ "composer.send_queue": "enter" }),
		{},
		"a hand-written bare Enter never arms",
	);
	assert.deepEqual(
		sanitizeShortcutBindings({ "composer.send_queue": "shift+enter" }),
		{},
		"a hand-written shift+enter never arms",
	);
	assert.deepEqual(
		sanitizeShortcutBindings({
			"composer.send_queue": "primary+enter",
			"composer.send_steer": "primary+enter",
		}),
		{ "composer.send_steer": "primary+enter" },
		"the first send row in registry order (steer) keeps the chord",
	);
});

/* ------------------------------------------------------------------ *
 * T7 — the mirror check: renderer ids ⊆ backend `keymap.send_*` ids
 * ------------------------------------------------------------------ */

test("the renderer send ids are a subset of the backend fixture ids", () => {
	const fixture = JSON.parse(
		readFileSync("scripts/fixtures/backend-settings-registry.json", "utf8"),
	);
	const backendIds = new Set(
		fixture.settings
			.map((setting) => setting.key)
			.filter((key) => key.startsWith("keymap.send_")),
	);
	// D4: the id strings are identical across surfaces. The renderer names
	// its rows `composer.send_*` because its registry prefix is `panel.`/
	// `composer.`; the shared tail plus the `keymap.` row name must match.
	const rendererTails = SEND_ACTION_IDS.map((id) =>
		id.replace(/^composer\./, "keymap."),
	);
	assert.deepEqual(rendererTails.sort(), [
		"keymap.send_both",
		"keymap.send_queue",
		"keymap.send_steer",
	]);
	for (const id of rendererTails) {
		assert.ok(
			backendIds.has(id),
			`renderer send id ${id} is not served by the backend registry`,
		);
	}
	// And the rows really are composer-scope on the backend (D6).
	const composerRows = fixture.settings.filter(
		(setting) => setting.hotkey_scope === "composer",
	);
	assert.deepEqual(composerRows.map((row) => row.key).sort(), [
		"keymap.send_both",
		"keymap.send_queue",
		"keymap.send_steer",
	]);
	assert.ok(
		composerRows.every((row) => row.default === "" && row.value === ""),
		"send rows ship unbound on both surfaces (D8)",
	);
});

/* ------------------------------------------------------------------ *
 * Source pins: the wiring (D10 — "with the S2 gating untouched")
 * ------------------------------------------------------------------ */

const read = (path) => readFileSync(path, "utf8");
const codeOf = (path) =>
	read(path)
		.replace(/\/\*[\s\S]*?\*\//g, " ")
		.replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

const MESSAGE_INPUT =
	"src/renderer/src/shared/components/composer/message-input.tsx";
const HOOK = "src/renderer/src/shared/hooks/use-message-input.ts";
const SECTION =
	"src/renderer/src/features/settings/components/keyboard-shortcuts-section.tsx";

test("every Enter site answers from the stored bindings, not the empty map", () => {
	for (const [name, path] of [
		["message-input", MESSAGE_INPUT],
		["use-message-input", HOOK],
	]) {
		const source = codeOf(path);
		// All four sites once passed NO_SEND_CHORDS; each now builds the live
		// bindings from the renderer's stored shortcutBindings.
		assert.doesNotMatch(
			source,
			/NO_SEND_CHORDS/,
			`${name} must not pass the empty map at an Enter site`,
		);
		assert.match(
			source,
			/sendChordBindings\(\s*useUiPreferencesStore\.getState\(\)\.shortcutBindings/,
			`${name} must build its bindings from the stored shortcutBindings`,
		);
	}
	// The empty map survives only as the predicate module's test fixture.
	assert.match(
		codeOf(MESSAGE_INPUT),
		/sendChordBindings\(/,
		"message-input must build live bindings at its Enter sites",
	);
});

test("the section renders a Sending group of three recorder rows", () => {
	const source = codeOf(SECTION);
	assert.match(
		source,
		/ui\.settings\.shortcuts\.category\.sending/,
		"the Sending group heading is keyed",
	);
	assert.match(
		source,
		/ui\.settings\.shortcuts\.category\.sending_description/,
		"the Sending group help is keyed",
	);
	// The three send rows are the composer-scoped actions.
	assert.match(
		source,
		/scope === "composer"/,
		"the Sending group renders the composer-scoped rows",
	);
	// Bare Enter ends the edit on every row; a modified Enter reaches the
	// recorder (the section's own allowlist beside END_EDIT_KEYS).
	assert.doesNotMatch(
		source,
		/END_EDIT_KEYS\.has\(event\.key\)/,
		"the section must not end the edit on a modified Enter",
	);
	assert.match(
		source,
		/event\.key === "Enter" &&/,
		"a modified Enter must reach the recorder",
	);
});
