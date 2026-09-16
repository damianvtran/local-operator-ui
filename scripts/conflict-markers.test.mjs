import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/*
 * No committed file may carry a git conflict marker.
 *
 * WHY THIS EXISTS, and it is not hypothetical. A rebase resolved
 * `scripts/slash-contract.test.mjs` and committed three marker lines inside a
 * `/* … *​/` comment block, where they survived `node --check`, biome, the lint
 * gates and 1811 tests — every instrument green, the tree wrong. Two rounds of
 * review found the same shape independently, and the only thing that would have
 * caught it at the moment it happened is a check that reads the FILES rather
 * than the behaviour they describe.
 *
 * The marker pair rather than the bare separator: `<<<<<<< ` and `>>>>>>> `
 * with the seven characters and a following space are not something source
 * legitimately contains, while a line of `=======` is (a rule in a comment, a
 * table in a doc). A conflict that lost only its middle line would still be
 * caught, because the two ends are what this asserts.
 *
 * Tracked files only, through `git ls-files`, so a scratch tree, a lockfile and
 * `node_modules` are out of scope by construction, and the check costs one
 * `git ls-files` plus one pass over the text.
 */
test("no tracked file carries a git conflict marker", () => {
	const files = execFileSync("git", ["ls-files", "-z"], {
		cwd: process.cwd(),
		encoding: "utf8",
	})
		.split("\0")
		.filter(Boolean);
	const offenders = [];
	for (const file of files) {
		/*
		 * Binary-ish paths are read as text and skipped on a decode error rather
		 * than listed: a marker cannot be committed into a blob git treats as
		 * binary, and a `.webp` read as utf8 is noise, not evidence.
		 */
		let text;
		try {
			text = readFileSync(file, "utf8");
		} catch {
			continue;
		}
		const lines = text.split("\n");
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (line.startsWith("<<<<<<< ") || line.startsWith(">>>>>>> ")) {
				offenders.push(`${file}:${i + 1}: ${line.slice(0, 40)}`);
			}
		}
	}
	assert.deepEqual(
		offenders,
		[],
		`a committed conflict marker is a resolution nobody finished:\n${offenders.join("\n")}`,
	);
});
