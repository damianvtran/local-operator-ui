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
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	SHAPES_BY_SOURCE,
	bundledSources,
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

test("the fixture pins the model source it came from, and the pin verifies", async () => {
	/*
	 * THE PIN IS THE SOURCE HASH, NOT THE COMMIT (C0-B1). A commit cannot contain
	 * its own SHA, so a fixture that embedded `git rev-parse HEAD` was stale at the
	 * commit that produced it and at every commit after. The source files are what
	 * the decisions actually came from, and this test recomputes their hash from
	 * the tree it is running against - which is a check the commit id could never
	 * pass, because it fails exactly when a bundled model file moves without a
	 * regeneration.
	 */
	const live = await modelSourceHash();
	assert.equal(
		FIXTURE.desktop.sourceHash,
		live,
		"a bundled model source changed without regenerating the fixture",
	);
	assert.equal(MANIFEST.sourceHash, FIXTURE.desktop.sourceHash);
	/*
	 * AND THE LIST IS DERIVED, NOT DECLARED: it is compared with esbuild's own
	 * metafile answer for the bundle this tree would produce, so a source the
	 * generator starts reading has to appear in the pin (round 2, C0-m3 - round 1
	 * hashed seven of the twenty and called it "the model source").
	 */
	const derived = await bundledSources();
	assert.deepEqual(FIXTURE.desktop.modelSources, derived);
	assert.ok(
		derived.length >= 20,
		`the bundle reads ${derived.length} repository files`,
	);
	assert.ok(
		/*
		 * Wave B keys the row labels, so the condense model now reads the catalogue
		 * runtime: the pin covers every catalogue the bundle loads plus
		 * `i18n/languages.json`, which lives outside `src/`. The rule is "a file in
		 * this repository", not "a file under src/" - node_modules or an absolute
		 * path would still fail it.
		 */
		derived.every(
			(file) =>
				(file.startsWith("src/") || file === "i18n/languages.json") &&
				!file.includes("node_modules"),
		),
		"every pinned source is a repository source file",
	);
	for (const core of [
		"src/renderer/src/features/chat/canonical/transcript-reducer.ts",
		"src/renderer/src/features/chat/canonical/turn-segments.ts",
	])
		assert.ok(
			derived.includes(core),
			`${core} is read by the bundle and must be pinned`,
		);
	/* Every pinned source exists in the tree this test is running against. */
	for (const file of derived) readFileSync(join(HERE, "..", file));
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
	/* THE ASSERTION MATCHES THE NAME (round 3, C0-n1: it said 1/6 under a
	 * "one in eight" title, and the round-2 reply claimed a fix that never landed).
	 * The derived number is printed in the failure message so a future tightening is
	 * a decision, not a guess. */
	assert.ok(
		share <= 1 / 8,
		`${unexpressible}/${FIXTURE.cases.length} cases are unexpressible (${share.toFixed(3)}), above the one-in-eight budget`,
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
	/*
	 * AND THE SYMLINKED SPELLING IS EXERCISED FOR REAL. The assertion this replaces
	 * only checked that `pathToFileURL(x).href` starts with `file://`, which holds
	 * for any path and never called the helper - a test that could not fail (round 2,
	 * C0-m4). A symlinked DIRECTORY is the case the helper exists for (`/tmp` on
	 * macOS is the ordinary one), so the generator is run through one and its output
	 * is read: `current` here, and STALE in the probe the remediation records.
	 */
	const linkRoot = mkdtempSync(join(tmpdir(), "condense-parity-link-"));
	const link = join(linkRoot, "tree");
	symlinkSync(join(HERE, ".."), link, "dir");
	try {
		/*
		 * STATUS CAPTURED, NOT THROWN (round 3, C0-n3). `execFileSync` throws on a
		 * non-zero exit, so on an ordinary STALE tree this test failed with "Command
		 * failed: node ..." instead of the message it exists to produce - red for the
		 * wrong reason, and unreadable exactly when it mattered.
		 */
		const run = spawnSync(
			"node",
			[join(link, "scripts/generate-condense-parity.mjs"), "--check"],
			{
				encoding: "utf8",
			},
		);
		assert.equal(
			run.status,
			0,
			`a symlinked invocation must run and exit 0 (stderr: ${String(run.stderr ?? "").trim() || "none"})`,
		);
		assert.match(
			String(run.stdout),
			/condense parity fixture is current/,
			"a symlinked invocation must actually run",
		);
	} finally {
		rmSync(linkRoot, { recursive: true, force: true });
	}
});

/*
 * ----------------- THE PIN MUST NOT DEPEND ON THE CALLER'S CWD -----------------
 *
 * WHY THIS TEST EXISTS (agent review round 3, C0-M3). esbuild keys
 * `metafile.inputs` relative to `absWorkingDir`, which defaults to `process.cwd()`,
 * while `resolveDir` pins only module RESOLUTION. With the default, the source list
 * arrived one directory short from `scripts/`, the absolute cwd was prepended from
 * `/` (a crash), and a plain regeneration from a scratch directory WROTE the fixture
 * with `../../../Users/...` paths in `modelSources` - a committed file whose content
 * depended on where the operator stood.
 *
 * The tree is unchanged by this test: `--check` reads, and `--print` emits the bytes
 * a regeneration would write without writing them.
 */
test("the pin and the emitted bytes are identical from any working directory", () => {
	const cwds = [
		join(HERE, ".."), // the repository root
		HERE, // scripts/
		"/", // the pathological one: an absolute cwd the old code prepended
		tmpdir(), // a directory outside the repository entirely
	];
	const generator = join(HERE, "generate-condense-parity.mjs");
	const digests = [];
	const bodies = [];
	for (const cwd of cwds) {
		const check = spawnSync("node", [generator, "--check"], {
			cwd,
			encoding: "utf8",
		});
		assert.equal(
			check.status,
			0,
			`--check from ${cwd} must pass (stderr: ${String(check.stderr ?? "").trim() || "none"})`,
		);
		assert.match(
			String(check.stdout),
			/condense parity fixture is current/,
			`--check from ${cwd}`,
		);
		const printed = spawnSync("node", [generator, "--print"], {
			cwd,
			encoding: "utf8",
		});
		assert.equal(
			printed.status,
			0,
			`--print from ${cwd} must succeed (stderr: ${String(printed.stderr ?? "").trim() || "none"})`,
		);
		bodies.push(String(printed.stdout));
		digests.push(createHash("sha256").update(bodies.at(-1)).digest("hex"));
	}
	/* Same bytes, not merely same verdict: a `--print` that wrote cwd-relative paths
	 * would differ here even while `--check` agreed with itself. */
	assert.equal(
		new Set(digests).size,
		1,
		`--print differs by cwd: ${[...new Set(digests)].join(", ")}`,
	);
	assert.equal(
		digests[0],
		MANIFEST.sha256,
		"the bytes a regeneration would write must be the committed fixture's bytes",
	);
	/* And no absolute path leaked into the emitted provenance. */
	assert.doesNotMatch(
		bodies[0],
		/Users\/|\/home\/|\.\.\//,
		"the emitted fixture carries an absolute or relative-up path",
	);
});
