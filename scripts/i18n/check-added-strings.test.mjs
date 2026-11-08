import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { after, test } from "node:test";

import {
	findAddedCopyViolations,
	parseAddedLines,
	resolveComparisonBase,
	runAddedCheck,
} from "./check-added-strings.mjs";
import { isScanned, openSnapshot } from "./check-strings.mjs";

const REPO = new URL("../..", import.meta.url).pathname;
const HUNK_ERROR_RE = /hunk header/;
const DISAPPEARED_RE = /Changed file disappeared: src\/a\.tsx/;
const BASE_ERROR_RE = /git merge-base/;
const FIXTURE = "scripts/i18n/fixtures/scan/added-copy.tsx";
const CHECKER = join(REPO, "scripts/i18n/check-added-strings.mjs");
const ABS = join(REPO, FIXTURE);

/* ONE temp root per run, reaped in the `after` below. Every fixture here is
 * built inside it, so no case reads this checkout's state and a killed run
 * leaves nothing behind in the working tree. */
const SCRATCH = mkdtempSync(join(tmpdir(), "i18n-added-strings-"));

/* The parsed fixture, built on FIRST USE - this was module-load state, and that
 * was the whole reason this file could not run on a loaded host.
 *
 * Measured on the machine that filed this (5.5 GiB free, load 55-70):
 * `openSnapshot(REPO, [ABS])` at module load cost 15,933 ms before a single case
 * ran, because the snapshot opens both tsconfig projects, and those are
 * 5,291 + 1,339 + 5,331 files in this checkout. Every reader, including two
 * review streams, was reduced to reading this file, and four defects it pins
 * were found by a CI shard instead. A full run timed out at 420 s.
 *
 * The compiler only has to PARSE one file. So the fixture's bytes are copied
 * into the scratch root - no tsconfig above them - where opening it costs
 * ~0.4 s in a single inferred project (measured; 383 ms). The walker under test
 * is a pure function of the SourceFile, so where the bytes are parsed cannot
 * change a finding: same file text, same compiler, same walk. `openSnapshot`
 * opens the two tsconfig paths unconditionally, so `scratchTree` writes the
 * stubs it opens rather than depending on them being absent. */
let fixtureSnapshot;
function fixtureSourceFile() {
	if (fixtureSnapshot === undefined) {
		const dir = scratchTree("fixture-");
		// Mirrors the fixture's repo-relative path so a diagnostic still reads
		// like the file it came from.
		const copy = join(dir, FIXTURE);
		mkdirSync(dirname(copy), { recursive: true });
		writeFileSync(copy, readFileSync(ABS));
		fixtureSnapshot = { copy, ...openSnapshot(dir, [copy]) };
	}
	const { snapshot, copy } = fixtureSnapshot;
	const project = snapshot.getDefaultProjectForFile(copy);
	const sourceFile = project.program.getSourceFile(copy);
	assert.ok(sourceFile, "the added-copy fixture must parse");
	return sourceFile;
}

after(() => {
	fixtureSnapshot?.api.close();
	rmSync(SCRATCH, { recursive: true, force: true });
});

function lineFor(text) {
	const sourceFile = fixtureSourceFile();
	const position = sourceFile.text.indexOf(text);
	assert.ok(position >= 0, `fixture text missing: ${text}`);
	return sourceFile.getLineAndCharacterOfPosition(position).line + 1;
}

function findings(lines, options) {
	return findAddedCopyViolations(fixtureSourceFile(), lines, options);
}

test("a newly added object literal is a counterfactual guard failure", () => {
	const found = findings(new Set([lineFor('"Added object label"')]));
	assert.deepEqual(found, [
		{
			line: lineFor('"Added object label"'),
			kind: "property:label",
			text: "Added object label",
		},
	]);
});

test("a copy const rendered through a JSX expression is a guard failure", () => {
	const rendered = lineFor("{ADDED_CONST_COPY}");
	assert.deepEqual(findings(new Set([rendered])), [
		{ line: rendered, kind: "jsx-expression:const", text: "Added const copy" },
	]);
});

test("a copy const rendered into a copy attribute is a guard failure", () => {
	const rendered = lineFor("aria-label={ADDED_CONST_LABEL}");
	assert.deepEqual(findings(new Set([rendered])), [
		{
			line: rendered,
			kind: "attribute:aria-label:const",
			text: "Added const label",
		},
	]);
});

test("all newly added static copy shapes are visible to the guard", () => {
	const found = findings(null);
	const texts = new Set(found.map((finding) => finding.text));
	for (const expected of [
		"Added object label",
		"Added object template",
		"Added enabled title",
		"Added disabled title",
		"Added",
		"template suffix",
		"concatenated copy",
		"Added logical and label",
		"Added logical or label",
		"Added nullish label",
		"Added JSX expression text",
		"Added JSX logical text",
		"Added const copy",
		"Added const label",
		"Added expression label",
		"Added expression placeholder",
		"Added enabled alt",
		"Added disabled alt",
		"template title",
		"ui.fixture.raw_key",
	]) {
		assert.ok(texts.has(expected), `missing ${expected}`);
	}
	assert.ok(found.some((finding) => finding.kind === "property:description"));
	assert.ok(found.some((finding) => finding.kind === "attribute:title"));
});

test("keyed, dynamic, technical and explicitly exempt copy passes", () => {
	const texts = findings(null).map((finding) => finding.text);
	assert.ok(!texts.includes("ui.fixture.keyed"));
	assert.ok(!texts.includes("technical-identifier"));
	assert.ok(!texts.includes("gpt-5"));
	assert.ok(!texts.includes("Local Operator"));
	assert.ok(!texts.includes("serverText"));
});

test("unchanged existing debt does not become a new-diff failure", () => {
	assert.deepEqual(findings(new Set()), []);
	assert.deepEqual(findings(new Set([lineFor('"technical-identifier"')])), []);
});

test("the template sinks catch the shape the ratchet leaves out", () => {
	const found = findings(null, { templateSinks: true });
	const textsOf = (kind) =>
		found.filter((finding) => finding.kind === kind).map((f) => f.text);
	/*
	 * Two const sinks fire and one does not, ordered by line as the walker
	 * emits: the plain sentence, and the unpragma'd token. The token fires
	 * because the rule is fail-closed — a letter is enough — and the pragma on
	 * its sibling is the only thing that silences a machine string.
	 */
	assert.deepEqual(textsOf("template:const"), [
		"Added plain const sentence",
		"machine-token",
		/* A substituting template with one word and NO space: copy, and the
		   reason the rule may not require a space before it fires. */
		"${…}online",
	]);
	assert.deepEqual(textsOf("template:array"), [
		"Added array sentence",
		"Added second array sentence",
	]);
	assert.deepEqual(textsOf("template:return"), ["Added returned sentence"]);
});

test("the template sinks are off where the ratchet does not count the shape", () => {
	// Same fixture text, no surface: the guard's default report is unchanged.
	assert.deepEqual(
		findings(null).filter((finding) => finding.kind.startsWith("template:")),
		[],
	);
	// Unchanged lines are not added lines, so even on the surface nothing fires.
	assert.deepEqual(findings(new Set(), { templateSinks: true }), []);
});

test("a machine template fires, and an `i18n: ignore` pragma is what silences it", () => {
	const found = findings(null, { templateSinks: true });
	/*
	 * Both fixtures are the same shape and the same kind of string, so the ONLY
	 * variable between them is the pragma: one fires, one does not. That is the
	 * gate's whole escape hatch — a rule that guessed from the text instead
	 * would have to let `${count}online` through as well, which is copy.
	 */
	assert.ok(
		found.some(
			(finding) =>
				finding.kind === "template:const" && finding.text === "machine-token",
		),
		"a machine template on an added line must be flagged",
	);
	assert.deepEqual(
		found.filter((finding) => finding.text === "template-token"),
		[],
	);
});

test("diff hunks cover added and new-file lines, including empty ranges", () => {
	assert.deepEqual(
		[...parseAddedLines("@@ -0,0 +1,3 @@\n+a\n+b\n+c").added],
		[1, 2, 3],
	);
	assert.deepEqual(
		[...parseAddedLines("@@ -4,2 +8,0 @@\n-old\n-old2").added],
		[],
	);
	assert.throws(() => parseAddedLines("@@ malformed @@"), HUNK_ERROR_RE);
});

test("an unresolved base fails closed instead of producing an empty diff", () => {
	assert.throws(
		() => resolveComparisonBase(REPO, "refs/heads/definitely-not-a-real-base"),
		BASE_ERROR_RE,
	);
});

test("the real CLI rejects logical and JSX text in untracked and staged-new files", () => {
	const source = `export const Probe = ({ dynamic }) => {
	const item = { label: dynamic && "Logical and copy" };
	return <div aria-label={dynamic || "Logical fallback copy"} title={dynamic ?? "Nullish fallback copy"}>
		{"JSX expression copy"}
		{dynamic && "JSX logical copy"}
		{item.label}
	</div>;
};
`;
	const expected = [
		"Logical and copy",
		"Logical fallback copy",
		"Nullish fallback copy",
		"JSX expression copy",
		"JSX logical copy",
	];
	for (const mode of ["untracked", "staged-new"]) {
		/* A scratch git repo, NOT this checkout.
		 *
		 * The probe used to be written into `scripts/i18n/` here, which is how
		 * `review-r1-42960-staged-new.tsx` reached #1767: a SIGKILLed lane skips
		 * the `finally` and the next `git add -A` sweeps the probe in as product
		 * code. It also made this case depend on this checkout's inventory (one
		 * CLI run measured 13.2 s, because the snapshot parses both projects)
		 * and on this checkout's `.gitignore` staying silent about the probe.
		 *
		 * The scratch repo carries this repo's REAL `.gitignore`, copied rather
		 * than written: `git ls-files --others --exclude-standard` IS the
		 * checker's untracked semantics, so an ignore rule that hides the probe
		 * now fails THIS case instead of a CI shard after merge. */
		const dir = scratchRepo();
		const probe = join(
			dir,
			"scripts/i18n",
			`review-r1-${process.pid}-${mode}.tsx`,
		);
		// Keep a generated pager bundle present for the entire census: unlike a
		// timing-based concurrency rerun this deterministically tests collision
		// isolation while the CLI must STILL reject our new literal copy.
		const pagerBundle = join(
			dir,
			"scripts",
			`_table-pager-range-${process.pid}.bundle.mjs`,
		);
		const env = gitEnv();
		try {
			writeFileSync(probe, source);
			writeFileSync(
				pagerBundle,
				'export const generated = "Not product copy";',
			);
			assert.equal(isScanned(relative(dir, pagerBundle)), false);
			const ignored = spawnSync(
				"git",
				["check-ignore", "--", relative(dir, pagerBundle)],
				{ cwd: dir, env, encoding: "utf8" },
			);
			assert.equal(ignored.status, 0, "generated pager bundle must be ignored");
			if (mode === "staged-new") {
				// The scratch index is disposable, so the staged/new-file diff path
				// runs against a real `git add`: no temporary GIT_INDEX_FILE, and no
				// way to touch this checkout's index.
				const staged = spawnSync("git", ["add", "--", relative(dir, probe)], {
					cwd: dir,
					env,
					encoding: "utf8",
				});
				assert.equal(staged.status, 0, staged.stderr);
			}
			const result = spawnSync(
				process.execPath,
				[CHECKER, "--repo", dir, "--base", "HEAD"],
				{ cwd: dir, env, encoding: "utf8" },
			);
			const output = `${result.stdout}\n${result.stderr}`;
			assert.equal(result.status, 1, `${mode}:\n${output}`);
			for (const text of expected) {
				assert.ok(output.includes(text), `${mode} missed ${text}:\n${output}`);
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}
});

/* Visibility, not tidiness: the probe the CLI test above writes must stay
 * visible to git. `check-added-strings.mjs` builds its untracked list from
 * `git ls-files --others --exclude-standard`, so an ignore rule for
 * `scripts/i18n/review-r1-*` made the probe invisible, the checker reported
 * "0 changed file(s)" and passed vacuously while the test above still expected
 * a finding (UI main, run 42506540162, job 128810354835, node 1244). The
 * checker's untracked path IS git visibility, so visibility is not something a
 * tidiness rule may take away.
 *
 * That test now writes its probe into a scratch repo that carries this repo's
 * real `.gitignore` (see `scratchTree`), so re-adding such a rule fails it on a
 * laptop instead of in a CI shard. The debris the rule aimed at is real, though
 * - a `SIGKILL` bypasses the `finally` - and the tracked-probe guard below is
 * what keeps it out of a commit: a probe left on disk is scratch the next run
 * reclaims, a TRACKED probe is a defect in the commit. */
test("no runtime probe is ever tracked in the index", () => {
	// An inherited GIT_DIR/GIT_INDEX_FILE aims `git ls-files` at another
	// repository or index, and a guard reading the wrong index passes silently.
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
	);
	const listed = spawnSync("git", ["ls-files", "-z", "--", "scripts/i18n"], {
		cwd: REPO,
		env,
		encoding: "utf8",
	});
	assert.equal(listed.status, 0, listed.stderr);
	const probes = listed.stdout
		.split("\0")
		.filter((rel) => rel.startsWith("scripts/i18n/review-r1-"));
	assert.deepEqual(
		probes,
		[],
		`a runtime probe was committed, so a killed run's scratch became product code: \`git rm --cached\` each of ${probes.join(", ")} and delete it on disk`,
	);
});

/* An inherited GIT_DIR/GIT_INDEX_FILE/GIT_WORK_TREE aims a scratch command (and
 * the checker's own git calls) at the caller's repo or index - a guard reading
 * the wrong index passes silently, and a fixture diff against the wrong repo is
 * meaningless. Every git spawn below passes this env, never `process.env`. */
function gitEnv() {
	return Object.fromEntries(
		Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
	);
}

/* A scratch tree holding exactly what the checker reads: the two tsconfig paths
 * `openSnapshot` opens, an empty allowlist, a scan root - and a COPY of this
 * repo's `.gitignore`, because which files git considers untracked is part of
 * the behaviour under test. Copying it (rather than writing a stand-in) is what
 * makes an ignore rule that hides a probe fail here rather than in CI. */
function scratchTree(prefix) {
	const dir = mkdtempSync(join(SCRATCH, prefix));
	mkdirSync(join(dir, "src"), { recursive: true });
	mkdirSync(join(dir, "scripts/i18n"), { recursive: true });
	mkdirSync(join(dir, "i18n"), { recursive: true });
	for (const name of ["tsconfig.app.json", "tsconfig.node.json"]) {
		writeFileSync(
			join(dir, name),
			JSON.stringify({
				compilerOptions: { jsx: "preserve" },
				include: ["src"],
			}),
		);
	}
	writeFileSync(join(dir, "i18n/allowlist.json"), '{"entries":[]}');
	copyFileSync(join(REPO, ".gitignore"), join(dir, ".gitignore"));
	return dir;
}

/* The vanished-file race (CI runs 41603855749 / 41595469149): a sibling test's
 * transient `_*.bundle.mjs` is listed as untracked and deleted before the
 * checker reads it. `afterListing` opens that window deterministically in a
 * scratch git repo, so no timing luck and no touching of this checkout. */
function scratchRepo() {
	const dir = scratchTree("repo-");
	const env = gitEnv();
	// The checker spawns its own `git` with the inherited environment, so strip
	// the GIT_* keys it would inherit rather than only shielding our own calls.
	for (const key of Object.keys(process.env)) {
		if (key.startsWith("GIT_")) delete process.env[key];
	}
	const run = (...args) =>
		spawnSync("git", args, { cwd: dir, env, encoding: "utf8" });
	writeFileSync(join(dir, "src/a.tsx"), "export const a = 1;\n");
	run("init", "-q");
	run("add", ".");
	run("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");
	return dir;
}

test("the template sinks follow the ratchet's surface: renderer yes, main no", () => {
	const dir = scratchRepo();
	try {
		mkdirSync(join(dir, "src/renderer/src"), { recursive: true });
		mkdirSync(join(dir, "src/main"), { recursive: true });
		writeFileSync(
			join(dir, "src/renderer/src/new.tsx"),
			"export const sentence = `Added renderer sentence`;\n",
		);
		writeFileSync(
			join(dir, "src/main/new.ts"),
			"export const sentence = `Added main-process sentence`;\n",
		);
		// `runAddedCheck` derives the flag from the path, so this is the wiring the
		// unit cases above cannot prove: the SAME text is guarded under
		// `src/renderer` and left to the main-process gap everywhere else.
		const result = runAddedCheck({ repo: dir, base: "HEAD" });
		assert.deepEqual(
			result.findings.map((f) => `${f.path} ${f.kind} ${f.text}`),
			["src/renderer/src/new.tsx template:const Added renderer sentence"],
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("an untracked file deleted after listing is skipped, not an error", () => {
	const dir = scratchRepo();
	try {
		const transient = join(dir, "scripts/i18n/_x.bundle.mjs");
		writeFileSync(transient, 'export const x = "Some copy";\n');
		const result = runAddedCheck({
			repo: dir,
			base: "HEAD",
			afterListing: () => rmSync(transient, { force: true }),
		});
		assert.deepEqual(result.findings, []);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the same untracked file, still present, is reported (the skip depends on absence)", () => {
	const dir = scratchRepo();
	try {
		writeFileSync(
			join(dir, "src/b.tsx"),
			'export const b = <i title={x && "Present copy"} />;\n',
		);
		const result = runAddedCheck({ repo: dir, base: "HEAD" });
		assert.equal(result.findings.length, 1);
		assert.equal(result.findings[0].path, "src/b.tsx");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a tracked changed file deleted after listing still fails closed", () => {
	const dir = scratchRepo();
	try {
		const tracked = join(dir, "src/a.tsx");
		writeFileSync(tracked, 'export const a = <b title={x && "Copy"} />;\n');
		assert.throws(
			() =>
				runAddedCheck({
					repo: dir,
					base: "HEAD",
					afterListing: () => rmSync(tracked, { force: true }),
				}),
			DISAPPEARED_RE,
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
