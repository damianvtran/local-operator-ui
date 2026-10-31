import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	SHARD_COUNT,
	inventory,
	loadReceipts,
	main,
	observedRunnerFileCount,
	partition,
	plan,
	receipt,
	scopeDecision,
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
const command = (files) =>
	`node scripts/run-desktop-tests.mjs ${files.join(" ")}`;
const log =
	"# tests 120\n# pass 119\n# fail 0\n# cancelled 0\n# skipped 1\n# todo 0\n";
function runnerLog(count, summary = log) {
	return `desktop tests: ${count} ${count === 1 ? "file" : "files"}, concurrency 3 (max clamp 3)\n${summary}`;
}

function fixture(fn) {
	const root = mkdtempSync(join(tmpdir(), "desktop-shard-data-"));
	try {
		const files = names.slice(0, 9);
		for (const file of files) {
			mkdirSync(join(root, file, ".."), { recursive: true });
			writeFileSync(join(root, file), "// data only\n");
		}
		writeFileSync(
			join(root, "package.json"),
			JSON.stringify({ scripts: { "test:desktop": command(files) } }),
		);
		return fn(root, files);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}
function expected() {
	const files = inventory(command(names));
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

test("literal inventory includes nested names; count-balanced partition is complete, disjoint and permutation invariant", () => {
	const files = inventory(command(names));
	assert.equal(files.length, 542);
	assert.ok(files.includes("scripts/i18n/case-0000.test.mjs"));
	for (const count of [2, 3, SHARD_COUNT]) {
		const parts = partition(files, count);
		assert.deepEqual(parts, partition([...files].reverse(), count));
		assert.deepEqual(parts.flat().sort(), files);
		assert.equal(new Set(parts.flat()).size, files.length);
		assert.ok(
			Math.max(...parts.map((p) => p.length)) -
				Math.min(...parts.map((p) => p.length)) <=
				1,
		);
	}
	assert.deepEqual(
		partition(files).map((p) => p.length),
		// 542 = 5 x 108 + 2: the two remainder files land on the first two groups.
		[109, 109, 108, 108, 108],
	);
});

test("inventory rejects unsupported syntax instead of guessing shell semantics", () => {
	for (const value of [
		undefined,
		"",
		"pnpm test",
		command([]),
		command(["--flag"]),
		command(["../x.test.mjs"]),
		command(["scripts/../x.test.mjs"]),
		command(["scripts/*.test.mjs"]),
		command(['"scripts/x.test.mjs"']),
		command(["scripts/x.test.mjs", "&&", "echo"]),
		command(["scripts/x.test.mjs", "scripts/x.test.mjs"]),
	]) {
		assert.throws(
			() => inventory(value),
			/Missing|Unsupported|Unsafe|Duplicate/,
		);
	}
	assert.throws(() => partition(names, SHARD_COUNT + 1), /count/);
	assert.throws(() => partition(names, 1), /count/);
	assert.throws(() => partition([], 3), /Empty/);
});

test("metadata plan checks actual files and rejects missing files, symlinks and wrong head identity", () =>
	fixture((root, files) => {
		const p = plan(root, HEAD, CHECKOUT);
		assert.equal(p.total, 9);
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
	assert.throws(() => receipt(p, SHARD_COUNT, log, 0, 1), /index/);
});

test("exact SHARD_COUNT same-head success receipts prove disjoint complete inventory; every mutation fails for its own reason", () => {
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
		[(r) => r.pop(), new RegExp(`exactly ${SHARD_COUNT}`)],
		[(r) => r.push(r[0]), new RegExp(`exactly ${SHARD_COUNT}`)],
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

test("R2: actual exported metadata planner cannot create or verify execution receipts", () =>
	fixture((root, files) => {
		const packagePath = join(root, "exported-package.json");
		writeFileSync(
			packagePath,
			JSON.stringify({ scripts: { "test:desktop": command(files) } }),
		);
		const treePath = join(root, "exported-tree.txt");
		writeFileSync(
			treePath,
			`${files.map((file) => `100644 blob ${HEAD}\t${file}`).join("\n")}\n`,
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
	const files = Array.from(
		{ length: 541 * SHARD_COUNT },
		(_, i) => `scripts/data-${i}.test.mjs`,
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
