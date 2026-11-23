import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	findAddedCopyViolations,
	findStateCopyCandidates,
} from "./check-added-strings.mjs";
import { openSnapshot } from "./check-strings.mjs";

// One tiny inferred project, no repo-wide diagnostics or second compiler. Prefer
// harness-owned scratch, but ordinary CI/developer runs have only the OS temp root.
const root = mkdtempSync(
	join(process.env.LOCAL_OPERATOR_SCRATCHPAD ?? tmpdir(), "state-copy-"),
);
mkdirSync(join(root, "src/renderer"), { recursive: true });
for (const name of ["tsconfig.app.json", "tsconfig.node.json"])
	writeFileSync(
		join(root, name),
		JSON.stringify({
			compilerOptions: { jsx: "preserve", noLib: true },
			include: ["src"],
		}),
	);
const COMPILER_ERROR_RE = /compiler unavailable/;
const INCOMPLETE_RE = /Incomplete/;
const react = 'import { useState } from "react";\n';
const component = (init, body = "", sink = "<p>{value}</p>") =>
	`${react}function C() {\nconst [value, setValue] = useState(${init});\n${body}\nreturn ${sink};\n}`;
const cases = [
	["initializer", component('"unknown"'), 1],
	[
		"catch-setter",
		component("null", 'fetchVersion().catch(() => setValue("unknown"));'),
		1,
	],
	[
		"setter-alias",
		component(
			"null",
			'const update = setValue;\nconst again = update;\nagain("unknown");',
		),
		1,
	],
	[
		"closure",
		component('"unknown"', "const render = () => <p>{value}</p>;", "render()"),
		1,
	],
	["template-hole", component('"unknown"', "", "<p>{`${value}`}</p>"), 1],
	[
		"translated",
		component('t("ui.test.pending")', 'setValue(t("ui.test.failed"));'),
		0,
	],
	[
		"nonrendered-enum",
		component(
			'"unknown"',
			'setValue("ready");',
			'<p>{value === "ready" && t("ui.test.ready")}</p>',
		),
		0,
	],
	[
		"shadow-value",
		component(
			'"unknown"',
			"const render = ({value}) => <p>{value}</p>;",
			"render(data)",
		),
		0,
	],
	[
		"shadow-setter",
		component("null", 'function other({setValue}) { setValue("unknown"); }'),
		0,
	],
	[
		"shadow-alias",
		component(
			"null",
			'const update = setValue; function other({update}) { update("unknown"); }',
		),
		0,
	],
	[
		"import-alias",
		component('"unknown"')
			.replace("useState }", "useState as primitive }")
			.replace("= useState(", "= primitive("),
		1,
	],
	[
		"default-react",
		component('"unknown"')
			.replace("import { useState }", "import React")
			.replace("= useState(", "= React.useState("),
		1,
	],
	[
		"namespace-react",
		component('"unknown"')
			.replace("import { useState }", "import * as React")
			.replace("= useState(", "= React.useState("),
		1,
	],
	[
		"local-fake",
		component('"unknown"').replace(
			react,
			"function useState(x) { return [x, () => {}]; }\n",
		),
		0,
	],
	[
		"shadow-hook",
		component('"unknown"').replace("function C()", "function C(useState)"),
		0,
	],
	["aria", component('"unknown"', "", "<p aria-label={value} />"), 1],
	[
		"technical-attributes",
		component('"unknown"', "", "<p data-testid={value} className={value} />"),
		0,
	],
	[
		"translated-arguments",
		component(
			'"unknown"',
			"",
			'<p>{t("ui.test.version", { version: value })}</p>',
		),
		0,
	],
	[
		"conditional-output",
		component('"unknown"', "", "<p>{ready ? value : null}</p>"),
		1,
	],
	[
		"comparison-predicate",
		component(
			'"unknown"',
			"",
			'<p>{value === token ? t("ui.test.yes") : null}</p>',
		),
		0,
	],
	[
		"logical-output",
		component('"unknown"', "", "<p>{ready && (value ?? fallback)}</p>"),
		1,
	],
	[
		"logical-predicate",
		component('"unknown"', "", '<p>{value && t("ui.test.yes")}</p>'),
		0,
	],
	["concat-output", component('"unknown"', "", "<p>{prefix + value}</p>"), 1],
	[
		"property-output",
		component('"unknown"', "const item = { label: value };", "null"),
		1,
	],
	[
		"technical-pragma",
		component('"unknown"').replace(
			"const [value",
			"// i18n: ignore opaque version identifier from protocol\nconst [value",
		),
		0,
	],
	[
		"pragma-not-setter",
		component('"unknown"', 'setValue("unknown");').replace(
			"const [value",
			"// i18n: ignore opaque version identifier from protocol\nconst [value",
		),
		1,
	],
	["lazy-unsupported", component('() => "unknown"'), 0],
	["updater-unsupported", component("null", 'setValue(() => "unknown");'), 0],
	[
		"mutable-alias-unsupported",
		component("null", 'let update = setValue; update("unknown");'),
		0,
	],
	[
		"alias-cycle",
		component("null", 'const a = b; const b = a; a("unknown");'),
		0,
	],
];
const paths = cases.map(([name, text]) => {
	const path = join(root, `src/renderer/${name}.tsx`);
	writeFileSync(path, text);
	return path;
});
const { api, snapshot } = openSnapshot(root, paths);
after(() => api.close());
const parsed = (index) => {
	const project = snapshot.getDefaultProjectForFile(paths[index]);
	const file = project.program.getSourceFile(paths[index]);
	assert.ok(file);
	return { project, file };
};
// Run this same module in fresh processes: mutating the parent's environment
// cannot catch a module-load crash, and selecting only the probe avoids recursion.
const rootProbe = "fixture root uses configured temporary directory";
const ONE_PASS_RE = /# pass 1\b/;
test(rootProbe, () => {
	assert.equal(
		dirname(root),
		process.env.LOCAL_OPERATOR_SCRATCHPAD ?? tmpdir(),
	);
});
for (const configured of [false, true])
	test(`fixture initialization with scratch variable ${configured ? "present" : "absent"}`, () => {
		const fallback = join(root, "portable-root");
		const harness = join(root, "harness-root");
		mkdirSync(fallback, { recursive: true });
		mkdirSync(harness, { recursive: true });
		const env = {
			...process.env,
			TMPDIR: fallback,
			TMP: fallback,
			TEMP: fallback,
		};
		// A nested runner must not inherit the parent's test-worker transport.
		env.NODE_TEST_CONTEXT = undefined;
		env.LOCAL_OPERATOR_SCRATCHPAD = undefined;
		if (configured) env.LOCAL_OPERATOR_SCRATCHPAD = harness;
		const result = spawnSync(
			process.execPath,
			[
				"--test",
				"--test-reporter=tap",
				`--test-name-pattern=^${rootProbe}$`,
				fileURLToPath(import.meta.url),
			],
			{ env, encoding: "utf8" },
		);
		assert.ifError(result.error);
		assert.equal(result.status, 0, result.stdout + result.stderr);
		assert.match(result.stdout, ONE_PASS_RE);
	});
let queryMs = 0;
for (const [index, [name, , count]] of cases.entries())
	test(name, () => {
		const { project, file } = parsed(index);
		const start = performance.now();
		const stateCandidates = findStateCopyCandidates(file, project.checker);
		queryMs += performance.now() - start;
		const found = findAddedCopyViolations(file, null, {
			stateCandidates,
			templateSinks: true,
		});
		assert.equal(found.length, count, JSON.stringify(found));
		for (const finding of found) {
			assert.ok(finding.kind.startsWith("state:"));
			assert.equal(finding.text, "unknown");
			assert.equal(
				finding.line,
				file.getLineAndCharacterOfPosition(
					stateCandidates
						.find((candidate) => candidate.kind === finding.kind)
						.literal.getStart(file),
				).line + 1,
			);
		}
		// Same source and old entry point prove these findings are new flow coverage.
		assert.deepEqual(
			findAddedCopyViolations(file, null, { templateSinks: true }),
			[],
		);
	});
test("delta paths, deduplication and no raw-token restoration", () => {
	const { project, file } = parsed(2);
	const stateCandidates = findStateCopyCandidates(file, project.checker);
	for (const line of [4, 5, 6, 7]) {
		const found = findAddedCopyViolations(file, new Set([line]), {
			stateCandidates,
			restore: () => "raw text existed",
		});
		assert.deepEqual(found, [{ line, kind: "state:setter", text: "unknown" }]);
	}
	assert.deepEqual(
		findAddedCopyViolations(file, new Set(), { stateCandidates }),
		[],
	);
	assert.equal(
		findAddedCopyViolations(file, null, {
			stateCandidates: [...stateCandidates, ...stateCandidates],
		}).length,
		1,
	);
});
test("compiler lookup failures are errors, not absent coverage", () => {
	const { file } = parsed(0);
	assert.throws(
		() =>
			findStateCopyCandidates(file, {
				getSymbolAtLocation() {
					throw new Error("compiler unavailable");
				},
			}),
		COMPILER_ERROR_RE,
	);
	assert.throws(
		() =>
			findStateCopyCandidates(file, {
				getSymbolAtLocation() {
					return [];
				},
			}),
		INCOMPLETE_RE,
	);
});
after(() =>
	console.log(
		JSON.stringify({
			stateFixtureCount: cases.length,
			stateDiscoveryMs: queryMs,
			maxRssKiB: process.resourceUsage().maxRSS,
		}),
	),
);
