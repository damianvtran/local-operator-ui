import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The composer cluster's slot model, driven through the shipped module.
 *
 * `composer-slots.ts` is pure, so the whole state matrix (Send, Stop, Steer,
 * the recording trio, the Send-recording hold) is asserted without a browser;
 * the rendered geometry is `scripts/composer-slots-geometry.mjs`'s job. The
 * source assertions at the end pin the places a pure function cannot reach:
 * which element is keyed, and that the failure path never calls the submit.
 */
const bundle = await build({
	stdin: {
		contents: `
			export * from "./src/renderer/src/features/chat/composer-slots";
			export { joinTranscript } from "./src/renderer/src/shared/hooks/use-message-input";
		`,
		resolveDir: process.cwd(),
		loader: "ts",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime"],
	write: false,
});
const bundlePath = new URL(
	`./_composer-slots-${process.pid}.bundle.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const slots = await import(bundlePath.href);
await unlink(bundlePath);
const {
	ROLE_GUARD_MS,
	guardArmedBy,
	slotARole,
	slotBRole,
	slotCRole,
	guardedRole,
	shouldIgnoreRolePress,
	sendRecordingNext,
	dictatedSendCheck,
	joinTranscript,
} = slots;

const base = {
	dictation: "idle",
	alive: false,
	stopping: false,
	hasPayload: false,
	refused: false,
	sendBusy: false,
	sendRecording: "idle",
};
const b = (over) => slotBRole({ ...base, ...over });

/* ------------------------------------------------------------ slot B matrix */

test("idle: Send is always the occupant of slot B, disabled while the box is empty", () => {
	assert.deepEqual(b({}), { role: "send", enabled: false });
	assert.deepEqual(b({ hasPayload: true }), { role: "send", enabled: true });
});

test("a refused box (no provider, no model, input disabled) disables Send with text in it", () => {
	assert.deepEqual(b({ hasPayload: true, refused: true }), {
		role: "send",
		enabled: false,
	});
});

test("working with an empty box shows Stop and nothing else: Send is never drawn beside it", () => {
	assert.deepEqual(b({ alive: true }), { role: "stop", enabled: true });
	// One role per slot by construction: the function returns ONE role.
	assert.equal(Object.keys(b({ alive: true })).length, 2);
});

test("working with text shows Steer, enabled; Stop is then Esc-only", () => {
	assert.deepEqual(b({ alive: true, hasPayload: true }), {
		role: "steer",
		enabled: true,
	});
});

test("an attachment alone is a payload, so it flips Stop to Steer", () => {
	// `hasPayload` is the composer's `text.trim() || attachments.length`; the
	// function only sees the boolean, which is the whole point of passing it.
	assert.equal(b({ alive: true, hasPayload: true }).role, "steer");
});

test("a pressed Stop stays Stop (inert) even when text is typed meanwhile", () => {
	assert.deepEqual(b({ alive: true, stopping: true }), {
		role: "stop-busy",
		enabled: false,
	});
	assert.deepEqual(b({ alive: true, stopping: true, hasPayload: true }), {
		role: "stop-busy",
		enabled: false,
	});
});

test("a send in flight with the box emptied holds the slot (no flip to Stop under a double click)", () => {
	assert.deepEqual(b({ alive: true, sendBusy: true }), {
		role: "connecting",
		enabled: false,
	});
	assert.deepEqual(b({ sendBusy: true }), {
		role: "connecting",
		enabled: false,
	});
	// With new text typed the Send stays live, so a second press reaches the
	// pane's own "still sending" lock rather than being swallowed.
	assert.equal(b({ sendBusy: true, hasPayload: true }).role, "send");
});

test("a transcribing take disables Send even with text (the submit path refuses it too)", () => {
	assert.deepEqual(b({ dictation: "transcribing", hasPayload: true }), {
		role: "send",
		enabled: false,
	});
	assert.deepEqual(
		b({ dictation: "transcribing", hasPayload: true, alive: true }),
		{ role: "steer", enabled: false },
	);
});

test("working + transcribing + empty is still Stop: Esc and the pointer can end the turn", () => {
	assert.deepEqual(b({ dictation: "transcribing", alive: true }), {
		role: "stop",
		enabled: true,
	});
});

test("preparing leaves slot B alone", () => {
	assert.equal(b({ dictation: "preparing" }).role, "send");
	assert.equal(b({ dictation: "preparing", alive: true }).role, "stop");
});

/* ----------------------------------------------------- recording and slot A/C */

test("recording is the trio [Insert][Cancel][Send recording], Insert and Cancel in main's own order, whatever the turn is doing", () => {
	for (const alive of [false, true]) {
		for (const hasPayload of [false, true]) {
			const rec = b({ dictation: "recording", alive, hasPayload });
			assert.equal(rec.role, "send-recording");
			// Cancel keeps the mic's own spot (A); Insert is the box added on the left (C).
			assert.equal(slotARole("recording"), "cancel");
			assert.equal(slotCRole("recording"), "confirm");
		}
	}
});

test("a turn's Stop is unreachable by pointer while recording (Esc cancels the take first)", () => {
	assert.notEqual(
		b({ dictation: "recording", alive: true, stopping: true }).role,
		"stop-busy",
	);
});

test("slot C exists only while recording", () => {
	for (const phase of ["idle", "preparing", "transcribing"]) {
		assert.equal(slotCRole(phase), null);
	}
});

test("slot A: mic, preparing mic, spinner while transcribing, Cancel while recording", () => {
	assert.equal(slotARole("idle"), "mic");
	assert.equal(slotARole("preparing"), "mic-preparing");
	assert.equal(slotARole("transcribing"), "spinner");
	assert.equal(slotARole("recording"), "cancel");
});

test("Send recording is refused exactly when a normal Send would be", () => {
	assert.equal(
		b({ dictation: "recording", refused: true }).enabled,
		false,
		"no provider / no model / input disabled",
	);
	assert.equal(b({ dictation: "recording" }).enabled, true);
	assert.equal(
		b({ dictation: "recording", reviewRequired: true }).enabled,
		false,
		"a masked capture is open: dictated words are never sent unreviewed",
	);
	assert.equal(
		b({ dictation: "recording", sendBusy: true }).enabled,
		false,
		"another send of this composer is mid-clear: the transcript would be parked, not boxed",
	);
});

/* ------------------------------------------------ the Send-recording hold */

test("from the press until the submit settles, slot B holds the static Send-recording face and NEVER Stop", () => {
	for (const phase of [
		"awaiting-transcript",
		"ready-to-submit",
		"submitting",
	]) {
		for (const alive of [false, true]) {
			for (const dictation of [
				"idle",
				"transcribing",
				"recording",
				"preparing",
			]) {
				// The box is empty at the press (the words are not in yet) and again
				// after the submit clears it: exactly the state that would show Stop.
				for (const hasPayload of [false, true]) {
					const got = b({ sendRecording: phase, alive, dictation, hasPayload });
					assert.deepEqual(got, {
						role: "send-recording-busy",
						enabled: false,
					});
				}
			}
		}
	}
});

test("slot A is inert for the same span, so a second take cannot start over the one being sent", () => {
	for (const phase of [
		"awaiting-transcript",
		"ready-to-submit",
		"submitting",
	]) {
		assert.equal(slotARole("idle", phase), "spinner");
	}
	assert.equal(slotARole("idle", "idle"), "mic");
});

test("the phase machine: press -> transcript -> check -> submit -> settled", () => {
	let p = "idle";
	p = sendRecordingNext(p, { type: "press" });
	assert.equal(p, "awaiting-transcript");
	p = sendRecordingNext(p, { type: "transcript", usable: true });
	assert.equal(p, "ready-to-submit");
	p = sendRecordingNext(p, { type: "checked", draftIntact: true });
	assert.equal(p, "submitting");
	// Still sending: the hold persists.
	p = sendRecordingNext(p, { type: "settled", sendBusy: true });
	assert.equal(p, "submitting");
	p = sendRecordingNext(p, { type: "settled", sendBusy: false });
	assert.equal(p, "idle");
});

test("a second press while the step is in flight changes nothing", () => {
	for (const phase of [
		"awaiting-transcript",
		"ready-to-submit",
		"submitting",
	]) {
		assert.equal(sendRecordingNext(phase, { type: "press" }), phase);
	}
});

test("FAILURE: an error, an empty transcript or an aborted burst ends the step with nothing sent", () => {
	const afterFailure = sendRecordingNext("awaiting-transcript", {
		type: "transcript",
		usable: false,
	});
	assert.equal(afterFailure, "idle");
	// And it can never reach `submitting` from there.
	assert.equal(
		sendRecordingNext(afterFailure, { type: "checked", draftIntact: true }),
		"idle",
	);
	// The slot is back to a plain Send/Stop role: the hold has been released.
	assert.notEqual(b({ sendRecording: afterFailure }).role, "connecting");
});

test("FAILURE: a take discarded before any request (too short, cancelled) releases the hold", () => {
	assert.equal(
		sendRecordingNext("awaiting-transcript", { type: "discarded" }),
		"idle",
	);
	// A discard that arrives late cannot undo a submit already under way.
	assert.equal(
		sendRecordingNext("submitting", { type: "discarded" }),
		"submitting",
	);
});

test("FAILURE: words typed while the transcript was in flight send nothing", () => {
	const phase = sendRecordingNext("ready-to-submit", {
		type: "checked",
		draftIntact: false,
	});
	assert.equal(phase, "idle");
});

test("a stray transcript or check outside its phase is ignored", () => {
	assert.equal(
		sendRecordingNext("idle", { type: "transcript", usable: true }),
		"idle",
	);
	assert.equal(
		sendRecordingNext("idle", { type: "checked", draftIntact: true }),
		"idle",
	);
	assert.equal(
		sendRecordingNext("awaiting-transcript", {
			type: "checked",
			draftIntact: true,
		}),
		"awaiting-transcript",
	);
});

/* --------------------------------------------- draft intact, transcript joined */

test("the check expects the draft at the press joined with the transcript, as Confirm's append does", () => {
	const ok = dictatedSendCheck({
		draftAtPress: "fix the build",
		transcript: "and rerun the tests",
		current: "fix the build and rerun the tests",
		join: joinTranscript,
	});
	assert.equal(ok.intact, true);
	assert.equal(ok.expected, "fix the build and rerun the tests");
	// An empty draft takes the transcript alone.
	assert.equal(
		dictatedSendCheck({
			draftAtPress: "",
			transcript: "hello",
			current: "hello",
			join: joinTranscript,
		}).intact,
		true,
	);
});

test("any edit during the wait fails the check, whether a keystroke, a paste or a restore", () => {
	for (const current of [
		"fix the build and rerun the tests!",
		"fix the build",
		"",
		"something else entirely and rerun the tests",
	]) {
		assert.equal(
			dictatedSendCheck({
				draftAtPress: "fix the build",
				transcript: "and rerun the tests",
				current,
				join: joinTranscript,
			}).intact,
			false,
			JSON.stringify(current),
		);
	}
});

/* --------------------------------------------------------------------- guard */

test("only the destructive or sending roles are guarded; the mic and a plain Send are not", () => {
	for (const role of ["stop", "cancel", "confirm", "send-recording"]) {
		assert.equal(guardedRole(role), role);
	}
	for (const role of [
		"mic",
		"mic-preparing",
		"spinner",
		"send",
		"steer",
		"stop-busy",
		"connecting",
		"send-recording-busy",
	]) {
		assert.equal(guardedRole(role), null, role);
	}
});

test("a pointer press inside the window after arrival is ignored; at the edge and after it is not", () => {
	const at = 1000;
	const press = (dt, detail = 1) =>
		shouldIgnoreRolePress({ arrivedAt: at, now: at + dt, detail });
	assert.equal(ROLE_GUARD_MS, 500);
	assert.equal(press(0), true);
	assert.equal(press(170), true, "the measured 120-170 ms reflex re-press");
	assert.equal(press(499), true);
	assert.equal(press(500), false);
	assert.equal(press(2000), false);
});

test("STOP IS ARMED ONLY WHEN A SEND PUT IT THERE; the recording roles always are", () => {
	// A Send press empties the box, so the slot passes through Connecting.
	assert.equal(guardArmedBy("stop", "connecting"), true);
	assert.equal(guardArmedBy("stop", "send-recording-busy"), true);
	// The user cleared the box, or a turn started elsewhere: nothing was pressed.
	assert.equal(guardArmedBy("stop", "send"), false);
	assert.equal(guardArmedBy("stop", "steer"), false);
	assert.equal(guardArmedBy("stop", null), false);
	for (const role of ["cancel", "confirm", "send-recording"]) {
		assert.equal(guardArmedBy(role, "mic"), true, role);
		assert.equal(guardArmedBy(role, null), true, role);
	}
	assert.equal(guardArmedBy("mic", "spinner"), false);
	assert.equal(guardArmedBy("send", "connecting"), false);
});

test("a keyboard activation (detail 0) is never guarded", () => {
	assert.equal(
		shouldIgnoreRolePress({ arrivedAt: 1000, now: 1001, detail: 0 }),
		false,
	);
});

test("a role that never arrived (first mount) is not guarded", () => {
	assert.equal(
		shouldIgnoreRolePress({ arrivedAt: null, now: 5, detail: 1 }),
		false,
	);
});

/* --------------------------------------------------- what the source must keep */

const ROW_SOURCE = readFileSync(
	"src/renderer/src/shared/components/composer/message-input.tsx",
	"utf8",
);

test("DOM order is visual order: Insert, then the mic/spinner/Cancel spot, then slot B's roles", () => {
	const at = (needle) => {
		const i = ROW_SOURCE.indexOf(needle);
		assert.ok(i > -1, `missing ${needle}`);
		return i;
	};
	const confirm = at('slotC === "confirm" && (');
	const cancel = at('slotA === "cancel" && (');
	const sendRec = at('(slotB.role === "send-recording" ||');
	const connecting = at('slotB.role === "connecting" && (');
	const stop = at('slotB.role === "stop-busy") &&');
	const send = at('(slotB.role === "send" || slotB.role === "steer") &&');
	const mic = at('(slotA === "mic" || slotA === "mic-preparing")');
	assert.ok(confirm < mic, "Insert is the leftmost box, before the mic's spot");
	assert.ok(mic < cancel, "Cancel stands where the mic did");
	assert.ok(cancel < sendRec, "Cancel is left of Send recording");
	assert.ok(sendRec < connecting && connecting < stop && stop < send);
});

test("every role is its own keyed element, so a press cannot complete on another role", () => {
	for (const key of [
		"mic",
		"spinner",
		"cancel",
		"confirm",
		"send-recording",
		"connecting",
		"stop",
	]) {
		assert.match(ROW_SOURCE, new RegExp(`key="${key}"`), key);
	}
	assert.match(ROW_SOURCE, /key=\{slotB\.role\}/);
});

/**
 * One control's own source: from its `key="<k>"` to the next role's key. Slicing
 * by block is what makes the assertions below able to fail - a fixed-width
 * window from the key does not reach the button's `onClick` (measured: the mic's
 * is 1000+ characters on).
 */
const KEYS = [
	"mic",
	"spinner",
	"cancel",
	"confirm",
	"send-recording",
	"connecting",
	"stop",
];
const block = (key) => {
	const from = ROW_SOURCE.indexOf(`key="${key}"`);
	assert.ok(from > -1, `no key="${key}"`);
	const next = KEYS.map((k) => ROW_SOURCE.indexOf(`key="${k}"`))
		.filter((i) => i > from)
		.sort((x, y) => x - y)[0];
	// The last role (stop) is followed by the legacy Stop agent and Send arms.
	const end =
		next ?? ROW_SOURCE.indexOf("{isLoading && currentJobId && (", from);
	return ROW_SOURCE.slice(from, end);
};

test("the recording roles and Stop go through the guard; the mic and the busy faces do not", () => {
	const guards = {
		cancel: "ignoreCancelPress(event.detail)",
		confirm: "ignoreConfirmPress(event.detail)",
		"send-recording": "ignoreSlotBPress(event.detail)",
		stop: "ignoreSlotBPress(event.detail)",
	};
	for (const [key, guard] of Object.entries(guards)) {
		assert.ok(block(key).includes(guard), `${key} must call ${guard}`);
	}
	for (const key of ["mic", "spinner", "connecting"]) {
		assert.doesNotMatch(block(key), /ignore\w+Press/, `${key} is not guarded`);
	}
});

test("an ignored press never sets `disabled` on a guarded role (the button keeps focus)", () => {
	// Send recording is `disabled` only by the refusal a plain Send also obeys.
	for (const key of ["cancel", "confirm", "stop"]) {
		assert.doesNotMatch(
			block(key),
			/\bdisabled=/,
			`${key} must not be disabled`,
		);
	}
	const sendRec = block("send-recording");
	assert.match(
		sendRec,
		/disabled=\{\s*!slotB\.enabled &&\s*slotB\.role !== "send-recording-busy"\s*\}/,
	);
	assert.doesNotMatch(sendRec, /disabled=\{[^}]*Arming/);
});

test("a guarded role that is still arming wears a ramp, not a disabled look", () => {
	for (const [key, flag] of [
		["cancel", "cancelArming"],
		["confirm", "confirmArming"],
		["stop", "slotBArming"],
		["send-recording", "slotBArming"],
	]) {
		assert.match(
			block(key),
			new RegExp(`${flag} && "opacity-72"|${flag}\\) &&`),
			key,
		);
	}
});

test("Enter on a focused cluster button keeps its own meaning (UX U2)", () => {
	const at = ROW_SOURCE.indexOf("A FOCUSED CLUSTER BUTTON KEEPS ITS OWN ENTER");
	assert.ok(at > -1, "the Enter handler's focus exception is gone");
	const win = ROW_SOURCE.slice(at, at + 1200);
	assert.match(win, /closest\("\[data-lo-composer-controls\] button"\)/);
	assert.ok(win.indexOf("closest(") < win.indexOf("handleConfirmRecording()"));
});

test("M1: a dictated transcript that would answer a gate is never sent, and the check precedes every send", () => {
	const run = ROW_SOURCE.slice(
		ROW_SOURCE.indexOf("const runSubmit = (dictated = false)"),
		ROW_SOURCE.indexOf("const handleSubmit = (e: FormEvent)"),
	);
	const gate = run.search(
		/dictated &&\s*awaitingAnswer &&\s*dictatedWouldAnswerGate\(newMessage\)\s*\)\s*return false/,
	);
	assert.ok(gate > -1, "the gate refusal is gone from runSubmit");
	// Every way out of runSubmit that sends or arms a send sits AFTER the refusal.
	for (const sender of ["submitCapture()", "applyPlan(", "submitMessage()"]) {
		const at = run.indexOf(sender);
		assert.ok(at > -1, `runSubmit no longer calls ${sender}`);
		assert.ok(gate < at, `the gate refusal must precede ${sender}`);
	}
});

test("what a dictated transcript may not say while a question is pending: approval words AND bare option ordinals", () => {
	const answers = [
		"yes",
		"OK",
		"Allow",
		"deny",
		"cancel",
		"1",
		"2.",
		" 3 ",
		"9",
	];
	for (const text of answers) {
		assert.equal(slots.dictatedWouldAnswerGate(text), true, text);
	}
	// Prose, a partial token, an out-of-the-ordinal-range digit, empty: not a decision.
	for (const text of [
		"yes please summarise the report",
		"okay then",
		"10",
		"0",
		"two",
		"",
	]) {
		assert.equal(slots.dictatedWouldAnswerGate(text), false, text);
	}
});

test("a recorder that already died cannot park the slot: the press settles instead of entering the phase", () => {
	const press = ROW_SOURCE.slice(
		ROW_SOURCE.indexOf("const handleSendRecording = useCallback"),
		ROW_SOURCE.indexOf("const endDictatedSend"),
	);
	assert.ok(
		press.indexOf('mediaRecorderRef.current?.state !== "recording"') > -1 &&
			press.indexOf('mediaRecorderRef.current?.state !== "recording"') <
				press.indexOf("dictatedSendRef.current = {"),
		"the dead-recorder exit precedes entering the phase",
	);
});

test("the recording hint line names the irreversible action (UX U3)", () => {
	// Offered only while the control exists and works: a hint naming a button
	// that is disabled (no provider, credential capture) would promise a send
	// the press will not make.
	assert.match(
		ROW_SOURCE,
		/sendsNow=\{slotB\.role === "send-recording" && slotB\.enabled\}/,
	);
	const indicator = readFileSync(
		"src/renderer/src/features/chat/components/audio-recording-indicator.tsx",
		"utf8",
	);
	assert.match(indicator, /ui\.chat\.composer_media\.sends_now/);
});

test("one send glyph for the primary slot, and one spinner for a send-recording wait (design D1, D3)", () => {
	assert.doesNotMatch(ROW_SOURCE, /<ArrowUp\b/);
	const sendRec = block("send-recording");
	assert.match(sendRec, /<Send aria-hidden="true" \/>/);
	assert.doesNotMatch(sendRec, /<Spinner/);
	assert.match(block("spinner"), /<Spinner/);
	// B's name stays the control's own, busy, until the submit starts (D2/U4).
	assert.match(sendRec, /ui\.chat\.composer\.send_recording"/);
	assert.match(
		sendRec,
		/aria-busy=\{\s*slotB\.role === "send-recording-busy" \|\| undefined\s*\}/,
	);
});

test("FAILURE PATH: the only call that submits a dictated message sits behind the intact check", () => {
	const submits = [...ROW_SOURCE.matchAll(/runSubmitRef\.current\(true\)/g)];
	assert.equal(submits.length, 1, "one door for a dictated send");
	const at = submits[0].index;
	const window_ = ROW_SOURCE.slice(at - 900, at + 100);
	assert.match(window_, /dictatedSendCheck\(/);
	assert.match(window_, /intact \? runSubmitRef\.current\(true\)/);
	// Every failure arm of the transcription ends the step instead of submitting.
	const send = ROW_SOURCE.slice(
		ROW_SOURCE.indexOf("const handleSendAudio = useCallback"),
		ROW_SOURCE.indexOf("const retryDictation"),
	);
	assert.ok(
		(send.match(/endDictatedSend\(\)/g) ?? []).length >= 3,
		"empty transcript, aborted burst and error each end the step",
	);
	assert.doesNotMatch(send, /runSubmit/, "transcription itself never submits");
});

test("the dictated door closes the three paths that would run the words as something else", () => {
	const run = ROW_SOURCE.slice(
		ROW_SOURCE.indexOf("const runSubmit = (dictated = false)"),
		ROW_SOURCE.indexOf("const handleSubmit = (e: FormEvent)"),
	);
	assert.match(run, /dictated && isTyping\(capture\)\) return false/);
	assert.match(run, /if \(dictated\) return false;\s*\n\s*void applyPlan/);
	assert.match(run, /dictated\) \{\s*\n\s*if \(secretAsk && looksLikeSecret/);
});

test("the held box and its reservation are gone from the tree", () => {
	assert.doesNotMatch(
		ROW_SOURCE,
		/interruptSlotDrawn|useInterruptSlotHold|data-interrupt-slot/,
	);
	assert.match(ROW_SOURCE, /const controlsThirdBox = isRecording;/);
});

test("Q1/R2-1/D9/D14: the press opens the recording lane at its final height; the words are in its label row, not in the controls row or a row of their own", () => {
	const lane = readFileSync(
		"src/renderer/src/features/chat/components/audio-recording-indicator.tsx",
		"utf8",
	);
	// The words live in the lane's label row, as a live region.
	const at = lane.indexOf('data-preparing-indicator=""');
	assert.ok(at > -1, "the preparing sentence is gone from the lane");
	assert.ok(lane.lastIndexOf("<output", at) > lane.indexOf("preparing ?"));
	// The preparing lane is the recording lane's own block: same wrapper, same
	// waveform height (the empty box takes the canvas's class), so nothing moves
	// at the handover.
	assert.match(
		lane,
		/preparing \? \(\s*\/\/[\s\S]*?<div className=\{WAVEFORM_CLASS\} \/>/,
	);
	// The host opens that block from the press, and has no row of its own for it.
	assert.match(
		ROW_SOURCE,
		/\(isRecording \|\| \(isPreparing && micControlShown\)\) && \(\s*<AudioRecordingIndicator/,
	);
	assert.doesNotMatch(
		ROW_SOURCE,
		/<output\s+data-preparing-indicator/,
		"no caption row of its own for the press",
	);
	// And it never returns to the controls row.
	const cluster = ROW_SOURCE.indexOf("data-lo-composer-controls={true}");
	assert.ok(ROW_SOURCE.indexOf("preparingLabel=") < cluster);
	assert.match(
		ROW_SOURCE,
		/className="ms-auto flex order-3 shrink-0 items-center gap-1"/,
	);
});

test("the comment that claimed a press costs 0px is gone; the file states one height change", () => {
	assert.doesNotMatch(ROW_SOURCE, /costs the composer exactly 0px/);
	assert.doesNotMatch(ROW_SOURCE, /NO PREPARING STRIP IN THIS SLOT/);
	assert.match(
		ROW_SOURCE.replace(/\s*\n\s*\*\s*/g, " "),
		/press costs ONE height change/,
	);
	const idx = ROW_SOURCE.indexOf("It is not 0px");
	assert.ok(idx > -1, "the retired 0px claim is recorded as retired");
});

test("D13: a send-recording wait has one live element - the waveform is dropped from the caption", () => {
	const at = ROW_SOURCE.indexOf('data-transcribing-indicator=""');
	const row = ROW_SOURCE.slice(at, at + 1500);
	assert.match(row, /sendRecordingPhase === "idle" && <WaveformAnimation \/>/);
});

test("the guard ramp is the one opacity (0.72), above the 0.6 that fell under 3:1 in light (design D11)", () => {
	assert.doesNotMatch(ROW_SOURCE, /opacity-60/);
	assert.ok((ROW_SOURCE.match(/opacity-72/g) ?? []).length >= 4);
});

test("the field re-measures in the commit that opens the lane, so one press is one height change (design D14)", () => {
	assert.match(
		ROW_SOURCE,
		/\}, \[newMessage, textareaRef, isRecording, isTranscribing, isPreparing\]\);/,
	);
});
