#!/usr/bin/env node
/**
 * Capacity partitioning, not a runtime-balancing or memory-fault cure.
 *
 * The inventory is DERIVED from the tree by `desktop-test-inventory.mjs` (every
 * `.test.mjs` file under `scripts/`, recursively, minus its explained `EXEMPT`
 * table), not read off a hand-kept list in package.json; that module's header
 * says why. Keep local
 * full-suite use unchanged; CI selects one deterministic partition and delegates
 * to the existing runner with argv, never a shell or a second test manifest.
 * Importing this module performs no test import, process launch or file writes.
 * Plan/receipt verification uses Node builtins only (no pnpm install in the
 * result job). New command syntax must be supported explicitly, not guessed.
 */
import { createHash } from "node:crypto";
import {
	lstatSync,
	readFileSync,
	readdirSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
	DESKTOP_COMMAND,
	TEST_ROOT,
	discoverDesktopTests,
	runNode,
	selectDesktopTests,
} from "./desktop-test-inventory.mjs";
import { isEntryPoint } from "./entry-point.mjs";

// FOUR, NOT THREE, on measured memory headroom rather than balance: at
// concurrency 3 the guarded runner's process group was killed by the 7.8 GB
// budget at 7.9 GB (run 40992181176) and again at 8.2 GB (run 40996898976) on the
// SAME 205-file shard inventory, both after `ok 1060` with zero failures. The ceiling therefore sits inside the run-to-run distribution,
// so fewer files per process group is what buys headroom; the budget and the
// concurrency guard are deliberately untouched.
export const SHARD_COUNT = 4;
const RUNNER = "scripts/run-desktop-tests.mjs";
const SHA = /^[a-f0-9]{40}$/;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The desktop inventory of `root`, after checking `scripts.test:desktop` is the
 * derived entry point and nothing else.
 *
 * A branch that still carries the old literal file list (or any other command)
 * is refused rather than half-honoured: its paths would be ignored by the walk,
 * and a CI plan that silently disagreed with what `pnpm test:desktop` runs is
 * the drift this planner exists to rule out.
 */
export function inventory(command, root = ROOT) {
	assertDesktopCommand(command);
	return discoverDesktopTests(root);
}

export function assertDesktopCommand(command) {
	if (typeof command !== "string" || !command.trim())
		throw new Error("Missing scripts.test:desktop command");
	if (command !== DESKTOP_COMMAND)
		throw new Error(
			`Unsupported test:desktop grammar; expected exactly ${JSON.stringify(DESKTOP_COMMAND)} (the inventory is derived, not listed)`,
		);
}

export function partition(files, count = SHARD_COUNT) {
	// The floor of 2 keeps a single-shard "partition" from masquerading as
	// capacity work; the ceiling is whatever the CI matrix advertises, so a count
	// nobody runs cannot silently pass here.
	if (![2, 3, 4].includes(count))
		throw new Error("Partition count must be 2, 3 or 4");
	if (!files.length || new Set(files).size !== files.length)
		throw new Error("Empty or duplicate inventory");
	const groups = Array.from({ length: count }, () => []);
	[...files].sort().forEach((file, i) => groups[i % count].push(file));
	if (groups.some((g) => !g.length)) throw new Error("Empty shard");
	return groups;
}

export function validateFiles(root, files) {
	const canonical = realpathSync(root);
	for (const file of files) {
		let path = canonical;
		for (const component of file.split("/")) {
			path = join(path, component);
			let stat;
			try {
				stat = lstatSync(path);
			} catch {
				throw new Error(`Inventory file missing: ${file}`);
			}
			if (stat.isSymbolicLink())
				throw new Error(`Inventory path is a symlink: ${file}`);
		}
		if (
			!lstatSync(path).isFile() ||
			relative(canonical, path).startsWith(`..${sep}`)
		)
			throw new Error(`Not a repository file: ${file}`);
	}
}

export function plan(root, head, checkout, metadataPackage, metadataGitTree) {
	if (!SHA.test(head ?? "") || !SHA.test(checkout ?? ""))
		throw new Error("Expected full requested-head and checkout SHA");
	const pkg = JSON.parse(
		readFileSync(metadataPackage ?? join(root, "package.json"), "utf8"),
	);
	assertDesktopCommand(pkg.scripts?.["test:desktop"]);
	let files;
	if (metadataGitTree) {
		// Explicit metadata mode derives the SAME inventory from an immutable
		// git-ls-tree export, not execution proof. Real CI run/receipt/verify must
		// walk and lstat actual files. A link under the test root fails closed,
		// exactly as the real walk does.
		const candidates = [];
		for (const line of readFileSync(metadataGitTree, "utf8")
			.trimEnd()
			.split("\n")) {
			const match = /^([0-9]{6}) (blob|tree|commit) [a-f0-9]{40}\t(.+)$/.exec(
				line,
			);
			if (!match || !match[3].startsWith(`${TEST_ROOT}/`)) continue;
			if (match[1] === "120000" || match[2] === "commit")
				throw new Error(
					`Inventory path absent or unsafe in pinned Git tree: ${match[3]}`,
				);
			if (/^(100644|100755)$/.test(match[1]) && match[3].endsWith(".test.mjs"))
				candidates.push(match[3]);
		}
		files = selectDesktopTests(candidates.sort());
	} else {
		files = discoverDesktopTests(root);
		validateFiles(root, files);
	}
	const digest = createHash("sha256")
		.update(`${files.join("\n")}\n`)
		.digest("hex");
	return {
		schema: 1,
		mode:
			metadataPackage || metadataGitTree ? "metadata-only" : "checkout-plan",
		executed: false,
		sourceSha: head,
		gitTreeExistence: Boolean(metadataGitTree),
		...(metadataPackage || metadataGitTree ? { metadataOnly: true } : {}),
		head,
		checkout,
		count: SHARD_COUNT,
		digest,
		total: files.length,
		files,
		shards: partition(files),
	};
}

export function tapSummary(text) {
	const counts = {};
	for (const key of ["tests", "pass", "fail", "cancelled", "skipped", "todo"]) {
		const matches = [
			...text.matchAll(new RegExp(`^# ${key} ([0-9]+)\\r?$`, "gm")),
		];
		if (matches.length !== 1)
			throw new Error(`Missing, ambiguous or truncated TAP ${key} summary`);
		counts[key] = Number(matches[0][1]);
	}
	if (
		counts.pass < 60 ||
		counts.fail !== 0 ||
		counts.cancelled !== 0 ||
		counts.tests < counts.pass ||
		/^not ok /m.test(text)
	) {
		throw new Error(
			"Unsuccessful TAP: require positive tests, >=60 passes, fail=cancelled=0 and no not-ok records",
		);
	}
	return counts;
}

/** Actual guarded-runner argv cardinality, not the number of nested TAP cases. */
export function observedRunnerFileCount(text) {
	const lines = text.split(/\r?\n/).filter((line) => {
		// The real runner shares this prefix across count, memory, lane and
		// warning lines. Only cardinality candidates belong to uniqueness.
		// Keep malformed counts as candidates so they cannot hide beside a
		// good count; nested TAP comments and indentation are not evidence.
		return (
			!/^desktop tests: (?:memory bound\b|per-lane bound\b|WARNING\b)/u.test(
				line,
			) &&
			/^desktop tests:\s*(?:[+-]?\d|.*\b(?:files?|concurrency|cap)\b)/.test(
				line,
			)
		);
	});
	if (lines.length !== 1)
		throw new Error("Missing or duplicate guarded-runner file count evidence");
	const match =
		/^desktop tests: ([0-9]+) (file|files), (?:concurrency [1-9][0-9]*|no concurrency cap)(?: \([^\r\n]*\))?$/.exec(
			lines[0],
		);
	if (!match) throw new Error("Malformed guarded-runner file count evidence");
	const count = Number(match[1]);
	if (
		!Number.isSafeInteger(count) ||
		count <= 0 ||
		(count === 1 ? match[2] !== "file" : match[2] !== "files")
	)
		throw new Error("Invalid or zero guarded-runner file count");
	return count;
}

export function receipt(expected, index, text, rc, elapsed) {
	if (expected.metadataOnly || expected.mode === "metadata-only")
		throw new Error("Metadata-only plan cannot produce execution success");
	if (!Number.isInteger(index) || index < 0 || index >= SHARD_COUNT)
		throw new Error(`Invalid shard index (expected 0..${SHARD_COUNT - 1})`);
	if (rc !== 0 || !Number.isFinite(elapsed) || elapsed < 0)
		throw new Error("Only a completed rc=0 suite may write a success receipt");
	const runnerFileCount = observedRunnerFileCount(text);
	if (runnerFileCount !== expected.shards[index].length)
		throw new Error(
			`Guarded-runner file count ${runnerFileCount} differs from planned shard length ${expected.shards[index].length}`,
		);
	return {
		schema: 1,
		runnerFileCount,
		mode: "execution",
		executed: true,
		head: expected.head,
		checkout: expected.checkout,
		digest: expected.digest,
		index,
		count: SHARD_COUNT,
		total: expected.total,
		files: [...expected.shards[index]],
		rc,
		status: "success",
		tap: tapSummary(text),
		elapsed,
	};
}

export function scopeDecision(unit, classifier, workers) {
	// Explicit false alone means no selected suite. Unknown must never read green.
	if (classifier !== "success")
		throw new Error(`Classifier did not succeed: ${classifier}`);
	if (unit === "false") return "skipped";
	if (unit !== "true")
		throw new Error(`Unknown unit scope ${JSON.stringify(unit)}`);
	if (workers !== "success")
		throw new Error(`Shard matrix did not succeed: ${workers}`);
	return "selected";
}

export function verify(expected, receipts, unit, classifier, workers) {
	if (expected.metadataOnly || expected.mode === "metadata-only")
		throw new Error("Metadata-only plan cannot verify execution success");
	if (scopeDecision(unit, classifier, workers) === "skipped") return "skipped";
	if (receipts.length !== SHARD_COUNT)
		throw new Error(
			`Expected exactly ${SHARD_COUNT} receipts, got ${receipts.length}`,
		);
	const indices = new Set();
	const union = [];
	for (const r of receipts) {
		if (r.metadataOnly || r.mode !== "execution" || r.executed !== true)
			throw new Error(
				"Metadata-only or unexecuted receipt cannot prove execution",
			);
		if (
			r.schema !== 1 ||
			!Number.isInteger(r.index) ||
			r.index < 0 ||
			r.index >= SHARD_COUNT ||
			indices.has(r.index)
		)
			throw new Error("Missing/duplicate/invalid shard index");
		indices.add(r.index);
		for (const key of ["head", "checkout", "digest", "total", "count"]) {
			if (r[key] !== expected[key])
				throw new Error(`Receipt ${r.index} has wrong ${key}`);
		}
		if (
			r.status !== "success" ||
			r.rc !== 0 ||
			!Number.isFinite(r.elapsed) ||
			r.elapsed < 0
		)
			throw new Error("Failed/cancelled/non-success receipt");
		if (
			!Number.isSafeInteger(r.runnerFileCount) ||
			r.runnerFileCount <= 0 ||
			r.runnerFileCount !== expected.shards[r.index].length
		)
			throw new Error(
				"Receipt has missing, zero or wrong observed runner file count",
			);
		if (JSON.stringify(r.files) !== JSON.stringify(expected.shards[r.index]))
			throw new Error(
				"Receipt partition is missing, reordered or overlapping files",
			);
		if (
			!r.tap ||
			!Number.isInteger(r.tap.pass) ||
			r.tap.pass < 60 ||
			r.tap.fail !== 0 ||
			r.tap.cancelled !== 0 ||
			!Number.isInteger(r.tap.tests) ||
			r.tap.tests < r.tap.pass
		)
			throw new Error("Receipt has no successful positive TAP proof");
		union.push(...r.files);
	}
	if (
		new Set(union).size !== expected.total ||
		JSON.stringify(union.sort()) !== JSON.stringify(expected.files)
	)
		throw new Error("Shard union differs from the inventory");
	return "passed";
}

/** Artifact names are proof too: do not merge downloads and overwrite duplicates. */
export function loadReceipts(directoryRoot, runId, attempt) {
	if (!directoryRoot) throw new Error("Missing --receipts directory");
	if (!/^[0-9]+$/.test(runId ?? "") || !/^[0-9]+$/.test(attempt ?? ""))
		throw new Error("Missing run/attempt identity");
	const names = readdirSync(directoryRoot).sort();
	const expectedNames = Array.from(
		{ length: SHARD_COUNT },
		(_, i) => `desktop-shard-proof-${runId}-${attempt}-${i}`,
	);
	if (JSON.stringify(names) !== JSON.stringify(expectedNames))
		throw new Error(
			`Expected exactly this run attempt's ${SHARD_COUNT} named receipt artifacts`,
		);
	return names.map((name, index) => {
		const directory = join(directoryRoot, name);
		if (
			lstatSync(directory).isSymbolicLink() ||
			!lstatSync(directory).isDirectory()
		)
			throw new Error("Unsafe receipt artifact directory");
		const file = `shard-${index}.json`;
		if (
			JSON.stringify(readdirSync(directory)) !== JSON.stringify([file]) ||
			lstatSync(join(directory, file)).isSymbolicLink()
		)
			throw new Error("Missing or extra receipt artifact entries");
		return JSON.parse(readFileSync(join(directory, file), "utf8"));
	});
}

function options(args) {
	const result = {};
	for (let i = 0; i < args.length; i += 2) {
		const flag = args[i];
		if (
			!/^--(?:root|head|checkout|index|output|log|rc|elapsed|receipts|unit|classifier|workers|run-id|attempt|metadata-package|metadata-git-tree)$/.test(
				flag,
			) ||
			!args[i + 1] ||
			args[i + 1].startsWith("--") ||
			Object.hasOwn(result, flag.slice(2))
		)
			throw new Error(`Unknown, repeated or missing argument ${flag}`);
		result[flag.slice(2)] = args[i + 1];
	}
	return result;
}

export async function main(args) {
	const [mode, ...rest] = args;
	if (!["plan", "run", "receipt", "verify"].includes(mode))
		throw new Error(
			"Expected explicit plan (metadata-only), run, receipt or verify mode",
		);
	const o = options(rest);
	const allowed = {
		plan: [
			"root",
			"head",
			"checkout",
			"output",
			"metadata-package",
			"metadata-git-tree",
		],
		run: ["root", "head", "checkout", "index"],
		receipt: [
			"root",
			"head",
			"checkout",
			"index",
			"log",
			"rc",
			"elapsed",
			"output",
		],
		verify: [
			"root",
			"head",
			"checkout",
			"receipts",
			"unit",
			"classifier",
			"workers",
			"run-id",
			"attempt",
		],
	};
	for (const key of Object.keys(o))
		if (!allowed[mode].includes(key))
			throw new Error(`Unsupported ${mode} argument --${key}`);
	// A metadata-only dry run may read an immutable Git-exported package file
	// while checking paths against a real tree. Execution/receipt/verify modes
	// reject this override, so it cannot replace their checkout's inventory.
	const expected = plan(
		o.root ?? ROOT,
		o.head,
		o.checkout,
		o["metadata-package"],
		o["metadata-git-tree"],
	);
	if (mode === "plan") {
		const data = `${JSON.stringify(expected, null, 2)}\n`;
		if (o.output) writeFileSync(o.output, data);
		else console.log(data.trimEnd());
		return 0;
	}
	if (mode === "verify") {
		const rows = loadReceipts(o.receipts, o["run-id"], o.attempt);
		console.log(
			`Desktop Tests: ${verify(expected, rows, o.unit, o.classifier, o.workers)} (${expected.total} files, ${expected.count} disjoint shards)`,
		);
		return 0;
	}
	const index = Number(o.index);
	if (
		!/^[0-9]+$/.test(o.index ?? "") ||
		!Number.isInteger(index) ||
		index >= SHARD_COUNT
	)
		throw new Error(`Expected --index 0..${SHARD_COUNT - 1}`);
	if (mode === "receipt") {
		if (!o.output || !o.log || o.rc === undefined || o.elapsed === undefined)
			throw new Error("Receipt requires --output, --log, --rc and --elapsed");
		writeFileSync(
			o.output,
			`${JSON.stringify(
				receipt(
					expected,
					index,
					readFileSync(o.log, "utf8"),
					Number(o.rc),
					Number(o.elapsed),
				),
				null,
				2,
			)}\n`,
		);
		return 0;
	}
	// This is the ONLY execution path. Builtin-only plan/verify never reaches it.
	// The existing runner owns concurrency, memory, lane and hardlink protections.
	return runNode([RUNNER, ...expected.shards[index]], o.root ?? ROOT);
}

if (isEntryPoint(import.meta.url)) {
	try {
		process.exitCode = await main(process.argv.slice(2));
	} catch (error) {
		console.error(`Desktop shard proof failed: ${error.message}`);
		process.exitCode = 1;
	}
}
