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
 * WHAT IS NEW. `nativeScope === 'false'` — the classifier's answer that no
 * changed path can alter the packed app — is now the ONLY reason a skipped
 * `native-proofs` is acceptable on a pull request or a dispatch. On main's own
 * push/schedule runs the lane is deliberately not asked for, so a skip there
 * stays acceptable, exactly as before.
 */

/**
 * @param {object} input
 * @param {Record<string, {result: string}>} input.needs  `toJSON(needs)` from the job.
 * @param {string} input.eventName                          `github.event_name`.
 * @param {string} input.nativeScope                        `needs.changes.outputs.native`: "true" | "false" | "".
 * @returns {{bad: Array<{job: string, result: string}>, reasons: Record<string, string>}}
 */
export function gateVerdict({ needs, eventName, nativeScope }) {
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
			if (eventName === "pull_request" || eventName === "workflow_dispatch") {
				// The merge-relevant paths must carry the proof. A dispatch that
				// asked not to run it cannot certify a head that needs it.
				bad.push({ job, result });
				continue;
			}
			reasons[job] =
				"skip allowed: main's post-merge run does not ask for the native lane";
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
