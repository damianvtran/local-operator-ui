import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { build } from "esbuild";

/*
 * The main-process facts the composer's `@` picker and the Files panel are
 * built on, exercised against a REAL directory tree rather than a mock.
 *
 * `listDirectory` is the only way a renderer can learn a directory's membership,
 * and `outsideWorkspace` is the fact the chip's needs-approval fill is painted
 * from. Both are asserted here because both are decisions with a right answer
 * that a reviewer would otherwise read off the source: the exclusions are the
 * harness's own listing vocabulary, and the containment rule is the harness's
 * approval gate's (`builtin.py:_resolve_workspace_path` — both sides fully
 * resolved, symlinks included).
 *
 * `probeFiles` joins them, and the properties the Files panel depends on that a
 * real filesystem cannot stage — a hung mount under the deadline, the
 * concurrency bound, cache TTLs — are pinned through its injectable deps in the
 * `probe-files` section below.
 *
 * Bundled rather than imported because the module is TypeScript under `src/main`,
 * the pattern `desktop-contract.test.mjs` established for that tree.
 */

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/main/directory-listing"; export { MAX_PROBE_PATHS } from "./src/shared/desktop-contract";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	listDirectory,
	outsideWorkspace,
	PRUNE_NAMES,
	resolveUserPath,
	DIRECTORY_SCAN_LIMIT,
	probeFiles,
	fsProbeDeps,
	PROBE_CONCURRENCY,
	PROBE_DEADLINE_MS,
	PROBE_POSITIVE_TTL_MS,
	PROBE_FAST_MISS_TTL_MS,
	PROBE_SLOW_MISS_THRESHOLD_MS,
	PROBE_SLOW_MISS_TTL_MS,
	PROBE_CACHE_LIMIT,
	MAX_PROBE_PATHS,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

let root;

before(() => {
	root = mkdtempSync(join(tmpdir(), "lo-directory-listing-"));
	mkdirSync(join(root, "src"));
	mkdirSync(join(root, "node_modules"));
	mkdirSync(join(root, "node_modules", "left-pad"));
	mkdirSync(join(root, ".git"));
	mkdirSync(join(root, "build"));
	writeFileSync(join(root, "app.py"), "print('hi')\n");
	writeFileSync(join(root, "README.md"), "# readme\n");
	writeFileSync(join(root, ".env"), "SECRET=1\n");
	writeFileSync(join(root, "src", "main.ts"), "export {}\n");
	// A symlink to a directory, because the harness follows the link when it asks
	// what an entry is (`DirEntry.is_dir()` does), so a link is a directory row.
	mkdirSync(join(root, "target"));
	symlinkSync(join(root, "target"), join(root, "link"));
});

after(() => {
	if (root) rmSync(root, { recursive: true, force: true });
});

test("a listing returns entries sorted, with dotfiles and build directories out", async () => {
	const listing = await listDirectory(root);
	assert.equal(listing.dir, root);
	assert.equal(listing.error, undefined);
	assert.equal(listing.truncated, false);
	assert.deepEqual(
		listing.entries.map((entry) => entry.name),
		["app.py", "link", "README.md", "src", "target"],
	);
	// A missing exclusion costs ROWS and cannot expand anything the gate would
	// refuse, which is why the set is copied rather than shared with the harness.
	for (const excluded of [".env", ".git", "node_modules", "build"])
		assert.equal(
			listing.entries.some((entry) => entry.name === excluded),
			false,
			`${excluded} should not be listed`,
		);
	for (const name of PRUNE_NAMES)
		assert.ok(typeof name === "string" && name.length > 0);
});

test("a directory is a directory row, and a symlink follows the link", async () => {
	const listing = await listDirectory(root);
	const kinds = new Map(
		listing.entries.map((entry) => [entry.name, entry.directory]),
	);
	assert.equal(kinds.get("src"), true);
	assert.equal(kinds.get("app.py"), false);
	// The link points at a directory, and `stat` follows it: a terminal that asked
	// would say directory, and so does this.
	assert.equal(kinds.get("link"), true);
});

test("a name containing a space lists as one entry", async () => {
	writeFileSync(join(root, "my file.txt"), "x\n");
	const listing = await listDirectory(root);
	assert.ok(listing.entries.some((entry) => entry.name === "my file.txt"));
});

test("an unreadable directory is an error with its reason, not an empty folder", async () => {
	const listing = await listDirectory(join(root, "does-not-exist"));
	assert.deepEqual(listing.entries, []);
	assert.equal(listing.truncated, false);
	assert.equal(typeof listing.error, "string");
	assert.ok(listing.error.length > 0);
	// "Unreadable" and "empty" are different facts and the caller says so: an empty
	// directory is a listing with no error at all.
	const empty = join(root, "target");
	assert.deepEqual((await listDirectory(empty)).entries, []);
	assert.equal((await listDirectory(empty)).error, undefined);
});

test("the entry cap bounds the list and reports the truncation", async () => {
	mkdirSync(join(root, "wide"));
	for (let index = 0; index < 230; index++)
		writeFileSync(
			join(root, "wide", `f${String(index).padStart(3, "0")}.txt`),
			"",
		);
	const listing = await listDirectory(join(root, "wide"));
	assert.equal(listing.entries.length, 200);
	assert.equal(listing.truncated, true);
});

/*
 * THE PATH RULE, and the defect this test exists for. A brand-new chat's draft
 * carries the literal cwd `"~"` (`canonical-sessions-store.ts`), and the rule
 * used to expand only a cwd matching `~/…`: the bare `~` fell through, `join("~",
 * ".")` was `"~"`, and the picker ran `scandir '~'` — ENOENT, zero rows, and no
 * token could ever resolve either, because `probe-files` resolves the same way
 * and answered `~/README.md` for `@README.md`. The feature's only entry point
 * failed on the first attempt of every user who had not yet chosen a directory.
 */
test("a bare `~` working directory expands exactly like a bare `~` path", async () => {
	const home = homedir();
	assert.equal(resolveUserPath("~", undefined, home), home);
	assert.equal(resolveUserPath(".", "~", home), home);
	assert.equal(
		resolveUserPath("README.md", "~", home),
		join(home, "README.md"),
	);
	assert.equal(resolveUserPath("src/", "~", home), join(home, "src/"));
	// The `~/…` spelling keeps working, and both reach the same directory.
	assert.equal(resolveUserPath(".", "~/project", home), join(home, "project"));
	assert.equal(
		resolveUserPath("a.py", "~/project", home),
		resolveUserPath("a.py", join(home, "project"), home),
	);
	// An absolute path is taken literally and an absent cwd changes nothing.
	assert.equal(resolveUserPath("/etc/hosts", "~", home), "/etc/hosts");
	assert.equal(resolveUserPath("a.py", undefined, home), "a.py");
	// Outside the home directory a `~` mid-path is a NAME, not an expansion:
	// `/tmp/~x` is a real directory nobody's home is.
	assert.equal(resolveUserPath("a.py", "/tmp/~x", home), "/tmp/~x/a.py");
});

/*
 * THE SCAN CAP, asserted as a retention rule rather than as a row count.
 *
 * The bound is on the WORK, and the answer it produces is the one a
 * sort-then-truncate produced: the alphabetically-smallest candidates. A shape
 * that simply stopped reading at the cap would answer with whatever the
 * directory's own enumeration order happened to give, which is a listing whose
 * contents depend on the filesystem — so this builds more than twice the cap and
 * checks the 200 rows against the FIRST 200 of a full sorted listing.
 *
 * AND THE UNIFORM PREFIX IT BUILDS CANNOT DISCRIMINATE THE ORDER, which is the
 * half review round 2 (R1) found missing: with one prefix, the display order, the
 * code-unit order and a mixture of two scan windows all begin at the same row. The
 * fixture below has two, so it fails against a cap that retains by code units
 * (`B…` sorts before `a…` there) and against a cap that only prunes at each
 * crossing of the bound (whose pool is neither prefix).
 */
test("more than twice the scan cap still answers with the smallest names", async () => {
	const count = DIRECTORY_SCAN_LIMIT * 2 + 200;
	const wide = join(root, "wider");
	mkdirSync(wide);
	for (let index = 0; index < count; index++)
		writeFileSync(join(wide, `f${String(index).padStart(5, "0")}.txt`), "");
	const listing = await listDirectory(wide);
	assert.equal(listing.truncated, true);
	assert.equal(listing.entries.length, 200);
	const expected = readdirSync(wide)
		.filter((name) => !name.startsWith(".") && !PRUNE_NAMES.includes(name))
		.sort((a, b) => a.localeCompare(b))
		.slice(0, 200);
	assert.deepEqual(
		listing.entries.map((entry) => entry.name),
		expected,
	);
});

test("past the scan cap the answer is the display-alphabetical first entries", async () => {
	/*
	 * Two prefixes whose orders DISAGREE: `localeCompare` puts `a…` before `B…`
	 * (primary-level collation ignores case) and the code units do the opposite, so
	 * the directory has two different "first 200"s and the answer has to be the
	 * display order's — that is the order the picker sorts in. More than twice the
	 * cap, so the retention has to decide and not merely read everything.
	 */
	const each = DIRECTORY_SCAN_LIMIT + 500;
	const mixed = join(root, "mixed-cases");
	mkdirSync(mixed);
	for (let index = 0; index < each; index++) {
		const suffix = String(index).padStart(5, "0");
		writeFileSync(join(mixed, `B${suffix}.txt`), "");
		writeFileSync(join(mixed, `a${suffix}.txt`), "");
	}
	const listing = await listDirectory(mixed);
	assert.equal(listing.truncated, true);
	assert.equal(listing.entries.length, 200);
	const expected = readdirSync(mixed)
		.sort((a, b) => a.localeCompare(b))
		.slice(0, 200);
	assert.deepEqual(
		listing.entries.map((entry) => entry.name),
		expected,
	);
	/*
	 * And the two wrong rules, named so a failure reads as which one came back: the
	 * code-unit prefix (`B00000.txt` upward) or a window's mixture (a row from
	 * mid-alphabet, which is what the crossing-only prune answered with).
	 */
	assert.equal(listing.entries[0].name, "a00000.txt");
	assert.equal(listing.entries[199].name, "a00199.txt");
});

test("outsideWorkspace is the harness's containment rule", async () => {
	assert.equal(outsideWorkspace("/ws/a", "/ws"), false);
	assert.equal(outsideWorkspace("/ws", "/ws"), false);
	assert.equal(outsideWorkspace("/other/a", "/ws"), true);
	// `/wsx` is NOT inside `/ws`, which a prefix test without the separator would
	// get wrong — the same trap the tool-tier check documents.
	assert.equal(outsideWorkspace("/wsx/a", "/ws"), true);
	// An unanswerable question is `undefined` rather than a verdict either way,
	// and an unresolvable target fails closed the way the approval gate does.
	assert.equal(outsideWorkspace("/ws/a", null), undefined);
	assert.equal(outsideWorkspace(null, "/ws"), true);
});

/* ---------------------------------------------------------------------------
 * `probe-files`: the batch a remote open sends, and the properties a real
 * filesystem cannot stage.
 *
 * `probeFiles` is the Files panel's existence probe. A remote session's
 * transcript mentions `/home/ec2-user/...` paths, and on macOS `/home` is an
 * autofs map where a missing-path lookup costs a measured 266-275 ms - the
 * synchronous handler this replaced blocked the main process for 8.00 s on a
 * batch of 30 such paths. The cases below are what keeps the replacement
 * honest: the response shape for exists / missing / error (against the REAL
 * filesystem, through the production deps), the batch dedupe and the cap, the
 * concurrency bound, the two TTLs on an injected clock, and the deadline.
 */

/** The two fault strings the answers below are asserted against. */
const DEADLINE_FAULT = /timed out after \d+ ms/;
const EACCES_FAULT = /EACCES/;

test("a probe answers exists, missing and containment in the handler's shape", async () => {
	const scratch = mkdtempSync(join(tmpdir(), "lo-probe-"));
	const outsideRoot = mkdtempSync(join(tmpdir(), "lo-probe-out-"));
	const inside = join(scratch, "inside.txt");
	const outside = join(outsideRoot, "outside.txt");
	const missing = join(scratch, "not-there.txt");
	try {
		writeFileSync(inside, "hello\n");
		mkdirSync(join(scratch, "adir"));
		writeFileSync(outside, "x\n");
		const asked = [inside, join(scratch, "adir"), missing, outside];
		const [file, dir, absent, out] = await probeFiles(
			asked,
			scratch,
			homedir(),
			fsProbeDeps,
			new Map(),
		);
		assert.deepEqual(
			[file.input, dir.input, absent.input, out.input],
			asked,
			"answers stay in the order the renderer asked",
		);
		// An existing file: the resolved spelling, size and mtime.
		assert.equal(file.resolved, inside);
		assert.equal(file.exists, true);
		assert.equal(file.isFile, true);
		assert.equal(file.sizeBytes, 6);
		assert.ok(file.mtimeMs > 0);
		assert.equal(file.error, undefined);
		assert.equal(file.outsideWorkspace, false);
		// A directory exists and is not a file, with no size to report.
		assert.equal(dir.exists, true);
		assert.equal(dir.isFile, false);
		assert.equal(dir.sizeBytes, null);
		assert.equal(dir.mtimeMs, null);
		// A miss is `exists: false` with NO error - "gone" and "cannot look" are
		// different facts - and the verdict key is present-and-undefined.
		assert.equal(absent.exists, false);
		assert.equal(absent.isFile, false);
		assert.equal(absent.sizeBytes, null);
		assert.equal(absent.mtimeMs, null);
		assert.equal(absent.error, undefined);
		assert.ok("outsideWorkspace" in absent);
		assert.equal(absent.outsideWorkspace, undefined);
		// Outside the workspace's own root: the fail-closed verdict the chip paints.
		assert.equal(out.exists, true);
		assert.equal(out.outsideWorkspace, true);
		// No cwd at all is a caller that cannot ask: undefined, not "inside".
		const [noRoot] = await probeFiles(
			[inside],
			undefined,
			homedir(),
			fsProbeDeps,
			new Map(),
		);
		assert.equal(noRoot.exists, true);
		assert.ok("outsideWorkspace" in noRoot);
		assert.equal(noRoot.outsideWorkspace, undefined);
	} finally {
		rmSync(scratch, { recursive: true, force: true });
		rmSync(outsideRoot, { recursive: true, force: true });
	}
});

test("a batch dedupes repeated paths and is capped at MAX_PROBE_PATHS", async () => {
	let stats = 0;
	const deps = {
		stat: async () => {
			stats += 1;
			return undefined;
		},
		realpath: async () => null,
		now: () => 0,
	};
	const asked = ["/batch/a.md", "/batch/a.md", "/batch/b.md", "/batch/a.md"];
	const results = await probeFiles(asked, undefined, "/home", deps, new Map());
	assert.equal(stats, 2, "one stat for the repeated path, one for the other");
	assert.deepEqual(
		results.map((result) => result.input),
		asked,
	);
	for (const result of results) assert.equal(result.exists, false);

	const many = Array.from(
		{ length: MAX_PROBE_PATHS + 5 },
		(_, index) => `/batch/f${index}.md`,
	);
	const capped = await probeFiles(many, undefined, "/home", deps, new Map());
	assert.equal(capped.length, MAX_PROBE_PATHS);
	assert.equal(stats, 2 + MAX_PROBE_PATHS);
});

test("probe concurrency never exceeds PROBE_CONCURRENCY, and reaches it", async () => {
	let inFlight = 0;
	let peak = 0;
	const deps = {
		stat: async () => {
			inFlight += 1;
			peak = Math.max(peak, inFlight);
			await new Promise((resolve) => setTimeout(resolve, 30));
			inFlight -= 1;
			return undefined;
		},
		realpath: async () => null,
		now: () => 0,
	};
	const asked = Array.from(
		{ length: PROBE_CONCURRENCY + 4 },
		(_, index) => `/slow/f${index}.md`,
	);
	const results = await probeFiles(asked, undefined, "/home", deps, new Map());
	assert.equal(
		peak,
		PROBE_CONCURRENCY,
		"a 64-wide fan-out, or a serial loop, fails this",
	);
	assert.equal(results.length, asked.length);
	// A probe that is slow but inside the deadline answers as a plain miss.
	for (const result of results) {
		assert.equal(result.exists, false);
		assert.equal(result.error, undefined);
	}
});

test("a positive answer is cached for its TTL", async () => {
	const clock = { now: 0 };
	let stats = 0;
	const deps = {
		stat: async () => {
			stats += 1;
			return { isFile: () => true, size: 12, mtimeMs: 34 };
		},
		realpath: async (path) => path,
		now: () => clock.now,
	};
	const cache = new Map();
	const ask = () =>
		probeFiles(["/notes/plan.md"], undefined, "/home", deps, cache);

	const present = await ask();
	assert.equal(stats, 1);
	assert.deepEqual(await ask(), present, "same answer, no second stat");
	assert.equal(stats, 1);
	clock.now = PROBE_POSITIVE_TTL_MS - 1;
	await ask();
	assert.equal(stats, 1, "inside the positive TTL");
	clock.now = PROBE_POSITIVE_TTL_MS + 1;
	await ask();
	assert.equal(stats, 2, "expired, re-probed");
});

test("a miss's damping is rated by what the lookup cost", async () => {
	/*
	 * Round 1's MAJOR: a flat 120 s negative TTL absorbed the renderer's
	 * write-later recovery - a file created after a miss stayed "missing" (and
	 * un-openable) for up to two minutes. The damping now follows the miss's own
	 * cost: only the autofs/mount class that pays 266-275 ms per lookup earns
	 * the long window; a cheap local miss expires in seconds, because a re-probe
	 * of it costs ~0 ms and a long window would buy nothing while costing every
	 * recovery path.
	 *
	 * A fresh slate per arm - its own clock, stat counter and cache - so one
	 * arm's timeline cannot leak into the other's.
	 */
	const slate = (advanceMs) => {
		const clock = { now: 0 };
		let stats = 0;
		const deps = {
			stat: async () => {
				stats += 1;
				clock.now += advanceMs;
				return undefined;
			},
			realpath: async () => null,
			now: () => clock.now,
		};
		return { clock, deps, cache: new Map(), count: () => stats };
	};

	// The cheap class: seconds.
	const fast = slate(0);
	const askFast = () =>
		probeFiles(["/local/gone.md"], undefined, "/home", fast.deps, fast.cache);
	assert.equal((await askFast())[0].exists, false);
	assert.equal(fast.count(), 1);
	fast.clock.now = PROBE_FAST_MISS_TTL_MS - 1;
	await askFast();
	assert.equal(fast.count(), 1, "inside the fast window");
	fast.clock.now = PROBE_FAST_MISS_TTL_MS + 1;
	await askFast();
	assert.equal(
		fast.count(),
		2,
		"the fast window expired and the ask re-probed",
	);

	// The autofs class: the measured 266-275 ms cost, and the long window.
	const slow = slate(PROBE_SLOW_MISS_THRESHOLD_MS + 150);
	const askSlow = () =>
		probeFiles(
			["/home/ec2-user/gone.md"],
			undefined,
			"/home",
			slow.deps,
			slow.cache,
		);
	assert.equal((await askSlow())[0].exists, false);
	assert.equal(slow.count(), 1);
	const cachedAt = PROBE_SLOW_MISS_THRESHOLD_MS + 150;
	slow.clock.now = cachedAt + PROBE_FAST_MISS_TTL_MS + 5_000;
	await askSlow();
	assert.equal(slow.count(), 1, "a slow miss outlives the fast window");
	slow.clock.now = cachedAt + PROBE_SLOW_MISS_TTL_MS - 1;
	await askSlow();
	assert.equal(slow.count(), 1, "still inside the long window");
	slow.clock.now = cachedAt + PROBE_SLOW_MISS_TTL_MS + 1;
	await askSlow();
	assert.equal(
		slow.count(),
		2,
		"the long window expired and the ask re-probed",
	);
});

test("a fast miss stops shadowing a file within seconds, which is the click path's bound", async () => {
	/*
	 * The recovery cell for round 1's MAJOR. The write-later shape: a mention is
	 * probed before the agent has written the file, the file appears, and the
	 * renderer's growth retry (or a click) asks again. The viewer's click probe
	 * (`canvas-file-viewer.tsx`) goes through THIS same cache, so the fast-miss
	 * TTL is what makes the guarantee below true: a file that appears is never
	 * refused as "no longer exists" for longer than PROBE_FAST_MISS_TTL_MS
	 * after the miss it followed. Inside the window the cache still answers the
	 * miss - that is the residual the window exists to absorb (a burst's
	 * duplicate asks); past it the same cache re-probes and sees the file.
	 */
	const clock = { now: 0 };
	let stats = 0;
	let exists = false;
	const deps = {
		stat: async () => {
			stats += 1;
			return exists ? { isFile: () => true, size: 6, mtimeMs: 9 } : undefined;
		},
		realpath: async (path) => path,
		now: () => clock.now,
	};
	const cache = new Map();
	const ask = () =>
		probeFiles(["/tmp/report.md"], undefined, "/home", deps, cache);

	const missed = await ask();
	assert.equal(missed[0].exists, false);
	assert.equal(stats, 1);

	// The write lands.
	exists = true;

	clock.now = PROBE_FAST_MISS_TTL_MS - 1;
	assert.equal((await ask())[0].exists, false);
	assert.equal(stats, 1, "inside the window the cache still answers the miss");

	clock.now = PROBE_FAST_MISS_TTL_MS + 1;
	const seen = await ask();
	assert.equal(stats, 2, "past the window the same cache re-probed");
	assert.equal(seen[0].exists, true);
	assert.equal(seen[0].isFile, true);
});

test("overlapping calls share one app-wide bound", async () => {
	/*
	 * Round 1's R1-3: the pool bound used to be per call, so two overlapping
	 * calls - the panel's batch and a click, say - could put 2x the bound in
	 * flight and charge queue time against each probe's deadline. The gate is
	 * process-wide now, and this cell drives two calls whose probes are slow
	 * enough to overlap: the high-water mark must stay at PROBE_CONCURRENCY,
	 * not twice it.
	 */
	let inFlight = 0;
	let peak = 0;
	const deps = {
		stat: async () => {
			inFlight += 1;
			peak = Math.max(peak, inFlight);
			await new Promise((resolve) => setTimeout(resolve, 25));
			inFlight -= 1;
			return undefined;
		},
		realpath: async () => null,
		now: () => 0,
	};
	const a = Array.from(
		{ length: PROBE_CONCURRENCY + 2 },
		(_, i) => `/a/f${i}.md`,
	);
	const b = Array.from(
		{ length: PROBE_CONCURRENCY + 2 },
		(_, i) => `/b/f${i}.md`,
	);
	const [answersA, answersB] = await Promise.all([
		probeFiles(a, undefined, "/home", deps, new Map()),
		probeFiles(b, undefined, "/home", deps, new Map()),
	]);
	assert.equal(
		peak,
		PROBE_CONCURRENCY,
		"two overlapping calls must not exceed the app-wide bound",
	);
	assert.equal(answersA.length, a.length);
	assert.equal(answersB.length, b.length);
});

test("the cache at its cap drops the oldest answers", async () => {
	/*
	 * Round 1's R1-4: the FIFO eviction branch was the one new path with no
	 * coverage. Fill the map to PROBE_CACHE_LIMIT through the real path, add
	 * two more, and ask the cache who survived: the two oldest insertions
	 * re-probe (they were dropped), while the newest entries - including the
	 * two just added - answer without a stat.
	 */
	let stats = 0;
	const deps = {
		stat: async () => {
			stats += 1;
			return undefined;
		},
		realpath: async () => null,
		now: () => 0,
	};
	const cache = new Map();
	const fill = Array.from(
		{ length: PROBE_CACHE_LIMIT },
		(_, i) => `/cap/f${i}.md`,
	);
	for (let at = 0; at < fill.length; at += MAX_PROBE_PATHS)
		await probeFiles(
			fill.slice(at, at + MAX_PROBE_PATHS),
			undefined,
			"/home",
			deps,
			cache,
		);
	assert.equal(stats, PROBE_CACHE_LIMIT);
	await probeFiles(
		["/cap/extra-a.md", "/cap/extra-b.md"],
		undefined,
		"/home",
		deps,
		cache,
	);
	assert.equal(stats, PROBE_CACHE_LIMIT + 2);

	const before = stats;
	await probeFiles(
		["/cap/f0.md", "/cap/f1.md"],
		undefined,
		"/home",
		deps,
		cache,
	);
	assert.equal(
		stats - before,
		2,
		"the oldest two insertions were evicted, so they re-probe",
	);
	/*
	 * ...and FIFO means every re-insertion evicts the entry behind it: the two
	 * re-probes above dropped f2 and f3, so the frontier entry f2 re-probes too
	 * while a mid-table entry and the newest entries (the just-added pair and
	 * the re-probed f0/f1) are still cached. That is the policy stated
	 * honestly: it is an insertion-order ceiling, not a set that keeps whatever
	 * was hottest.
	 */
	const after = stats;
	await probeFiles(
		[
			"/cap/f2.md",
			"/cap/f1000.md",
			"/cap/f2047.md",
			"/cap/extra-a.md",
			"/cap/extra-b.md",
		],
		undefined,
		"/home",
		deps,
		cache,
	);
	assert.equal(stats - after, 1, "only the frontier entry had been evicted");
});

test("a cached target is re-judged against each call's own workspace root", async () => {
	const rootA = mkdtempSync(join(tmpdir(), "lo-probe-a-"));
	const rootB = mkdtempSync(join(tmpdir(), "lo-probe-b-"));
	try {
		const file = join(rootA, "f.txt");
		writeFileSync(file, "x\n");
		let stats = 0;
		const deps = {
			...fsProbeDeps,
			stat: async (path) => {
				stats += 1;
				return await fsProbeDeps.stat(path);
			},
		};
		const cache = new Map();
		const [inside] = await probeFiles([file], rootA, homedir(), deps, cache);
		const [outside] = await probeFiles([file], rootB, homedir(), deps, cache);
		assert.equal(stats, 1, "the second call was a cache hit, not a re-probe");
		assert.equal(inside.exists, true);
		assert.equal(inside.outsideWorkspace, false);
		// The same cached target, judged against the second call's root: the verdict
		// is per call, never a cached fact.
		assert.equal(outside.exists, true);
		assert.equal(outside.outsideWorkspace, true);
	} finally {
		rmSync(rootA, { recursive: true, force: true });
		rmSync(rootB, { recursive: true, force: true });
	}
});

test("a probe past its deadline answers a fault, not a missing file", async () => {
	let stats = 0;
	const deps = {
		// Never settles: the dead-mount shape the deadline exists for.
		stat: () => {
			stats += 1;
			return new Promise(() => {});
		},
		realpath: async () => null,
		now: () => 0,
	};
	const started = Date.now();
	const [hung] = await probeFiles(
		["/hung/mount.md"],
		undefined,
		"/home",
		deps,
		new Map(),
	);
	const elapsed = Date.now() - started;
	assert.equal(
		stats,
		1,
		"the probe attempted the stat before the deadline fired",
	);
	assert.equal(hung.exists, false);
	assert.equal(hung.isFile, false);
	assert.equal(hung.sizeBytes, null);
	assert.equal(hung.mtimeMs, null);
	assert.match(hung.error, DEADLINE_FAULT);
	// A lower bound is safe - a timer never fires early - while the upper bound is
	// deliberately loose, because this host is shared and a late timer is load;
	// only a deadline that never fires could answer this slowly.
	assert.ok(
		elapsed >= PROBE_DEADLINE_MS - 20,
		`answered in ${elapsed} ms, before the deadline could have fired`,
	);
	assert.ok(
		elapsed < 30_000,
		`the probe hung for ${elapsed} ms; the deadline did not fire`,
	);
});

test("a genuine fault carries its reason, and is not cached", async () => {
	let stats = 0;
	const deps = {
		stat: async () => {
			stats += 1;
			if (stats === 1)
				throw new Error("EACCES: permission denied, stat '/locked/x.md'");
			return undefined;
		},
		realpath: async () => null,
		now: () => 0,
	};
	const cache = new Map();
	const [faulted] = await probeFiles(
		["/locked/x.md"],
		"/ws",
		"/home",
		deps,
		cache,
	);
	assert.equal(faulted.exists, false);
	assert.equal(faulted.isFile, false);
	assert.equal(faulted.sizeBytes, null);
	assert.equal(faulted.mtimeMs, null);
	assert.match(faulted.error, EACCES_FAULT);
	// The `error` field is the ONLY discriminant between this fault and a miss
	// (round 1, R1-2): consumers branch on it and paint UNKNOWN, never "gone".
	// The old error branch omits the verdict entirely rather than saying `false`.
	assert.ok(!("outsideWorkspace" in faulted));
	// A fault is about the attempt, not the file: the next call looks again.
	const [recovered] = await probeFiles(
		["/locked/x.md"],
		"/ws",
		"/home",
		deps,
		cache,
	);
	assert.equal(stats, 2, "the fault was not cached");
	assert.equal(recovered.exists, false);
	assert.equal(recovered.error, undefined);
	assert.ok("outsideWorkspace" in recovered);
});
