#!/usr/bin/env node
/**
 * The steps that read a gate's exit status must not read a SILENCE as a pass.
 *
 * WHY THIS FILE EXISTS. Every gate script in this repository answers on stdout and
 * exits on its verdict, and its consumers in `.github/workflows/` read the exit
 * status alone. So "the gate ran and found nothing to complain about" and "the
 * gate never ran" reached the runner as the same two facts: exit 0, nothing
 * printed. That was the shipped behaviour of nine scripts, because they resolved
 * their own entry point lexically and an invocation through a symlinked directory
 * loaded the file, ran nothing and exited 0. `scripts/entry-point.mjs` fixes the
 * scripts, and `scripts/require-report.sh` is what the steps now run them through:
 * it refuses an exit-0-with-no-output instead of passing it.
 *
 * WHY THE STEP IS DRIVEN, NOT DESCRIBED. The helper is real bash and the property
 * is about what bash does with a failed command under the runner's default shell
 * (`bash -e {0}` — no `defaults.run.shell` is set anywhere in this directory), so
 * every case below executes it and reads its actual status and bytes. The last test
 * reads the checked-in YAML and asserts that every step which runs one of these
 * gates actually goes through the helper, so a new step added beside the covered
 * ones cannot quietly read a silence as a pass.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPTS = dirname(
	fileURLToPath(new URL("./entry-point.mjs", import.meta.url)),
);
const HELPER = join(SCRIPTS, "require-report.sh");
const WORKFLOW_DIR = join(SCRIPTS, "..", ".github", "workflows");

/**
 * Run the helper the way a step does — `bash scripts/require-report.sh ...` — and
 * report the step's own outcome: its status and the two streams, kept apart because
 * the runner shows both.
 */
function runStep(args, { cwd } = {}) {
	const result = spawnSync("bash", [HELPER, ...args], {
		cwd,
		encoding: "utf8",
	});
	return {
		status: result.status,
		stdout: result.stdout,
		stderr: result.stderr,
	};
}

/** A gate whose behaviour is the argument, run through the helper for real. */
function withGate(body, fn) {
	const dir = mkdtempSync(join(tmpdir(), "require-report-gate-"));
	const gate = join(dir, "gate.sh");
	writeFileSync(gate, `#!/usr/bin/env bash\nset -uo pipefail\n${body}\n`);
	try {
		return fn(["Stub gate", "bash", gate], { cwd: dir });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

test("a gate that answers is passed through untouched", () =>
	withGate(
		`echo "checked 3 things, all present"\nexit 0\n`,
		(args, options) => {
			const step = runStep(args, options);
			assert.equal(step.status, 0);
			assert.match(step.stdout, /checked 3 things, all present/);
			assert.doesNotMatch(step.stdout, /produced no report/);
		},
	));

test("a gate that succeeds and says nothing is refused, not read as a pass", () =>
	// The defect's exact signature, which the repository shipped from nine scripts:
	// a script that loads, runs nothing and exits 0. A step that passed it was green
	// having checked nothing, and QA reproduced a FAILING artifact gate becoming a
	// PASSING one that way.
	withGate(`# runs nothing\n`, (args, options) => {
		const step = runStep(args, options);
		assert.equal(step.status, 1);
		assert.match(step.stdout, /::error title=Stub gate produced no report::/);
		assert.match(step.stdout, /exited 0 without printing anything/);
	}));

test("a gate's refusal keeps its reason and its own status", () =>
	// The other half: a refusal PRINTS. Losing its text while keeping the red status
	// is how `version-bump-guard.yml`'s step failed review round 1 of #210 - the
	// annotation a reviewer was meant to read was the part that vanished.
	withGate(
		`echo "::error file=package.json::a feature PR must not change the version"\nexit 1\n`,
		(args, options) => {
			const step = runStep(args, options);
			assert.equal(step.status, 1);
			assert.match(step.stdout, /must not change the version/);
			assert.doesNotMatch(step.stdout, /produced no report/);
		},
	));

test("a silent FAILURE is not re-read as a silence", () =>
	// The emptiness check must not turn a crash into a different verdict: the gate's
	// own status is what the job goes red on, and the helper adds nothing to it.
	withGate(`exit 3\n`, (args, options) => {
		const step = runStep(args, options);
		assert.equal(step.status, 3);
		assert.doesNotMatch(step.stdout, /produced no report/);
	}));

test("a gate that dies with output keeps both", () =>
	withGate(
		`echo "guard: could not read the base commit" >&2\nexit 2\n`,
		(args, options) => {
			const step = runStep(args, options);
			assert.equal(step.status, 2);
			// stderr is folded into the step's single stream, which is where a reader and
			// the runner both look.
			assert.match(step.stdout, /could not read the base commit/);
		},
	));

test("the helper refuses to be called wrong rather than passing silently", () => {
	// A caller that forgot the command is a defect in the step. Passing 0 here would
	// make the misuse indistinguishable from a gate that passed.
	const step = runStep(["Only a name"]);
	assert.equal(step.status, 2);
	assert.match(step.stdout, /::error title=require-report\.sh misused::/);
});

test("the real Runtime Dependencies gate runs through the helper", () => {
	// One real gate, end to end: the helper's exit status and its output are the
	// script's, so `ci.yml`'s step reads the allowlist check rather than a wrapper's
	// opinion of it.
	const step = runStep([
		"Runtime dependency allowlist",
		"node",
		join(SCRIPTS, "check-runtime-deps.mjs"),
	]);
	assert.equal(step.status, 0);
	assert.match(
		step.stdout,
		/production dependencies, all on the runtime allowlist/,
	);
});

/**
 * The gates whose ONLY consumer is an exit status, spelled as the workflows spell
 * them. The `pnpm` alternatives are patterns rather than names because pnpm inserts
 * its own output ahead of the script's, so the steps run them as
 * `pnpm --silent <name>` — see the banner assertion below, which is the other half
 * of this test.
 */
const STATUS_ONLY_GATES = {
	"check-packaged-closure.mjs": [/scripts\/check-packaged-closure\.mjs/],
	"verify-macos-artifacts.mjs": [
		/scripts\/verify-macos-artifacts\.mjs/,
		/pnpm(?:\s+-{1,2}[\w=.-]+)*\s+verify-macos-artifacts\b/,
	],
	"notarize-artifacts.mjs": [
		/scripts\/notarize-artifacts\.mjs/,
		/pnpm(?:\s+-{1,2}[\w=.-]+)*\s+notarize-dmg\b/,
	],
	"check-runtime-deps.mjs": [/scripts\/check-runtime-deps\.mjs/],
};

/**
 * A pnpm invocation of a gate WITHOUT `--silent`.
 *
 * WHY THIS IS A DEFECT AND NOT A STYLE CHOICE. pnpm prints its own banner before
 * the script runs:
 *
 *   > local-operator-ui@0.24.1 verify-macos-artifacts /path/to/the/checkout
 *   > node scripts/verify-macos-artifacts.mjs
 *
 * and `require-report.sh` decides "did the gate answer?" from the step's whole
 * stream, so the banner answers for it. Measured against an empty module in the
 * gate's place: `pnpm verify-macos-artifacts` passed the wrapped step (exit 0, 173
 * bytes of banner), `pnpm --silent verify-macos-artifacts` and a direct `node`
 * invocation both refused it (exit 1, `::error ... produced no report::`).
 */
const PNPM_GATE_WITHOUT_SILENT =
	/pnpm\s+(?:run\s+)?(?:verify-macos-artifacts|notarize-dmg)\b/;

const require_ = createRequire(import.meta.url);
// Through electron-builder's own tree, which is where the only `js-yaml` this
// install can see lives, exactly as `test-publish-workflow.mjs` and
// `test-version-bump-guard.mjs` resolve it.
const builderRequire = createRequire(
	require_.resolve("electron-builder/package.json"),
);
const { load } = createRequire(builderRequire.resolve("app-builder-lib"))(
	"js-yaml",
);

test("every workflow step that runs a status-only gate goes through the helper", () => {
	const seen = [];
	const failures = [];
	for (const file of readdirSync(WORKFLOW_DIR).sort()) {
		if (!/\.ya?ml$/.test(file)) continue;
		const workflow = load(readFileSync(join(WORKFLOW_DIR, file), "utf8"));
		for (const [jobName, job] of Object.entries(workflow.jobs ?? {})) {
			for (const step of job.steps ?? []) {
				if (typeof step.run !== "string") continue;
				for (const [script, aliases] of Object.entries(STATUS_ONLY_GATES)) {
					if (!aliases.some((alias) => alias.test(step.run))) continue;
					const where = `${file} ${jobName} ${step.name ?? "(unnamed step)"}`;
					seen.push(`${where} -> ${script}`);
					if (!/require-report\.sh/.test(step.run))
						failures.push(
							`${where} runs ${script} and reads its exit status alone, so a gate that exited 0 without printing anything would pass it; run it through scripts/require-report.sh`,
						);
					if (PNPM_GATE_WITHOUT_SILENT.test(step.run))
						failures.push(
							`${where} runs a pnpm gate without \`--silent\`: pnpm's banner is output, and it satisfies the helper's emptiness check on behalf of a gate that printed nothing; use \`pnpm --silent <name>\``,
						);
				}
			}
		}
	}
	assert.deepEqual(failures, []);
	// The count is the point, as in the sparse-checkout test this mirrors: a step
	// that stopped matching would mean this test stopped looking at it without
	// saying so.
	assert.ok(
		seen.length >= 6,
		`only ${seen.length} status-only gate invocations found across .github/workflows; expected at least 6 (the three closure checks and the two macOS gates in publish.yml, the three in signed-update-candidate.yml, and ci.yml's runtime-deps job). Found: ${seen.join(", ")}`,
	);
});
