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
	EXTERNAL_TESTS,
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

/**
 * Hard ceiling on the files one shard may hold. A lane over it is refused, not
 * warned about.
 *
 * Derived from the only measurement there is, not picked round: the single
 * measured failing lane is 205 files, which exhausted the 7.8 GB process-group
 * budget twice at concurrency 3 (runs 40992181176 and 40996898976, both after
 * `ok 1060` with zero failures) - the measurement that produced the four-way
 * split in SHARD_COUNT. The only measured passing lane is 199 files (salt "60",
 * 786-file inventory). 204 is therefore the largest value the evidence permits:
 * one file below the lane known to fail. It is NOT a claim that 204 is safe -
 * nothing between 199 and 205 has been measured - it is the point where growth
 * must be answered with the design's own levers (re-pick SHARD_SALT, which deals
 * every file afresh, or add a shard) instead of with a bigger number here.
 *
 * Why it cannot be left to the balance tolerance: the planner's 10% guard allows
 * ceil(786/4 * 1.1) = 217 files, which is ABOVE the lane that died. That guard
 * measures balance; this one measures the memory that has already been spent.
 */
export const SHARD_FILE_CEILING = 204;

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

/**
 * Reshard generation. Changing this constant re-shards every file; nothing else
 * does. It carries no meaning beyond being pinned, and it exists so the
 * partition can be moved deliberately, in one reviewed edit, when hash variance
 * has pushed a shard past the size that memory allows.
 *
 * The value is measured, not decorative: `shardIndexOf` deals each path to
 * `sha256(salt\0path) % count`, so shard sizes are hash variance rather than an
 * exact deal. At the 786-file inventory this landed on, an unpinned salt put
 * 223 files on the largest shard — more than the 205-file shard that exhausted
 * the 7.8 GB budget at concurrency 3 (runs 40992181176 and 40996898976, see
 * SHARD_COUNT). Salt "60" gives [199, 198, 190, 199]: a largest shard within one
 * file of the previous deal's 197, so stability below costs no memory headroom
 * today. It will drift as the inventory grows; a shard visibly larger than the
 * others in the per-shard `desktop tests: N files` line means it is time to
 * re-pick this value in its own reviewed change.
 */
export const SHARD_SALT = "60";

/**
 * Shard assignment is a pure function of the file PATH — never of the file's
 * position in the inventory.
 *
 * Round-robin over a sorted list (`groups[i % count]`) is a function of
 * position: one added or removed inventory file shifted every later file by a
 * slot and rotated it to another shard. Measured on the 786-file inventory of
 * 2026-11-08, adding one file that sorts early moved 786/786 existing files
 * (100%), adding five moved 384/786 (49%), and removing one moved 485/785
 * (62%). A PR head and the main head it merges into differ by exactly those
 * edits, which is how one test was filed as node 1244 in shard 3/4 on main
 * push 4d51e254 (run 42506540162) and node 1484 in shard 1/4 on the next main
 * push c9a87f7e (run 42508422068) with no change to its own bytes — a suite
 * that can pass on a branch and fail on main because the buckets moved is not
 * a merge gate.
 *
 * Hashing the path alone means a file's shard changes only when SHARD_COUNT or
 * SHARD_SALT changes: the two deliberate, whole-file, reviewer-visible levers.
 * Within a shard files are dispatched in sorted order, so a shard's run order
 * is deterministic too. A file's node index still shifts when a new file in the
 * SAME shard sorts before it, which renumbers the tail of that one shard and
 * leaves every other shard's numbering untouched.
 */
export function shardHash(file) {
	return createHash("sha256")
		.update(`${SHARD_SALT}\u0000${file}`)
		.digest()
		.readUInt32BE(0);
}

export function shardIndexOf(file, count = SHARD_COUNT) {
	return shardHash(file) % count;
}

/**
 * Refuses a partition whose largest shard is over SHARD_FILE_CEILING.
 *
 * Hard failure, never a warning: nothing downstream re-measures a lane's size,
 * so a lane that grew past the ceiling would simply be launched into the memory
 * distribution that has already killed the suite. The message names the shard,
 * its file count, the ceiling and the runs behind it, so the person who trips it
 * can see what the number protects before touching it.
 */
export function assertShardCeiling(groups) {
	const largest = groups.reduce((a, b) => (b.length > a.length ? b : a));
	if (largest.length <= SHARD_FILE_CEILING) return groups;
	throw new Error(
		`Desktop shard ${groups.indexOf(largest) + 1}/${groups.length} holds ${largest.length} files, over the ${SHARD_FILE_CEILING}-file memory ceiling: a 205-file shard exhausted the 7.8 GB process-group budget at concurrency 3 twice (runs 40992181176 and 40996898976, both after ok 1060 with zero failures), which is why the suite is split ${groups.length} ways at all. Re-pick SHARD_SALT (currently ${JSON.stringify(SHARD_SALT)}) in a reviewed change so every path is dealt again, or add a shard; if no salt keeps every lane under ${SHARD_FILE_CEILING} the split itself has to change. Do not raise this ceiling without a measured run at that shard size.`,
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
	for (const file of files) groups[shardIndexOf(file, count)].push(file);
	// A lane holding no file cannot produce a receipt — a zero-file run has no
	// guarded-runner count to prove — so an empty group is refilled from the
	// largest one by stable hash priority: lowest hash, lexicographic tiebreak.
	//
	// This branch is a NAMED, BOUNDED EXCEPTION to the path-determinism the rest
	// of this module guarantees, and it is reachable with MORE files than lanes:
	// the comment here used to claim it needed "an inventory smaller than the shard
	// count", which is false and is pinned as false by the planner's own test —
	// five paths over four lanes deal [3,1,0,1], so lane 2 is empty with five >
	// four. Refill is not POSITION dependent (reordering the inventory changes
	// nothing: it reads hashes, then a lexicographic tiebreak), but it IS
	// INVENTORY dependent: whether a file moves depends on which other files
	// exist, so adding the file that fills the empty lane moves one file back.
	// That is acceptable because of two bounds, both arithmetic rather than hope.
	// First, it cannot hide a memory violation: `plan` asserts the ceiling on the
	// partition that is actually dispatched, i.e. AFTER this loop, and refill can
	// only take files out of a lane and give them to a one-file lane, so it can
	// never enlarge the largest one. Second, it cannot reach a suite this size:
	// with an empty lane, passing the ceiling needs the two other lanes at 204 or
	// less and the largest at 205 or less, so at most 613 (3 x the ceiling, + 1)
	// files can be refilled and dispatched - well under the 786-file inventory,
	// whose deal leaves no lane empty at all. Its reach is the small fixture trees
	// the planner's own tests build.
	for (
		let empty = groups.findIndex((group) => !group.length);
		empty !== -1;
		empty = groups.findIndex((group) => !group.length)
	) {
		const largest = groups.reduce((a, b) => (b.length > a.length ? b : a));
		if (largest.length < 2) throw new Error("Empty shard");
		let pick = 0;
		for (let i = 1; i < largest.length; i++) {
			const order =
				shardHash(largest[i]) - shardHash(largest[pick]) ||
				(largest[i] < largest[pick] ? -1 : 1);
			if (order < 0) pick = i;
		}
		groups[empty].push(largest.splice(pick, 1)[0]);
	}
	if (groups.some((group) => !group.length)) throw new Error("Empty shard");
	for (const group of groups) group.sort();
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
			if (
				!match ||
				!(
					match[3].startsWith(`${TEST_ROOT}/`) ||
					EXTERNAL_TESTS.includes(match[3]) ||
					EXTERNAL_TESTS.some((file) => file.startsWith(`${match[3]}/`))
				)
			)
				continue;
			if (match[1] === "120000" || match[2] === "commit")
				throw new Error(
					`Inventory path absent or unsafe in pinned Git tree: ${match[3]}`,
				);
			if (/^(100644|100755)$/.test(match[1]) && match[3].endsWith(".test.mjs"))
				candidates.push(match[3]);
		}
		for (const file of EXTERNAL_TESTS)
			if (!candidates.includes(file))
				throw new Error(
					`External desktop test missing from pinned Git tree: ${file}`,
				);
		files = selectDesktopTests(candidates.sort());
	} else {
		files = discoverDesktopTests(root);
		validateFiles(root, files);
	}
	const digest = createHash("sha256")
		.update(`${files.join("\n")}\n`)
		.digest("hex");
	// The memory ceiling is asserted here, on the partition that will actually be
	// dispatched, and not inside `partition` itself: this is the single production
	// path from a derived inventory to a CI lane (plan, run, receipt and verify all
	// come through `plan`), while `partition` is also the deal the planner's own
	// fixtures shape at synthetic sizes no CI lane will ever carry. Hard failure:
	// a lane over the ceiling has already killed the suite twice, so a warning
	// here would be a warning about a dead run.
	const shards = assertShardCeiling(partition(files));
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
		shards,
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
		// Parent diagnostics use the same namespace, but their JSON `file`
		// fields are not argv cardinality. Admit only the anchored count-record
		// envelope, not arbitrary occurrences of "file" later in a log line.
		// Keep malformed true records (bad number, comma or concurrency) in the
		// candidate set so one cannot hide beside a good record. Nested TAP
		// comments and indentation remain ineligible as execution evidence.
		if (line.startsWith("desktop tests: diagnostic ")) return false;
		return /^desktop tests:\s*(?:[+-]?\d|\S+\s+files?\b|files?\b|(?:no\s+)?concurrency\b|cap\b)/.test(
			line,
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
