/**
 * The app's own sentence for a failed server update, and the remedy it names.
 *
 * WHY THIS IS ITS OWN MODULE. Both functions are pure - they take the failing branch's
 * facts and return copy - and they are the two halves of a contract the renderer and the
 * guard test both read: the sentence the panel shows for a failed attempt is composed
 * here, and nothing downstream may classify, truncate or replace it. Keeping them in
 * `update-service.ts` would put a module that imports Electron between the test and the
 * string it has to hold to that promise, so they live here, import nothing, and are
 * re-exported from the service for callers that already have it.
 */

/**
 * What the reader can actually DO when an attempt failed, in the app's voice.
 *
 * MODULE SCOPE AND EXPORTED, because it is half of a contract the renderer and the
 * guard test both read: the sentence the panel shows for a failed update is composed
 * here, and nothing downstream may classify, truncate or replace it (see
 * `serverUpdateFailureSentence`). A private method could not be held to that.
 *
 * WHY IT IS ITS OWN SENTENCE. The panel's only control used to be "Try again", and on
 * the arm this route exists for that control re-refuses: the checkout is behind its
 * remote, so the same command stops at the same guard and the reader learns nothing.
 * The remedy has to name the step that would actually change the outcome - for that
 * refusal, bringing the checkout up to date - rather than asking for the same press
 * again (review round 3, U1b).
 *
 * It never names the guard's own bypass. The line that advises `--skip-remote-check` is
 * dropped before this sentence is composed (see `installDiagnosisLines`), and this
 * sentence must not reintroduce it.
 */
export function serverUpdateFailureRemedy(input: {
	rebuildRoute: boolean;
	diagnosis: string;
}): string {
	if (
		input.rebuildRoute &&
		/REFUSING to release a stale ref/i.test(input.diagnosis)
	) {
		return "This checkout is behind its remote, which is what `lop-update` refused to build from: bring the checkout up to date, and the next press here will build it.";
	}
	if (input.rebuildRoute) {
		return "A rebuild changes this install only once it succeeds, so nothing was restarted.";
	}
	return "Nothing was restarted: the build that was serving is the build still serving.";
}

/**
 * The whole sentence `backend-update-error` carries for a failed attempt.
 *
 * WHY IT IS A FUNCTION AND NOT A TEMPLATE AT THE CALL SITE. Two things have to hold at
 * once, and composing this inline broke both:
 *
 * 1. IT IS THE APP'S OWN COPY AND NOTHING MAY CLASSIFY IT. The renderer used to run
 *    whatever arrived here through `updateErrorMessage`, whose
 *    `AUTHORED_SENTENCE_MAX_LENGTH = 400` reads a long string as a machine dump and
 *    replaces it with the check stage's sentence. The composed sentence measured 401,
 *    467 and 481-483 characters on the three routes, so on two of them the panel showed
 *    "The update check could not finish" under a heading saying the update did not
 *    finish - and the cost clause added for a user-visible change went with it
 *    (reviewer M1 = UX U1 = QA Q-1, round 4). The renderer now trusts this field
 *    verbatim, and this function is what the guard test holds to that promise.
 *
 * 2. IT HAS TO STAY SHORT ENOUGH TO BE COPY AT ALL. A panel sentence that needs 400
 *    characters to say what happened is not a sentence a person reads: each arm here is
 *    trimmed - the remedy carries the consequence, the pointer to the block below is one
 *    conditional clause, and the escape hatch is one more - so every route lands well
 *    inside the budget rather than depending on a limit not being crossed.
 */
export function serverUpdateFailureSentence(input: {
	rebuildRoute: boolean;
	ran: boolean;
	exitCode: number | null;
	groupSurvived: boolean;
	diagnosis: string;
	target: string | null;
	after: string | null;
	before: string | null;
	updateCommand: string | null;
}): string {
	const headline = !input.ran
		? "The server update did not finish: the installer could not be run to a verdict."
		: input.exitCode !== 0
			? `The server update did not install: \`${input.rebuildRoute ? "lop-update" : "lop update"}\` exited ${input.exitCode}.`
			: input.rebuildRoute
				? "The rebuild finished but did not change this install: its `.lop-source` still names the same revision."
				: `The server update to ${input.target ?? "the new release"} did not take effect: the install still reports ${input.after ?? input.before ?? "its previous version"}.`;
	const stopped = input.groupSurvived
		? " The updater was stopped; something it started may still be replacing the install."
		: "";
	/*
	 * THE POINTER IS CONDITIONAL ON THE BLOCK EXISTING (reviewer m2): the sentence used
	 * to promise "the installer's own output is below" whether or not anything came back,
	 * so a run with nothing to show pointed at an empty space under the sentence.
	 */
	const pointer = input.diagnosis
		? " The installer's own output is below."
		: " The installer's own output is in the update service log.";
	/*
	 * NOT NAMED `escape`: that identifier shadows the deprecated global of the same name,
	 * which the repo's lint treats as an error - found by running the gate rather than
	 * assuming it, and worth the rename for the name alone.
	 */
	const escapeHatch = input.rebuildRoute
		? ` You can also run \`${input.updateCommand || "lop-update"}\` yourself in a terminal.`
		: "";
	return `${headline}${stopped} ${serverUpdateFailureRemedy(input)}${pointer}${escapeHatch}`;
}
