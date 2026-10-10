import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import {
	ALLOWLIST,
	BASELINE,
	allowlistReason,
	countsOf,
	inEnforcedScope,
	loadAllowlist,
	loadBaseline,
	main,
	openSnapshot,
	ratchetFindings,
	runCheck,
	saveBaseline,
	scanSnapshot,
} from "./check-strings.mjs";

/*
 * The i18n scanner's falsifiability, on fixtures and on the real tree.
 *
 * The fixture (`fixtures/scan/violations.tsx`) pins every shape the scanner
 * claims to see and every shape it claims NOT to: the assertions below are the
 * difference between the module's docstring and its behaviour. The real-tree
 * case is the gate itself — the same code path CI runs — asserting the tree
 * this PR ships is at-or-below its own committed baseline with nothing in the
 * enforced scope.
 *
 * The compiler note: this suite spawns the TS 7 language server once per API
 * instance (`openSnapshot`), closes it in `after`, and never leaves it behind.
 */

const REPO = new URL("../..", import.meta.url).pathname;
const FIXTURE = "scripts/i18n/fixtures/scan/violations.tsx";

const fixtureApi = openSnapshot(REPO, [join(REPO, FIXTURE)]);
after(() => {
	fixtureApi.api.close();
});

function fixtureFindings() {
	const scanned = scanSnapshot(fixtureApi.snapshot, REPO, {
		extraScan: [FIXTURE],
	});
	return scanned.get(FIXTURE) ?? [];
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
	// A pragma inside the element exempts the element's own text...
	assert.ok(!texts.includes("Exempt text"));
	// ...and one between attributes exempts the attribute copy after it (an
	// attribute cannot carry a comment of its own; the enclosing element is
	// the span the walker consults).
	assert.ok(!texts.includes("Exempt aria"));
	assert.ok(!texts.includes("Exempt title"));
	// The reasonless pragma (its closer is not a reason) exempts nothing: the
	// span after it IS flagged, asserted above.
	// Punctuation, symbol and digit-only texts are not copy...
	assert.ok(
		!texts.includes("·") && !texts.includes("—") && !texts.includes("42"),
	);
	// ...and an expression-valued copy attribute is not a literal.
	assert.ok(!texts.some((text) => text === "Expression" || text === "Copy"));
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

test("scope: prefixes match by segment, exact paths by equality", () => {
	// inEnforcedScope reads the same shapes as the allowlist on purpose: both
	// are review state a human writes, not patterns a machine expands.
	assert.equal(inEnforcedScope("src/i18n/messages.ts", ["src/i18n/"]), true);
	assert.equal(inEnforcedScope("src/i18n-extra/x.ts", ["src/i18n/"]), false);
	assert.equal(
		inEnforcedScope("src/main/index.ts", ["src/main/index.ts"]),
		true,
	);
	assert.equal(
		inEnforcedScope("src/main/index.tsx", ["src/main/index.ts"]),
		false,
	);
});

test("the ratchet fails only inside the enforced scope", () => {
	const counts = {
		"src/i18n/keys.gen.ts": 2, // enforced: 2 against ceiling 1
		"src/renderer/src/app.tsx": 5, // outside: 5 against ceiling 3
		"src/new-file.tsx": 1, // outside, no ceiling: starts at 0
		"src/clean.tsx": 0,
	};
	const baseline = {
		files: { "src/i18n/keys.gen.ts": 1, "src/renderer/src/app.tsx": 3 },
	};
	const out = ratchetFindings(counts, baseline.files).map(
		(finding) => finding.path,
	);
	assert.deepEqual(out, [
		"src/i18n/keys.gen.ts",
		"src/new-file.tsx",
		"src/renderer/src/app.tsx",
	]);
});

test("baseline files round-trip through save/load, and stay biome-shaped", () => {
	const dir = mkdtempSync(join(tmpdir(), "i18n-baseline-"));
	try {
		const path = join(dir, "baseline.json");
		saveBaseline(
			path,
			{ "src/b.tsx": 2, "src/a.tsx": 1 },
			["src/i18n/", "scripts/i18n/"],
			"note",
		);
		const loaded = loadBaseline(path);
		assert.deepEqual(loaded.files, { "src/a.tsx": 1, "src/b.tsx": 2 });
		assert.deepEqual(loaded.enforced, ["src/i18n/", "scripts/i18n/"]);
		// A missing baseline reads as the fail-closed default, not a crash.
		const missing = loadBaseline(join(dir, "absent.json"));
		assert.deepEqual(missing.enforced, ["src/i18n/", "scripts/i18n/"]);
		assert.deepEqual(missing.files, {});
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

test("the real tree is at or below its committed baseline; nothing enforced fails", () => {
	const { scanned, failures, advisories } = runCheck();
	assert.ok(scanned.size > 1000, `scanned only ${scanned.size} files`);
	assert.deepEqual(
		failures,
		[],
		`enforced findings: ${failures.map((finding) => finding.path).join(", ")}`,
	);
	// Advisories are the tree's real state and may be non-empty on any branch;
	// what must hold is that they are NOT failures.
	for (const advisory of advisories) {
		assert.equal(
			inEnforcedScope(advisory.path, loadBaseline(BASELINE).enforced),
			false,
		);
	}
});

test("--update lowers a ceiling, and refuses every raise", () => {
	const dir = mkdtempSync(join(tmpdir(), "i18n-update-"));
	try {
		const baselinePath = join(dir, "baseline.json");
		/*
		 * A REAL, baselined file rather than the excluded fixture: `--update`
		 * scans the tree's own corpus (fixtures are outside it by design), and
		 * 99 sits above this file's real count so the update has something to
		 * lower; the app.tsx entry sits BELOW its real count so the raise case
		 * has something to refuse.
		 */
		const lowerTarget =
			"src/renderer/src/features/agent-hub/agent-details-page.tsx";
		const raiseTarget =
			"src/renderer/src/features/agent-hub/agent-hub-page.tsx";
		saveBaseline(
			baselinePath,
			{ [lowerTarget]: 99, [raiseTarget]: 1 },
			["src/i18n/", "scripts/i18n/"],
			"note",
		);
		const options = { baselinePath, allowlistPath: ALLOWLIST };
		assert.equal(main(["--update", lowerTarget], options), 0);
		assert.equal(loadBaseline(baselinePath).files[lowerTarget], 16);
		// A file recorded at 1 while the tree carries 12: refused, entry intact.
		assert.equal(main(["--update", raiseTarget], options), 1);
		assert.equal(loadBaseline(baselinePath).files[raiseTarget], 1);
		// A file with NO entry that carries literals: refused, with the reason.
		assert.equal(
			main(
				[
					"--update",
					"src/renderer/src/features/projects/components/project-list.tsx",
				],
				options,
			),
			1,
		);
		assert.equal(
			Object.hasOwn(
				loadBaseline(baselinePath).files,
				"src/renderer/src/features/projects/components/project-list.tsx",
			),
			false,
		);
		// A clean file with no entry: nothing to do, no refusal.
		assert.equal(main(["--update", "src/i18n/index.ts"], options), 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
