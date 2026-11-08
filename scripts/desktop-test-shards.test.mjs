import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	DESKTOP_COMMAND,
	EXEMPT,
	EXTERNAL_TESTS,
	selectDesktopTests,
	walkTestFiles,
} from "./desktop-test-inventory.mjs";
import {
	SHARD_COUNT,
	SHARD_FILE_CEILING,
	SHARD_WARNING_LANE,
	assertDesktopCommand,
	assertShardCeiling,
	inventory,
	loadReceipts,
	main,
	observedRunnerFileCount,
	partition,
	plan,
	receipt,
	scopeDecision,
	shardHeadroomWarning,
	shardIndexOf,
	shardMatrix,
	tapSummary,
	validateFiles,
	verify,
} from "./desktop-test-shards.mjs";

// Builtin-only tests. No App/React/Electron import, dependency resolution or test
// runner invocation. These fixtures prove data contracts, not real-suite PASS.
const HEAD = "a".repeat(40);
const CHECKOUT = "b".repeat(40);
const names = Array.from(
	{ length: 542 },
	(_, i) =>
		`scripts/${i % 11 === 0 ? "i18n/" : ""}case-${String(i).padStart(4, "0")}.test.mjs`,
);
// The pre-2026-10-31 literal form, kept only to prove it is now refused.
const literal = (files) =>
	`node scripts/run-desktop-tests.mjs ${files.join(" ")}`;
const log =
	"# tests 120\n# pass 119\n# fail 0\n# cancelled 0\n# skipped 1\n# todo 0\n";
function runnerLog(count, summary = log) {
	return `desktop tests: ${count} ${count === 1 ? "file" : "files"}, concurrency 3 (max clamp 3)\n${summary}`;
}

// A real tree: nine desktop files plus every EXEMPT file, because the walk
// refuses an exemption that names nothing (the typo guard) just as it would in
// the repository.
function fixture(fn) {
	const root = mkdtempSync(join(tmpdir(), "desktop-shard-data-"));
	try {
		const files = [...names.slice(0, 9), ...EXTERNAL_TESTS];
		for (const file of [...files, ...Object.keys(EXEMPT)]) {
			mkdirSync(join(root, file, ".."), { recursive: true });
			writeFileSync(join(root, file), "// data only\n");
		}
		writeFileSync(
			join(root, "package.json"),
			JSON.stringify({ scripts: { "test:desktop": DESKTOP_COMMAND } }),
		);
		return fn(root, [...files].sort());
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}
// A throwaway checkout carrying exactly `files`, every EXEMPT entry (the walk
// refuses an exemption that names nothing) and a derived test:desktop command:
// the shape `plan` reads, so a synthetic inventory can be planned end to end.
function tree(files, fn) {
	const root = mkdtempSync(join(tmpdir(), "desktop-shard-ceiling-"));
	try {
		for (const file of [...files, ...EXTERNAL_TESTS, ...Object.keys(EXEMPT)]) {
			mkdirSync(join(root, file, ".."), { recursive: true });
			writeFileSync(join(root, file), "// data only\n");
		}
		writeFileSync(
			join(root, "package.json"),
			JSON.stringify({ scripts: { "test:desktop": DESKTOP_COMMAND } }),
		);
		return fn(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}
function expected() {
	const files = selectDesktopTests(names, {});
	return {
		schema: 1,
		head: HEAD,
		checkout: CHECKOUT,
		count: SHARD_COUNT,
		digest: "fixture-digest",
		total: files.length,
		files,
		shards: partition(files),
	};
}
function rows(p) {
	return Array.from({ length: SHARD_COUNT }, (_, index) =>
		receipt(p, index, runnerLog(p.shards[index].length), 0, 1),
	);
}

test("derived inventory includes nested names; partition is complete, disjoint, permutation invariant and pinned", () => {
	const files = selectDesktopTests(names, {});
	assert.equal(files.length, 542);
	assert.ok(files.includes("scripts/i18n/case-0000.test.mjs"));
	const sizes = {};
	for (const count of [2, 3, SHARD_COUNT]) {
		const parts = partition(files, count);
		assert.deepEqual(parts, partition([...files].reverse(), count));
		assert.deepEqual(parts.flat().sort(), files);
		assert.equal(new Set(parts.flat()).size, files.length);
		// Path hashing cannot give the exact +/-1 deal round-robin gave, and that
		// deal is precisely what moved a file when the inventory changed. The
		// tolerance is stated rather than implied so a salt change that piled a
		// quarter of the suite onto one shard fails here instead of in CI.
		assert.ok(
			Math.max(...parts.map((p) => p.length)) <=
				Math.ceil((files.length / count) * 1.1),
			`count ${count} exceeds 10% over the mean shard size`,
		);
		sizes[count] = parts.map((p) => p.length);
	}
	// These numbers may only move when SHARD_COUNT or SHARD_SALT moves: they are
	// the mapping pinned by path, not an incidental deal order.
	assert.deepEqual(sizes, {
		2: [255, 287],
		3: [196, 182, 164],
		4: [126, 144, 129, 143],
	});
});

test("shard membership survives inventory edits; the position deal it replaced does not", () => {
	const files = selectDesktopTests(names, {});
	const shardOf = (list, deal) => {
		const map = new Map();
		for (const [index, group] of deal(list).entries())
			for (const file of group) map.set(file, index);
		return map;
	};
	// The scheme this replaced, verbatim: sort, then deal by POSITION mod count.
	// Kept only as the negative control that proves the assertions below can fail.
	const positionDeal = (list, count = SHARD_COUNT) => {
		const groups = Array.from({ length: count }, () => []);
		[...list].sort().forEach((file, i) => groups[i % count].push(file));
		return groups;
	};
	// Counts only files present in both inventories, so a removal cannot be
	// mistaken for a reshuffle of the file it removed.
	const moved = (list, deal) => {
		const before = shardOf(files, deal);
		const after = shardOf(list, deal);
		return [...after.keys()].filter(
			(file) => before.has(file) && before.get(file) !== after.get(file),
		).length;
	};
	// A file that sorts first, one that sorts into the middle, and one that
	// appends: the first two are what a normal PR adding a test file looks like.
	const insertions = [
		"scripts/aaa-first.test.mjs",
		"scripts/case-0200x.test.mjs",
		"scripts/zzz-last.test.mjs",
	];
	for (const added of insertions) {
		// Nothing that already existed may move. This is the property a PR head and
		// the main head it lands on must agree on, and the one whose absence let the
		// same commit pass on a branch and fail on main with a different shard.
		assert.equal(moved([...files, added], partition), 0, `adding ${added}`);
	}
	assert.equal(moved([...files, ...insertions], partition), 0, "adding three");
	assert.equal(
		moved(
			files.filter((file) => file !== files[300]),
			partition,
		),
		0,
		"removing one",
	);
	// Negative control: the same inputs reshuffle under the deal this replaced,
	// so a regression back to position-based assignment cannot pass silently.
	assert.equal(moved([...files, insertions[0]], positionDeal), 542);
	assert.ok(moved([...files, insertions[1]], positionDeal) > 300);
});

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Lane-shaped inventories built from the REAL hash: names are generated until
// each lane holds the number the case asks for, so nothing below stubs
// shardIndexOf and the deal under test is the one CI runs.
function shaped(counts) {
	if (counts.length !== SHARD_COUNT)
		throw new Error("shaped() must describe every shard");
	const buckets = counts.map(() => []);
	for (
		let i = 0;
		buckets.some((bucket, lane) => bucket.length < counts[lane]);
		i++
	) {
		if (i > 100000) throw new Error("cannot shape inventory");
		const file = `scripts/fixture-${String(i).padStart(5, "0")}.test.mjs`;
		const lane = shardIndexOf(file, counts.length);
		if (buckets[lane].length < counts[lane]) buckets[lane].push(file);
	}
	return buckets;
}

test("the shard memory ceiling fails hard, naming the shard, its size, the ceiling, the runway and the runs", () => {
	// Positive control: the inventory this repository runs today fits, derived by
	// the same walk CI derives it with and planned through the same entry point CI
	// uses. A guard never exercised on the input it must let through is the
	// "documented, not enforced" failure this replaces.
	const real = plan(REPO_ROOT, HEAD, CHECKOUT);
	assert.ok(real.total > 700, `real inventory was only ${real.total} files`);
	const largest = Math.max(...real.shards.map((group) => group.length));
	assert.ok(
		largest <= SHARD_FILE_CEILING,
		`largest real shard ${largest} exceeds the ${SHARD_FILE_CEILING}-file ceiling`,
	);
	// No empty lane today, which is why refill does not run on the real inventory.
	assert.ok(real.shards.every((group) => group.length > 0));
	// Boundary, both directions, through the assertion the planner calls, so the
	// guard cannot decay into decoration: the ceiling itself passes, one over fails.
	assert.doesNotThrow(() =>
		assertShardCeiling(shaped([SHARD_FILE_CEILING, 1, 1, 1])),
	);
	const over = shaped([SHARD_FILE_CEILING + 1, 1, 1, 1]);
	assert.throws(() => assertShardCeiling(over), /memory ceiling/);
	let message = "";
	try {
		assertShardCeiling(over);
	} catch (caught) {
		message = caught.message;
	}
	// Every fact the person who trips this needs, in the order they need it:
	// which shard, how big, the ceiling, then how much growth was left, then the
	// lever that actually works. The lane size and the ceiling are read from the
	// constants, so this cannot pin a number that later moves.
	assert.match(
		message,
		new RegExp(`shard 1/4 holds ${SHARD_FILE_CEILING + 1} files`),
	);
	assert.match(
		message,
		new RegExp(`${SHARD_FILE_CEILING}-file memory ceiling`),
	);
	assert.match(message, /40992181176/);
	assert.match(message, /40996898976/);
	// The runway arithmetic, measured rather than asserted (see CEILING_RUNWAY):
	// how many added test files, in what spread, and how many days that is.
	assert.match(message, /median 38 added test files/);
	assert.match(message, /p10 30, p90 46/);
	assert.match(message, /2\.5 to 3\.4 days/);
	// The real lever is named BEFORE the salt re-pick, and the salt is priced: a
	// 20,000-salt sweep bottoms out at the arithmetic floor, which is 2 files.
	assert.ok(
		message.indexOf("another lane") < message.indexOf("Re-picking SHARD_SALT"),
		"the shard count must be offered before the salt re-pick",
	);
	assert.match(message, /Re-picking SHARD_SALT/);
	assert.match(message, /at most 2 files/);
	// The evidence correction, pinned: 206 PASSED while 205 died, and the budget
	// those deaths ran under is smaller than the one in force now.
	assert.match(message, /206-file lanes in those same runs PASSED/);
	assert.match(message, /9\.5 GB \(9728 MB\)/);
	assert.match(message, /22% more headroom/);
	// And end to end through the planner: a real tree whose largest lane is over
	// the ceiling fails `plan`, which is the one path plan/run/receipt/verify all
	// take, so this fails a CI lane instead of launching it.
	tree(shaped([SHARD_FILE_CEILING + 1, 1, 1, 1]).flat(), (root) => {
		assert.throws(() => plan(root, HEAD, CHECKOUT), /memory ceiling/);
	});
});

test("empty-lane refill is pinned, including the case that disproved its reachability claim", () => {
	// Five paths over four lanes deal [3,1,0,1]: lane 2 is empty although the
	// inventory is LARGER than the shard count, which the old comment here said
	// could not happen.
	const five = [
		"scripts/probe-0.test.mjs",
		"scripts/probe-1.test.mjs",
		"scripts/probe-2.test.mjs",
		"scripts/probe-3.test.mjs",
		"scripts/probe-4.test.mjs",
	];
	assert.deepEqual(
		five.map((file) => shardIndexOf(file, 4)),
		[1, 0, 0, 0, 3],
	);
	const refilled = [
		["scripts/probe-1.test.mjs", "scripts/probe-3.test.mjs"],
		["scripts/probe-0.test.mjs"],
		["scripts/probe-2.test.mjs"],
		["scripts/probe-4.test.mjs"],
	];
	assert.deepEqual(partition(five, 4), refilled);
	// The exception measured rather than argued: adding scripts/extra-2.test.mjs
	// fills lane 2, so refill does not run and probe-2 returns to lane 0. One
	// existing file changes shard because ANOTHER file was added - inventory
	// dependence, which the ordinary deal does not have and refill reintroduces.
	const after = partition([...five, "scripts/extra-2.test.mjs"], 4);
	assert.deepEqual(after, [
		[
			"scripts/probe-1.test.mjs",
			"scripts/probe-2.test.mjs",
			"scripts/probe-3.test.mjs",
		],
		["scripts/probe-0.test.mjs"],
		["scripts/extra-2.test.mjs"],
		["scripts/probe-4.test.mjs"],
	]);
	const laneOf = (groups) =>
		new Map(
			groups.flatMap((group, index) => group.map((file) => [file, index])),
		);
	const before = laneOf(refilled);
	assert.deepEqual(
		[...laneOf(after)]
			.filter(([file, lane]) => before.has(file) && before.get(file) !== lane)
			.map(([file]) => file),
		["scripts/probe-2.test.mjs"],
	);
	// Bounded to WHICH files exist, not to their order: the same inventory listed
	// backwards refills identically, so this is not the position dependence the
	// path-hash deal removed.
	assert.deepEqual(partition([...five].reverse(), 4), refilled);
});

test("refill cannot reach a suite this size, and cannot hide a lane that is over", () => {
	const ceiling = SHARD_FILE_CEILING;
	// 3 x the ceiling + 1 is the largest inventory whose refilled partition can
	// still pass: it needs the two other lanes at the ceiling or less and the
	// largest at ceiling + 1. One file more and the dispatched partition is over.
	const dispatches = assertShardCeiling(
		partition(shaped([ceiling + 1, ceiling, ceiling, 0]).flat()),
	);
	assert.deepEqual(
		dispatches.map((group) => group.length),
		[ceiling, ceiling, ceiling, 1],
	);
	assert.throws(
		() =>
			assertShardCeiling(
				partition(shaped([ceiling + 2, ceiling, ceiling, 0]).flat()),
			),
		/memory ceiling/,
	);
	// Refill is why the assertion runs on the partition that is DISPATCHED rather
	// than on the raw deal: three empty lanes refill a raw ceiling + 1 lane down
	// to ceiling - 2, and ceiling - 2 is a lane memory can carry, so the shard
	// that runs is the one that is checked.
	assert.deepEqual(
		assertShardCeiling(partition(shaped([ceiling + 1, 0, 0, 0]).flat())).map(
			(group) => group.length,
		),
		[ceiling - 2, 1, 1, 1],
	);
	// And refill cannot rescue a lane that is genuinely over: taking three files
	// off 300 leaves 297, which fails.
	assert.throws(
		() => assertShardCeiling(partition(shaped([300, 0, 0, 0]).flat())),
		/memory ceiling/,
	);
});

test("the lane count is one constant: CI derives its matrix from it, and a disagreement fails loudly", async () => {
	// The count lives in SHARD_COUNT alone, so `matrix` mode is its indices and
	// nothing else - this is exactly what full-suite.yml expands.
	const printed = [];
	const originalLog = console.log;
	console.log = (...args) => printed.push(args.join(" "));
	let code;
	try {
		code = await main(["matrix"]);
	} finally {
		console.log = originalLog;
	}
	assert.equal(code, 0);
	assert.deepEqual(
		JSON.parse(printed.join("\n")),
		Array.from({ length: SHARD_COUNT }, (_, index) => index),
	);

	// The workflow must DERIVE from that output. A literal `shard: [...]` list is
	// a second place to edit, and a literal that drifts dispatches fewer lanes
	// than the receipts prove: a partial suite that reads green is the failure
	// this file exists to make impossible.
	const workflow = readFileSync(
		join(REPO_ROOT, ".github", "workflows", "full-suite.yml"),
		"utf8",
	);
	assert.doesNotMatch(workflow, /^\s*shard: \[[^\]]*\]\s*$/m);
	assert.match(workflow, /desktop-test-shards\.mjs matrix/);
	assert.match(
		workflow,
		/shard: \$\{\{ fromJSON\(needs\.changes\.outputs\.shards\) \}\}/,
	);
	assert.match(workflow, /shards: \$\{\{ steps\.shards\.outputs\.shards \}\}/);
	// The display name counts the same lanes, so a fifth lane cannot advertise
	// itself as 5/4 and split a required check's name in two.
	assert.match(
		workflow,
		/Desktop Tests shard \(\$\{\{ matrix\.shard \}\}\/\$\{\{ needs\.changes\.outputs\.shardcount \}\}\)/,
	);

	// The runtime half of the same assertion, for the path CI actually takes: an
	// index outside the constant is refused, and a partial run cannot be verified
	// as complete.
	const p = expected();
	assert.throws(
		() => receipt(p, SHARD_COUNT, runnerLog(p.shards[0].length), 0, 1),
		/Invalid shard index/,
	);
	assert.throws(
		() =>
			verify(
				p,
				rows(p).slice(0, SHARD_COUNT - 1),
				"true",
				"success",
				"success",
			),
		/Expected exactly [0-9]+ receipts/,
	);
	// And the deal itself cannot be built for a lane count nobody dispatches.
	assert.throws(() => partition(names, SHARD_COUNT + 1), /Partition count/);
});

test("headroom warns on stderr without failing, and the hard failure still bites through run mode", async () => {
	// 199 is today's largest lane and must stay silent; 200 is the warning line.
	assert.equal(
		shardHeadroomWarning(shaped([SHARD_WARNING_LANE - 1, 1, 1, 1])),
		null,
	);
	const warn = shardHeadroomWarning(shaped([SHARD_WARNING_LANE, 1, 1, 1]));
	assert.match(
		warn,
		new RegExp(
			`shard 1/4 holds ${SHARD_WARNING_LANE} files, ${SHARD_FILE_CEILING - SHARD_WARNING_LANE} under the ${SHARD_FILE_CEILING}-file memory ceiling`,
		),
	);
	// The warning carries the same runway arithmetic as the failure: the point of
	// warning early is that the reader can act before the red exists.
	assert.match(warn, /median 38 added test files/);
	assert.match(warn, /another lane/);
	assert.match(warn, /Warning only: this run continues/);

	// End to end through `plan`, the path every mode takes: the warning reaches
	// stderr and the plan is still RETURNED. A warning that also failed would be
	// the hard failure wearing a different name.
	const writes = [];
	const originalWrite = process.stderr.write;
	let planned = null;
	tree(shaped([SHARD_WARNING_LANE, 1, 1, 1]).flat(), (root) => {
		process.stderr.write = (chunk) => {
			writes.push(String(chunk));
			return true;
		};
		try {
			planned = plan(root, HEAD, CHECKOUT);
		} finally {
			process.stderr.write = originalWrite;
		}
	});
	assert.ok(planned, "the plan must still be produced under the warning");
	assert.ok(
		Math.max(...planned.shards.map((group) => group.length)) >=
			SHARD_WARNING_LANE,
	);
	assert.equal(writes.length, 1);
	assert.match(writes[0], /Warning only: this run continues/);

	// ...and the hard failure is unchanged and still one file past the ceiling,
	// through `run` mode - the real CI entry point - so the lane is refused before
	// the guarded runner is launched at all.
	let rejection = null;
	tree(shaped([SHARD_FILE_CEILING + 1, 1, 1, 1]).flat(), (root) => {
		rejection = main([
			"run",
			"--root",
			root,
			"--head",
			HEAD,
			"--checkout",
			CHECKOUT,
			"--index",
			"0",
		]);
	});
	await assert.rejects(rejection, /memory ceiling/);
});

test("inventory rejects unsupported syntax instead of guessing shell semantics", () => {
	// The command is a constant now; the old literal list (any branch that has
	// not rebased past the derivation) is refused, not half-honoured.
	for (const value of [
		undefined,
		"",
		"pnpm test",
		literal(["scripts/x.test.mjs"]),
		`${DESKTOP_COMMAND} scripts/x.test.mjs`,
		`${DESKTOP_COMMAND} && echo`,
	]) {
		assert.throws(() => assertDesktopCommand(value), /Missing|Unsupported/);
		assert.throws(() => inventory(value), /Missing|Unsupported/);
	}
	assert.doesNotThrow(() => assertDesktopCommand(DESKTOP_COMMAND));
	for (const paths of [
		["--flag"],
		["../x.test.mjs"],
		["scripts/../x.test.mjs"],
		["scripts/*.test.mjs"],
		['"scripts/x.test.mjs"'],
		["src/x.test.mjs"],
		["scripts/x.test.mjs", "scripts/x.test.mjs"],
		[],
	]) {
		assert.throws(
			() => selectDesktopTests(paths, {}),
			/Unsafe|Duplicate|Empty/,
		);
	}
	assert.throws(() => partition(names, 5), /count/);
	assert.throws(() => partition([], 3), /Empty/);
});

test("EXEMPT is honoured exactly and a typo or reasonless entry fails closed", () => {
	const paths = ["scripts/a.test.mjs", "scripts/b.test.mjs"];
	assert.deepEqual(
		selectDesktopTests(paths, {
			"scripts/b.test.mjs": "runs in its own CI step",
		}),
		["scripts/a.test.mjs"],
	);
	assert.throws(
		() =>
			selectDesktopTests(paths, {
				"scripts/bb.test.mjs": "a typo'd path with a real-length reason",
			}),
		/names no existing test file/,
	);
	assert.throws(
		() => selectDesktopTests(paths, { "scripts/b.test.mjs": " " }),
		/no reason/,
	);
	// R1-2: the length floor lives here, not in the gate, so both agree.
	assert.throws(
		() => selectDesktopTests(paths, { "scripts/b.test.mjs": "x" }),
		/needs a real reason/,
	);
});

test("the walk eagerly includes a new nested file and refuses a symlink under scripts/", () =>
	fixture((root, files) => {
		assert.deepEqual(inventory(DESKTOP_COMMAND, root), files);
		mkdirSync(join(root, "scripts", "deep", "er"), { recursive: true });
		writeFileSync(join(root, "scripts/deep/er/new.test.mjs"), "// new\n");
		writeFileSync(join(root, "scripts/deep/helper.mjs"), "// not a test\n");
		const grown = inventory(DESKTOP_COMMAND, root);
		assert.deepEqual(grown, [...files, "scripts/deep/er/new.test.mjs"].sort());
		assert.ok(walkTestFiles(root).length > grown.length, "walk keeps EXEMPT");
		symlinkSync(join(root, files[0]), join(root, "scripts/alias.test.mjs"));
		assert.throws(() => inventory(DESKTOP_COMMAND, root), /Symlink/);
	}));

test("external main registrations survive derivation and missing or linked paths fail closed", () =>
	fixture((root, files) => {
		for (const file of EXTERNAL_TESTS) {
			assert.ok(inventory(DESKTOP_COMMAND, root).includes(file));
			rmSync(join(root, file));
			assert.throws(() => inventory(DESKTOP_COMMAND, root), /ENOENT/);
			symlinkSync(join(root, files[0]), join(root, file));
			assert.throws(() => inventory(DESKTOP_COMMAND, root), /Symlink/);
		}
	}));

test("metadata plan checks actual files and rejects missing files, symlinks and wrong head identity", () =>
	fixture((root, files) => {
		const p = plan(root, HEAD, CHECKOUT);
		assert.equal(p.total, files.length);
		assert.equal(p.digest.length, 64);
		assert.throws(() => plan(root, "short", CHECKOUT), /full/);
		assert.throws(
			() => validateFiles(root, ["scripts/missing.test.mjs"]),
			/missing/,
		);
		symlinkSync(join(root, files[0]), join(root, "alias.test.mjs"));
		assert.throws(() => validateFiles(root, ["alias.test.mjs"]), /symlink/);
	}));

test("TAP and receipt cannot be emitted after an error, cancellation, empty or truncated summary", () => {
	const p = expected();
	assert.equal(tapSummary(log).pass, 119);
	for (const bad of [
		"",
		log + log,
		log.replace("# fail 0", "# fail 1"),
		log.replace("# cancelled 0", "# cancelled 1"),
		log.replace("# pass 119", "# pass 0"),
		`${log}not ok 3 - failed\n`,
	]) {
		assert.throws(
			() => receipt(p, 0, runnerLog(p.shards[0].length, bad), 0, 1),
			/TAP|summary/,
		);
	}
	assert.throws(() => receipt(p, 0, log, 137, 1), /rc=0/);
	assert.throws(() => receipt(p, 4, log, 0, 1), /index/);
});

test("exact four same-head success receipts prove disjoint complete inventory; every mutation fails for its own reason", () => {
	const p = expected();
	assert.equal(verify(p, rows(p), "true", "success", "success"), "passed");
	assert.equal(verify(p, [], "false", "success", "skipped"), "skipped");
	assert.throws(() => verify(p, [], "", "success", "success"), /Unknown/);
	assert.throws(
		() => verify(p, [], "true", "failure", "success"),
		/Classifier/,
	);
	for (const status of ["failure", "cancelled", "skipped", ""])
		assert.throws(
			() => verify(p, rows(p), "true", "success", status),
			/matrix/i,
		);
	for (const [mutate, message] of [
		[(r) => r.pop(), /exactly 4/],
		[(r) => r.push(r[0]), /exactly 4/],
		[
			(r) => {
				r[1].index = 0;
			},
			/duplicate/,
		],
		[
			(r) => {
				r[1].head = "c".repeat(40);
			},
			/head/,
		],
		[
			(r) => {
				r[1].checkout = "c".repeat(40);
			},
			/checkout/,
		],
		[
			(r) => {
				r[1].digest = "wrong";
			},
			/digest/,
		],
		[
			(r) => {
				r[1].files = [...r[0].files];
			},
			/partition/,
		],
		[
			(r) => {
				r[1].files.pop();
			},
			/partition/,
		],
		[
			(r) => {
				r[1].status = "cancelled";
			},
			/Failed/,
		],
		[
			(r) => {
				r[1].tap.fail = 1;
			},
			/TAP/,
		],
	]) {
		const r = rows(p);
		mutate(r);
		assert.throws(() => verify(p, r, "true", "success", "success"), message);
	}
});

test("CLI rejects unknown flags without entering the real runner", async () => {
	await assert.rejects(() => main(["plan", "--shell", "echo"]), /Unknown/);
	await assert.rejects(() => main(["guess"]), /explicit/);
	await assert.rejects(
		() => main(["run", "--metadata-package", "unused.json"]),
		/Unsupported run/,
	);
	await assert.rejects(
		() => main(["verify", "--metadata-git-tree", "unused.txt"]),
		/Unsupported verify/,
	);
});

test("wrong-head receipt is rejected (head mutation oracle)", () => {
	const p = expected();
	const r = rows(p);
	r[1].head = "c".repeat(40);
	assert.throws(() => verify(p, r, "true", "success", "success"), /head/);
});

test("artifact directory identity rejects missing, extra, wrong-attempt and extra-file proofs", () => {
	fixture((root) => {
		const proofs = join(root, "proofs");
		mkdirSync(proofs);
		const p = expected();
		const r = rows(p);
		for (let i = 0; i < SHARD_COUNT; i++) {
			const d = join(proofs, `desktop-shard-proof-42-1-${i}`);
			mkdirSync(d);
			writeFileSync(join(d, `shard-${i}.json`), JSON.stringify(r[i]));
		}
		assert.equal(loadReceipts(proofs, "42", "1").length, SHARD_COUNT);
		assert.throws(
			() => loadReceipts(proofs, "42", "2"),
			/named receipt artifacts/,
		);
		// Removing any single proof must be rejected - the last index here, so the
		// check is not accidentally satisfied by prefix matching alone.
		const missing = SHARD_COUNT - 1;
		rmSync(join(proofs, `desktop-shard-proof-42-1-${missing}`), {
			recursive: true,
		});
		assert.throws(
			() => loadReceipts(proofs, "42", "1"),
			/named receipt artifacts/,
		);
		mkdirSync(join(proofs, `desktop-shard-proof-42-1-${missing}`));
		writeFileSync(
			join(
				proofs,
				`desktop-shard-proof-42-1-${missing}`,
				`shard-${missing}.json`,
			),
			JSON.stringify(r[missing]),
		);
		mkdirSync(join(proofs, "desktop-shard-proof-42-1-extra"));
		assert.throws(
			() => loadReceipts(proofs, "42", "1"),
			/named receipt artifacts/,
		);
		rmSync(join(proofs, "desktop-shard-proof-42-1-extra"), { recursive: true });
		writeFileSync(
			join(proofs, "desktop-shard-proof-42-1-0", "extra.json"),
			"{}",
		);
		assert.throws(() => loadReceipts(proofs, "42", "1"), /extra receipt/);
	});
});

test("metadata-only plans and forged metadata receipts cannot claim execution success", () => {
	const p = expected();
	const metadata = {
		...p,
		mode: "metadata-only",
		executed: false,
		metadataOnly: true,
	};
	assert.throws(() => receipt(metadata, 0, log, 0, 1), /Metadata-only/);
	assert.throws(
		() => verify(metadata, rows(p), "true", "success", "success"),
		/Metadata-only/,
	);
	const r = rows(p);
	r[0].mode = "metadata-only";
	r[0].executed = false;
	assert.throws(
		() => verify(p, r, "true", "success", "success"),
		/Metadata-only/,
	);
});

test("R1: actual receipt rejects healthy TAP without guarded-runner file-count evidence", () => {
	const p = expected();
	assert.throws(() => receipt(p, 0, log, 0, 1), /runner.*count/i);
});

// Reduced verbatim from run 41223709456, shard 2 job 124611472370's
// suite-step log (QA session 52517629cd9a). Ordered TAP isn't reproduced here:
// the collision is entirely between these two parent-runner protocol records.
const CI_COUNT_RECORD =
	"desktop tests: 163 files, concurrency 3 (CI runner: governor stands down, node default for 4 cores)";
const CI_HEARTBEAT_RECORD =
	'desktop tests: diagnostic {"event":"heartbeat","leaderPid":2350,"active":[{"file":"scripts/agent-class-toggle.test.mjs","pid":2363,"ppid":2350},{"file":"scripts/agent-hub-skills-tab-count.test.mjs","pid":2364,"ppid":2350},{"file":"scripts/agents-publication.test.mjs","pid":2442,"ppid":2350}]}';

test("Q3: authentic runner count survives diagnostic file fields without weakening receipts", () => {
	const mixed = `${CI_COUNT_RECORD}\n${CI_HEARTBEAT_RECORD}\n${log}`;
	assert.equal(observedRunnerFileCount(mixed), 163);
	const p = expected();
	const wanted = p.shards[0].length;
	const valid = `${runnerLog(wanted)}${CI_HEARTBEAT_RECORD}\n`;
	assert.equal(receipt(p, 0, valid, 0, 1).runnerFileCount, wanted);

	// Diagnostics cannot replace evidence, hide a duplicate/malformed genuine
	// record, or forgive a count inconsistent with the planned shard inventory.
	for (const bad of [
		`${CI_HEARTBEAT_RECORD}\n${log}`,
		`${CI_COUNT_RECORD}\n${CI_COUNT_RECORD}\n${CI_HEARTBEAT_RECORD}\n`,
		`${CI_COUNT_RECORD}\n${CI_HEARTBEAT_RECORD}\ndesktop tests: many files, concurrency 3\n`,
		`${CI_COUNT_RECORD}\n${CI_HEARTBEAT_RECORD}\ndesktop tests: 163 files concurrency 3\n`,
		`${CI_COUNT_RECORD}\n${CI_HEARTBEAT_RECORD}\ndesktop tests: -163 files, concurrency 3\n`,
		`${CI_HEARTBEAT_RECORD}\n# ${CI_COUNT_RECORD}\n`,
		`${CI_HEARTBEAT_RECORD}\n    ${CI_COUNT_RECORD}\n`,
	])
		assert.throws(() => observedRunnerFileCount(bad), /runner.*count/i);
	assert.throws(
		() =>
			receipt(p, 0, `${runnerLog(wanted + 1)}${CI_HEARTBEAT_RECORD}\n`, 0, 1),
		/runner.*count/i,
	);
});

test("R2: actual exported metadata planner cannot create or verify execution receipts", () =>
	fixture((root, files) => {
		const packagePath = join(root, "exported-package.json");
		writeFileSync(
			packagePath,
			JSON.stringify({ scripts: { "test:desktop": DESKTOP_COMMAND } }),
		);
		const treePath = join(root, "exported-tree.txt");
		const tree = [...files, ...Object.keys(EXEMPT)].map(
			(file) => `100644 blob ${HEAD}\t${file}`,
		);
		writeFileSync(
			treePath,
			`${tree.filter((row) => !EXTERNAL_TESTS.some((file) => row.endsWith(`\t${file}`))).join("\n")}\n`,
		);
		assert.throws(
			() => plan(root, HEAD, CHECKOUT, packagePath, treePath),
			/External desktop test missing/,
		);
		writeFileSync(
			treePath,
			`${[`040000 tree ${HEAD}\tscripts/i18n`, ...tree, `100644 blob ${HEAD}\tsrc/x.test.mjs`].join("\n")}\n`,
		);
		// The tree export derives the same inventory the real walk does...
		assert.deepEqual(
			plan(root, HEAD, CHECKOUT, undefined, treePath).files,
			files,
		);
		// ...and refuses a link under the test root the way the walk does.
		const linked = join(root, "linked-tree.txt");
		writeFileSync(
			linked,
			`${[...tree, `120000 blob ${HEAD}\tscripts/alias.test.mjs`].join("\n")}\n`,
		);
		assert.throws(
			() => plan(root, HEAD, CHECKOUT, undefined, linked),
			/unsafe in pinned Git tree/,
		);
		const actual = plan(root, HEAD, CHECKOUT);
		const validRows = rows(actual);
		for (const overrides of [
			[packagePath, treePath],
			[packagePath, undefined],
			[undefined, treePath],
		]) {
			const metadata = plan(root, HEAD, CHECKOUT, ...overrides);
			assert.throws(
				() =>
					receipt(
						metadata,
						0,
						`desktop tests: 3 files, concurrency 3 (max clamp 3)\n${log}`,
						0,
						1,
					),
				/Metadata-only/,
			);
			assert.throws(
				() => verify(metadata, validRows, "true", "success", "success"),
				/Metadata-only/,
			);
			assert.equal(metadata.mode, "metadata-only");
			assert.equal(metadata.executed, false);
			assert.equal(metadata.sourceSha, HEAD);
			assert.equal(metadata.gitTreeExistence, Boolean(overrides[1]));
		}
	}));

test("R1: observed guarded-runner count is persisted and independently required in aggregate", () => {
	const p = expected();
	const wanted = p.shards[0].length;
	const valid = runnerLog(wanted);
	assert.equal(receipt(p, 0, valid, 0, 1).runnerFileCount, wanted);
	for (const bad of [
		log,
		`# desktop tests: ${wanted} files, concurrency 3\n${log}`,
		`    desktop tests: ${wanted} files, concurrency 3\n${log}`,
		runnerLog(0),
		runnerLog(wanted - 1),
		runnerLog(wanted + 1),
		valid + runnerLog(wanted),
		`desktop tests: many files, concurrency 3\n${log}`,
	]) {
		assert.throws(() => receipt(p, 0, bad, 0, 1), /runner.*count/i);
	}
	for (const count of [undefined, 0, wanted - 1, wanted + 1]) {
		const r = rows(p);
		r[0].runnerFileCount = count;
		assert.throws(
			() => verify(p, r, "true", "success", "success"),
			/runner file count/,
		);
	}
	assert.equal(
		observedRunnerFileCount("desktop tests: 1 file, concurrency 3\n"),
		1,
	);
	assert.equal(
		observedRunnerFileCount(
			"desktop tests: 181 files, no concurrency cap (CI runner: governor stands down, node's default not measurable)\n",
		),
		181,
	);
});

test("R3/QP2: classifier-result by unit truth table cannot hide stale false output", () => {
	for (const classifier of [
		"success",
		"failure",
		"cancelled",
		"skipped",
		"",
		undefined,
	]) {
		for (const unit of ["true", "false", "", "unknown"]) {
			// The workflow's always() admission expression schedules a failure
			// consumer even if a broken classifier left a stale false output.
			const admitted = unit !== "false" || classifier !== "success";
			assert.equal(admitted, !(classifier === "success" && unit === "false"));
			if (classifier !== "success") {
				assert.equal(admitted, true);
				assert.throws(
					() => scopeDecision(unit, classifier, "success"),
					/Classifier did not succeed/,
				);
			} else if (unit === "false") {
				assert.equal(scopeDecision(unit, classifier, "skipped"), "skipped");
			} else if (unit === "true") {
				assert.equal(scopeDecision(unit, classifier, "success"), "selected");
			} else {
				assert.throws(
					() => scopeDecision(unit, classifier, "success"),
					/Unknown unit/,
				);
			}
		}
	}
});

// Verbatim runner stdout (Actions timestamps stripped only), existing job
// 120100649015 lines544–546. These are startup-format data, not a suite run. The
// memory line's values are re-derived from this repo's own guard at the hosted
// runner's measured 15,983 MB (the four kill lines behind the floor are on
// `_BUDGET_FLOOR_MB` in desktop-test-memory-guard.mjs); re-derive it there when a
// guard constant moves rather than editing a number by hand.
const actualProductionPreamble =
	"desktop tests: 541 files, concurrency 3 (CI runner: governor stands down, node default for 4 cores)\ndesktop tests: memory bound 9.5 GB for the test process group (max(9728 MB floor, 25% of 15983 MB RAM), capped at 62.5%); sampled every 2s on max(footprint, rss)\ndesktop tests: per-lane bound 25 min (default, above the 18.7-minute healthy CI suite that bounds every lane it runs — a stall in a lane first seen late can still outrun the job cap); sampled every 5s over the suite's process group";

test("R4: actual three-line production preamble accepts healthy TAP and preserves bad-count rejection", () => {
	// Exactly 541 files per lane, selected by the real assignment. The deal this
	// replaced produced a fixed 541 by construction; assignment is path-hashed
	// now, so the inventory is built from the hash instead of assuming its shape.
	// Everything below still exercises the genuine 541-file production lane.
	const buckets = Array.from({ length: SHARD_COUNT }, () => []);
	for (let i = 0; buckets.some((lane) => lane.length < 541); i++) {
		const file = `scripts/data-${i}.test.mjs`;
		const lane = buckets[shardIndexOf(file)];
		if (lane.length < 541) lane.push(file);
	}
	const files = buckets.flat();
	assert.equal(files.length, 541 * SHARD_COUNT);
	assert.deepEqual(
		partition(files).map((lane) => lane.length),
		Array.from({ length: SHARD_COUNT }, () => 541),
	);
	const p = {
		...expected(),
		files,
		total: files.length,
		shards: partition(files),
	};
	const productionLog = `${actualProductionPreamble}\n${log}`;
	assert.equal(receipt(p, 0, productionLog, 0, 1).runnerFileCount, 541);
	const noCap = productionLog.replace(
		"541 files, concurrency 3 (CI runner: governor stands down, node default for 4 cores)",
		"541 files, no concurrency cap (CI runner: governor stands down, node's default not measurable)",
	);
	assert.equal(receipt(p, 0, noCap, 0, 1).runnerFileCount, 541);
	const offDiagnostics =
		"desktop tests: WARNING — memory watchdog OFF (LOCAL_OPERATOR_UI_TEST_MEMORY_BUDGET_MB=off); a runaway test process will NOT be killed\ndesktop tests: WARNING — per-lane bound OFF (LOCAL_OPERATOR_UI_LANE_BOUND_MS=off); a lane that never settles will NOT be killed and named, and the run can still be cancelled unreadably";
	assert.equal(
		receipt(p, 0, `${productionLog}${offDiagnostics}\n`, 0, 1).runnerFileCount,
		541,
	);
	const diagnostics = actualProductionPreamble.split("\n").slice(1).join("\n");
	for (const evidence of [
		"",
		"# desktop tests: 541 files, concurrency 3",
		"    desktop tests: 541 files, concurrency 3",
		"desktop tests: many files, concurrency 3",
		"desktop tests: files, concurrency 3",
		"desktop tests: 541 filez, concurrency 3",
		"desktop tests: 0 files, concurrency 3",
		"desktop tests: 540 files, concurrency 3",
		"desktop tests: 542 files, concurrency 3",
		"desktop tests: 541 files, concurrency 3\ndesktop tests: 541 files, concurrency 3",
	]) {
		assert.throws(
			() => receipt(p, 0, `${evidence}\n${diagnostics}\n${log}`, 0, 1),
			/runner.*count/i,
		);
	}
	assert.throws(
		() =>
			receipt(
				p,
				0,
				`${productionLog}desktop tests: many files, concurrency 3\n`,
				0,
				1,
			),
		/duplicate.*count/,
	);
});
