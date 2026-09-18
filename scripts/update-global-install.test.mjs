import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { after, test } from "node:test";
import { build } from "esbuild";

/**
 * The update path for a GLOBAL install, contract-checked against the shipped
 * TypeScript.
 *
 * Why these cases exist. The app could update nothing but its own bundled
 * server: for an install that already exists on the machine it named either
 * `lop-update` - the release owner's out-of-tree script, which archives a
 * checkout at a hardcoded path and REFUSES when the local ref is behind or
 * diverged from its remote - or `uv tool upgrade local-operator`, which the
 * harness itself documents as failing for a git-snapshot install or a pinned
 * receipt. Then it ran nothing at all. The requirement is that such an install
 * is updated through the harness's own mechanism, `lop update`, and that the app
 * only STARTS that command on a layout where the install lands beside every
 * running process rather than under it: `generations/<id>` behind a `current`
 * pointer (`docs/design-install-generations.md`). On any other layout the same
 * command rewrites `site-packages` under every live runtime, which is the
 * 2026-09-15 incident - 36 sessions gone with no exit record - that this gate
 * exists to keep the app out of.
 *
 * The filesystem here is synthetic throughout: a temp root, never the operator's
 * `~/.local/share/uv/tools/local-operator` and never `~/.local/share/lop`. The
 * module is bundled in memory from the shipped TypeScript, the same way
 * `update-robustness.test.mjs` does, so these stay tests of the code that ships.
 */
const bundle = await build({
	stdin: {
		contents: 'export * from "./src/main/update-install";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const install = await import(
	`data:text/javascript;base64,${Buffer.from(
		bundle.outputFiles[0].text,
	).toString("base64")}`
);
const {
	classifyGlobalInstall,
	didUpgradeLand,
	generationInstallRoot,
	installerSearchPath,
	isSourceBuildRef,
	readInstallIdentity,
	resolveCommandPath,
	resolveGlobalInstallPlan,
} = install;

const roots = [];

/** A temp root, already resolved: `realpath` comparisons have to agree with it. */
const tempRoot = (name) => {
	const dir = realpathSync(
		mkdtempSync(join(realpathSync(tmpdir()), `lo-global-${name}-`)),
	);
	roots.push(dir);
	return dir;
};

after(() => {
	for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

/**
 * One uv tool environment, in the shape uv writes: a console script in `bin`,
 * the receipt beside it, the dist-info under `site-packages` - and a
 * `.lop-source` when the install has one.
 *
 * The dist-info directory NAME carries the version, which is the whole reason
 * the reader never has to run an interpreter to learn it.
 */
const uvToolEnv = (prefix, { version, sourceRef = null, distInfo = true }) => {
	mkdirSync(join(prefix, "bin"), { recursive: true });
	writeFileSync(
		join(prefix, "bin", "local-operator"),
		`#!${join(prefix, "bin", "python3")}\n`,
		{ mode: 0o755 },
	);
	writeFileSync(join(prefix, "bin", "python3"), "", { mode: 0o755 });
	writeFileSync(
		join(prefix, "uv-receipt.toml"),
		'[tool]\nname = "local-operator"\n',
	);
	if (sourceRef !== null) {
		writeFileSync(join(prefix, ".lop-source"), `${sourceRef}\n`, "utf8");
	}
	if (distInfo) {
		const dir = join(
			prefix,
			"lib",
			"python3.12",
			"site-packages",
			`local_operator-${version}.dist-info`,
		);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "INSTALLER"), "uv\n", "utf8");
		writeFileSync(
			join(dir, "METADATA"),
			`Metadata-Version: 2.1\nName: local-operator\nVersion: ${version}\n`,
			"utf8",
		);
	}
	return prefix;
};

/** A legacy uv tool install: the tree uv itself makes, with no pointer above it. */
const legacyInstall = (root, { version = "0.55.10", sourceRef = null } = {}) =>
	uvToolEnv(join(root, "uv", "tools", "local-operator"), {
		version,
		sourceRef,
	});

// ---------------------------------------------------------------------------
// The layout decides who runs the command
// ---------------------------------------------------------------------------

test("a legacy uv-tool install with no `lop-update` on the machine names `lop update` and does not let the app run it", () => {
	const root = tempRoot("legacy");
	const prefix = legacyInstall(root, {
		version: "0.55.10",
		// What `lop-update` writes for a git snapshot: a commit, then a label.
		sourceRef: "67586aa1f47eea6be7dad0cdde3e2462f96f465d main",
	});
	const identity = readInstallIdentity(join(prefix, "bin", "local-operator"));

	assert.equal(classifyGlobalInstall(identity), "uv-tool");
	// The install's OWN version and provenance, both read without a subprocess.
	assert.equal(identity.version, "0.55.10");
	assert.equal(identity.sourceRef, "67586aa1f47eea6be7dad0cdde3e2462f96f465d");
	// No `generations/` above it, so no atomic handover and no licence to install
	// under a fleet: the app names the command and stops there.
	assert.equal(generationInstallRoot(identity), null);

	const plan = resolveGlobalInstallPlan({ identity });
	assert.equal(plan.canManageUpdate, false);
	assert.equal(plan.updateCommand, "lop update");
	assert.equal(plan.sourceBuild, true);
	// No rebuild tool was passed, which is the state of most machines: the app has
	// no route it may run, and says so rather than guessing at one.
	assert.equal(plan.managedRoute, null);
	/*
	 * WHY THE COMMAND IS REFUSED lives in the remedy, which is the sentence above
	 * the command well, and no longer in the mono Details line (reviews U8, N1):
	 * "this install's updater rewrites the shared environment in place" is the fact
	 * the reader is deciding on, and it was trailing a resolved path in the
	 * copy-for-support blob. Details keeps the classification evidence and the
	 * provenance, and carries neither the layout reason nor a trailing colon the
	 * well below already implies (review D5).
	 */
	assert.match(plan.remedy, /predates the non-disruptive installer/);
	assert.match(plan.remedy, /rewrites the shared environment in place/);
	assert.doesNotMatch(plan.remedy, /:$/);
	assert.match(plan.detail, /classified as uv-tool\./);
	assert.match(plan.detail, /install the published release over it/);
	assert.doesNotMatch(plan.detail, /rewrites the shared environment in place/);
});

test("a uv-tool SOURCE BUILD is managed by `lop-update` when the machine has it, and the release install is not", () => {
	/*
	 * THE CASE THE REPORT IS ABOUT. A uv-tool build of this machine's own checkout
	 * reports the CHECKOUT's version and carries a git sha in `.lop-source`; the
	 * entry point would install the published wheel over it (the harness's own
	 * notice says so), and `lop-update` is the tool that maintains exactly this
	 * install. Refusing and handing the user the command was the whole complaint, so
	 * when `lop-update` resolves the app runs it - and only then: absent, the plan is
	 * the refusal it always was.
	 *
	 * The release install beside it is the OTHER half, and it is here on purpose: a
	 * uv-tool install from PyPI has no `.lop-source` ref to move, so `lop-update` is
	 * not its tool and the entry point stays the only route.
	 */
	const root = tempRoot("source-rebuild");
	const sourcePrefix = legacyInstall(root, {
		version: "0.56.5",
		sourceRef: "d0601cfadaf6024503298ce452e18054a46dfac7 main",
	});
	const sourceIdentity = readInstallIdentity(
		join(sourcePrefix, "bin", "local-operator"),
	);
	assert.equal(classifyGlobalInstall(sourceIdentity), "uv-tool");
	assert.equal(generationInstallRoot(sourceIdentity), null);

	const rebuild = "/Users/someone/.local/bin/lop-update";
	const managed = resolveGlobalInstallPlan({
		identity: sourceIdentity,
		sourceRebuild: rebuild,
	});
	assert.equal(managed.canManageUpdate, true);
	assert.equal(managed.managedRoute, "source-build");
	assert.equal(managed.updateCommand, "lop-update");
	assert.equal(managed.sourceBuild, true);
	// The install tree the route rewrites, which is where its evidence lives.
	assert.equal(managed.installPrefix, sourcePrefix);
	/*
	 * The copy states what the app does, the risk the operator accepted on
	 * everyone's behalf, and the one thing it cannot promise: the version this
	 * install reports afterwards is the checkout's. The in-place clause is pinned
	 * here because it is the consent the decision recorded - the app ships to people
	 * who did not make it, so nobody may meet the consequence by surprise.
	 */
	assert.match(managed.remedy, /rebuilds this source checkout/);
	assert.match(managed.remedy, /reinstalls the install in place/);
	assert.match(
		managed.remedy,
		/sessions running on this machine can be interrupted/,
	);
	assert.match(managed.remedy, /is the checkout's/);
	/*
	 * THE RIBBON CARRIES MACHINE FACTS, not the app's explanation of them: the app's
	 * own sentence lives in `remedy`, which the panel renders as prose, while this
	 * details line was app prose wrapping to five ragged lines inside the mono block
	 * (review round 3, D5). The assertion follows the string rather than the wording.
	 */
	assert.match(
		managed.detail,
		/the app rebuilds it with the checkout's own script/,
	);

	// No tool on the machine: today's refusal, unchanged, and no route.
	const refused = resolveGlobalInstallPlan({ identity: sourceIdentity });
	assert.equal(refused.canManageUpdate, false);
	assert.equal(refused.managedRoute, null);
	assert.equal(refused.updateCommand, "lop update");

	// A uv-tool install from PyPI is not a source build: the ref is absent, so the
	// rebuild tool is not its tool and main's behaviour stands untouched.
	const releasePrefix = legacyInstall(tempRoot("release"), {
		version: "0.56.5",
	});
	const releaseIdentity = readInstallIdentity(
		join(releasePrefix, "bin", "local-operator"),
	);
	const releasePlan = resolveGlobalInstallPlan({
		identity: releaseIdentity,
		sourceRebuild: rebuild,
	});
	assert.equal(releasePlan.canManageUpdate, false);
	assert.equal(releasePlan.managedRoute, null);
	assert.equal(releasePlan.sourceBuild, false);

	// And a generation install keeps the entry point even when `lop-update` exists:
	// the rebuild is for a source build, not a second way to do the same update.
	const generationPrefix = uvToolEnv(join(root, "lop", "generations", "g1"), {
		version: "0.56.5",
		sourceRef: "d0601cfadaf6024503298ce452e18054a46dfac7 main",
	});
	const generationIdentity = readInstallIdentity(
		join(generationPrefix, "bin", "local-operator"),
	);
	if (generationInstallRoot(generationIdentity) !== null) {
		const generationPlan = resolveGlobalInstallPlan({
			identity: generationIdentity,
			sourceRebuild: rebuild,
		});
		assert.equal(generationPlan.managedRoute, "entry-point");
		assert.equal(generationPlan.updateCommand, "lop update");
	}
});

test("a generation install is managed, and the layout is the licence - not the version", () => {
	const root = tempRoot("generation");
	const stable = join(root, "lop");
	const id = "20260916T120000";
	const generation = join(stable, "generations", id);
	uvToolEnv(generation, { version: "0.56.0", sourceRef: "pypi 0.56.0" });
	symlinkSync(generation, join(stable, "current"));

	const identity = readInstallIdentity(
		join(generation, "bin", "local-operator"),
	);
	assert.equal(identity.version, "0.56.0");
	assert.equal(classifyGlobalInstall(identity), "uv-tool");
	assert.equal(generationInstallRoot(identity), generation);

	const plan = resolveGlobalInstallPlan({ identity });
	assert.equal(plan.canManageUpdate, true);
	assert.equal(plan.updateCommand, "lop update");
	// A wheel, not a checkout: the provenance is the install's own marker.
	assert.equal(plan.sourceBuild, false);
	/*
	 * THE MANAGED ARM STATES WHAT THE CLICK COSTS (review U3), and it reaches a
	 * surface: the offer renders this sentence above its buttons, which is why the
	 * string is asserted here rather than the old "update it from your terminal"
	 * line that told the user to leave the app on the one path where the app runs
	 * the command itself - and which no renderer branch rendered at all
	 * (reviews D7, U7).
	 */
	assert.match(plan.remedy, /restarts the server it started/);
	assert.match(plan.remedy, /minute or two/);
	assert.doesNotMatch(plan.remedy, /your terminal/);
	assert.doesNotMatch(plan.remedy, /:$/);
	assert.doesNotMatch(plan.detail, /rewrites the shared environment in place/);
	assert.doesNotMatch(plan.detail, /installs the published release over it/);

	/*
	 * And the same install as the harness actually lays it out
	 * (`docs/design-install-generations.md` section 2): the venv under
	 * `tools/local-operator`, the generation's own console script a relative
	 * symlink into that venv, `current` pointing at the generation, and the
	 * user-facing launcher in `~/.local/bin` pointing THROUGH `current`.
	 *
	 * Every step of that chain is load-bearing for the classification: the
	 * resolved prefix has to come out as the venv, because that is the only place
	 * the dist-info and `.lop-source` live, and it is the resolved prefix that
	 * `readInstallIdentity` computes from `dirname(dirname(...))`.
	 */
	const root2 = tempRoot("generation-layout");
	const stable2 = join(root2, "lop");
	const generation2 = join(stable2, "generations", "20260916T130000");
	const venv = uvToolEnv(join(generation2, "tools", "local-operator"), {
		version: "0.56.0",
		sourceRef: "pypi 0.56.0",
	});
	mkdirSync(join(generation2, "bin"), { recursive: true });
	symlinkSync(
		join("..", "tools", "local-operator", "bin", "local-operator"),
		join(generation2, "bin", "local-operator"),
	);
	symlinkSync(generation2, join(stable2, "current"));
	const launcherDir = join(root2, ".local", "bin");
	mkdirSync(launcherDir, { recursive: true });
	const launcher = join(launcherDir, "local-operator");
	symlinkSync(join(stable2, "current", "bin", "local-operator"), launcher);

	const resolved = readInstallIdentity(launcher);
	assert.equal(resolved.realPath, join(venv, "bin", "local-operator"));
	assert.equal(resolved.version, "0.56.0");
	assert.equal(classifyGlobalInstall(resolved), "uv-tool");
	assert.equal(generationInstallRoot(resolved), generation2);
	assert.equal(
		resolveGlobalInstallPlan({ identity: resolved }).canManageUpdate,
		true,
	);
});

test("a `lop-update` script on this machine does not become the install's remedy", () => {
	/*
	 * The regression for the requirement's second half. The source-build signal
	 * used to be "a `lop-update` script exists on this machine", which conflated
	 * the machine with the install: this case puts one on PATH, proves the lookup
	 * really finds it, and asserts the plan is unmoved by it in BOTH layouts.
	 */
	const root = tempRoot("machine");
	const pathDir = join(root, "bin");
	mkdirSync(pathDir, { recursive: true });
	const script = join(pathDir, "lop-update");
	writeFileSync(script, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
	const env = {
		PATH: [pathDir, "/usr/bin", "/bin"].join(delimiter),
		HOME: root,
	};
	assert.equal(resolveCommandPath("lop-update", { env, home: root }), script);

	const stable = join(root, "lop");
	const generation = join(stable, "generations", "20260916T140000");
	uvToolEnv(generation, { version: "0.56.0", sourceRef: "pypi 0.56.0" });
	symlinkSync(generation, join(stable, "current"));

	const legacyPlan = resolveGlobalInstallPlan({
		identity: readInstallIdentity(
			join(
				legacyInstall(root, { version: "0.55.10" }),
				"bin",
				"local-operator",
			),
		),
	});
	const generationPlan = resolveGlobalInstallPlan({
		identity: readInstallIdentity(join(generation, "bin", "local-operator")),
	});
	assert.equal(legacyPlan.updateCommand, "lop update");
	assert.equal(generationPlan.updateCommand, "lop update");
	assert.equal(legacyPlan.canManageUpdate, false);
	assert.equal(generationPlan.canManageUpdate, true);
});

// ---------------------------------------------------------------------------
// Provenance, and the predicate's edges
// ---------------------------------------------------------------------------

test("provenance comes from the install's own marker, not from the machine", () => {
	// A wheel installed by `lop update` records the sentinel, so it is a release
	// build even though the file exists at all.
	const wheelRoot = tempRoot("provenance-wheel");
	const wheelPrefix = legacyInstall(wheelRoot, {
		version: "0.56.0",
		sourceRef: "pypi 0.56.0",
	});
	const wheelIdentity = readInstallIdentity(
		join(wheelPrefix, "bin", "local-operator"),
	);
	// The FIRST TOKEN is the signal - `pypi` is a sentinel, not a ref - which is
	// what the harness does too (*_looks_like_git_sha*).
	assert.equal(wheelIdentity.sourceRef, "pypi");
	const wheel = resolveGlobalInstallPlan({ identity: wheelIdentity });
	assert.equal(wheel.sourceBuild, false);

	const snapshot = resolveGlobalInstallPlan({
		identity: {
			path: "/Users/operator/.local/bin/local-operator",
			realPath:
				"/Users/operator/.local/share/uv/tools/local-operator/bin/local-operator",
			sourceRef: "abc1234def0",
		},
	});
	assert.equal(snapshot.sourceBuild, true);
	assert.equal(snapshot.canManageUpdate, false);
	// The identity field holds the marker's FIRST TOKEN, so a whole marker line is
	// not a token: `pypi 0.56.0` is two, and only the token rule is applied here.
	assert.equal(isSourceBuildRef("abc1234def0 main"), false);

	// Absent marker: a wheel that has never been upgraded through either writer.
	const freshRoot = tempRoot("provenance-absent");
	const freshPrefix = legacyInstall(freshRoot, { version: "0.56.0" });
	const absent = resolveGlobalInstallPlan({
		identity: readInstallIdentity(join(freshPrefix, "bin", "local-operator")),
	});
	assert.equal(absent.sourceBuild, false);

	/*
	 * Two dist-infos in one prefix - the shape an upgrade interrupted between
	 * uninstall and install leaves behind. The NEWEST has to win: this version is
	 * half of the only evidence that an update landed, so reporting the older
	 * directory would make an install that moved read as one that did not.
	 */
	const doubledRoot = tempRoot("provenance-doubled");
	const doubledPrefix = legacyInstall(doubledRoot, { version: "0.55.10" });
	uvToolEnv(doubledPrefix, { version: "0.56.0" });
	assert.equal(
		readInstallIdentity(join(doubledPrefix, "bin", "local-operator")).version,
		"0.56.0",
	);

	// The token rule itself, at both ends and on both sides of the boundary: a
	// future sentinel must not be hex, or it reads as a bogus commit.
	assert.equal(isSourceBuildRef("abc1234"), true);
	assert.equal(isSourceBuildRef("A".repeat(40)), true);
	assert.equal(isSourceBuildRef("abcdef"), false);
	assert.equal(isSourceBuildRef("g".repeat(12)), false);
	assert.equal(isSourceBuildRef("A".repeat(41)), false);
	assert.equal(isSourceBuildRef("pypi 0.56.0"), false);
	assert.equal(isSourceBuildRef("pypi"), false);
	assert.equal(isSourceBuildRef(null), false);
	assert.equal(isSourceBuildRef(undefined), false);
	assert.equal(isSourceBuildRef(""), false);
});

test("the layout predicate never throws, and never guesses", () => {
	const root = tempRoot("robust");
	// Nothing to resolve.
	assert.equal(generationInstallRoot({ path: null }), null);
	assert.equal(
		generationInstallRoot({ path: join(root, "absent", "bin", "x") }),
		null,
	);
	// A symlink loop: the resolver raises ELOOP, and the answer for a path nobody
	// can resolve is not a guess about where it lives.
	const loopA = join(root, "loop-a");
	const loopB = join(root, "loop-b");
	symlinkSync(loopB, loopA);
	symlinkSync(loopA, loopB);
	assert.equal(generationInstallRoot({ path: loopA }), null);
	// A `generations` directory with no pointer: the layout is PRESENT but not in
	// use, so it must not be reported as if it were.
	const stable = join(root, "lop-no-current");
	mkdirSync(join(stable, "generations", "id"), { recursive: true });
	assert.equal(
		generationInstallRoot({
			path: join(stable, "generations", "id", "bin", "local-operator"),
		}),
		null,
	);
	// A file inside a generation root rather than a directory tree - the same
	// walk, one level shallower. A path the resolver cannot resolve (the shim is
	// not there) answers null first: that is the missing-path case above, reached
	// through the resolver rather than through a missing parent.
	mkdirSync(join(stable, "current"), { recursive: true });
	const shim = join(stable, "generations", "id", "shim");
	writeFileSync(shim, "", "utf8");
	assert.equal(
		generationInstallRoot({ path: shim }),
		join(stable, "generations", "id"),
	);

	// An install with no dist-info at all: a version nobody can read is null, not
	// a guess and not a throw.
	const bare = uvToolEnv(join(root, "bare"), {
		version: "0.56.0",
		distInfo: false,
	});
	assert.equal(
		readInstallIdentity(join(bare, "bin", "local-operator")).version,
		null,
	);
});

test("the refusals are unchanged: an editable checkout and an unknown install name nothing", () => {
	const root = tempRoot("refusals");
	// PEP 610's `dir_info.editable` is the only positive evidence that a prefix is
	// a checkout rather than an installed copy (review Q5).
	const checkout = join(root, "checkout");
	const distInfo = join(
		checkout,
		"lib",
		"python3.12",
		"site-packages",
		"local_operator-0.56.0.dist-info",
	);
	mkdirSync(distInfo, { recursive: true });
	writeFileSync(
		join(distInfo, "direct_url.json"),
		JSON.stringify({
			url: "file:///Users/operator/local-operator",
			dir_info: { editable: true },
		}),
		"utf8",
	);
	mkdirSync(join(checkout, "bin"), { recursive: true });
	const editable = resolveGlobalInstallPlan({
		identity: readInstallIdentity(join(checkout, "bin", "local-operator")),
	});
	assert.equal(editable.canManageUpdate, false);
	assert.equal(editable.updateCommand, "");
	assert.equal(editable.sourceBuild, true);

	const unknown = resolveGlobalInstallPlan({
		identity: { path: "/opt/bin/local-operator" },
	});
	assert.equal(unknown.canManageUpdate, false);
	assert.equal(unknown.updateCommand, "");
	assert.match(unknown.detail, /classified as global-unknown/);
});

// ---------------------------------------------------------------------------
// The two seams the runner depends on
// ---------------------------------------------------------------------------

test("the update child's PATH leads with the installers and keeps the inherited one", () => {
	const home = "/Users/operator";
	const inherited = ["/usr/bin", "/bin", "/usr/sbin", "/sbin"];
	const dirs = installerSearchPath(
		{ PATH: inherited.join(delimiter), HOME: home },
		home,
	).split(delimiter);

	// The inherited entries are all still there, in their own order, at the end:
	// a uv or pipx only the user's shell knows about must stay reachable.
	assert.deepEqual(dirs.slice(-inherited.length), inherited);
	for (const dir of inherited) assert.ok(dirs.includes(dir), `${dir} is kept`);
	// And the installers' own directories lead, because the child has to answer
	// with the install this app classified.
	const localBin = join(home, ".local", "bin");
	for (const dir of [localBin, "/opt/homebrew/bin", "/usr/local/bin"]) {
		assert.ok(dirs.includes(dir), `${dir} is searched`);
		assert.ok(
			dirs.indexOf(dir) < dirs.indexOf("/usr/bin"),
			`${dir} leads the inherited PATH`,
		);
	}

	// A `UV_TOOL_BIN_DIR` the installers were pointed at outranks the shell PATH
	// too, which is what makes a redirected install the one the child updates.
	const redirected = installerSearchPath(
		{
			PATH: inherited.join(delimiter),
			HOME: home,
			UV_TOOL_BIN_DIR: "/tmp/tool-bin",
		},
		home,
	).split(delimiter);
	assert.ok(
		redirected.indexOf("/tmp/tool-bin") < redirected.indexOf("/usr/bin"),
	);

	// An empty PATH is not an error: the installers' directories are still named.
	const bare = installerSearchPath({}, home).split(delimiter);
	assert.ok(bare.includes(localBin));
});

test("`lop update` exiting 0 is not evidence that the install moved", () => {
	// The "already latest" false positive: the installer succeeds and nothing
	// changed, which is exactly the case an exit code cannot tell from a real
	// upgrade (the pip path records the same reasoning).
	assert.equal(
		didUpgradeLand({ before: "0.55.10", after: "0.55.10", target: "0.56.0" }),
		false,
	);
	/*
	 * AND THE OTHER SIDE OF THE SAME RULE (review R1-1): an install that is
	 * ALREADY AT the target is a success, not a failure. The change test alone
	 * reported "the update did not take effect" over a machine that was already
	 * correct, and the panel's own button reaches that state - it appears when the
	 * install is ahead of the serving daemon, which is what the last successful
	 * update leaves behind. This is the case that fails against the rule without
	 * the target arm.
	 */
	assert.equal(
		didUpgradeLand({ before: "0.56.0", after: "0.56.0", target: "0.56.0" }),
		true,
	);
	/*
	 * AT OR PAST the target, and past is a landing (review R2-1). The target is the
	 * version the CHECK read off PyPI; `lop update` installs whatever PyPI has when
	 * it RUNS, so a release published between the offer and the click lands the
	 * install one version beyond the string the app asked for. Equality reported
	 * that correct, newer machine as "the update did not take effect" - R1-1's false
	 * failure with a narrower trigger.
	 */
	assert.equal(
		didUpgradeLand({ before: "0.55.10", after: "0.56.1", target: "0.56.0" }),
		true,
	);
	// A change is still not evidence of the RIGHT change: a run that lands BEHIND
	// the version it was asked for has not landed.
	assert.equal(
		didUpgradeLand({ before: "0.55.10", after: "0.55.14", target: "0.56.0" }),
		false,
	);
	// Neither has one whose reading cannot be ordered at all: `compareVersions`
	// answers null for anything that is not `x.y.z`, and an unorderable reading is
	// not a version at or past the target.
	assert.equal(
		didUpgradeLand({ before: "0.55.10", after: "unknown", target: "0.56.0" }),
		false,
	);
	assert.equal(
		didUpgradeLand({ before: "0.55.10", after: "0.56.0", target: "0.56.0" }),
		true,
	);
	// A non-zero exit that changed nothing is not an upgrade either, and an
	// unreadable AFTER reading is never one.
	assert.equal(
		didUpgradeLand({ before: "0.55.10", after: null, target: "0.56.0" }),
		false,
	);
	// An unreadable BEFORE reading cannot prove anything: the target is what the
	// after-reading is held to (review R6).
	assert.equal(
		didUpgradeLand({ before: null, after: "0.56.0", target: "0.56.0" }),
		true,
	);
	assert.equal(
		didUpgradeLand({ before: null, after: "0.55.10", target: "0.56.0" }),
		false,
	);
});
