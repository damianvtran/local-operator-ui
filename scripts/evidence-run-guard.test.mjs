import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	realpathSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { pythonChildEnv } from "./python-child-env.mjs";

const guard = fileURLToPath(
	new URL("./evidence-run-guard.py", import.meta.url),
);
/*
 * One environment for every python this file starts, and it states the python
 * variables rather than inheriting them (scripts/python-child-env.mjs): these
 * spawns are real interpreters, and the ambient `PYTHONPYCACHEPREFIX` of an
 * agent shell has pointed inside the operator's installed app, which is how a
 * harness wrote 19 `.pyc` into it. The `CMUX_*` scrub stays - an inherited
 * `CMUX_WORKSPACE_ID` once let a headless test rename the operator's real cmux
 * workspaces - and the guard's own node child inherits both decisions.
 */
const env = pythonChildEnv({
	base: Object.fromEntries(
		Object.entries(process.env).filter(([key]) => !key.startsWith("CMUX_")),
	),
});

function fixture(t) {
	const root = realpathSync(
		mkdtempSync(join(tmpdir(), "evidence-guard-test-")),
	);
	t.after(() => rmSync(root, { recursive: true, force: true }));
	return join(root, "lease");
}

function attempt(lock, code = 'console.log("admitted")') {
	return spawnSync("python3", [guard, lock, process.execPath, "-e", code], {
		encoding: "utf8",
		env,
		timeout: 5000,
	});
}

async function holder(t, lock, code) {
	const child = spawn("python3", [guard, lock, process.execPath, "-e", code], {
		env,
		stdio: ["pipe", "pipe", "pipe"],
	});
	t.after(() => {
		if (child.exitCode === null && child.signalCode === null)
			child.kill("SIGKILL");
	});
	child.stdout.setEncoding("utf8");
	let output = "";
	child.stdout.on("data", (chunk) => {
		output += chunk;
	});
	const closed = once(child, "close");
	// Wait for actual admission, not an arbitrary sleep that races a slow host.
	while (!output.includes("ready\n")) {
		const event = await Promise.race([
			once(child.stdout, "data"),
			closed.then(() => {
				throw new Error(`holder exited before ready: ${output}`);
			}),
		]);
		assert.ok(event);
	}
	return { child, closed };
}

/**
 * The pid the admitted guard wrote into the lease, or `null` while it is unwritten.
 *
 * The guard truncates the file, writes `pid=<its own pid>` and `exec`s the asked
 * command in place - so for the CLI under test this is the GUARD's pid, one hop
 * below the node process this test spawns, and it is not comparable to `child.pid`.
 * What is readable is that the value CHANGES when a new admission happens, which is
 * how this test waits for one without probing or locking anything itself. The lease
 * file outlives a sweep on purpose ("normal exit preserves inode"), so a value left
 * by an earlier arm is the reason the comparison is against the previous pid.
 */
function leasePid(lock) {
	try {
		const match = /pid=(\d+)/.exec(readFileSync(lock, "utf8"));
		return match ? Number(match[1]) : null;
	} catch {
		return null;
	}
}

const waitForStdin =
	'console.log("ready"); process.stdin.resume(); process.stdin.on("end", () => process.exit(0));';

test(
	"contenders defer immediately across working directories; normal exit preserves inode",
	{ timeout: 10000 },
	async (t) => {
		const lock = fixture(t);
		const { child, closed } = await holder(t, lock, waitForStdin);
		const inode = statSync(lock).ino;
		// Even apparently dead metadata must not let a contender steal a live lease.
		writeFileSync(lock, "pid=999999999\n");
		const contenders = await Promise.all(
			Array.from({ length: 4 }, async () => {
				const contender = spawn(
					"python3",
					[guard, lock, process.execPath, "-e", 'console.log("UNSAFE")'],
					{
						cwd: "/",
						env: { ...env, HOME: "/nonexistent", TMPDIR: "/nonexistent" },
					},
				);
				let output = "";
				contender.stdout.on("data", (data) => {
					output += data;
				});
				contender.stderr.on("data", (data) => {
					output += data;
				});
				const [status] = await once(contender, "close");
				return { status, output };
			}),
		);
		for (const result of contenders) {
			assert.equal(result.status, 75);
			assert.match(result.output, /DEFERRED.*No frames checked/);
			assert.doesNotMatch(result.output, /UNSAFE/);
		}
		child.stdin.end();
		assert.equal((await closed)[0], 0);
		assert.equal(attempt(lock).status, 0);
		assert.equal(statSync(lock).ino, inode);
	},
);

test(
	"dead-holder recovery never unlinks or trusts PID metadata",
	{ timeout: 10000 },
	async (t) => {
		const lock = fixture(t);
		const { child, closed } = await holder(t, lock, waitForStdin);
		const inode = statSync(lock).ino;
		child.kill("SIGKILL");
		assert.equal((await closed)[1], "SIGKILL");
		// A live, unrelated PID (including a reused old PID) is not a lock owner.
		writeFileSync(lock, `pid=${process.pid}\n`);
		const result = attempt(lock);
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /admitted/);
		assert.equal(statSync(lock).ino, inode);
	},
);

test(
	"heavy child retains admission after its launcher exits",
	{ timeout: 10000 },
	async (t) => {
		const lock = fixture(t);
		const release = `${lock}-release`;
		const descendant = `console.log('ready'); const tick = setInterval(() => { if (require('node:fs').existsSync(${JSON.stringify(release)})) { clearInterval(tick); clearTimeout(deadline); } }, 10); const deadline = setTimeout(() => process.exit(2), 5000);`;
		const code = `const {spawn} = require('node:child_process'); spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], {stdio:['ignore','inherit','inherit',3]}); process.exit(0);`;
		const { child, closed } = await holder(t, lock, code);
		if (child.exitCode === null) await once(child, "exit");
		assert.equal(child.exitCode, 0);
		assert.equal(attempt(lock).status, 75);
		writeFileSync(release, "release");
		await closed;
		assert.equal(attempt(lock).status, 0);
	},
);

/**
 * A disposable checkout whose CLI is the REAL one, relocated so its lease lives
 * in the fixture's temp dir.
 *
 * Extracted rather than repeated because two cases now drive a real sweep - the
 * one that pins deferral and the failure wording, and the one that pins that the
 * lease is held while frames are being checked - and a second copy of this setup
 * is where the two would drift: a module edge added to one copy and not the other
 * fails the case that did not get it, with an error about an import rather than
 * about admission. `frames` is the number of REAL frames the sweep will find, one
 * per subdirectory (each named `synthetic.webp`, so the theme the fixture
 * declares is the theme each frame is judged against).
 */
async function realSweep(
	t,
	lock,
	{ frames = 1, size = 10, timeout = 5000 } = {},
) {
	const root = dirname(lock);
	const scripts = join(root, "scripts");
	mkdirSync(scripts, { recursive: true });
	for (const name of [
		"evidence-run-guard.py",
		"color.mjs",
		"palette-source.mjs",
		/*
		 * `check-evidence.mjs` imports this one for the story `dir` table it holds,
		 * so the fixture's script set has to mirror that edge the way it already
		 * mirrors the two module-level imports. The copy is deliberate over a stub:
		 * the CLI under test is the real one, and it has to resolve its own
		 * dependency for real or this test would be testing a fixture's shape.
		 * `capture-evidence.mjs` is safe to copy here - it reads nothing at import
		 * time and its own `check-evidence.mjs` import resolves to the relocated copy
		 * beside it.
		 */
		"capture-evidence.mjs",
		/*
		 * The rig keychain helper, which `capture-evidence.mjs` imports at module
		 * level now that the rigs' Chrome is kept out of the operator's keychain - the
		 * same edge as `check-evidence.mjs` above, and the same failure without it:
		 * the relocated CLI cannot import at all, loudly, before it reads anything.
		 */
		"chrome-keychain.mjs",
		/*
		 * Both CLIs resolve their own entry point through this module
		 * (`scripts/entry-point.mjs`), which is how the guarded re-exec works at all:
		 * without it in the relocated set the copy fails to IMPORT - loudly, and
		 * before it reads anything.
		 */
		"entry-point.mjs",
		/*
		 * The shared child-environment helper. `check-evidence.mjs` builds the
		 * environment of the python guard it spawns with it, so it is one more module
		 * edge in the relocated set, with the same failure without it.
		 */
		"python-child-env.mjs",
	]) {
		copyFileSync(join(dirname(guard), name), join(scripts, name));
	}
	// Only relocate the fixed lock literal in this disposable checkout. There is
	// deliberately no production env override that lets sibling worktrees opt out.
	const source = readFileSync(
		new URL("./check-evidence.mjs", import.meta.url),
		"utf8",
	);
	assert.equal(
		source.split('"/tmp/local-operator-ui-check-evidence.lock"').length,
		2,
	);
	const entry = join(scripts, "check-evidence.mjs");
	writeFileSync(
		entry,
		source.replace(
			'"/tmp/local-operator-ui-check-evidence.lock"',
			JSON.stringify(lock),
		),
	);
	const palettes = join(root, "src/renderer/src/shared/themes/palettes");
	mkdirSync(palettes, { recursive: true });
	writeFileSync(
		join(palettes, "synthetic.ts"),
		'id: "synthetic", palette: { canvas: "#000000" }',
	);
	const evidence = join(root, "docs/evidence");
	for (let index = 0; index < frames; index += 1) {
		const dir = join(evidence, `frame-${index}`);
		mkdirSync(dir, { recursive: true });
		await writeFrame(join(dir, "synthetic.webp"), size);
	}
	/*
	 * `sharp` resolves through `node_modules`, and the relocated CLI is a copy in a
	 * tmp tree: without this link the guard's own import of the decoder cannot be
	 * resolved and every case below fails for a reason that has nothing to do with
	 * admission. Linked rather than copied for the same reason a worktree is: the
	 * dependency store is shared on this machine and a second copy of it is not what
	 * this test is about.
	 */
	const modules = join(root, "node_modules");
	if (!existsSync(modules)) {
		symlinkSync(join(dirname(dirname(guard)), "node_modules"), modules);
	}
	const cliEnv = { ...env };
	const cli = (extra = {}) =>
		spawnSync(process.execPath, [entry], {
			env: { ...cliEnv, ...extra },
			encoding: "utf8",
			timeout,
		});
	return { root, scripts, entry, cli, cliEnv, evidence };
}

/**
 * A REAL frame, decoded by the guard's own reader.
 *
 * The fixture used to put a stub `magick` on PATH and let the sweep call it; the
 * sweep now decodes in process, so the only way to exercise the real path is to
 * hand it a real image. `size` x `size` with 60% ground pixels and 40% white ones
 * reproduces what the stub printed (`60: #000000`, `40: #FFFFFF`): the mode is the
 * palette's one ground colour and its coverage is 60%, which is what
 * `assertFramePaints` demands - a frame that is entirely one colour would fail the
 * uniformity ceiling instead.
 *
 * Lossless, so the pixels are exactly the ones written: a lossy encode would shift
 * them and this test would be asserting the encoder's rounding rather than the
 * guard's.
 */
async function writeFrame(file, size) {
	const pixels = Buffer.alloc(size * size * 3, 0xff);
	const ground = Math.floor(size * size * 0.6);
	for (let index = 0; index < ground; index += 1)
		pixels.fill(0, index * 3, index * 3 + 3);
	await sharp(pixels, { raw: { width: size, height: size, channels: 3 } })
		.webp({ lossless: true })
		.toFile(file);
}

test(
	"real CLI defers before frames, holds the lease itself, and preserves failures",
	{ timeout: 15000 },
	async (t) => {
		const lock = fixture(t);
		const { cli, evidence, root, entry, cliEnv } = await realSweep(t, lock);
		const { child, closed } = await holder(t, lock, waitForStdin);
		const deferred = cli();
		assert.equal(deferred.status, 75, deferred.stderr);
		assert.match(deferred.stderr, /DEFERRED/);
		assert.doesNotMatch(deferred.stdout, /Evidence holds/);
		const imported = spawnSync(
			process.execPath,
			["--input-type=module", "-e", `await import(${JSON.stringify(entry)})`],
			{ env: cliEnv, encoding: "utf8", timeout: 5000 },
		);
		assert.equal(imported.status, 0, imported.stderr);
		assert.equal(imported.stdout, "");
		child.stdin.end();
		await closed;
		const passed = cli();
		assert.equal(passed.status, 0, passed.stderr);
		assert.match(passed.stdout, /Evidence holds: 1 frames/);
		/*
		 * The two readings the decode CHILD used to report - that it had inherited
		 * the lease on fd 3, and that a contender was deferred while it ran - are
		 * deliberately not replaced one for one. There is no child any more: the
		 * sweep decodes in its own process and holds admission for exactly its own
		 * lifetime, which is what the `deferred` case above and the "heavy child
		 * retains admission after its launcher exits" case already pin at the guard
		 * level, where the property belongs.
		 */
		/*
		 * A frame whose THEME still resolves, in a subdirectory, so this case
		 * reaches the decode rather than the "no palette named" check that would
		 * catch a misnamed file first. The verdict under test is "this tool could
		 * not read the file", which is a different finding from "this frame is not
		 * a picture of its theme".
		 */
		mkdirSync(join(evidence, "broken"), { recursive: true });
		writeFileSync(join(evidence, "broken", "synthetic.webp"), "not an image");
		const failed = cli();
		assert.equal(failed.status, 1, failed.stdout);
		assert.match(failed.stderr, /could not read the image/);
		const unavailable = cli({ PATH: root });
		assert.equal(unavailable.status, 1);
		assert.match(
			unavailable.stderr,
			/BLOCKED.*Python 3 with POSIX flock is required/,
		);
	},
);

test(
	"the real sweep holds admission while it checks frames, and releases it at exit",
	{ timeout: 120000 },
	async (t) => {
		/*
		 * The stub `magick` this suite used to put on PATH reported, from inside the
		 * decode child, that it had inherited the lease and that a contender was
		 * deferred while it ran - which is how "a second sweep is deferred WHILE
		 * frames decode" was pinned. The sweep decodes in process now, so there is no
		 * image child to report it, and review round 1 was right that nothing
		 * replaced those two readings directly. This case does.
		 *
		 * What is observable from outside the sweep is: a contender is deferred at a
		 * moment when the sweep is still running over a non-empty frame set, and it is
		 * admitted once the sweep has exited. The lease's lifetime is the guard's (fd
		 * 3 for the command's whole life, pinned by the "heavy child retains admission
		 * after its launcher exits" case), so a lease held for the whole of a run that
		 * checks frames is the property - and it is the one the removal put at risk.
		 *
		 * The frame set is raised if the sweep wins the race to finish: a host fast
		 * enough to finish 12 large frames before a contender's first ask is a fixture
		 * that is too small, not a failure, and the retry says so rather than flaking.
		 */
		const lock = fixture(t);
		let decided = null;
		for (const frames of [12, 48]) {
			const sweepFixture = await realSweep(t, lock, {
				frames,
				size: 900,
				timeout: 120000,
			});
			const sweep = spawn(process.execPath, [sweepFixture.entry], {
				env: sweepFixture.cliEnv,
				stdio: ["ignore", "pipe", "pipe"],
			});
			const admittedBefore = leasePid(lock);
			let stdout = "";
			sweep.stdout.on("data", (chunk) => {
				stdout += chunk;
			});
			/*
			 * Wait for THIS sweep to be admitted before asking a contender. Asking
			 * first is a race the sweep can lose: the contender's own ask takes
			 * admission, the sweep is deferred and exits 75, and the case then reports
			 * on a sweep that never ran - which is how this case first failed after the
			 * fold, at `lastExit=75` with an empty stdout. The lease is the signal, and
			 * the pid in it is the process the guard exec'd, which is the one spawned
			 * here.
			 */
			const deadline = Date.now() + 30000;
			while (
				sweep.exitCode === null &&
				Date.now() < deadline &&
				leasePid(lock) === admittedBefore
			) {
				await new Promise((resolve) => setTimeout(resolve, 20));
			}
			if (sweep.exitCode === null && leasePid(lock) !== admittedBefore) {
				if (sweepFixture.cli().status === 75) {
					decided = {
						frames,
						stdout: () => stdout,
						sweep,
						cli: sweepFixture.cli,
					};
					break;
				}
			}
			if (decided) break;
			// Finished before a contender could ask; re-run with a bigger frame set.
			if (sweep.exitCode === null) await once(sweep, "exit");
		}
		assert.ok(
			decided,
			"the sweep finished before any contender was asked, with no frame set large enough to observe it: this case cannot report on admission it never saw",
		);
		const [code] = await once(decided.sweep, "exit");
		assert.equal(code, 0, decided.stdout());
		assert.match(decided.stdout(), /Evidence holds: \d+ frames/);
		/*
		 * And the release at exit, which is the other half of the property: once the
		 * sweep is gone, the next contender is admitted rather than inheriting a lease
		 * nobody holds.
		 */
		const after = decided.cli();
		assert.equal(after.status, 0, after.stderr);
		assert.match(after.stdout, /Evidence holds/);
	},
);

test("unsafe lock path and command failure fail closed; priority is inherited", (t) => {
	const lock = fixture(t);
	const target = `${lock}-target`;
	writeFileSync(target, "untouched");
	symlinkSync(target, lock);
	const blocked = attempt(lock);
	assert.equal(blocked.status, 1);
	assert.match(blocked.stderr, /BLOCKED.*admission unavailable/);
	assert.equal(readFileSync(target, "utf8"), "untouched");
	const other = `${lock}-valid`;
	assert.equal(attempt(other, "process.exit(23)").status, 23);
	const priority = attempt(
		other,
		'console.log(require("node:os").getPriority())',
	);
	assert.equal(priority.status, 0, priority.stderr);
	assert.ok(Number(priority.stdout.trim()) >= 10, priority.stdout);
	const missing = spawnSync(
		"python3",
		[guard, other, "/nonexistent/evidence-command"],
		{ env, encoding: "utf8", timeout: 5000 },
	);
	assert.equal(missing.status, 1);
	assert.match(missing.stderr, /BLOCKED/);
	assert.equal(attempt(other).status, 0);
});

/**
 * The unsupported-HOST path, which no fixture reaches by running the guard
 * normally: it needs a machine whose `fcntl` is absent, and `fcntl` is a
 * POSIX-only stdlib module every CI runner here has. Making the import itself
 * fail is the portable stand-in for that host, and the guard returns before it
 * opens the lease, so this cannot reach a real one.
 *
 * Bound because the message IS this path's deliverable: a reader told only the
 * module's name goes looking for something to install, and `fcntl` has no wheel
 * (design round 1, D1). The claim that nothing was checked is the half a reader
 * would otherwise have to assume, so it is asserted rather than trusted.
 */
test("an unavailable POSIX locking module names the platform, not a module", (t) => {
	const lock = fixture(t);
	const blocked = spawnSync(
		"python3",
		[
			"-c",
			'import sys, runpy; sys.modules["fcntl"] = None; sys.argv = sys.argv[1:]; runpy.run_path(sys.argv[0], run_name="__main__")',
			guard,
			lock,
			process.execPath,
			"-e",
			'console.log("UNSAFE")',
		],
		{ encoding: "utf8", env, timeout: 5000 },
	);
	assert.equal(blocked.status, 1, blocked.stderr);
	assert.match(
		blocked.stderr,
		/BLOCKED: Python 3 with POSIX locking is required/,
	);
	assert.match(blocked.stderr, /No frames checked/);
	assert.match(
		blocked.stderr,
		/Use a supported environment, then rerun `pnpm check-evidence`/,
	);
	// The raw detail stays, after the recovery the reader can act on.
	assert.match(blocked.stderr, /Detail: /);
	assert.doesNotMatch(blocked.stdout, /UNSAFE/);
	assert.equal(existsSync(lock), false);
});

/**
 * A frame that is one colour start to finish, with no ground/body split.
 *
 * `writeFrame` deliberately sits just under the uniformity ceiling (60% ground,
 * 40% white) so it PASSES; this is its opposite, the shape the guard refuses. The
 * two together are what make the refusal cases meaningful: a suite that only ever
 * fed the guard passing frames would not know the difference.
 */
async function writeFlatFrame(file, size) {
	const pixels = Buffer.alloc(size * size * 3, 0);
	await sharp(pixels, { raw: { width: size, height: size, channels: 3 } })
		.webp({ lossless: true })
		.toFile(file);
}

/**
 * Every CALL site of `name` in a flattened source text, with whether the call is
 * awaited.
 *
 * A definition cannot match: `const name = async (…)` has ` = async ` between the
 * name and the parenthesis, so only `name(` with the opening paren immediately
 * after the name is found. Comments are stripped by the caller, because a
 * docstring naming the function is not a call site.
 */
function callSites(text, name) {
	const found = [];
	let at = text.indexOf(`${name}(`);
	while (at !== -1) {
		const before = text.slice(Math.max(0, at - 60), at);
		found.push({ before, awaited: /await\s*$/.test(before) });
		at = text.indexOf(`${name}(`, at + 1);
	}
	return found;
}

test("every call site of the guard's async readers awaits them", () => {
	/*
	 * QA round 1, Q-1: `assertFramePaints` became async in this change and one call
	 * site in a committed harness was left without `await`. That is not a loud
	 * failure - the rejected promise surfaces as an unhandled rejection AFTER the
	 * next statement has run, so the rig writes the frame the guard refused, logs
	 * it, and reaches `process.exit(0)`: the sweep's refusal is reported as a
	 * successful capture.
	 *
	 * The instance is fixed with an `await`; this is the class. It is the same
	 * shape the window-mode "present sites" scan uses, and the reason it has to be a
	 * scan rather than a case: the bug is an omission in a file the suite does not
	 * otherwise execute (the rigs need Electron and a real Chrome), so only reading
	 * every call site can find the next one.
	 *
	 * The rule is deliberately the strict one - the call must be awaited where it is
	 * written. `const p = assertFramePaints(...); await p;` would be correct and is
	 * flagged; if a future caller needs that shape, this test is where the
	 * conversation happens rather than in a silent omission.
	 */
	const roots = ["scripts", "docs", "src", "bin"].filter((root) =>
		existsSync(root),
	);
	const files = roots
		.flatMap((root) =>
			readdirSync(root, { recursive: true }).map((f) => join(root, String(f))),
		)
		.filter((file) => /\.(?:mjs|js|ts|tsx)$/.test(file))
		.filter((file) => !file.includes("node_modules"))
		.filter((file) => file !== "scripts/evidence-run-guard.test.mjs");
	const offenders = [];
	let sites = 0;
	for (const file of files) {
		const text = readFileSync(file, "utf8")
			.replace(/\/\*[\s\S]*?\*\//g, " ")
			.replace(/\/\/[^\n]*/g, " ");
		for (const name of ["assertFramePaints", "frameHistogram"]) {
			for (const site of callSites(text, name)) {
				sites += 1;
				if (!site.awaited) offenders.push(`${file}: ${name} without await`);
			}
		}
	}
	assert.deepEqual(
		offenders,
		[],
		`these call sites do not await an async reader: ${offenders.join(", ")}`,
	);
	// A scan that matched nothing would pass, so the sites it did find are counted:
	// four rig call sites plus the guard's own two.
	assert.ok(
		sites >= 6,
		`expected the tree's awaited call sites, found ${sites}`,
	);
});

test(
	"a frame the paint guard refuses reddens the sweep rather than passing it",
	{ timeout: 30000 },
	async (t) => {
		/*
		 * The end-to-end half of Q-1: the guard was silently downgraded by the
		 * sync-to-async conversion, so what has to hold is that a REFUSED frame - not
		 * merely an unreadable one, which the case above covers - stops the sweep and
		 * is reported. The frame is flat, in a subdirectory whose file name still
		 * resolves the fixture's palette, so the sweep reaches the verdict rather
		 * than the "no palette named" check.
		 */
		const lock = fixture(t);
		const { cli, evidence } = await realSweep(t, lock, { frames: 1 });
		mkdirSync(join(evidence, "flat"), { recursive: true });
		await writeFlatFrame(join(evidence, "flat", "synthetic.webp"), 10);
		const refused = cli();
		assert.equal(refused.status, 1, refused.stdout);
		/*
		 * A VERDICT failure is a `FAIL  …` line on stdout, not the stderr path the
		 * unreadable-frame case above uses: that one is the reader throwing, this one
		 * is the sweep judging a frame it could read. The sweep also carries its own
		 * wording ("this frame is a ground with nothing on it") rather than
		 * `assertFramePaints`'s ("the story painted its ground and nothing else"),
		 * because the two answer the same question for different audiences - which is
		 * why the assertion is about the sweep REPORTING a refused frame, not about
		 * which sentence it borrows.
		 */
		assert.match(refused.stdout, /FAIL .*is a ground with nothing on it/);
		assert.doesNotMatch(refused.stdout, /Evidence holds/);
	},
);
