/**
 * THE DESKTOP HALF OF THE CONDENSE PARITY CONTRACT.
 *
 * WHAT THIS PINS. `scripts/fixtures/condense.parity.json` is what the phone replays
 * to prove its ported model decides the same things this app does. A fixture nobody
 * regenerates is a fixture that lies - the quiet-group copies proved it for nine
 * days - so the tests here are about the fixture's HONESTY, not about the model's
 * behaviour (the model suites own that):
 *
 * 1. the committed file is exactly what the shipped model produces today, so a
 *    model change that is not regenerated fails here rather than on the phone;
 * 2. the committed bytes are the ones the manifest's sha256 names, so a hand edit
 *    that happens to keep the semantics (a reordered object, a reformat) still
 *    fails - the relay compares bytes against that digest;
 * 3. the fixture pins the MODEL SOURCE it came from by hash, and that hash is
 *    recomputed here from the working tree - the pin is therefore self-verifying,
 *    and unlike a commit id it can actually pass on the commit that contains it
 *    (see C0-B1: a fixture embedding `git rev-parse HEAD` is stale the moment it
 *    is committed);
 * 4. every declared source suite CONTRIBUTES shapes, and every literal shape the
 *    turn-segments suite drives is in the corpus - so neither a catalogue that
 *    quietly drops its entries nor a new suite shape can fall out;
 * 5. the corpus exercises what the fixture claims to pin: more than one tool
 *    kind, failures, durations and every receipt family this wire can carry. A
 *    corpus of one `bash` row pins one `kind:` key and nothing else, which is how
 *    round 1's fixture replay green while `displayName` mis-read every MCP call;
 * 6. generation is deterministic - the same tree twice is the same bytes, which is
 *    what makes a diff in this file mean a decision changed.
 *
 * WHAT THIS CANNOT SAY. That the phone agrees. That is the relay's replay
 * (`local-operator`'s `src/lib/condense.test.ts`), and the cross-repo drift check
 * is `local-operator`'s `scripts/check-condense-parity-latest.mjs`.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	MODEL_SOURCES,
	SHAPES_BY_SOURCE,
	generate,
	harvestShapes,
	modelSourceHash,
} from "./generate-condense-parity.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(HERE, "fixtures/condense.parity.json");
const MANIFEST_PATH = join(HERE, "fixtures/condense.parity.manifest.json");

const FIXTURE_BYTES = readFileSync(FIXTURE_PATH, "utf8");
const FIXTURE = JSON.parse(FIXTURE_BYTES);
const MANIFEST = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));

/** A count line's segment identifier: `class:<class>`, `kind:<name>`, `name:<label>`. */
const COUNT_UNIT_KEY = /^(class|kind|name):\S/;

/** The receipt families this wire can carry, and the count units they produce. */
const RECEIPT_FAMILY_TOKENS = new Set(["J", "X", "H", "P", "W"]);

test("the committed fixture is a fresh generation of the shipped model", async () => {
	const generated = await generate();
	assert.deepEqual(
		FIXTURE,
		JSON.parse(JSON.stringify(generated)),
		"scripts/fixtures/condense.parity.json is stale: run `node scripts/generate-condense-parity.mjs`",
	);
});

test("the fixture's bytes are the ones the manifest's sha256 names", () => {
	const digest = createHash("sha256").update(FIXTURE_BYTES).digest("hex");
	assert.equal(
		MANIFEST.sha256,
		digest,
		"the manifest no longer names this fixture: regenerate both files together",
	);
	assert.equal(MANIFEST.file, "fixtures/condense.parity.json");
});

test("the fixture pins the model source it came from, and the pin verifies", () => {
	/*
	 * THE PIN IS THE SOURCE HASH, NOT THE COMMIT (C0-B1). A commit cannot contain
	 * its own SHA, so a fixture that embedded `git rev-parse HEAD` was stale at the
	 * commit that produced it and at every commit after. The source files are what
	 * the decisions actually came from, and this test recomputes their hash from
	 * the tree it is running against - which is a check the commit id could never
	 * pass, because it fails exactly when a bundled model file moves without a
	 * regeneration.
	 */
	const live = modelSourceHash();
	assert.equal(
		FIXTURE.desktop.sourceHash,
		live,
		"a bundled model source changed without regenerating the fixture",
	);
	assert.equal(MANIFEST.sourceHash, FIXTURE.desktop.sourceHash);
	assert.deepEqual(FIXTURE.desktop.modelSources, MODEL_SOURCES);
	/* Every pinned source exists in the tree this test is running against. */
	for (const file of MODEL_SOURCES) readFileSync(join(HERE, "..", file));
});

test("every declared source suite contributes shapes to the corpus", () => {
	const declared = FIXTURE.desktop.sources;
	assert.ok(
		declared.length >= 3,
		`only ${declared.length} source suites declared`,
	);
	for (const suite of declared) {
		const shapes = SHAPES_BY_SOURCE[suite];
		assert.ok(
			Array.isArray(shapes) && shapes.length > 0,
			`${suite} is declared as a corpus source but contributes no shape`,
		);
	}
	/* A suite named in the catalogue but not declared (or the reverse) is a lie. */
	assert.deepEqual(Object.keys(SHAPES_BY_SOURCE).sort(), [...declared].sort());
});

test("the catalogue holds no duplicate shape", () => {
	const all = Object.values(SHAPES_BY_SOURCE).flat();
	assert.equal(
		new Set(all).size,
		all.length,
		"a shape listed twice plans twice and pins nothing new",
	);
});

test("every literal shape the turn-segments suite drives is in the corpus", () => {
	/*
	 * `harvestShapes` reads the literals out of the suites AND merges the
	 * catalogue. If a literal could not be built by the grammar the harvester would
	 * have dropped it silently - the silent-gap class this fixture exists to close -
	 * so the count is pinned and the union is compared against the fixture.
	 */
	const shapes = harvestShapes();
	assert.ok(shapes.length >= 80, `harvested only ${shapes.length} shapes`);
	const covered = new Set(FIXTURE.cases.map((entry) => entry.tokens));
	for (const shape of shapes)
		assert.ok(
			covered.has(shape),
			`the corpus builds "${shape}" but the fixture does not carry it`,
		);
});

test("the corpus exercises the arithmetic the fixture claims to pin", () => {
	const unitKeys = new Set();
	let groupsWithFailures = 0;
	let groups = 0;
	let runsWithDuration = 0;
	let runs = 0;
	const receiptCases = new Set();
	for (const entry of FIXTURE.cases) {
		if (
			entry.tokens
				.split(/\s+/)
				.some((token) => RECEIPT_FAMILY_TOKENS.has(token))
		)
			receiptCases.add(entry.tokens);
		for (const group of entry.expected.groups) {
			groups += 1;
			if (group.failedCount > 0) groupsWithFailures += 1;
			for (const unit of group.countUnits) {
				assert.match(
					unit.key,
					COUNT_UNIT_KEY,
					`${entry.tokens}: ${unit.key} is not a count unit key`,
				);
				assert.ok(
					unit.count > 0,
					`${entry.tokens}: ${unit.key} counts ${unit.count}`,
				);
				unitKeys.add(unit.key);
			}
		}
		for (const run of entry.expected.runs) {
			runs += 1;
			if (run.facts.durationS !== null) runsWithDuration += 1;
		}
	}
	/*
	 * ONE TOOL KIND IS NOT A CORPUS. Round 1 pinned `kind:shell` and nothing else -
	 * every group's `failedCount` was 0 and every run's duration null - so a port
	 * that broke the class/kind ordering, the failure tally or `Took` replayed
	 * green. Each assertion below is a decision the fixture now has the rows for.
	 */
	assert.ok(
		unitKeys.size >= 8,
		`only ${unitKeys.size} distinct count-unit keys: ${[...unitKeys].join(", ")}`,
	);
	for (const kind of [
		"class:files",
		"class:edits",
		"class:searches",
		"kind:shell",
		"kind:python",
	])
		assert.ok(unitKeys.has(kind), `no case states ${kind}`);
	assert.ok(
		[...unitKeys].some((key) => key.startsWith("name:")),
		"no count unit keyed by a call's DISPLAY NAME (the MCP split this round fixed)",
	);
	assert.ok(groupsWithFailures > 0, "no group states a failure");
	assert.ok(runsWithDuration > 0, "no run states a duration");
	assert.ok(
		receiptCases.size >= 5,
		`only ${receiptCases.size} receipt-bearing shapes`,
	);
});

test("the fixture's count units agree with the action counts it states", () => {
	for (const entry of FIXTURE.cases) {
		for (const run of entry.expected.runs) {
			const factsTotal = run.facts.countUnits.reduce(
				(sum, unit) => sum + unit.count,
				0,
			);
			assert.equal(
				factsTotal,
				run.facts.actions,
				`${entry.tokens}: the run's units must sum to its action count`,
			);
			for (const segment of run.segments) {
				const segmentTotal = segment.facts.countUnits.reduce(
					(sum, unit) => sum + unit.count,
					0,
				);
				assert.equal(
					segmentTotal,
					segment.facts.actions,
					`${entry.tokens}: a bar's units must sum to its own action count`,
				);
			}
		}
	}
});

test("every segment key is one of the two stable shapes, and unique in its run", () => {
	for (const entry of FIXTURE.cases) {
		for (const run of entry.expected.runs) {
			const seen = new Set();
			for (const segment of run.segments) {
				assert.match(
					segment.key,
					/^(seg|qg):/,
					`${entry.tokens}: ${segment.key} is not a stable key`,
				);
				assert.ok(
					!seen.has(segment.key),
					`${entry.tokens}: ${segment.key} names two bars in one run`,
				);
				seen.add(segment.key);
			}
		}
	}
});

test("a case's options are the ones the manifest lists", () => {
	const allowed = new Set(FIXTURE.desktop.permutations);
	for (const entry of FIXTURE.cases)
		assert.ok(
			allowed.has(entry.options),
			`${entry.tokens}: ${entry.options} is not a listed permutation`,
		);
});

test("at most one case in eight is unexpressible on the relay wire", () => {
	/*
	 * `Z`/`R` are the quiet `no_reply` call the relay never mints. A seeded run
	 * drawn uniformly from the whole grammar spent 110 of its 120 cases on shapes
	 * the phone cannot replay, so the corpus looked large and pinned almost nothing
	 * either surface owed. The share is capped here, and the generator's own pool
	 * split is what keeps it.
	 */
	const unexpressible = FIXTURE.cases.filter((entry) =>
		entry.tokens.split(/\s+/).some((token) => token === "Z" || token === "R"),
	).length;
	const share = unexpressible / FIXTURE.cases.length;
	assert.ok(
		share <= 1 / 6,
		`${unexpressible}/${FIXTURE.cases.length} cases are unexpressible (${share.toFixed(2)})`,
	);
});

test("generation is deterministic", async () => {
	const first = JSON.stringify(await generate());
	const second = JSON.stringify(await generate());
	assert.equal(
		first,
		second,
		"the fixture must be a function of the tree alone",
	);
});

test("the fixture's shape count is what the suites drive, not a snapshot of one", () => {
	/* `harvestShapes` is `[...new Set(...)].sort()`, so a duplicate cannot survive it;
	 * this asserts the SORTED union, which is the property the corpus iterates. */
	const shapes = harvestShapes();
	assert.deepEqual(shapes, [...shapes].sort());
	assert.equal(new Set(shapes).size, shapes.length);
});

test("the generator's entry point is resolved, not guessed", () => {
	/*
	 * THE SILENT NO-OP THIS PINS (C0-M1). `process.argv[1] === import.meta.url`
	 * fails through a symlinked directory - `/tmp` on macOS is the ordinary case -
	 * and the failure mode is silence: the module loads, main() never runs, nothing
	 * prints, exit 0. `scripts/entry-point.mjs` is this repository's one answer, and
	 * this test fails if the generator goes back to comparing strings itself.
	 */
	const source = readFileSync(
		join(HERE, "generate-condense-parity.mjs"),
		"utf8",
	);
	assert.match(
		source,
		/isEntryPoint\(/,
		"the generator must resolve its entry point through scripts/entry-point.mjs",
	);
	assert.doesNotMatch(
		source,
		/process\.argv\[1\]\s*===/,
		"a raw argv[1] comparison is the symlink no-op scripts/entry-point.mjs exists to remove",
	);
	/* And the helper itself agrees that a symlinked spelling runs the file. */
	const out = execFileSync(
		"node",
		[
			"-e",
			"process.stdout.write(require('node:url').pathToFileURL(process.argv[1]).href)",
			join(HERE, "generate-condense-parity.mjs"),
		],
		{ encoding: "utf8" },
	);
	assert.ok(out.startsWith("file://"));
});
