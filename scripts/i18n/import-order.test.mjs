import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { main as generateMain } from "./generate.mjs";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const IMPORT_LINES = /^import .*;$/gm;
const BASE_IMPORT = 'import enUiChat from "./catalogues/en/ui.chat.json";';
const NESTED_IMPORT =
	'import enUiChatComposer from "./catalogues/en/ui.chat.composer.json";';

/*
 * Nested namespaces expose a disagreement that flat namespaces hide: the shorter
 * identifier sorts first, but Biome sorts its module path after the nested path.
 * Check the real generated artifact with the repo's own native Biome binary,
 * plus deliberately swapped-import and code-unit-sorted negative controls.
 * Numeric namespaces and locale subtags must follow Biome's natural order too.
 * No compiler or build.
 */
test("generated nested-namespace imports pass Biome; identifier ordering fails", () => {
	const scratch = mkdtempSync(
		join(
			process.env.LOCAL_OPERATOR_SCRATCHPAD ?? tmpdir(),
			"i18n-import-order-",
		),
	);
	try {
		const output = join(scratch, "keys.gen.ts");
		const args = [
			"--catalogues",
			join(REPO, "scripts/i18n/fixtures/import-order"),
			"--out",
			output,
		];
		assert.equal(generateMain(args), 0);
		const generated = readFileSync(output, "utf8");
		assert.deepEqual(generated.match(IMPORT_LINES), [
			NESTED_IMPORT,
			BASE_IMPORT,
			'import enUiChat002c from "./catalogues/en/ui.chat002c.json";',
			'import enUiChat002x from "./catalogues/en/ui.chat002x.json";',
			'import enUiChat02b from "./catalogues/en/ui.chat02b.json";',
			'import enUiChat02y from "./catalogues/en/ui.chat02y.json";',
			'import enUiChat2 from "./catalogues/en/ui.chat2.json";',
			'import enUiChat2a from "./catalogues/en/ui.chat2a.json";',
			'import enUiChat10 from "./catalogues/en/ui.chat10.json";',
			'import es5UiChat from "./catalogues/es-5/ui.chat.json";',
			'import es419UiChat from "./catalogues/es-419/ui.chat.json";',
		]);
		const check = () =>
			spawnSync(
				join(REPO, "node_modules/.bin/biome"),
				["check", "--config-path", join(REPO, "biome.json"), output],
				{ encoding: "utf8" },
			);
		const passing = check();
		assert.equal(passing.status, 0, `${passing.stdout}\n${passing.stderr}`);
		assert.equal(generateMain(["--check", ...args]), 0);

		// Swap the two original imports to prove Biome rejects that emitted text.
		// This is an artifact control, not a mutation of the generator comparator.
		writeFileSync(
			output,
			generated.replace(
				`${NESTED_IMPORT}\n${BASE_IMPORT}`,
				`${BASE_IMPORT}\n${NESTED_IMPORT}`,
			),
		);
		const failing = check();
		assert.notEqual(failing.status, 0);
		assert.ok(
			`${failing.stdout}\n${failing.stderr}`.includes("organizeImports"),
		);
		const imports = generated.match(IMPORT_LINES);
		const codeUnitOrder = [...imports].sort((left, right) => {
			const pathLeft = left.split('"')[1];
			const pathRight = right.split('"')[1];
			return pathLeft < pathRight ? -1 : pathLeft > pathRight ? 1 : 0;
		});
		let index = 0;
		writeFileSync(
			output,
			generated.replace(IMPORT_LINES, () => codeUnitOrder[index++]),
		);
		const numericFailure = check();
		assert.notEqual(numericFailure.status, 0);
		assert.ok(
			`${numericFailure.stdout}\n${numericFailure.stderr}`.includes(
				"organizeImports",
			),
		);
		console.log(
			"native Biome: natural path order PASS (0); swapped-import and code-unit-order controls FAIL (1)",
		);
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
});
