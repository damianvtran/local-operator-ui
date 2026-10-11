/**
 * The supplement view model, pinned against the C0 CONTRACT FIXTURES.
 *
 * The rows and expectations below are copied from
 * `local-operator`'s `tests/fixtures/supplements/` (the frozen contract every
 * surface codes against): `rows/dispositions.json` literally says what every
 * surface must paint per row live vs cold, `messages/messages.json` carries the
 * accepted and REJECTED frame->host shapes, and the row files carry the wire
 * vocabulary. Embedding them here rather than reading them from a checkout is
 * deliberate: this suite runs in the UI repo, and a test that skips when the
 * core repo is absent is a test that silently stops running.
 *
 * The module is TypeScript, so it is bundled with esbuild first (the pattern
 * `window-guards.test.mjs` sets): the type-only imports are erased, and the
 * runtime half — the display-copy table, the reader rule, the nonce/height
 * rules and the (version, rank) merge — runs here as the renderer runs it.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/canonical/supplement-model";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const model = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const NONCE = "n-4f2a9c1e07b3";

/** One `supplement_v1` row's details, by fixture name. */
const row = (name) => {
	const base = {
		anchor: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
		job: "3f9c1a7e5b20",
		version: 1,
		state: "queued",
		files: [],
		components: [],
		error: "",
		at: 1791000000.0,
	};
	const files = [
		{
			path: "reports/latency.md",
			name: "latency.md",
			kind: "markdown",
			size_bytes: 4120,
			mtime: 1790999940.0,
			why: "written by write",
		},
		{
			path: "data/bench.csv",
			name: "bench.csv",
			kind: "csv",
			size_bytes: 913,
			mtime: 1790999940.0,
			why: "written by bash",
		},
	];
	const components = [
		{
			attachment: "04c2d29b140086cc637ad19ef34012c5",
			title: "Latency by region (ms)",
			source: "bench.csv rows 1-4 (tool result of bash at 10:41)",
			mime: "text/html",
			height_hint: 320,
		},
	];
	switch (name) {
		case "decided":
			return { ...base, state: "decided", files };
		case "queued_stale":
			// The stale-row fixture: `queued`, with the files its `decided`
			// predecessor already published (the callouts do not wait for the
			// generator — that is what makes its cold arm `files_cancelled_retry`).
			return { ...base, state: "queued", files };
		case "queued_no_files":
			return { ...base, state: "queued" };
		case "done_populated":
			return { ...base, state: "done", files, components };
		case "done_files_only":
			return { ...base, state: "done", files };
		case "done_empty":
			return { ...base, state: "done" };
		case "failed":
			return { ...base, state: "failed", error: "provider quota exhausted" };
		case "cancelled":
			return { ...base, state: "cancelled" };
		case "superseded":
			return { ...base, state: "cancelled", error: "superseded" };
		case "dismissed":
			return { ...base, state: "skipped", dismissed: true };
		default:
			throw new Error(name);
	}
};

/** One record as the reducer would hold it after this row was applied. */
const record = (name, live) => {
	const patch = model.supplementPatchFromDetails(row(name));
	const merged = model.mergeSupplement(null, patch, 0);
	assert.ok(merged, `${name} must parse`);
	if (live) merged.live = true;
	return merged;
};

// --- the reader rule (rows/dispositions.json, verbatim) ---------------------

test("the disposition table matches rows/dispositions.json for every row", () => {
	const expected = {
		decided: { live: "files_preparing", cold: "files_cancelled_retry" },
		queued_stale: { live: "files_preparing", cold: "files_cancelled_retry" },
		queued_no_files: { live: "preparing", cold: "cancelled_retry" },
		done_populated: { live: "block", cold: "block" },
		done_files_only: { live: "block", cold: "block" },
		done_empty: { live: "nothing", cold: "nothing" },
		failed: { live: "failed_retry", cold: "failed_retry" },
		cancelled: { live: "cancelled_retry", cold: "cancelled_retry" },
		superseded: { live: "nothing", cold: "nothing" },
		dismissed: { live: "nothing", cold: "nothing" },
	};
	for (const [name, arms] of Object.entries(expected)) {
		assert.equal(
			model.supplementDisposition(record(name, true), true),
			arms.live,
			`${name} live`,
		);
		assert.equal(
			model.supplementDisposition(record(name, false), false),
			arms.cold,
			`${name} cold`,
		);
	}
});

test("newest version wins: an older replay cannot roll a settled row back", () => {
	const first = model.mergeSupplement(
		null,
		model.supplementPatchFromDetails({ ...row("done_populated"), version: 2 }),
		0,
	);
	assert.equal(first.state, "done");
	// The journaled v1 row of the same anchor arrives after its v2 sibling (a
	// replay, a re-read): refused, and the settled record is untouched.
	const replayed = model.mergeSupplement(
		first,
		model.supplementPatchFromDetails({ ...row("decided"), version: 1 }),
		0,
	);
	assert.equal(replayed, null);
});

test("same version cannot walk back the state rank; a higher version resets", () => {
	const running = model.mergeSupplement(
		null,
		model.supplementPatchFromEvent({
			anchor: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
			job: "3f9c1a7e5b20",
			version: 3,
			state: "running",
		}),
		0,
	);
	assert.equal(running.state, "running");
	const backToQueued = model.mergeSupplement(
		running,
		model.supplementPatchFromDetails({ ...row("queued_no_files"), version: 3 }),
		0,
	);
	assert.equal(
		backToQueued,
		null,
		"queued does not outrank running at one version",
	);
	const v4 = model.mergeSupplement(
		running,
		model.supplementPatchFromDetails({ ...row("queued_no_files"), version: 4 }),
		0,
	);
	assert.equal(v4.state, "queued");
	assert.equal(v4.version, 4);
});

test("a live beat lands on the anchored record and flips the stale rule", () => {
	const persisted = record("queued_no_files", false);
	// The cold reading of a `queued` row is the stale arm (the memo's rule);
	// one live beat of the same version settles it into the preparing arm.
	assert.equal(
		model.supplementDisposition(persisted, false),
		"cancelled_retry",
	);
	const beat = model.mergeSupplement(
		persisted,
		model.supplementPatchFromEvent({
			anchor: persisted.anchor,
			job: persisted.job,
			version: 1,
			state: "queued",
		}),
		0,
	);
	assert.equal(beat.live, true);
	assert.equal(model.supplementDisposition(beat, true), "preparing");
});

// --- the frame wire (messages/messages.json) --------------------------------

test("accepted frame->host shapes pass, with the minted nonce", () => {
	for (const message of [
		{ lo: "supplement", v: 1, t: "ready" },
		{ lo: "supplement", v: 1, t: "resize", h: 312, n: NONCE },
		{
			lo: "supplement",
			v: 1,
			t: "error",
			msg: "unknown dataset missing",
			n: NONCE,
		},
		{ lo: "supplement", v: 1, t: "pong", n: NONCE },
	]) {
		const accepted = model.acceptFrameMessage(message, NONCE);
		assert.ok(accepted, JSON.stringify(message));
		assert.equal(accepted.t, message.t);
	}
	// The accept step validates shape and returns the message as it arrived; the
	// CLAMP is the host's own step (the prelude's heights are trusted for shape,
	// never for size), applied where a resize is recorded.
	assert.equal(
		model.acceptFrameMessage(
			{ lo: "supplement", v: 1, t: "resize", h: 9999, n: NONCE },
			NONCE,
		).h,
		9999,
	);
	assert.equal(model.clampFrameHeight(9999), 480);
	assert.equal(model.clampFrameHeight(1), 120);
	assert.equal(model.clampFrameHeight(312), 312);
});

test("every rejected shape in the fixture is rejected here", () => {
	const rejected = [
		{ lo: "supplement", v: 1, t: "resize", h: 312 },
		{ lo: "supplement", v: 1, t: "resize", h: 312, n: "n-old" },
		{ lo: "supplement", v: 1, t: "pong" },
		{ lo: "supplement", v: 1, t: "error", msg: "x" },
		{ lo: "supplement", v: 1, t: "resize", h: -1, n: NONCE },
		{ lo: "supplement", v: 1, t: "resize", h: true, n: NONCE },
		{ lo: "supplement", v: 1, t: "navigate", n: NONCE },
		{ lo: "supplement", v: 2, t: "pong", n: NONCE },
		{ lo: "supplement-host", v: 1, t: "pong", n: NONCE },
		{ lo: "supplement", v: 1, t: "error", msg: 3, n: NONCE },
		{ lo: "supplement", v: 1, t: "error", msg: "x".repeat(301), n: NONCE },
	];
	for (const message of rejected) {
		assert.equal(
			model.acceptFrameMessage(message, NONCE),
			null,
			JSON.stringify(message),
		);
	}
	// A host with no nonce yet (a beat arriving before the first push committed)
	// accepts nothing that moves state.
	assert.equal(
		model.acceptFrameMessage(
			{ lo: "supplement", v: 1, t: "resize", h: 100, n: NONCE },
			"",
		),
		null,
	);
});

test("the nonce boundary is 64 characters, as the fixture pins", () => {
	const max = "a".repeat(64);
	const over = "a".repeat(65);
	assert.ok(
		model.acceptFrameMessage(
			{ lo: "supplement", v: 1, t: "pong", n: max },
			max,
		),
	);
	assert.equal(
		model.acceptFrameMessage(
			{ lo: "supplement", v: 1, t: "pong", n: over },
			over,
		),
		null,
	);
	assert.equal(model.mintNonce().length <= model.NONCE_MAX_CHARS, true);
});

// --- the paint boundary -----------------------------------------------------

test("display text strips control sequences, collapses whitespace, trims", () => {
	assert.equal(model.displayText("plain name.md"), "plain name.md");
	assert.equal(model.displayText("a\u001b[31mb\u001b[0m"), "ab");
	assert.equal(model.displayText("a\u001b]0;title\u0007b"), "ab");
	assert.equal(model.displayText("  a \n b \t c  "), "a b c");
	assert.equal(model.displayText("\u0000\u0007x"), "x");
	// Non-strings read as "", the TUI's own rule: a malformed row paints
	// nothing rather than stringifying arbitrary wire traffic.
	assert.equal(model.displayText(42), "");
	assert.equal(model.displayText(null), "");
});

test("the copy table is byte-identical to the TUI's constants", () => {
	assert.equal(model.COPY_PREPARING, "Preparing highlights…");
	assert.equal(model.COPY_CANCELLED, "Highlights cancelled");
	assert.equal(model.COPY_FAILED, "Couldn't prepare highlights");
	assert.equal(model.COPY_FRAME_FALLBACK, "Couldn't render this graphic");
	assert.equal(model.COPY_ADJUST, "Adjust…");
	assert.equal(model.COPY_CANCEL, "Cancel");
	assert.equal(model.COPY_RETRY, "Retry");
	assert.equal(model.moreText(1), "1 more file");
	assert.equal(model.moreText(3), "3 more files");
	assert.equal(
		model.filesSummaryLine(["a.md", "b.csv"]),
		"2 files: a.md, b.csv",
	);
	assert.equal(model.filesSummaryLine(["a.md"]), "1 file: a.md");
});

// --- the mount URL and the budget -------------------------------------------

test("the frame URL is a base64 data: URL whose bytes decode to the document", () => {
	const html = "<!doctype html><p>héllo — ×</p>";
	const url = model.supplementFrameUrl(html);
	assert.ok(url.startsWith("data:text/html;base64,"), url.slice(0, 40));
	const decoded = Buffer.from(url.split(",")[1], "base64").toString("utf8");
	assert.equal(decoded, html);
});

test("component mounts stay inside the aggregate budget", () => {
	const component = (hint, id) => ({
		attachment: id.padEnd(32, "0").slice(0, 32),
		title: id,
		source: "s",
		mime: "text/html",
		heightHint: hint,
	});
	// Three 320px frames under a 360px budget: the first fits, the rest wait.
	const plan = model.planComponentMounts(
		[component(320, "a"), component(320, "b"), component(320, "c")],
		360,
	);
	assert.equal(plan.visible.length, 1);
	assert.equal(plan.hidden.length, 2);
	// Everything under a tall budget mounts.
	const all = model.planComponentMounts(
		[component(120, "a"), component(120, "b")],
		480,
	);
	assert.equal(all.visible.length, 2);
	assert.equal(all.hidden.length, 0);
	// A first frame taller than the budget mounts nothing — the disclosure is the
	// whole block, which is the only honest reading of "cumulative ≤ budget".
	const none = model.planComponentMounts([component(480, "a")], 360);
	assert.equal(none.visible.length, 0);
	assert.equal(none.hidden.length, 1);
	// The hint is clamped at the contract's bounds before it is planned.
	assert.equal(
		model.clampedHeightHint(component(999, "a")),
		model.HEIGHT_HINT_MAX,
	);
	assert.equal(
		model.clampedHeightHint(component(1, "a")),
		model.HEIGHT_HINT_MIN,
	);
});

// --- the two envelopes ------------------------------------------------------

test("a supplement row's key is its anchor, under both envelope spellings", () => {
	const anchor = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
	const key = model.supplementRecordKey(anchor);
	assert.equal(
		model.supplementKeyForEntry({
			payload: { custom_type: "supplement_v1", details: { anchor } },
		}),
		key,
	);
	assert.equal(
		model.supplementKeyForEntry({
			payload: {
				kind: "custom",
				custom_type: "supplement_v1",
				details: { anchor },
			},
		}),
		key,
	);
	assert.equal(
		model.supplementKeyForEntry({ payload: { custom_type: "other" } }),
		null,
	);
	assert.equal(model.supplementKeyForEntry({ payload: {} }), null);
});

test("row parsing keeps only the contract's fields and bounds the more list", () => {
	const details = {
		anchor: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
		job: "3f9c1a7e5b20",
		version: 1,
		state: "done",
		files: [{ path: "a.md", name: "a.md" }, { nope: true }],
		files_more: 2,
		more: [...Array(30)].map((_, i) => `f${i}.md`),
		components: [],
	};
	const patch = model.supplementPatchFromDetails(details);
	assert.equal(patch.files.length, 1);
	assert.equal(patch.more.length, model.MORE_MAX);
	assert.equal(patch.filesMore, 2);
	// An unknown state parses to nothing rather than a fabricated one.
	assert.equal(
		model.supplementPatchFromDetails({ ...details, state: "exploded" }),
		null,
	);
	// An anchor-less row is not addressable and is refused.
	assert.equal(
		model.supplementPatchFromDetails({ ...details, anchor: "" }),
		null,
	);
});
