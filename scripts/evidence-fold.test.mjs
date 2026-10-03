import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
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
	RETIRED_TOP_LEVEL_FIELDS,
	deepEqual,
	deriveFields,
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
	/*
	 * `srcOnly` is the shape the whole change exists for: main moves `src/` and
	 * NOTHING the manifest reads - no new story, no new frame, no change to
	 * `capture-evidence.mjs`'s literals - so every count the manifest states is
	 * unchanged and the fold must write NOTHING. Before the tree stamps were
	 * retired this fixture could not exist: `srcTree` moved on every `src/`
	 * commit, so the fold always had a reason to rewrite the file.
	 */
	srcOnly = false,
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
	if (!srcOnly) {
		write(
			"scripts/capture-evidence.mjs",
			capture(["chat--one", "chat--two", "chat--three"]),
		);
		frame("docs/evidence/chat--three/localOperatorDark.webp");
	}
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

	/*
	 * THE RETIRED PAIR IS ABSENT, and its absence is the property: a stored hash of
	 * the shipping tree cannot be kept true (any sibling commit moves it), so no
	 * fold may put one back - which is exactly what a branch whose own old fold
	 * tool re-derived it would otherwise do.
	 */
	assert.ok(
		!("srcTree" in m) && !("scriptsTree" in m),
		"a fold must not carry the retired tree stamps into the merged file",
	);
	// The counts name the MERGED tree, which is what `git write-tree` answers
	// mid-merge - not the lane's pre-merge tree, whose STORIES literal has two
	// rows rather than the three the merged one has.
	const staged = git(dir, ["write-tree"]);
	assert.equal(
		git(dir, ["show", `${staged}:scripts/capture-evidence.mjs`]).includes(
			"chat--three",
		),
		true,
	);
	assert.equal(
		git(dir, ["show", "HEAD:scripts/capture-evidence.mjs"]).includes(
			"chat--three",
		),
		false,
		"the pre-merge head's literal is NOT the one the count came from",
	);

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
		/The COUNTS still describe the PRE-merge tree/,
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

test("outside a merge, a commit that moves only `src/` leaves the manifest alone", () => {
	const dir = fixture();
	/*
	 * THE SHAPE THE WHOLE CHANGE EXISTS FOR (test T1). A real content commit that
	 * moves `src/` and nothing the manifest reads: no new story, no new frame, no
	 * edit to `capture-evidence.mjs`'s literals. Before the tree stamps were
	 * retired this was impossible - `srcTree` moved on every `src/` commit - so
	 * every open branch owed a re-derive here. Now the readings are identical and
	 * the tool must write NOTHING.
	 *
	 * The fixture's copy starts with synthetic counts (its `partialCapture` is a
	 * stand-in, not this tree's walk), so the first run legitimately re-derives
	 * them; that run is committed as the branch's own fold would be, and the
	 * `src/`-only commit after it is the case under test.
	 */
	const first = run(dir);
	assert.equal(first.status, 0, first.out);
	git(dir, ["commit", "-qm", "docs(evidence): re-derive the counts"]);

	const beforeManifest = readFileSync(
		join(dir, "docs", "evidence", "manifest.json"),
		"utf8",
	);
	writeFileSync(join(dir, "src", "app.ts"), "export const one = 9;\n");
	git(dir, ["add", "-A"]);
	git(dir, ["commit", "-qm", "feat: move src"]);
	const contentHead = git(dir, ["rev-parse", "HEAD"]);

	const result = run(dir);
	assert.equal(result.status, 0, result.out);
	assert.match(
		result.out,
		/already describes this tree/,
		"a run with nothing to re-derive says so rather than writing",
	);
	assert.equal(
		git(dir, ["diff", "--cached", "--name-only"]),
		null,
		"nothing is staged when no reading moved",
	);
	assert.equal(
		readFileSync(join(dir, "docs", "evidence", "manifest.json"), "utf8"),
		beforeManifest,
		"the manifest's bytes are untouched",
	);
	assert.equal(
		git(dir, ["rev-parse", "HEAD"]),
		contentHead,
		"no commit was made for the author",
	);
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
	/*
	 * The counts are the guard's teeth now that the pair is retired, so these are
	 * the mutations that must still bite (test T5): an over-eager deletion of the
	 * counts half would look green without them.
	 */
	for (const [field, value] of [
		["frames", 999],
		["surfaces", 999],
		["themes", 999],
	]) {
		const mutated = { ...good, [field]: value };
		writeFileSync(
			join(dir, "docs", "evidence", "manifest.json"),
			`${JSON.stringify(mutated, null, 2)}\n`,
		);
		assert.equal(
			stampFailures(mutated, readerFor(dir), join(dir, "docs", "evidence"))
				.length >= 1,
			true,
			`a mutated \`${field}\` must fail the guard the tool validates against`,
		);
	}
	// And no stored stamp can put the retired pair back in force: a manifest that
	// carries a WRONG pair passes, because nothing reads it any more.
	assert.deepEqual(
		stampFailures(
			{ ...good, srcTree: "0".repeat(40), scriptsTree: "0".repeat(40) },
			readerFor(dir),
			join(dir, "docs", "evidence"),
		),
		[],
		"the retired pair is indifferent to the guard, which is what stops a stray copy gating again",
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
 * driver therefore resolves only when it can SEE a real merge - merge.c's
 * `GITHEAD_<oid>` / `GIT_REFLOG_ACTION`, or `MERGE_HEAD` on a git that writes it
 * early - and otherwise exits non-zero with the case named, which is what makes
 * git stop on the conflict exactly as it did before this PR added the driver at
 * all. Every non-zero exit also appends its reason to
 * `<git dir>/evidence-fold-driver.log`, because git's own output names no cause.
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
 * M2b: the driver's non-zero paths - stated, recorded, and never taken
 *      on a legitimate merge
 * ------------------------------------------------------------------ */

/**
 * Install a driver command that hides the merge-only environment from the real
 * driver, so the case can be exercised at all.
 *
 * WHY A WRAPPER, AND WHY NODE. `builtin/merge.c` sets `GITHEAD_<oid>` and
 * `GIT_REFLOG_ACTION` on the environment git hands its merge down, so a caller
 * cannot remove them from `git merge` - the only place they can be taken away is
 * between git and this script, which is where a harness wrapper sits. The
 * wrapper is Node so the case behaves identically wherever the suite runs, and
 * it re-execs the real script with the hidden names deleted rather than
 * reimplementing any of it.
 */
const driverHidingMergeSignals = (dir, extraHidden = []) => {
	const wrapper = join(dir, "driver-hides-signals.mjs");
	const hidden = [...extraHidden].filter(Boolean);
	writeFileSync(
		wrapper,
		[
			'import { spawnSync } from "node:child_process";',
			"const env = { ...process.env };",
			`for (const name of ${JSON.stringify(hidden)}) delete env[name];`,
			"for (const name of Object.keys(env))",
			'\tif (name.startsWith("GITHEAD_")) delete env[name];',
			"const result = spawnSync(",
			"\tprocess.execPath,",
			"\t[process.argv[2], ...process.argv.slice(3)],",
			'\t{ stdio: "inherit", env },',
			");",
			"process.exit(result.status ?? 1);",
		].join("\n"),
	);
	git(dir, [
		"config",
		"merge.evidence-fold.driver",
		`${process.execPath} ${wrapper} ${SCRIPT} --driver %O %A %B`,
	]);
	return wrapper;
};

/**
 * Install a driver command that forwards to the real driver with `%B` replaced
 * by a path that does not exist.
 *
 * WHY A WRAPPER. git itself always hands a driver three EXISTING temp files, so
 * a side whose PATH IS ABSENT cannot be produced by a plain `git merge`: it is
 * the shape a hand-written or older driver command produces, and it is one of
 * the two ways `readSide` throws. The wrapper forwards with the merge-only
 * environment intact - so the run is a legitimate merge and reaches `readSide` -
 * and only the third path is spoofed.
 */
const driverWithAnAbsentSide = (dir) => {
	const wrapper = join(dir, "driver-absent-side.mjs");
	writeFileSync(
		wrapper,
		[
			'import { spawnSync } from "node:child_process";',
			"const [, , script, base, ours, theirs] = process.argv;",
			"const result = spawnSync(",
			"\tprocess.execPath,",
			'\t[script, "--driver", base, ours, `${theirs}.absent`],',
			'\t{ stdio: "inherit", env: process.env },',
			");",
			"process.exit(result.status ?? 1);",
		].join("\n"),
	);
	git(dir, [
		"config",
		"merge.evidence-fold.driver",
		`${process.execPath} ${wrapper} ${SCRIPT} %O %A %B`,
	]);
	return wrapper;
};

/**
 * Rewrite one revision's manifest to something that is NOT JSON - the shape a
 * half-written file has - and return the fixture to `lane`.
 */
const truncateTheManifestOn = (dir, rev) => {
	git(dir, ["checkout", "-q", rev]);
	writeFileSync(
		join(dir, "docs/evidence/manifest.json"),
		'{\n  "head": "0000000000000000000000000000000000000000",\n  "frames": 2,',
	);
	git(dir, ["add", "-A"]);
	git(dir, ["commit", "-qm", `feat: ${rev} truncates the manifest`]);
	git(dir, ["checkout", "-q", "lane"]);
};

/** The driver log a refused run leaves in the clone, wherever its git dir is. */
const driverLog = (dir) => {
	const gitDir = git(dir, ["rev-parse", "--absolute-git-dir"]);
	return {
		path: join(gitDir, "evidence-fold-driver.log"),
		text: readFileSync(join(gitDir, "evidence-fold-driver.log"), "utf8"),
	};
};

test("a refused driver run names the case it could not handle, and records it in the git dir", () => {
	const dir = fixture({ attributes: true });
	installDriver(dir);

	const rebase = gitCode(dir, ["rebase", "main"]);
	assert.notEqual(rebase.code, 0, "the driver must refuse, so git stops");
	assert.match(
		rebase.out,
		/REFUSING to resolve docs\/evidence\/manifest\.json during rebase/,
		"the message must name the case (a rebase), not just that it failed",
	);
	assert.match(
		rebase.out,
		/this reason is recorded at .*evidence-fold-driver\.log/,
		"the message must say where the durable record is",
	);

	const log = driverLog(dir);
	assert.match(
		log.text,
		/REFUSING to resolve docs\/evidence\/manifest\.json during rebase/,
		"the log carries the same reason git's output buried",
	);
	assert.match(
		log.text,
		/merge\.evidence-fold\.driver/,
		"the log names the driver command that produced it",
	);

	// A second refusal APPENDS: the log is a record of runs, not a last-write-wins
	// file, so two failures are two entries the author can tell apart.
	gitCode(dir, ["rebase", "--abort"]);
	const again = gitCode(dir, ["cherry-pick", "main"]);
	assert.notEqual(again.code, 0, "a cherry-pick is refused too");
	assert.match(
		again.out,
		/REFUSING .* during an operation that is not a merge/,
		"the case git records no marker for must be named as such, not guessed at",
	);
	const appended = driverLog(dir).text;
	assert.match(appended, /cherry-pick|not a merge/);
	assert.ok(
		appended.length > log.text.length,
		"the second refusal must be appended to the first, not replace it",
	);
});

test("a legitimate merge is NOT refused when the driver's environment lacks GITHEAD_*", () => {
	const dir = fixture({ attributes: true });
	driverHidingMergeSignals(dir);

	const merge = gitCode(dir, [
		"merge",
		"main",
		"-m",
		"chore(merge): fold main",
	]);
	assert.equal(
		merge.code,
		0,
		`a real merge must still be resolved when only GITHEAD_* is missing: ${merge.out}`,
	);
	assert.match(
		merge.out,
		/resolved docs\/evidence\/manifest\.json mechanically/,
		"the driver, not git's text merge, must have produced the merge",
	);
});

test("with EVERY merge signal hidden the driver refuses rather than guess a side", () => {
	/*
	 * The boundary this fix does NOT cross, pinned so it cannot drift into a
	 * silent wrong-side resolution. `GITHEAD_<oid>` and `GIT_REFLOG_ACTION` are
	 * set together by `builtin/merge.c` for a real merge and by nothing else, and
	 * git leaves a single-commit cherry-pick, a revert and a merge identical on
	 * disk while the driver runs (no marker file, no `MERGE_HEAD`). So when a
	 * wrapper hides BOTH, the run is genuinely indistinguishable from a replay:
	 * refusing - with the reason stated and recorded - is the only safe answer,
	 * and `pnpm evidence:fold` resolves the file afterwards either way.
	 */
	const dir = fixture({ attributes: true });
	driverHidingMergeSignals(dir, ["GIT_REFLOG_ACTION"]);

	const merge = gitCode(dir, ["merge", "main"]);
	assert.notEqual(merge.code, 0, "it must refuse rather than resolve");
	assert.match(
		merge.out,
		/REFUSING .* during an operation that is not a merge/,
	);
	assert.match(
		merge.out,
		/this reason is recorded at .*evidence-fold-driver\.log/,
		"the refusal must point at the durable record",
	);
	assert.match(driverLog(dir).text, /REFUSING/, "and it is recorded");
});

test("a refused driver run never leaves the working file looking like a resolved one", () => {
	/*
	 * THE DESTRUCTIVE SHAPE THIS GUARDS AGAINST. When a merge driver exits without
	 * writing, git keeps the conflict in the index but leaves the WORKING file
	 * holding `%A` verbatim - one side's copy, with no markers - which reads as a
	 * resolution to whoever opens it next (measured on git 2.55.0). The refusal
	 * path therefore writes git's markers back itself.
	 */
	const dir = fixture({ attributes: true });
	installDriver(dir);

	const rejected = gitCode(dir, ["rebase", "main"]);
	assert.notEqual(rejected.code, 0, rejected.out);
	const conflicted = readFileSync(
		join(dir, "docs/evidence/manifest.json"),
		"utf8",
	);
	assert.match(
		conflicted,
		/^<<<<<<< /m,
		"the refusal must leave conflict markers in the working file",
	);
	assert.match(conflicted, /^>>>>>>> /m);
	assert.match(
		conflicted,
		/not this branch|upstream side|being replayed/,
		"the markers must say which side git gave as %A, rather than implying it is this branch",
	);
});

test("a driver run whose side is not JSON is refused, and still leaves the working file unresolved", () => {
	/*
	 * THE POST-MERGE MAJOR ON #804, PINNED. A refusal that arrives as a THROW -
	 * here, a side `readSide` cannot parse - used to escape the refusal path
	 * entirely: the run exited non-zero and git marked the conflict, but the
	 * WORKING file kept `%A` verbatim with no markers, so `cat` showed one side's
	 * copy and `git add && git commit` would have staged the wrong side silently.
	 * The refusal path writes markers; the throw path must too.
	 */
	const dir = fixture({ attributes: true });
	installDriver(dir);
	truncateTheManifestOn(dir, "main");

	const merge = gitCode(dir, [
		"merge",
		"main",
		"-m",
		"chore(merge): fold main",
	]);
	assert.notEqual(merge.code, 0, merge.out);
	assert.match(
		merge.out,
		/REFUSING to resolve docs\/evidence\/manifest\.json/,
		"the throw must be routed through the same refusal the refuse paths use",
	);
	assert.match(
		merge.out,
		/is not JSON/,
		"and it must name the case it could not handle",
	);

	const conflicted = readFileSync(
		join(dir, "docs/evidence/manifest.json"),
		"utf8",
	);
	assert.match(
		conflicted,
		/^<<<<<<< /m,
		"a throw must leave conflict markers, not one side's copy verbatim",
	);
	assert.match(conflicted, /^>>>>>>> /m);
	assert.equal(
		(git(dir, ["ls-files", "-u"]) ?? "").split("\n").filter(Boolean).length,
		3,
		"the index must stay unmerged, so `git commit` refuses",
	);
	assert.match(driverLog(dir).text, /REFUSING/);
	assert.match(driverLog(dir).text, /not JSON/);
});

test("a driver run handed an absent side path is refused, and the working file still reads unresolved", () => {
	const dir = fixture({ attributes: true });
	driverWithAnAbsentSide(dir);

	const merge = gitCode(dir, [
		"merge",
		"main",
		"-m",
		"chore(merge): fold main",
	]);
	assert.notEqual(merge.code, 0, merge.out);
	assert.match(merge.out, /REFUSING to resolve docs\/evidence\/manifest\.json/);
	assert.match(merge.out, /does not exist/);

	const conflicted = readFileSync(
		join(dir, "docs/evidence/manifest.json"),
		"utf8",
	);
	assert.match(
		conflicted,
		/^<<<<<<< /m,
		"an absent side must not leave %A looking resolved either",
	);
	assert.match(conflicted, /^>>>>>>> /m);
	assert.match(
		conflicted,
		/could not be read/,
		"the missing side is named in the file rather than left as a silent gap",
	);
	assert.equal(
		(git(dir, ["ls-files", "-u"]) ?? "").split("\n").filter(Boolean).length,
		3,
	);
	assert.match(driverLog(dir).text, /REFUSING/);
});

/* ------------------------------------------------------------------ *
 * M2c: the fold path is install-free, and writes one file
 * ------------------------------------------------------------------ */

test("the fold path cannot reach a package manager: no dependency, no pre-run install", () => {
	const scripts = dirname(SCRIPT);
	const repoRoot = resolve(scripts, "..");

	/*
	 * STATIC, because the property is about what the tool CAN do. A behavioural
	 * case can only show that one run happened not to install; this pins each
	 * mechanism that would let a future edit reintroduce one.
	 */
	const workspace = readFileSync(join(repoRoot, "pnpm-workspace.yaml"), "utf8");
	assert.match(
		workspace,
		/^verifyDepsBeforeRun:\s*false\s*$/m,
		"pnpm 11+ must not auto-install before a `pnpm run` in this repository: `pnpm evidence:fold` in a lane pruned node_modules and WROTE an allowBuilds block into pnpm-workspace.yaml",
	);

	/*
	 * THE COMMAND HALF. `verifyDepsBeforeRun` gates a pre-run install; this pins
	 * that the entry point it would wrap re-enters no package manager either, so
	 * `pnpm evidence:fold` IS `node scripts/evidence-fold.mjs` and nothing else.
	 * The two together are the whole of "the fold never installs" that can be
	 * pinned WITHOUT a real install - which is why the claim is pinned here rather
	 * than proved end to end by desyncing a dependency tree (QA round 1, Q3).
	 */
	const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
	for (const name of [
		"evidence:fold",
		"evidence:fold:install",
		"evidence:fold:check",
	])
		assert.match(
			pkg.scripts[name] ?? "",
			/^\s*node\s+\S*scripts\/evidence-fold\.mjs/,
			`${name} must run the fold as plain Node, so no wrapper can pull a package manager in front of it`,
		);

	for (const file of ["evidence-fold.mjs", "entry-point.mjs"]) {
		const source = readFileSync(join(scripts, file), "utf8");
		assert.doesNotMatch(
			source,
			/(execFileSync|execSync|spawnSync|spawn|exec)\(\s*["'`](pnpm|npm|yarn|npx)["'`]/,
			`${file} must never spawn a package manager - the fold is plain Node and git`,
		);
		for (const [, specifier] of source.matchAll(
			/^import[^;]*?from\s+"([^"]+)"/gm,
		)) {
			assert.ok(
				specifier.startsWith("node:") || specifier.startsWith("."),
				`${file} imports ${specifier}: the fold path may depend only on node built-ins and its siblings, or a lane would need an install to fold`,
			);
		}
	}
});

test("a fold writes docs/evidence/manifest.json in the work tree and nothing else", () => {
	const dir = fixture({ attributes: true });
	installDriver(dir);
	/*
	 * `--no-amend` on purpose: it leaves the fold's own footprint visible (a
	 * staged manifest) instead of folding it into the merge commit, which is what
	 * makes "and nothing else" answerable.
	 */
	gitCode(dir, ["merge", "main", "-m", "chore(merge): fold main"]);
	const folded = run(dir, ["--no-amend"]);
	assert.equal(folded.status, 0, folded.out);

	const touched = [
		...(git(dir, ["diff", "--name-only"]) ?? "").split("\n"),
		...(git(dir, ["diff", "--cached", "--name-only"]) ?? "").split("\n"),
		...(git(dir, ["ls-files", "--others", "--exclude-standard"]) ?? "").split(
			"\n",
		),
	].filter(Boolean);
	assert.deepEqual(
		[...new Set(touched)],
		["docs/evidence/manifest.json"],
		`a fold may touch the manifest and nothing else, but this run touched: ${touched.join(", ")}`,
	);
});

test("a preflight refusal writes nothing, and leaves a stopped merge's index untouched", () => {
	/*
	 * THE PREFLIGHT'S WRITE-FREE CLAIM, PINNED. It was verified by hand and
	 * asserted by nothing, yet it is the load-bearing half of "a run that cannot be
	 * completed is stopped BEFORE the first write": the merge state STAGES the
	 * manifest as part of naming the merged tree, so a preflight that let a write
	 * through would leave a half-resolved index behind. The state where that
	 * matters is a merge already stopped on the conflict, which is what this
	 * fixture is put in.
	 */
	const dir = fixture({ attributes: true });
	// No driver installed: the merge stops, leaving all three index stages and
	// MERGE_HEAD - state the preflight must not disturb.
	assert.notEqual(
		gitCode(dir, ["merge", "main", "-m", "chore(merge): fold main"]).code,
		0,
	);
	// Remove the manifest the preflight insists on, so its second check fires.
	rmSync(join(dir, "docs/evidence/manifest.json"));
	const before = {
		stages: git(dir, ["ls-files", "-u"]),
		status: git(dir, ["status", "--short"]),
	};

	const refused = run(dir);
	assert.notEqual(refused.status, 0);
	assert.match(refused.out, /does not exist in this work tree/);
	assert.match(refused.out, /nothing has been written/);
	assert.equal(
		git(dir, ["ls-files", "-u"]),
		before.stages,
		"the preflight must not have staged, resolved or otherwise touched the index",
	);
	assert.equal(
		git(dir, ["status", "--short"]),
		before.status,
		"the preflight must have written nothing to the work tree either",
	);
	assert.ok(
		existsSync(join(dir, ".git", "MERGE_HEAD")),
		"the merge must still be in progress",
	);
	assert.ok(
		!existsSync(join(dir, "docs", "evidence", "manifest.json")),
		"the run must not have recreated the manifest it refused over",
	);
	assert.ok(
		!existsSync(join(dir, ".git", "evidence-fold-driver.log")),
		"and it must not have recorded a driver failure it never reached",
	);
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
const storyFixture = ({
	mainLostNestedKeys = false,
	/*
	 * The shape EVERY open branch has the moment the retirement lands on `main`:
	 * this branch's copy still carries `srcTree`/`scriptsTree`, because the fold
	 * tool that wrote it predates the change. It exists so the retired-field rule
	 * (test T6) is exercised through a real merge rather than a unit call.
	 */
	laneCarriesRetiredPair = false,
} = {}) => {
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
	manifestJson({
		...manifest({
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
		...(laneCarriesRetiredPair
			? { srcTree: "1".repeat(40), scriptsTree: "2".repeat(40) }
			: {}),
	});
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

/**
 * The key gate's own narrowing, and the shape tonight's drop took. An array
 * element that carries a `path` is keyed by it, so a loss inside ONE entry is
 * visible even while every other entry still carries the same key - which is
 * precisely the case the old union-of-elements form could not see (the #765
 * lane's fold lost `frames`/`surfaces`/`themes` from `supplementary[158]` while
 * ~160 other entries still carried all three, so the gate said `clean`).
 */
test("keyPaths sees a loss inside one `path`-keyed array element", () => {
	const before = {
		supplementary: [
			{ path: "a", frames: 1, why: "a" },
			{ path: "b", frames: 2, why: "b" },
		],
	};
	const afterOneEntryLost = {
		supplementary: [
			{ path: "a", frames: 1, why: "a" },
			{ path: "b", why: "b" },
		],
	};
	const beforePaths = keyPaths(JSON.stringify(before));
	const afterPaths = keyPaths(JSON.stringify(afterOneEntryLost));
	const lost = [...beforePaths].filter((path) => !afterPaths.has(path));
	assert.deepEqual(lost, ["supplementary[b].frames"]);
	// The union form this replaced could not have seen it: `supplementary[a].frames`
	// and `supplementary[b].frames` were one key, so the surviving entry masked
	// the lost one. Elements without a `path` keep that union, deliberately.
	assert.deepEqual(
		[
			...keyPaths(
				JSON.stringify({ items: [{ id: 1, moved: true }, { id: 2 }] }),
			),
		].filter((path) => path.startsWith("items")),
		["items", "items[].id", "items[].moved"],
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

/**
 * The retired pair, unit level: a fold drops it from whichever side carries it,
 * and the drop is a printed decision rather than a silence.
 *
 * This is the plain-JSON half of `check-fold-keys`' retired-field rule - the
 * resolver must actually remove the key, or the gate's acceptance would be
 * covering a file that still carries it.
 */
test("a fold drops a retired top-level field this branch still carries", () => {
	const decisions = [];
	const base = { head: "a", srcTree: "1", keepMe: "base" };
	const ours = { head: "a", srcTree: "2", keepMe: "ours", laneOnly: true };
	const theirs = { head: "b", keepMe: "theirs", mainOnly: true };
	const expected = {
		head: "a",
		keepMe: "ours",
		laneOnly: true,
		mainOnly: true,
	};

	const keys = mergedKeys(base, ours, theirs, "", decisions);
	assert.equal(keys.includes("srcTree"), false, "the retired key is dropped");
	assert.equal(RETIRED_TOP_LEVEL_FIELDS.has("srcTree"), true);
	assert.deepEqual(decisions, [
		{ path: "srcTree", action: "dropped", why: "retired by this change" },
	]);
	// And the dropped key is not silently re-added by the value merger.
	assert.equal(
		"srcTree" in resolveManifest({ base, ours, theirs, derived: null }),
		false,
	);
	// The rest of the union is untouched by the rule.
	assert.deepEqual(
		Object.keys(resolveManifest({ base, ours, theirs, derived: null })).sort(),
		Object.keys(expected).sort(),
	);
});

/**
 * THE OTHER DIRECTION (review round 1, MINOR 4). Filtering `Object.keys(ours)`
 * alone left the state where the BASE lacks the pair and the OTHER side carries
 * it: `srcTree` was imported from `theirs` with no decision recorded at all. That
 * is the only realistic resurrection - a lane whose own old fold tool re-added
 * the pair, merged to `main` - and it is the state this resolver and
 * `scripts/check-fold-keys.mjs` both promise cannot happen.
 */
test("a retired field only the OTHER side carries is dropped, with a decision", () => {
	const decisions = [];
	// Base lacks the pair entirely; this branch never had it; main's copy carries
	// it because an older tree's `evidence-fold.mjs` wrote it back in.
	const base = { head: "a", keepMe: "base" };
	const ours = { head: "a", keepMe: "ours" };
	const theirs = {
		head: "b",
		keepMe: "theirs",
		srcTree: "2".repeat(40),
		scriptsTree: "3".repeat(40),
	};

	const keys = mergedKeys(base, ours, theirs, "", decisions);
	assert.deepEqual(
		keys,
		["head", "keepMe"],
		"neither retired key is imported from the other side",
	);
	assert.deepEqual(decisions, [
		{ path: "srcTree", action: "dropped", why: "retired by this change" },
		{ path: "scriptsTree", action: "dropped", why: "retired by this change" },
	]);
	const merged = resolveManifest({ base, ours, theirs, derived: null });
	assert.equal("srcTree" in merged && "scriptsTree" in merged, false);
	// The rest of the union is untouched: main's own records still ride.
	assert.equal(merged.keepMe, "ours");
});

/**
 * AN ENTRY IS RESOLVED ADDITIVELY (2026-10-03, the #765 lane's fold onto
 * `7cb678f29bf`). That resolution dropped `frames`, `surfaces` and `themes` from
 * `supplementary[158]` - an entry whose only varying key was `why` - because this
 * branch's copy of the entry lacked the three counts while base and main carried
 * them, and the group (5) rule read the absence as a deliberate deletion, with
 * nothing in the record to explain it. An entry is a record of a capture: nothing
 * one side carried may vanish because the other side lacked it. The per-field
 * policy still picks VALUES; it no longer picks the key set.
 */
test("a supplementary entry is resolved additively, never from the side that won", () => {
	const entry = (fields) => ({ path: "chat/declared", ...fields });
	const base = {
		supplementary: [
			entry({ why: "the base's reason", frames: 1, surfaces: 1, themes: 1 }),
		],
	};

	// This branch's copy LOST the three counts; main still carries them.
	const lostOnOurs = resolveManifest({
		base,
		ours: { supplementary: [entry({ why: "THE LANE'S reason" })] },
		theirs: {
			supplementary: [
				entry({ why: "MAIN'S reason", frames: 4, surfaces: 5, themes: 6 }),
			],
		},
		derived: null,
	});
	assert.deepEqual(lostOnOurs.supplementary, [
		{
			path: "chat/declared",
			why: "THE LANE'S reason",
			frames: 4,
			surfaces: 5,
			themes: 6,
		},
	]);

	// And the reverse: keys only THIS branch's entry carries survive too.
	const lostOnTheirs = resolveManifest({
		base,
		ours: {
			supplementary: [entry({ why: "L", frames: 7, surfaces: 8, themes: 9 })],
		},
		theirs: { supplementary: [entry({ why: "M" })] },
		derived: null,
	});
	assert.deepEqual(lostOnTheirs.supplementary, [
		{ path: "chat/declared", why: "L", frames: 7, surfaces: 8, themes: 9 },
	]);

	// A one-sided entry rides through whole, whichever side carries it.
	const oursOnly = resolveManifest({
		base: {},
		ours: { supplementary: [entry({ why: "ours", frames: 2 })] },
		theirs: { supplementary: [] },
		derived: null,
	});
	assert.deepEqual(oursOnly.supplementary, [entry({ why: "ours", frames: 2 })]);
	const theirsOnly = resolveManifest({
		base: {},
		ours: { supplementary: [] },
		theirs: { supplementary: [entry({ why: "theirs", frames: 2 })] },
		derived: null,
	});
	assert.deepEqual(theirsOnly.supplementary, [
		entry({ why: "theirs", frames: 2 }),
	]);
});

/**
 * T6 - THE KEY GATE ACCEPTS THE RETIREMENT. After this lands on `main`, every
 * open branch folds with `srcTree` still in ITS parent; a gate that called that
 * a `LOST[branch]` fault would exit 1 on the first post-landing fold for doing
 * the right thing. The branch's own old fold tool re-adding the pair is exactly
 * the resurrection the design names, so the fixture's lane carries it.
 */
test("check-fold-keys reports the retired pair's loss as a decision, not a fault", () => {
	const { dir } = storyFixture({ laneCarriesRetiredPair: true });
	// The pair is in the LANE's parent and not in main's, which is the shape the
	// retirement creates.
	assert.equal(
		readManifest(dir).srcTree !== undefined,
		true,
		"the lane's copy carries the pair, as an un-migrated branch's would",
	);
	git(dir, ["merge", "main"]);
	const result = run(dir);
	assert.equal(result.status, 0, result.out);
	git(dir, ["commit", "-qm", "chore(merge): fold main"]);

	assert.equal(
		"srcTree" in readManifest(dir),
		false,
		"the fold dropped it rather than re-deriving it",
	);

	const merge = git(dir, ["rev-parse", "HEAD"]);
	const gate = spawnSync(process.execPath, [KEY_GATE, merge], {
		cwd: dir,
		encoding: "utf8",
	});
	assert.equal(gate.status, 0, `${gate.stdout}${gate.stderr}`);
	assert.match(
		gate.stdout,
		/dropped\s+docs\/evidence\/manifest\.json :: srcTree/,
	);
	assert.doesNotMatch(gate.stdout, /LOST\[branch\]/);
});

/**
 * T4 - THE FOLD LABEL CANNOT RE-ENTER A DERIVED FIELD. The `frames` lead used to
 * open with `(this branch folded onto \`origin/main\` = \`<base>\`)`, which put a
 * fresh commit name into the manifest on every fold even when the walk found
 * nothing new - the prose was 11 of the 30 replayed folds' conflict regions. Two
 * labels over one tree must therefore produce byte-identical readings.
 */
test("derived leads are independent of the fold label", async () => {
	const { dir } = storyFixture();
	const readerFor = (root) => (args) =>
		git(root, args) === null
			? null
			: execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
	const options = {
		root: dir,
		git: readerFor(dir),
		target: "HEAD",
		manifest: readManifest(dir),
	};
	const first = await deriveFields({ ...options, baseLabel: "0".repeat(9) });
	const second = await deriveFields({ ...options, baseLabel: "f".repeat(9) });

	assert.deepEqual(first, second);
	assert.doesNotMatch(first.countsMean.frames, /folded onto/);
	assert.doesNotMatch(first.countsMean.surfaces, /folded onto/);
	assert.doesNotMatch(first.countsMean.themes, /folded onto/);
	// And the retired pair is not part of what a derivation returns any more.
	assert.equal("srcTree" in first, false);
	assert.equal("scriptsTree" in first, false);
});
