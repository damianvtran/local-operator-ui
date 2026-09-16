import { DesktopControlError } from "@shared/api/local-operator/desktop-api";
import type { ReusableProfile } from "@shared/api/local-operator/profile-hooks";

/**
 * Install a list of built-in profiles one at a time, and report what happened
 * to each NAME.
 *
 * Split out of the component so the counting rules are testable without a
 * renderer: this module is the part that decides what the user is told, and a
 * green frame is not evidence that a skip was not counted as a success.
 *
 * ## The three outcomes, and the two tolerances
 *
 *  - `installed` — the copy happened. Nothing in the response distinguishes it
 *    from a no-op on a backend that predates `already_installed`, which is why
 *    the ABSENCE of the field reads as installed rather than as a failure the
 *    user would have to chase: the route is idempotent either way.
 *  - `already_present` — the backend said so (`already_installed: true`).
 *  - `skipped` — a 409 from `install_seed`'s `NameTakenError`: this name belongs
 *    to an agent the user already holds. ONE name's problem. The loop continues,
 *    because aborting the other five turns a name collision into a failed
 *    feature.
 *
 * Anything else is that name's failure, reported verbatim. A skip is never a
 * success and a failure is never silent: the summary is built from these
 * outcomes rather than assumed.
 */
export type InstallOutcome =
	| { name: string; result: "installed" }
	| { name: string; result: "already_present" }
	| { name: string; result: "skipped" }
	| { name: string; result: "failed"; message: string };

export type InstallSummary = {
	installed: number;
	alreadyPresent: number;
	skipped: string[];
	failed: { name: string; message: string }[];
};

/** Install one name, translating a refusal into its outcome. */
export const installBuiltin = async (
	name: string,
	install: (name: string) => Promise<ReusableProfile>,
): Promise<InstallOutcome> => {
	try {
		const profile = await install(name);
		return {
			name,
			result: profile?.already_installed ? "already_present" : "installed",
		};
	} catch (error) {
		// The HTTP status rather than the message text: the route owns its
		// wording, and a client keyed on a sentence breaks when it is rewritten.
		if (error instanceof DesktopControlError && error.status === 409) {
			return { name, result: "skipped" };
		}
		return {
			name,
			result: "failed",
			message:
				error instanceof Error && error.message
					? error.message
					: "The server did not answer.",
		};
	}
};

export type InstallProgress = {
	/** How many installs have finished. */
	done: number;
	/** The name in flight, or null between names. */
	current: string | null;
};

/** Run the batch in order, reporting progress as it goes. */
export const installBuiltins = async (
	names: readonly string[],
	install: (name: string) => Promise<ReusableProfile>,
	onProgress?: (progress: InstallProgress) => void,
): Promise<InstallSummary> => {
	const outcomes: InstallOutcome[] = [];
	for (const name of names) {
		onProgress?.({ done: outcomes.length, current: name });
		// Sequential on purpose: each install writes the same registry, and the
		// progress line the user reads names one agent at a time.
		outcomes.push(await installBuiltin(name, install));
		onProgress?.({ done: outcomes.length, current: null });
	}
	return summariseInstalls(outcomes);
};

/** Count what happened, in the three buckets the summary speaks in. */
export const summariseInstalls = (
	outcomes: readonly InstallOutcome[],
): InstallSummary => {
	const summary: InstallSummary = {
		installed: 0,
		alreadyPresent: 0,
		skipped: [],
		failed: [],
	};
	for (const outcome of outcomes) {
		if (outcome.result === "installed") summary.installed += 1;
		if (outcome.result === "already_present") summary.alreadyPresent += 1;
		if (outcome.result === "skipped") summary.skipped.push(outcome.name);
		if (outcome.result === "failed")
			summary.failed.push({ name: outcome.name, message: outcome.message });
	}
	return summary;
};

/**
 * The honest sentence, built from the counts rather than from an assumption.
 *
 * `5 installed, 1 already present` is the shape the contract asks for; a skip
 * and a failure each earn their own clause, because a batch that partially
 * worked must not read as one that wholly did.
 */
export const summarySentence = (summary: InstallSummary): string => {
	const parts: string[] = [];
	if (summary.installed > 0) parts.push(`${summary.installed} installed`);
	if (summary.alreadyPresent > 0)
		parts.push(`${summary.alreadyPresent} already present`);
	if (summary.skipped.length > 0) parts.push(`${summary.skipped.length} skipped`);
	if (summary.failed.length > 0) parts.push(`${summary.failed.length} failed`);
	if (parts.length === 0) parts.push("Nothing to install");
	return `${parts.join(", ")}.`;
};
