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
 *
 * THE ONE EXCEPTION IS A TYPE: the structured failure the updater reports (contract
 * 2026-10-24) is imported type-only, so the bundle still has no runtime dependency
 * and the vocabulary of steps and kinds has one definition rather than two.
 */

import type {
	UpdateReportFailureKind,
	UpdateReportFailureStep,
} from "./update-rollover";

/**
 * The structured cause, as the failing branch receives it from `parseUpdateReport`.
 *
 * `exitCode` is deliberately absent: the headline already carries the exit code,
 * and a second rendering of it in the cause clause would be a number the reader
 * has to reconcile with the one above.
 */
export type ServerUpdateFailureCause = {
	step: UpdateReportFailureStep;
	kind: UpdateReportFailureKind;
	error: string;
};

/**
 * The step, in the words a reader uses for it rather than the updater's key.
 *
 * WHY A CLOSED MAP. `step` is a contract enum (`update-rollover.ts` validates it),
 * but the sentence is copy this app owns: interpolating an unrecognised value
 * would put the updater's vocabulary on the panel. The parser drops a failure
 * block whose step it does not know, so every branch here is reachable; the
 * default exists for the one day a caller passes a hand-built cause.
 */
function failureStepClause(step: UpdateReportFailureStep): string {
	switch (step) {
		case "check":
			return "It stopped at the check step";
		case "publish":
			return "It stopped at the publish step";
		case "download":
			return "It stopped at the download step";
		case "environment":
			return "It stopped at the environment step";
		case "install":
			return "It stopped at the install step";
		case "promote":
			return "It stopped at the switch-over step";
		case "services":
			return "It stopped at the services step";
		case "lock":
			return "It stopped at the lock step";
		case "report":
			return "It stopped at the reporting step";
		default:
			return "It stopped during the update";
	}
}

/**
 * What went wrong, in plain language.
 *
 * The updater's own sentence is quoted beside this and is the specific cause; this
 * clause is what makes the KIND legible without decoding its error text. The
 * `publication` arm names the target because that is the fact the incident's
 * reader needed (the release existed locally and PyPI had not caught up yet).
 */
function failureCauseClause(
	kind: UpdateReportFailureKind,
	target: string | null,
): string {
	switch (kind) {
		case "network":
			return "a network request failed";
		case "publication":
			return target
				? `PyPI did not yet offer ${target}`
				: "the release was still publishing";
		case "lock":
			return "another update held the lock";
		case "disk":
			return "the disk ran out of space";
		case "ownership":
			return "the install is owned by another user";
		case "serve":
			return "the install landed but the server did not move onto it";
		case "refused":
			return "the updater refused to continue";
		default:
			return "the updater could not classify the failure";
	}
}

/**
 * What the reader can do about THIS kind, and the one place the remedy differs.
 *
 * WHY EACH KIND GETS ITS OWN. "Try again" is wrong for three of them: a publish
 * that has not propagated needs minutes, a held lock needs the other updater to
 * finish, and a serve that did not move needs a restart rather than another
 * install. One generic retry sentence would send the reader back into the same
 * wait - the defect this change exists to end, one level below the cause.
 *
 * `unknown` returns null deliberately: the cause clause already says the updater
 * named no cause, and the pointer that follows names where the record is. A
 * remedy invented for it would be the guess the report refused to make.
 */
function failureRemedyClause(kind: UpdateReportFailureKind): string | null {
	switch (kind) {
		case "network":
			return "Check the network connection, then try again.";
		case "publication":
			return "The release is still publishing; try again in a few minutes.";
		case "lock":
			return "Another update is running; wait for it to finish, then try again.";
		case "disk":
			return "Free some disk space, then try again.";
		case "ownership":
			return "Correct the install's ownership, then try again.";
		case "serve":
			return "Restart the server.";
		case "refused":
			return "Resolve what it refused, then try again.";
		default:
			return null;
	}
}

/**
 * How much of the updater's own sentence the cause clause quotes.
 *
 * The full sentence is in the raw output and the log, so this cap costs nothing a
 * reader cannot find; what it buys is the copy budget (`AUTHORED_SENTENCE_MAX_LENGTH`
 * is 400, and the panel is read as one sentence). Newlines collapse to spaces for
 * the same reason - the clause is prose, not a transcript.
 */
const MAX_QUOTED_ERROR_CHARS = 140;

function quotedFailureError(error: string): string {
	const flattened = error.replace(/\s+/g, " ").trim();
	if (flattened === "") return "";
	const clipped =
		flattened.length > MAX_QUOTED_ERROR_CHARS
			? `${flattened.slice(0, MAX_QUOTED_ERROR_CHARS - 3)}...`
			: flattened;
	return ` (\`${clipped}\`)`;
}

/**
 * The cause half of a failed update's sentence, or empty when there is none.
 *
 * WHY THIS IS THE PRODUCER'S JOB AND NOT THE RENDERER'S. The panel renders the
 * `message` verbatim (`serverUpdateFailureCopy`), and that is the contract that
 * keeps a composed sentence from being classified as a machine dump. Composing
 * the cause here keeps one author for the whole sentence; the renderer receives
 * the structured fields beside it for surfaces that need to key on them without
 * parsing English.
 */
export function serverUpdateFailureCause(input: {
	failure: ServerUpdateFailureCause | null | undefined;
	target: string | null;
}): string {
	const failure = input.failure;
	if (!failure) return "";
	const cause = `${failureStepClause(failure.step)}: ${failureCauseClause(
		failure.kind,
		input.target,
	)}${quotedFailureError(failure.error)}.`;
	const remedy = failureRemedyClause(failure.kind);
	/*
	 * THE CONSEQUENCE STAYS, EXCEPT WHERE IT WOULD BE FALSE. Every other arm stops
	 * before the install is promoted, so the build that was serving is still
	 * serving; `serve` is the arm where the install LANDED and something else is
	 * true, and its remedy already says what that is.
	 */
	const consequence = failure.kind === "serve" ? "" : " Nothing was restarted.";
	/*
	 * `unknown` gets no remedy clause; the pointer in the sentence says whether the
	 * raw output or the log holds the record, so the cause clause and that pointer
	 * are the whole answer and neither invents a next step.
	 */
	return `${cause}${remedy ? ` ${remedy}` : ""}${consequence}`;
}

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
	/**
	 * The updater's structured cause, when this build emits one.
	 *
	 * ABSENT IS THE OLDER-BUILD PATH, and it must produce today's sentence
	 * byte-for-byte: the panel is the same surface, and a user on a backend that
	 * predates the contract is not owed a new wording. `null` and `undefined`
	 * both mean absent here.
	 */
	failure?: ServerUpdateFailureCause | null;
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
	/*
	 * THE STRUCTURED CAUSE REPLACES THE GENERIC REMEDY CLAUSE, not sits beside it.
	 * Both name what to do next, and a sentence carrying "the build that was serving
	 * is the build still serving" followed by "try again in a few minutes" reads as
	 * two authors arguing. The `Nothing was restarted` consequence survives inside
	 * `serverUpdateFailureCause`, which is where the kind decides whether it is true.
	 */
	const cause = serverUpdateFailureCause({
		failure: input.failure,
		target: input.target,
	});
	const remedy = cause ? "" : serverUpdateFailureRemedy(input);
	return `${headline}${stopped} ${cause || remedy}${pointer}${escapeHatch}`;
}
