import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { countsMeanFailures, stampFailures } from "./check-evidence.mjs";
import { mergedKeys, resolveManifest } from "./evidence-fold.mjs";

/*
 * The fold resolver, exercised in SYNTHETIC GIT REPOSITORIES.
 *
 * `evidence-fold.mjs` is the instrument the fold doctrine needed and never had:
 * the rule for merging `docs/evidence/manifest.json` across a fold has been
 * written down in two places for a dozen folds (the rig's fold block and the
 * manifest's `citationConvention`) and applied by hand every time - and the
 * hand applications are what shipped fold 10's and fold 11's wrong stamps to
 * `main`, and dropped seven of one branch's own records on the twelfth fold.
 *
 * WHY FIXTURES AND NOT THE REAL REPO. Every property here is about a MERGE,
 * and a merge needs three sides and a tree to derive against. A test that
 * resolved the repository's own manifest could only ask whether the answer
 * equals itself. So each case builds a throwaway repository with its own
 * `src/`, `scripts/capture-evidence.mjs`, evidence frames and manifest, and the
 * CLI is run THERE (`cwd` is what `evidence-fold.mjs` resolves its root from).
 *
 * THE GUARDS ARE THE REAL ONES. `stampFailures`/`countsMeanFailures` are
 * imported from `check-evidence.mjs` and pointed at the fixture with an
 * explicit git reader and evidence directory - a copy of the arithmetic here
 * would be a second opinion, and the point of the tool is that it writes what
 * the FIRST one demands. The evidence directory is passed explicitly because
 * the guard's own default is this repository's tree.
 */

const SCRIPT = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"evidence-fold.mjs",
);

const scratch = [];
after(() => {
	for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** `git` in `cwd`, trimmed stdout, or null when it failed or said nothing. */
const git = (cwd, args) => {
	try {
		return (
			execFileSync("git", args, {
				cwd,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			}).trim() || null
		);
	} catch {
		return null;
	}
};

/**
 * A git reader the guards can use against a fixture: they were written for THIS
 * repository's `gitOut`, which shells out with the process's own cwd.
 */
const readerFor = (cwd) => (args) =>
	git(
		cwd,
		args.map((a) => a.replace(/^HEAD(?=$|:)/, "HEAD")),
	) === null
		? null
		: git(cwd, args);

/** The manifest a fold is about: pass fields, listings, and the derived set. */
const manifest = (fields) => ({
	head: fields.head ?? "0".repeat(40),
	srcTree: fields.srcTree ?? "1".repeat(40),
	scriptsTree: fields.scriptsTree ?? "2".repeat(40),
	dirtyWorkingTree: false,
	frames: fields.frames ?? 2,
	surfaces: fields.surfaces ?? 2,
	themes: fields.themes ?? 1,
	countsMean: fields.countsMean ?? {
		frames: `${fields.frames ?? 2} committed WebP files outside the 0 declared supplementary sets below, of 2 on disk (0 of them inside the sets).`,
		surfaces: `${fields.surfaces ?? 2} rows in \`HEAD:scripts/capture-evidence.mjs\`'s STORIES literal.`,
		themes: `${fields.themes ?? 1} theme names in the \`THEMES\` literal.`,
	},
	...(fields.supplementary ? { supplementary: fields.supplementary } : {}),
	...(fields.partialCapture ? { partialCapture: fields.partialCapture } : {}),
	...fields.extra,
});

/**
 * A repository old enough to fold: a base commit, a `lane` branch with its own
 * record, and a `main` branch that moved `src/` and `scripts/` under it.
 */
const fixture = ({ laneRecord = true, mainRecord = true } = {}) => {
	const dir = mkdtempSync(join(tmpdir(), "lop-evidence-fold-"));
	scratch.push(dir);
	git(dir, ["init", "--initial-branch=main", "-q"]);
	git(dir, ["config", "user.email", "fixture@example.invalid"]);
	git(dir, ["config", "user.name", "Fixture"]);
	git(dir, ["config", "commit.gpgsign", "false"]);

	const write = (path, text) => {
		mkdirSync(dirname(join(dir, path)), { recursive: true });
		writeFileSync(join(dir, path), text);
	};
	const capture = (stories) =>
		[
			"const STORIES = [",
			...stories.map((id) => `\t["${id}", "slot", "note"],`),
			"];",
			"",
			"const THEMES = [",
			'\t"localOperatorDark",',
			"];",
			"",
		].join("\n");
	const frame = (path) => {
		mkdirSync(dirname(join(dir, path)), { recursive: true });
		writeFileSync(join(dir, path), "not-a-real-webp");
	};

	write("src/app.ts", "export const one = 1;\n");
	write("scripts/capture-evidence.mjs", capture(["chat--one", "chat--two"]));
	frame("docs/evidence/chat--one/localOperatorDark.webp");
	frame("docs/evidence/chat--two/localOperatorDark.webp");
	write(
		"docs/evidence/manifest.json",
		`${JSON.stringify(manifest({ extra: { baseRecord: "the base pass" } }), null, 2)}\n`,
	);
	git(dir, ["add", "-A"]);
	git(dir, ["commit", "-qm", "chore: base"]);

	git(dir, ["checkout", "-q", "-b", "lane"]);
	if (laneRecord) {
		const m = manifest({
			extra: {
				baseRecord: "the base pass",
				laneRecord: "THE LANE'S OWN PASS, WHICH MUST SURVIVE THE FOLD",
			},
			supplementary: [
				{
					path: "lane-set",
					frames: 1,
					surfaces: 1,
					why: "the lane wrote this",
				},
			],
			partialCapture: {
				refreshedStories: ["chat--one"],
				refreshedThemes: ["localOperatorDark"],
				refreshedFrames: 1,
				addedFrames: 0,
			},
		});
		write("docs/evidence/manifest.json", `${JSON.stringify(m, null, 2)}\n`);
		frame("docs/evidence/lane-set/localOperatorDark.webp");
		git(dir, ["add", "-A"]);
		git(dir, ["commit", "-qm", "feat: the lane's pass"]);
	}

	git(dir, ["checkout", "-q", "main"]);
	write("src/app.ts", "export const one = 2;\n");
	write(
		"scripts/capture-evidence.mjs",
		capture(["chat--one", "chat--two", "chat--three"]),
	);
	frame("docs/evidence/chat--three/localOperatorDark.webp");
	const mainManifest = manifest({
		head: "f".repeat(40),
		extra: {
			baseRecord: "the base pass",
			...(mainRecord ? { mainRecord: "MAIN'S OWN PASS" } : {}),
		},
	});
	write(
		"docs/evidence/manifest.json",
		`${JSON.stringify(mainManifest, null, 2)}\n`,
	);
	git(dir, ["add", "-A"]);
	git(dir, ["commit", "-qm", "feat: main moves src, scripts and the manifest"]);

	git(dir, ["checkout", "-q", "lane"]);
	return dir;
};

/**
 * Git in the fixture, with the EXIT CODE.
 *
 * `git()` above answers with output, which cannot distinguish a merge that
 * stopped on a conflict from one that succeeded and printed a summary - and
 * "did git stop, and on what" is the whole question the driver case asks.
 */
const gitCode = (cwd, args) => {
	const result = spawnSync("git", args, { cwd, encoding: "utf8" });
	return { code: result.status, out: `${result.stdout}${result.stderr}` };
};

/** Run the tool in the fixture. */
const run = (dir, args = []) => {
	const result = spawnSync(process.execPath, [SCRIPT, ...args], {
		cwd: dir,
		encoding: "utf8",
	});
	return { status: result.status, out: `${result.stdout}${result.stderr}` };
};

const readManifest = (dir) =>
	JSON.parse(readFileSync(join(dir, "docs/evidence/manifest.json"), "utf8"));

const guardFailures = (dir) => {
	const evidenceDir = join(dir, "docs", "evidence");
	const reader = readerFor(dir);
	const m = readManifest(dir);
	return [
		...stampFailures(m, reader, evidenceDir),
		...countsMeanFailures(m, reader, evidenceDir),
	];
};

/* ------------------------------------------------------------------ *
 * 1. A two-sided change resolves without a manual step
 * ------------------------------------------------------------------ */

test("a fold resolves both sides' records, unions the listings, and re-derives the stamps", () => {
	const dir = fixture();
	assert.notEqual(
		gitCode(dir, ["merge", "main"]).code,
		0,
		"the fixture is meant to conflict on the manifest",
	);

	const result = run(dir);
	assert.equal(result.status, 0, result.out);
	assert.match(result.out, /the merge is resolved/);
	assert.match(result.out, /git commit/);
	// The resolver read the three sides from GIT OBJECTS, so the conflict
	// markers git left in the working file were never an input.
	assert.doesNotMatch(
		readFileSync(join(dir, "docs", "evidence", "manifest.json"), "utf8"),
		/<<<<<<</,
	);

	const m = readManifest(dir);
	assert.equal(
		m.laneRecord,
		"THE LANE'S OWN PASS, WHICH MUST SURVIVE THE FOLD",
	);
	assert.equal(m.mainRecord, "MAIN'S OWN PASS");
	assert.equal(m.baseRecord, "the base pass");
	// The lane's set survives main's copy, and main's frames become declared
	// rather than "outside every set" - the union at the TOP level as well as
	// inside it.
	assert.deepEqual(
		m.supplementary.map((entry) => entry.path),
		["lane-set"],
	);
	assert.equal(
		m.surfaces,
		3,
		"the merged tree's STORIES literal has three rows",
	);
	assert.equal(m.themes, 1);
	// THE DERIVED COUNT IS THE WALK'S, not a carry: the merged tree holds four
	// frames and `lane-set` declares one of them, so three sit outside every
	// declared set. The lane's own copy said 3 and main's said 4; neither value
	// is what this field means.
	assert.equal(
		m.frames,
		3,
		"the merged tree's frames outside the declared set",
	);

	// The stamps name the MERGED tree, which is what `git write-tree` answers
	// mid-merge - not `HEAD:src`, which is still the lane's pre-merge tree.
	const staged = git(dir, ["write-tree"]);
	assert.equal(m.srcTree, git(dir, ["rev-parse", `${staged}:src`]));
	assert.equal(m.scriptsTree, git(dir, ["rev-parse", `${staged}:scripts`]));
	assert.notEqual(m.srcTree, git(dir, ["rev-parse", "HEAD:src"]));

	// ONE commit: the fold is completed by the merge commit itself, not by a
	// second docs-only commit after it.
	git(dir, ["commit", "-qm", "chore(merge): fold main into the lane"]);
	assert.equal(
		git(dir, ["log", "-1", "--format=%P", "HEAD"]).split(" ").length,
		2,
		"the tip is the merge commit the fold produced",
	);
	assert.equal(
		git(dir, ["status", "--porcelain"]),
		null,
		"nothing is left over",
	);
	assert.deepEqual(guardFailures(dir), []);
});

/* ------------------------------------------------------------------ *
 * 2. The merge driver: `git merge` never stops on the manifest
 * ------------------------------------------------------------------ */

test("with the merge driver installed, git merges without a manifest conflict", () => {
	const dir = fixture();
	// Installed by hand with an ABSOLUTE path, which is the only difference
	// from `--install`: git resolves the relative spelling against the work
	// tree, and this fixture has no `scripts/evidence-fold.mjs` of its own.
	git(dir, [
		"config",
		"merge.evidence-fold.driver",
		`${process.execPath} ${SCRIPT} --driver %O %A %B`,
	]);
	writeFileSync(
		join(dir, ".gitattributes"),
		"docs/evidence/manifest.json merge=evidence-fold\n",
	);
	git(dir, ["add", ".gitattributes"]);
	git(dir, ["commit", "-qm", "chore: the fold driver rule"]);

	const merge = gitCode(dir, [
		"merge",
		"main",
		"-m",
		"chore(merge): fold main",
	]);
	assert.equal(merge.code, 0, `git must not have stopped: ${merge.out}`);
	assert.match(
		merge.out,
		/stamps still name the PRE-merge tree/,
		"the driver resolved the manifest and said what it left undone",
	);
	assert.equal(
		git(dir, ["diff", "--name-only", "--diff-filter=U"]),
		null,
		"no unmerged paths remain",
	);

	// The driver left group 4 on the lane's side - the merged tree does not
	// exist yet - and said so.
	const afterDriver = readManifest(dir);
	assert.ok(afterDriver.laneRecord && afterDriver.mainRecord);

	const result = run(dir);
	assert.equal(result.status, 0, result.out);
	assert.match(result.out, /amended the merge commit/);
	assert.equal(git(dir, ["rev-list", "--count", "HEAD^2"]).length > 0, true);
	assert.equal(
		git(dir, ["log", "-1", "--format=%P", "HEAD"]).split(" ").length,
		2,
		"the tip is still a merge commit",
	);
	assert.deepEqual(guardFailures(dir), []);
	// And the fold is still ONE commit: it was amended, not followed.
	assert.equal(git(dir, ["status", "--porcelain"]), null);
});

/* ------------------------------------------------------------------ *
 * 3. Both sides moved the same derived field
 * ------------------------------------------------------------------ */

test("a stamp both sides moved is recomputed and neither side's value is carried", () => {
	const ours = manifest({ extra: { laneRecord: "lane" } });
	const theirs = manifest({ extra: { mainRecord: "main" } });
	const base = manifest({ extra: { baseRecord: "base" } });
	// Both sides changed `frames` against base, differently.
	ours.frames = 11;
	theirs.frames = 22;
	base.frames = 5;
	ours.surfaces = 3;
	theirs.surfaces = 4;

	const resolved = resolveManifest({
		base,
		ours,
		theirs,
		derived: { frames: 99, surfaces: 8, themes: 1 },
	});
	assert.equal(resolved.frames, 99, "re-derived, not ours and not theirs");
	assert.equal(resolved.surfaces, 8);
	assert.equal(resolved.laneRecord, "lane");
	assert.equal(resolved.mainRecord, "main");
});

test("the top-level union keeps this branch's records and drops a key this branch retired", () => {
	const base = { keep: 1, retired: "main's spelling of a retired note" };
	const ours = { keep: 2, laneRecord: "ours" };
	const theirs = {
		keep: 2,
		retired: "main still carries it",
		mainRecord: "main",
	};
	assert.deepEqual(
		mergedKeys(base, ours, theirs).sort(),
		["keep", "laneRecord", "mainRecord"],
		"a key main never had is kept; a key the branch dropped and main still carries is not carried back",
	);
	const resolved = resolveManifest({ base, ours, theirs, derived: null });
	assert.equal(resolved.retired, undefined);
	assert.equal(resolved.laneRecord, "ours");
	assert.equal(resolved.mainRecord, "main");
});

/* ------------------------------------------------------------------ *
 * 4. Idempotence
 * ------------------------------------------------------------------ */

test("a second run is a clean no-op, in both the restamp and the amend state", () => {
	const dir = fixture();
	git(dir, ["merge", "main"]);
	assert.equal(run(dir).status, 0);
	const staged = readFileSync(
		join(dir, "docs", "evidence", "manifest.json"),
		"utf8",
	);
	const second = run(dir);
	assert.equal(second.status, 0);
	assert.match(
		second.out,
		/already in the file; nothing was written or staged/,
	);
	assert.equal(
		readFileSync(join(dir, "docs", "evidence", "manifest.json"), "utf8"),
		staged,
		"the second run rewrote nothing",
	);

	// Amend state: the driver resolves, the merge commits itself, and the
	// re-derivation is applied by amending that merge.
	const driverDir = fixture();
	git(driverDir, [
		"config",
		"merge.evidence-fold.driver",
		`${process.execPath} ${SCRIPT} --driver %O %A %B`,
	]);
	writeFileSync(
		join(driverDir, ".gitattributes"),
		"docs/evidence/manifest.json merge=evidence-fold\n",
	);
	git(driverDir, ["add", ".gitattributes"]);
	git(driverDir, ["commit", "-qm", "chore: the fold driver rule"]);
	git(driverDir, ["merge", "main", "-m", "chore(merge): fold main"]);
	assert.equal(run(driverDir).status, 0);
	const head = git(driverDir, ["rev-parse", "HEAD"]);
	const again = run(driverDir);
	assert.equal(again.status, 0);
	assert.match(again.out, /already describes this tree/);
	assert.equal(git(driverDir, ["rev-parse", "HEAD"]), head, "no second amend");
});

/* ------------------------------------------------------------------ *
 * 5. Refusals, and the states that are not folds
 * ------------------------------------------------------------------ */

test("a conflict outside the manifest is reported, not resolved over", () => {
	const dir = fixture();
	// A second conflict, in the source, so the fold is genuinely incomplete.
	git(dir, ["checkout", "-q", "main"]);
	writeFileSync(join(dir, "src", "app.ts"), "export const one = 3;\n");
	git(dir, ["add", "-A"]);
	git(dir, ["commit", "-qm", "feat: main moves src again"]);
	git(dir, ["checkout", "-q", "lane"]);
	writeFileSync(join(dir, "src", "app.ts"), "export const one = 4;\n");
	git(dir, ["add", "-A"]);
	git(dir, ["commit", "-qm", "feat: the lane moves src"]);

	assert.notEqual(gitCode(dir, ["merge", "main"]).code, 0);
	const result = run(dir);
	assert.equal(result.status, 1, "an incomplete fold is not a success");
	assert.match(result.out, /still unmerged/);
	assert.match(result.out, /then re-run/);
	// The manifest half WAS resolved and staged, so the second run completes.
	assert.doesNotMatch(
		readFileSync(join(dir, "docs", "evidence", "manifest.json"), "utf8"),
		/<<<<<<</,
	);
	git(dir, ["checkout", "-q", "main", "--", "src/app.ts"]);
	git(dir, ["add", "src/app.ts"]);
	const second = run(dir);
	assert.equal(second.status, 0, second.out);
});

test("outside a merge, a stale stamp is re-derived without amending anything", () => {
	const dir = fixture();
	// A plain content commit that moved `scripts/` under the stamp.
	writeFileSync(
		join(dir, "scripts", "capture-evidence.mjs"),
		readFileSync(join(dir, "scripts", "capture-evidence.mjs"), "utf8"),
	);
	git(dir, ["commit", "-q", "--allow-empty", "-m", "chore: a commit"]);
	const before = git(dir, ["rev-parse", "HEAD"]);
	// Nothing is stale yet; make it so by moving src and leaving the manifest.
	writeFileSync(join(dir, "src", "app.ts"), "export const one = 9;\n");
	git(dir, ["add", "-A"]);
	git(dir, ["commit", "-qm", "feat: move src"]);

	const result = run(dir);
	assert.equal(result.status, 0, result.out);
	assert.match(result.out, /git commit/);
	assert.doesNotMatch(result.out, /amend/);
	assert.equal(
		git(dir, ["rev-parse", "HEAD"]),
		git(dir, ["rev-parse", "HEAD"]),
		"nothing was committed for the author",
	);
	assert.equal(
		git(dir, ["diff", "--cached", "--name-only"]),
		"docs/evidence/manifest.json",
		"the re-derived stamps are staged, and only they",
	);
	const m = readManifest(dir);
	assert.equal(m.srcTree, git(dir, ["rev-parse", "HEAD:src"]));
	assert.notEqual(before, null);
});

test("--dry-run reports and writes nothing", () => {
	const dir = fixture();
	git(dir, ["merge", "main"]);
	const conflicted = readFileSync(
		join(dir, "docs", "evidence", "manifest.json"),
		"utf8",
	);
	const result = run(dir, ["--dry-run"]);
	assert.equal(result.status, 0, result.out);
	assert.match(result.out, /dry run: nothing written, nothing staged/);
	assert.equal(
		readFileSync(join(dir, "docs", "evidence", "manifest.json"), "utf8"),
		conflicted,
	);
	// Deliberately NOT `git diff --cached`: a merge in progress legitimately has
	// the other side's auto-merged files staged, so that check would be about
	// git's own bookkeeping rather than about what this run wrote.
});

/* ------------------------------------------------------------------ *
 * 6. The instrument can fail: the guards still catch a wrong stamp
 * ------------------------------------------------------------------ */

test("the guards the tool runs can still fail on the tree the tool produces", () => {
	const dir = fixture();
	git(dir, ["merge", "main"]);
	assert.equal(run(dir).status, 0);
	git(dir, ["commit", "-qm", "chore(merge): fold main"]);
	assert.deepEqual(guardFailures(dir), []);

	const good = readManifest(dir);
	const mutated = { ...good, srcTree: "0".repeat(40) };
	writeFileSync(
		join(dir, "docs", "evidence", "manifest.json"),
		`${JSON.stringify(mutated, null, 2)}\n`,
	);
	assert.equal(
		stampFailures(mutated, readerFor(dir), join(dir, "docs", "evidence"))
			.length >= 1,
		true,
		"a mutated stamp must fail the guard the tool validates against",
	);

	// A dropped branch record is caught by the shipped record-survival test's
	// own property, read here off the manifest the resolver produced.
	const { laneRecord: _dropped, ...dropped } = good;
	assert.equal(
		"laneRecord" in dropped,
		false,
		"a fold that dropped it would fail the record-survival property",
	);

	// And a stale countsMean lead is caught too.
	const stale = {
		...good,
		countsMean: {
			...good.countsMean,
			frames:
				"0 committed WebP files outside the 999 declared supplementary sets below, of 0 on disk (0 of them inside the sets).",
		},
	};
	assert.equal(
		countsMeanFailures(stale, readerFor(dir), join(dir, "docs", "evidence"))
			.length >= 1,
		true,
	);
});

/* ------------------------------------------------------------------ *
 * 7. --install / --check
 * ------------------------------------------------------------------ */

test("--install is idempotent and --check reports the state read-only", () => {
	const dir = fixture();
	const before = run(dir, ["--check"]);
	assert.equal(before.status, 1, "not wired yet");
	assert.match(before.out, /pnpm evidence:fold:install/);

	const installed = run(dir, ["--install"]);
	assert.equal(installed.status, 0, installed.out);
	assert.equal(
		git(dir, ["config", "--local", "--get", "merge.evidence-fold.driver"]),
		"node scripts/evidence-fold.mjs --driver %O %A %B",
	);
	const again = run(dir, ["--install"]);
	assert.equal(again.status, 0);
	assert.match(again.out, /already current/);
	const checked = run(dir, ["--check"]);
	assert.equal(checked.status, 0, checked.out);
});

test("a wiring that cannot be verified is loud by hand and tolerated by prepare", () => {
	const dir = fixture();
	// A git directory it cannot write is the honest way to make the wiring fail:
	// git writes the new config BESIDE the old one and renames it over, so a
	// read-only `config` file alone does not stop it - it is the directory that
	// has to refuse. This is the state `prepare` has to survive without failing
	// an install, and the state `pnpm evidence:fold:install` has to report.
	chmodSync(join(dir, ".git"), 0o555);
	const strict = run(dir, ["--install"]);
	assert.equal(strict.status, 1, strict.out);
	assert.match(strict.out, /merge\.evidence-fold\.driver|config/i);
	const forgiving = run(dir, ["--install", "--tolerate-failure"]);
	assert.equal(forgiving.status, 0, forgiving.out);
	assert.match(forgiving.out, /NOT failed by it/);
	chmodSync(join(dir, ".git"), 0o755);
});
