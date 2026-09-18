import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * Coverage for the canvas's file freshness decisions - the rule that keeps an
 * OPEN document's bytes equal to the file's bytes, and the three ways that rule
 * must refuse to act.
 *
 * WHY THIS FILE EXISTS, in the shape of the incident it prevents. Every branch
 * below is a data-loss branch or a wasted-work branch, and none of them is
 * visible in a browser:
 *
 * - A rewrite while a mounted editor holds unsaved changes: the file's bytes
 *   replace what the user is typing, and the editor's own debounced save then
 *   writes the replaced buffer to disk. That is silent data loss, and the
 *   window is as wide as the editor's debounce (one second in `code-editor`,
 *   three in `wysiwyg-markdown-editor`).
 * - A file touched without being changed (`touch`, an editor saving an
 *   unmodified buffer, a build writing identical output): applying the re-read
 *   resets a caret and re-renders a document for a byte-identical result.
 * - Two triggers in one tick (a tab switch and a window focus arriving
 *   together): two `read-file` calls for one document, and the last one to
 *   resolve wins - which is fine only as long as they were reading the same
 *   version, and is not the reason to allow it.
 * - Our own save: the write moves the file's mtime, so without a baseline that
 *   follows it the panel reads its own output back for ever.
 *
 * REAL: `file-freshness.ts`, plus the `viewer-routing.ts` table it asks which
 * encoding a document's viewer wants - all bundled from source by esbuild, so
 * the rule under test is the one the app runs. The probe and the read are the
 * only fakes, and they are fakes of the BRIDGE (a `statSync` answer and a
 * `readFile` answer), not of the decision.
 *
 * The real-surface half of this - a file written on disk while its tab is open,
 * in the built app, with a real `statSync` and a real `readFile` - is
 * `node scripts/renderer-driver.mjs --scene canvas-freshness`.
 */

const bundle = await build({
	stdin: {
		contents: `
			export {
				freshnessDecision,
				createFreshnessRunner,
				documentAfterSelfWrite,
				setDocumentDirty,
				clearDocumentDirty,
				isDocumentDirty,
				subscribeDocumentDirty,
				isAutosaveHeld,
				publishExplicitSave,
				explicitSaveAtFor,
			} from "./src/renderer/src/features/chat/components/canvas/file-freshness";
			export { answerFor, factAfter, FACT_TEXT, ANSWER_LIFETIME_MS } from "./src/renderer/src/features/chat/components/canvas/use-file-freshness";
			export { viewerFor, READ_ENCODING } from "./src/renderer/src/features/chat/utils/viewer-routing";
			export { canvasDocumentForPath } from "./src/renderer/src/features/chat/utils/canvas-document";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	mainFields: ["module", "main"],
	conditions: ["import"],
	// The renderer's aliases are tsconfig paths, not node resolutions.
	alias: {
		"@features": "./src/renderer/src/features",
		"@shared": "./src/renderer/src/shared",
	},
	write: false,
});
const {
	freshnessDecision,
	createFreshnessRunner,
	documentAfterSelfWrite,
	setDocumentDirty,
	clearDocumentDirty,
	isDocumentDirty,
	subscribeDocumentDirty,
	isAutosaveHeld,
	publishExplicitSave,
	explicitSaveAtFor,
	answerFor,
	factAfter,
	FACT_TEXT,
	ANSWER_LIFETIME_MS,
	viewerFor,
	READ_ENCODING,
	canvasDocumentForPath,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

// ---------------------------------------------------------------- fixtures

/** A probe answer, in the shape `probe-files` returns. */
const probe = (
	path,
	mtimeMs,
	{ exists = true, isFile = true, sizeBytes = 10, error } = {},
) => ({
	input: path,
	resolved: path,
	exists,
	isFile,
	sizeBytes: exists && isFile ? sizeBytes : null,
	mtimeMs: exists && isFile ? mtimeMs : null,
	/* Present only when `stat` itself failed - a permission bit, a broken mount.
	 * A genuinely absent file answers `exists: false` with no error at all, which
	 * is the distinction the row now speaks in (QA round 1, Q1). */
	...(error ? { error } : {}),
});

/**
 * A document as the click path builds one, with the baseline stated rather than
 * assumed (`readMtimeMs` is the field this change adds).
 */
const doc = (
	path,
	{ content = "one\n", readMtimeMs, type, lastAgentModified } = {},
) =>
	canvasDocumentForPath(path, {
		content,
		readMtimeMs,
		...(type ? { type } : {}),
		...(lastAgentModified !== undefined ? { lastAgentModified } : {}),
	});

/**
 * A bridge: a table of what the file "on disk" currently is, plus a count of
 * every call, so a test can assert that a read did NOT happen as well as that it
 * did.
 */
function bridge(files, { readFails = false } = {}) {
	const calls = { probes: [], reads: [] };
	return {
		calls,
		ports: {
			probe: async (path) => {
				calls.probes.push(path);
				const entry = files.get(path);
				if (!entry) return probe(path, 0, { exists: false });
				// The answer main would give: the file's own mtime and size, from
				// the table standing in for the disk.
				return probe(path, entry.mtimeMs, {
					sizeBytes: entry.content.length,
				});
			},
			read: async (path, encoding) => {
				calls.reads.push({ path, encoding });
				if (readFails) return { ok: false, error: "EACCES" };
				return { ok: true, content: files.get(path).content };
			},
		},
	};
}

/** The same, with the answers held open so a test can control the timing. */
function slowBridge() {
	const calls = { probes: [], reads: [] };
	const gates = [];
	return {
		calls,
		gates,
		ports: {
			probe: async (path) => {
				calls.probes.push(path);
				// A NEWER mtime, so the check reaches its read and the gate below has
				// something to hold open.
				return probe(path, 200);
			},
			read: async (path, encoding) => {
				calls.reads.push({ path, encoding });
				await new Promise((resolve) => gates.push(resolve));
				return { ok: true, content: "two\n" };
			},
		},
	};
}

// ------------------------------------------------- the mtime decision itself

test("the same mtime is not a change", () => {
	const document = doc("/tmp/a.md", { readMtimeMs: 500 });
	assert.deepEqual(freshnessDecision(document, probe("/tmp/a.md", 500)), {
		kind: "unchanged",
	});
});

test("an older mtime is a change too, which is what the !== test is for", () => {
	/*
	 * `git checkout` of an older revision, `cp -p`, an archive extraction, a
	 * writer whose clock is behind this machine's. Under a strictly-newer test
	 * the panel keeps showing bytes the file no longer has, silently, until the
	 * file is written again.
	 */
	const document = doc("/tmp/a.md", { readMtimeMs: 500 });
	assert.deepEqual(freshnessDecision(document, probe("/tmp/a.md", 400)), {
		kind: "reload",
		encoding: "utf-8",
	});
});

test("a document with no baseline adopts rather than re-reads", () => {
	/*
	 * Created in the panel, opened through the OS dialog, or restored from a
	 * store written before the field existed. Re-reading every one of those on
	 * first sight would rewrite every restored buffer on the first tick after an
	 * upgrade, for a file nobody has touched.
	 */
	const document = doc("/tmp/new.md", { content: "" });
	assert.deepEqual(freshnessDecision(document, probe("/tmp/new.md", 900)), {
		kind: "adopt",
	});
});

test("a path that is gone, a directory, and an unusable answer", () => {
	const document = doc("/tmp/a.md", { readMtimeMs: 100 });
	assert.deepEqual(
		freshnessDecision(document, probe("/tmp/a.md", 0, { exists: false })),
		{ kind: "missing" },
	);
	// A directory is not a missing file, but it has no bytes to re-read either:
	// the click hands those to the OS and they never become documents.
	assert.deepEqual(
		freshnessDecision(document, probe("/tmp/a.md", 0, { isFile: false })),
		{ kind: "missing" },
	);
	assert.deepEqual(freshnessDecision(document, null), { kind: "unavailable" });
});

test("which viewer a document opens in decides whether bytes are read at all", () => {
	/*
	 * The encoding table is the click path's own (`viewer-routing.ts`), asked
	 * here rather than restated: a PDF's bytes belong to `pdf-preview`'s blob
	 * cache, and re-reading them into the store - which is persisted to
	 * localStorage - would be a whole document in a ~5MB quota.
	 */
	assert.equal(READ_ENCODING[viewerFor("/tmp/a.pdf")], "bytes");
	assert.equal(READ_ENCODING[viewerFor("/tmp/a.png")], "bytes");
	assert.equal(READ_ENCODING[viewerFor("/tmp/a.mp4")], "range");
	assert.equal(READ_ENCODING[viewerFor("/tmp/a.xlsx")], "base64");
	const pdf = doc("/tmp/a.pdf", { content: "", readMtimeMs: 100, type: "pdf" });
	assert.deepEqual(freshnessDecision(pdf, probe("/tmp/a.pdf", 200)), {
		kind: "repoint",
	});
	const video = doc("/tmp/a.mp4", {
		content: "",
		readMtimeMs: 100,
		type: "video",
	});
	assert.deepEqual(freshnessDecision(video, probe("/tmp/a.mp4", 200)), {
		kind: "repoint",
	});
	const sheet = doc("/tmp/a.xlsx", {
		content: "AAAA",
		readMtimeMs: 100,
		type: "spreadsheet",
	});
	assert.deepEqual(freshnessDecision(sheet, probe("/tmp/a.xlsx", 200)), {
		kind: "reload",
		encoding: "base64",
	});
});

// ------------------------------------------------------------- the runner

test("a newer mtime re-reads the file and applies its bytes", async () => {
	const path = "/tmp/a.md";
	const files = new Map([[path, { mtimeMs: 200, content: "two\n" }]]);
	const { ports, calls } = bridge(files);
	const runner = createFreshnessRunner(ports, () => false);
	const outcome = await runner.check(doc(path, { readMtimeMs: 100 }));
	assert.equal(outcome.status, "applied");
	assert.equal(outcome.document.content, "two\n");
	// The baseline is the file's own mtime, which is what the next check compares
	// against.
	assert.equal(outcome.document.readMtimeMs, 200);
	/*
	 * `lastAgentModified` is NOT the mtime here, and that is deliberate: for a
	 * text document it is the reload signal the markdown editor watches (its
	 * content lives in a contenteditable, so the prop alone is not enough), and a
	 * forced re-read is exactly the case where the bytes move and the mtime does
	 * not. It must therefore change on any content-changing apply.
	 */
	assert.notEqual(outcome.document.lastAgentModified, 200);
	assert.equal(typeof outcome.document.lastAgentModified, "number");
	assert.equal(outcome.document.availability, "present");
	assert.deepEqual(calls.reads, [{ path, encoding: "utf-8" }]);
});

test("an unchanged mtime costs one probe and no read", async () => {
	const path = "/tmp/a.md";
	const files = new Map([[path, { mtimeMs: 100, content: "two\n" }]]);
	const { ports, calls } = bridge(files);
	const runner = createFreshnessRunner(ports, () => false);
	const outcome = await runner.check(doc(path, { readMtimeMs: 100 }));
	assert.deepEqual(outcome, { status: "unchanged" });
	assert.equal(calls.probes.length, 1);
	assert.equal(calls.reads.length, 0);
});

test("a touched file with identical bytes advances the baseline and applies nothing", async () => {
	const path = "/tmp/a.md";
	const files = new Map([[path, { mtimeMs: 200, content: "one\n" }]]);
	const { ports, calls } = bridge(files);
	const runner = createFreshnessRunner(ports, () => false);
	const outcome = await runner.check(
		doc(path, { readMtimeMs: 100, content: "one\n" }),
	);
	assert.equal(outcome.status, "identical");
	assert.equal(outcome.document.readMtimeMs, 200);
	assert.equal(outcome.document.content, "one\n");
	// It DID read - the mtime moved and nothing can know the bytes are the same
	// without asking - and what it declines to do is repaint.
	assert.equal(calls.reads.length, 1);
});

test("a failed stat is its own decision, not a deleted file", async () => {
	/*
	 * QA round 1, Q1: a permission error answers `exists: false` exactly as a
	 * deletion does, and the row said `This file is no longer on disk.` about a
	 * file that was sitting right there. The contract already distinguishes them
	 * (`ProbedFile.error`: "present only when `stat` itself failed ... rather than
	 * answering 'no such file'"); this is the decision honouring that.
	 */
	const path = "/tmp/a.md";
	const held = doc(path, { readMtimeMs: 100, content: "one\n" });
	assert.deepEqual(freshnessDecision(held, probe(path, 0, { exists: false })), {
		kind: "missing",
	});
	assert.deepEqual(
		freshnessDecision(
			held,
			probe(path, 0, {
				exists: false,
				error: "EACCES: permission denied, stat '/tmp/a.md'",
			}),
		),
		{ kind: "unreadable" },
	);

	const { ports, calls } = bridge(
		new Map([[path, { mtimeMs: 100, content: "one\n" }]]),
	);
	const unlucky = {
		...ports,
		probe: async () =>
			probe(path, 0, { exists: false, error: "EACCES: permission denied" }),
	};
	const runner = createFreshnessRunner(unlucky, () => false);
	const outcome = await runner.check(held);
	assert.equal(outcome.status, "unreadable");
	// The held bytes and the baseline are untouched, and `availability` is NOT
	// pushed to "missing" for a file that has not gone anywhere - that field
	// drives the tile's receipt and the tab.
	assert.equal(outcome.document.content, "one\n");
	assert.equal(outcome.document.readMtimeMs, 100);
	assert.notEqual(outcome.document.availability, "missing");
	assert.equal(calls.probes.length, 0);
});

test("a vanished file is reported, not thrown, and keeps its baseline", async () => {
	const path = "/tmp/a.md";
	const { ports } = bridge(new Map());
	const runner = createFreshnessRunner(ports, () => false);
	const outcome = await runner.check(doc(path, { readMtimeMs: 100 }));
	assert.equal(outcome.status, "missing");
	assert.equal(outcome.document.availability, "missing");
	// Not advanced: a file that comes back may come back as anything, including
	// with its old timestamp restored from a backup.
	assert.equal(outcome.document.readMtimeMs, 100);
});

test("a read that fails is reported as a failure, with nothing applied", async () => {
	const path = "/tmp/a.md";
	const files = new Map([[path, { mtimeMs: 200, content: "two\n" }]]);
	const { ports } = bridge(files, { readFails: true });
	const runner = createFreshnessRunner(ports, () => false);
	const outcome = await runner.check(doc(path, { readMtimeMs: 100 }));
	assert.deepEqual(outcome, { status: "failed", error: "EACCES" });
});

test("two checks in flight for one document are one read", async () => {
	const path = "/tmp/a.md";
	const { ports, calls, gates } = slowBridge();
	const runner = createFreshnessRunner(ports, () => false);
	const document = doc(path, { readMtimeMs: 100 });
	const first = runner.check(document);
	const second = runner.check(document);
	// The probe is a promise, so let the first check reach its read before asking
	// how many reads there are.
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(calls.reads.length, 1, "the second call joined the first");
	assert.equal(first, second, "and it answered with the same promise");
	for (const open of gates) open();
	const [a, b] = await Promise.all([first, second]);
	assert.equal(a.status, "applied");
	// The second caller gets the FIRST one's answer rather than a second read.
	assert.equal(b.status, "applied");
	assert.equal(calls.reads.length, 1);
});

test("two documents are two reads, in parallel", async () => {
	const files = new Map([
		["/tmp/a.md", { mtimeMs: 200, content: "a2\n" }],
		["/tmp/b.md", { mtimeMs: 200, content: "b2\n" }],
	]);
	const { ports, calls } = bridge(files);
	const runner = createFreshnessRunner(ports, () => false);
	const [a, b] = await Promise.all([
		runner.check(doc("/tmp/a.md", { readMtimeMs: 100, content: "a1\n" })),
		runner.check(doc("/tmp/b.md", { readMtimeMs: 100, content: "b1\n" })),
	]);
	assert.equal(a.document.content, "a2\n");
	assert.equal(b.document.content, "b2\n");
	assert.equal(calls.reads.length, 2);
});

// ------------------------------------------------- a mounted editor is dirty

test("a dirty document's tick probes, and reports that the file moved on", async () => {
	const path = "/tmp/a.md";
	const files = new Map([[path, { mtimeMs: 200, content: "two\n" }]]);
	const { ports, calls } = bridge(files);
	const runner = createFreshnessRunner(ports, (id) => id === path);
	const outcome = await runner.check(doc(path, { readMtimeMs: 100 }));
	/*
	 * The file HAS moved on, and this is the answer the row needs in order to say
	 * so. The reader's buffer still wins - nothing is read, nothing is applied -
	 * but it must not win silently while an agent's write disappears with it
	 * (UX round 1, U1; the round-1 UX walk measured the write vanishing with no
	 * sentence anywhere).
	 */
	assert.deepEqual(outcome, { status: "skipped-dirty", diskChanged: true });
	assert.equal(calls.probes.length, 1);
	assert.equal(calls.reads.length, 0);
});

test("a dirty tick that finds the file unmoved costs one stat and says nothing", async () => {
	const path = "/tmp/a.md";
	const files = new Map([[path, { mtimeMs: 100, content: "one\n" }]]);
	const { ports, calls } = bridge(files);
	const runner = createFreshnessRunner(ports, (id) => id === path);
	const outcome = await runner.check(doc(path, { readMtimeMs: 100 }));
	assert.deepEqual(outcome, { status: "skipped-dirty", diskChanged: false });
	assert.equal(calls.probes.length, 1);
	assert.equal(calls.reads.length, 0);
});

test("a document that becomes dirty while the read is in flight is not applied over", async () => {
	/*
	 * THE TRANSITION, NOT THE GATE (code review round 1, M3). Both dirty tests
	 * around this one hand `check` a document that is ALREADY dirty, so they
	 * exercise the registry being read; this one makes the registry change during
	 * the await, which is the ordering the shipped code got wrong: the gate was
	 * read once at the top of the run, and a keystroke landing inside the read
	 * still had the file's bytes applied over it - characters that had not reached
	 * disk, gone from the screen.
	 */
	const path = "/tmp/a.md";
	const { ports, gates, calls } = slowBridge();
	let dirty = false;
	const runner = createFreshnessRunner(ports, () => dirty);
	const pending = runner.check(
		doc(path, { readMtimeMs: 100, content: "user is typing\n" }),
	);
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(calls.reads.length, 1, "the check reached its read");
	dirty = true;
	for (const open of gates) open();
	const outcome = await pending;
	assert.deepEqual(outcome, { status: "skipped-dirty", diskChanged: true });
});

test("a dirty document survives an automatic apply, and the forced check only reports", async () => {
	const path = "/tmp/a.md";
	const files = new Map([[path, { mtimeMs: 200, content: "two\n" }]]);
	const { ports, calls } = bridge(files);
	const runner = createFreshnessRunner(ports, (id) => id === path);
	const document = doc(path, { readMtimeMs: 100, content: "user is typing\n" });

	// Both ticks now report the truth about the file - it has moved on - and
	// neither applies anything: the difference between them is what the row says
	// about a fix, not what the store does.
	const automatic = await runner.check(document, false);
	assert.deepEqual(automatic, { status: "skipped-dirty", diskChanged: true });

	// The control still says something true: the file has moved on, and the
	// unsaved edits are what wins. Nothing is applied either way - the whole
	// point of the registry.
	const forced = await runner.check(document, true);
	assert.deepEqual(forced, { status: "skipped-dirty", diskChanged: true });
	assert.equal(calls.reads.length, 0);
});

test("a forced check re-reads a file the mtime test had left alone", async () => {
	const path = "/tmp/a.md";
	// The mtime is EXACTLY the baseline: this is the case that produces content
	// on disk which no probe can see (a `cp -p` over the same path, two writes
	// inside one filesystem tick).
	const files = new Map([[path, { mtimeMs: 100, content: "two\n" }]]);
	const { ports, calls } = bridge(files);
	const runner = createFreshnessRunner(ports, () => false);
	const document = doc(path, { readMtimeMs: 100, content: "one\n" });
	assert.deepEqual(await runner.check(document, false), {
		status: "unchanged",
	});
	const forced = await runner.check(document, true);
	assert.equal(forced.status, "applied");
	assert.equal(forced.document.content, "two\n");
	assert.equal(calls.reads.length, 1);
});

test("a forced check on a viewer that holds its own bytes moves the cache key instead", async () => {
	/*
	 * A PDF's bytes are the object URL the viewer holds, cached under
	 * `file:<path>:<mtime>`. With the mtime unchanged there is nothing to read in
	 * the renderer, so the forced re-read is a cache-bust: the key moves - and the
	 * baseline does NOT, because the file's own timestamp is unchanged and the
	 * baseline is a fact about the file rather than about this request.
	 */
	const path = "/tmp/a.pdf";
	const files = new Map([[path, { mtimeMs: 100, content: "%PDF" }]]);
	const { ports, calls } = bridge(files);
	const runner = createFreshnessRunner(ports, () => false);
	const document = doc(path, { content: "", readMtimeMs: 100, type: "pdf" });
	const forced = await runner.check(document, true);
	assert.equal(forced.status, "applied");
	assert.equal(forced.document.readMtimeMs, 100);
	assert.notEqual(forced.document.lastAgentModified, 100);
	assert.equal(calls.reads.length, 0, "no bytes move through the renderer");
});

test("the dirty registry publishes and clears, and a closed tab leaves nothing behind", () => {
	const seen = [];
	const unsubscribe = subscribeDocumentDirty(() =>
		seen.push(isDocumentDirty("/tmp/a.md")),
	);
	setDocumentDirty("/tmp/a.md", true);
	assert.equal(isDocumentDirty("/tmp/a.md"), true);
	// Idempotent: the second publish is not a change and must not wake anyone.
	setDocumentDirty("/tmp/a.md", true);
	assert.deepEqual(seen, [true]);
	// The unmount path an editor takes.
	clearDocumentDirty("/tmp/a.md");
	assert.equal(isDocumentDirty("/tmp/a.md"), false);
	assert.deepEqual(seen, [true, false]);
	unsubscribe();
	// After unmount the subscription is gone rather than merely quiet.
	setDocumentDirty("/tmp/a.md", true);
	assert.deepEqual(seen, [true, false]);
	clearDocumentDirty("/tmp/a.md");
});

// ------------------------------------------------------- our own writes

test("a self-write advances the baseline to the probed mtime, without a re-read", async () => {
	const path = "/tmp/a.md";
	const files = new Map([[path, { mtimeMs: 700, content: "typed\n" }]]);
	const { ports, calls } = bridge(files);
	const runner = createFreshnessRunner(ports, () => false);
	const held = doc(path, { readMtimeMs: 100, content: "typed\n" });

	const afterWrite = documentAfterSelfWrite(held, probe(path, 700), "typed\n");
	assert.equal(afterWrite.readMtimeMs, 700);
	assert.equal(afterWrite.lastAgentModified, 700);
	assert.equal(afterWrite.content, "typed\n");

	// Which is what stops the next tick reading our own output back.
	const outcome = await runner.check(afterWrite);
	assert.deepEqual(outcome, { status: "unchanged" });
	assert.equal(calls.reads.length, 0);
});

test("a self-write whose probe failed keeps the old baseline, so the next check reads", async () => {
	const path = "/tmp/a.md";
	const held = doc(path, { readMtimeMs: 100, content: "typed\n" });
	const afterWrite = documentAfterSelfWrite(held, null, "typed\n");
	assert.equal(afterWrite.readMtimeMs, 100);
	assert.equal(afterWrite.content, "typed\n");

	const files = new Map([[path, { mtimeMs: 900, content: "typed\n" }]]);
	const { ports } = bridge(files);
	const runner = createFreshnessRunner(ports, () => false);
	const outcome = await runner.check(afterWrite);
	// The fallback is one ordinary read - which reports identical bytes, so the
	// panel still does not repaint.
	assert.equal(outcome.status, "identical");
	assert.equal(outcome.document.readMtimeMs, 900);
});

// ------------------------------------------------ nothing runs unprompted

test("nothing is probed until a check is asked for", async () => {
	/*
	 * The activation claim, at this layer: the runner owns no timer and no
	 * subscription, so a document that nobody is looking at costs nothing. What
	 * calls `check` - mount, a tab switch, the window coming back, the poll - is
	 * `use-file-freshness.ts`, and the real-surface half of the same claim is the
	 * probe counter in `--scene canvas-freshness`: a background tab is not probed
	 * while it is off screen, and IS probed within a moment of being switched to.
	 */
	const path = "/tmp/a.md";
	const files = new Map([[path, { mtimeMs: 200, content: "two\n" }]]);
	const { ports, calls } = bridge(files);
	createFreshnessRunner(ports, () => false);
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.equal(calls.probes.length, 0);
	assert.equal(calls.reads.length, 0);
});

// ------------------------------------------- the hold, and how a reader leaves it

test("a dirty document whose file moved on holds its autosave, and releases it when the mtime comes back", async () => {
	/*
	 * UX round 2, U1's second half. Before this, the editor's own debounced save
	 * landed ~1s after the row first told the reader the file had changed, and
	 * destroyed the version it was telling them about: the change then existed
	 * nowhere, and the sentence described something nobody could load.
	 */
	const path = "/tmp/a.md";
	const files = new Map([[path, { mtimeMs: 200, content: "two\n" }]]);
	const { ports } = bridge(files);
	const runner = createFreshnessRunner(ports, () => true);
	const held = doc(path, { readMtimeMs: 100, content: "typing\n" });

	await runner.check(held);
	assert.equal(
		isAutosaveHeld(path),
		true,
		"the write is held while the fact stands",
	);

	// The file comes back to the baseline: nothing was lost, so nothing is held.
	files.set(path, { mtimeMs: 100, content: "one\n" });
	const settled = await runner.check(held);
	assert.deepEqual(settled, { status: "skipped-dirty", diskChanged: false });
	assert.equal(
		isAutosaveHeld(path),
		false,
		"and released when the fact stops being true",
	);
});

test("load takes the file's version over the reader's buffer, and releases the hold", async () => {
	const path = "/tmp/a.md";
	const files = new Map([[path, { mtimeMs: 200, content: "two\n" }]]);
	const { ports, calls } = bridge(files);
	setDocumentDirty(path, true);
	const runner = createFreshnessRunner(ports);
	const held = doc(path, { readMtimeMs: 100, content: "typing\n" });

	await runner.check(held);
	assert.equal(isDocumentDirty(path), true);
	assert.equal(isAutosaveHeld(path), true);

	const loaded = await runner.load(held);
	assert.equal(loaded.status, "applied");
	assert.equal(
		loaded.document.content,
		"two\n",
		"the file's bytes are what the store now holds",
	);
	assert.equal(loaded.document.readMtimeMs, 200);
	assert.equal(
		isDocumentDirty(path),
		false,
		"the reader chose the file, so the buffer is no longer unsaved",
	);
	assert.equal(isAutosaveHeld(path), false);
	// One read: the dirty check above answered from a probe alone (a held buffer is
	// never read), so the load is a real re-read rather than a reuse of anything.
	assert.equal(calls.reads.length, 1);
	assert.equal(calls.probes.length, 2, "and it probed again before it read");
});

test("an explicit save releases the hold and is timestamped for the row", () => {
	const path = "/tmp/a.md";
	setDocumentDirty(path, true);
	assert.equal(explicitSaveAtFor(path), null);
	publishExplicitSave(path);
	assert.equal(typeof explicitSaveAtFor(path), "number");
	assert.equal(
		isAutosaveHeld(path),
		false,
		"a save the reader asked for is never held",
	);
	clearDocumentDirty(path);
});

// ------------------------------------- what an outcome does to the two registers

test("the answer to a forced check that found identical bytes says so", () => {
	/*
	 * Design D3 / QA Q5 / UX U3: the runner rewrites a forced `unchanged` into a
	 * reload, and a reload of an unchanged file comes back `identical` - so this
	 * slot is the only place a press on an unchanged text document can be
	 * answered at all. It used to answer nothing.
	 */
	assert.equal(answerFor({ status: "identical" }, true), "Already up to date");
	assert.equal(answerFor({ status: "identical" }, false), "Already up to date");
	assert.equal(answerFor({ status: "applied" }, false), "Updated from disk");
	assert.equal(
		answerFor({ status: "unchanged" }, false),
		undefined,
		"a tick that found nothing new says nothing new",
	);
	assert.equal(answerFor({ status: "unchanged" }, true), "Already up to date");
});

test("a failed read is not retired by a tick that never re-read anything", () => {
	/*
	 * Design D9 / QA Q6: the sentence was cleared 832ms later by an `unchanged`
	 * tick while it was still true. An unchanged answer is a probe answer - it
	 * proves the file is there and readable, and it proves nothing about whether
	 * the bytes on screen could be re-read.
	 */
	assert.equal(
		factAfter({ status: "failed" }, "failed"),
		"failed",
		"a second failure is still the failure",
	);
	assert.equal(factAfter({ status: "unchanged" }, "failed"), undefined);
	assert.equal(
		factAfter({ status: "applied" }, "failed"),
		null,
		"a successful read answers it",
	);
	assert.equal(factAfter({ status: "identical" }, "failed"), null);
});

test("the facts that a probe CAN answer are retired by it", () => {
	assert.equal(factAfter({ status: "missing" }, null), "missing");
	assert.equal(factAfter({ status: "unreadable" }, null), "unreadable");
	assert.equal(factAfter({ status: "unchanged" }, "missing"), null);
	assert.equal(factAfter({ status: "unchanged" }, "unreadable"), null);
	// A dirty tick reports the fact, and stops reporting it when the mtime is back.
	assert.equal(
		factAfter({ status: "skipped-dirty", diskChanged: true }, null),
		"disk-changed",
	);
	assert.equal(
		factAfter({ status: "skipped-dirty", diskChanged: false }, "disk-changed"),
		null,
	);
	assert.equal(
		factAfter({ status: "skipped-dirty", diskChanged: false }, null),
		undefined,
		"a quiet dirty tick leaves whatever stands standing",
	);
});

test("every fact has a sentence, and answers are the ones with a lifetime", () => {
	const facts = [
		"missing",
		"unreadable",
		"failed",
		"disk-changed",
		"save-replaced",
	];
	for (const fact of facts) {
		assert.equal(typeof FACT_TEXT[fact], "string");
		assert.ok(FACT_TEXT[fact].length > 0);
	}
	// The dirty fact names only actions the canvas has: the control loads the
	// file's version, and a save replaces it. "Discard" is not one of them.
	const dirtySentence = FACT_TEXT["disk-changed"];
	assert.match(dirtySentence, /Load its version/);
	assert.match(dirtySentence, /save to replace it/);
	assert.doesNotMatch(dirtySentence, /discard/i);
	assert.ok(
		ANSWER_LIFETIME_MS > 0,
		"an answer retires rather than standing for ever",
	);
});
