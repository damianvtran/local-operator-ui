/**
 * The shared audio engine: one element, one owner, and the AUDIO-SAFETY GUARD
 * every suite that drives it must pass.
 *
 * WHAT THIS FILE PROVES, in the order it matters:
 *
 *  1. **Exclusivity.** Starting sound B stops sound A — whichever surface
 *     started each one — because there is one element and one owner. A TTS press
 *     and a generated sound can no longer overlap, which is the whole reason the
 *     engine exists.
 *  2. **Ownership.** A superseded press cannot claim the slot back (the press
 *     order, re-read after `play()`), and `stop(owner)` from a widget that no
 *     longer owns the element is a no-op, so a stale unmount cannot silence a
 *     newer press.
 *  3. **Detach, not revoke.** `stop()` detaches the source (`removeAttribute` +
 *     `load`) so a caller about to revoke its URL cannot have it re-fetched; URL
 *     lifetime stays with whoever created it.
 *  4. **The safety seam.** `installAudioOutputGraph` routes the element through
 *     a rig's graph at creation, `audioOutputGraphInstalled()` reports it, and a
 *     production process installs nothing.
 *
 * NO SOUND IS EVER PLAYED. This suite injects a fake `Audio` before the engine
 * loads — the engine constructs its element out of `new Audio()` and nothing
 * here has a device path. The guard test at the bottom fails the repository's
 * suites that drive a real element without either a fake or the zero-gain graph,
 * which is the lane's audio-safety rule stated as a check rather than a habit.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/* ------------------------------------------------------------- the fake */

/** Every fake element this file created, in construction order. */
const fakeAudios = [];
class FakeAudio {
	constructor() {
		this.src = null;
		this.played = false;
		this.paused = false;
		this.currentTime = 0;
		this.duration = 0;
		this.volume = 1;
		this.playbackRate = 1;
		this.preload = "";
		this.fastSeeks = [];
		this.onended = null;
		this.onerror = null;
		this.onloadedmetadata = null;
		this.ondurationchange = null;
		this.ontimeupdate = null;
		fakeAudios.push(this);
	}
	play() {
		this.played = true;
		this.paused = false;
		return Promise.resolve();
	}
	pause() {
		this.paused = true;
	}
	removeAttribute(name) {
		if (name === "src") this.src = null;
	}
	load() {}
	/** Chromium's scrub primitive: recorded so a scrub's seeks are visible. */
	fastSeek(seconds) {
		this.fastSeeks.push(seconds);
		this.currentTime = seconds;
	}
	fireEnded() {
		this.onended?.();
	}
	fireError() {
		this.onerror?.();
	}
}
globalThis.Audio = FakeAudio;

/* ------------------------------------------------------------ the bundle */

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/shared/store/audio-engine-store";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	// zustand is BUNDLED, not external: the module is imported from a data: URI,
	// which cannot resolve a bare specifier (ERR_INVALID_URL). The suite drives
	// the store the app ships, not a stand-in.
	loader: { ".css": "empty" },
});
const mod = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const {
	audioEngineElement,
	audioOutputGraphInstalled,
	installAudioOutputGraph,
	useAudioEngineStore,
} = mod;

const engine = () => useAudioEngineStore.getState();
const reset = () => {
	/*
	 * The element is state now (one cell, no private copy), and a reset drops it
	 * so the next `play` goes through `ensure` — the only path that WIRES an
	 * element's events. A test that keeps an element across cases would exercise
	 * its handlers against an element the engine never wired, which is a
	 * test-double artefact rather than product behaviour; the doctored tests
	 * below install their own element deliberately and their own `play`.
	 */
	engine().stop();
	useAudioEngineStore.setState({ element: null });
	fakeAudios.length = 0;
};

/* --------------------------------------------------------- exclusivity */

test("starting a second sound stops the first - whichever surface started it", async () => {
	reset();
	const started = await engine().play("speech:msg:a", "blob:a");
	assert.equal(started, true);
	assert.equal(engine().ownerId, "speech:msg:a");
	assert.equal(engine().status, "playing");
	const first = audioEngineElement();
	assert.equal(first.src, "blob:a");

	/*
	 * A generated sound's press while speech is playing. EXCLUSIVITY IS AN
	 * IDENTITY FACT, not a "the old element paused" fact: there is ONE element,
	 * so the first press's audio cannot outlive its replacement — its source is
	 * detached and re-pointed at the new press before the new one starts. The
	 * paused flag on a shared element is transient (detach pauses, the new
	 * play() resumes the same object), which is exactly why the assertion is
	 * about the source and the owner rather than about `paused`.
	 */
	await engine().play("sound:digest", "blob:b");
	assert.equal(engine().ownerId, "sound:digest");
	assert.equal(
		audioEngineElement(),
		first,
		"the same element carries both presses - that is what makes overlap impossible",
	);
	assert.equal(first.src, "blob:b", "the old press's source is gone");
	assert.equal(
		first.played,
		true,
		"and the one element is playing the new press",
	);
	assert.equal(fakeAudios.length, 1, "no second element was built");
});

test("a superseded press cannot claim the slot back after play() resolves", async () => {
	reset();
	let releaseFirst;
	// A first press whose play() resolves only after the second has started.
	const gated = new Promise((resolve) => {
		releaseFirst = () => resolve();
	});
	const element = new Audio();
	/*
	 * ONLY THE FIRST CALL IS HELD. The engine has one element, so a permanently
	 * gated `play` would hold the SECOND press too and the test would wait on
	 * itself; the point is a slow first start, not a dead element.
	 */
	let held = 0;
	element.play = () => {
		element.played = true;
		element.paused = false;
		if (held === 0) {
			held = 1;
			return gated.then(() => undefined);
		}
		return Promise.resolve();
	};
	// Adopt the doctored element as the engine's one element.
	useAudioEngineStore.setState({ element });
	const firstPress = engine().play("speech:slow", "blob:slow");
	await engine().play("sound:fast", "blob:fast");
	releaseFirst();
	const firstOwned = await firstPress;
	assert.equal(
		firstOwned,
		false,
		"the slow press reports it lost - it does not own the element",
	);
	assert.equal(
		engine().ownerId,
		"sound:fast",
		"the newer press still owns playback",
	);
	assert.equal(
		element.paused,
		false,
		"stale completion must not pause the newer owner",
	);
});

test("stop(owner) from a widget that no longer owns is a no-op", async () => {
	reset();
	await engine().play("sound:b", "blob:b");
	// A row unmounting late, holding the OLD identity, must not silence the
	// sound a reader is listening to.
	engine().stop("sound:a");
	assert.equal(engine().ownerId, "sound:b");
	assert.equal(engine().status, "playing");
	// Its own stop, by contrast, releases the element.
	engine().stop("sound:b");
	assert.equal(engine().ownerId, null);
	assert.equal(engine().status, "idle");
});

/* ---------------------------------------------------------- the detach */

test("stop detaches the source and creates or revokes no URL", async () => {
	reset();
	const created = [];
	const revoked = [];
	const realCreate = URL.createObjectURL;
	// (URL lifetime is the CALLER's, this test asserts the engine never touches it.)
	const realRevoke = URL.revokeObjectURL;
	URL.createObjectURL = () => {
		const url = `blob:test/${created.length}`;
		created.push(url);
		return url;
	};
	URL.revokeObjectURL = (url) => revoked.push(url);
	try {
		await engine().play("sound:x", "blob:x");
		const element = audioEngineElement();
		engine().stop("sound:x");
		assert.equal(element.paused, true, "the element is paused");
		assert.equal(
			element.src,
			null,
			"the source is DETACHED, so a URL the caller revokes cannot be re-fetched",
		);
		assert.deepEqual(created, [], "the engine creates no URL");
		assert.deepEqual(
			revoked,
			[],
			"and revokes none - the lifetime is the caller's",
		);
	} finally {
		URL.createObjectURL = realCreate;
		URL.revokeObjectURL = realRevoke;
	}
});

/* ----------------------------------------------------------- seek/scrape */

test("seek writes an exact position; scrub goes through fastSeek", async () => {
	reset();
	await engine().play("sound:s", "blob:s");
	const element = audioEngineElement();
	element.duration = 10;
	// The engine mirrors duration from the element's metadata events; state it
	// directly, as the element would have.
	useAudioEngineStore.setState({ duration: 10 });

	engine().seek("sound:s", 4.5);
	assert.equal(element.currentTime, 4.5, "a release commits exactly");
	assert.equal(element.fastSeeks.length, 0, "a release is not a coarse seek");

	engine().scrub("sound:s", 2);
	engine().scrub("sound:s", 7);
	assert.deepEqual(
		element.fastSeeks,
		[2, 7],
		"a drag's frames take the scrub primitive",
	);

	// Clamped to the sound's own length; a seek past the end is the end.
	engine().seek("sound:s", 40);
	assert.equal(element.currentTime, 10);
});

test("volume and rate live on the one element, shared by every press", async () => {
	reset();
	await engine().play("sound:v", "blob:v");
	const element = audioEngineElement();
	engine().setVolume(0.25);
	engine().setPlaybackRate(1.5);
	assert.equal(element.volume, 0.25);
	assert.equal(element.playbackRate, 1.5);
	// A second press re-applies them rather than resetting to defaults.
	await engine().play("sound:w", "blob:w");
	assert.equal(element.volume, 0.25);
	assert.equal(element.playbackRate, 1.5);
});

/* ---------------------------------------------------------- the outcomes */

test("the activation's handlers run only while it still owns the element", async () => {
	reset();
	const endedFor = [];
	await engine().play("sound:one", "blob:1", {
		onEnded: () => endedFor.push("one"),
	});
	await engine().play("sound:two", "blob:2", {
		onEnded: () => endedFor.push("two"),
	});
	// ONE element fires ONE ended event: the SECOND activation's handler runs,
	// because the first's was replaced when its press was superseded.
	audioEngineElement().fireEnded();
	assert.deepEqual(endedFor, ["two"]);
	assert.equal(engine().status, "ended");
});

test("a rejected play() settles the error state and runs onError once", async () => {
	reset();
	let errors = 0;
	const element = new Audio();
	element.play = () => Promise.reject(new Error("no decodable source"));
	useAudioEngineStore.setState({ element });
	const owned = await engine().play("sound:bad", "blob:bad", {
		onError: () => {
			errors += 1;
		},
	});
	assert.equal(owned, false);
	assert.equal(engine().status, "error");
	assert.equal(errors, 1);
});

/* ------------------------------------------------------- the safety seam */

test("the output graph is installed at element creation and reported", async () => {
	reset();
	// A production process never installs one: this is the state the app ships.
	assert.equal(audioOutputGraphInstalled(), false);
	const routed = [];
	/*
	 * The rig's graph, in the shape the capture step uses: an
	 * `AudioContext`-routed source into a ZERO gain. The engine only hands the
	 * element over; the graph is the rig's (this test's) business, and the
	 * assertion below is that the element was handed over BEFORE it could play.
	 */
	installAudioOutputGraph((element) => routed.push(element));
	try {
		await engine().play("sound:r", "blob:r");
		assert.equal(routed.length, 1, "the graph saw the one element, once");
		assert.equal(routed[0], audioEngineElement());
		assert.equal(
			audioOutputGraphInstalled(),
			true,
			"the seam reports an installed graph to the capture rig",
		);
	} finally {
		installAudioOutputGraph(null);
	}
	assert.equal(audioOutputGraphInstalled(), false);
});

/* ----------------------------------------------------------- the guard */

/**
 * THE AUDIO-SAFETY GUARD. Any suite in `scripts/` that drives this engine, the
 * speech store, the SoundPlayer or a media component must inject a fake
 * `Audio` (as every suite above does) or install the zero-gain graph. A suite
 * that does neither can play a real, audible element in a headless Electron run
 * — the failure this guard exists to make impossible to land.
 *
 * The check is a source scan for the two accepted controls, deliberately: a
 * runtime guard cannot see "no fake was installed", because the absence is what
 * a real element looks like. The scan is narrow (it names the suites that import
 * these modules) so the rule is visible beside the code it governs.
 */
/*
 * "Drives playback" is a narrow, nameable fact, not "mentions the store": a
 * suite that only reads the engine's types or a fetch helper never builds an
 * element, and flagging it would teach people to add noise to the guard. These
 * are the calls that start sound plus the component modules whose mount
 * resolves and plays one.
 */
/*
 * The trigger is a CALL that starts sound, not a module name: a suite that
 * server-renders `SoundPlayer` (image-gen-card.test.mjs) never constructs an
 * element - there is no engine in an SSR pass - so it has no device path and
 * flagging it would be noise. `useAudioEngineStore` counts because a suite that
 * reaches the store at all can press it.
 *
 * `speak(` CARRIES A RECEIVER EXCLUSION, because the name is not unique to this
 * engine: the Qwen rig's main-process suite calls `voice.speak()` - an IPC
 * method that hands words to the rig's Gateway, in a process with no DOM and no
 * `Audio` - and a bare `.speak(` scan flagged it as an unremediated device path
 * when the two branches folded. The lookbehind keeps the rule exact for the
 * renderer's speech store (`state().speak(`) while leaving the IPC name alone.
 */
const PLAYBACK_CALLS =
	/(\.playSpeech\(|(?<!voice)\.speak\(|\.toggle\(|useAudioEngineStore\s*\.|\.play\(\s*")/;
const FAKE_AUDIO = /globalThis\.Audio\s*=/;
const ZERO_GAIN_GRAPH = /installAudioOutputGraph\s*\(/;

test("every suite that drives audio injects a fake element or the zero-gain graph", () => {
	const offending = [];
	for (const name of readdirSync("scripts")) {
		if (!name.endsWith(".test.mjs") || name === "audio-engine.test.mjs")
			continue;
		const source = readFileSync(`scripts/${name}`, "utf8");
		const drives = PLAYBACK_CALLS.test(source);
		if (!drives) continue;
		if (FAKE_AUDIO.test(source) || ZERO_GAIN_GRAPH.test(source)) continue;
		offending.push(name);
	}
	assert.deepEqual(
		offending,
		[],
		"a suite that drives the audio engine must inject a fake Audio or install the zero-gain graph (no suite may reach the operator's speakers)",
	);
});

for (const action of ["pause", "stop"]) {
	test(`${action} invalidates an awaited start`, async () => {
		reset();
		let settle;
		const element = new Audio();
		element.play = () =>
			new Promise((resolve) => {
				element.paused = false;
				settle = resolve;
			});
		useAudioEngineStore.setState({ element });
		const pending = engine().play("sound:pending", "blob:pending");
		engine()[action]("sound:pending");
		settle();
		assert.equal(await pending, false);
		assert.equal(engine().status, action === "stop" ? "idle" : "paused");
		assert.equal(element.paused, true);
	});
}
test("stale resume rejection cannot poison a newer sound", async () => {
	reset();
	await engine().play("sound:a", "blob:a");
	engine().pause("sound:a");
	const element = engine().element;
	let reject;
	element.play = () =>
		new Promise((_, no) => {
			reject = no;
		});
	const pending = engine().resume("sound:a");
	element.play = () => {
		element.paused = false;
		return Promise.resolve();
	};
	await engine().play("sound:b", "blob:b");
	reject(new Error("superseded"));
	assert.equal(await pending, false);
	assert.equal(engine().status, "playing");
	assert.equal(element.paused, false);
});
for (const other of [false, true]) {
	test(`inactive seek retained without stealing playback: other=${other}`, async () => {
		reset();
		if (other) await engine().play("speech:other", "blob:other");
		engine().seek("sound:idle", 9);
		assert.equal(engine().ownerId, other ? "speech:other" : null);
		await engine().play("sound:idle", "blob:idle");
		assert.equal(engine().element.currentTime, 9);
	});
}
