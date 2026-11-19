/**
 * `pnpm merge-gate <pull-request-number>` - ask the full suite to run on a pull
 * request's CURRENT head, and print the run it started.
 *
 * WHY A RITUAL AND NOT A BUTTON. The full suite runs on a pull request only for
 * `pull_request: [labeled]` (`.github/workflows/full-suite.yml`). That trigger
 * is deliberate: `opened`/`synchronize` would run the whole desktop suite on
 * every push of every pull request, which is exactly the cost that moved it off
 * pull-request CI in the first place. The alternative - a label-name `if:` on
 * the jobs - is WORSE than useless: GitHub counts a `skipped` check as
 * SATISFYING a required status check, so a job gated by the label would report
 * `skipped` (a pass) on any run some other label started, and a red pull request
 * would merge. So the workflow carries no label condition at all: any label
 * event is one full run, and the label is how the run is asked for.
 *
 * WHY RE-ARM AT ALL. The label is the only trigger, so it is also the only way
 * to start the run again, and two states genuinely need that:
 *   - A required check with NO run on the head reports `Expected - waiting for
 *     status to be reported` and blocks. That block is intended (a merge gate
 *     that can be missed is not a gate), and this command is how it is exited.
 *   - A PUSH AFTER THE GATE RAN strands the check on the OLD SHA: the new head
 *     has no `Merge gate (full suite)` and the pull request is blocked, rightly.
 *     Removing and re-adding the label on the FINAL head is the documented
 *     recovery; the stale run's verdict is not reusable and never retried
 *     job-by-job, because the gate is the whole suite or it is nothing.
 *
 * WHY REMOVE THEN ADD. `gh pr edit --add-label` on a label that is already
 * present is a no-op and delivers NO event - the run that follows is whatever
 * was already queued, if anything. Removing first makes the add a real `labeled`
 * delivery, so this works whether or not the label is currently on the PR.
 *
 * The label is created when the repository has never had it (`gh label create
 * --force` is idempotent), so the ritual does not depend on an undocumented
 * manual step.
 *
 * IT FAILS LOUDLY, and that is a feature: a number that names no pull request,
 * a pull request that is not open, and a label event that starts NO run all exit
 * 1 with the reason. Each of those, if reported as success, leaves the operator
 * believing a gate was armed while the head still carries no verdict - and the
 * head is otherwise indistinguishable from an armed one (`Expected` looks the
 * same either way). The wait for the run is bounded: past the bound it is an
 * error, never a quiet "probably queued".
 *
 * Call it ONLY when the review rounds are clean and the head is final. One label
 * event costs one full suite run, and a run started on a head that then moves is
 * a run nobody reads. See AGENTS.md, "The merge gate (full suite)".
 */

import { spawnSync } from "node:child_process";
import process from "node:process";

const LABEL = "ready-to-merge";
const WORKFLOW = "full-suite.yml";
const CHECK_NAME = "Merge gate (full suite)";

function fail(message) {
	console.error(`merge-gate: ${message}`);
	process.exit(1);
}

/**
 * A bounded wait is a number measured against GitHub's queue, not against this
 * machine, so it is overridable - that is how the FAILURE path is exercised in
 * seconds instead of half a minute (scripts/ci-scope.test.mjs). The invariant it
 * bounds is unchanged by the override: a run that never appears exits 1. A
 * malformed value fails too, rather than silently falling back to a bound the
 * caller did not ask for.
 */
function bounded(name, fallback, minimum) {
	const raw = process.env[name];
	if (raw === undefined || raw === "") return fallback;
	const value = Number(raw);
	if (!Number.isInteger(value) || value < minimum)
		fail(
			`${name} must be an integer >= ${minimum}, got ${JSON.stringify(raw)}.`,
		);
	return value;
}

/** Bounded so a queued-but-not-yet-listed run does not hang the ritual. */
const POLL_ATTEMPTS = bounded("MERGE_GATE_POLL_ATTEMPTS", 6, 1);
const POLL_INTERVAL_MS = bounded("MERGE_GATE_POLL_INTERVAL_MS", 5_000, 0);
/** GitHub stamps `createdAt` in whole seconds; stay behind its clock, not ahead. */
const SINCE_SKEW_MS = 10_000;

/**
 * Run `gh` and hand back its outcome instead of exiting, for the calls whose
 * failure has a message of its own (a number that names no pull request is a
 * typo or the wrong repository, not a `gh` fault). A `gh` that could not be
 * STARTED is never tolerable: that is a missing or unauthenticated CLI.
 */
function ghTry(args) {
	const result = spawnSync("gh", args, { encoding: "utf8" });
	if (result.error)
		fail(
			`could not run gh (${result.error.message}): install the GitHub CLI and authenticate it.`,
		);
	return {
		ok: result.status === 0,
		stdout: result.stdout ?? "",
		detail: (result.stderr || "").trim() || `exit ${result.status}`,
	};
}

/** Run `gh`, returning its stdout, and exit on any non-zero status. */
function gh(args) {
	const result = ghTry(args);
	if (!result.ok) {
		const detail = result.detail;
		fail(`gh ${args.join(" ")} failed: ${detail}`);
	}
	return result.stdout;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The run this ritual started: newest `pull_request` run of the full suite on
 * the PR's head branch, created at or after the label was re-added. Filtered by
 * branch and creation time rather than `headSha` on purpose - for a
 * `pull_request` event the run's `head_sha` is the PR's merge commit while
 * `github.sha` in the workflow is the same merge commit and the shards read
 * `github.event.pull_request.head.sha`, so matching the branch plus "started
 * just now" is the version of this question that cannot be wrong about which
 * SHA the API is reporting.
 */
async function waitForRun(branch, since) {
	for (let attempt = 1; attempt <= POLL_ATTEMPTS; attempt += 1) {
		// A workflow with no run on this branch answers `[]` rather than an
		// error, so every non-zero exit here is a real problem (auth,
		// permissions) and is reported instead of becoming "no run yet".
		const output = gh([
			"run",
			"list",
			"--workflow",
			WORKFLOW,
			"--event",
			"pull_request",
			"--branch",
			branch,
			"--limit",
			"20",
			"--json",
			"databaseId,url,status,conclusion,createdAt",
		]);
		const fresh = JSON.parse(output)
			.filter(
				(candidate) => Date.parse(candidate.createdAt) >= since - SINCE_SKEW_MS,
			)
			.sort((a, b) => b.databaseId - a.databaseId);
		if (fresh.length > 0) return fresh[0];
		if (attempt < POLL_ATTEMPTS) await sleep(POLL_INTERVAL_MS);
	}
	return null;
}

const argument = process.argv[2];
if (!argument || !/^\d+$/u.test(argument))
	fail("usage: pnpm merge-gate <pull-request-number>");

const viewCall = ghTry([
	"pr",
	"view",
	argument,
	"--json",
	"number,url,state,isDraft,headRefName,headRefOid,labels",
]);
// `gh pr view` fails for a number that does not exist AND for every `gh` fault
// (auth, network, wrong repository). Both mean "nothing was armed", so both exit
// non-zero; the detail is what tells them apart.
if (!viewCall.ok)
	fail(
		`no pull request #${argument} to arm (${viewCall.detail}). Check the number, and that gh is authenticated against the intended repository.`,
	);
const view = JSON.parse(viewCall.stdout);
if (view.state !== "OPEN")
	fail(
		`#${view.number} is ${view.state}: the merge gate only runs for an open pull request.`,
	);

// Idempotent; `--force` only refreshes the colour and description.
gh([
	"label",
	"create",
	LABEL,
	"--color",
	"0E8A16",
	"--description",
	"Full suite requested on this head - re-arm with pnpm merge-gate <n>",
	"--force",
]);

const armed = (view.labels ?? []).some((label) => label.name === LABEL);
const startedAt = Date.now();
if (armed) {
	gh(["pr", "edit", argument, "--remove-label", LABEL]);
	console.log(
		`#${view.number}: removed \`${LABEL}\` first (adding a label that is already there delivers no event).`,
	);
}
gh(["pr", "edit", argument, "--add-label", LABEL]);
console.log(
	`#${view.number}: added \`${LABEL}\` on ${view.headRefOid.slice(0, 12)} (${view.headRefName}).`,
);
console.log(
	"That label event is the trigger; the workflow starts one full run.",
);

const run = await waitForRun(view.headRefName, startedAt);
// No run is a FAILED arm, not a slow one: the head now carries no new verdict,
// and `Expected` looks identical to a run nobody has started yet - the exact
// state an operator cannot tell apart from a real gate. Exit non-zero and say
// where to look, so a red ritual is never mistaken for a queued one.
if (!run)
	fail(
		[
			`no \`${WORKFLOW}\` pull_request run appeared for ${view.headRefName} within ${(POLL_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s of the label event. \`${LABEL}\` is now ON #${view.number}, so the delivered event is not lost - find out whether the workflow ran before re-arming:`,
			`  gh run list --workflow ${WORKFLOW} --event pull_request --branch ${view.headRefName} --limit 5`,
			`  ${view.url}/checks`,
		].join("\n"),
	);
console.log("");
const verdict = run.conclusion ? ` (${run.conclusion})` : "";
console.log(`Run ${run.databaseId} is ${run.status}${verdict}: ${run.url}`);
console.log(
	`Required check: \`${CHECK_NAME}\`, reported by the \`merge-gate\` job.`,
);
console.log("");
console.log("Follow it:");
console.log(`  gh run watch ${run.databaseId} --exit-status`);
console.log(`  gh pr checks ${argument} --watch`);
console.log("");
console.log(
	`If this head moves, the check stays on the old SHA and the pull request is blocked: re-run \`pnpm merge-gate ${argument}\` on the FINAL head.`,
);
if (view.isDraft)
	console.log(
		"Note: this pull request is a draft. The gate runs, but a draft cannot merge.",
	);
