import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

// Real-path tests for the LOH-13 slice C chrome gaps: per-tab mute, human
// print, and human-initiated downloads. Each suite bundles the actual main
// module it exercises (the browser-page-controls.test.mjs pattern) and drives
// it with fake webContents/download items whose shapes are the subsets those
// modules read — no Electron launch, and no assertion about a module that
// was not loaded.

async function load(entry) {
	const bundle = await build({
		entryPoints: [entry],
		bundle: true,
		platform: "node",
		format: "esm",
		write: false,
	});
	return import(
		`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
	);
}

const { PageControls } = await load("src/main/browser/page-controls.ts");
const { TabAudioTracker } = await load("src/main/browser/tab-audio.ts");
const { DownloadArmer } = await load("src/main/browser/downloads.ts");

function fakeWebContents() {
	const wc = new EventEmitter();
	let audible = false;
	let muted = false;
	let printCall = null;
	Object.assign(wc, {
		isDestroyed: () => false,
		isCurrentlyAudible: () => audible,
		isAudioMuted: () => muted,
		setAudioMuted: (value) => {
			muted = value;
		},
		print: (options, callback) => {
			printCall = { options, callback };
		},
		getZoomFactor: () => 1,
		setZoomFactor: () => {},
		stopFindInPage: () => {},
	});
	return {
		wc,
		// THE REAL ELECTRON 44.3.0 SHAPE: `audio-state-changed` delivers ONE
		// argument, and the params live ON THE EVENT it carries
		// (`listener: (event: Event<WebContentsAudioStateChangedEventParams>)`,
		// `{audible: boolean}`). Emitting the two-argument shape here is what
		// let the earlier source bug (reading the second argument) pass this
		// test: with `{}` first and the params second, the buggy read saw
		// `params?.audible` and the corrected read saw nothing — the test now
		// discriminates by emitting exactly what Electron emits, so it FAILS on
		// the two-argument read and passes on the one-argument read.
		setAudible: (value) => {
			audible = value;
			wc.emit("audio-state-changed", { audible: value });
		},
		printCall: () => printCall,
	};
}

function fakeTab(id, wc) {
	return {
		tabId: id,
		owner: "user",
		handedTo: null,
		presented: true,
		documentEpoch: 1,
		view: { webContents: wc },
	};
}

test("mute: audio state is per-tab, event-driven, and setMuted lands on the named tab only", () => {
	let changed = 0;
	const tracker = new TabAudioTracker(() => changed++);
	const a = fakeWebContents();
	const b = fakeWebContents();
	const tabA = fakeTab(1, a.wc);
	const tabB = fakeTab(2, b.wc);
	assert.deepEqual(tracker.stateFor(tabA), { audible: false, muted: false });
	a.setAudible(true);
	assert.deepEqual(tracker.stateFor(tabA), { audible: true, muted: false });
	assert.deepEqual(tracker.stateFor(tabB), { audible: false, muted: false });
	assert.equal(changed, 1, "the audio event pushes a projection change");
	const result = tracker.setMuted(tabA, true);
	assert.deepEqual(result, { audible: true, muted: true });
	assert.equal(a.wc.isAudioMuted(), true);
	assert.equal(
		b.wc.isAudioMuted(),
		false,
		"muting one tab must not mute another",
	);
	assert.deepEqual(tracker.stateFor(tabB), { audible: false, muted: false });
	tracker.setMuted(tabA, false);
	assert.equal(tracker.stateFor(tabA).muted, false);
	tracker.prune(new Set([2]));
	a.setAudible(true);
	assert.equal(
		tracker.stateFor(tabA).audible,
		true,
		"re-tracking a live tab re-seeds from the live read, never a stale cache",
	);
});

test("print: the OS dialog is the consent (never silent), and a real failure surfaces as a notice", () => {
	const controls = new PageControls(() => {});
	const page = fakeWebContents();
	const tab = fakeTab(1, page.wc);
	controls.print(tab);
	const call = page.printCall();
	assert.ok(call, "print reaches webContents.print");
	assert.equal(call.options.silent, false);
	assert.equal(call.options.printBackground, false);
	call.callback(false, "Invalid printer settings");
	assert.ok(
		(controls.state(tab).notice ?? "").includes("Invalid printer settings"),
	);
	const page2 = fakeWebContents();
	const tab2 = fakeTab(2, page2.wc);
	controls.print(tab2);
	page2.printCall().callback(false, "Print job canceled");
	assert.equal(
		controls.state(tab2).notice,
		null,
		"the person cancelling their own print dialog is not an error",
	);
});

// --- human downloads -------------------------------------------------------

class FakeDownloadItem {
	constructor({ filename, total = 10 } = {}) {
		this.filename = filename;
		this.total = total;
		this.received = total;
		this.savePath = "";
		this.cancelled = false;
		this.doneListeners = [];
		this.updateListeners = [];
	}
	getFilename() {
		return this.filename;
	}
	getURL() {
		return "https://example.test/file";
	}
	getMimeType() {
		return "application/octet-stream";
	}
	getTotalBytes() {
		return this.total;
	}
	getReceivedBytes() {
		return this.received;
	}
	setSavePath(path) {
		this.savePath = path;
	}
	getSavePath() {
		return this.savePath;
	}
	cancel() {
		this.cancelled = true;
	}
	getState() {
		return "progressing";
	}
	once(event, listener) {
		if (event === "done") this.doneListeners.push(listener);
		return this;
	}
	on(event, listener) {
		if (event === "updated") this.updateListeners.push(listener);
		return this;
	}
	finish(state = "completed") {
		for (const listener of this.doneListeners) listener({}, state);
	}
}

function makeArmer(humanDir, owners) {
	return new DownloadArmer({
		tabForWebContents: (id) => (id === 101 ? 7 : null),
		ownerKindFor: (tabId) => owners.get(tabId) ?? null,
		humanDownloadDir: humanDir ? () => humanDir : undefined,
		log: () => {},
		quietMs: 5,
	});
}

test("human downloads: a user-owned tab downloads into the person's folder with every guard intact", async () => {
	const humanDir = mkdtempSync(join(tmpdir(), "lo-human-dl-"));
	const owners = new Map([[7, "user"]]);
	const armer = makeArmer(humanDir, owners);

	const good = new FakeDownloadItem({ filename: "receipt.pdf" });
	const decision = armer.decide(good, 101);
	assert.equal(decision.cancel, false, "a user tab's download is allowed");
	assert.equal(good.savePath.startsWith(humanDir), true);
	good.finish("completed");
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.equal(armer.downloadDir(), humanDir);

	// A SECOND GUARD, made to bite on the human path (review minor 1): the
	// pre-write PER-FILE SIZE CAP. `getTotalBytes()` above the cap must cancel
	// WITHOUT calling `setSavePath`, so the over-cap file never touches disk —
	// the same pre-write guarantee the armed path gives, now exercised here
	// rather than only inspected. Driven through the fake's declared total,
	// which is the cheapest guard to reach.
	const overCap = new FakeDownloadItem({
		filename: "huge.bin",
		total: 268435456 + 1,
	});
	const bigDecision = armer.decide(overCap, 101);
	assert.equal(
		bigDecision.cancel,
		true,
		"the per-file cap bites on the human path",
	);
	assert.ok(bigDecision.reason.includes("per-file download limit"));
	assert.equal(
		overCap.savePath,
		"",
		"an over-cap human download never reaches disk",
	);

	const exe = new FakeDownloadItem({ filename: "evil.exe" });
	const refused = armer.decide(exe, 101);
	assert.equal(
		refused.cancel,
		true,
		"the executable-name guard still refuses on the human path",
	);
	assert.ok(refused.reason.includes("refused"));
});

test("human downloads: agent-owned tabs stay armed-only, and no human dir closes the path", async () => {
	const humanDir = mkdtempSync(join(tmpdir(), "lo-human-dl-"));
	const owners = new Map([[7, "agent"]]);
	const armer = makeArmer(humanDir, owners);
	const item = new FakeDownloadItem({ filename: "receipt.pdf" });
	assert.deepEqual(armer.decide(item, 101), {
		cancel: true,
		reason: "no download call is armed on this tab",
	});

	const noDir = makeArmer(null, new Map([[7, "user"]]));
	assert.equal(
		noDir.decide(new FakeDownloadItem({ filename: "receipt.pdf" }), 101).cancel,
		true,
		"without a composed human directory the pre-feature refusal stands",
	);

	// The armed agent path is untouched: arming the agent tab answers with
	// the harness directory, not the human one.
	const harnessDir = mkdtempSync(join(tmpdir(), "lo-harness-dl-"));
	const arm = armer.arm(7, harnessDir, 1000);
	const armedItem = new FakeDownloadItem({ filename: "receipt.pdf" });
	assert.equal(armer.decide(armedItem, 101).cancel, false);
	assert.equal(armedItem.savePath.startsWith(harnessDir), true);
	armedItem.finish("completed");
	await arm.done;
	armer.forget(7);
});

test("human downloads: a healthy in-flight write survives the budget that used to kill it (review round 2, MAJOR)", async () => {
	// THE DEADLINE MUST NOT COME BACK. `index.ts` used to wire
	// `humanDeadlineMs: COMMAND_TIMEOUTS_S.download * 1000` (120 s) and
	// `humanCapture` armed a wall-clock `settle` with it, so a legitimate
	// in-flight write was cancelled — and its partial DELETED — when the clock
	// ran out (review round 2 reproduced it with a 200 MiB file at ~1 MiB/s).
	// The fixed armer no longer reads the option; it is passed here anyway so
	// that a re-introduced budget bites HERE instead of shipping: with the old
	// code, the 60 ms deadline fires well inside the wait below and
	// `slow.cancelled` flips true.
	const humanDir = mkdtempSync(join(tmpdir(), "lo-human-dl-"));
	const owners = new Map([[7, "user"]]);
	const armer = new DownloadArmer({
		tabForWebContents: (id) => (id === 101 ? 7 : null),
		ownerKindFor: (tabId) => owners.get(tabId) ?? null,
		humanDownloadDir: () => humanDir,
		log: () => {},
		quietMs: 5,
		humanDeadlineMs: 60,
	});

	const slow = new FakeDownloadItem({ filename: "slow.bin", total: 10 });
	slow.received = 4; // mid-write: the state the deadline used to kill
	const decision = armer.decide(slow, 101);
	assert.equal(decision.cancel, false, "a user tab's write starts");
	const plannedPath = slow.savePath;
	assert.equal(plannedPath.startsWith(humanDir), true);

	await new Promise((resolve) => setTimeout(resolve, 180)); // 3x the former budget
	assert.equal(
		slow.cancelled,
		false,
		"the former wall-clock budget must never cancel a healthy in-flight human write",
	);
	assert.equal(
		slow.savePath,
		plannedPath,
		"and nothing was discarded or re-pathed",
	);

	// The write finishes the way a real one does, and the capture answers the
	// way it always did: a saved note, on the quiet window.
	slow.received = slow.total;
	slow.finish("completed");
	await new Promise((resolve) => setTimeout(resolve, 20));
	const notes = armer.activityFor(7).notes;
	assert.equal(
		notes[0]?.outcome,
		"saved",
		"the completed write is reported as saved",
	);
	assert.ok(
		notes.every((note) => note.outcome !== "refused"),
		"no refusal was ever written for the healthy write",
	);
});

test("human downloads: a refusal notifies the chrome at once (UX round 1, U1, MAJOR)", () => {
	// THE REFUSAL WAS THE ONE STATE CHANGE THAT DID NOT NOTIFY. `refuse()`
	// called `note()` and stopped there, so an executable refusal stayed
	// invisible until some UNRELATED event forced the renderer to re-read the
	// projection — measured at t+121.8 s, and there only because the human
	// deadline's own settle fired `onActivity`. With the `onActivity` call in
	// `refuse()` reverted, the counter below stays at zero and this test fails.
	const humanDir = mkdtempSync(join(tmpdir(), "lo-human-dl-"));
	const owners = new Map([[7, "user"]]);
	let activity = 0;
	const armer = new DownloadArmer({
		tabForWebContents: (id) => (id === 101 ? 7 : null),
		ownerKindFor: (tabId) => owners.get(tabId) ?? null,
		humanDownloadDir: () => humanDir,
		log: () => {},
		quietMs: 5,
		onActivity: () => {
			activity += 1;
		},
	});

	const before = activity; // the human capture's own creation does not notify
	const exe = new FakeDownloadItem({ filename: "evil.exe" });
	const refused = armer.decide(exe, 101);
	assert.equal(
		refused.cancel,
		true,
		"the executable fails the same way it always did",
	);
	assert.equal(
		activity > before,
		true,
		"the refusal must fire the activity notification the other state changes fire",
	);
	const notes = armer.activityFor(7).notes;
	assert.ok(
		notes.some(
			(note) => note.outcome === "refused" && note.name === "evil.exe",
		),
		"and the refusal note itself is on the ledger",
	);
});
