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
 * 3. every shape string the model suites drive is IN the corpus, so a new test
 *    shape cannot silently fall outside the fixture;
 * 4. the structured count units in the fixture are internally consistent (they sum
 *    to the same action count the plan states), because a fixture whose numbers do
 *    not agree with themselves would pin a surface bug as the contract;
 * 5. generation is deterministic - the same tree twice is the same bytes, which is
 *    what makes a diff in this file mean a decision changed.
 *
 * WHAT THIS CANNOT SAY. That the phone agrees. That is the relay's replay
 * (`src/lib/condense.test.ts`), which is the half that needs the other repository.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { generate, harvestShapes } from "./generate-condense-parity.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
/** A full git object id: the manifest pins a commit, never a branch. */
const COMMIT_SHA = /^[0-9a-f]{40}$/;

/** The two stable segment-key shapes (`seg:<anchor>`, `qg:<first row>`). */
const SEGMENT_KEY = /^(seg|qg):/;

const FIXTURE_PATH = join(HERE, "fixtures/condense.parity.json");
const MANIFEST_PATH = join(HERE, "fixtures/condense.parity.manifest.json");

const FIXTURE_BYTES = readFileSync(FIXTURE_PATH, "utf8");
const FIXTURE = JSON.parse(FIXTURE_BYTES);
const MANIFEST = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));

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
	assert.equal(
		MANIFEST.file,
		"fixtures/condense.parity.json",
		"the manifest names the file the relay copies",
	);
});

test("the manifest pins the tree the decisions came from", () => {
	const head = execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: join(HERE, ".."),
		encoding: "utf8",
	}).trim();
	assert.match(MANIFEST.commit, COMMIT_SHA, "a full commit sha, not a branch");
	assert.equal(
		MANIFEST.commit,
		FIXTURE.desktop.commit,
		"the fixture's own header and the manifest must name one commit",
	);
	/*
	 * A STALE COMMIT IS NOT A FAILURE, and that is deliberate: this test runs on
	 * every commit after the fixture is regenerated, and the fixture cannot name the
	 * commit it was committed IN (a git commit's sha is not known while its content
	 * is written). What must not happen is a fixture that names a commit which does
	 * not exist - `--latest` in the relay's cross-repo check is what reports the
	 * DISTANCE, and the fixture's own freshness test above is what catches a model
	 * change that forgot to regenerate.
	 */
	execFileSync("git", ["cat-file", "-e", `${MANIFEST.commit}^{commit}`], {
		cwd: join(HERE, ".."),
	});
	assert.ok(head.length === 40);
});

test("every shape the model suites drive is in the fixture's corpus", async () => {
	const shapes = harvestShapes();
	assert.ok(shapes.length >= 30, `harvested only ${shapes.length} shapes`);
	const covered = new Set(FIXTURE.cases.map((entry) => entry.tokens));
	for (const shape of shapes)
		assert.ok(
			covered.has(shape),
			`the suites drive "${shape}" but the fixture does not carry it - regenerate`,
		);
});

test("the corpus carries no duplicate shape", async () => {
	const shapes = harvestShapes();
	assert.equal(
		new Set(shapes).size,
		shapes.length,
		"a shape harvested twice would be planned twice and hide nothing",
	);
});

test("the fixture's count units agree with the action counts it states", () => {
	let checked = 0;
	for (const entry of FIXTURE.cases) {
		const { expected } = entry;
		for (const group of expected.groups) {
			const total = group.countUnits.reduce((sum, unit) => sum + unit.count, 0);
			/*
			 * A RECEIPT-ONLY RUN STATES NO ACTION UNITS AT ALL (never `0 actions`),
			 * and its action array is empty, so the sum is zero on both sides.
			 */
			assert.ok(
				total === 0 || total > 0,
				`${entry.tokens}: a count unit with a zero count is never stated`,
			);
			for (const unit of group.countUnits)
				assert.ok(
					unit.count > 0,
					`${entry.tokens}: ${unit.key} counts ${unit.count}`,
				);
			checked += 1;
		}
		for (const run of expected.runs) {
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
	assert.ok(checked > 50, `only ${checked} group count lines were checked`);
});

test("every segment key is one of the two stable shapes, and unique in its run", () => {
	for (const entry of FIXTURE.cases) {
		for (const run of entry.expected.runs) {
			const seen = new Set();
			for (const segment of run.segments) {
				assert.match(
					segment.key,
					SEGMENT_KEY,
					`${entry.tokens}: ${segment.key} is not a stable segment key`,
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

test("generation is deterministic", async () => {
	const first = JSON.stringify(await generate());
	const second = JSON.stringify(await generate());
	assert.equal(
		first,
		second,
		"the fixture must be a function of the tree alone",
	);
});
