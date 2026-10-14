import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main as generateMain } from "./generate.mjs";

const REPO = process.cwd();
const IMPORT_LINES = /^import .*;$/gm;
const BASE_IMPORT = 'import enUiChat from "./catalogues/en/ui.chat.json";';
const NESTED_IMPORT =
	'import enUiChatComposer from "./catalogues/en/ui.chat.composer.json";';

/*
 * Nested namespaces expose a disagreement that flat namespaces hide: the shorter
 * identifier sorts first, but Biome sorts its module path after the nested path.
 * Check the real generated artifact with the repo's own native Biome binary,
 * plus a deliberately identifier-sorted negative control. No compiler or build.
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

		// Recreate the previous final identifier sort, proving this fixture rejects
		// that exact regression rather than merely asserting two expected strings.
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
		console.log(
			"native Biome: generated path order PASS (0), identifier-order negative control FAIL (1)",
		);
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
});
