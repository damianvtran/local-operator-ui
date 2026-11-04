import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { after, test } from "node:test";

import {
	findAddedCopyViolations,
	parseAddedLines,
	resolveComparisonBase,
	runAddedCheck,
} from "./check-added-strings.mjs";
import { openSnapshot } from "./check-strings.mjs";

const REPO = new URL("../..", import.meta.url).pathname;
const HUNK_ERROR_RE = /hunk header/;
const DISAPPEARED_RE = /Changed file disappeared: src\/a\.tsx/;
const BASE_ERROR_RE = /git merge-base/;
const FIXTURE = "scripts/i18n/fixtures/scan/added-copy.tsx";
const CHECKER = join(REPO, "scripts/i18n/check-added-strings.mjs");
const ABS = join(REPO, FIXTURE);
const fixtureApi = openSnapshot(REPO, [ABS]);
after(() => fixtureApi.api.close());

const project = fixtureApi.snapshot.getDefaultProjectForFile(ABS);
const sourceFile = project.program.getSourceFile(ABS);
assert.ok(sourceFile, "the added-copy fixture must parse");

function lineFor(text) {
	const position = sourceFile.text.indexOf(text);
	assert.ok(position >= 0, `fixture text missing: ${text}`);
	return sourceFile.getLineAndCharacterOfPosition(position).line + 1;
}

function findings(lines) {
	return findAddedCopyViolations(sourceFile, lines);
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
		const probe = join(
			REPO,
			"scripts/i18n",
			`review-r1-${process.pid}-${mode}.tsx`,
		);
		const scratch = mkdtempSync(join(tmpdir(), "i18n-added-guard-"));
		const env = Object.fromEntries(
			Object.entries(process.env).filter(([key]) => key !== "GIT_INDEX_FILE"),
		);
		try {
			writeFileSync(probe, source);
			const rel = relative(REPO, probe);
			if (mode === "staged-new") {
				// A temporary index proves the tracked/new-file diff path without
				// ever mutating the checkout's real index or another test's state.
				env.GIT_INDEX_FILE = join(scratch, "index");
				for (const args of [
					["read-tree", "HEAD"],
					["add", "--", rel],
				]) {
					const staged = spawnSync("git", args, {
						cwd: REPO,
						env,
						encoding: "utf8",
					});
					assert.equal(staged.status, 0, staged.stderr);
				}
			}
			const result = spawnSync(process.execPath, [CHECKER, "--base", "HEAD"], {
				cwd: REPO,
				env,
				encoding: "utf8",
			});
			const output = `${result.stdout}\n${result.stderr}`;
			assert.equal(result.status, 1, `${mode}:\n${output}`);
			for (const text of expected) {
				assert.ok(output.includes(text), `${mode} missed ${text}:\n${output}`);
			}
		} finally {
			rmSync(probe, { force: true });
			rmSync(scratch, { recursive: true, force: true });
		}
	}
});

/* The vanished-file race (CI runs 41603855749 / 41595469149): a sibling test's
 * transient `_*.bundle.mjs` is listed as untracked and deleted before the
 * checker reads it. `afterListing` opens that window deterministically in a
 * scratch git repo, so no timing luck and no touching of this checkout. */
function scratchRepo() {
	const dir = mkdtempSync(join(tmpdir(), "i18n-vanish-"));
	// An inherited GIT_DIR/GIT_INDEX_FILE would aim these setup commands (and
	// the checker's own git calls) at the caller's repo instead of the scratch one.
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
	);
	for (const key of Object.keys(process.env)) {
		if (key.startsWith("GIT_")) delete process.env[key];
	}
	const run = (...args) =>
		spawnSync("git", args, { cwd: dir, env, encoding: "utf8" });
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
	writeFileSync(join(dir, "src/a.tsx"), "export const a = 1;\n");
	run("init", "-q");
	run("add", ".");
	run("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");
	return dir;
}

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
