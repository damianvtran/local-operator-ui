/*
 * The driver's own vocabulary, and the one value that must stop the run.
 *
 * WHY THIS EXISTS. `CLICK_PROOF_EXPECT` is what turns a rig run into evidence:
 * the caller declares what the composer (or the card) must say, and the driver
 * refuses to overwrite a committed record when the run contradicts it. An
 * UNRECOGNISED value defeated that silently - it missed `declaredSentence` (so no
 * wait) and fell through the contradiction chain to `contradicted = false` (so no
 * assertion), while the run printed `report <typo>` and wrote a `click-result.json`
 * as if it had been honoured. Measured in round 3 by both the reviewer (C) and QA
 * (Q3): `card-refusals` produced `driver rc=0` and a record whose own `report`
 * read `cardUnknown: false`.
 *
 * Three files have to agree for that to hold, and each pair has drifted at least
 * once in this PR's life: the driver's list (`KNOWN_EXPECTS`), the driver's
 * sentence map (`declaredSentence`), and `run-rig.sh`'s usage line - which round
 * 2's D8 rewrite pointed a reader at as "the driver's own list". So the assertions
 * below are the agreement rather than a copy of it: the list is parsed out of the
 * shipped sources and compared, and the refusal itself is exercised by running the
 * driver with a typo.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const DRIVER = "scripts/click-proof.mjs";
const RUNNER = "docs/evidence/ask-options-live/harness/run-rig.sh";

const LIST_RE = /const KNOWN_EXPECTS = \[([\s\S]*?)\];/;
const MAP_RE = /const declaredSentence = \{([\s\S]*?)\}\[EXPECT\];/;
const MAP_KEY_RE = /^\s*"?([a-z-]+)"?:/gm;
const ARM_RE = /EXPECT === "([a-z-]+)"/g;
const USAGE_RE = /# <expect>\s+([\s\S]*?)# <order>/;
const WORD_RE = /([a-z-]+)/g;
const TYPO_RE = /card-refusals/;
const MEANT_RE = /card-refusal/;
const CARD_ARM_RE = /EXPECT === "card-unknown"/;

const driver = readFileSync(DRIVER, "utf8");
const runner = readFileSync(RUNNER, "utf8");

/** The driver's list, read from the shipped source. */
const known = [...driver.match(LIST_RE)[1].matchAll(/"([a-z-]*)"/g)].map(
	([, value]) => value,
);

test("the driver refuses an unrecognised expectation instead of asserting nothing", () => {
	/*
	 * The refusal must happen BEFORE anything else runs - no browser, no rig, no
	 * writes - so this spawn needs no server and leaves nothing behind. A run that
	 * reached the Chrome spawn here would hang, which is the failure mode of
	 * validating too late.
	 */
	const run = spawnSync(
		process.execPath,
		[DRIVER, "http://127.0.0.1:1", "/tmp/click-proof-expect-test-unused"],
		{
			encoding: "utf8",
			env: { ...process.env, CLICK_PROOF_EXPECT: "card-refusals" },
			timeout: 30_000,
		},
	);
	assert.notEqual(
		run.status,
		0,
		"a mistyped CLICK_PROOF_EXPECT must not exit 0: that is a run which prints success while asserting nothing",
	);
	assert.match(run.stderr, TYPO_RE);
	assert.match(
		run.stderr,
		MEANT_RE,
		"the refusal must name the value that was probably meant, so the fix is one word",
	);
});

test("the list, the sentence map and the runner's usage line are one vocabulary", () => {
	/*
	 * EVERY declared value must have an ARM in the contradiction chain - that is
	 * the "asserts something" property, and it is what a typo used to slip past.
	 * The chain is the assertion; the sentence map is only the subset of values
	 * whose check waits on body text (a `not-sent` or `card-refusal` run is read
	 * from the alert band and the card's own flags instead).
	 */
	const arms = [...driver.matchAll(ARM_RE)].map(([, value]) => value);
	assert.deepEqual(
		[...new Set(arms)].sort(),
		known.filter((v) => v !== "" && v !== "-").sort(),
		"every value the driver accepts needs an arm that can contradict the run",
	);
	const mapKeys = [...driver.match(MAP_RE)[1].matchAll(MAP_KEY_RE)].map(
		([, key]) => key,
	);
	for (const key of mapKeys)
		assert.ok(
			known.includes(key),
			`the sentence map declares ${key}, which the vocabulary does not accept`,
		);

	/*
	 * `run-rig.sh`'s usage line is the copy a reader follows, and round 2's D8
	 * made it the citation for "the driver's own list" - so it is compared rather
	 * than trusted. Its two lines wrap, which is why this reads the block and not
	 * one line.
	 */
	const usage = runner.match(USAGE_RE)[1];
	const listed = [...usage.matchAll(WORD_RE)]
		.map(([, value]) => value)
		.filter((value) => value !== "or");
	assert.deepEqual(
		listed.sort(),
		known.filter((v) => v !== "").sort(),
		"the runner's usage line must list exactly the driver's vocabulary",
	);
});

test("unset and `-` are legitimate declarations, and both mean record without asserting", () => {
	assert.ok(
		known.includes(""),
		"an unset declaration is how the set was first taken",
	);
	assert.ok(
		known.includes("-"),
		"`-` is the documented way to record without asserting",
	);
	assert.match(
		driver,
		CARD_ARM_RE,
		"the card register's own arm must exist, or its declaration would assert nothing",
	);
});
