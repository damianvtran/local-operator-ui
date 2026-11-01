/**
 * The onboarding copy contract, in four executable layers.
 *
 * WHY IT IS SHAPED THIS WAY (rounds R1-1 and R2): candidate copies of this
 * contract used whole-file substring searches, proximity look-backs and
 * placeholder checks against their own expected string - none of them BIND.
 * A comment can satisfy a substring; a moved or reversed branch can satisfy
 * proximity; a parameter object can be absent while its key is present. Each
 * such counterexample passed that shape, so this file uses the shapes that
 * kill them:
 *
 *   1. VALUE PINS - all 47 committed English sentences, stated inline, never
 *      read from the catalogue as their own oracle. The key set is closed.
 *   2. CALL-SITE BINDING lives in `scripts/i18n/check-strings.test.mjs`:
 *      the binding contract (real `t()` call nodes, exact producers, branch
 *      arms, live anchor) reuses that suite's existing `fixtureApi.snapshot`.
 *      This file stays API-free: pins and render. The relocation is NOT a
 *      demonstrated CI cure or causal diagnosis: the Linux Desktop job still
 *      exceeded its execution ceiling with this structure (#1002).
 *   3. LIVE RENDER - the shipped components, bundled with the repo's own
 *      esbuild and rendered with the real React server renderer (the pattern
 *      QA's independent probe established): the full committed sentences come
 *      out of the actual render, with no extra fragments; the anchor's `href`
 *      attribute and caption come off the rendered markup; the summary names
 *      the brand its producer computes; parameters render as escaped text,
 *      never markup.
 *
 * WHAT IT CANNOT PROVE: geometry, interaction, non-English locales, or the
 * full app around these components (SSR of the components in a fixture, not
 * the App). Those remain the render suites', QA's and the design round's.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { UNGATED_JOBS } from "./ci-scope.mjs";
import {
	BASE as DIAGNOSTIC_BASE,
	classify,
	safeArgv,
	validOutput,
	validPath,
	validSha,
} from "./onboarding-desktop-diagnostic.mjs";

const CATALOGUE = "src/i18n/catalogues/en/ui.onboarding.json";
const BASE = "src/renderer/src/features/onboarding/components/";

/** key -> [committed English (byte-exact), wiring file]. */
const CONTRACT = [
	[
		"ui.onboarding.connect.intro",
		"Local Operator needs an AI account to work. Radient is the easiest: one browser sign-in and nothing to paste. Already pay for ChatGPT or Claude? Sign in with that instead. Anything else is under More providers.",
		"steps/connect-provider-step.tsx",
	],
	[
		"ui.onboarding.default_model.block.loading_models",
		"Loading the model list…",
		"steps/default-model-plan.ts",
	],
	[
		"ui.onboarding.default_model.block.pick_a_model",
		"Pick a model to continue.",
		"steps/default-model-plan.ts",
	],
	[
		"ui.onboarding.default_model.change",
		"Change",
		"steps/default-model-step.tsx",
	],
	[
		"ui.onboarding.default_model.connected_pick",
		"{brand} is connected. Pick the model new chats should use.",
		"steps/default-model-step.tsx",
	],
	[
		"ui.onboarding.default_model.empty_helper",
		"No providers are connected yet. Go back a step to connect one.",
		"steps/default-model-step.tsx",
	],
	[
		"ui.onboarding.default_model.fallback_name",
		"{brand}'s default model",
		"steps/default-model-step.tsx",
	],
	[
		"ui.onboarding.default_model.intro",
		"New chats use this model. Every agent can pick a different one later.",
		"steps/default-model-step.tsx",
	],
	[
		"ui.onboarding.default_model.loading",
		"Loading your models",
		"steps/default-model-step.tsx",
	],
	[
		"ui.onboarding.default_model.none_connected",
		"No provider is connected yet. Go back to connect one, or skip setup and connect one later from the chat.",
		"steps/default-model-step.tsx",
	],
	[
		"ui.onboarding.default_model.nothing_saved",
		"Nothing will be saved: your Local Operator can't list {brand} models yet, so setup finishes without a default model. Pick one in Settings before your first message.",
		"steps/default-model-step.tsx",
	],
	[
		"ui.onboarding.default_model.provider_fallback",
		"this provider's",
		"steps/default-model-step.tsx",
	],
	[
		"ui.onboarding.default_model.tag.applied",
		"your default",
		"steps/default-model-step.tsx",
	],
	[
		"ui.onboarding.default_model.tag.suggested",
		"suggested for your account",
		"steps/default-model-step.tsx",
	],
	["ui.onboarding.dialog.setup", "Setup", "onboarding-dialog.tsx"],
	[
		"ui.onboarding.extras.greeting_done",
		"{name} is your chief of staff. Her conversation is where you pick up with her, and it is one keystroke away in the sidebar. You can also skip straight to a new chat.",
		"steps/extras-step.tsx",
	],
	[
		"ui.onboarding.extras.greeting_owed",
		"{name} is your chief of staff. She will say hello first, ask what to call you and what you would like help with, and show you around. You can also skip straight to a new chat.",
		"steps/extras-step.tsx",
	],
	[
		"ui.onboarding.extras.next_meet",
		"Next: meet {name}",
		"steps/extras-step.tsx",
	],
	["ui.onboarding.modal.action.back", "Back", "onboarding-modal.tsx"],
	["ui.onboarding.modal.action.continue", "Continue", "onboarding-modal.tsx"],
	["ui.onboarding.modal.action.finish", "Finish", "onboarding-modal.tsx"],
	["ui.onboarding.modal.action.meet", "Meet {name}", "onboarding-modal.tsx"],
	["ui.onboarding.modal.action.skip", "Skip", "onboarding-modal.tsx"],
	[
		"ui.onboarding.modal.action.skip_for_now",
		"Skip for now",
		"onboarding-modal.tsx",
	],
	[
		"ui.onboarding.modal.action.skip_to_chat",
		"Skip to chat",
		"onboarding-modal.tsx",
	],
	[
		"ui.onboarding.modal.error.aida_open_failed",
		"{name}'s conversation could not be opened, so you are in a new chat instead.",
		"onboarding-modal.tsx",
	],
	[
		"ui.onboarding.modal.step_of",
		"Step {current, number, ::group-off} of {total, number, ::group-off}",
		"onboarding-modal.tsx",
	],
	[
		"ui.onboarding.modal.steps_total",
		"{total, plural, one {{total, number, ::group-off} step} other {{total, number, ::group-off} steps}}",
		"onboarding-modal.tsx",
	],
	[
		"ui.onboarding.modal.title.connect_provider",
		"Connect an AI account",
		"onboarding-modal.tsx",
	],
	[
		"ui.onboarding.modal.title.default_model",
		"Your default model",
		"onboarding-modal.tsx",
	],
	[
		"ui.onboarding.modal.title.extras",
		"Web search (optional)",
		"onboarding-modal.tsx",
	],
	[
		"ui.onboarding.modal.title.extras_with_name",
		"Web search, then meet {name}",
		"onboarding-modal.tsx",
	],
	[
		"ui.onboarding.modal.title.fallback",
		"First-time setup",
		"onboarding-modal.tsx",
	],
	[
		"ui.onboarding.search.each_key_saved",
		"Each key is saved on your device as soon as you leave its field.",
		"steps/search-api-step.tsx",
	],
	[
		"ui.onboarding.search.intro",
		"Agents can look things up while they work — today's prices, this week's news — instead of relying on what the model already knows.",
		"steps/search-api-step.tsx",
	],
	["ui.onboarding.search.mode.free", "Free", "steps/search-api-step.tsx"],
	[
		"ui.onboarding.search.mode.free_detail",
		"Uses a rotating pool of free providers — DuckDuckGo, Tavily's free tier, Exa and Parallel. No key needed; the pool is shared, so searches can be slower at busy times.",
		"steps/search-api-step.tsx",
	],
	[
		"ui.onboarding.search.mode.keys",
		"Add API keys",
		"steps/search-api-step.tsx",
	],
	[
		"ui.onboarding.search.mode.keys_detail",
		"Bring your own keys for the search providers you use.",
		"steps/search-api-step.tsx",
	],
	[
		"ui.onboarding.search.mode.label",
		"Search setup",
		"steps/search-api-step.tsx",
	],
	[
		"ui.onboarding.search.recommended",
		"Recommended",
		"steps/search-api-step.tsx",
	],
	[
		"ui.onboarding.search.row.get_your",
		"Get your {name}",
		"steps/search-api-step.tsx",
	],
	[
		"ui.onboarding.search.row.not_saved",
		"Not saved — {message}",
		"steps/search-api-step.tsx",
	],
	[
		"ui.onboarding.search.row.placeholder",
		"Paste your API key",
		"steps/search-api-step.tsx",
	],
	[
		"ui.onboarding.search.row.save_failed",
		"The key could not be saved.",
		"steps/search-api-step.tsx",
	],
	["ui.onboarding.search.row.saved", "Saved", "steps/search-api-step.tsx"],
	[
		"ui.onboarding.search.row.saving",
		"Saving {name}",
		"steps/search-api-step.tsx",
	],
];

/**
 * key -> [[parameter name, exact producer expression source]] for the 14
 * parameterised messages. The expressions are the committed call-site
 * producers, compared as AST slices with whitespace normalised: a comment
 * decoy cannot satisfy a node, and a same-shape wrong producer (a different
 * `brandOf(...)` argument) is a different node.
 */
const PARAM_SITES = [
	["ui.onboarding.modal.title.extras_with_name", [["name", "aidaName"]]],
	["ui.onboarding.modal.action.meet", [["name", "aidaName"]]],
	["ui.onboarding.modal.error.aida_open_failed", [["name", "aidaName"]]],
	[
		"ui.onboarding.modal.step_of",
		[
			["current", "activeIndex + 1"],
			["total", "STEP_SEQUENCE.length"],
		],
	],
	["ui.onboarding.modal.steps_total", [["total", "STEP_SEQUENCE.length"]]],
	["ui.onboarding.extras.next_meet", [["name", "aidaName"]]],
	["ui.onboarding.extras.greeting_owed", [["name", "aidaName"]]],
	["ui.onboarding.extras.greeting_done", [["name", "aidaName"]]],
	[
		"ui.onboarding.default_model.connected_pick",
		[["brand", "brandOf(choice.provider)"]],
	],
	[
		"ui.onboarding.default_model.fallback_name",
		[["brand", "choice.provider ? brandOf(choice.provider) : choice.hosting"]],
	],
	[
		"ui.onboarding.default_model.nothing_saved",
		[
			[
				"brand",
				'shownRow ? brandOf(shownRow) : t("ui.onboarding.default_model.provider_fallback")',
			],
		],
	],
	["ui.onboarding.search.row.not_saved", [["message", "message"]]],
	["ui.onboarding.search.row.saving", [["name", "credential.name"]]],
	["ui.onboarding.search.row.get_your", [["name", "credential.name"]]],
];

/** The three titles that flow through the modal's `stepTitles` table. */
const TABLE_KEYS = [
	"ui.onboarding.modal.title.connect_provider",
	"ui.onboarding.modal.title.default_model",
	"ui.onboarding.modal.title.extras",
];

const PLAN_KEYS = {
	"ui.onboarding.default_model.block.pick_a_model": "PICK_A_MODEL_KEY",
	"ui.onboarding.default_model.block.loading_models": "LOADING_MODELS_KEY",
};

const value = (key) => CONTRACT.find(([k]) => k === key)[1];

// Diagnostic evidence belongs to this contract, not to the product: these
// small invariants protect its optional Linux comparison without changing any
// copy/AST/render predicate. The selected Linux workload excludes these tests.
test("diagnostic inputs and result classifications fail closed", () => {
	assert.equal(validSha(DIAGNOSTIC_BASE), DIAGNOSTIC_BASE);
	for (const sha of [
		"HEAD",
		"-h",
		`${DIAGNOSTIC_BASE};echo bad`,
		"0".repeat(39),
	]) {
		assert.throws(() => validSha(sha));
	}
	assert.equal(
		validPath("scripts/i18n/check-strings.test.mjs"),
		"scripts/i18n/check-strings.test.mjs",
	);
	for (const path of [
		"../package.json",
		"/absolute",
		"--help",
		"scripts/../secret",
		"scripts/x\n",
	]) {
		assert.throws(() => validPath(path));
	}
	assert.throws(() => validOutput(process.cwd(), tmpdir()));
	assert.throws(() =>
		validOutput(join(process.cwd(), "diagnostic-output"), process.cwd()),
	);
	assert.throws(() =>
		validOutput(join(tmpdir(), "..", "wrong-root", "trace"), tmpdir()),
	);
	assert.deepEqual(
		safeArgv([
			"/usr/bin/node",
			"--token=private",
			"--test-name-pattern=secret",
		]),
		["node", "[redacted]", "--test-name-pattern=[selected]"],
	);
	assert.equal(classify(0, null, false, null, true), "completed");
	assert.equal(classify(0, null, false, null, false), "missing-summary");
	assert.equal(
		classify(1, null, false, null, false),
		"assertion-or-launch-failure",
	);
	assert.equal(classify(137, null, false, null, false), "unattributed-sigkill");
	assert.equal(classify(137, null, false, null, false, true), "memory-bound");
	assert.equal(classify(0, null, true, null, true), "wall-bound");
	assert.equal(classify(0, null, false, "SIGTERM", true), "interrupted");
});

const WIRED_SHARD_COMMAND =
	'node scripts/desktop-test-shards.mjs run --head "$DESKTOP_REQUESTED_HEAD" --checkout "$CHECKOUT_SHA" --index "$DESKTOP_SHARD_INDEX" 2>&1 | tee /tmp/desktop-tests.log || SUITE_RC=$?';
const DESKTOP_SUPERVISOR_STATE =
	'"${{ runner.temp }}/desktop-supervisor-${{ matrix.shard }}"';
const DESKTOP_AWAIT_COMMAND =
	'node scripts/desktop-suite-checkpoints.mjs await "$state"';
const DESKTOP_REAP_COMMAND =
	'node scripts/desktop-suite-checkpoints.mjs reap "$state"';

/**
 * The suite step SUPERVISES the await instead of wrapping it, because a
 * `timeout` around one `node ... await` did not end this step in run
 * 124822720325: the job was cancelled at its cap with no 124 arm, no annotation
 * and no census. So the step starts the await in the background, owns the wall
 * clock in bash, forwards the await's bytes by offset (TAP exactly once), puts
 * the census rows in the job log where a cancelled job still has them, reaps on
 * expiry, and takes the verdict from the awaited process. Each clause below is
 * one of those guarantees, and the mutants in the test prove none of them can be
 * removed while every other clause still passes.
 */
function assertSupervisingAwait(run, state = DESKTOP_SUPERVISOR_STATE) {
	const awaitCommand =
		'node scripts/desktop-suite-checkpoints.mjs await "$state"';
	const lines = run.split("\n").map((line) => line.trim());
	const started = lines.filter((line) => line.includes(awaitCommand));
	assert.equal(started.length, 1, "exactly one awaited supervisor invocation");
	assert.equal(
		run.split("desktop-suite-checkpoints.mjs await").length - 1,
		1,
		"no second await may hide anywhere in the step",
	);
	assert.ok(
		started[0].endsWith("&"),
		"the await must start in the background, or the step has no stdout to report with",
	);
	assert.ok(
		run.includes(`state=${state}`),
		"the step must name the supervisor's state directory",
	);
	const bound = /DESKTOP_SUITE_BOUND_S:-(\d+)\}/u.exec(run)?.[1];
	assert.ok(bound, "the step must own a `DESKTOP_SUITE_BOUND_S` bound");
	assert.ok(
		/while kill -0 "\$await_pid"/u.test(run),
		"the loop must watch the await rather than block on it",
	);
	assert.ok(
		/\[ \$\(\(now - started\)\) -ge "\$bound" \]/u.test(run),
		"the loop must measure the wall clock against its own bound",
	);
	assert.ok(
		run.includes("tail -c +$((offset + 1))"),
		"forwarded TAP must be byte-offset based, so nothing is emitted twice",
	);
	assert.ok(
		run.includes("census: $row"),
		"census rows must go into the job log, where a cancelled job still has them",
	);
	// Expiry: reap what the launch published, stop the await, fail closed. The
	// slice ends at `exit 124` inclusive: a slice running to the end of the step
	// would also contain the normal path's reap and could not tell them apart.
	const expiry = run.indexOf('if [ -n "$bound_hit" ]');
	assert.ok(expiry >= 0, "the bound must have its own branch");
	const expiryBody = run.slice(
		expiry,
		run.indexOf("exit 124") + "exit 124".length,
	);
	assert.ok(
		expiryBody.includes(DESKTOP_REAP_COMMAND),
		"expiry must reap the recorded groups",
	);
	assert.ok(
		expiryBody.includes('kill -9 "$await_pid"'),
		"expiry must stop the await it gave up on",
	);
	assert.ok(
		expiryBody.includes("exit 124"),
		"expiry must fail the step closed",
	);
	// The verdict is the supervisor's, never the loop's.
	assert.ok(
		run.includes('wait "$await_pid"'),
		"the verdict must come from the await, not from this loop",
	);
	assert.ok(
		run.indexOf("status=$?") > run.indexOf('wait "$await_pid"'),
		"the status must be captured after the await is waited on",
	);
	assert.equal(
		run.trimEnd().split("\n").pop().trim(),
		'exit "$status"',
		"the captured status must be the block's last statement, with nothing appended",
	);
	assert.deepEqual(
		lines.filter((line) => line.startsWith("exit ")),
		["exit 124", 'exit "$status"'],
		"the step may exit only at expiry (124) and with the verdict it was given",
	);
	const annotation = lines.find((line) => line.startsWith('echo "::error::'));
	assert.ok(
		annotation,
		"a deadline must be annotated, so the hang names its reason",
	);
	assert.ok(
		annotation.includes("${bound}s external bound"),
		"the 124 annotation must name the external bound that fired, through the same variable, so moving the bound cannot leave a stale number",
	);
	for (const line of started) {
		assert.ok(
			!/\|\||\btrue\b/u.test(line),
			"the awaited command must not carry a success fallback",
		);
	}
	return run;
}

function assertRetiredDesktopRoute(
	job,
	shell = readFileSync("scripts/desktop-suite-step.sh", "utf8"),
) {
	const launch = job.steps.filter((step) => step.id === "desktop_launch");
	const final = job.steps.filter((step) => step.id === "desktop_suite");
	assert.equal(launch.length, 1);
	assert.equal(final.length, 1);
	assert.equal(launch[0].if, undefined);
	assert.equal(
		final[0].if,
		"${{ always() && steps.desktop_launch.outcome == 'success' }}",
	);
	const state = DESKTOP_SUPERVISOR_STATE;
	assert.equal(
		launch[0].run,
		`node scripts/desktop-suite-checkpoints.mjs launch ${state} scripts/desktop-suite-step.sh "$DESKTOP_SETUP_STARTED_MS"`,
	);
	/*
	 * A `timeout` around one `await` did not end this step (run 124822720325 was
	 * cancelled at its cap with no 124 arm and no census), so the step now
	 * supervises the await itself. That changes the step's TEXT, not its verdict:
	 * `assertSupervisingAwait` asserts the new guarantees, and the mutants below
	 * prove this contract still rejects the defects each clause exists for.
	 */
	assertSupervisingAwait(final[0].run);
	assert.ok(job.steps.indexOf(launch[0]) < job.steps.indexOf(final[0]));
	assert.equal(job["timeout-minutes"], 50);
	assert.equal(final[0]["timeout-minutes"], 45);
	assert.equal(job.env.DESKTOP_SHARD_INDEX, "${{ matrix.shard }}");
	assert.equal(
		job.env.DESKTOP_REQUESTED_HEAD,
		"${{ github.event.pull_request.head.sha || github.sha }}",
	);
	for (const step of [launch[0], final[0]])
		assert.equal(
			step.env.LOCAL_OPERATOR_UI_LANE_DIAGNOSTICS,
			"${{ runner.temp }}/desktop-lifecycle-${{ matrix.shard }}.jsonl",
		);
	const lines = shell.split(/\r?\n/).map((line) => line.trim());
	// Comments and echoed command text are not reachable suite invocations.
	assert.deepEqual(
		lines.filter((line) =>
			/^node scripts\/desktop-test-shards\.mjs run\b/.test(line),
		),
		[WIRED_SHARD_COMMAND],
	);
	assert.deepEqual(
		lines.filter((line) => line.startsWith("CHECKOUT_SHA=")),
		["CHECKOUT_SHA=$(git rev-parse HEAD)"],
	);
	return shell;
}

test("diagnostic CI stays retired while the manual utility remains registered", () => {
	const text = readFileSync(".github/workflows/ci.yml", "utf8");
	// Use the tree's existing YAML parser, as the canonical CI/entry-point
	// guards do. Comments or source substrings are not workflow jobs.
	const require = createRequire(import.meta.url);
	const builderRequire = createRequire(
		require.resolve("electron-builder/package.json"),
	);
	const appRequire = createRequire(builderRequire.resolve("app-builder-lib"));
	const { load } = appRequire("js-yaml");
	const workflow = load(text);
	assert.ok(
		!Object.hasOwn(workflow.jobs, "onboarding-desktop-diagnostic"),
		"the temporary CI job must remain retired",
	);
	assert.ok(
		!Object.hasOwn(UNGATED_JOBS, "onboarding-desktop-diagnostic"),
		"retirement must remove the actual CI-only inventory entry",
	);

	// The private driven registry is looked up by its existing real CLI/import
	// case, not inferred from source comments or a blanket exemption. Run only
	// that narrow case; dropping its registry entry or test must fail closed.
	const manualEnvironment = Object.fromEntries(
		Object.entries(process.env).filter(
			([key]) =>
				!key.startsWith("CMUX_") &&
				!key.startsWith("LOP_") &&
				!["XPC_FLAGS", "NODE_OPTIONS", "NODE_TEST_CONTEXT"].includes(key),
		),
	);
	const manual = spawnSync(
		process.execPath,
		[
			"scripts/run-desktop-tests.mjs",
			"--test-concurrency=1",
			"--test-reporter=tap",
			"--test-name-pattern=^onboarding diagnostic distinguishes driven CLI from import through physical and symlinked paths$",
			"scripts/entry-point.test.mjs",
		],
		{
			encoding: "utf8",
			env: {
				...manualEnvironment,
				LOCAL_OPERATOR_UI_TEST_MEMORY_BUDGET_MB: "480",
			},
			timeout: 20_000,
		},
	);
	assert.equal(manual.status, 0, manual.stdout + manual.stderr);
	assert.ok(
		/^# tests 1$/m.test(manual.stdout) &&
			/^# pass 1$/m.test(manual.stdout) &&
			/^# fail 0$/m.test(manual.stdout),
		"exactly one registered manual CLI/import case must execute, not silently skip",
	);
	// Extraction changed the location, not the retirement/inventory contract.
	// Prove the real YAML route before counting the preserved shell's command.
	const shell = assertRetiredDesktopRoute(workflow.jobs.test);
	for (const mutate of [
		(job) => {
			job.steps = job.steps.filter((s) => s.id !== "desktop_launch");
		},
		(job) => {
			job.steps.push(
				structuredClone(job.steps.find((s) => s.id === "desktop_launch")),
			);
		},
		(job) => {
			job.steps.find((s) => s.id === "desktop_launch").run =
				"echo scripts/desktop-suite-step.sh";
		},
		(job) => {
			job.steps.find((s) => s.id === "desktop_launch").run = job.steps
				.find((s) => s.id === "desktop_launch")
				.run.replace("scripts/desktop-suite-step.sh", "scripts/unwired.sh");
		},
		(job) => {
			job.steps = job.steps.filter((s) => s.id !== "desktop_suite");
		},
		(job) => {
			job.steps.find((s) => s.id === "desktop_suite").run = "true";
		},
	]) {
		const bad = structuredClone(workflow.jobs.test);
		mutate(bad);
		assert.throws(() => assertRetiredDesktopRoute(bad, shell));
	}
	// The wrapped await IS the step's guarantee surface, so the defects it exists
	// for must fail THIS contract and not merely a helper: an unwrapped await (the
	// shape before the external bound), a second await, a swallowed status, a 124
	// arm that no longer names the bound, and a fallback appended after the exit.
	// Each mutant is first proved to have changed the run, so a no-op replacement
	// cannot pass itself off as evidence that the check still bites.
	const finalStep = workflow.jobs.test.steps.find(
		(step) => step.id === "desktop_suite",
	);
	for (const [mutateRun, rejectedBy] of [
		// The step's own clock, and the bound it measures against.
		[
			(run) =>
				run.replace('bound="${DESKTOP_SUITE_BOUND_S:-2400}"', 'bound=""'),
			/`DESKTOP_SUITE_BOUND_S` bound/u,
		],
		[
			(run) =>
				run.replaceAll('[ $((now - started)) -ge "$bound" ]', "[ 0 -ge 1 ]"),
			/wall clock against its own bound/u,
		],
		// One invocation, started in the background.
		[
			(run) =>
				run.replace(
					`${DESKTOP_AWAIT_COMMAND} >"$await_out" 2>&1 &`,
					`${DESKTOP_AWAIT_COMMAND} >"$await_out" 2>&1 &\n${DESKTOP_AWAIT_COMMAND} >"$await_out" 2>&1 &`,
				),
			/exactly one awaited supervisor invocation/u,
		],
		[
			(run) =>
				run.replace(
					`${DESKTOP_AWAIT_COMMAND} >"$await_out" 2>&1 &`,
					`${DESKTOP_AWAIT_COMMAND} >"$await_out" 2>&1`,
				),
			/start in the background/u,
		],
		// TAP exactly once, and the census where a cancelled job can see it.
		[
			(run) => run.replaceAll("tail -c +$((offset + 1))", "cat"),
			/byte-offset based/u,
		],
		[
			(run) => run.replace("census: $row", "$row"),
			/census rows must go into the job log/u,
		],
		// Expiry: reap, stop the await, and fail closed - and only at expiry.
		[
			(run) =>
				run
					.split("\n")
					.filter((line) => !line.trim().startsWith(DESKTOP_REAP_COMMAND))
					.join("\n"),
			/expiry must reap/u,
		],
		[
			(run) => run.replace('kill -9 "$await_pid"', "true"),
			/stop the await it gave up on/u,
		],
		// The verdict is the supervisor's, not the loop's.
		[
			(run) => run.replace('wait "$await_pid"', ":"),
			/verdict must come from the await/u,
		],
		[
			(run) => run.replace('exit "$status"', "exit 0"),
			/block's last statement/u,
		],
		[
			(run) =>
				run
					.split("\n")
					.filter((line) => !line.trim().startsWith('echo "::error::'))
					.join("\n"),
			/a deadline must be annotated/u,
		],
		[
			(run) => run.replace("${bound}s external bound", "the deadline"),
			/bound that fired/u,
		],
		[(run) => `${run}true\n`, /block's last statement/u],
	]) {
		const bad = structuredClone(workflow.jobs.test);
		const step = bad.steps.find((s) => s.id === "desktop_suite");
		step.run = mutateRun(finalStep.run);
		assert.notEqual(
			step.run,
			finalStep.run,
			"each supervising-step mutant must actually change the step",
		);
		assert.throws(
			() => assertRetiredDesktopRoute(bad, shell),
			rejectedBy,
			"a supervising-step defect must fail the clause that exists for it",
		);
	}
	for (const bad of [
		shell.replace(WIRED_SHARD_COMMAND, ""),
		`${shell}\n${WIRED_SHARD_COMMAND}\n`,
		shell.replace(WIRED_SHARD_COMMAND, `# ${WIRED_SHARD_COMMAND}`),
		shell.replace(WIRED_SHARD_COMMAND, `echo '${WIRED_SHARD_COMMAND}'`),
	])
		assert.throws(() => assertRetiredDesktopRoute(workflow.jobs.test, bad));
	const shardSource = readFileSync("scripts/desktop-test-shards.mjs", "utf8");
	assert.ok(shardSource.includes('pkg.scripts?.["test:desktop"]'));
	assert.ok(shardSource.includes("[RUNNER, ...expected.shards[index]]"));
});

test("diagnostic tracer records actual isolated workers without environment values", () => {
	// Hosted CI's OS temp directory and runner-owned temp root can be disjoint.
	// Allocate beneath the guard's configured root, canonicalize that SAME root,
	// and pass it explicitly to the child: changing the guard would hide this
	// named fixture/environment failure. This is not a diagnosis or cure of the
	// full Desktop job's later execution-ceiling cancellation.
	const temporaryRoot = realpathSync(process.env.RUNNER_TEMP ?? tmpdir());
	const scenario = mkdtempSync(join(temporaryRoot, "onboarding-diagnostic-"));
	try {
		// Ambient omitted/equal roots previously accepted the old allocation.
		// Seed disjoint canonical roots for the REAL worker every time, without
		// mutating process.env or importing a copied version of this module.
		const osTemporaryRoot = join(scenario, "os-temp");
		const runnerTemporaryRoot = join(scenario, "runner-temp");
		mkdirSync(osTemporaryRoot);
		mkdirSync(runnerTemporaryRoot);
		const fixtureEnvironment = {
			TMPDIR: realpathSync(osTemporaryRoot),
			RUNNER_TEMP: realpathSync(runnerTemporaryRoot),
		};
		const scratch = mkdtempSync(
			join(fixtureEnvironment.RUNNER_TEMP, "worker-"),
		);
		const fixture = join(scratch, "passes.test.mjs");
		const map = join(scratch, "populated-map.json");
		const trace = join(scratch, "trace");
		const replacement = '{"diagnostic":"nonempty-overlay"}';
		// Empty maps never reached the broken read boundary on #1002. This
		// fixture uses the shipped fs patch and byte oracle, not a fake reader.
		writeFileSync(map, JSON.stringify({ "package.json": replacement }));
		writeFileSync(
			fixture,
			[
				'import assert from "node:assert/strict";',
				'import {readFileSync, realpathSync} from "node:fs";',
				'import {tmpdir} from "node:os";',
				'import {test} from "node:test";',
				`test("passes", () => {
assert.equal(realpathSync(tmpdir()), ${JSON.stringify(fixtureEnvironment.TMPDIR)});
assert.equal(realpathSync(process.env.RUNNER_TEMP), ${JSON.stringify(fixtureEnvironment.RUNNER_TEMP)});
const actual = readFileSync("package.json", "utf8");
assert.equal(actual, ${JSON.stringify(replacement)});
console.log("OVERLAY_BYTES=" + actual);
});`,
			].join("\n"),
		);
		const env = Object.fromEntries(
			Object.entries(process.env).filter(
				([key]) =>
					!key.startsWith("CMUX_") &&
					!key.startsWith("LOP_") &&
					key !== "NODE_OPTIONS" &&
					key !== "XPC_FLAGS",
			),
		);
		Object.assign(env, fixtureEnvironment, {
			NODE_OPTIONS: `--import=${join(process.cwd(), "scripts/onboarding-desktop-diagnostic.mjs")}`,
			LOCAL_OPERATOR_UI_ONBOARDING_TRACE_DIR: trace,
			LOCAL_OPERATOR_UI_ONBOARDING_MAP: map,
			DIAGNOSTIC_PRIVATE_SENTINEL: "operator-private-value",
			LOCAL_OPERATOR_UI_TEST_MEMORY_BUDGET_MB: "480",
		});
		const result = spawnSync(
			process.execPath,
			["scripts/run-desktop-tests.mjs", "--test-concurrency=1", fixture],
			{ env, encoding: "utf8", timeout: 20_000 },
		);
		assert.equal(result.status, 0, result.stdout + result.stderr);
		assert.ok(
			result.stdout.includes(`OVERLAY_BYTES=${replacement}`),
			result.stdout,
		);
		const text = readdirSync(trace)
			.filter((file) => file.endsWith(".jsonl"))
			.map((file) => readFileSync(join(trace, file), "utf8"))
			.join("");
		const events = text
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		const worker = events.filter(
			(event) =>
				event.worker === true && event.argv.includes("passes.test.mjs"),
		);
		assert.ok(
			worker.some(
				(event) =>
					event.event === "OVERLAY_READ" && event.path === "package.json",
			),
			text,
		);
		for (const kind of ["BEGIN", "END", "TEARDOWN"])
			assert.ok(
				worker.some((event) => event.event === kind),
				`${kind}: ${JSON.stringify(events)}`,
			);
		assert.ok(
			worker.every(
				(event) =>
					Number.isInteger(event.pid) &&
					Number.isInteger(event.ppid) &&
					event.handles.every((type) => typeof type === "string"),
			),
		);
		assert.ok(
			!text.includes("operator-private-value") &&
				!text.includes("DIAGNOSTIC_PRIVATE_SENTINEL"),
		);
	} finally {
		rmSync(scenario, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// 1. Value pins (preserved from R1-1; independently stated, closed set)
// ---------------------------------------------------------------------------

test("every key's committed English is byte-exact in the catalogue, and the set is closed", () => {
	const catalogue = JSON.parse(readFileSync(CATALOGUE, "utf8"));
	assert.deepEqual(
		Object.keys(catalogue).sort(),
		CONTRACT.map(([key]) => key),
		"the catalogue's key set moved from the committed 47",
	);
	for (const [key, expected] of CONTRACT) {
		assert.equal(
			catalogue[key],
			expected,
			`${key} drifted from the committed sentence`,
		);
	}
});

// ---------------------------------------------------------------------------
// 2. AST binding: call sites, producers, branches, the live anchor, tables
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
const repo = process.cwd();

// 3. Live render: the shipped components through the real React SSR.
// ---------------------------------------------------------------------------

const require_ = createRequire(join(repo, "package.json"));
const esbuild = require_("esbuild");
const React = require_("react");
const { renderToStaticMarkup } = require_("react-dom/server");

globalThis.__CONTRACT_REQUIRE__ = (specifier) =>
	require_(
		specifier.startsWith("file:") ? fileURLToPath(specifier) : specifier,
	);

const storage = new Map();
Object.defineProperty(globalThis, "localStorage", {
	configurable: true,
	value: {
		getItem: (key) => storage.get(key) ?? null,
		setItem: (key, val) => storage.set(key, String(val)),
		removeItem: (key) => storage.delete(key),
	},
});

const bundle = await esbuild.build({
	stdin: {
		contents: `
export { ConnectProviderStep } from './src/renderer/src/features/onboarding/components/steps/connect-provider-step';
export { DefaultModelSummary } from './src/renderer/src/features/onboarding/components/steps/default-model-step';
export { SearchKeyRow } from './src/renderer/src/features/onboarding/components/steps/search-api-step';
export { ExtrasStep } from './src/renderer/src/features/onboarding/components/steps/extras-step';
export { QueryClient, QueryClientProvider } from '@tanstack/react-query';
export { MemoryRouter } from 'react-router-dom';
`,
		resolveDir: repo,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	mainFields: ["module", "main"],
	conditions: ["import"],
	banner: { js: "var require = globalThis.__CONTRACT_REQUIRE__;" },
	write: false,
	jsx: "automatic",
	alias: {
		"@shared": join(repo, "src/renderer/src/shared"),
		"@features": join(repo, "src/renderer/src/features"),
		"@renderer": join(repo, "src/renderer/src"),
		"@assets": join(repo, "src/renderer/src/assets"),
	},
	loader: {
		".css": "empty",
		".svg": "empty",
		".png": "empty",
		".webp": "empty",
	},
	define: {
		"import.meta.env": JSON.stringify({
			VITE_LOCAL_OPERATOR_API_URL: "http://127.0.0.1:1",
			VITE_RADIENT_SERVER_BASE_URL: "https://example.invalid",
			VITE_RADIENT_CLIENT_ID: "fixture",
			VITE_GOOGLE_CLIENT_ID: "fixture",
			VITE_MICROSOFT_CLIENT_ID: "fixture",
			VITE_MICROSOFT_TENANT_ID: "common",
			VITE_PUBLIC_POSTHOG_KEY: "",
			VITE_PUBLIC_POSTHOG_HOST: "http://127.0.0.1:9",
			VITE_LOG_LEVEL: "error",
		}),
	},
	plugins: [
		{
			name: "contract-search-key-row-export",
			setup(build) {
				build.onLoad({ filter: /\.(ts|tsx)$/ }, (args) => {
					const text = readFileSync(args.path, "utf8");
					const patched = args.path.endsWith("/steps/search-api-step.tsx")
						? `${text}\nexport { SearchKeyRow };\n`
						: text;
					return {
						contents: patched,
						loader: args.path.endsWith(".tsx") ? "tsx" : "ts",
					};
				});
				build.onResolve({ filter: /^react(?:\/.*)?$/ }, (args) => ({
					path: pathToFileURL(require_.resolve(args.path)).href,
					external: true,
				}));
			},
		},
	],
});

// Native frames otherwise repeat this entire encoded module in React's normal
// server warnings. Independent inert/tiny-React controls demonstrated that a
// constant sourceURL changes stack display only, preserving warnings and markup.
// This bounds diagnostic frame payloads; it is NOT evidence that log volume
// caused, or that this label cures, the full Desktop execution-ceiling failure.
const compiledSource = `${bundle.outputFiles[0].text}\n//# sourceURL=onboarding-i18n-contract.ssr.bundle.mjs\n`;
const mod = await import(
	`data:text/javascript;base64,${Buffer.from(compiledSource).toString("base64")}`
);
// An independent literal origin pin: deriving this from the import label would
// let a wrong-label mutation move its own oracle. Keep failure messages free of
// the raw native stack, which is multi-megabyte when the directive is removed.
const SSR_NATIVE_FRAME =
	/^\s*at (?:Module\.)?DefaultModelSummary \(onboarding-i18n-contract\.ssr\.bundle\.mjs:\d+:\d+\)$/m;

test("the actual compiled SSR component retains a bounded pinned native origin", () => {
	// This shipped component is hook-free; missing choice fails at its real
	// choice.kind access before JSX or rendering. No replacement module or fake
	// Error source can satisfy this native frame, and ordinary SSR cases stay intact.
	let nativeFailure;
	const summary = mod.DefaultModelSummary;
	try {
		summary({});
	} catch (error) {
		nativeFailure = error;
	}
	assert.ok(
		nativeFailure instanceof TypeError,
		"missing choice must throw a native TypeError",
	);
	const stack = String(nativeFailure.stack ?? "");
	const stackBytes = Buffer.byteLength(stack);
	assert.ok(
		stackBytes > 0 && stackBytes <= 8_192,
		`compiled native stack must be bounded (bytes=${stackBytes})`,
	);
	assert.ok(
		!stack.includes("data:text/javascript"),
		"native frames must not expose the encoded carrier",
	);
	assert.ok(
		SSR_NATIVE_FRAME.test(stack),
		"DefaultModelSummary must retain the committed SSR diagnostic origin",
	);
});

const client = new mod.QueryClient({
	defaultOptions: { queries: { retry: false, gcTime: 0 } },
});

const wrap = (element) =>
	React.createElement(
		mod.QueryClientProvider,
		{ client },
		React.createElement(mod.MemoryRouter, null, element),
	);
const render = (element) => renderToStaticMarkup(wrap(element));
const strip = (html) =>
	html
		.replace(/<[^>]*>/g, "")
		.replace(/&amp;/g, "&")
		.replace(/&#x27;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">");

/** The first paragraph whose text starts with `prefix`, from raw markup. */
function findP(markup, prefix) {
	/*
	 * Paragraphs AND spans: the free-pool detail is a span's children in
	 * `ModeOption`, the greetings are paragraphs - both are "the element whose
	 * rendered text is this committed sentence", which is what the contract
	 * means by full-sentence equality.
	 */
	for (const match of markup.matchAll(/<(p|span)[^>]*>([\s\S]*?)<\/\1>/g)) {
		const text = strip(match[2]);
		if (text.startsWith(prefix)) return { text };
	}
	return null;
}

test("the connect intro renders its full committed sentence, with no extra fragments", () => {
	const markup = render(React.createElement(mod.ConnectProviderStep));
	const intro = findP(markup, "Local Operator needs an AI account");
	assert.ok(intro, "the intro paragraph is missing from the render");
	assert.equal(intro.text, value("ui.onboarding.connect.intro"));
});

test("the free-pool detail renders its exact committed sentence (appended or prefixed text fails)", () => {
	const markup = render(
		React.createElement(mod.ExtrasStep, { aidaName: "Ada", oweGreeting: true }),
	);
	const freeDetail = findP(markup, "Uses a rotating pool of free");
	assert.ok(
		freeDetail,
		"the free-pool detail paragraph is missing from the render",
	);
	assert.equal(freeDetail.text, value("ui.onboarding.search.mode.free_detail"));
});

test("both chief-of-staff branches render their exact sentence for the oweGreeting they are given", () => {
	const owed = render(
		React.createElement(mod.ExtrasStep, { aidaName: "Ada", oweGreeting: true }),
	);
	const owedP = findP(owed, "Ada is your chief of staff");
	assert.ok(owedP, "the owed greeting paragraph is missing");
	assert.equal(
		owedP.text,
		value("ui.onboarding.extras.greeting_owed").replace("{name}", "Ada"),
	);
	assert.match(owed, /<h3[^>]*>Next: meet Ada<\/h3>/);

	const delivered = render(
		React.createElement(mod.ExtrasStep, {
			aidaName: "Ada",
			oweGreeting: false,
		}),
	);
	const doneP = findP(delivered, "Ada is your chief of staff");
	assert.ok(doneP, "the delivered greeting paragraph is missing");
	assert.equal(
		doneP.text,
		value("ui.onboarding.extras.greeting_done").replace("{name}", "Ada"),
	);
});

test("the acquisition link renders the live href and caption; the placeholder is the committed one", () => {
	const markup = renderToStaticMarkup(
		React.createElement(mod.SearchKeyRow, {
			credential: {
				name: "Tavily API key",
				key: "TAVILY_API_KEY",
				url: "https://example.invalid/",
				description: "fixture",
			},
			showDescription: false,
			isStored: false,
			save: async () => {
				throw new Error("SSR never writes");
			},
		}),
	);
	const anchor = markup.match(/<a\b[^>]*>/)?.[0];
	assert.ok(anchor, "the anchor is missing from the render");
	const href = anchor.match(/href="([^"]*)"/)?.[1];
	assert.equal(
		href,
		"https://example.invalid/",
		"the live anchor href is not the credential url",
	);
	const caption = markup.match(/<a\b[^>]*>([\s\S]*?)<\/a>/)?.[1];
	assert.ok(caption, "the anchor has no caption");
	assert.equal(strip(caption), "Get your Tavily API key");
	const placeholder = markup.match(/placeholder="([^"]*)"/)?.[1];
	assert.equal(placeholder, "Paste your API key");
});

test("the model summary names the brand its producer computes, and its states render their sentences", () => {
	const google = {
		id: "google",
		name: "Google",
		local: false,
		has_credential: true,
	};
	const choose = renderToStaticMarkup(
		React.createElement(mod.DefaultModelSummary, {
			choice: { kind: "choose", provider: google },
			onChange: () => {},
		}),
	);
	assert.equal(
		strip(choose),
		value("ui.onboarding.default_model.connected_pick").replace(
			"{brand}",
			"Google",
		),
	);

	const none = renderToStaticMarkup(
		React.createElement(mod.DefaultModelSummary, {
			choice: { kind: "none" },
			onChange: () => {},
		}),
	);
	assert.equal(
		strip(none),
		value("ui.onboarding.default_model.none_connected"),
	);

	const proposed = renderToStaticMarkup(
		React.createElement(mod.DefaultModelSummary, {
			choice: {
				kind: "proposed",
				provider: google,
				model: { name: "Gemini 2.5 Pro" },
			},
			onChange: () => {},
		}),
	);
	assert.ok(
		strip(proposed).includes("Gemini 2.5 Pro"),
		"the proposed model name is missing",
	);
	assert.ok(
		strip(proposed).includes("Google · suggested for your account"),
		"the suggested tag did not name the connected brand",
	);
});

test("parameters render as escaped text, never markup", () => {
	const markup = render(
		React.createElement(mod.ExtrasStep, {
			aidaName: "<strong>Ada</strong>",
			oweGreeting: true,
		}),
	);
	assert.ok(
		markup.includes("&lt;strong&gt;Ada&lt;/strong&gt; is your chief of staff"),
		"the parameter was not escaped into text",
	);
	assert.ok(
		!markup.includes("<strong>Ada</strong>"),
		"the parameter became live markup",
	);
});

test.after(() => client.clear());

/**
 * Drive the REAL desktop step body with a short injected bound, so the
 * external-bound path is exercised in seconds instead of the shipped 2400. The
 * stub `node` stands in for the supervisor: it writes what a run would write
 * (TAP on stdout, a census row beside the state), then either returns a verdict
 * or freezes, which is the shape the live hang had.
 */
function runSupervisingBody({
	freeze = false,
	rc = 0,
	seconds = 1,
	bound = 3,
	censusEvery = 1,
} = {}) {
	const text = readFileSync(".github/workflows/ci.yml", "utf8");
	const require = createRequire(import.meta.url);
	const builder = createRequire(
		require.resolve("electron-builder/package.json"),
	);
	const { load } = createRequire(builder.resolve("app-builder-lib"))("js-yaml");
	const step = load(text).jobs.test.steps.find(
		(entry) => entry.id === "desktop_suite",
	);
	const dir = mkdtempSync(join(tmpdir(), "supervising-step-"));
	const bin = join(dir, "bin");
	mkdirSync(bin, { recursive: true });
	const state = join(dir, "desktop-supervisor-0");
	mkdirSync(state, { recursive: true });
	const stub = join(bin, "node");
	writeFileSync(
		stub,
		[
			"#!/usr/bin/env bash",
			'case "$2" in',
			"  await)",
			"    printf '%s\\n' 'ok 1 - synthetic' '# pass 1'",
			'    echo \'{"index":0}\' >> "$STUB_STATE/kernel-census-0.jsonl"',
			'    echo \'{"index":1}\' >> "$STUB_STATE/kernel-census-0.jsonl"',
			'    sleep "$STUB_SECONDS"',
			'    exit "$STUB_RC"',
			"    ;;",
			"  reap)",
			'    echo "reaped: $3"',
			"    ;;",
			"esac",
			"exit 0",
			"",
		].join("\n"),
	);
	chmodSync(stub, 0o755);
	const script = join(dir, "step.sh");
	writeFileSync(
		script,
		step.run
			.replaceAll("${{ runner.temp }}", dir)
			.replaceAll("${{ matrix.shard }}", "0"),
	);
	const result = spawnSync("bash", ["-e", script], {
		cwd: dir,
		encoding: "utf8",
		env: {
			PATH: `${bin}:${process.env.PATH}`,
			HOME: process.env.HOME,
			STUB_STATE: state,
			STUB_RC: String(rc),
			STUB_SECONDS: freeze ? "120" : String(seconds),
			DESKTOP_SUITE_BOUND_S: String(bound),
			DESKTOP_SUITE_CENSUS_EVERY_S: String(censusEvery),
		},
	});
	return { ...result, dir, state };
}

test("a frozen await is ended by the step's own bound, with the census in the log", () => {
	// RED first: the await is frozen for two minutes and the bound is 3s, so this
	// can only pass if the loop - not the subject - ends the step.
	const run = runSupervisingBody({ freeze: true, bound: 3, censusEvery: 1 });
	try {
		assert.equal(
			run.status,
			124,
			`the external bound must fail the step closed, got ${run.status}: ${run.stderr}`,
		);
		assert.match(
			run.stdout,
			/^census: \{"index":0\}$/mu,
			"census rows must reach the job log while the subject is still hung",
		);
		assert.match(run.stdout, /^census: \{"index":1\}$/mu);
		assert.match(
			run.stdout,
			/::error::desktop suite exceeded its 3s external bound/u,
			"the bound must be annotated with the number that actually fired",
		);
		assert.match(
			run.stdout,
			/reaped: /u,
			"expiry must reap the recorded groups",
		);
		assert.match(
			run.stdout,
			/ok 1 - synthetic/u,
			"TAP already written must reach the log before the bound fires",
		);
	} finally {
		rmSync(run.dir, { recursive: true, force: true });
	}
});

test("a completed run keeps its verdict, its TAP exactly once, and is never reaped", () => {
	const run = runSupervisingBody({
		rc: 0,
		seconds: 3,
		bound: 30,
		censusEvery: 1,
	});
	try {
		assert.equal(run.status, 0, run.stderr);
		assert.equal(
			run.stdout.split("ok 1 - synthetic").length - 1,
			1,
			"forwarding must emit each TAP line exactly once",
		);
		assert.equal(
			run.stdout.split("# pass 1").length - 1,
			1,
			"the offset must not re-emit a chunk it already forwarded",
		);
		assert.doesNotMatch(
			run.stdout,
			/reaped: /u,
			"a completed run must not be reaped",
		);
		assert.doesNotMatch(run.stdout, /::error::/u);
	} finally {
		rmSync(run.dir, { recursive: true, force: true });
	}
});

test("census rows are emitted at most once each, however often the loop drains", () => {
	const run = runSupervisingBody({
		rc: 0,
		seconds: 3,
		bound: 30,
		censusEvery: 1,
	});
	try {
		assert.equal(run.status, 0, run.stderr);
		for (const row of ['{"index":0}', '{"index":1}']) {
			assert.equal(
				run.stdout.split(`census: ${row}`).length - 1,
				1,
				`${row} must be emitted exactly once across repeated drains`,
			);
		}
	} finally {
		rmSync(run.dir, { recursive: true, force: true });
	}
});
