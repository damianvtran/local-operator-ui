#!/usr/bin/env node
/**
 * The pre-push gate's own contract, driven through REAL repositories, REAL pushes
 * and the REAL hook - never a stub standing in for the thing under test.
 *
 * WHY THIS FILE IS SHAPED THIS WAY. An earlier revision of it substituted a stub
 * `.githooks/pre-push` in the fixture and asserted that git honoured its exit
 * status. That test passed while the gate it was standing in for refused EVERY
 * push - the launcher forwarded git's own positional arguments (the remote's name
 * and URL) into a parser that threw on them - because the ONE path that mattered,
 * a real push through the generated dispatcher into the real hook, was never
 * executed. So the fixtures here install the real `.githooks/pre-push`, the real
 * gate, the real classifier and the real ratchet, from this checkout's own blobs,
 * and push for real; only `node_modules` is shared rather than installed (a
 * symlink to this checkout's tree), which is what this fleet's worktrees do
 * anyway.
 *
 * WHAT IT CANNOT SEE. The fixtures carry a symlinked `node_modules`, so the lint
 * legs run the real `biome` over the fixture files - but the desktop suite, the
 * build, the audit and the typecheck against the real tree are out of reach here
 * (and out of scope: this gate does not run them). The *types* leg is therefore
 * not exercised end-to-end by this file; its selection is covered by the
 * classifier's own tests and by CI. Every fixture is a scratch clone with its own
 * bare `origin`, its own git config and its own `HOME`, because the operator's
 * config must not decide what these repositories look like - a global hooksPath,
 * a signing key or `init.defaultBranch` would change the shape under test.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const INSTALLER = join(REPO, "scripts", "hooks-install.mjs");
const GATE = join(REPO, "scripts", "pre-push-gate.mjs");
const HOOK = join(REPO, ".githooks", "pre-push");

/**
 * The files a fixture needs to BE this gate: the tracked hook, the gate itself,
 * its classifier and the ratchet it delegates to, plus the repository's
 * `biome.json` so the formatter contract is the repository's and not biome's
 * defaults. Copied rather than re-implemented - a fixture that invented its own
 * gate could never have caught the defect this file now exists for.
 */
const GATE_FILES = [
	["scripts/pre-push-gate.mjs"],
	["scripts/hooks-install.mjs"],
	["scripts/entry-point.mjs"],
	["scripts/ci-scope.mjs"],
	["scripts/version-bump-guard.mjs"],
	["scripts/check-scripts-lint.mjs"],
	["biome.json"],
];

/**
 * A file the ratchet is known to leave alone, used as the CLEAN change: it is
 * already under the repository's formatter contract (it is in the tree that
 * `pnpm lint:scripts` ratchets), so copying it into a fixture cannot make the
 * fixture's own cleanliness a second variable.
 */
const CLEAN_SCRIPTS_FILE = "scripts/entry-point.mjs";

/**
 * The operator's git config, signing keys and hooks must not shape these
 * fixtures: everything a scratch repository needs is set here, and the two config
 * files a person owns are pointed at /dev/null. `GIT_TERMINAL_PROMPT=0` is the
 * same discipline as the fleet's rig rules - a scratch `HOME` with no keychain
 * must never be the reason a credential prompt appears on screen.
 */
const GIT_ENV = {
	...process.env,
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_CONFIG_SYSTEM: "/dev/null",
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_TERMINAL_PROMPT: "0",
	GIT_AUTHOR_NAME: "Pre-push Gate Test",
	GIT_AUTHOR_EMAIL: "gate@example.invalid",
	GIT_COMMITTER_NAME: "Pre-push Gate Test",
	GIT_COMMITTER_EMAIL: "gate@example.invalid",
	GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
	GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
};

function run(command, args, { cwd, env = {} } = {}) {
	const result = spawnSync(command, args, {
		cwd,
		encoding: "utf8",
		env: { ...GIT_ENV, ...env },
	});
	return {
		status: result.status,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	};
}

function git(cwd, args, options = {}) {
	const result = run("git", args, { cwd, ...options });
	if (!options.allow && result.status !== 0) {
		throw new Error(
			`git ${args.join(" ")} failed in ${cwd}: ${result.stderr || result.stdout}`,
		);
	}
	return result;
}

/**
 * A scratch clone whose `origin` is a local bare repository, carrying this
 * checkout's real gate files, one commit on `main`, and a worktree branched from
 * it. `withHook: false` is the shape a branch cut before the gate existed has; a
 * fixture THAT has the hook is the one a real push must survive.
 */
function fixture({ withHook = true, withTools = true } = {}) {
	const root = mkdtempSync(join(tmpdir(), "pre-push-gate-"));
	const home = join(root, "home");
	const remote = join(root, "remote.git");
	const clone = join(root, "clone");
	const worktree = join(root, "worktree");
	// Every git call in this fixture runs under the fixture's own HOME with the
	// two real config files pointed at /dev/null (see GIT_ENV).
	const env = { HOME: home };
	mkdirSync(home);
	run("git", ["init", "-q", "--bare", remote], { cwd: root, env });
	run("git", ["init", "-q", "-b", "main", clone], { cwd: root, env });
	git(clone, ["remote", "add", "origin", remote], { env });
	writeFileSync(join(clone, ".gitignore"), "node_modules\n");
	writeFileSync(join(clone, "README.md"), "# fixture\n");
	for (const [path] of GATE_FILES) {
		const target = join(clone, path);
		mkdirSync(dirname(target), { recursive: true });
		cpSync(join(REPO, path), target);
	}
	mkdirSync(join(clone, "scripts"), { recursive: true });
	cpSync(join(REPO, CLEAN_SCRIPTS_FILE), join(clone, CLEAN_SCRIPTS_FILE));
	if (withHook) {
		mkdirSync(join(clone, ".githooks"), { recursive: true });
		cpSync(HOOK, join(clone, ".githooks", "pre-push"));
		chmodSync(join(clone, ".githooks", "pre-push"), 0o755);
	}
	git(clone, ["add", "."], { env });
	git(clone, ["commit", "-q", "-m", "chore: fixture"], { env });
	git(clone, ["push", "-q", "-u", "origin", "main"], { env });
	// The worktree is cut from the commit the clone just made, so a fixture WITH a
	// hook carries the gate onto `feature`, and one WITHOUT is the shape this gate
	// exists for: a branch that predates it.
	git(clone, ["worktree", "add", "-q", "-b", "feature", worktree], { env });
	if (withTools) {
		// The tools are SHARED, not installed: the fleet's worktrees link the
		// primary checkout's `node_modules`, and this is the same thing. It is what
		// makes the lint leg run the real biome instead of a stub.
		symlinkSync(join(REPO, "node_modules"), join(worktree, "node_modules"));
		symlinkSync(join(REPO, "node_modules"), join(clone, "node_modules"));
	}
	return {
		root,
		home,
		remote,
		clone,
		worktree,
		env,
		install: (args = []) =>
			run(process.execPath, [INSTALLER, ...args], { cwd: clone, env }),
		/** A real `git push` FROM the worktree, through the real dispatcher. */
		push: (args, extra = {}) =>
			run("git", ["push", ...args], {
				cwd: worktree,
				env: { ...env, ...extra },
			}),
		gate: (args, extra = {}) =>
			run(process.execPath, [GATE, ...args], {
				cwd: worktree,
				env: { ...env, ...extra },
			}),
		commit: (message, write) => {
			write();
			git(worktree, ["add", "-A"], { env });
			git(worktree, ["commit", "-q", "-m", message], { env });
		},
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
}

/**
 * A formatting error biome really reports: `{a:1}` is not what this repository's
 * formatter prints. Deliberately a FORMATTER violation rather than a lint-rule
 * one, because the formatter is the part of `biome check` that `pnpm lint` never
 * reached over `scripts/` - the hole the ratchet exists to close.
 */
const VIOLATION = "export const thing = {a:1}\n";

test("an inert push succeeds through the real dispatcher and the real hook", () => {
	// THE REGRESSION THIS FILE WAS MISSING. The launcher used to forward git's own
	// positional arguments (`origin`, the URL) into the gate, whose parser threw on
	// them, so EVERY push was refused with `unknown argument 'origin'` - including
	// this one, which the classifier correctly calls inert.
	const f = fixture();
	try {
		assert.equal(f.install().status, 0);
		f.commit("docs: prose only", () =>
			writeFileSync(join(f.worktree, "NOTES.md"), "prose\n"),
		);
		const pushed = f.push(["origin", "HEAD:refs/heads/feature"]);
		assert.equal(pushed.status, 0, `${pushed.stdout}${pushed.stderr}`);
		assert.doesNotMatch(
			`${pushed.stdout}${pushed.stderr}`,
			/unknown argument/,
			"git's own arguments must not reach the gate's parser",
		);
		assert.match(pushed.stdout, /selects no local leg/);
	} finally {
		f.cleanup();
	}
});

test("the gate ignores git's two positional arguments", () => {
	const f = fixture();
	try {
		const direct = f.gate([
			"--since",
			"origin/main",
			"origin",
			"ssh://git@example.invalid/repo.git",
		]);
		assert.doesNotMatch(`${direct.stdout}${direct.stderr}`, /unknown argument/);
		assert.equal(direct.status, 0, `${direct.stdout}${direct.stderr}`);

		// More than the two the contract names is refused rather than dropped: an
		// argument this gate does not understand must not be silently ignored.
		const tooMany = f.gate([
			"--since",
			"origin/main",
			"origin",
			"url",
			"extra",
		]);
		assert.notEqual(tooMany.status, 0);
		assert.match(tooMany.stderr, /positional arguments/);
	} finally {
		f.cleanup();
	}
});

test("a violating change FAILS the push through the real hook", () => {
	const f = fixture();
	try {
		assert.equal(f.install().status, 0);
		f.commit("feat: a file the formatter would rewrite", () =>
			writeFileSync(join(f.worktree, "scripts", "violation.mjs"), VIOLATION),
		);
		const pushed = f.push(["origin", "HEAD:refs/heads/feature"]);
		assert.notEqual(pushed.status, 0, "a real violation must abort the push");
		const output = `${pushed.stdout}${pushed.stderr}`;
		assert.match(output, /lint \(scripts\/\) FAILED/);
		assert.match(output, /not lint-clean|violation\.mjs/);
		// And it says what not to do about it.
		assert.match(output, /--no-verify/);
	} finally {
		f.cleanup();
	}
});

test("a clean change passes through the real hook", () => {
	const f = fixture();
	try {
		assert.equal(f.install().status, 0);
		f.commit("feat: a scripts file that is already clean here", () =>
			writeFileSync(
				join(f.worktree, "scripts", "clean.mjs"),
				"export const thing = { a: 1 };\n",
			),
		);
		const pushed = f.push(["origin", "HEAD:refs/heads/feature"]);
		assert.equal(pushed.status, 0, `${pushed.stdout}${pushed.stderr}`);
		assert.match(pushed.stdout, /lint \(scripts\/\) passed/);
	} finally {
		f.cleanup();
	}
});

test("the subject is the pushed ref, not HEAD", () => {
	const f = fixture();
	try {
		assert.equal(f.install().status, 0);
		// HEAD carries a real violation...
		f.commit("feat: a violation on the checked-out branch", () =>
			writeFileSync(join(f.worktree, "scripts", "violation.mjs"), VIOLATION),
		);
		// ...and what is pushed is `main`, which does not carry it. Gating HEAD
		// here would refuse a push that carries nothing of the sort.
		const pushed = f.push(["origin", "main:refs/heads/main-copy"]);
		assert.equal(pushed.status, 0, `${pushed.stdout}${pushed.stderr}`);
		assert.match(pushed.stdout, /push subject refs\/heads\/main /);
		assert.match(pushed.stdout, /no changed path/);
	} finally {
		f.cleanup();
	}
});

test("a pushed ref this checkout cannot read is REFUSED, not a false green", () => {
	const f = fixture();
	try {
		assert.equal(f.install().status, 0);
		// `other` carries a violation and is NOT part of HEAD's history, so this
		// checkout cannot read the bytes being pushed. Reporting "no changed path"
		// for it would be exactly the false green this gate exists to prevent.
		git(f.worktree, ["checkout", "-q", "-b", "other"], { env: f.env });
		f.commit("feat: a violation on another branch", () =>
			writeFileSync(join(f.worktree, "scripts", "violation.mjs"), VIOLATION),
		);
		git(f.worktree, ["checkout", "-q", "feature"], { env: f.env });
		const pushed = f.push(["origin", "other:refs/heads/other"]);
		assert.notEqual(pushed.status, 0);
		const output = `${pushed.stdout}${pushed.stderr}`;
		assert.match(output, /REFUSED/);
		assert.match(output, /does not carry/);
	} finally {
		f.cleanup();
	}
});

test("a deletion carries nothing for the legs to read", () => {
	const f = fixture();
	try {
		assert.equal(f.install().status, 0);
		git(f.worktree, ["push", "-q", "origin", "HEAD:refs/heads/doomed"], {
			env: f.env,
		});
		const pushed = f.push(["origin", ":refs/heads/doomed"]);
		assert.equal(pushed.status, 0, `${pushed.stdout}${pushed.stderr}`);
		assert.match(pushed.stdout, /deletion/);
	} finally {
		f.cleanup();
	}
});

test("a worktree whose branch carries no hook is REFUSED, not skipped", () => {
	const f = fixture({ withHook: false, withTools: false });
	try {
		f.install();
		const pushed = f.push(["origin", "HEAD:refs/heads/feature"]);
		assert.notEqual(pushed.status, 0, "the push must fail, not run ungated");
		assert.match(pushed.stderr, /carries no \.githooks\/pre-push/);
		// The refusal names both ways forward and the one thing not to do, because
		// a refusal that does not say what to do next is what teaches --no-verify.
		assert.match(pushed.stderr, /origin\/main/);
		assert.match(pushed.stderr, /--no-verify/);
	} finally {
		f.cleanup();
	}
});

test("a bypass is disclosed, and an empty one is refused", () => {
	const f = fixture({ withHook: false, withTools: false });
	try {
		f.install();
		const disclosed = f.push(["origin", "HEAD:refs/heads/feature"], {
			PREPUSH_BYPASS: "no node_modules in this worktree",
		});
		assert.equal(disclosed.status, 0, disclosed.stderr);
		assert.match(disclosed.stderr, /BYPASSED by PREPUSH_BYPASS/);
		assert.match(disclosed.stderr, /no node_modules in this worktree/);

		const empty = f.push(["origin", "HEAD:refs/heads/feature"], {
			PREPUSH_BYPASS: "   ",
		});
		assert.notEqual(empty.status, 0, "an undisclosed bypass is not a bypass");
	} finally {
		f.cleanup();
	}
});

test("wiring is idempotent, absolute, local and checkable", () => {
	const f = fixture();
	try {
		const first = f.install();
		assert.equal(first.status, 0, first.stderr);
		assert.match(first.stdout, /set the local core\.hooksPath/);

		const dispatcher = join(f.clone, ".git", "lop-hooks", "pre-push");
		const before = readFileSync(dispatcher);
		assert.equal(
			statSync(dispatcher).mode & 0o777,
			0o755,
			"an unwritable hook is a silent skip",
		);

		// The clone is wired even though the worktree is the checkout that pushes,
		// the value is LOCAL to this repository, and it is absolute: a relative
		// core.hooksPath is resolved against the working directory, which is the
		// silent skip this design removes.
		const local = git(
			f.worktree,
			["config", "--local", "--get", "core.hooksPath"],
			{
				env: f.env,
			},
		).stdout.trim();
		assert.ok(
			local.startsWith("/"),
			`core.hooksPath must be absolute: ${local}`,
		);
		assert.equal(
			realpathSync(local),
			realpathSync(join(f.clone, ".git", "lop-hooks")),
		);

		const second = f.install();
		assert.equal(second.status, 0);
		assert.match(second.stdout, /already points at/);
		assert.deepEqual(
			readFileSync(dispatcher),
			before,
			"a second install rewrites nothing",
		);

		assert.equal(
			f.install(["--check"]).status,
			0,
			f.install(["--check"]).stderr,
		);
	} finally {
		f.cleanup();
	}
});

test("--check fails loudly when pushes from a checkout are not gated", () => {
	const f = fixture({ withHook: false, withTools: false });
	try {
		const unchecked = f.install(["--check"]);
		assert.equal(
			unchecked.status,
			1,
			"an unwired clone must not report success",
		);
		assert.match(unchecked.stderr, /are not gated/);
		assert.match(unchecked.stderr, /pnpm hooks:install/);

		f.install();
		const withWiring = f.install(["--check"]);
		assert.equal(withWiring.status, 1);
		assert.match(withWiring.stderr, /carries no \.githooks\/pre-push/);
	} finally {
		f.cleanup();
	}
});

test("a wiring that cannot be verified never fails an install", () => {
	const f = fixture();
	try {
		// A `.git/lop-hooks` that exists as a FILE cannot host the dispatcher: the
		// wiring is impossible, which is the state `pnpm install` must survive.
		mkdirSync(join(f.clone, ".git"), { recursive: true });
		writeFileSync(join(f.clone, ".git", "lop-hooks"), "not a directory\n");

		const lenient = f.install(["--tolerate-failure"]);
		assert.equal(lenient.status, 0, "a hook helper must not break an install");
		assert.match(lenient.stderr, /WARNING - this clone's pushes are NOT gated/);
		assert.match(lenient.stderr, /pnpm hooks:check/);

		// The by-hand spelling still fails, so the failure cannot hide.
		assert.equal(f.install().status, 1);
	} finally {
		f.cleanup();
	}
});

test("a hooksPath configured elsewhere is superseded, not written over", () => {
	const f = fixture();
	try {
		// A nested checkout with an ambient `GIT_CONFIG_GLOBAL` - a rig, or an
		// agent's redirected HOME - is how a bare `git config` writes into a config
		// that is not this repository's. The installer names the local scope.
		const foreign = join(f.root, "foreign-gitconfig");
		writeFileSync(foreign, "[core]\n\thooksPath = /nowhere/at/all\n");
		const direct = run(process.execPath, [INSTALLER], {
			cwd: f.clone,
			env: { ...f.env, GIT_CONFIG_GLOBAL: foreign },
		});
		assert.equal(direct.status, 0, direct.stderr);
		assert.match(
			direct.stderr,
			/WARNING - a core\.hooksPath is ALSO configured elsewhere/,
		);
		// The foreign file is untouched, and the local value is this repository's:
		// a nested checkout must not be able to poison a config it does not own.
		assert.match(
			readFileSync(foreign, "utf8"),
			/hooksPath = \/nowhere\/at\/all/,
		);
		const local = git(
			f.clone,
			["config", "--local", "--get", "core.hooksPath"],
			{
				env: { ...f.env, GIT_CONFIG_GLOBAL: foreign },
			},
		).stdout.trim();
		assert.equal(
			realpathSync(local),
			realpathSync(join(f.clone, ".git", "lop-hooks")),
		);
	} finally {
		f.cleanup();
	}
});

test("the gate refuses a base it cannot resolve, rather than passing", () => {
	const f = fixture({ withTools: false });
	try {
		const refused = f.gate(["--since", "origin/nonexistent"]);
		assert.equal(refused.status, 1);
		assert.match(refused.stderr, /REFUSED/);
		assert.match(refused.stderr, /does not resolve/);

		const empty = f.gate(["--since="]);
		assert.equal(
			empty.status,
			1,
			"an empty base is a comparison nobody asked for",
		);
	} finally {
		f.cleanup();
	}
});

test("a leg whose tool is missing refuses instead of passing", () => {
	const f = fixture({ withTools: false });
	try {
		f.install();
		f.commit("feat: a scripts change with no tools to read it", () =>
			writeFileSync(
				join(f.worktree, "scripts", "clean.mjs"),
				"export const a = 1;\n",
			),
		);
		const pushed = f.push(["origin", "HEAD:refs/heads/feature"]);
		assert.notEqual(
			pushed.status,
			0,
			"a lint leg that cannot run must not read as a pass",
		);
		assert.match(
			`${pushed.stdout}${pushed.stderr}`,
			/not installed|node_modules/,
		);
	} finally {
		f.cleanup();
	}
});

test("the fixture's clean and violating files really are those things", () => {
	// Guards both lint cases above: if the repository's formatter stopped agreeing
	// with the fixture, "a clean change passes" and "a violation fails" would be
	// asserting properties of the fixture rather than of the gate.
	const f = fixture();
	try {
		const biome = join(f.worktree, "node_modules", ".bin", "biome");
		assert.ok(existsSync(biome), "the fixture's tool tree must be reachable");

		const clean = run(biome, ["check", CLEAN_SCRIPTS_FILE], {
			cwd: f.worktree,
		});
		assert.equal(clean.status, 0, `${clean.stdout}${clean.stderr}`);

		writeFileSync(join(f.worktree, "scripts", "violation.mjs"), VIOLATION);
		const failing = run(biome, ["check", "scripts/violation.mjs"], {
			cwd: f.worktree,
		});
		assert.notEqual(
			failing.status,
			0,
			"the violation must be one biome reports",
		);
	} finally {
		f.cleanup();
	}
});
