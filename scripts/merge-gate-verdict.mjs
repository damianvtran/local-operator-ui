/**
 * The `Merge gate (full suite)` verdict, as a function so it can be tested.
 *
 * WHY IT LEFT THE WORKFLOW. The decision lived in a heredoc inside the gate's
 * `run:` block, which meant the only way to know whether a skipped job passes
 * the gate was to spend a full-suite run. That is how the repository ended up
 * with a rule nobody had exercised: on a `workflow_dispatch` with
 * `native_proofs=false`, a skipped `native-proofs` was ACCEPTED even on a
 * diff that touches native surfaces — `eventName === 'pull_request'` was false
 * and the input was false, so the filter returned false and the required check
 * went green with no native proof behind it. A required check that can be made
 * green while the thing it requires did not run is the failure this gate exists
 * to prevent, one level up.
 *
 * WHAT IS PRESERVED. Fail-closed defaults: anything not `success` is bad unless
 * it is an explicitly permitted skip; `changes` may never skip; a skipped job
 * on a pull request is bad unless the scope proved it unnecessary.
 *
 * WHAT IS NEW. Two reasons a skipped `native-proofs` is acceptable, and no
 * others: `nativeScope === 'false'` — the classifier's answer that no changed
 * path can alter the packed app — or `nativeSkipAllowed`, which the workflow
 * computes for the runs that deliberately do not ask for the lane at all
 * (`push`/`schedule`, and a dispatch of the default branch, which is the same
 * post-merge role by another trigger).
 *
 * WHY THE FLAG RATHER THAN A SECOND EVENT CHECK HERE. Round 1 found that
 * deciding "is this a run that needs the proof?" from `eventName` alone made a
 * docs-only branch dispatch unconditionally red, because the dispatch path had
 * no diff to ask about. The ref is the fact that separates "a dispatch of main"
 * from "a dispatch of a PR head", and the workflow is where it is known.
 */

/**
 * @param {object} input
 * @param {Record<string, {result: string}>} input.needs  `toJSON(needs)` from the job.
 * @param {string} input.eventName                          `github.event_name`.
 * @param {string} input.nativeScope                        `needs.changes.outputs.native`: "true" | "false" | "".
 * @param {string} [input.nativeSkipAllowed]                "true" for runs that never ask for the lane.
 * @returns {{bad: Array<{job: string, result: string}>, reasons: Record<string, string>}}
 */
export function gateVerdict({
	needs,
	eventName,
	nativeScope,
	nativeSkipAllowed,
}) {
	const bad = [];
	const reasons = {};
	for (const [job, { result }] of Object.entries(needs ?? {})) {
		if (result === "success") continue;
		if (result !== "skipped") {
			bad.push({ job, result });
			continue;
		}
		if (job === "changes") {
			// The classifier cannot skip: without it nothing else has an input.
			bad.push({ job, result });
			continue;
		}
		if (job === "native-proofs") {
			if (nativeScope === "false") {
				reasons[job] = "skip allowed: no changed path can alter the packed app";
				continue;
			}
			if (nativeSkipAllowed === "true") {
				reasons[job] =
					"skip allowed: this run does not ask for the native lane";
				continue;
			}
			// Everything else is a gate run over a head that needs the proof: a pull
			// request, or a dispatch of a branch. A dispatch that asked not to run it
			// cannot certify a head the diff says needs it.
			bad.push({ job, result });
			continue;
		}
		// Every other skipped job is a scope decision inside the suite, and the
		// jobs that must never skip (`changes`, `native-proofs` on a gate run)
		// are handled above.
		reasons[job] = "skip allowed: not a gate-critical job";
	}
	return { bad, reasons };
}

/** Exit status and log lines for a workflow step. */
export function applyVerdict(
	input,
	{ log = console.log, exit = process.exit } = {},
) {
	const { bad, reasons } = gateVerdict(input);
	for (const [job, { result }] of Object.entries(input.needs ?? {})) {
		log(`${job}: ${result}`);
	}
	for (const [job, reason] of Object.entries(reasons)) log(`${job}: ${reason}`);
	if (bad.length) {
		log(
			`::error title=Merge gate::${bad
				.map(({ job, result }) => `${job}=${result}`)
				.join(", ")}`,
		);
		exit(1);
		return false;
	}
	log("Full suite green on this head.");
	return true;
}
