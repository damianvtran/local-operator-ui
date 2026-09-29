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

/** One item's merge report (design A8), reduced to what the UI reads. */
export type HubMergeReport = {
	kind: HubItemKind;
	name: string;
	local_id?: string;
	hub_id?: string;
	/** `unchanged | merged | needs-review | refused`. */
	outcome: string;
	applied: boolean;
	backup?: string | null;
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
};

const GENERIC_FAILURE = "Couldn't update this from the hub. Try again.";

/** The sentence for an item's failure, from its class and never from raw exception text. */
export function hubErrorSentence(item: HubUpdateItem): string {
	const known = item.error_class ? HUB_ERROR_SENTENCE[item.error_class] : null;
	return known ?? GENERIC_FAILURE;
}

/**
 * What the row shows for an item. `null` = draw nothing.
 *
 * - `available`: an update exists, whether or not auto-update is on. It is the
 *   indicator the operator asked to see even in manual mode.
 * - `review`: a `merge-refused` item. It is not a failure of the machinery but a
 *   decision only the person can make, so the click goes to the detail pane
 *   (where "keep mine / use the hub's" live) rather than re-running the merge
 *   that already refused.
 * - `updating`, `failed`, `applied`: the item's own state.
 *
 * `no-credential` is deliberately NOT a row mark (design B6.2.4): it is a
 * fact about the account, stated once per section by `hubSignInLine`.
 */
export type HubMark =
	| { kind: "available"; auto: boolean }
	| { kind: "review" }
	| { kind: "updating" }
	| { kind: "failed" }
	| { kind: "applied" };

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
			return { kind: "failed" };
		case "available":
			// An `available` item that also carries a failure (model down, retries
			// pending) is a failed attempt the person can retry, not a plain offer.
			return item.error_class
				? { kind: "failed" }
				: { kind: "available", auto: item.auto_will_apply === true };
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
			return `Retry the hub update for ${name}`;
		case "updating":
			return `Updating ${name} from the hub`;
		case "applied":
			return `${name} was updated from the hub`;
	}
}

/** Secondary text (tooltip / description): why it is there, and what pressing does. */
export function hubMarkDetail(item: HubUpdateItem, mark: HubMark): string {
	switch (mark.kind) {
		case "available":
			return mark.auto
				? "A newer version is on the hub. It will update automatically."
				: item.classification === "both-changed" ||
						item.classification === "baseline-unknown"
					? "A newer version is on the hub. You changed this too, so it needs you."
					: "A newer version is on the hub.";
		case "review":
		case "failed":
			return hubErrorSentence(item);
		case "updating":
			return "Merging the hub's version with yours.";
		case "applied":
			return "Updated just now.";
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
 * The section-level sign-in line (design B6.2.4).
 *
 * Shown only when there is a credential problem AND the user has something the
 * hub tracks: `counts` includes `up-to-date` items, so any non-zero total means
 * a hub-linked item exists. A user who never touched the hub pays nothing.
 */
export const HUB_SIGN_IN_LINE = "Sign in to Radient to get hub updates";

export function hubSignInLine(updates: HubUpdates | undefined): string | null {
	if (!updates || updates.credential !== "none") return null;
	const tracked = Object.values(updates.counts ?? {}).reduce(
		(sum, count) => sum + (Number.isFinite(count) ? count : 0),
		0,
	);
	return tracked > 0 || updates.items.length > 0 ? HUB_SIGN_IN_LINE : null;
}

/** "3 updated, 1 needs your review" - the roll-up after Update all (design B6.2.3). */
export function hubRollup(reports: readonly HubMergeReport[]): string {
	let updated = 0;
	let review = 0;
	let failed = 0;
	for (const report of reports) {
		if (report.applied) updated += 1;
		else if (report.outcome === "needs-review") review += 1;
		else if (report.outcome === "refused") failed += 1;
	}
	const parts: string[] = [];
	if (updated) parts.push(`${updated} updated`);
	if (review)
		parts.push(`${review} ${review === 1 ? "needs" : "need"} your review`);
	if (failed) parts.push(`${failed} couldn't be updated`);
	return parts.length ? parts.join(", ") : "Nothing needed updating.";
}
