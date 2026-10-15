import type {
	ReusableProfile,
	ReusableTeam,
} from "@shared/api/local-operator/profile-hooks";

/**
 * A refresh is not a different editor. Keeping the logical source mounted lets
 * the existing clean-only reseed/dirty buffer guard do its job; content hashes
 * remounted it and silently lost unsaved text/focus. Revision belongs in the
 * captured save precondition instead. Tuple encoding avoids delimiter aliases.
 */
export function profileEditorIdentity(
	profile: Pick<ReusableProfile, "name" | "source" | "agent_id">,
): string {
	return JSON.stringify(
		profile.agent_id
			? ["agent", "id", profile.agent_id]
			: ["agent", "source", profile.source, profile.name],
	);
}

/** Teams have an immutable registry ID; older local-only rows retain name scope. */
export function teamEditorIdentity(
	team: Pick<ReusableTeam, "name" | "id">,
): string {
	return JSON.stringify(
		team.id ? ["team", "id", team.id] : ["team", "local", team.name],
	);
}
