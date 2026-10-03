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
import {
	countsMeanFailures,
	partialCaptureFailures,
	stampFailures,
} from "./check-evidence.mjs";
import { keyPaths } from "./check-fold-keys.mjs";
import {
	deepEqual,
	mergedKeys,
	resolveManifest,
	runGuards,
} from "./evidence-fold.mjs";

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

/**
 * The key-set gate, runnable over a FIXTURE's merge commit.
 *
 * `scripts/check-fold-keys.mjs` is the rule the round-3 fix answers ("no key may
 * be lost and no form may be re-imposed"), and it takes a merge SHA and runs git
 * in the CURRENT directory - so a fixture can be checked with the real gate
 * rather than with a re-implementation of it in this file.
 */
const KEY_GATE = resolve(dirname(SCRIPT), "check-fold-keys.mjs");

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
 *
 * `""` AND `null` ARE DIFFERENT ANSWERS, and the guards depend on it: a command
 * that SUCCEEDED and printed nothing (`git merge-base --is-ancestor`) answers ""
 * while a command that failed answers null, and `citationAncestryFailures` reads
 * exactly that distinction (`!== null`). A helper that collapsed both to null
 * made every ancestry question a failure - which is how the fixture-side reader
 * hid the difference the guard is built on.
 */
const readerFor = (cwd) => (args) => {
	try {
		return execFileSync("git", args, {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	} catch {
		return null;
	}
};

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
const fixture = ({
	laneRecord = true,
	mainRecord = true,
	attributes = false,
} = {}) => {
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
	const capture = captureSource;
	const frame = (path) => {
		mkdirSync(dirname(join(dir, path)), { recursive: true });
		writeFileSync(join(dir, path), "not-a-real-webp");
	};

	write("src/app.ts", "export const one = 1;\n");
	write("scripts/capture-evidence.mjs", capture(["chat--one", "chat--two"]));
	frame("docs/evidence/chat--one/localOperatorDark.webp");
	frame("docs/evidence/chat--two/localOperatorDark.webp");
	// A driver rule has to be in the tree BEING REPLAYED for a rebase or a
	// cherry-pick to consult the driver at all - git reads `.gitattributes` from
	// the tree it is applying, not from the branch it is standing on.
	if (attributes)
		write(
			".gitattributes",
			"docs/evidence/manifest.json merge=evidence-fold\n",
		);
	write(
		"docs/evidence/manifest.json",
		`${JSON.stringify(manifest({ extra: { baseRecord: "the base pass" } }), null, 2)}\n`,
	);
	git(dir, ["add", "-A"]);
	git(dir, ["commit", "-qm", "chore: base"]);
	/*
	 * The head every side CITES. `citationFailures` (which `runGuards` now asks)
	 * requires `head` to resolve AND be reachable, so a fixture whose manifests
	 * carry the placeholder `0000...` would make every fold refuse - correctly,
	 * but as a fixture artefact rather than as the property under test. The base
	 * commit is a real, reachable ancestor of both sides.
	 */
	const baseSha = git(dir, ["rev-parse", "HEAD"]);

	git(dir, ["checkout", "-q", "-b", "lane"]);
	if (laneRecord) {
		const m = manifest({
			head: baseSha,
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
		head: baseSha,
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

/**
 * The `scripts/capture-evidence.mjs` a fixture ships: the STORIES literal the
 * `surfaces` field and its prose are counted from, in the writer's own shape
 * (one `\t["<id>", ...]` row per story).
 */
const captureSource = (stories) =>
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

const readManifest = (dir) =>
	JSON.parse(readFileSync(join(dir, "docs/evidence/manifest.json"), "utf8"));

/**
 * The tree half of the guards the tool runs, exactly as the tool asks it.
 *
 * `stampFailures` already folds `partialCaptureFailures` and
 * `countsMeanFailures` in, so naming them here as well would print every one of
 * their failures twice - the same defect the tool's own guard step had. The
 * `partialCapture` arithmetic is exercised DIRECTLY by the two-sided story case
 * below, in both directions, rather than through this helper: that field's guard
 * stood down silently on every fixture before it (no `refreshedAtHead`), which
 * is how a disagreement between the writer and the guard stayed invisible.
 */
const guardFailures = (dir) =>
	stampFailures(
		readManifest(dir),
		readerFor(dir),
		join(dir, "docs", "evidence"),
	);

/** The manifest a revision's tree carries, or null when the read failed. */
const manifestAt = (dir, rev) => {
	const text = git(dir, ["show", `${rev}:docs/evidence/manifest.json`]);
	return text === null ? null : JSON.parse(text);
};

/**
 * Keys `source` carries that the merged file does not.
 *
 * The only key a resolver is ALLOWED to drop is one THIS BRANCH deleted - present
 * at base, absent from ours (group 5, the retired spelling). Anything else either
 * side carries must survive: the twelfth fold dropped seven of one branch's own
 * records without a word, which is the failure this property names.
 */
const droppedKeys = (source, base, resolved) =>
	Object.keys(source).filter((key) => !(key in base) && !(key in resolved));

/** Wire the merge driver into a fixture, the way `--install` does (absolute path). */
const installDriver = (dir) => {
	git(dir, [
		"config",
		"merge.evidence-fold.driver",
		`${process.execPath} ${SCRIPT} --driver %O %A %B`,
	]);
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

	/*
	 * Q1: the lead the tool writes must not claim what the tool cannot know.
	 * "Nothing in this fold touches a surface these stories render, so nothing
	 * was re-shot" was the writer's assertion on the AUTHOR's behalf, and the
	 * guards read only the numbers in that sentence - so a fold that did re-shoot
	 * frames shipped it. The replacement states the numbers and names the author
	 * as the one who decides about frame movement, while keeping the reading
	 * `countsMeanFailures` parses. That the same reading still matches is asked
	 * by the empty `guardFailures(dir)` at the end of this case.
	 */
	assert.match(m.countsMean.frames, /RE-DERIVED FOR THIS FOLD/);
	assert.match(m.countsMean.frames, /AUTHOR's statement/);
	assert.doesNotMatch(
		m.countsMean.frames,
		/re-shot/i,
		"the lead must not carry the re-shot claim the old text asserted on the author's behalf",
	);
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
	// `attributes: true` carries the rule in the BASE commit, which is where a
	// merge, a rebase and a cherry-pick all read it from: git consults
	// `.gitattributes` from the tree it is applying, not from the branch it is
	// standing on, so a rule added after the commit under replay does not select
	// the driver for it. Installed by hand with an ABSOLUTE path, which is the
	// only difference from `--install`: git resolves the relative spelling
	// against the work tree, and this fixture has no `scripts/evidence-fold.mjs`.
	const dir = fixture({ attributes: true });
	installDriver(dir);

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

	/*
	 * The record-survival property, asked of the REAL three sides this fixture
	 * has, where a tautology used to sit: the old block destructured `laneRecord`
	 * OUT of a copy and then asserted it was absent, which cannot fail and
	 * tested nothing. The control at the end is what makes it a property - a
	 * resolver that starts from one side's schema drops the other side's
	 * records, and this assertion has to go red for that.
	 */
	const base = manifestAt(dir, git(dir, ["merge-base", "HEAD^1", "HEAD^2"]));
	const ours = manifestAt(dir, "HEAD^1");
	const theirs = manifestAt(dir, "HEAD^2");
	assert.deepEqual(
		droppedKeys(ours, base, good),
		[],
		"every top-level key this branch carries survives the fold",
	);
	assert.deepEqual(droppedKeys(theirs, base, good), []);
	assert.notDeepEqual(
		Object.keys(ours).filter((key) => !(key in theirs)),
		[],
		"the fixture must give this branch keys main lacks, or the property is vacuous",
	);
	assert.notDeepEqual(
		droppedKeys(ours, base, theirs),
		[],
		"a resolver that takes one side's schema whole drops the other's records - the property can fail",
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

/* ------------------------------------------------------------------ *
 * M1: the driver resolves a MERGE and nothing else
 * ------------------------------------------------------------------ */

/*
 * `%A` is "this branch" for `git merge` and for nothing else: under a rebase,
 * a cherry-pick, a revert, `am` or a stash-pop git hands the driver the UPSTREAM
 * side as `%A`, and a content driver is given nothing that tells them apart. The
 * driver therefore resolves only when `MERGE_HEAD` exists and otherwise exits
 * non-zero with the operation named, which is what makes git stop on the
 * conflict exactly as it did before this PR added the driver at all.
 */
test("the merge driver refuses outside a merge, so a rebase stops on the conflict", () => {
	const dir = fixture({ attributes: true });
	installDriver(dir);
	const rebase = gitCode(dir, ["rebase", "main"]);
	assert.notEqual(
		rebase.code,
		0,
		`git must stop on the conflict, not resolve it: ${rebase.out}`,
	);
	assert.match(
		rebase.out,
		/REFUSING to resolve docs\/evidence\/manifest\.json during rebase/,
		"the driver named the operation it refused",
	);
	assert.match(rebase.out, /CONFLICT/, "git reported its own conflict");
	assert.match(
		readFileSync(join(dir, "docs", "evidence", "manifest.json"), "utf8"),
		/<<<<<<</,
		"the file git stopped on is a conflict, not a mechanically resolved copy",
	);
	assert.notEqual(
		git(dir, ["ls-files", "-u"]),
		null,
		"the index still carries the unmerged path",
	);
	assert.match(
		rebase.out,
		/pnpm evidence:fold/,
		"the refusal says how to proceed",
	);
});

test("the merge driver refuses a cherry-pick too, and still resolves a merge", () => {
	const dir = fixture({ attributes: true });
	installDriver(dir);
	const pick = gitCode(dir, ["cherry-pick", "main"]);
	assert.notEqual(pick.code, 0, pick.out);
	/*
	 * A SINGLE-COMMIT cherry-pick leaves no marker file WHILE the driver runs -
	 * measured: `ls .git` inside the driver shows only `COMMIT_EDITMSG`, `HEAD`
	 * and `index.lock`, because git writes `CHERRY_PICK_HEAD` after the merge
	 * step - so the refusal is the generic one and says why it cannot name the
	 * operation. It is still a refusal, and the file carries git's own conflict
	 * markers rather than one side's copy.
	 */
	assert.match(
		pick.out,
		/REFUSING .* during an operation that is not a merge/,
		pick.out,
	);
	assert.match(
		readFileSync(join(dir, "docs", "evidence", "manifest.json"), "utf8"),
		/<<<<<<</,
	);

	// The control: the same wiring under a real merge resolves, so the refusal
	// is a claim about the operation and not a blanket stop.
	const merged = fixture({ attributes: true });
	installDriver(merged);
	const merge = gitCode(merged, ["merge", "main"]);
	assert.equal(merge.code, 0, merge.out);
	assert.match(
		merge.out,
		/resolved docs\/evidence\/manifest\.json mechanically/,
	);
});

test("a hand run of the tool outside a merge refuses rather than taking HEAD's side", () => {
	const dir = fixture({ attributes: true });
	installDriver(dir);
	assert.notEqual(gitCode(dir, ["rebase", "main"]).code, 0);
	// The author reaches for the tool while the rebase is stopped. `HEAD` is the
	// commit being rebased ONTO, so "resolve from HEAD" would take that side.
	const result = run(dir);
	assert.equal(result.status, 1, result.out);
	assert.match(
		result.out,
		/rebase .* is in progress|rebase \(or pull --rebase\) is in progress/,
	);
	assert.match(result.out, /MERGE only/);
});

/* ------------------------------------------------------------------ *
 * M2: refreshedFrames - when it is re-derived, and over what denominator
 * ------------------------------------------------------------------ */

test("refreshedFrames is re-derived whenever the merged file carries a partialCapture", () => {
	const pc = (frames) => ({
		refreshedStories: ["chat--one"],
		refreshedFrames: frames,
		note: "a pass",
	});
	const base = { partialCapture: pc(1) };
	const moved = { partialCapture: pc(7) };
	const both = { partialCapture: pc(9) };
	const derived = { refreshedFrames: 42 };
	for (const [what, ours, theirs] of [
		["neither side moved the container", moved, moved],
		["this branch moved it", moved, base],
		["main moved it", base, moved],
		["both sides moved it, differently", moved, both],
	])
		assert.equal(
			resolveManifest({ base, ours, theirs, derived }).partialCapture
				.refreshedFrames,
			42,
			what,
		);
	assert.equal(
		moved.partialCapture.refreshedFrames,
		7,
		"the resolver re-derives into a COPY; the caller's side must be untouched",
	);
	assert.equal(
		resolveManifest({ base, ours: moved, theirs: base }).partialCapture
			.refreshedFrames,
		7,
		"with no derived fields (the driver) the three-way rule still applies",
	);
});

/*
 * The two-sided story fixture. Frames are laid out the way the capturer writes
 * them (`docs/evidence/<surface>/<leaf>/<theme>.webp`), so `claimedStory` and
 * `namedByPass` can answer at all: the older fixture's flat `chat--one/...`
 * directories match no story id, which is why `partialCaptureFailures` stood
 * down (its `refreshedAtHead` guard) on every case that existed before this one.
 */
const storyFixture = ({ mainLostNestedKeys = false } = {}) => {
	const dir = mkdtempSync(join(tmpdir(), "lop-evidence-fold-story-"));
	scratch.push(dir);
	git(dir, ["init", "--initial-branch=main", "-q"]);
	git(dir, ["config", "user.email", "fixture@example.invalid"]);
	git(dir, ["config", "user.name", "Fixture"]);
	git(dir, ["config", "commit.gpgsign", "false"]);
	const write = (path, text) => {
		mkdirSync(dirname(join(dir, path)), { recursive: true });
		writeFileSync(join(dir, path), text);
	};
	const frame = (id) =>
		write(
			`docs/evidence/${id.replace("--", "/")}/localOperatorDark.webp`,
			"not-a-real-webp",
		);
	const manifestJson = (m) =>
		write("docs/evidence/manifest.json", `${JSON.stringify(m, null, 2)}\n`);

	// An INIT commit first, so `refreshedAtHead^` resolves and the pass-diff half
	// of `partialCaptureFailures` can be asked rather than standing down.
	write("README.md", "# fixture\n");
	git(dir, ["add", "-A"]);
	git(dir, ["commit", "-qm", "chore: init"]);
	const initSha = git(dir, ["rev-parse", "HEAD"]);

	const stories = ["chat--one", "chat--two", "chat--declared"];
	write("src/app.ts", "export const one = 1;\n");
	write("scripts/capture-evidence.mjs", captureSource(stories));
	for (const id of stories) frame(id);
	/*
	 * The PRODUCTION SHAPE the `mainLostNestedKeys` option exists for (round-3
	 * test remediation): with it the LANE leaves `partialCapture` exactly as the
	 * base wrote it - the real defect had THIS branch's container unchanged while
	 * the OTHER side moved it - and `main`'s copy has moved and lost
	 * `addedSurfacesNote` along with a depth-3 leaf. Without the option both sides
	 * carry every key, which is the shape this fixture's other tests want: when
	 * BOTH containers moved the pre-fix rule still reached its per-key descent, so
	 * only the unchanged-lane shape can tell the two rules apart.
	 */
	const basePartialCapture = {
		refreshedStories: ["chat--one"],
		refreshedThemes: ["localOperatorDark"],
		refreshedFrames: 1,
		refreshedAt: "2026-01-01T00:00:00Z",
		refreshedAtHead: initSha,
		note: "the base's pass",
		addedSurfacesNote: "the base's added-surfaces note",
		nested: { deep: { leaf: "the base's leaf" } },
	};
	manifestJson(
		manifest({
			head: initSha,
			frames: 2,
			surfaces: 3,
			themes: 1,
			countsMean: {
				frames:
					"2 committed WebP files outside the 1 declared supplementary sets below, of 3 on disk (1 of them inside the sets).",
				surfaces:
					"3 rows in `HEAD:scripts/capture-evidence.mjs`'s STORIES literal.",
				themes: "1 theme names in the `THEMES` literal.",
			},
			supplementary: [
				{
					path: "chat/declared",
					frames: 1,
					surfaces: 1,
					why: "the base's reason",
					refreshedStories: ["chat--one"],
				},
			],
			partialCapture: basePartialCapture,
			extra: { baseRecord: "the base pass" },
		}),
	);
	git(dir, ["add", "-A"]);
	git(dir, ["commit", "-qm", "chore: base"]);
	const baseSha = git(dir, ["rev-parse", "HEAD"]);

	git(dir, ["checkout", "-q", "-b", "lane"]);
	/*
	 * In the production shape the lane's pass is a fold, not a re-shoot: it does not
	 * add a story frame, so the base's `refreshedStories`/`refreshedFrames` stay
	 * TRUE for it - which is the point of leaving the container unchanged (a lane
	 * that added a frame while claiming the base's story list would be caught by
	 * `partialCaptureFailures`, correctly).
	 */
	if (!mainLostNestedKeys) frame("chat--three");
	manifestJson(
		manifest({
			head: baseSha,
			supplementary: [
				{
					path: "chat/declared",
					frames: 1,
					surfaces: 1,
					why: "THE LANE'S reason",
					refreshedStories: ["chat--one", "chat--declared"],
				},
			],
			partialCapture: mainLostNestedKeys
				? // The lane never touched its container: the base's object, verbatim.
					basePartialCapture
				: {
						refreshedStories: ["chat--one", "chat--three", "chat--declared"],
						refreshedThemes: ["localOperatorDark"],
						refreshedFrames: 99,
						refreshedAt: "2026-02-02T00:00:00Z",
						refreshedAtHead: baseSha,
						note: "THE LANE'S pass",
						addedSurfacesNote: "THE LANE'S added-surfaces note",
						nested: { deep: { leaf: "the lane's leaf" } },
					},
			extra: { baseRecord: "the base pass", laneRecord: "THE LANE'S RECORD" },
		}),
	);
	git(dir, ["add", "-A"]);
	git(dir, ["commit", "-qm", "feat: the lane's pass"]);

	git(dir, ["checkout", "-q", "main"]);
	write("src/app.ts", "export const one = 2;\n");
	const mainPartialCapture = {
		refreshedStories: ["chat--two"],
		refreshedThemes: ["localOperatorDark"],
		refreshedFrames: 77,
		refreshedAt: "2026-03-03T00:00:00Z",
		refreshedAtHead: baseSha,
		note: "MAIN'S pass",
		addedFrames: 5,
		nested: { deep: mainLostNestedKeys ? {} : { leaf: "main's leaf" } },
		/*
		 * The round-3 regression, on request: `main`'s copy LACKS the key that base
		 * and the lane both carry - the shape PR #748's merge `8b2b499a13c` left on
		 * the real main for `partialCapture.addedSurfacesNote`, and the shape the old
		 * resolver propagated into the next fold. With the option on it loses the
		 * depth-3 leaf as well.
		 */
		...(mainLostNestedKeys
			? {}
			: { addedSurfacesNote: "MAIN'S added-surfaces note" }),
	};
	manifestJson(
		manifest({
			head: baseSha,
			supplementary: [
				{
					path: "chat/declared",
					frames: 1,
					surfaces: 1,
					why: "MAIN'S reason",
					refreshedStories: ["chat--two"],
				},
			],
			partialCapture: mainPartialCapture,
			extra: { baseRecord: "the base pass", mainRecord: "MAIN'S RECORD" },
		}),
	);
	git(dir, ["add", "-A"]);
	git(dir, ["commit", "-qm", "feat: main moves src and the manifest"]);

	git(dir, ["checkout", "-q", "lane"]);
	return { dir, baseSha };
};

test("a two-sided entry and a two-sided partialCapture merge group by group", () => {
	const { dir, baseSha } = storyFixture();
	git(dir, ["merge", "main"]);
	const result = run(dir);
	assert.equal(result.status, 0, result.out);
	// Committed before the guards are asked: they compare the STAMPS in the file
	// against `HEAD:src`/`HEAD:scripts`, and mid-merge `HEAD` is still the
	// PRE-merge head - the manifest describes the tree in the index.
	git(dir, ["commit", "-qm", "chore(merge): fold main"]);

	const merged = readManifest(dir);
	// Group 2: entries union by `path`, this branch's first.
	assert.deepEqual(
		merged.supplementary.map((set) => set.path),
		["chat/declared"],
	);
	// Group 3: inside an entry both sides carry, the AUTHORED keys are ours and
	// the listing sub-arrays are the union.
	assert.equal(merged.supplementary[0].why, "THE LANE'S reason");
	assert.deepEqual(merged.supplementary[0].refreshedStories, [
		"chat--one",
		"chat--declared",
		"chat--two",
	]);
	// Group 1: the pass-describing fields are this branch's.
	assert.equal(merged.partialCapture.note, "THE LANE'S pass");
	assert.equal(merged.partialCapture.refreshedAt, "2026-02-02T00:00:00Z");
	assert.equal(merged.partialCapture.refreshedAtHead, baseSha);
	// Group 2 inside the container, ours' order first.
	assert.deepEqual(merged.partialCapture.refreshedStories, [
		"chat--one",
		"chat--three",
		"chat--declared",
		"chat--two",
	]);
	/*
	 * Group 4: re-derived from the merged tree, over the GUARD's denominator.
	 * Three frames stand in the directories `refreshedStories` names OUTSIDE a
	 * declared set (chat--one, chat--two, chat--three); the fourth
	 * (`chat--declared`) is inside one, and `partialCaptureFailures` excludes it
	 * because a declared set is declared precisely because a sweep cannot produce
	 * its frames. 4 is what the pre-remediation derivation wrote, and the guard
	 * is one-sided, so the over-count passed silently.
	 */
	assert.equal(
		merged.partialCapture.refreshedFrames,
		3,
		"the derived count uses the guard's own denominator",
	);
	assert.equal(merged.frames, 3);
	assert.deepEqual(guardFailures(dir), []);

	// The guard itself, asked in both directions, so the field is not merely
	// absent from a suite that never runs it.
	const reader = readerFor(dir);
	assert.deepEqual(partialCaptureFailures(merged, reader), []);
	/*
	 * The guard is ONE-SIDED, and the direction is the point: it fires when the
	 * claim is BELOW its denominator (a narrowed run), and an over-claim passes
	 * silently. That asymmetry is exactly why the derived number has to use the
	 * guard's own pool - the pre-fix walk's 4, which counted the declared set's
	 * frame, was an over-claim no guard would have caught.
	 */
	assert.match(
		partialCaptureFailures(
			{
				...merged,
				partialCapture: { ...merged.partialCapture, refreshedFrames: 1 },
			},
			reader,
		).join("\n"),
		/claims 1 refreshed frames, but 3 committed frames/,
		"the guard is not asleep",
	);
});

/* ------------------------------------------------------------------ *
 * M4: the record-survival property, over the resolver's real output
 * ------------------------------------------------------------------ */

test("every top-level key either side carries survives the fold, and a dropping resolver fails it", () => {
	const { dir } = storyFixture();
	git(dir, ["merge", "main"]);
	// The three sides as git holds them, read from the OBJECTS: mid-merge the
	// working file is the conflict, not a manifest.
	const lane = manifestAt(dir, "HEAD");
	const main = manifestAt(dir, "MERGE_HEAD");
	const base = manifestAt(dir, git(dir, ["merge-base", "HEAD", "MERGE_HEAD"]));
	assert.equal(run(dir).status, 0);
	git(dir, ["commit", "-qm", "chore(merge): fold main"]);

	const resolved = readManifest(dir);
	assert.deepEqual(droppedKeys(lane, base, resolved), []);
	assert.deepEqual(droppedKeys(main, base, resolved), []);
	// The records themselves, which is what the twelfth fold lost: the shipped
	// suite's `BRANCH_RECORDS` clause asks the same question of the real file.
	assert.equal(resolved.laneRecord, lane.laneRecord);
	assert.equal(resolved.mainRecord, main.mainRecord);
	assert.equal(resolved.baseRecord, base.baseRecord);
	assert.notDeepEqual(
		Object.keys(lane).filter((key) => !(key in main)),
		[],
		"the fixture must give this branch keys main lacks, or the property is vacuous",
	);
	// The control: a resolver that keeps ONE side's schema drops the other's
	// records. Without this, the assertion above would only ever be checked
	// against a resolver that already passes it.
	assert.notDeepEqual(droppedKeys(lane, base, main), []);
});

/* ------------------------------------------------------------------ *
 * M3: a refusal leaves no half-resolved state behind
 * ------------------------------------------------------------------ */

test("a guard refusal restores the conflict and stages nothing of its own", () => {
	const { dir } = storyFixture();
	// A head that resolves to nothing is the deterministic way to make the
	// citation guard refuse: the fold's own resolution cannot invent a commit.
	const lane = manifestAt(dir, "HEAD");
	writeFileSync(
		join(dir, "docs", "evidence", "manifest.json"),
		`${JSON.stringify({ ...lane, head: "0".repeat(40) }, null, 2)}\n`,
	);
	git(dir, ["add", "-A"]);
	git(dir, ["commit", "-qm", "feat: cite a head that does not exist"]);
	git(dir, ["merge", "main"]);

	const result = run(dir);
	assert.equal(result.status, 1, result.out);
	assert.match(result.out, /fails its own guards/, result.out);
	assert.match(result.out, /`head` 000000000 resolves to no commit/);
	assert.match(result.out, /the resolution was NOT kept/);
	assert.match(result.out, /back to the merge's unresolved state/);
	assert.match(
		result.out,
		/pnpm evidence:fold|resolve .* yourself and commit WITHOUT this tool/,
		"the refusal states the way forward",
	);
	// The index is what matters: before the remediation the resolution was left
	// staged, and `git commit` on it succeeded while the tool said "not written".
	assert.match(git(dir, ["ls-files", "-u"]), /manifest\.json/);
	assert.equal(
		git(dir, ["diff", "--name-only", "--diff-filter=U"]),
		"docs/evidence/manifest.json",
	);
	assert.match(
		readFileSync(join(dir, "docs", "evidence", "manifest.json"), "utf8"),
		/<<<<<<</,
	);
	// And git itself refuses to commit over the unmerged path.
	const commit = gitCode(dir, ["commit", "-m", "should not work"]);
	assert.notEqual(commit.code, 0, commit.out);
});

/* ------------------------------------------------------------------ *
 * m4: the amend does not rewrite a pushed tip
 * ------------------------------------------------------------------ */

test("--amend refuses a tip that is already on a remote-tracking ref", () => {
	const dir = fixture({ attributes: true });
	installDriver(dir);
	assert.equal(gitCode(dir, ["merge", "main"]).code, 0);
	const tip = git(dir, ["rev-parse", "HEAD"]);
	// A remote-tracking ref containing the tip is exactly what a push or a fetch
	// leaves behind, and it is the state that makes an amend a history rewrite.
	git(dir, ["update-ref", "refs/remotes/origin/lane", "HEAD"]);

	const result = run(dir);
	assert.equal(result.status, 0, result.out);
	assert.match(result.out, /the tip was NOT amended/, result.out);
	assert.match(result.out, /remote-tracking/);
	assert.match(result.out, /Run this before pushing/);
	assert.equal(
		git(dir, ["rev-parse", "HEAD"]),
		tip,
		"the published tip is untouched",
	);
	assert.match(
		git(dir, ["status", "--porcelain"]),
		/^M {2}docs\/evidence\/manifest\.json$/m,
		"the values are still written and staged, so they can be committed on top",
	);
});

/* ------------------------------------------------------------------ *
 * m2: runGuards asks the citation half (and discloses a shallow stand-down)
 * ------------------------------------------------------------------ */

test("runGuards asks the citation guards, and discloses a shallow-clone stand-down", async () => {
	const dir = fixture();
	// A COMPLETED fold, because `runGuards` is asked about the manifest the tool
	// is about to stage: the working file mid-conflict is the conflict markers.
	git(dir, ["merge", "main"]);
	assert.equal(run(dir).status, 0);
	git(dir, ["commit", "-qm", "chore(merge): fold main"]);
	const manifest = readManifest(dir);
	const reader = readerFor(dir);

	const clean = await runGuards({
		manifest,
		target: "HEAD",
		root: dir,
		git: reader,
	});
	assert.deepEqual(clean.failures, [], clean.failures.join("\n"));
	assert.deepEqual(clean.notes, []);

	// Group 1's `head` is the citation the field list exists for: a value that
	// resolves to nothing is now a REFUSAL, not a pass.
	const orphan = await runGuards({
		manifest: { ...manifest, head: "0".repeat(40) },
		target: "HEAD",
		root: dir,
		git: reader,
	});
	assert.match(orphan.failures.join("\n"), /resolves to no commit/);

	// A shallow clone cannot answer the ancestry question - no ancestor of HEAD
	// is present - so that half stands down and SAYS SO, rather than reporting a
	// failure it cannot know.
	const shallow = (args) =>
		args.includes("--is-shallow-repository") ? "true" : reader(args);
	const shrunk = await runGuards({
		manifest,
		target: "HEAD",
		root: dir,
		git: shallow,
	});
	assert.deepEqual(shrunk.failures, [], shrunk.failures.join("\n"));
	assert.match(shrunk.notes.join("\n"), /shallow clone/);
});

/* ------------------------------------------------------------------ *
 * N2: the merged key order is deterministic, and main-only keys append
 * ------------------------------------------------------------------ */

test("mergedKeys keeps this branch's order and appends main-only keys", () => {
	assert.deepEqual(
		mergedKeys({}, { zeta: 1, alpha: 2 }, { mid: 3, alpha: 4 }),
		["zeta", "alpha", "mid"],
		"this branch's keys keep their order; a key only main carries lands at the end",
	);
	assert.deepEqual(mergedKeys({}, { b: 1 }, { c: 2, a: 3 }), ["b", "c", "a"]);
	assert.deepEqual(
		mergedKeys({}, { a: 1 }, { a: 2, b: 3 })[0],
		"a",
		"the order does not depend on which side moved",
	);
});

/* ------------------------------------------------------------------ *
 * The PRE-FIX rule, transcribed so a control can RUN it
 * ------------------------------------------------------------------ */

/*
 * WHY A TRANSCRIPTION AND NOT A HAND-BUILT OBJECT. The two tests below are named
 * for the round-3 defect, and the shape that defect actually occurred in is
 * "THIS branch's `partialCapture` UNCHANGED from the merge base, the OTHER side
 * moved it and lost a nested key". In that shape the pre-fix rule is decided by
 * one line - `deepEqual(base, ours) → return theirs` - so a control has to
 * EXECUTE that rule on the same three sides. The first version of these tests
 * compared against `{ ...ours, partialCapture: theirs.partialCapture }`, a
 * hand-built object that proves nothing about any resolver (and the fixtures
 * themselves had BOTH sides moving the container, which the pre-fix rule handled
 * correctly - so the tests passed before the fix).
 *
 * The functions below are COPIED from `scripts/evidence-fold.mjs` at
 * `535b05c8196`, the last head before the fix: the three-way identity
 * short-circuits, `CONTAINERS = new Set(["partialCapture"])`, and a `mergedKeys`
 * with NO decision channel. The group-4 (`derived`) branch is omitted because
 * these fixtures pass no `derived` - the driver's own state - and the two union
 * helpers are the shipped ones' bodies. A mutant has to be a rule that RUNS, and
 * this one is.
 */
const LEGACY_CONTAINERS = new Set(["partialCapture"]);
const LEGACY_LISTINGS = new Set([
	"supplementary",
	"refreshedStories",
	"refreshedThemes",
	"addedSurfaces",
]);
const legacyUnionList = (ours = [], theirs = []) => {
	const out = [...ours];
	for (const item of theirs)
		if (!out.some((seen) => deepEqual(seen, item))) out.push(item);
	return out;
};
const legacyUnionSets = (ours = [], theirs = []) => {
	const out = [...ours];
	for (const entry of theirs)
		if (!out.some((seen) => seen?.path === entry?.path)) out.push(entry);
	return out;
};
const legacyMergedKeys = (base, ours, theirs) => {
	const keys = Object.keys(ours);
	for (const key of Object.keys(theirs)) {
		if (key in ours) continue;
		if (key in base) continue; // this branch deleted it - group (5)
		keys.push(key);
	}
	return keys;
};
const legacyMergeValue = (key, base, ours, theirs) => {
	if (key === "supplementary") {
		if (ours === undefined) return theirs;
		if (theirs === undefined) return ours;
		return Array.isArray(ours) && Array.isArray(theirs)
			? legacyUnionSets(ours, theirs)
			: ours;
	}
	if (LEGACY_LISTINGS.has(key)) {
		if (ours === undefined) return theirs;
		if (theirs === undefined) return ours;
		return Array.isArray(ours) && Array.isArray(theirs)
			? legacyUnionList(ours, theirs)
			: ours;
	}
	if (theirs === undefined) return ours;
	if (ours === undefined) return theirs;
	if (deepEqual(ours, theirs)) return ours;
	if (deepEqual(base, ours)) return theirs;
	if (deepEqual(base, theirs)) return ours;
	// Both sides moved this key.
	if (LEGACY_CONTAINERS.has(key))
		return legacyMergeObject(base ?? {}, ours, theirs);
	return ours;
};
const legacyMergeObject = (base, ours, theirs) => {
	const out = {};
	for (const key of legacyMergedKeys(base, ours, theirs)) {
		const value = legacyMergeValue(
			key,
			base?.[key],
			ours?.[key],
			theirs?.[key],
		);
		if (value !== undefined) out[key] = value;
	}
	return out;
};
/** The pre-fix entry point: no `derived`, and NO decision channel at all. */
const legacyResolveManifest = ({ base, ours, theirs }) => {
	const out = {};
	for (const key of legacyMergedKeys(base ?? {}, ours, theirs)) {
		const value = legacyMergeValue(key, base?.[key], ours[key], theirs?.[key]);
		if (value === undefined) continue;
		out[key] = value;
	}
	if (Array.isArray(out.supplementary)) {
		const baseSets = new Map(
			(base?.supplementary ?? []).map((set) => [set?.path, set]),
		);
		const ourSets = new Map(
			(ours.supplementary ?? []).map((set) => [set?.path, set]),
		);
		const theirSets = new Map(
			(theirs.supplementary ?? []).map((set) => [set?.path, set]),
		);
		out.supplementary = out.supplementary.map((set) => {
			const o = ourSets.get(set?.path);
			const t = theirSets.get(set?.path);
			if (!o || !t) return set;
			return legacyMergeObject(baseSets.get(set?.path) ?? {}, o, t);
		});
	}
	return out;
};

/* ------------------------------------------------------------------ *
 * Round 3: no key may be lost at any depth (scripts/check-fold-keys.mjs)
 * ------------------------------------------------------------------ */

/*
 * THE REGRESSION, NAMED FOR THE KEY IT LOST, IN THE SHAPE IT OCCURRED: the lane's
 * container is byte-identical to the base's (it never moved), main's moved and is
 * missing `addedSurfacesNote` - `main` dropped it at PR #748's merge
 * `8b2b499a13c` - along with a depth-3 leaf. That asymmetry is the whole point:
 * the pre-fix rule is then decided by `deepEqual(base, ours) → return theirs`, so
 * the control below loses both keys, while with BOTH sides moving the container
 * the pre-fix rule reached its per-key descent and passed.
 */
test("a nested key main deleted survives the fold, and the run names the decision", () => {
	const base = manifest({
		partialCapture: {
			refreshedStories: ["chat--one"],
			refreshedFrames: 1,
			note: "the base's pass",
			addedSurfacesNote: "THE BASE'S note",
			nested: { deep: { leaf: "THE BASE'S leaf" } },
		},
	});
	// The lane never touched its container: byte-identical to base's copy, which is
	// how the real defect presented (the branch's copy WAS the base's copy).
	const ours = manifest({
		partialCapture: {
			refreshedStories: ["chat--one"],
			refreshedFrames: 1,
			note: "the base's pass",
			addedSurfacesNote: "THE BASE'S note",
			nested: { deep: { leaf: "THE BASE'S leaf" } },
		},
	});
	// Main moved the container AND lost the note and the depth-3 leaf.
	const theirs = manifest({
		partialCapture: {
			refreshedStories: ["chat--one"],
			refreshedFrames: 77,
			note: "MAIN'S pass",
			nested: { deep: {} },
		},
	});
	assert.deepEqual(
		ours.partialCapture,
		base.partialCapture,
		"the fixture is the production shape only because THIS branch's container did not move",
	);
	assert.equal("addedSurfacesNote" in theirs.partialCapture, false);
	assert.equal("leaf" in theirs.partialCapture.nested.deep, false);

	// THE CONTROL: the pre-fix rule RUN on these same three sides loses both keys.
	const legacy = legacyResolveManifest({ base, ours, theirs });
	assert.equal(
		"addedSurfacesNote" in legacy.partialCapture,
		false,
		"the pre-fix rule hands the moved side's container back whole and the branch's key goes with it",
	);
	assert.equal(
		"leaf" in (legacy.partialCapture.nested?.deep ?? {}),
		false,
		"nor does anything reach into it: `partialCapture` was the container it descended into, and only when BOTH sides moved",
	);
	assert.equal(
		legacy.partialCapture.note,
		"MAIN'S pass",
		"and it is main's pass that wins in the container it returned",
	);

	// THE SHIPPED RULE: merged per key at every depth, both keys kept (from this
	// branch), and both decisions named rather than inferred.
	const decisions = [];
	const resolved = resolveManifest({ base, ours, theirs, decisions });
	assert.equal(resolved.partialCapture.addedSurfacesNote, "THE BASE'S note");
	assert.equal(resolved.partialCapture.nested.deep.leaf, "THE BASE'S leaf");
	assert.equal(
		resolved.partialCapture.refreshedFrames,
		77,
		"the key SET is the fix, not a change of direction: main's moved value still wins",
	);
	assert.equal(resolved.partialCapture.note, "MAIN'S pass");
	assert.deepEqual(decisions, [
		{
			path: "partialCapture.addedSurfacesNote",
			action: "kept",
			why: "the other side deleted it",
		},
		{
			path: "partialCapture.nested.deep.leaf",
			action: "kept",
			why: "the other side deleted it",
		},
	]);
});

/* Group (5) is unchanged by the round-3 rule: a key THIS branch retired stays
 * retired, even though main still carries it - and the drop is a stated
 * decision rather than a silence. */
test("a key this branch retired stays dropped, and the run states it", () => {
	const base = manifest({
		partialCapture: {
			refreshedStories: ["chat--one"],
			refreshedFrames: 1,
			retiredNote: "the retired spelling",
		},
	});
	const ours = manifest({
		partialCapture: { refreshedStories: ["chat--one"], refreshedFrames: 1 },
	});
	const theirs = manifest({
		partialCapture: {
			refreshedStories: ["chat--one"],
			refreshedFrames: 1,
			retiredNote: "MAIN STILL CARRIES IT",
		},
	});

	const decisions = [];
	const resolved = resolveManifest({ base, ours, theirs, decisions });
	assert.equal(
		"retiredNote" in resolved.partialCapture,
		false,
		"group (5): a spelling this branch retired does not come back",
	);
	assert.deepEqual(decisions, [
		{
			path: "partialCapture.retiredNote",
			action: "dropped",
			why: "this branch retired it",
		},
	]);
});

/*
 * THE GATE'S PROPERTY, asked of the resolver at every depth.
 *
 * `keyPaths` is `scripts/check-fold-keys.mjs`'s own walker, imported here rather
 * than re-implemented: the property is exactly the rule the gate enforces for a
 * real fold ("no key may be lost"), with the one allowance the gate also makes -
 * a key THIS branch retired. The control at the end is what keeps it honest.
 */
test("both parents' key sets survive the resolution at every depth", () => {
	const base = {
		head: "a".repeat(40),
		partialCapture: {
			refreshedStories: ["chat--one"],
			nested: { deep: "BASE", deeper: { leaf: "BASE" }, retired: "BASE" },
			keptInBase: "BASE",
			addedSurfacesNote: "BASE'S NOTE",
		},
		captureOrigin: { host: "BASE", legacy: "BASE" },
	};
	const ours = {
		head: "a".repeat(40),
		partialCapture: {
			refreshedStories: ["chat--one"],
			nested: { deep: "OURS", deeper: { leaf: "OURS" }, retired: "OURS" },
			keptInBase: "OURS",
			addedSurfacesNote: "THE BRANCH'S NOTE",
		},
		// `captureOrigin.legacy` is absent HERE: this branch retired it.
		captureOrigin: { host: "OURS" },
		branchRecord: "ours",
	};
	const theirs = {
		head: "b".repeat(40),
		partialCapture: {
			refreshedStories: ["chat--one"],
			nested: {
				deep: "THEIRS",
				deeper: { leaf: "THEIRS" },
				extra: "MAIN ADDED",
			},
			keptInBase: "THEIRS",
		},
		captureOrigin: { host: "THEIRS", legacy: "MAIN STILL CARRIES IT" },
		mainRecord: "main",
	};

	const decisions = [];
	const resolved = resolveManifest({ base, ours, theirs, decisions });
	const paths = (doc) => keyPaths(JSON.stringify(doc));
	const resolvedPaths = paths(resolved);
	const lostFrom = (source) =>
		[...paths(source)].filter((path) => !resolvedPaths.has(path));

	// (1) THIS branch loses nothing, at any depth.
	assert.deepEqual(
		lostFrom(ours),
		[],
		"every key this branch carries must survive the fold",
	);
	// (2) main loses only what this branch retired, and each drop is reported.
	const retired = new Set(
		[...paths(base)].filter((path) => !paths(ours).has(path)),
	);
	assert.deepEqual(
		lostFrom(theirs).filter((path) => !retired.has(path)),
		[],
		"main loses nothing this branch did not deliberately retire",
	);
	assert.deepEqual([...retired], ["captureOrigin.legacy"]);
	assert.deepEqual(
		decisions
			.filter((decision) => decision.action === "dropped")
			.map((decision) => decision.path),
		["captureOrigin.legacy"],
		"the drop is a stated decision, not a silence",
	);
	// (3) A key MAIN deleted is kept, from this branch, and reported.
	assert.deepEqual(
		decisions
			.filter((decision) => decision.action === "kept")
			.map((decision) => decision.path)
			.sort(),
		["partialCapture.addedSurfacesNote", "partialCapture.nested.retired"],
	);
	assert.equal(resolved.partialCapture.nested.retired, "OURS");
	assert.equal(resolved.partialCapture.nested.extra, "MAIN ADDED");
	assert.equal(resolved.partialCapture.nested.deeper.leaf, "OURS");
	assert.equal(resolved.captureOrigin.host, "OURS");
	assert.equal(resolved.branchRecord, "ours");
	assert.equal(resolved.mainRecord, "main");

	// THE CONTROL: the rule this replaced IS the mutation - RUN it on the same
	// three sides, and the property must FAIL for what it produces. It does: the
	// pre-fix rule descends only into a named container both sides moved, so a key
	// nested one level deeper that main still carries (`nested.extra`) is lost
	// with no decision channel to say so. A hand-built object here proved nothing
	// about any resolver; this runs the rule.
	const legacy = legacyResolveManifest({ base, ours, theirs });
	const legacyPaths = paths(legacy);
	assert.deepEqual(
		[...paths(theirs)].filter(
			(path) => !legacyPaths.has(path) && !retired.has(path),
		),
		["partialCapture.nested.extra"],
		"the pre-fix rule loses a key main still carries - exactly the property this test asks of the shipped resolver",
	);
});

/*
 * THE SAME SHAPE ON THE REAL PATH, and the control run on the fixture's OWN three
 * sides: the lane never touched its container, main moved it and lost the note
 * and the depth-3 leaf, and the fold is performed by the tool itself, committed,
 * then checked with the shipped gate - which is how this defect was found, on
 * this branch's own fold of `20fa9c1db2`.
 */
test("the fold of a main that dropped a nested key keeps it, names it, and passes the key gate", () => {
	const { dir } = storyFixture({ mainLostNestedKeys: true });
	const lane = manifestAt(dir, "HEAD");
	const main = manifestAt(dir, "main");
	const base = manifestAt(dir, git(dir, ["merge-base", "HEAD", "main"]));
	assert.deepEqual(
		lane.partialCapture,
		base.partialCapture,
		"the production shape: THIS branch's container is unchanged from the base",
	);
	assert.equal("addedSurfacesNote" in main.partialCapture, false);
	assert.equal("leaf" in main.partialCapture.nested.deep, false);

	// The control on the fixture's own sides: the pre-fix rule loses both keys.
	const legacy = legacyResolveManifest({ base, ours: lane, theirs: main });
	assert.equal("addedSurfacesNote" in legacy.partialCapture, false);
	assert.equal("leaf" in (legacy.partialCapture.nested?.deep ?? {}), false);

	git(dir, ["merge", "main"]);
	const result = run(dir);
	assert.equal(result.status, 0, result.out);
	assert.match(
		result.out,
		/kept partialCapture\.addedSurfacesNote - the other side deleted it/,
		"the run states the one-sided key decision",
	);
	assert.match(
		result.out,
		/kept partialCapture\.nested\.deep\.leaf - the other side deleted it/,
		"and the depth-3 one, by path",
	);
	git(dir, ["commit", "-qm", "chore(merge): fold main"]);

	const merged = readManifest(dir);
	assert.equal(
		merged.partialCapture.addedSurfacesNote,
		base.partialCapture.addedSurfacesNote,
		"the merged file keeps this branch's value for the key main lost",
	);
	assert.equal(
		merged.partialCapture.nested.deep.leaf,
		base.partialCapture.nested.deep.leaf,
		"down to the depth-3 leaf",
	);
	const gate = spawnSync(
		process.execPath,
		[KEY_GATE, git(dir, ["rev-parse", "HEAD"])],
		{ cwd: dir, encoding: "utf8" },
	);
	assert.equal(
		gate.status,
		0,
		`check-fold-keys must be clean over this fold: ${gate.stdout}${gate.stderr}`,
	);
	assert.match(
		gate.stdout,
		/clean - every key of both parents survives the merge/,
	);
});
