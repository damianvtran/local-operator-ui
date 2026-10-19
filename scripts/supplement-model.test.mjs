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
			'export * from "./src/renderer/src/features/chat/canonical/supplement-model"; export * from "./src/shared/supplement-frame-url";',
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
	assert.equal(model.countClause(1, "file"), "1 file");
	assert.equal(model.countClause(2, "file"), "2 files");
	assert.equal(model.countClause(1, "graphic"), "1 graphic");
	assert.equal(model.countClause(2, "graphic"), "2 graphics");
});

test("the failed line's cause phrases are the TUI's one word list, byte-identical", () => {
	assert.equal(model.CAUSE_PHRASES.provider_quota, "provider limit reached");
	assert.equal(model.CAUSE_PHRASES.provider_auth, "provider sign-in needed");
	assert.equal(
		model.CAUSE_PHRASES.provider_transient,
		"provider temporarily unavailable",
	);
	assert.equal(model.CAUSE_PHRASES.provider_timeout, "provider timed out");
	assert.equal(
		model.CAUSE_PHRASES.provider_request,
		"provider refused the request",
	);
	assert.equal(
		model.CAUSE_PHRASES.provider_content,
		"provider blocked the content",
	);
	assert.equal(model.CAUSE_PHRASES.provider_context, "provider context limit");
	/*
	 * Unknown, empty and malformed tokens render NO phrase (design round 1,
	 * D2): the catch-all folds `aborted` in, and the bare sentence is the
	 * honest ceiling for a token the surface cannot name.
	 */
	for (const token of [
		"provider_unknown",
		"provider_from_the_future",
		"",
		undefined,
		42,
		null,
	]) {
		assert.equal(model.causePhrase(token), "", String(token));
	}
});

test("the typed cause is read bounded, additive, and version-reset like the error", () => {
	// A row carrying the vocabulary token keeps it on both envelopes.
	const withCause = { ...row("failed"), cause: "provider_quota" };
	for (const patch of [
		model.supplementPatchFromDetails(withCause),
		model.supplementPatchFromEvent(withCause),
	]) {
		assert.equal(patch.cause, "provider_quota");
	}
	// Absent or non-string causes add nothing: the row behaves exactly as today.
	for (const value of [undefined, 42, null, {}]) {
		const patch = model.supplementPatchFromDetails({
			...row("failed"),
			cause: value,
		});
		assert.equal(patch.cause, undefined, String(value));
	}
	// A runaway token is bounded at the core reader's own length; the truncated
	// spelling no longer matches the table, so the line renders bare.
	const patch = model.supplementPatchFromDetails({
		...row("failed"),
		cause: `provider_${"x".repeat(200)}`,
	});
	assert.equal(patch.cause.length, model.CAUSE_MAX_CHARS);
	assert.equal(model.causePhrase(patch.cause), "");
	// The merge carries a stated cause and resets it on a new version, like `error`.
	const first = model.mergeSupplement(
		null,
		model.supplementPatchFromDetails({
			...row("failed"),
			cause: "provider_auth",
		}),
		0,
	);
	assert.equal(first.cause, "provider_auth");
	const next = model.mergeSupplement(
		first,
		model.supplementPatchFromDetails({ ...row("failed"), version: 2 }),
		1,
	);
	assert.equal(next.cause, "");
	const restated = model.mergeSupplement(
		first,
		model.supplementPatchFromDetails({
			...row("failed"),
			cause: "provider_timeout",
		}),
		1,
	);
	assert.equal(restated.cause, "provider_timeout");
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
	// Everything under a tall budget mounts — once the first has REPORTED its
	// rendered height (the second waits behind the disclosure until then; D5's
	// hold-until-measured rule).
	const all = model.planComponentMounts(
		[component(120, "a"), component(120, "b")],
		480,
		new Map([["a".padEnd(32, "0").slice(0, 32), 120]]),
	);
	assert.equal(all.visible.length, 2);
	assert.equal(all.hidden.length, 0);
	// Cold, the same pair shows the first only.
	const cold = model.planComponentMounts(
		[component(120, "a"), component(120, "b")],
		480,
	);
	assert.equal(cold.visible.length, 1);
	assert.equal(cold.hidden.length, 1);
	// A first frame taller than the budget STILL mounts (the reader came for it);
	// only the frames beyond the budget wait behind the disclosure.
	const none = model.planComponentMounts([component(480, "a")], 360);
	assert.equal(none.visible.length, 1);
	assert.equal(none.hidden.length, 0);
	const tallPair = model.planComponentMounts(
		[component(480, "a"), component(480, "b")],
		360,
	);
	assert.equal(tallPair.visible.length, 1);
	assert.equal(tallPair.hidden.length, 1);
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

// --- the budget's accrual (D5) ---------------------------------------------

const blockRecord = (over) => ({
	kind: "supplement",
	ts: 1_791_000_060,
	anchor: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
	job: "3f9c1a7e5b20",
	version: 1,
	state: "done",
	files: [],
	filesMore: 0,
	more: [],
	components: [],
	error: "",
	dismissed: false,
	live: false,
	...over,
});
const comp = (seed, hint) => ({
	attachment: seed.padEnd(32, "0").slice(0, 32),
	title: seed,
	source: "s",
	mime: "text/html",
	heightHint: hint,
});

test("the budget accrues RENDERED heights once measured, hints until then (D5)", () => {
	const components = [comp("a", 120), comp("b", 120)];
	// NOTHING has reported yet: the walk holds at the first unmeasured
	// predecessor, so only the first frame is admitted (the second waits for the
	// first's rendered height).
	const cold = model.planComponentMounts(components, 408);
	assert.equal(cold.visible.length, 1);
	assert.equal(cold.hidden.length, 1);
	// The first reported SMALL (its hint was honest): the second mounts.
	const small = new Map([["a".padEnd(32, "0").slice(0, 32), 120]]);
	assert.equal(
		model.planComponentMounts(components, 408, small).visible.length,
		2,
	);
	// The field case the design measured: the first rendered 379px, so the
	// second is behind the disclosure — the 758px auto-mount against a ~408px
	// budget was the hint-only accrual's work.
	const measured = new Map([["a".padEnd(32, "0").slice(0, 32), 379]]);
	const one = model.planComponentMounts(components, 408, measured);
	assert.equal(one.visible.length, 1);
	assert.equal(one.hidden.length, 1);
	// A measured height is clamped to the contract before it accrues.
	const huge = new Map([["a".padEnd(32, "0").slice(0, 32), 9999]]);
	assert.equal(
		model.planComponentMounts(components, 408, huge).visible.length,
		1,
	);
	// The first frame always mounts, measured or not.
	assert.equal(
		model.planComponentMounts([comp("a", 480)], 100, huge).visible.length,
		1,
	);
});

test("the mount URL contract is the builder's output, byte for byte", () => {
	const url = model.supplementMountUrl("5ea1face0001", "a".repeat(32));
	assert.equal(url, `lo-supplement://s/5ea1face0001/${"a".repeat(32)}`);
	assert.deepEqual(model.parseSupplementMountUrl(url), {
		sessionId: "5ea1face0001",
		digest: "a".repeat(32),
	});
	for (const bad of [
		`${url}#f`,
		`${url}?q=1`,
		url.toUpperCase(),
		"data:text/html;base64,AAAA",
		"https://example.com/x",
		"",
	]) {
		assert.equal(model.parseSupplementMountUrl(bad), null, String(bad));
	}
});

test("typed diagnostics retain safe facts live and durable, never provider prose", () => {
	const payload = {
		...row("failed"),
		error: "generator:ProviderError",
		model: "openrouter/openai/gpt-6.1-sol",
		attempts: [
			"anthropic/claude-sonnet-5-5",
			"openrouter/openai/gpt-6.1-sol",
			"https://private.test/token",
		],
		detail: [
			"turn 1: ProviderError status=None kind=quota",
			"secret raw provider prose /Users/private/token",
		],
	};
	for (const patch of [
		model.supplementPatchFromDetails(payload),
		model.supplementPatchFromEvent(payload),
	]) {
		assert.equal(patch.model, "openrouter/openai/gpt-6.1-sol");
		assert.equal(patch.attempts.length, 2);
		assert.deepEqual(patch.detail, [
			"turn 1: ProviderError status=None kind=quota",
		]);
		const record = model.mergeSupplement(null, patch, 1);
		assert.ok(
			model.failureExplanation(record).includes("model is unavailable"),
		);
		const next = model.mergeSupplement(
			record,
			{
				anchor: record.anchor,
				job: record.job,
				version: record.version + 1,
				state: "queued",
			},
			2,
		);
		assert.deepEqual(next.detail, []);
		assert.deepEqual(next.attempts, []);
	}
	assert.ok(model.failureExplanation({ detail: [] }).includes("can retry"));
});

test("terminal bounds override recovered quota and prepared refusal stays fixed", () => {
	const detail = ["turn 1: ProviderError status=None kind=quota"];
	assert.ok(
		model
			.failureExplanation({ error: "bound:cost", detail })
			.includes("spending limit"),
	);
	assert.ok(
		!model
			.failureExplanation({ error: "bound:turns", detail })
			.includes("model is unavailable"),
	);
	assert.equal(model.diagnosticDisplay(detail[0]), "Attempt 1: quota");
	assert.equal(
		model.diagnosticDisplay("turn 2: ProviderError status=503 kind=transient"),
		"Attempt 2: transient (HTTP 503)",
	);
	assert.equal(model.diagnosticDisplay("raw private prose"), "");
	const patch = model.supplementPatchFromDetails({
		...row("done_files_only"),
		detail: ["prepared:unsupported", "private text"],
	});
	assert.deepEqual(patch.detail, ["prepared:unsupported"]);
});

/*
 * THE SOUNDS LIST (sound phase, 2026-10-17). `supplement_v1` rows gain a
 * `sounds` list; the merge rules are the components' own, and the absent case
 * must render nothing rather than an empty section (the brief's "never a stub").
 */

test("sounds parse off a row's details, drop malformed entries, and never invent one", () => {
	const digest = "d".repeat(32);
	const patch = model.supplementPatchFromDetails({
		...row("done_populated"),
		sounds: [
			{
				attachment: digest,
				mime: "audio/mpeg",
				title: "Storm swell",
				duration_s: 6.5,
			},
			// No digest: nothing could ever play it, so the entry is dropped
			// rather than listed as a dead player.
			{ mime: "audio/mpeg", title: "Nameless" },
			// A malformed digest is the same fact.
			{ attachment: "not-a-digest", title: "Broken" },
			// A stated-but-odd duration reads as absent, never as NaN.
			{ attachment: "e".repeat(32), mime: "audio/wav", duration_s: null },
		],
	});
	assert.deepEqual(patch.sounds, [
		{
			attachment: digest,
			mime: "audio/mpeg",
			title: "Storm swell",
			durationS: 6.5,
		},
		{
			attachment: "e".repeat(32),
			mime: "audio/wav",
			title: "",
			durationS: null,
		},
	]);
	// Absent on every row older than the wire change: an empty list, which the
	// block renders as nothing at all.
	assert.deepEqual(
		model.supplementPatchFromDetails(row("done_populated")).sounds,
		[],
	);
});

test("a restated sounds list keeps the previous array; a new one replaces it", () => {
	const digest = "f".repeat(32);
	const sound = {
		attachment: digest,
		mime: "audio/mpeg",
		title: "Chime",
		duration_s: 2,
	};
	const base = model.mergeSupplement(
		null,
		{
			anchor: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
			job: "3f9c1a7e5b20",
			version: 1,
			state: "done",
			sounds: model.soundsFrom([sound]),
		},
		0,
	);
	assert.equal(base.sounds.length, 1);
	// A later beat that says nothing about sounds keeps what the row held.
	const quiet = model.mergeSupplement(
		base,
		{
			anchor: base.anchor,
			job: base.job,
			version: 2,
			state: "done",
		},
		1,
	);
	assert.equal(
		quiet.sounds,
		base.sounds,
		"the same ARRAY survives, for the memoised row",
	);
	// The identical list restated is still the previous array (identity rule).
	const restated = model.mergeSupplement(
		base,
		{
			anchor: base.anchor,
			job: base.job,
			version: 3,
			state: "done",
			sounds: model.soundsFrom([sound]),
		},
		2,
	);
	assert.equal(restated.sounds, base.sounds);
	// A different list is a new one.
	const changed = model.mergeSupplement(
		base,
		{
			anchor: base.anchor,
			job: base.job,
			version: 4,
			state: "done",
			sounds: model.soundsFrom([{ ...sound, title: "Other" }]),
		},
		3,
	);
	assert.notEqual(changed.sounds, base.sounds);
	assert.equal(changed.sounds[0].title, "Other");
});

test("sounds-only done highlights remain visible", () => {
	const sound = model.supplementRecordFromDetails(1, {
		anchor: "answer",
		state: "done",
		sounds: [
			{
				attachment: "a".repeat(32),
				mime: "audio/wav",
				title: "Storm",
				duration_s: 12,
			},
		],
	});
	assert.equal(model.supplementDisposition(sound, false), "block");
});

test("local graphic reveal copy preserves singular/plural and overflow meaning", () => {
	assert.equal(model.graphicRevealText(1, false), "Show 1 graphic");
	assert.equal(model.graphicRevealText(1, true), "Hide 1 graphic");
	assert.equal(model.graphicRevealText(3, false), "Show 3 graphics");
	assert.equal(model.graphicRevealText(3, false, 1), "Show 1 of 3 graphics");
	assert.equal(model.graphicRevealText(3, true, 1), "Hide 3 graphics");
	assert.equal(model.graphicRevealText(3, true), "Hide 3 graphics");
	assert.equal(model.showAllText(2), "Show all 2 graphics");
});
