/**
 * Directory-backed choices for the agent-messages allowlist editor.
 *
 * WHY THIS EXISTS. The allowlist wire carries opaque identifiers only
 * (`kind: "account" | "endpoint"`, `id`), so the editor used to ask the
 * operator to paste a raw account or endpoint id. The organization's Team
 * Bridge directory already names every active person (`account_id`,
 * `display_label`) and the agent each one runs (`agent.endpoint_id`,
 * `agent.name`), so the editor can offer those as choices instead.
 *
 * CONSTRAINTS THIS MODULE KEEPS (the reviewable invariants):
 * - Choosing grants nothing. A choice only fills the same draft field a typed
 *   id fills; the entry still passes `allowlistIdentifierError`, still needs
 *   the explicit Add, and only the editor's existing Save writes the
 *   replace-set. No role, wildcard or "whole organization" choice exists.
 * - A choice is bound to the context it was made in: the organization
 *   (tenant), the signed-in account, and the entry kind. `selectionIsCurrent`
 *   refuses a choice whose context has moved or whose id is no longer in the
 *   directory now on screen, so a stale or cross-organization pick cannot be
 *   added (the server's `expected_account_id` receipt still guards the write
 *   itself).
 * - Two people (or agents) can share a display name. Labels are therefore
 *   never the identity: every choice carries its full id, and a repeated
 *   label is marked so the list is not two indistinguishable rows.
 */
import type {
	TeamBridgeDirectory,
	TeamBridgeDirectoryMember,
} from "../../../../shared/team-bridge-contract";
import type { AllowlistEntryKind } from "./agent-messages-settings-model";
import { allowlistIdentifierError } from "./agent-messages-settings-model";

/** One selectable directory row for an entry kind. */
export type AllowlistDirectoryChoice = {
	kind: AllowlistEntryKind;
	/** The full wire identifier: what an Add writes, and what the row shows. */
	id: string;
	/** The person's or agent's name; may repeat across choices. */
	label: string;
	/** For an agent, the human who runs it; absent for a person. */
	owner?: string;
	/** True when another choice of the same kind shows the same label. */
	duplicateLabel: boolean;
};

/**
 * The context a directory read (and any choice made from it) belongs to.
 * The key folds tenant and account together so a response for one pairing
 * can never be shown, or chosen from, under another.
 */
export type AllowlistDirectoryContext = {
	tenantId: string;
	accountId: string;
};

export function allowlistDirectoryKey(context: AllowlistDirectoryContext) {
	// NUL cannot occur in either id, so two different pairs never share a key.
	return `${context.tenantId}\u0000${context.accountId}`;
}

function memberLabel(member: TeamBridgeDirectoryMember) {
	const label =
		member.profile?.display_name?.trim() || member.display_label.trim();
	return label.length > 0 ? label : member.account_id;
}

/**
 * The choices for one kind, in directory order. Rows whose id the editor's own
 * validator would refuse are dropped rather than offered and then rejected.
 */
export function allowlistDirectoryChoices(
	directory: TeamBridgeDirectory,
	kind: AllowlistEntryKind,
): AllowlistDirectoryChoice[] {
	const rows: Omit<AllowlistDirectoryChoice, "duplicateLabel">[] = [];
	const seen = new Set<string>();
	for (const member of directory.members) {
		if (kind === "account") {
			const id = member.account_id;
			if (seen.has(id) || allowlistIdentifierError(id) !== null) continue;
			seen.add(id);
			rows.push({ kind, id, label: memberLabel(member) });
			continue;
		}
		const agent = member.agent;
		if (!agent) continue;
		const id = agent.endpoint_id;
		if (seen.has(id) || allowlistIdentifierError(id) !== null) continue;
		seen.add(id);
		const name = agent.name.trim();
		rows.push({
			kind,
			id,
			label: name.length > 0 ? name : id,
			owner: memberLabel(member),
		});
	}
	const counts = new Map<string, number>();
	for (const row of rows) {
		const label = row.label.toLocaleLowerCase();
		counts.set(label, (counts.get(label) ?? 0) + 1);
	}
	return rows.map((row) => ({
		...row,
		duplicateLabel: (counts.get(row.label.toLocaleLowerCase()) ?? 0) > 1,
	}));
}

/**
 * The identity of one entry within one list (a direction/effect pair): kind and
 * full id. NUL cannot occur in an id, so two different pairs never collide.
 */
export function allowlistEntryIdentity(kind: AllowlistEntryKind, id: string) {
	return `${kind}\u0000${id}`;
}

/** What a listed entry shows when the directory on screen can name it. */
export type AllowlistEntryName = { label: string; owner?: string };

/**
 * Names for the entries a list holds, read from the directory ALREADY loaded
 * (no extra request). WHY: once a choice is added the pending row is the
 * operator's last check before Save, and an opaque `bep_…` cannot tell two
 * agents called "Helper" apart — the owner can. An id the directory does not
 * hold (typed by hand, a departed member, or no directory at all) gets no
 * name, and the row falls back to the bare id rather than guessing.
 */
export function allowlistEntryNames(
	directory: TeamBridgeDirectory,
): Map<string, AllowlistEntryName> {
	const names = new Map<string, AllowlistEntryName>();
	for (const kind of ["endpoint", "account"] as const) {
		for (const choice of allowlistDirectoryChoices(directory, kind)) {
			names.set(
				allowlistEntryIdentity(kind, choice.id),
				choice.owner
					? { label: choice.label, owner: choice.owner }
					: { label: choice.label },
			);
		}
	}
	return names;
}

/** A choice as the form holds it: the id plus the context it was made in. */
export type AllowlistDirectorySelection = {
	key: string;
	kind: AllowlistEntryKind;
	id: string;
};

/**
 * Whether a held choice may still be added: same tenant/account key, same
 * kind, and the id is still among the choices on screen now.
 */
export function selectionIsCurrent(
	selection: AllowlistDirectorySelection,
	current: {
		key: string;
		kind: AllowlistEntryKind;
		choices: readonly AllowlistDirectoryChoice[];
	},
) {
	return (
		selection.key === current.key &&
		selection.kind === current.kind &&
		current.choices.some(
			(choice) => choice.kind === selection.kind && choice.id === selection.id,
		)
	);
}
