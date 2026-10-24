import assert from "node:assert/strict";
import { join } from "node:path";
import { after, test } from "node:test";

import {
	findAddedCopyViolations,
	parseAddedLines,
	resolveComparisonBase,
} from "./check-added-strings.mjs";
import { openSnapshot } from "./check-strings.mjs";

const REPO = new URL("../..", import.meta.url).pathname;
const HUNK_ERROR_RE = /hunk header/;
const BASE_ERROR_RE = /git merge-base/;
const FIXTURE = "scripts/i18n/fixtures/scan/added-copy.tsx";
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
		"Added expression label",
		"Added expression placeholder",
		"Added enabled alt",
		"Added disabled alt",
		"template title",
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
