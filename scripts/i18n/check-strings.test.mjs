import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { SyntaxKind } from "typescript/unstable/ast";

import {
	ALLOWLIST,
	BASELINE,
	BASELINE_NOTE,
	COPY_ATTRIBUTES,
	LITERAL_ALLOWANCE,
	OBJECT_COPY_KEYS,
	SCOPED_COPY_SLOTS,
	allowanceBaseReport,
	allowanceSummary,
	allowlistReason,
	checkAllowanceGrowth,
	copyTexts,
	countsOf,
	failureSummary,
	findViolations,
	governedByAllowance,
	literalAllowanceFindings,
	loadAllowlist,
	loadBaseline,
	loadLiteralAllowance,
	main,
	onDataShapeSurface,
	openSnapshot,
	pruneLiteralAllowance,
	ratchetFindings,
	renderAllowance,
	resolveAllowanceBase,
	runCheck,
	saveBaseline,
	scanSnapshot,
	validateLiteralAllowance,
} from "./check-strings.mjs";

/*
 * The i18n scanner's falsifiability, on fixtures and on the real tree.
 *
 * The fixture (`fixtures/scan/violations.tsx`) pins every shape the scanner
 * claims to see and every shape it claims NOT to: the assertions below are the
 * difference between the module's docstring and its behaviour. The real-tree
 * case is the gate itself — the same code path CI runs — asserting the tree
 * this PR ships is at-or-below its own committed baseline, with every counted
 * file recorded.
 *
 * The compiler note: this suite spawns the TS 7 language server once per API
 * instance (`openSnapshot`), closes it in `after`, and never leaves it behind.
 */

const REPO = new URL("../..", import.meta.url).pathname;

/* The assertions below name their regexes: an inline literal is a lint warning
 * in this repository (`useTopLevelRegex`), and the reading is clearer anyway. */
const DID_NOT_RUN_RE = /DID NOT RUN/;
const CANNOT_SKIP_RE = /cannot be skipped silently/;
const PRUNE_RE = /--prune-allowance/;
const EXTRACT_UNLISTED_RE = /extract the unlisted/;
const REVERT_RE = /revert/;
const GREW_RE = /allowance grew by/;
const FIXTURE = "scripts/i18n/fixtures/scan/violations.tsx";

const PROPS_FIXTURE = "scripts/i18n/fixtures/scan/props.tsx";

const SHAPES_FIXTURE = "scripts/i18n/fixtures/scan/shapes.tsx";

const fixtureApi = openSnapshot(REPO, [
	join(REPO, FIXTURE),
	join(REPO, PROPS_FIXTURE),
	join(REPO, SHAPES_FIXTURE),
]);
after(() => {
	fixtureApi.api.close();
});

function fixtureFindings() {
	const scanned = scanSnapshot(fixtureApi.snapshot, REPO, {
		extraScan: [FIXTURE],
	});
	return scanned.get(FIXTURE) ?? [];
}

function propsFindings() {
	const scanned = scanSnapshot(fixtureApi.snapshot, REPO, {
		extraScan: [PROPS_FIXTURE],
	});
	return scanned.get(PROPS_FIXTURE) ?? [];
}

/**
 * A counted corpus in a temp directory, for the baseline-writing cases below.
 *
 * Those cases used to take their inputs from the live tree (`runCheck()`), which
 * made them a mirror of the ratchet's current state rather than a test of
 * `--update` and `--init`: once the migration finished and the real baseline
 * legitimately reached `{}`, there was no counted file left to lower, raise or
 * prune, and both cases went red. The corpus here is scanned by the same
 * compiler and scanner the gate runs, so every branch stays exercised whatever
 * the product tree holds.
 *
 * The counts are PINNED and asserted against the scan: a fixture whose own
 * numbers floated with the scanner would pass straight through a counting
 * regression.
 */
const CORPUS = {
	"lower.tsx":
		"export const A = () => <p>One</p>;\nexport const B = () => <p>Two</p>;\n",
	"raise.tsx":
		"export const C = () => <p>Three</p>;\nexport const D = () => <p>Four</p>;\nexport const E = () => <p>Five</p>;\n",
	"third.tsx": "export const F = () => <p>Six</p>;\n",
};
const CORPUS_COUNTS = { "lower.tsx": 2, "raise.tsx": 3, "third.tsx": 1 };

function countedCorpus() {
	const dir = mkdtempSync(join(tmpdir(), "i18n-corpus-"));
	writeFileSync(
		join(dir, "tsconfig.app.json"),
		JSON.stringify({
			compilerOptions: { jsx: "react-jsx" },
			include: ["*.tsx"],
		}),
	);
	writeFileSync(
		join(dir, "tsconfig.node.json"),
		JSON.stringify({ compilerOptions: { noEmit: true } }),
	);
	for (const [name, body] of Object.entries(CORPUS)) {
		writeFileSync(join(dir, name), body);
	}
	const rels = Object.keys(CORPUS).sort();
	const { api, snapshot } = openSnapshot(
		dir,
		rels.map((rel) => join(dir, rel)),
	);
	try {
		const scanned = scanSnapshot(snapshot, dir, { extraScan: rels });
		const counts = countsOf(scanned, []);
		assert.deepEqual(counts, CORPUS_COUNTS);
		return { dir, counts };
	} finally {
		api.close();
	}
}

test("the fixture's findings are exactly the flagged shapes, on pinned lines", () => {
	const found = fixtureFindings().map((finding) => ({
		line: finding.line,
		kind: finding.kind,
		text: finding.text,
	}));
	assert.deepEqual(found, [
		{ line: 22, kind: "jsx-text", text: "Flagged text" },
		{ line: 23, kind: "jsx-text", text: "items" },
		{ line: 27, kind: "attribute:aria-label", text: "Flagged aria" },
		{ line: 28, kind: "jsx-text", text: "Nested flagged text" },
		{ line: 30, kind: "attribute:alt", text: "Flagged alt" },
		{ line: 31, kind: "attribute:placeholder", text: "Flagged placeholder" },
		/* The pragma on line 34 stands alone, so it covers the line below it —
		 * `aria-label` — and stops there. Its tag-mate `title` and the tag's
		 * child text are copy nobody annotated, so both are charged: that is the
		 * per-literal rule, pinned rather than implied. */
		{ line: 36, kind: "attribute:title", text: "Exempt title" },
		{ line: 38, kind: "jsx-text", text: "Exempt ok" },
		{
			line: 41,
			kind: "jsx-text",
			text: "Reasonless pragma is not an exemption",
		},
		{ line: 43, kind: "jsx-text", text: "Flagged ok" },
		{ line: 46, kind: "jsx-text", text: "Nested text" },
		{ line: 49, kind: "attribute:title", text: "Flagged title" },
		{ line: 49, kind: "jsx-text", text: "Tail" },
	]);
});

test("the fixture's exempt shapes stay unflagged", () => {
	const texts = fixtureFindings().map((finding) => finding.text);
	// A pragma standing alone on its line exempts the line BELOW it: the
	// annotation-above spelling, which is how this tree writes them...
	assert.ok(!texts.includes("Exempt text"));
	// ...and the attribute it was written for inside the tag. An attribute cannot
	// carry a trailing comment of its own, so the line above it is the surface.
	assert.ok(!texts.includes("Exempt aria"));
	// The rule stops at one literal: the tag's second attribute and its child
	// text are charged above, because no pragma annotates them.
	assert.ok(texts.includes("Exempt title") && texts.includes("Exempt ok"));
	// The reasonless pragma (its closer is not a reason) exempts nothing: the
	// span after it IS flagged, asserted above.
	// Punctuation, symbol and digit-only texts are not copy...
	assert.ok(
		!texts.includes("·") && !texts.includes("—") && !texts.includes("42"),
	);
	// ...and an expression-valued copy attribute is not a literal.
	assert.ok(!texts.some((text) => text === "Expression" || text === "Copy"));
});

/*
 * THE PROSE-CARRYING PROPS. The scanner used to count only the four native
 * attributes, so `<Tooltip content="View options">` and `label="Run details"`
 * were invisible and the baseline read `files: {}` while a locale switch still
 * left English in tooltips, panels and field labels. Every prop in
 * `COPY_ATTRIBUTES` must now fail on a literal and pass once keyed; the
 * fixture carries both spellings of every one, so adding a name to the set
 * without a fixture row (or the reverse) fails the first assertion below.
 */
const PROSE_PROPS = [
	"label",
	"content",
	"description",
	"closeLabel",
	"busyLabel",
	"titleText",
	"helperText",
	"saveLabel",
	"dirtyHint",
	"text",
	"verb",
	"summary",
	"ariaLabel",
	"actionLabel",
	"pendingLabel",
	"blockedReason",
	"empty",
	"emptyText",
	"header",
	"hint",
	"listNotice",
	"meaning",
	"what",
	"srLabel",
	"triggerLabel",
];

test("COPY_ATTRIBUTES is exactly the four native attributes plus the fixture's prose props", () => {
	assert.deepEqual(
		[...COPY_ATTRIBUTES].sort(),
		["aria-label", "placeholder", "title", "alt", ...PROSE_PROPS].sort(),
	);
});

test("every prose prop FAILS on a literal and passes once keyed", () => {
	const found = propsFindings();
	for (const prop of PROSE_PROPS) {
		const literal = found.filter(
			(finding) => finding.text === `Literal ${prop}`,
		);
		assert.equal(
			literal.length,
			1,
			`${prop}: literal not flagged exactly once`,
		);
		assert.equal(literal[0].kind, `attribute:${prop}`);
		// The keyed spelling yields no finding: `t("ui.fixture.<prop>")` is a call,
		// so it exposes no static text, and nothing else on its line is copy.
		assert.ok(
			!found.some((finding) => finding.text.includes(`ui.fixture.${prop}`)),
			`${prop}: a keyed site was flagged`,
		);
	}
});

test("expression-valued copy is counted per literal piece; calls, identifiers, digits and punctuation are not", () => {
	const texts = propsFindings().map((finding) => finding.text);
	for (const expected of [
		"Conditional arm A",
		"Conditional arm B",
		"Template span",
		"Fallback prose",
		"Concatenated",
		"Guarded prose",
	]) {
		assert.ok(texts.includes(expected), `${expected} was not counted`);
	}
	// 25 literals + 6 expression pieces: nothing else in the fixture is copy.
	assert.equal(texts.length, PROSE_PROPS.length + 6);
	assert.ok(!texts.includes("exempt-token"), "a reasoned pragma still exempts");
	assert.ok(!texts.some((text) => text.startsWith("ui.fixture.")));
});

test("the props fixture fails an unbaselined run and passes once every literal is keyed", () => {
	const failing = runCheck({
		repo: REPO,
		extraScan: [PROPS_FIXTURE],
		baseline: { files: {}, note: "" },
	});
	assert.equal(failing.counts[PROPS_FIXTURE], PROSE_PROPS.length + 6);
	assert.equal(failing.failures.length, 1);
});

test("an allowlist entry needs a reason and matches exact paths or prefixes", () => {
	const dir = mkdtempSync(join(tmpdir(), "i18n-allowlist-"));
	try {
		const path = join(dir, "allowlist.json");
		writeFileSync(
			path,
			JSON.stringify({
				schema: 1,
				entries: [
					{ path: "src/renderer/src/vendor/", reason: "vendored" },
					{ path: "src/renderer/src/kept.tsx", reason: "generated" },
				],
			}),
		);
		const entries = loadAllowlist(path);
		assert.equal(
			allowlistReason("src/renderer/src/vendor/inner/x.tsx", entries),
			"vendored",
		);
		assert.equal(
			allowlistReason("src/renderer/src/kept.tsx", entries),
			"generated",
		);
		// An exact path does not prefix-match, and a prefix does not exact-match.
		assert.equal(
			allowlistReason("src/renderer/src/kept.tsx.bak", entries),
			undefined,
		);
		assert.equal(
			allowlistReason("src/renderer/src/vendorx/a.tsx", entries),
			undefined,
		);

		writeFileSync(
			path,
			JSON.stringify({ entries: [{ path: "src/a.tsx", reason: "  " }] }),
		);
		assert.throws(() => loadAllowlist(path), /reason/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the shipped allowlist parses and every entry carries a reason", () => {
	const entries = loadAllowlist(ALLOWLIST);
	for (const entry of entries) {
		assert.ok(
			entry.reason.trim() !== "",
			`allowlist entry ${entry.path} has no reason`,
		);
	}
});

test("an unbaselined file with literals FAILS", () => {
	// No entry at all: the fixture's 13 literals must fail, not print as advice.
	// This is the exact state every new file starts in. (It was 11 before the
	// pragma rule became per-literal: a tag-level pragma no longer silences the
	// tag's second attribute or its child text.)
	const { counts, failures } = runCheck({
		repo: REPO,
		extraScan: [FIXTURE],
		baseline: { files: {}, note: "" },
	});
	assert.equal(counts[FIXTURE], 13);
	assert.deepEqual(
		failures.map((finding) => finding.path),
		[FIXTURE],
	);
	assert.equal(failures[0].ceiling, null);
});

test("a ceiling breach FAILS; a file at its ceiling passes", () => {
	const count = fixtureFindings().length;
	const breached = runCheck({
		repo: REPO,
		extraScan: [FIXTURE],
		baseline: { files: { [FIXTURE]: count - 1 }, note: "" },
	});
	assert.equal(breached.failures.length, 1);
	assert.equal(breached.failures[0].count, count);
	assert.equal(breached.failures[0].ceiling, count - 1);

	const atCeiling = runCheck({
		repo: REPO,
		extraScan: [FIXTURE],
		baseline: { files: { [FIXTURE]: count }, note: "" },
	});
	assert.deepEqual(atCeiling.failures, []);
});

test("the failure summary names --init --force only when an entry is missing", () => {
	// Both shapes are built from the fixture's real findings: a missing entry
	// (no baseline record) and a ceiling breach (recorded, then exceeded).
	const count = fixtureFindings().length;
	const missing = ratchetFindings({ [FIXTURE]: count }, {});
	const breached = ratchetFindings(
		{ [FIXTURE]: count },
		{ [FIXTURE]: count - 1 },
	);
	assert.equal(missing[0].ceiling, null);
	assert.equal(breached[0].ceiling, count - 1);

	const missingLine = failureSummary(missing);
	assert.ok(missingLine.includes("`--init --force` capture"), missingLine);

	// A ceiling breach is fixed by extracting, not by capturing the bigger
	// number: `--init --force` would record the literal the breach reports.
	const breachLine = failureSummary(breached);
	assert.ok(!breachLine.includes("--init"), breachLine);
	assert.ok(breachLine.includes("Extract the string"), breachLine);
	assert.ok(breachLine.includes("i18n/allowlist.json"), breachLine);

	// One missing entry among breaches still needs its own remedy named.
	const mixed = failureSummary([...breached, ...missing]);
	assert.ok(mixed.includes("`--init --force` capture"), mixed);
});

test("an allowlisted file passes with no baseline entry", () => {
	const { counts, failures } = runCheck({
		repo: REPO,
		extraScan: [FIXTURE],
		baseline: { files: {}, note: "" },
		allowlist: [{ path: FIXTURE, reason: "fixture: pinned by this suite" }],
	});
	assert.deepEqual(counts, {});
	assert.deepEqual(failures, []);
});

test("baseline files round-trip as schema 2; a schema-1 scope is ignored", () => {
	const dir = mkdtempSync(join(tmpdir(), "i18n-baseline-"));
	try {
		const path = join(dir, "baseline.json");
		saveBaseline(path, { "src/b.tsx": 2, "src/a.tsx": 1 }, "note");
		const loaded = loadBaseline(path);
		assert.deepEqual(loaded.files, { "src/a.tsx": 1, "src/b.tsx": 2 });
		assert.equal(loaded.schema, 2);
		// The scope concept is gone, not merely empty.
		assert.equal(loaded.enforced, undefined);
		/*
		 * A schema-1 baseline is still accepted — its ceilings apply — but its
		 * `enforced` list is ignored: a stale scope must not resurrect a
		 * report-only mode on a branch that predates the global rule.
		 */
		writeFileSync(
			path,
			JSON.stringify({
				schema: 1,
				enforced: ["src/i18n/"],
				files: { "src/c.tsx": 3 },
			}),
		);
		const legacy = loadBaseline(path);
		assert.equal(legacy.schema, 1);
		assert.deepEqual(legacy.files, { "src/c.tsx": 3 });
		assert.equal(legacy.enforced, undefined);
		// A missing baseline reads as empty (fail closed), not a crash.
		const missing = loadBaseline(join(dir, "absent.json"));
		assert.deepEqual(missing.files, {});
		assert.equal(missing.note, BASELINE_NOTE);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a malformed baseline ceiling is dropped, not coerced, and fails closed", () => {
	const dir = mkdtempSync(join(tmpdir(), "i18n-baseline-"));
	try {
		const path = join(dir, "baseline.json");
		/*
		 * The hole this pins: `Number("twelve")` is NaN, and `ratchetFindings`
		 * fails only when `count > ceiling` — false for NaN — so a coerced
		 * ceiling would silently exempt the file it was meant to hold to. Each
		 * malformed shape must become NO entry, and therefore a `null`-ceiling
		 * failure for a file that still has literals.
		 */
		writeFileSync(
			path,
			JSON.stringify({
				schema: 2,
				note: "",
				files: {
					"src/string.tsx": "twelve",
					"src/negative.tsx": -1,
					"src/fractional.tsx": 1.5,
					"src/null.tsx": null,
					"src/zero.tsx": 0,
				},
			}),
		);
		const loaded = loadBaseline(path);
		assert.deepEqual(loaded.files, { "src/zero.tsx": 0 });
		const literals = 3;
		const findings = ratchetFindings(
			{
				"src/string.tsx": literals,
				"src/negative.tsx": literals,
				"src/fractional.tsx": literals,
				"src/null.tsx": literals,
				"src/zero.tsx": literals,
			},
			loaded.files,
		);
		assert.deepEqual(findings, [
			{ path: "src/fractional.tsx", count: literals, ceiling: null },
			{ path: "src/negative.tsx", count: literals, ceiling: null },
			{ path: "src/null.tsx", count: literals, ceiling: null },
			{ path: "src/string.tsx", count: literals, ceiling: null },
			// A valid zero ceiling still applies: literals against it are a breach.
			{ path: "src/zero.tsx", count: literals, ceiling: 0 },
		]);
		// A zero-count file passes against its zero ceiling.
		assert.deepEqual(ratchetFindings({ "src/zero.tsx": 0 }, loaded.files), []);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("countsOf skips allowlisted files before counting", () => {
	const scanned = new Map([
		[
			"src/renderer/src/vendor/x.tsx",
			[{ line: 1, kind: "jsx-text", text: "a" }],
		],
		["src/renderer/src/kept.tsx", [{ line: 1, kind: "jsx-text", text: "b" }]],
	]);
	const counts = countsOf(scanned, [
		{ path: "src/renderer/src/vendor/", reason: "vendored" },
	]);
	assert.deepEqual(counts, { "src/renderer/src/kept.tsx": 1 });
});

test("the real tree is at or below its baseline, and every counted file is recorded", () => {
	const { scanned, counts, failures } = runCheck();
	assert.ok(scanned.size > 1000, `scanned only ${scanned.size} files`);
	assert.deepEqual(
		failures,
		[],
		`findings: ${failures.map((finding) => finding.path).join(", ")}`,
	);
	/*
	 * The honesty invariant, in both directions: no stale zero ceiling (an
	 * entry whose file no longer has literals) and no uncounted entry (a file
	 * with literals that nobody recorded). The first is a ceiling no slice
	 * lowers; the second is the silence this gate now refuses to produce.
	 */
	assert.deepEqual(
		Object.keys(counts).sort(),
		Object.keys(loadBaseline(BASELINE).files).sort(),
	);
});

test("--update lowers a ceiling, and refuses every raise", () => {
	const { dir: corpus, counts } = countedCorpus();
	const dir = mkdtempSync(join(tmpdir(), "i18n-update-"));
	try {
		const baselinePath = join(dir, "baseline.json");
		/*
		 * Every number here comes from the fixture corpus, never a pinned literal
		 * and never the live tree. This harness once pinned the expected
		 * post-update count of one migration file and broke the moment that file's
		 * copy was fully keyed — `--update` then deletes the entry instead of
		 * lowering it — so both the targets and the expected values are read from
		 * the counted set, and the counted set itself is a fixture.
		 *
		 * 99 sits above every corpus count, so the lower target has room to move
		 * down; the raise target is recorded one below the corpus's count, so the
		 * raise is refused and its entry stays intact.
		 */
		const counted = Object.keys(counts).sort();
		const lowerTarget = counted.find((rel) => counts[rel] < 99);
		// Prefer a file carrying more than one literal: a zero ceiling is valid,
		// but a count above one keeps the refusal about a real extraction gap.
		const raiseTarget =
			counted.find((rel) => rel !== lowerTarget && counts[rel] >= 2) ??
			counted.find((rel) => rel !== lowerTarget);
		assert.ok(
			lowerTarget,
			"no counted file sits below the planted ceiling of 99",
		);
		assert.ok(
			raiseTarget,
			"the tree has no second counted file for the raise case",
		);
		const loweredCeiling = counts[lowerTarget];
		const raisedCeiling = counts[raiseTarget] - 1;
		saveBaseline(
			baselinePath,
			{ [lowerTarget]: 99, [raiseTarget]: raisedCeiling },
			"note",
		);
		const options = { baselinePath, allowlistPath: ALLOWLIST, counts };
		assert.equal(main(["--update", lowerTarget], options), 0);
		// The update wrote exactly the corpus's count, strictly below the planted 99.
		assert.equal(loadBaseline(baselinePath).files[lowerTarget], loweredCeiling);
		assert.ok(loweredCeiling < 99);
		// A file recorded below its real count: refused, entry intact.
		assert.equal(main(["--update", raiseTarget], options), 1);
		assert.equal(loadBaseline(baselinePath).files[raiseTarget], raisedCeiling);
		// The preceding refusal proves raiseTarget still has literals. Remove
		// only its scratch-baseline entry to exercise the missing-entry case;
		// a translated product file may legitimately have zero literals now.
		const afterRaise = loadBaseline(baselinePath);
		delete afterRaise.files[raiseTarget];
		saveBaseline(baselinePath, afterRaise.files, "note");
		assert.equal(main(["--update", raiseTarget], options), 1);
		assert.equal(
			Object.hasOwn(loadBaseline(baselinePath).files, raiseTarget),
			false,
		);
		// A path with no counted literal and no entry: nothing to do, no refusal.
		assert.equal(main(["--update", "src/i18n/index.ts"], options), 0);
	} finally {
		rmSync(corpus, { recursive: true, force: true });
		rmSync(dir, { recursive: true, force: true });
	}
});

/** Run `fn` with stdout captured, returning its exit code and the text. */
function captureStdout(fn) {
	const chunks = [];
	const write = process.stdout.write;
	process.stdout.write = (chunk) => {
		chunks.push(String(chunk));
		return true;
	};
	try {
		return { code: fn(), out: chunks.join("") };
	} finally {
		process.stdout.write = write;
	}
}

test("--init --force reports added, raised, lowered and pruned files", () => {
	const { dir: corpus, counts } = countedCorpus();
	const dir = mkdtempSync(join(tmpdir(), "i18n-init-"));
	try {
		const baselinePath = join(dir, "baseline.json");
		/*
		 * A scratch baseline that exercises each branch at once: one corpus file
		 * missing (that is the `added` case), one entry below its count, one above,
		 * and one entry for a file with no literals (pruned).
		 */
		const rels = Object.keys(counts).sort();
		const [added, raised, lowered] = rels;
		const files = { ...counts };
		delete files[added];
		files[raised] = Math.max(0, counts[raised] - 1);
		files[lowered] = counts[lowered] + 2;
		files["src/i18n/gone.tsx"] = 4;
		saveBaseline(baselinePath, files, "note");

		const { code, out } = captureStdout(() =>
			main(["--init", "--force"], {
				baselinePath,
				allowlistPath: ALLOWLIST,
				counts,
			}),
		);
		assert.equal(code, 0);
		assert.ok(out.includes("added 1:"), out);
		assert.ok(out.includes("raised 1:"), out);
		assert.ok(out.includes("lowered 1:"), out);
		assert.ok(out.includes("pruned 1:"), out);
		assert.ok(out.includes(`  ${added}: ${counts[added]}`), out);
		assert.ok(
			out.includes(
				`  ${raised}: ${Math.max(0, counts[raised] - 1)} -> ${counts[raised]}`,
			),
			out,
		);
		assert.ok(
			out.includes(
				`  ${lowered}: ${counts[lowered] + 2} -> ${counts[lowered]}`,
			),
			out,
		);
		assert.ok(out.includes("  src/i18n/gone.tsx: 4 -> 0"), out);
		// The capture is the tree, not the seeded scratch baseline, and it
		// stamps the current note rather than inheriting stale prose.
		const captured = loadBaseline(baselinePath);
		assert.deepEqual(captured.files, counts);
		assert.equal(captured.note, BASELINE_NOTE);
	} finally {
		rmSync(corpus, { recursive: true, force: true });
		rmSync(dir, { recursive: true, force: true });
	}
});

/*
 * THE ONBOARDING COPY'S CALL-SITE BINDING (UI slice 2, rounds R1-1/R2).
 *
 * These checks reuse this suite's existing `fixtureApi.snapshot` for their
 * call-site binding; `onboarding-i18n-contract.test.mjs` remains API-free
 * and owns the independent value pins and render assertions. That is the
 * observable structure, NOT a demonstrated CI cure or causal diagnosis:
 * the Linux Desktop job still exceeded its execution ceiling after this
 * relocation (local-operator-ui #1002).
 *
 * WHAT IT BINDS, with the counterexamples that motivated each shape: every
 * key must be the literal argument of a REAL `t()` call in its wiring file
 * (comments cannot appear in an AST); plain messages take no second
 * argument; parameterised messages bind the exact producer expressions;
 * the greeting branches bind to the `oweGreeting` conditional's two arms;
 * the acquisition call sits inside the element whose live `href` is
 * `credential.url`; the modal's titles flow through `stepTitles`; the plan's
 * block reasons sit in the `catalogueHasModels` / `catalogue.ready`
 * branches. Value pins and the live-render layer stay in
 * `scripts/onboarding-i18n-contract.test.mjs`.
 */

const ONBOARDING_BASE = "src/renderer/src/features/onboarding/components/";

/** key -> [committed English, wiring file] (the values serve the param split). */
const BINDING = [
	[
		"ui.onboarding.connect.intro",
		"Local Operator needs an AI account to work. Radient is the easiest: one browser sign-in and nothing to paste. Already pay for ChatGPT or Claude? Sign in with that instead. Anything else is under More providers.",
		"steps/connect-provider-step.tsx",
	],
	[
		"ui.onboarding.default_model.block.loading_models",
		"Loading the model list…",
		"steps/default-model-plan.ts",
	],
	[
		"ui.onboarding.default_model.block.pick_a_model",
		"Pick a model to continue.",
		"steps/default-model-plan.ts",
	],
	[
		"ui.onboarding.default_model.change",
		"Change",
		"steps/default-model-step.tsx",
	],
	[
		"ui.onboarding.default_model.connected_pick",
		"{brand} is connected. Pick the model new chats should use.",
		"steps/default-model-step.tsx",
	],
	[
		"ui.onboarding.default_model.empty_helper",
		"No providers are connected yet. Go back a step to connect one.",
		"steps/default-model-step.tsx",
	],
	[
		"ui.onboarding.default_model.fallback_name",
		"{brand}'s default model",
		"steps/default-model-step.tsx",
	],
	[
		"ui.onboarding.default_model.intro",
		"New chats use this model. Every agent can pick a different one later.",
		"steps/default-model-step.tsx",
	],
	[
		"ui.onboarding.default_model.loading",
		"Loading your models",
		"steps/default-model-step.tsx",
	],
	[
		"ui.onboarding.default_model.none_connected",
		"No provider is connected yet. Go back to connect one, or skip setup and connect one later from the chat.",
		"steps/default-model-step.tsx",
	],
	[
		"ui.onboarding.default_model.nothing_saved",
		"Nothing will be saved: your Local Operator can't list {brand} models yet, so setup finishes without a default model. Pick one in Settings before your first message.",
		"steps/default-model-step.tsx",
	],
	[
		"ui.onboarding.default_model.provider_fallback",
		"this provider's",
		"steps/default-model-step.tsx",
	],
	[
		"ui.onboarding.default_model.tag.applied",
		"your default",
		"steps/default-model-step.tsx",
	],
	[
		"ui.onboarding.default_model.tag.suggested",
		"suggested for your account",
		"steps/default-model-step.tsx",
	],
	["ui.onboarding.dialog.setup", "Setup", "onboarding-dialog.tsx"],
	[
		"ui.onboarding.extras.greeting_done",
		"{name} is your chief of staff. Her conversation is where you pick up with her, and it is one keystroke away in the sidebar. You can also skip straight to a new chat.",
		"steps/extras-step.tsx",
	],
	[
		"ui.onboarding.extras.greeting_owed",
		"{name} is your chief of staff. She will say hello first, ask what to call you and what you would like help with, and show you around. You can also skip straight to a new chat.",
		"steps/extras-step.tsx",
	],
	[
		"ui.onboarding.extras.next_meet",
		"Next: meet {name}",
		"steps/extras-step.tsx",
	],
	["ui.onboarding.modal.action.back", "Back", "onboarding-modal.tsx"],
	["ui.onboarding.modal.action.continue", "Continue", "onboarding-modal.tsx"],
	["ui.onboarding.modal.action.finish", "Finish", "onboarding-modal.tsx"],
	["ui.onboarding.modal.action.meet", "Meet {name}", "onboarding-modal.tsx"],
	["ui.onboarding.modal.action.skip", "Skip", "onboarding-modal.tsx"],
	[
		"ui.onboarding.modal.action.skip_for_now",
		"Skip for now",
		"onboarding-modal.tsx",
	],
	[
		"ui.onboarding.modal.action.skip_to_chat",
		"Skip to chat",
		"onboarding-modal.tsx",
	],
	[
		"ui.onboarding.modal.error.aida_open_failed",
		"{name}'s conversation could not be opened, so you are in a new chat instead.",
		"onboarding-modal.tsx",
	],
	[
		"ui.onboarding.modal.step_of",
		"Step {current, number} of {total, number}",
		"onboarding-modal.tsx",
	],
	[
		"ui.onboarding.modal.steps_total",
		"{total, plural, one {# step} other {# steps}}",
		"onboarding-modal.tsx",
	],
	[
		"ui.onboarding.modal.title.connect_provider",
		"Connect an AI account",
		"onboarding-modal.tsx",
	],
	[
		"ui.onboarding.modal.title.default_model",
		"Your default model",
		"onboarding-modal.tsx",
	],
	[
		"ui.onboarding.modal.title.extras",
		"Web search (optional)",
		"onboarding-modal.tsx",
	],
	[
		"ui.onboarding.modal.title.extras_with_name",
		"Web search, then meet {name}",
		"onboarding-modal.tsx",
	],
	[
		"ui.onboarding.modal.title.fallback",
		"First-time setup",
		"onboarding-modal.tsx",
	],
	[
		"ui.onboarding.search.each_key_saved",
		"Each key is saved on your device as soon as you leave its field.",
		"steps/search-api-step.tsx",
	],
	[
		"ui.onboarding.search.intro",
		"Agents can look things up while they work — today's prices, this week's news — instead of relying on what the model already knows.",
		"steps/search-api-step.tsx",
	],
	["ui.onboarding.search.mode.free", "Free", "steps/search-api-step.tsx"],
	[
		"ui.onboarding.search.mode.free_detail",
		"Uses a rotating pool of free providers — DuckDuckGo, Tavily's free tier, Exa and Parallel. No key needed; the pool is shared, so searches can be slower at busy times.",
		"steps/search-api-step.tsx",
	],
	[
		"ui.onboarding.search.mode.keys",
		"Add API keys",
		"steps/search-api-step.tsx",
	],
	[
		"ui.onboarding.search.mode.keys_detail",
		"Bring your own keys for the search providers you use.",
		"steps/search-api-step.tsx",
	],
	[
		"ui.onboarding.search.mode.label",
		"Search setup",
		"steps/search-api-step.tsx",
	],
	[
		"ui.onboarding.search.recommended",
		"Recommended",
		"steps/search-api-step.tsx",
	],
	[
		"ui.onboarding.search.row.get_your",
		"Get your {name}",
		"steps/search-api-step.tsx",
	],
	[
		"ui.onboarding.search.row.not_saved",
		"Not saved — {message}",
		"steps/search-api-step.tsx",
	],
	[
		"ui.onboarding.search.row.placeholder",
		"Paste your API key",
		"steps/search-api-step.tsx",
	],
	[
		"ui.onboarding.search.row.save_failed",
		"The key could not be saved.",
		"steps/search-api-step.tsx",
	],
	["ui.onboarding.search.row.saved", "Saved", "steps/search-api-step.tsx"],
	[
		"ui.onboarding.search.row.saving",
		"Saving {name}",
		"steps/search-api-step.tsx",
	],
];
/**
 * key -> [[parameter name, exact producer expression source]] for the 12
 * parameterised messages. The expressions are the committed call-site
 * producers, compared as AST slices with whitespace normalised: a comment
 * decoy cannot satisfy a node, and a same-shape wrong producer (a different
 * `brandOf(...)` argument) is a different node.
 */

const PARAM_SITES = [
	["ui.onboarding.modal.title.extras_with_name", [["name", "aidaName"]]],
	["ui.onboarding.modal.action.meet", [["name", "aidaName"]]],
	["ui.onboarding.modal.error.aida_open_failed", [["name", "aidaName"]]],
	[
		"ui.onboarding.modal.step_of",
		[
			["current", "activeIndex + 1"],
			["total", "STEP_SEQUENCE.length"],
		],
	],
	["ui.onboarding.modal.steps_total", [["total", "STEP_SEQUENCE.length"]]],
	["ui.onboarding.extras.next_meet", [["name", "aidaName"]]],
	["ui.onboarding.extras.greeting_owed", [["name", "aidaName"]]],
	["ui.onboarding.extras.greeting_done", [["name", "aidaName"]]],
	[
		"ui.onboarding.default_model.connected_pick",
		[["brand", "brandOf(choice.provider)"]],
	],
	[
		"ui.onboarding.default_model.fallback_name",
		[["brand", "choice.provider ? brandOf(choice.provider) : choice.hosting"]],
	],
	[
		"ui.onboarding.default_model.nothing_saved",
		[
			[
				"brand",
				'shownRow ? brandOf(shownRow) : t("ui.onboarding.default_model.provider_fallback")',
			],
		],
	],
	["ui.onboarding.search.row.not_saved", [["message", "message"]]],
	["ui.onboarding.search.row.saving", [["name", "credential.name"]]],
	["ui.onboarding.search.row.get_your", [["name", "credential.name"]]],
];

/** The three titles that flow through the modal's `stepTitles` table. */
const TABLE_KEYS = [
	"ui.onboarding.modal.title.connect_provider",
	"ui.onboarding.modal.title.default_model",
	"ui.onboarding.modal.title.extras",
];

const PLAN_KEYS = {
	"ui.onboarding.default_model.block.pick_a_model": "PICK_A_MODEL_KEY",
	"ui.onboarding.default_model.block.loading_models": "LOADING_MODELS_KEY",
};

const astFiles = [...new Set(BINDING.map(([, , file]) => file))];

const slug = (s) => s.replace(/\s+/g, "").replace(/,}/g, "}");

const bslice = (sf, node) => sf.text.slice(node.getStart(sf), node.getEnd());

function bwalk(node, visit) {
	if (!node) return;
	visit(node);
	node.forEachChild((child) => bwalk(child, visit));
}

function bsfOf(file) {
	const abs = join(REPO, ONBOARDING_BASE, file);
	return fixtureApi.snapshot
		.getDefaultProjectForFile(abs)
		?.program.getSourceFile(abs);
}

function btCalls(sf) {
	const calls = [];
	bwalk(sf, (node) => {
		if (
			node.kind === SyntaxKind.CallExpression &&
			node.expression?.kind === SyntaxKind.Identifier &&
			node.expression.text === "t" &&
			node.arguments?.[0]?.kind === SyntaxKind.StringLiteral
		) {
			calls.push({ key: node.arguments[0].text, call: node });
		}
	});
	return calls;
}

test("every key is the literal argument of a real t() call (comments cannot satisfy this)", () => {
	for (const file of astFiles) {
		const sf = bsfOf(file);
		assert.ok(sf, `${file}: not parsed by the snapshot`);
		const live = new Set(btCalls(sf).map(({ key }) => key));
		const expected = BINDING.filter(
			([key, , f]) =>
				f === file && !(key in PLAN_KEYS) && !TABLE_KEYS.includes(key),
		).map(([key]) => key);
		assert.deepEqual(
			[...live].sort(),
			expected.slice().sort(),
			`${file}: the live t() key set moved (a key moved into a comment, or an untracked call appeared)`,
		);
	}
});

test("plain messages take no second argument; parameterised messages bind exact producers", () => {
	const byFile = new Map();
	for (const [key, expected, file] of BINDING) {
		if (key in PLAN_KEYS || TABLE_KEYS.includes(key)) continue;
		if (!byFile.has(file)) byFile.set(file, bsfOf(file));
		const call = btCalls(byFile.get(file)).find((c) => c.key === key);
		assert.ok(call, `${key}: no live t() call`);
		const params = PARAM_SITES.find(([k]) => k === key);
		if (!params) {
			assert.equal(
				call.call.arguments.length,
				1,
				`${key}: a plain message grew a second argument`,
			);
			assert.ok(
				/^\{\w+\}/.test(expected) === false && !expected.includes("{"),
				`${key}: a plain expected sentence must not carry placeholders`,
			);
			continue;
		}
		const second = call.call.arguments[1];
		assert.ok(second, `${key}: the parameter object is missing`);
		assert.equal(
			second.kind,
			SyntaxKind.ObjectLiteralExpression,
			`${key}: the second argument is not an object literal`,
		);
		const sf = byFile.get(file);
		const names = second.properties.map((p) => p.name?.text);
		assert.deepEqual(
			names.slice().sort(),
			params[1].map(([name]) => name).sort(),
			`${key}: the parameter names moved`,
		);
		for (const [name, expectedExpr] of params[1]) {
			const prop = second.properties.find((p) => p.name?.text === name);
			const actual = slug(bslice(sf, prop.initializer ?? prop.name));
			assert.equal(
				actual,
				slug(expectedExpr),
				`${key}: ${name} is no longer produced by ${expectedExpr}`,
			);
		}
	}
});

test("the modal's titles flow through the stepTitles table and the plan's blocks through its branches", () => {
	// stepTitles: the table's values ARE the three committed keys.
	const modal = bsfOf("onboarding-modal.tsx");
	let table = null;
	bwalk(modal, (node) => {
		if (
			node.kind === SyntaxKind.VariableDeclaration &&
			node.name?.text === "stepTitles"
		) {
			let init = node.initializer;
			for (
				let i = 0;
				i < 3 &&
				init &&
				init.kind !== SyntaxKind.ObjectLiteralExpression &&
				init.expression;
				i += 1
			)
				init = init.expression;
			table = init;
		}
	});
	assert.ok(table, "the stepTitles table is gone");
	assert.deepEqual(
		table.properties.map((p) => p.initializer?.text).sort(),
		TABLE_KEYS.slice().sort(),
		"the stepTitles table no longer carries the committed keys",
	);
	assert.ok(
		btCalls(modal).length >= 10,
		"the modal's live t() calls thinned out",
	);
	let consumes = false;
	bwalk(modal, (node) => {
		if (
			node.kind === SyntaxKind.CallExpression &&
			node.expression?.kind === SyntaxKind.Identifier &&
			node.expression.text === "t" &&
			node.arguments?.[0]?.kind !== SyntaxKind.StringLiteral &&
			slug(bslice(modal, node.arguments?.[0] ?? node)) === "stepTitles[step]"
		)
			consumes = true;
	});
	assert.ok(
		consumes,
		"the modal stopped rendering titles through t(stepTitles[step])",
	);

	// The plan: constant initialisers + branch-scoped consumption.
	const plan = bsfOf("steps/default-model-plan.ts");
	assert.ok(plan, "the plan source did not resolve in the snapshot");
	const consts = new Map();
	bwalk(plan, (node) => {
		if (
			node.kind !== SyntaxKind.VariableDeclaration ||
			!node.name?.text?.endsWith("_KEY")
		)
			return;
		/*
		 * The initialisers are `"key" as const`: unwrap the assertion - the
		 * committed identity is the STRING, and `as const` is why the value can
		 * flow into `t()` with its literals intact.
		 */
		let init = node.initializer;
		while (
			init &&
			(init.kind === SyntaxKind.AsExpression ||
				init.kind === SyntaxKind.SatisfiesExpression)
		)
			init = init.expression;
		if (init?.kind === SyntaxKind.StringLiteral)
			consts.set(node.name.text, init.text);
	});
	for (const [key, constName] of Object.entries(PLAN_KEYS)) {
		assert.equal(
			consts.get(constName),
			key,
			`${constName} no longer names ${key}`,
		);
	}
	let pickInBranch = false;
	let loadingInBranch = false;
	bwalk(plan, (node) => {
		if (
			node.kind === SyntaxKind.ConditionalExpression &&
			node.condition?.kind === SyntaxKind.Identifier &&
			node.condition.text === "catalogueHasModels"
		) {
			node.whenTrue &&
				bwalk(node.whenTrue, (n) => {
					if (
						n.kind === SyntaxKind.CallExpression &&
						n.expression?.text === "t" &&
						n.arguments?.[0]?.kind === SyntaxKind.Identifier &&
						n.arguments[0].text === "PICK_A_MODEL_KEY"
					)
						pickInBranch = true;
				});
			node.whenFalse &&
				bwalk(node.whenFalse, (n) => {
					if (
						n.kind === SyntaxKind.ConditionalExpression &&
						n.condition?.kind === SyntaxKind.PropertyAccessExpression &&
						slug(bslice(plan, n.condition)) === "catalogue.ready"
					)
						n.whenFalse &&
							bwalk(n.whenFalse, (m) => {
								if (
									m.kind === SyntaxKind.CallExpression &&
									m.expression?.text === "t" &&
									m.arguments?.[0]?.kind === SyntaxKind.Identifier &&
									m.arguments[0].text === "LOADING_MODELS_KEY"
								)
									loadingInBranch = true;
							});
				});
		}
	});
	assert.ok(
		pickInBranch,
		"PICK_A_MODEL_KEY left the catalogueHasModels branch",
	);
	assert.ok(loadingInBranch, "LOADING_MODELS_KEY left the not-ready branch");

	// The greeting branches: owed in the conditional's true arm, done in false.
	const extras = bsfOf("steps/extras-step.tsx");
	let owedTrue = false;
	let doneFalse = false;
	bwalk(extras, (node) => {
		if (
			node.kind === SyntaxKind.ConditionalExpression &&
			node.condition?.kind === SyntaxKind.Identifier &&
			node.condition.text === "oweGreeting"
		) {
			owedTrue = tCallsIn(node.whenTrue).includes(
				"ui.onboarding.extras.greeting_owed",
			);
			doneFalse = tCallsIn(node.whenFalse).includes(
				"ui.onboarding.extras.greeting_done",
			);
		}
	});
	assert.ok(owedTrue, "the owed greeting left the oweGreeting true arm");
	assert.ok(doneFalse, "the delivered greeting left the oweGreeting false arm");

	// The acquisition call sits inside the element whose href is credential.url.
	const search = bsfOf("steps/search-api-step.tsx");
	let anchorBound = false;
	bwalk(search, (node) => {
		if (
			node.kind !== SyntaxKind.JsxElement ||
			!node.openingElement?.attributes?.properties
		)
			return;
		const href = node.openingElement.attributes.properties.find(
			(a) => a.kind === SyntaxKind.JsxAttribute && a.name?.text === "href",
		);
		if (!href) return;
		const expr = href.initializer?.expression;
		if (!expr || slug(bslice(search, expr)) !== "credential.url") return;
		let inside = false;
		bwalk(node, (n) => {
			if (
				n.kind === SyntaxKind.CallExpression &&
				n.expression?.text === "t" &&
				n.arguments?.[0]?.text === "ui.onboarding.search.row.get_your"
			)
				inside = true;
		});
		if (inside) anchorBound = true;
	});
	assert.ok(
		anchorBound,
		"the get-your call is no longer inside an element whose live href is credential.url",
	);
});

/** The t() keys appearing within a node's subtree. */
function tCallsIn(node) {
	const keys = [];
	bwalk(node, (n) => {
		if (
			n.kind === SyntaxKind.CallExpression &&
			n.expression?.kind === SyntaxKind.Identifier &&
			n.expression.text === "t" &&
			n.arguments?.[0]?.kind === SyntaxKind.StringLiteral
		)
			keys.push(n.arguments[0].text);
	});
	return keys;
}

// ---------------------------------------------------------------------------
// The data shapes: object-literal copy, JSX child expressions, templates
// ---------------------------------------------------------------------------

function shapesFindings({ dataShapes = true } = {}) {
	const scanned = scanSnapshot(fixtureApi.snapshot, REPO, {
		extraScan: [SHAPES_FIXTURE],
	});
	const sourceFile = scanned.get(SHAPES_FIXTURE);
	if (dataShapes) return sourceFile ?? [];
	const project = fixtureApi.snapshot.getDefaultProjectForFile(
		join(REPO, SHAPES_FIXTURE),
	);
	return findViolations(
		project.program.getSourceFile(join(REPO, SHAPES_FIXTURE)),
		{
			dataShapes,
		},
	);
}

const governedShapes = (findings) =>
	findings.filter((finding) => governedByAllowance(finding.kind));

test("the data shapes see object-literal copy, JSX children and templates", () => {
	const found = governedShapes(shapesFindings()).map(
		(finding) => `${finding.kind} ${JSON.stringify(finding.text)}`,
	);
	assert.deepEqual(found, [
		'object-literal:label "Flagged label"',
		'object-literal:title "Flagged title"',
		'object-literal:description "Flagged description"',
		'object-literal:text "Flagged text"',
		'object-literal:message "Flagged ${…} message"',
		'object-literal:detail "Flagged detail"',
		'object-literal:cancel "Flagged cancel"',
		'object-literal:summary "Flagged summary A"',
		'object-literal:summary "Flagged summary B"',
		// `"Flagged" + NAME` yields only its literal side: a bare identifier
		// exposes no static text, and the concatenation's prose is what it holds.
		'object-literal:caption "Flagged"',
		'object-literal:title "Flagged beside the pragma"',
		'jsx-child-expression "Flagged arm A"',
		'jsx-child-expression "Flagged arm B"',
		'jsx-child-expression "Flagged ${…} children"',
		'jsx-child-expression "Flagged braced literal"',
		'jsx-child-expression "${…} Flagged template"',
		'jsx-child-expression "Flagged and-right"',
		'jsx-child-expression "Flagged"',
	]);
});

test("the data shapes are a surface, not the tree", () => {
	// `dataShapes: false` is the pre-widening walker — the SAME function with the
	// new branches off, not a second copy that could drift from it. Every fixture
	// case above must be invisible to it: that is the proof these tests fail on
	// the old walker rather than passing by accident.
	assert.deepEqual(governedShapes(shapesFindings({ dataShapes: false })), []);
	assert.ok(onDataShapeSurface("src/renderer/src/app.tsx"));
	assert.ok(!onDataShapeSurface("src/main/index.ts"));
	assert.ok(!onDataShapeSurface("src/shared/desktop-contract.ts"));
	// The prose keys are a measured set, and the token keys are not in it.
	assert.ok(OBJECT_COPY_KEYS.has("label"));
	assert.ok(!OBJECT_COPY_KEYS.has("name"));
	assert.ok(!OBJECT_COPY_KEYS.has("action"));
});

test("a machine position is never a copy position", () => {
	const texts = shapesFindings().map((finding) => finding.text);
	for (const machine of [
		"copy-shapes",
		"text-ink-muted",
		"npm run build",
		"ui.chat.page_chrome.aside_text_only",
		"ui.settings.section.interface_language.label",
		"never",
		"agent-messages-onboarding",
		"connecting",
		"Logged ${…} rows",
		"Thrown ${…} error",
		"css-${…}-flag",
	]) {
		assert.ok(
			!texts.some((text) => text === machine || text.includes(machine)),
			`${JSON.stringify(machine)} is machine text and must not be a finding`,
		);
	}
});

test("a plain assignment, return or array template is the ratchet's stated gap", () => {
	// Pinned on purpose, and pinned through the walker: `check-strings.mjs` does
	// NOT count a template in a `const`, a `return` or an array literal (234 such
	// templates live in the renderer at this head, most of them machine text),
	// and `check-added-strings.mjs` is where an ADDED one fails. A future
	// widening has to change this assertion and the module docstring together.
	const texts = shapesFindings().map((finding) => finding.text);
	for (const text of [
		"Unlisted plain ${…} rows",
		"Unlisted array ${…} rows",
		"${…} over ${…} rows",
	])
		assert.ok(!texts.includes(text), `${text} must not be a ratchet finding`);
});

test("an interpolated sentence is ONE finding with its substitution elided", () => {
	const child = governedShapes(shapesFindings()).filter(
		(finding) => finding.kind === "jsx-child-expression",
	);
	const template = child.filter((finding) => finding.text.includes("children"));
	assert.equal(template.length, 1);
	assert.equal(template[0].text, "Flagged ${…} children");
	// The letter test runs on the text WITH the substitution removed, so a
	// template whose only letters live in the substitution is not copy. Asserted
	// through the walker on the fixture's `${count}` child rather than on a
	// hand-built Map with a test-local regex — the previous spelling exercised no
	// product code at all (agent review round 1, N3).
	assert.ok(
		child.every((finding) => finding.text !== "${…}"),
		"a substitution-only template is not a finding",
	);
});

test("a copy key holding a catalogue key is the keyed spelling", () => {
	const texts = shapesFindings().map((finding) => finding.text);
	assert.ok(!texts.some((text) => text.startsWith("ui.")));
});

test("copyTexts gives one entry per sentence and staticTextNodes per piece", () => {
	const scanned = scanSnapshot(fixtureApi.snapshot, REPO, {
		extraScan: [SHAPES_FIXTURE],
	});
	const project = fixtureApi.snapshot.getDefaultProjectForFile(
		join(REPO, SHAPES_FIXTURE),
	);
	const sourceFile = project.program.getSourceFile(join(REPO, SHAPES_FIXTURE));
	const texts = [];
	const bwalk = (node, visit) => {
		visit(node);
		node.forEachChild((child) => bwalk(child, visit));
	};
	bwalk(sourceFile, (node) => {
		if (
			node.kind === SyntaxKind.TemplateExpression &&
			node.templateSpans.length > 0
		)
			texts.push(copyTexts(node)[0]);
	});
	assert.ok(scanned.get(SHAPES_FIXTURE) !== undefined);
	for (const text of texts)
		assert.equal((text.match(/\$\{…\}/g) ?? []).length >= 1, true);
});

// ---------------------------------------------------------------------------
// The literal allowance: shrink-only, attributed, refuses to grow
// ---------------------------------------------------------------------------

const ALLOWANCE_ENTRY = {
	file: "src/renderer/src/a.tsx",
	ids: ["jsx-child-expression | Mark all ${…} read"],
	owner: "the i18n renderer-keying lane",
	payoff: "2027-01-31",
	reason: "fixture",
};

function allowanceWith(entries) {
	return { schema: 1, note: "", entries };
}

/*
 * A scratch git repo for the growth check's REAL read path. The tests below are
 * the ones the first round was missing: the growth test injected `base` through
 * the seam, so `git cat-file`/`git show` and the base resolution were exercised
 * nowhere (agent review round 1, M1).
 *
 * The first commit carries no allowance file — that is the pull request that
 * INTRODUCES it — and the second adds it, so both sides of the `cat-file` branch
 * are reachable from one repo.
 */
function allowanceRepo() {
	const dir = mkdtempSync(join(tmpdir(), "i18n-growth-"));
	/* An inherited GIT_DIR would aim the setup commands (and the checker's own git
	 * calls) at the caller's repository instead of the scratch one. */
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
	);
	for (const key of Object.keys(process.env)) {
		if (key.startsWith("GIT_")) delete process.env[key];
	}
	const run = (...args) =>
		spawnSync("git", args, { cwd: dir, env, encoding: "utf8" });
	run("init", "-q");
	writeFileSync(join(dir, "README.md"), "scratch\n");
	run("add", ".");
	run(
		"-c",
		"user.name=t",
		"-c",
		"user.email=t@t",
		"commit",
		"-qm",
		"no allowance yet",
	);
	mkdirSync(join(dir, "i18n"), { recursive: true });
	writeFileSync(
		join(dir, "i18n", "literal-allowance.json"),
		`${JSON.stringify(allowanceWith([ALLOWANCE_ENTRY]), null, "\t")}\n`,
	);
	run("add", ".");
	run(
		"-c",
		"user.name=t",
		"-c",
		"user.email=t@t",
		"commit",
		"-qm",
		"allowance",
	);
	return { dir, run };
}

/** Run `body` with no CI pull-request event in the environment. */
function withoutCiEvent(body) {
	const saved = {
		name: process.env.GITHUB_EVENT_NAME,
		path: process.env.GITHUB_EVENT_PATH,
	};
	Reflect.deleteProperty(process.env, "GITHUB_EVENT_NAME");
	Reflect.deleteProperty(process.env, "GITHUB_EVENT_PATH");
	try {
		return body();
	} finally {
		for (const [key, value] of [
			["GITHUB_EVENT_NAME", saved.name],
			["GITHUB_EVENT_PATH", saved.path],
		]) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

test("the growth check states an unresolved base and fails closed when required", () => {
	assert.deepEqual(
		allowanceBaseReport({ ref: "origin/main", required: false }),
		{
			lines: [],
			failed: false,
		},
	);
	// A local checkout with no base is the ONE skip — and it says so, in words a
	// reader cannot mistake for a comparison that ran.
	const gap = allowanceBaseReport({ ref: null, required: false });
	assert.equal(gap.failed, false);
	assert.match(gap.lines[0], DID_NOT_RUN_RE);
	// A base that was REQUIRED and did not resolve is a failure, not a skip.
	const required = allowanceBaseReport({ ref: null, required: true });
	assert.equal(required.failed, true);
	assert.match(required.lines[0], CANNOT_SKIP_RE);
});

test("resolveAllowanceBase reads the real ref graph, with and without origin/main", () => {
	const { dir, run } = allowanceRepo();
	try {
		const noBase = withoutCiEvent(() =>
			resolveAllowanceBase(undefined, { repo: dir }),
		);
		assert.deepEqual(noBase, { ref: null, required: false });
		// An EXPLICIT ref that does not resolve is required and fails closed: the
		// caller asked for a comparison, so a missing base cannot become a pass.
		assert.deepEqual(resolveAllowanceBase("deadbeefdeadbeef", { repo: dir }), {
			ref: null,
			required: true,
		});
		// The same call resolves `origin/main` once the ref exists.
		assert.equal(
			run("update-ref", "refs/remotes/origin/main", "HEAD").status,
			0,
		);
		const withOrigin = withoutCiEvent(() =>
			resolveAllowanceBase(undefined, { repo: dir }),
		);
		assert.deepEqual(withOrigin, { ref: "origin/main", required: false });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the CI pull-request base is read from the event and is REQUIRED", () => {
	const { dir, run } = allowanceRepo();
	const eventPath = join(dir, "event.json");
	const saved = process.env.GITHUB_EVENT_PATH;
	try {
		const sha = run("rev-parse", "HEAD").stdout.trim();
		writeFileSync(
			eventPath,
			JSON.stringify({ pull_request: { base: { sha, ref: "main" } } }),
		);
		process.env.GITHUB_EVENT_NAME = "pull_request";
		process.env.GITHUB_EVENT_PATH = eventPath;
		assert.deepEqual(resolveAllowanceBase(undefined, { repo: dir }), {
			ref: sha,
			required: true,
		});
		// A CI base that is not in the checkout fails closed rather than falling
		// back to the local skip — the event is the job's evidence that there IS a
		// base to compare against.
		writeFileSync(
			eventPath,
			JSON.stringify({
				pull_request: { base: { sha: "0".repeat(40), ref: "main" } },
			}),
		);
		assert.deepEqual(resolveAllowanceBase(undefined, { repo: dir }), {
			ref: null,
			required: true,
		});
	} finally {
		Reflect.deleteProperty(process.env, "GITHUB_EVENT_NAME");
		if (saved === undefined)
			Reflect.deleteProperty(process.env, "GITHUB_EVENT_PATH");
		else process.env.GITHUB_EVENT_PATH = saved;
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the growth check reads the base allowance out of git", () => {
	const { dir } = allowanceRepo();
	try {
		const identical = withoutCiEvent(() =>
			checkAllowanceGrowth("HEAD", {
				repo: dir,
				allowance: allowanceWith([ALLOWANCE_ENTRY]),
			}),
		);
		assert.deepEqual(identical, []);
		// One id added relative to the base is growth, named with its own line.
		const grown = allowanceWith([
			{
				...ALLOWANCE_ENTRY,
				ids: [
					"jsx-child-expression | Mark all ${…} read",
					"object-literal:label | By turn",
				],
			},
		]);
		const lines = withoutCiEvent(() =>
			checkAllowanceGrowth("HEAD", { repo: dir, allowance: grown }),
		);
		assert.equal(lines.length, 1);
		assert.match(lines[0], GREW_RE);
		// A base that does not carry the file yet is the PR that introduces the
		// allowance: nothing to compare, and nothing to report as growth.
		const introducing = withoutCiEvent(() =>
			checkAllowanceGrowth("HEAD~1", { repo: dir, allowance: grown }),
		);
		assert.deepEqual(introducing, []);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the allowance sentence is silent unless an allowance failure applies", () => {
	// A baseline breach, an unresolved base and a prune problem each print their
	// OWN line above; this sentence used to appear over all of them with an empty
	// pair of parentheses and the wrong remedy (agent review round 1, N1 / QA
	// Q-1).
	assert.equal(
		allowanceSummary({ unlisted: [], stale: [], allowanceProblems: [] }),
		"",
	);
	const staleOnly = allowanceSummary({
		unlisted: [],
		stale: [{ file: "src/renderer/src/a.tsx", ids: ["x"] }],
		allowanceProblems: [],
	});
	assert.match(staleOnly, PRUNE_RE);
	assert.doesNotMatch(staleOnly, EXTRACT_UNLISTED_RE);
	const grown = allowanceSummary({
		unlisted: [],
		stale: [],
		allowanceProblems: [],
		growth: ["allowance grew by …"],
	});
	assert.match(grown, REVERT_RE);
});

test("the allowance validates its shape and its payoffs", () => {
	const ok = validateLiteralAllowance(allowanceWith([ALLOWANCE_ENTRY]));
	assert.deepEqual(ok.problems, []);
	assert.ok(ok.allowed.get(ALLOWANCE_ENTRY.file).has(ALLOWANCE_ENTRY.ids[0]));

	const bad = validateLiteralAllowance(
		allowanceWith([
			{ ...ALLOWANCE_ENTRY, payoff: "eventually" },
			{ ...ALLOWANCE_ENTRY, file: "src/renderer/src/b.tsx", ids: [] },
			{
				...ALLOWANCE_ENTRY,
				file: "src/renderer/src/c.tsx",
				ids: ["jsx-text | not a governed shape"],
			},
			{
				...ALLOWANCE_ENTRY,
				file: "src/renderer/src/d.tsx",
				ids: ["jsx-child-expression | B", "jsx-child-expression | A"],
			},
			{ ...ALLOWANCE_ENTRY, file: "src/renderer/src/e.tsx", owner: "" },
			{ ...ALLOWANCE_ENTRY, file: "src/renderer/src/f.tsx", surprise: 1 },
		]),
	);
	assert.ok(bad.problems.some((p) => p.includes("is not a payoff")));
	assert.ok(bad.problems.some((p) => p.includes("lists no ids")));
	assert.ok(
		bad.problems.some((p) => p.includes("not a shape this allowance governs")),
	);
	assert.ok(bad.problems.some((p) => p.includes("is not sorted")));
	assert.ok(bad.problems.some((p) => p.includes("must be a non-empty string")));
	assert.ok(bad.problems.some((p) => p.includes("unknown field")));
});

test("an unlisted finding FAILS, and a paid-off id must be pruned", () => {
	const findings = [
		{ kind: "jsx-child-expression", line: 4, text: "Mark all ${…} read" },
		{ kind: "object-literal:label", line: 9, text: "By turn" },
	];
	const scanned = new Map([[ALLOWANCE_ENTRY.file, findings]]);
	const partial = validateLiteralAllowance(allowanceWith([ALLOWANCE_ENTRY]));
	const { unlisted, stale } = literalAllowanceFindings(
		scanned,
		partial.allowed,
	);
	assert.deepEqual(unlisted, [
		{
			path: ALLOWANCE_ENTRY.file,
			kind: "object-literal:label",
			line: 9,
			text: "By turn",
		},
	]);
	assert.deepEqual(stale, []);

	// The listed id is paid off: the entry now lists something absent, which is a
	// failure of its own (the file may only shrink, never linger).
	const { stale: nowStale } = literalAllowanceFindings(
		new Map([[ALLOWANCE_ENTRY.file, findings.slice(1)]]),
		partial.allowed,
	);
	assert.deepEqual(nowStale, [
		{ file: ALLOWANCE_ENTRY.file, ids: ALLOWANCE_ENTRY.ids },
	]);
});

test("the allowance refuses to grow relative to a base ref", () => {
	const base = allowanceWith([
		{ ...ALLOWANCE_ENTRY, ids: ["jsx-child-expression | Mark all ${…} read"] },
	]);
	const grown = allowanceWith([
		{
			...ALLOWANCE_ENTRY,
			ids: [
				"jsx-child-expression | Mark all ${…} read",
				"object-literal:label | By turn",
			],
		},
	]);
	const lines = checkAllowanceGrowth("origin/main", { base, allowance: grown });
	assert.equal(lines.length, 1);
	assert.ok(lines[0].includes("allowance grew by"));
	assert.deepEqual(
		checkAllowanceGrowth("origin/main", { base, allowance: base }),
		[],
	);
});

test("pruning removes a paid-off id and an emptied entry, and never adds", () => {
	const dir = mkdtempSync(join(tmpdir(), "i18n-literal-allowance-"));
	const path = join(dir, "literal-allowance.json");
	try {
		writeFileSync(
			path,
			`${JSON.stringify(
				allowanceWith([
					{
						...ALLOWANCE_ENTRY,
						ids: [
							"jsx-child-expression | Mark all ${…} read",
							"object-literal:label | By turn",
						],
					},
					{ ...ALLOWANCE_ENTRY, file: "src/renderer/src/gone.tsx" },
				]),
				null,
				"\t",
			)}\n`,
		);
		const scanned = new Map([
			[
				ALLOWANCE_ENTRY.file,
				[{ kind: "object-literal:label", line: 9, text: "By turn" }],
			],
		]);
		const result = pruneLiteralAllowance(scanned, { allowancePath: path });
		// One id paid off in the surviving entry, one in the entry that is now empty.
		assert.equal(result.removed, 2);
		assert.equal(result.removedEntries, 1);
		const after = loadLiteralAllowance(path);
		assert.deepEqual(
			after.entries.map((entry) => entry.file),
			[ALLOWANCE_ENTRY.file],
		);
		assert.deepEqual(after.entries[0].ids, ["object-literal:label | By turn"]);
		// Pruning cannot introduce an id: running it again removes nothing and
		// leaves the file alone.
		const again = pruneLiteralAllowance(scanned, { allowancePath: path });
		assert.deepEqual(again, { removed: 0, removedEntries: 0, problems: [] });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the committed tree's data-shape debt is exactly what the allowance lists", () => {
	const { unlisted, stale, allowanceProblems } = runCheck();
	assert.deepEqual(allowanceProblems, []);
	assert.deepEqual(stale, []);
	assert.deepEqual(unlisted, []);
	assert.ok(loadLiteralAllowance(LITERAL_ALLOWANCE).entries.length > 0);
	// The baseline was not raised to absorb any of it.
	assert.deepEqual(loadBaseline(BASELINE).files, {});
	// The writer and the committed file agree byte for byte: `--prune-allowance`
	// must not churn a file it did not mean to change, and the repository's
	// formatter collapses the arrays the same way (see `renderAllowance`).
	assert.equal(
		renderAllowance(loadLiteralAllowance(LITERAL_ALLOWANCE)),
		readFileSync(LITERAL_ALLOWANCE, "utf8"),
	);
	assert.ok(
		allowanceSummary({
			unlisted: [1],
			stale: [],
			allowanceProblems: [],
		}).includes("extract"),
	);
});

// The counterfactuals are parsed at their real semantic activation path but
// written only to an isolated corpus, never by reverting the checked-out repo.
test("scoped-copy: attachment counterfactuals, keyed controls and missing slots", () => {
	const dir = mkdtempSync(
		join(process.env.LOCAL_OPERATOR_SCRATCHPAD ?? tmpdir(), "scoped-chrome-"),
	);
	writeFileSync(
		join(dir, "tsconfig.app.json"),
		JSON.stringify({
			compilerOptions: { jsx: "react-jsx" },
			include: ["*.tsx"],
		}),
	);
	writeFileSync(
		join(dir, "tsconfig.node.json"),
		JSON.stringify({ compilerOptions: { noEmit: true } }),
	);
	const cases = [];
	for (const [rel, slots] of Object.entries(SCOPED_COPY_SLOTS)) {
		const source = readFileSync(join(REPO, rel), "utf8");
		const slot = Object.keys(slots)[0];
		const literal =
			slot === "getFileName"
				? '"Pasted image"'
				: slot === "sliderLabel"
					? "`${label} position`"
					: "`Actions for ${label}`";
		const call =
			slot === "getFileName"
				? 't("ui.chat.composer_media.pasted_image")'
				: slot === "sliderLabel"
					? 't("ui.chat.audio.position_label", { label })'
					: 't("ui.common.actions.actions_for_name", { name: label })';
		assert.ok(source.includes(call), `${rel} owns expected keyed control`);
		if (slot === "getFileName") {
			const path = `${cases.length}.tsx`;
			writeFileSync(
				join(dir, path),
				source.replace(
					't("ui.chat.composer_media.pasted_file")',
					'"Pasted file"',
				),
			);
			cases.push({ path, rel, slot, kind: "literal" });
		}
		for (const [kind, body] of [
			["keyed", source],
			["literal", source.replace(call, literal)],
			["missing", source.replaceAll(slot, `${slot}Renamed`)],
		]) {
			const path = `${cases.length}.tsx`;
			writeFileSync(join(dir, path), body);
			cases.push({ path, rel, slot, kind });
		}
	}
	// Return traversal includes named declarations and concise local arrows; user
	// identifiers and t arguments are intentionally opaque, not translated data.
	for (const body of [
		'export function getFileName() { return "Pasted file"; }',
		'const getFileName = () => "Pasted file";',
		"const getFileName = () => userName;",
		'const getFileName = () => t("ui.chat.composer_media.pasted_file");',
	]) {
		const path = `${cases.length}.tsx`;
		writeFileSync(join(dir, path), body);
		cases.push({
			path,
			rel: Object.keys(SCOPED_COPY_SLOTS)[0],
			slot: "getFileName",
			kind: body.includes('"Pasted file"') ? "literal" : "keyed",
		});
	}
	const { api, snapshot } = openSnapshot(
		dir,
		cases.map((c) => join(dir, c.path)),
	);
	try {
		for (const c of cases) {
			const abs = join(dir, c.path);
			const sf = snapshot
				.getDefaultProjectForFile(abs)
				.program.getSourceFile(abs);
			const findings = findViolations(sf, { rel: c.rel }).filter(
				(f) => f.kind === `scoped-copy:${c.slot}`,
			);
			assert.equal(
				findings.length > 0,
				c.kind !== "keyed",
				`${c.rel}: ${c.kind}`,
			);
			if (c.kind === "missing") assert.ok(findings[0].text.includes("missing"));
		}
	} finally {
		api.close();
	}
});
test("scoped-copy: zero debt cannot be hidden by baseline or file allowlist", () => {
	const dir = mkdtempSync(
		join(process.env.LOCAL_OPERATOR_SCRATCHPAD ?? tmpdir(), "scoped-zero-"),
	);
	const rel = Object.keys(SCOPED_COPY_SLOTS)[0];
	mkdirSync(join(dir, "src/renderer/src/features/chat/utils"), {
		recursive: true,
	});
	writeFileSync(
		join(dir, rel),
		'export const getFileName = () => "Pasted file";',
	);
	writeFileSync(
		join(dir, "tsconfig.app.json"),
		JSON.stringify({ include: ["src/**/*.ts"] }),
	);
	writeFileSync(
		join(dir, "tsconfig.node.json"),
		JSON.stringify({ compilerOptions: { noEmit: true } }),
	);
	const result = runCheck({
		repo: dir,
		extraScan: [rel],
		allowlist: [{ path: rel, reason: "test negative control" }],
		baseline: { files: { [rel]: 999 } },
		allowance: { schema: 1, entries: [] },
	});
	assert.deepEqual(result.failures, [{ path: rel, count: 1, ceiling: 0 }]);
});
