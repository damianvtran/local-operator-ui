/**
 * The hub auto-update payload and the sentences the UI says about it.
 *
 * PURE ON PURPOSE (no React, no transport). The backend decides everything
 * that matters here - which items differ, whether auto-update will take them,
 * what failed and why - and publishes it as one small store read
 * (`GET /v1/desktop/hub/updates`). This module only NAMES those facts for a
 * person, and it is a separate file from the hooks so the wording can be pinned
 * by a test that never mounts anything (`scripts/hub-updates.test.mjs`).
 *
 * The shapes mirror the backend's status payload (design B5.1) and merge report
 * (design A8). Every string-valued enum below is typed as an OPEN union
 * (`| (string & {})`): a newer backend may add a state or an error class, and
 * an unknown value must degrade to a generic sentence rather than fail to
 * compile or, worse, render as `undefined`.
 */

export type HubItemKind = "agent" | "team";

export type HubItemState =
	| "up-to-date"
	| "available"
	| "updating"
	| "applied"
	| "failed"
	// biome-ignore lint/complexity/noBannedTypes: the open-union idiom, see the header.
	| (string & {});

export type HubErrorClass =
	| "no-credential"
	| "provider-error"
	| "model-unavailable"
	| "prompt-too-long"
	| "merge-refused"
	| "concurrent-edit"
	| "hub-item-missing"
	// biome-ignore lint/complexity/noBannedTypes: the open-union idiom, see the header.
	| (string & {});

export type HubUpdateItem = {
	kind: HubItemKind;
	/** The profile/team NAME - the runtime's attachment key, and the UI's. */
	name: string;
	local_id?: string;
	hub_id?: string;
	tenant_id?: string | null;
	state: HubItemState;
	/** `remote-only | both-changed | baseline-unknown | null`. */
	classification?: string | null;
	/**
	 * The backend's own answer to "will auto-update take this without me?".
	 * Read, never re-derived: the policy (auto on for the kind, remote-only
	 * change, known baseline) lives on the server and a second copy here would
	 * disagree with it the first time the policy moved.
	 */
	auto_will_apply?: boolean;
	remote_fingerprint?: string | null;
	first_seen_available_at?: string | null;
	last_checked_at?: string | null;
	/** When the last apply landed; what "Updated 12 min ago" is computed from. */
	last_applied_at?: string | null;
	error_class?: HubErrorClass | null;
	last_error?: string | null;
	next_retry_at?: string | null;
	summary?: Record<string, number>;
};

export type HubUpdates = {
	generated_at: string;
	/** `none` = no Radient credential; nothing on the hub can be reached. */
	credential: "ok" | "none" | (string & {});
	settings: {
		auto_agents: boolean;
		auto_teams: boolean;
		interval_min: number;
	};
	counts: Record<string, number>;
	/** Only items whose state is not `up-to-date`. */
	items: HubUpdateItem[];
};

/** One region of a merge report: what each side holds, for the preview. */
export type HubMergeRegion = {
	id?: string;
	heading?: string;
	name?: string;
	provenance?: string;
	local?: unknown;
	remote?: unknown;
	note?: string;
};

/** One field's merge result inside a report (design A8). */
export type HubMergeField = {
	field: string;
	outcome: string;
	regions?: HubMergeRegion[];
};

/** One item's merge report (design A8), reduced to what the UI reads. */
export type HubMergeReport = {
	kind: HubItemKind;
	name: string;
	local_id?: string;
	hub_id?: string;
	/**
	 * `up-to-date | available | unchanged | merged | needs-review | refused |
	 * failed | skipped | unavailable | would-merge` (backend `ItemOutcome`).
	 */
	outcome: string;
	applied: boolean;
	backup?: string | null;
	/** B4.3 class when the item did not settle. */
	error_class?: string | null;
	classification?: string | null;
	/** `skipped: <class>` after a systemic stop during update-all. */
	skipped_reason?: string | null;
	fields?: HubMergeField[];
};

/** What `check`, `apply`, `apply-all` and `retry` answer: reports + a fresh snapshot. */
export type HubMutationResponse = {
	reports: HubMergeReport[];
	status?: HubUpdates;
};

export const hubItemKey = (kind: HubItemKind, name: string) =>
	`${kind}:${name}`;

export function hubItemIndex(
	updates: HubUpdates | undefined,
): Map<string, HubUpdateItem> {
	const index = new Map<string, HubUpdateItem>();
	for (const item of updates?.items ?? []) {
		index.set(hubItemKey(item.kind, item.name), item);
	}
	return index;
}

/** The B6.4 copy table, verbatim. */
export const HUB_ERROR_SENTENCE: Record<string, string> = {
	"provider-error":
		"Couldn't reach your model to merge this. Will retry; or retry now.",
	"model-unavailable":
		"No model available for merging. Check Settings › Agent Hub.",
	"prompt-too-long": "This one is too large to merge automatically.",
	"merge-refused":
		"The hub and your copy both changed the same part. Review it.",
	"concurrent-edit": "It changed while updating. Try again.",
	"hub-item-missing": "No longer available on the hub (or you lost access).",
	// Not in B6.4's table: these two classes reach the UI as a press outcome
	// (a 401 answer, a write the backend could not finish) and would otherwise
	// fall to the generic sentence, which names neither the cause nor the remedy.
	"no-credential": "Sign in to Radient to update from the hub.",
	"hub-error": "Couldn't write the update. Try again.",
};

const GENERIC_FAILURE = "Couldn't update this from the hub. Try again.";

/**
 * The sentence for a class, from the class alone and never from raw exception
 * text. A subclass (`provider-error/quota`) speaks with its parent's sentence.
 */
export function hubClassSentence(
	errorClass: string | null | undefined,
): string {
	const known = errorClass
		? HUB_ERROR_SENTENCE[errorClass.split("/")[0]]
		: null;
	return known ?? GENERIC_FAILURE;
}

/** The sentence for an item's failure, from its class and never from raw exception text. */
export function hubErrorSentence(item: HubUpdateItem): string {
	return hubClassSentence(item.error_class);
}

/**
 * What the row shows for an item. `null` = draw nothing.
 *
 * - `available`: an update exists and nothing of the person's is in its way,
 *   whether or not auto-update is on. It is the indicator the operator asked to
 *   see even in manual mode, and pressing it applies the update.
 * - `review`: the person has to decide. Either the merge refused
 *   (`merge-refused`) or the item changed on BOTH sides / has no record of the
 *   person's baseline, so applying it means combining their text with the hub's.
 *   Pressing it opens the detail pane, where the choice and a preview live; it
 *   NEVER applies (UX round 1, U3: a mark that says "it needs you" applied on
 *   click, wrote two contradictory lines and offered no undo).
 * - `updating`, `failed`, `applied`: the item's own state. A failed item whose
 *   class a retry cannot repair (`retryable: false`) is opened, not retried.
 *
 * `no-credential` is deliberately NOT a row mark (design B6.2.4): it is a
 * fact about the account, stated once per section by `hubSignInLine`.
 */
export type HubMark =
	| { kind: "available"; auto: boolean }
	| { kind: "review" }
	| { kind: "updating" }
	| { kind: "failed"; retryable: boolean }
	| { kind: "applied" };

/** Classes a second press cannot change: the hub no longer has it, or it is too large. */
const NOT_RETRYABLE: ReadonlySet<string> = new Set([
	"hub-item-missing",
	"prompt-too-long",
]);

const failedMark = (item: HubUpdateItem): HubMark => ({
	kind: "failed",
	retryable: !(item.error_class && NOT_RETRYABLE.has(item.error_class)),
});

/** Both sides changed, or nothing records what the person changed. */
const needsDecision = (item: HubUpdateItem) =>
	item.classification === "both-changed" ||
	item.classification === "baseline-unknown";

export function hubMarkFor(item: HubUpdateItem | undefined): HubMark | null {
	if (!item) return null;
	if (item.error_class === "no-credential") return null;
	if (item.error_class === "merge-refused") return { kind: "review" };
	switch (item.state) {
		case "updating":
			return { kind: "updating" };
		case "applied":
			return { kind: "applied" };
		case "failed":
			return failedMark(item);
		case "available":
			// An `available` item that also carries a failure (model down, retries
			// pending) is a failed attempt the person can retry, not a plain offer.
			if (item.error_class) return failedMark(item);
			if (needsDecision(item)) return { kind: "review" };
			return { kind: "available", auto: item.auto_will_apply === true };
		default:
			return null;
	}
}

/** The accessible name: the ACTION the control performs, naming the item. */
export function hubMarkLabel(name: string, mark: HubMark): string {
	switch (mark.kind) {
		case "available":
			return `Update ${name} from the hub`;
		case "review":
			return `Review the hub update for ${name}`;
		case "failed":
			return mark.retryable
				? `Retry the hub update for ${name}`
				: `See why the hub update for ${name} failed`;
		case "updating":
			return `Updating ${name} from the hub`;
		case "applied":
			return `${name} was updated from the hub`;
	}
}

/** What a press does, in words, for the tooltip (which opens on focus, unlike a `title`). */
export function hubMarkAction(mark: HubMark): string | null {
	switch (mark.kind) {
		case "available":
			return "Click to update.";
		case "review":
			return "Click to review.";
		case "failed":
			return mark.retryable ? "Click to retry." : "Click to see details.";
		default:
			return null;
	}
}

/** "just now" / "12 min ago" / "3 h ago" from an ISO stamp; null when unknown or over a day old. */
export function hubAgo(
	iso: string | null | undefined,
	now: number = Date.now(),
): string | null {
	if (!iso) return null;
	const then = Date.parse(iso);
	if (!Number.isFinite(then)) return null;
	const minutes = Math.max(0, Math.floor((now - then) / 60_000));
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes} min ago`;
	const hours = Math.floor(minutes / 60);
	return hours < 24 ? `${hours} h ago` : null;
}

/** Secondary text (tooltip / description): why it is there, and what pressing does. */
export function hubMarkDetail(
	item: HubUpdateItem,
	mark: HubMark,
	now: number = Date.now(),
): string {
	switch (mark.kind) {
		case "available":
			return mark.auto
				? "A newer version is on the hub. It will update automatically."
				: needsDecision(item)
					? "A newer version is on the hub. You changed this too, so it needs you."
					: "A newer version is on the hub.";
		case "review":
			if (item.error_class) return hubErrorSentence(item);
			return item.classification === "baseline-unknown"
				? "A newer version is on the hub, and nothing records what you changed. It needs you."
				: "A newer version is on the hub. You changed this too, so it needs you.";
		case "failed":
			return hubErrorSentence(item);
		case "updating":
			return "Merging the hub's version with yours.";
		case "applied": {
			const ago = hubAgo(item.last_applied_at, now);
			return ago ? `Updated ${ago}.` : "Updated from the hub.";
		}
	}
}

/** Items in a section that the "Update all" control would take. */
export function hubAvailableCount(
	updates: HubUpdates | undefined,
	kind: HubItemKind,
): number {
	return (updates?.items ?? []).filter(
		(item) => item.kind === kind && hubMarkFor(item)?.kind === "available",
	).length;
}

/**
 * The sign-in line (design B6.2.4), drawn ONCE, and only when the backend says an
 * item needs the login (`no-credential`).
 *
 * It was drawn from "credential is none AND something is linked", which is wrong
 * three ways (UX round 1, U1; design D5): public agents update anonymously so the
 * sentence contradicted marks that worked; a Teams section with nothing linked
 * carried it too; and it was drawn per section, so a signed-out hub user read it
 * twice. The caller hosts it in ONE section.
 */
export const HUB_SIGN_IN_LINE = "Sign in to Radient to get hub updates";

export function hubSignInLine(updates: HubUpdates | undefined): string | null {
	const needed = (updates?.items ?? []).some(
		(item) => item.error_class === "no-credential",
	);
	return needed ? HUB_SIGN_IN_LINE : null;
}

/** A sentence a press leaves beside its control, so no press ends silently. */
export type HubNote = { message: string; tone: "error" | "info" };

/**
 * What one item's report says to the person, or null when the mark's own change
 * (the spinner leaving, the glyph going away) is the whole answer. Every other
 * outcome gets a sentence: a press must change state or say why not (UX U2).
 */
export function hubReportNote(
	report: HubMergeReport,
	prefer?: "local" | "remote",
): HubNote | null {
	switch (report.outcome) {
		case "merged": {
			if (!report.applied) return null;
			// A decision the person made says what it did to the parts that differed.
			if (prefer)
				return {
					message: `Updated. ${
						prefer === "local"
							? "Where the hub and your copy differed, yours was kept."
							: "Where the hub and your copy differed, the hub's was used."
					} Your previous version is saved as a backup.`,
					tone: "info",
				};
			return report.classification === "both-changed" ||
				report.classification === "baseline-unknown"
				? {
						message:
							"Merged with your edits. Your previous version is saved as a backup.",
						tone: "info",
					}
				: null;
		}
		case "unchanged":
		case "up-to-date":
			return { message: "Already up to date.", tone: "info" };
		case "would-merge":
			return {
				message: "Checked. It is ready to update; press it again to update.",
				tone: "info",
			};
		case "needs-review":
			return {
				message:
					report.classification === "baseline-unknown"
						? "Nothing records what you changed, so this needs your review."
						: "The hub and your copy both changed the same part. Review it.",
				tone: "info",
			};
		case "skipped":
			return {
				message: `Skipped. ${hubClassSentence(report.skipped_reason)}`,
				tone: "error",
			};
		default:
			return { message: hubClassSentence(report.error_class), tone: "error" };
	}
}

/**
 * The roll-up after "Update all" (design B6.2.3), counting EVERY outcome the
 * backend can answer with. It once counted three of them and said "Nothing
 * needed updating." over a run whose every item was skipped or failed.
 *
 * Classified by `error_class` BEFORE `outcome`: a `model-unavailable` first item
 * comes back as `needs-review` but its mark is a retry, so counting it as "needs
 * your review" would send the person to a review that does not exist.
 */
const REVIEW_CLASSES: ReadonlySet<string> = new Set(["merge-refused"]);

export function hubRollup(reports: readonly HubMergeReport[]): string {
	let updated = 0;
	let ready = 0;
	let failed = 0;
	let skipped = 0;
	let same = 0;
	const review: string[] = [];
	let cause: string | null = null;
	for (const report of reports) {
		const cls = report.error_class ?? null;
		const isReview =
			report.outcome === "needs-review" && (!cls || REVIEW_CLASSES.has(cls));
		if (report.applied) updated += 1;
		else if (isReview) review.push(report.name);
		else if (report.outcome === "would-merge") ready += 1;
		else if (report.outcome === "skipped") {
			skipped += 1;
			cause ??= hubClassSentence(report.skipped_reason);
		} else if (
			report.outcome === "unchanged" ||
			report.outcome === "up-to-date"
		)
			same += 1;
		else {
			failed += 1;
			cause ??= hubClassSentence(cls);
		}
	}
	const parts: string[] = [];
	if (updated) parts.push(`${updated} updated`);
	if (ready) parts.push(`${ready} ready to update`);
	if (review.length) {
		const named = review.filter(Boolean);
		const who = named.length
			? ` (${named.slice(0, 2).join(", ")}${named.length > 2 ? ` +${named.length - 2}` : ""})`
			: "";
		parts.push(
			`${review.length} ${review.length === 1 ? "needs" : "need"} your review${who}`,
		);
	}
	if (failed) parts.push(`${failed} couldn't be updated`);
	if (skipped) parts.push(`${skipped} skipped`);
	if (!parts.length)
		return same
			? "Everything was already up to date."
			: "Nothing needed updating.";
	return `${parts.join(", ")}${cause ? `. ${cause}` : ""}`;
}

/** "Checked just now. 2 updates on the hub." - what the check-now control answers. */
export function hubCheckSentence(status: HubUpdates | undefined): string {
	const waiting = (status?.items ?? []).filter(
		(item) => item.state === "available",
	).length;
	const head = "Checked just now.";
	if (!status) return head;
	if (status.credential === "none" && waiting === 0)
		return `${head} ${HUB_SIGN_IN_LINE}.`;
	return waiting
		? `${head} ${waiting} ${waiting === 1 ? "update is" : "updates are"} on the hub.`
		: `${head} Everything is up to date.`;
}
