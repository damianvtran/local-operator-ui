#!/usr/bin/env node
/**
 * The mini view's SEND SIDE after the shared-composer restyle: the one speech
 * stack, the wire half of the input-mode stamp, and the frame's two new pure
 * seams.
 *
 * WHAT THIS FILE USED TO BE, and why it is smaller. Before the restyle the mini
 * view carried its OWN dictation controller (`mini-dictation.ts`) beside the
 * composer's, and this file drove that controller against the real shared
 * manager — the release semantics, the minimum-clip discard, the abort door.
 * The operator's directive retired the duplicate: the mini mounts the SHARED
 * composer (`@shared/components/composer`), whose own registration with
 * `use-speech-to-text-manager.ts` is the app's one dispatch — push-to-talk
 * included — so there is no mini controller left to drive. What remains here is
 * the half that is still the mini's:
 *
 *   1. ONE STACK, PROVEN BY ABSENCE: the mini document has no dictation module
 *      and no `SpeechToTextManager` of its own; the frame mounts the shared
 *      composer and reads the composer's `onDictationStateChange` for the
 *      guards only the frame owns (blur, the compact sheet).
 *   2. the stamp's wire half at the desktop contract's own body builder:
 *      capability off keeps the legacy body (`input_mode` absent — the field an
 *      older harness's `extra="forbid"` would refuse), capability on carries
 *      the exact value. The derivation itself lives in the shared composer
 *      (`inputModeForSend`) and is driven by the chat's own suites.
 *   3. the frame's two new pure seams: the measured-resize request's guard and
 *      the draft-store sync's adopt predicate (risk R5) — both driven here in
 *      process, the same discipline the contract suite uses.
 *
 * WHAT IT IS NOT: a real microphone, a real daemon, or the React call site
 * itself — this host has no renderer, so the frame's mount is pinned by source
 * (the shape the window-mode scans use for their unreachable halves) and the
 * pixel-level half belongs to `--scene mini-view`.
 */
import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

/*
 * Source pins, hoisted to module scope the way this tree's lint wants every
 * regex that is not a one-shot (useTopLevelRegex).
 */
const FRAME_IMPORTS_SHARED_COMPOSER = /@shared\/components\/composer/;
const FRAME_MOUNTS_COMPOSER = /<MessageInput/;
const FRAME_READS_DICTATION_STATE = /onDictationStateChange=/;
const FRAME_OWNS_NO_STACK = /new SpeechToTextManager|useSpeechToTextManager\(/;
const DIALOG_LATCH = /onDialog/;

const bundleDir = join(
	process.cwd(),
	"node_modules",
	".tmp",
	`mini-send-tests-${process.pid}`,
);
mkdirSync(bundleDir, { recursive: true });

after(() => {
	rmSync(bundleDir, { recursive: true, force: true });
});

/*
 * The two pure seams, bundled from source with esbuild so what runs is the code
 * that ships. Both are import-light by construction, which is itself part of
 * what this file leans on: a helper that pulled a window in could not be driven
 * here.
 */
const seamsBundle = await build({
	stdin: {
		contents: [
			'export * from "./src/shared/mini-view";',
			'export * from "./src/renderer/src/shared/store/conversation-input-sync";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const seamsFile = join(bundleDir, "mini-seams.mjs");
writeFileSync(seamsFile, seamsBundle.outputFiles[0].text);
const seams = await import(pathToFileURL(seamsFile).href);

const contractBundle = await build({
	stdin: {
		contents:
			'export { desktopEndpoint } from "./src/shared/desktop-contract";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const contractFile = join(bundleDir, "desktop-contract.mjs");
writeFileSync(contractFile, contractBundle.outputFiles[0].text);
const { desktopEndpoint } = await import(pathToFileURL(contractFile).href);

const { isMiniViewResizePayload, shouldAdoptStorageWrite } = seams;

/* ---------------------------------------------------------------- *
 * One speech stack, proven by absence
 * ---------------------------------------------------------------- */

test("the mini carries no dictation module of its own", () => {
	/*
	 * The duplicate this restyle retired. Its absence is the assertion: a second
	 * controller beside the composer's is exactly the parallel stack the
	 * directive forbids, and a file that came back would have to delete this
	 * test deliberately.
	 */
	assert.equal(
		existsSync(
			join(process.cwd(), "src/renderer/src/mini-view/mini-dictation.ts"),
		),
		false,
		"the mini's own controller was absorbed by the shared composer",
	);
});

test("the mini frame mounts the shared composer and owns no second dispatch", () => {
	/*
	 * No renderer host here, so the mount is pinned as the shipped bytes: the
	 * frame must reach the SHARED component (not a local copy), must read the
	 * composer's dictation-state callback for its own guards, and must install
	 * no manager of its own — the shared composer's registration is the one
	 * stack, and a second one in this file would be the drift the test above
	 * guards from the other side.
	 */
	const frame = readFileSync(
		join(process.cwd(), "src/renderer/src/mini-view/mini-composer.tsx"),
		"utf8",
	);
	assert.match(frame, FRAME_IMPORTS_SHARED_COMPOSER);
	assert.match(frame, FRAME_MOUNTS_COMPOSER);
	assert.match(
		frame,
		FRAME_READS_DICTATION_STATE,
		"the frame's blur and Esc guards defer to a live take through the composer's callback",
	);
	assert.doesNotMatch(
		frame,
		FRAME_OWNS_NO_STACK,
		"the frame installs no dispatch of its own",
	);
});

test("the frame latches on the native dialog rather than hiding under it", () => {
	/*
	 * Risk R3: the composer's attach button opens the file picker, macOS moves
	 * focus to it, and the frame's blur guard hides the window its own dialog
	 * belongs to. The latch is the fix, and it must be wired.
	 */
	const frame = readFileSync(
		join(process.cwd(), "src/renderer/src/mini-view/mini-composer.tsx"),
		"utf8",
	);
	assert.match(frame, DIALOG_LATCH);
});

/* ---------------------------------------------------------------- *
 * The stamp's wire half
 * ---------------------------------------------------------------- */

test("the wire body: the legacy shape when off, the exact stamp when on", () => {
	const bodyFor = (inputMode) =>
		desktopEndpoint({
			op: "sessions.message",
			sessionId: "11111111-1111-1111-1111-111111111111",
			requestId: "r-mini-1",
			text: "hello",
			images: [],
			mode: "prompt",
			inputMode,
		}).body;
	const legacy = bodyFor(undefined);
	assert.equal(
		Object.hasOwn(legacy, "input_mode"),
		false,
		"feature off: the key is ABSENT, not present-and-empty",
	);
	for (const value of ["typed", "dictated", "mixed"]) {
		assert.equal(bodyFor(value).input_mode, value);
	}
});

/* ---------------------------------------------------------------- *
 * The frame's two new pure seams
 * ---------------------------------------------------------------- */

test("the resize request refuses everything but a finite height", () => {
	assert.equal(isMiniViewResizePayload({ height: 320 }), true);
	assert.equal(isMiniViewResizePayload({ height: Number.NaN }), false);
	assert.equal(
		isMiniViewResizePayload({ height: Number.POSITIVE_INFINITY }),
		false,
	);
	assert.equal(isMiniViewResizePayload({ height: "320" }), false);
	assert.equal(isMiniViewResizePayload({}), false);
	assert.equal(isMiniViewResizePayload(null), false);
});

test("the draft sync adopts another document's write only while unfocused", () => {
	/*
	 * Risk R5's safety argument, driven directly: an event for ANOTHER key is
	 * never adopted, and neither is one that arrives while this document holds
	 * focus — which is what keeps an in-flight keystroke from being replaced by
	 * a copy written before it. The hidden mini (unfocused) adopts; the window
	 * the user is typing in never does.
	 */
	assert.equal(
		shouldAdoptStorageWrite({
			eventKey: "conversation-input-store",
			storeKey: "conversation-input-store",
			focused: false,
		}),
		true,
		"an unfocused document absorbs the other writer's copy",
	);
	assert.equal(
		shouldAdoptStorageWrite({
			eventKey: "conversation-input-store",
			storeKey: "conversation-input-store",
			focused: true,
		}),
		false,
		"a focused document is the one being typed in: it never absorbs",
	);
	assert.equal(
		shouldAdoptStorageWrite({
			eventKey: "some-other-store",
			storeKey: "conversation-input-store",
			focused: false,
		}),
		false,
		"another key's write is not this store's",
	);
});
