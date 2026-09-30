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
 * FRAME's state machine (the restyle's smaller one: a notice with its register,
 * and the "Sent" flash), the serve-side resize/dialog payload guards, and the
 * seat-name resolver every one of the four seat sentences renders through
 * (operator directive, 2026-09-29). The composer's own send machine left this
 * file with the restyle: it is the SHARED composer's now, and the chat's own
 * suites drive it.
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
			'export * from "./src/renderer/src/mini-view/mini-copy";',
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
	MINI_COPY,
	MINI_VIEW_DIALOG,
	MINI_VIEW_DISMISS,
	MINI_VIEW_HEIGHT,
	MINI_VIEW_MAX_HEIGHT,
	MINI_VIEW_REGISTRATION,
	MINI_VIEW_REGISTRATION_GET,
	MINI_VIEW_RESIZE,
	MINI_VIEW_SUMMONED,
	MINI_VIEW_WIDTH,
	formatQuickSendDisplay,
	formatQuickSendTokens,
	isFunctionKeyToken,
	isMiniViewDialogPayload,
	isMiniViewRegistrationState,
	isMiniViewResizePayload,
	isMiniViewSummonedPayload,
	resolveSeatName,
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
	assert.equal(MINI_VIEW_RESIZE, "mini-view:resize");
	assert.equal(MINI_VIEW_DIALOG, "mini-view:dialog");
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
		value: "primary+alt+shift+space",
		accelerator: "CommandOrControl+Alt+Shift+Space",
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
	assert.deepEqual(formatQuickSendTokens("primary+alt+shift+space", "mac"), [
		"⌘",
		"⌥",
		"⇧",
		"Space",
	]);
	assert.equal(
		formatQuickSendDisplay("primary+alt+shift+space", "mac"),
		"⌘⌥⇧Space",
	);
	assert.deepEqual(formatQuickSendTokens("primary+alt+shift+space", "win"), [
		"Ctrl",
		"Alt",
		"Shift",
		"Space",
	]);
	assert.equal(
		formatQuickSendDisplay("primary+alt+shift+space", "win"),
		"Ctrl+Alt+Shift+Space",
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
	 * that call site relies on for the shipped four-key chord.
	 */
	assert.equal(
		formatQuickSendTokens("primary+alt+shift+space", "mac").join("+"),
		"⌘+⌥+⇧+Space",
	);
});

/* ------------------------------------------------------------------ *
 * The FRAME's state machine (the restyle's smaller machine)
 * ------------------------------------------------------------------ */

const { MINI_FRAME_INITIAL, miniFrameTransitions } = miniView;

test("a notice is a sentence AND its register", () => {
	const danger = miniFrameTransitions.noted(MINI_FRAME_INITIAL, "Nope.");
	assert.equal(danger.notice.text, "Nope.");
	assert.equal(
		danger.notice.tone,
		"danger",
		"a failure is the default register: the caller only names the quiet one",
	);
	const muted = miniFrameTransitions.noted(
		MINI_FRAME_INITIAL,
		"Context: 12k of 200k tokens.",
		"muted",
	);
	assert.equal(muted.notice.tone, "muted");
});

test("a second sentence replaces the first rather than stacking", () => {
	const first = miniFrameTransitions.noted(MINI_FRAME_INITIAL, "One.");
	const second = miniFrameTransitions.noted(first, "Two.");
	assert.equal(second.notice.text, "Two.");
});

test("the flash goes up with the send and the notice with it", () => {
	const noted = miniFrameTransitions.noted(MINI_FRAME_INITIAL, "Nope.");
	const sent = miniFrameTransitions.sentUp(noted);
	assert.equal(sent.sent, true);
	assert.equal(sent.notice, null);
});

test("a re-summon resets the flash and only the flash", () => {
	const standing = miniFrameTransitions.noted(
		MINI_FRAME_INITIAL,
		"Still refused.",
	);
	const afterSummon = miniFrameTransitions.summoned(standing);
	assert.equal(
		afterSummon.notice,
		standing.notice,
		"a standing notice keeps standing: the failure it names has not changed",
	);
	const flashed = miniFrameTransitions.summoned(
		miniFrameTransitions.sentUp(standing),
	);
	assert.equal(flashed.sent, false);
	assert.equal(
		flashed.notice,
		null,
		"the send cleared the notice; the summon does not resurrect it",
	);
});

test("clearing an absent notice is the same state, by identity", () => {
	assert.equal(
		miniFrameTransitions.clearNotice(MINI_FRAME_INITIAL),
		MINI_FRAME_INITIAL,
	);
});

/* ------------------------------------------------------------------ *
 * The seat's display name (operator directive, 2026-09-29)
 * ------------------------------------------------------------------ */

test("every seat sentence renders the resolved name", () => {
	/*
	 * The rename rule: no literal role in shipped UI, and a rename lands with
	 * no code change. All four spots interpolate the one resolved value.
	 */
	assert.equal(MINI_COPY.seatLabel("Aida"), "To: Aida");
	assert.equal(MINI_COPY.placeholder("Aida"), "Message Aida");
	assert.equal(MINI_COPY.seatUnreachable("Aida"), "Couldn't reach Aida.");
	assert.equal(
		MINI_COPY.postAdmission("Aida"),
		"That didn't reach Aida — check the conversation.",
	);
	assert.ok(
		!MINI_COPY.seatLabel("Nova").includes("chief of staff"),
		"no seat sentence may carry the role as a literal",
	);
});

test("the name resolver falls back on absence AND on a blank", () => {
	/*
	 * `name ?? "Aida"` at the sibling display sites treats an empty string as a
	 * name; over a template that renders "To: " and "Message " — a blank where
	 * the operator asked for a name. The resolver refuses that.
	 */
	assert.equal(resolveSeatName("Aida"), "Aida");
	assert.equal(resolveSeatName("  Nova  "), "Nova");
	assert.equal(resolveSeatName(null), "Aida");
	assert.equal(resolveSeatName(undefined), "Aida");
	assert.equal(resolveSeatName(""), "Aida");
	assert.equal(resolveSeatName("   "), "Aida");
});

/* ------------------------------------------------------------------ *
 * The resize contract (design R2)
 * ------------------------------------------------------------------ */

test("the resize request refuses everything but a finite height", () => {
	assert.equal(isMiniViewResizePayload({ height: 320 }), true);
	assert.equal(isMiniViewResizePayload({ height: Number.NaN }), false);
	assert.equal(isMiniViewResizePayload({ height: "320" }), false);
	assert.equal(isMiniViewResizePayload({}), false);
	assert.equal(isMiniViewResizePayload(null), false);
});

test("the dialog latch payload is a boolean and nothing else", () => {
	assert.equal(isMiniViewDialogPayload({ open: true }), true);
	assert.equal(isMiniViewDialogPayload({ open: false }), true);
	assert.equal(isMiniViewDialogPayload({ open: "yes" }), false);
	assert.equal(isMiniViewDialogPayload({}), false);
});

test("the grown ceiling is above the base and the base is unchanged", () => {
	assert.equal(MINI_VIEW_WIDTH, 640);
	assert.equal(MINI_VIEW_HEIGHT, 168);
	assert.ok(
		MINI_VIEW_MAX_HEIGHT > MINI_VIEW_HEIGHT,
		"a ceiling at the base would make the measured resize a no-op",
	);
});
