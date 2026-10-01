#!/usr/bin/env node
/**
 * The pre-push gate's own contract, driven through REAL repositories and REAL
 * pushes rather than through the functions underneath.
 *
 * WHY THIS TEST EXISTS AT ALL. The gate's whole job is to be un-bypassable by
 * ACCIDENT, and the accident this repository hit before it existed is the one a
 * unit test of `ci-scope`'s flags could never have caught: a worktree carrying
 * no hook, a `core.hooksPath` pointing at nothing, and a push that ran no check
 * while reporting no problem. Git does not tell you a hook was missing - it
 * skips it - so the property under test is not "the gate returns 1", it is "a
 * push from a worktree that cannot be gated FAILS and says why".
 *
 * WHAT IT CANNOT SEE, SAID OUT LOUD RATHER THAN IMPLIED. Every fixture here is a
 * scratch clone with its own bare `origin`, its own git config and its own
 * `HOME`, because the operator's own config must not decide what these
 * repositories look like - a global `hooksPath`, signing key or
 * `init.defaultBranch` would change the shape under test. The fixtures carry no
 * `node_modules`, so no test here runs biome or `tsc`: the legs' own contracts
 * belong to `check-scripts-lint.test.mjs` and to CI, and what is asserted here
 * is the WIRING plus the refusal paths that a missing tree produces. The real
 * change's wall time and peak RSS are measured in `AGENTS.md`, not here.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
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
 * The operator's git config, signing keys and hooks must not shape these
 * fixtures: everything a scratch repository needs is set here, and the two
 * config files a person owns are pointed at /dev/null. `GIT_TERMINAL_PROMPT=0`
 * is the same discipline as the fleet's rig rules - a scratch `HOME` with no
 * keychain must never be the reason a credential prompt appears on screen.
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
 * A scratch clone whose `origin` is a local bare repository, with one commit on
 * `main` and a worktree branched from it that carries NO `.githooks/` - the
 * shape a branch cut before the hook existed has. Returns the paths and two
 * helpers: `install()` runs the real installer against the clone, and
 * `push(target, env)` runs a real `git push` from the worktree.
 */
function fixture({ withHook = true } = {}) {
	const root = mkdtempSync(join(tmpdir(), "pre-push-gate-"));
	const home = join(root, "home");
	const remote = join(root, "remote.git");
	const clone = join(root, "clone");
	const worktree = join(root, "worktree");
	// Every git call in this fixture runs under the fixture's own HOME with the
	// two real config files pointed at /dev/null (see GIT_ENV): a scratch HOME
	// that reached the keychain would put a prompt on the operator's screen.
	const env = { HOME: home };
	mkdirSync(home);
	run("git", ["init", "-q", "--bare", remote], { cwd: root, env });
	run("git", ["init", "-q", "-b", "main", clone], { cwd: root, env });
	git(clone, ["remote", "add", "origin", remote], { env });
	writeFileSync(join(clone, "README.md"), "# fixture\n");
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
	return {
		root,
		home,
		remote,
		clone,
		worktree,
		env,
		install: (args = []) =>
			run(process.execPath, [INSTALLER, ...args], { cwd: clone, env }),
		push: (extra = {}) =>
			run("git", ["push", "origin", "HEAD:refs/heads/feature"], {
				cwd: worktree,
				env: { ...env, ...extra },
			}),
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
}

test("a worktree whose branch carries no hook is REFUSED, not skipped", () => {
	const f = fixture({ withHook: false });
	try {
		f.install();
		const pushed = f.push();
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

test("the gate a push runs is the one the pushed worktree carries", () => {
	const f = fixture();
	try {
		f.install();
		const hook = join(f.worktree, ".githooks", "pre-push");
		mkdirSync(dirname(hook), { recursive: true });
		writeFileSync(hook, "#!/bin/sh\necho 'fixture gate ran'\nexit 0\n");
		chmodSync(hook, 0o755);
		git(f.worktree, ["add", ".githooks/pre-push"]);
		git(f.worktree, ["commit", "-q", "-m", "chore: carry the gate"]);
		const passed = f.push();
		assert.equal(passed.status, 0, passed.stderr);
		assert.match(passed.stdout, /fixture gate ran/);

		// And a gate that fails aborts the push: the hook's exit status is what git
		// reads, so a wrapper that swallowed it would be the silent bypass again.
		writeFileSync(hook, "#!/bin/sh\necho 'fixture gate failed'\nexit 3\n");
		git(f.worktree, ["commit", "-qam", "chore: make the gate fail"]);
		const failed = f.push();
		assert.notEqual(failed.status, 0);
		assert.match(failed.stdout, /fixture gate failed/);
	} finally {
		f.cleanup();
	}
});

test("a bypass is disclosed, and only a named one is accepted", () => {
	const f = fixture({ withHook: false });
	try {
		f.install();
		const disclosed = f.push({
			PREPUSH_BYPASS: "no node_modules in this worktree",
		});
		assert.equal(disclosed.status, 0, disclosed.stderr);
		assert.match(disclosed.stderr, /BYPASSED by PREPUSH_BYPASS/);
		assert.match(disclosed.stderr, /no node_modules in this worktree/);
	} finally {
		f.cleanup();
	}
});

test("wiring is idempotent, absolute, shared and checkable", () => {
	const f = fixture();
	try {
		const first = f.install();
		assert.equal(first.status, 0, first.stderr);
		assert.match(first.stdout, /set core\.hooksPath/);
		const dispatcher = join(f.clone, ".git", "lop-hooks", "pre-push");
		const before = readFileSync(dispatcher);
		assert.equal(
			statSync(dispatcher).mode & 0o777,
			0o755,
			"an unwritable hook is a silent skip",
		);

		// The clone is wired even though the worktree is the checkout that pushes,
		// and the path is absolute: a relative core.hooksPath is resolved against
		// the working directory, which is the silent skip this design removes.
		const hooksPath = git(f.worktree, [
			"config",
			"--get",
			"core.hooksPath",
		]).stdout.trim();
		assert.ok(
			hooksPath.startsWith("/"),
			`core.hooksPath must be absolute: ${hooksPath}`,
		);
		// `realpath`: macOS `/var` is a symlink to `/private/var`, and the value
		// git writes is the physical one.
		assert.equal(
			realpathSync(hooksPath),
			realpathSync(join(f.clone, ".git", "lop-hooks")),
		);

		const second = f.install();
		assert.equal(second.status, 0);
		assert.match(second.stdout, /already current/);
		assert.deepEqual(
			readFileSync(dispatcher),
			before,
			"a second install rewrites nothing",
		);

		assert.equal(f.install(["--check"]).status, 0);
	} finally {
		f.cleanup();
	}
});

test("--check fails loudly when pushes from a checkout are not gated", () => {
	const f = fixture({ withHook: false });
	try {
		const unchecked = f.install(["--check"]);
		assert.equal(
			unchecked.status,
			1,
			"an unwired clone must not report success",
		);
		assert.match(unchecked.stderr, /are not gated/);
		assert.match(unchecked.stderr, /pnpm hooks:install/);

		// A worktree that carries no gate is the second half of the same answer:
		// the dispatcher would refuse its pushes, so `--check` says so here too.
		f.install();
		const withWiring = f.install(["--check"]);
		assert.equal(withWiring.status, 1);
		assert.match(withWiring.stderr, /carries no \.githooks\/pre-push/);
	} finally {
		f.cleanup();
	}
});

test("the gate refuses a base it cannot resolve, rather than passing", () => {
	const f = fixture();
	try {
		const refused = run(
			process.execPath,
			[GATE, "--since", "origin/nonexistent"],
			{
				cwd: f.clone,
			},
		);
		assert.equal(refused.status, 1);
		assert.match(refused.stderr, /REFUSED/);
		assert.match(refused.stderr, /does not resolve/);

		const empty = run(process.execPath, [GATE, "--since="], { cwd: f.clone });
		assert.equal(
			empty.status,
			1,
			"an empty base is a comparison nobody asked for",
		);
	} finally {
		f.cleanup();
	}
});

test("a diff the classifier calls inert runs no leg at all", () => {
	const f = fixture();
	try {
		writeFileSync(join(f.clone, "NOTES.md"), "prose\n");
		git(f.clone, ["add", "NOTES.md"]);
		git(f.clone, ["commit", "-q", "-m", "docs: prose only"]);
		const gate = run(process.execPath, [GATE, "--since", "origin/main"], {
			cwd: f.clone,
		});
		assert.equal(gate.status, 0, gate.stderr);
		assert.match(gate.stdout, /selects no local leg/);
		// No node_modules exists in this fixture: passing here also proves no leg
		// was run, since every leg would have refused for want of a tool.
		assert.doesNotMatch(gate.stdout, /REFUSED/);
	} finally {
		f.cleanup();
	}
});

test("a leg whose tool is missing refuses instead of passing", () => {
	const f = fixture();
	try {
		mkdirSync(join(f.clone, "scripts"), { recursive: true });
		cpSync(GATE, join(f.clone, "scripts", "pre-push-gate.mjs"));
		cpSync(
			join(REPO, "scripts", "ci-scope.mjs"),
			join(f.clone, "scripts", "ci-scope.mjs"),
		);
		cpSync(
			join(REPO, "scripts", "entry-point.mjs"),
			join(f.clone, "scripts", "entry-point.mjs"),
		);
		cpSync(
			join(REPO, "scripts", "check-scripts-lint.mjs"),
			join(f.clone, "scripts", "check-scripts-lint.mjs"),
		);
		cpSync(
			join(REPO, "scripts", "version-bump-guard.mjs"),
			join(f.clone, "scripts", "version-bump-guard.mjs"),
		);
		writeFileSync(
			join(f.clone, "scripts", "thing.mjs"),
			"export const one = 1;\n",
		);
		git(f.clone, ["add", "scripts"]);
		git(f.clone, [
			"commit",
			"-q",
			"-m",
			"feat: a scripts change with no node_modules",
		]);
		const gate = run(process.execPath, [GATE, "--since", "origin/main"], {
			cwd: f.clone,
		});
		assert.equal(
			gate.status,
			1,
			"a lint leg that cannot run must not read as a pass",
		);
		assert.match(`${gate.stdout}${gate.stderr}`, /not installed|node_modules/);
	} finally {
		f.cleanup();
	}
});
