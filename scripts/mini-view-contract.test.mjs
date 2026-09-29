#!/usr/bin/env node
/**
 * The mini view's shared contract, pinned where the three processes meet.
 *
 * WHAT THESE TESTS ARE. `src/shared/mini-view.ts` is the vocabulary main, the
 * preload and both renderer documents agree on — channel names, payload shapes,
 * the status union, the display mapping — and this file pins the pure halves of
 * that agreement: every predicate against malformed wire values (a malformed
 * push must not reach a consumer — review round 1's nit made the preload's
 * claim real), the display pieces the keycap idiom splits on, and the
 * composer's state machine, whose transitions are driven here in process — the
 * discipline its own docstring promises, and where the re-summon semantics
 * (review round 1, Q1: a standing retryable refusal survives re-resolution) are
 * named rather than inferred from a scene — and the input-mode stamp's
 * derivation (`wireInputMode`, the mapping behind `typed`/`dictated`/`mixed`),
 * whose wire half — the field's absence and its exact values — is proven at
 * the desktop contract's own body builder in `mini-view-dictation.test.mjs`.
 *
 * WHAT THEY ARE NOT: proof that the app renders these states (`--scene
 * mini-view` photographs them) or that a chord registers (the registrar suite
 * covers that; the OS is the only authority on a real keypress).
 */
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

/*
 * The modules are bundled from source with esbuild — the harness the sibling
 * suites use — so what runs here is the code that ships. Both modules are
 * import-free by construction, which is itself part of what this file leans
 * on: a shared vocabulary that pulled a window in could not be driven here.
 */
const bundleDir = join(
	process.cwd(),
	"node_modules",
	".tmp",
	`mini-view-tests-${process.pid}`,
);
mkdirSync(bundleDir, { recursive: true });

after(() => {
	rmSync(bundleDir, { recursive: true, force: true });
});

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/shared/mini-view";',
			'export * from "./src/renderer/src/mini-view/mini-state";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const bundleFile = join(bundleDir, "mini-view-contract.mjs");
writeFileSync(bundleFile, bundle.outputFiles[0].text);
const miniView = await import(pathToFileURL(bundleFile).href);

const {
	MINI_VIEW_DISMISS,
	MINI_VIEW_REGISTRATION,
	MINI_VIEW_REGISTRATION_GET,
	MINI_VIEW_SUMMONED,
	formatQuickSendDisplay,
	formatQuickSendTokens,
	isFunctionKeyToken,
	isMiniViewRegistrationState,
	isMiniViewSummonedPayload,
} = miniView;

/* ------------------------------------------------------------------ *
 * The channel names and the payload predicates
 * ------------------------------------------------------------------ */

test("the channel names are the literals every process spells", () => {
	/*
	 * Pinned as VALUES, deliberately: a rename that both halves followed would
	 * still be a wire change against every running pair (an older main against a
	 * newer renderer), so the edit has to be a deliberate one that sees this
	 * line.
	 */
	assert.equal(MINI_VIEW_SUMMONED, "mini-view:summoned");
	assert.equal(MINI_VIEW_DISMISS, "mini-view:dismiss");
	assert.equal(MINI_VIEW_REGISTRATION, "mini-view:registration");
	assert.equal(MINI_VIEW_REGISTRATION_GET, "mini-view:registration-get");
});

test("isMiniViewSummonedPayload accepts the shape main sends and nothing else", () => {
	assert.ok(isMiniViewSummonedPayload({ at: 1 }));
	assert.ok(!isMiniViewSummonedPayload(null));
	assert.ok(!isMiniViewSummonedPayload(undefined));
	assert.ok(!isMiniViewSummonedPayload({}));
	assert.ok(!isMiniViewSummonedPayload({ at: "1" }));
	assert.ok(!isMiniViewSummonedPayload("mini-view:summoned"));
});

test("isMiniViewRegistrationState is the preload's gate, and it is strict", () => {
	const valid = {
		value: "primary+alt+space",
		accelerator: "CommandOrControl+Alt+Space",
		status: "registered",
	};
	assert.ok(isMiniViewRegistrationState(valid));
	assert.ok(
		isMiniViewRegistrationState({ ...valid, status: "taken", reason: "held" }),
		"the optional reason is fine when it is a string",
	);
	assert.ok(!isMiniViewRegistrationState(null));
	assert.ok(!isMiniViewRegistrationState({}));
	assert.ok(!isMiniViewRegistrationState({ ...valid, value: undefined }));
	assert.ok(!isMiniViewRegistrationState({ ...valid, value: 1 }));
	assert.ok(!isMiniViewRegistrationState({ ...valid, accelerator: null }));
	assert.ok(
		!isMiniViewRegistrationState({ ...valid, status: "exploded" }),
		"an unknown status is malformed, not a state to render",
	);
	assert.ok(!isMiniViewRegistrationState({ ...valid, reason: 7 }));
});

test("isFunctionKeyToken bounds the bare carve-out to F1-F24", () => {
	assert.ok(isFunctionKeyToken("f1"));
	assert.ok(isFunctionKeyToken("f8"));
	assert.ok(isFunctionKeyToken("f12"));
	assert.ok(isFunctionKeyToken("f24"));
	assert.ok(!isFunctionKeyToken("f0"));
	assert.ok(!isFunctionKeyToken("f25"));
	assert.ok(!isFunctionKeyToken("F8"), "the stored grammar is lowercase");
	assert.ok(!isFunctionKeyToken("f"));
	assert.ok(!isFunctionKeyToken("space"));
});

/* ------------------------------------------------------------------ *
 * The display pieces the keycap idiom splits on
 * ------------------------------------------------------------------ */

test("the display tokens are one entry per cap, and the sentence joins them", () => {
	assert.deepEqual(formatQuickSendTokens("primary+alt+space", "mac"), [
		"⌘",
		"⌥",
		"Space",
	]);
	assert.equal(formatQuickSendDisplay("primary+alt+space", "mac"), "⌘⌥Space");
	assert.deepEqual(formatQuickSendTokens("primary+alt+space", "win"), [
		"Ctrl",
		"Alt",
		"Space",
	]);
	assert.equal(
		formatQuickSendDisplay("primary+alt+space", "win"),
		"Ctrl+Alt+Space",
	);
	assert.equal(
		formatQuickSendDisplay("meta+space", "win"),
		"Win+Space",
		"the literal meta key spells Win on Windows and Super elsewhere",
	);
	assert.equal(formatQuickSendDisplay("meta+space", "linux"), "Super+Space");
	assert.equal(formatQuickSendDisplay("primary+f8", "mac"), "⌘F8");
	/*
	 * THE HEADER'S OWN SPELLING: `KeyboardShortcut` splits its prop on "+", so
	 * the mini header passes `tokens.join("+")` — the round trip below is what
	 * that call site relies on for a three-key chord.
	 */
	assert.equal(
		formatQuickSendTokens("primary+alt+space", "mac").join("+"),
		"⌘+⌥+Space",
	);
});

/* ------------------------------------------------------------------ *
 * The composer's state machine
 * ------------------------------------------------------------------ */

const {
	MINI_INITIAL_STATE,
	canSend,
	isEditable,
	miniTransitions,
	wireInputMode,
} = miniView;

const at = (overrides) => ({ ...MINI_INITIAL_STATE, ...overrides });

test("canSend and isEditable state the machine's one invariant", () => {
	assert.equal(canSend(MINI_INITIAL_STATE, ""), false);
	assert.equal(canSend(MINI_INITIAL_STATE, "   "), false);
	assert.equal(
		canSend(MINI_INITIAL_STATE, "hello"),
		true,
		"the seat pending state must not block the press (the press awaits the resolution)",
	);
	assert.equal(
		canSend(at({ seat: "blocked" }), "hello"),
		false,
		"a blocked seat is the one refusal canSend states",
	);
	assert.equal(canSend(at({ send: "sending" }), "hello"), false);
	assert.equal(canSend(at({ send: "sent" }), "hello"), false);
	assert.equal(isEditable(at({ send: "sending" })), false);
	assert.equal(isEditable(at({ send: "sent" })), true);
});

test("a send clears the notice and a failure carries the classifier's answer", () => {
	const failed = miniTransitions.sendFailed(
		at({ send: "sending" }),
		"Couldn't reach the chief of staff.",
		true,
	);
	assert.equal(failed.send, "error");
	assert.equal(failed.retryable, true);
	const restarted = miniTransitions.sendStarted(failed);
	assert.equal(restarted.notice, null);
	assert.equal(restarted.retryable, false);
	assert.equal(miniTransitions.sendSucceeded(failed).send, "sent");
});

test("a re-summon resets only the Sent flash, never a standing refusal", () => {
	const failed = miniTransitions.sendFailed(
		MINI_INITIAL_STATE,
		"Couldn't reach the chief of staff.",
		true,
	);
	const afterSummon = miniTransitions.summoned(failed);
	assert.deepEqual(
		afterSummon,
		failed,
		"the draft survives hide and the failure's notice keeps standing",
	);
	const flashed = miniTransitions.summoned(at({ send: "sent" }));
	assert.equal(flashed.send, "idle");
	assert.equal(flashed.notice, null);
});

test("a re-resolution preserves a standing retryable refusal (Q1)", () => {
	/*
	 * THE QA ROUND 1 REPRO, as the machine sees it: send refused pre-admission
	 * with Retry up; a summon re-resolves the seat; the resolution answers — and
	 * before this fix seatBlocked/seatReady replaced the refusal, dropping Retry
	 * and leaving the draft's only recovery a hide plus another summon.
	 */
	const refused = miniTransitions.sendFailed(
		at({ seat: "blocked" }),
		"Couldn't reach the chief of staff.",
		true,
	);
	const blockedAgain = miniTransitions.seatBlocked(
		refused,
		"This build doesn't have a chief-of-staff seat.",
	);
	assert.equal(blockedAgain.seat, "blocked");
	assert.equal(
		blockedAgain.notice,
		"Couldn't reach the chief of staff.",
		"the sentence the reader was acting on keeps standing",
	);
	assert.equal(
		blockedAgain.retryable,
		true,
		"Retry is the only in-window recovery",
	);
	const recovered = miniTransitions.seatReady(refused);
	assert.equal(recovered.seat, "ready");
	assert.equal(recovered.notice, "Couldn't reach the chief of staff.");
	assert.equal(recovered.retryable, true);
	/*
	 * A NON-retryable notice (a seat sentence, no Retry offered) is the
	 * resolution's own to replace: the new answer is the newer fact.
	 */
	const seatSentence = miniTransitions.seatBlocked(
		MINI_INITIAL_STATE,
		"This build doesn't have a chief-of-staff seat.",
	);
	const replaced = miniTransitions.seatReady(seatSentence);
	assert.equal(replaced.notice, null);
	assert.equal(replaced.retryable, false);
});

test("Retry re-opens the gate without erasing the sentence that explains it", () => {
	const refused = miniTransitions.sendFailed(
		at({ seat: "blocked" }),
		"Couldn't reach the chief of staff.",
		true,
	);
	const retried = miniTransitions.seatRetry(refused);
	assert.equal(retried.seat, "pending");
	assert.equal(retried.notice, refused.notice);
	assert.equal(retried.retryable, true);
	const cleared = miniTransitions.clearNotice(refused);
	assert.equal(cleared.notice, null);
	assert.equal(cleared.retryable, false);
});

/* ------------------------------------------------------------------ *
 * The input-mode stamp's derivation
 * ------------------------------------------------------------------ */

test("the stamp follows the composer's rule: typed | dictated | mixed", () => {
	/*
	 * The mapping is the reference's own (`inputModeForSend`,
	 * `message-input.tsx`): `dictated` only when a transcript put the content
	 * there, `mixed` when both doors did, `typed` when only the keyboard did.
	 * The caller owns "since the box last emptied" — its reset refs — and
	 * passes the gate's own answer in.
	 */
	assert.equal(wireInputMode(true, false, false), "typed", "keyboard only");
	assert.equal(wireInputMode(true, false, true), "dictated", "transcript only");
	assert.equal(wireInputMode(true, true, true), "mixed", "both doors");
	assert.equal(
		wireInputMode(true, true, false),
		"typed",
		"typing alone is still typed, however much was typed",
	);
});

test("feature off stamps nothing: the legacy body is the field's absence", () => {
	/*
	 * `features.input_mode` off must produce `undefined` — which is what makes
	 * the wire drop the key entirely rather than carry a present-but-empty one
	 * (an older harness validates the message body with `extra="forbid"`).
	 */
	assert.equal(wireInputMode(false, false, false), undefined);
	assert.equal(wireInputMode(false, true, true), undefined);
});
