/**
 * The run's "what changed" summary: a before/after diff over the catalogue
 * fields the LISTS actually carry.
 *
 * WHY A CLIENT-SIDE DIFF AT ALL. The backend already tells the page that
 * something moved — the `authoring` frame, one per tick, carrying a revision and
 * nothing else ("a per-name diff ... is not expressible: the frame says 'your
 * profile and team lists are stale'", `desktop_feed.py`). So the page cannot ask
 * "what did the run do" and must answer it the way a reader would: from the two
 * lists it already has, taken at send time and at settle.
 *
 * WHAT THIS CAN AND CANNOT SEE, stated because the copy depends on it:
 *
 * - The lists are the DETAIL-FREE catalogue (`profile_catalogue` builds with
 *   `detail=False`), so `instructions` is not in them and an instruction-only
 *   edit produces no field diff. The summary says so rather than reporting
 *   nothing, because "the reviewer was updated" with no visible field is a real
 *   and common outcome of this feature.
 * - Teams carry their members and manager in the list, so those ARE diffable.
 * - Nothing here is a claim about the run's intent — only about the registries
 *   before and after, which is the fact the operator cares about.
 */

import type {
	ReusableProfile,
	ReusableTeam,
} from "@shared/api/local-operator/profile-hooks";
import type { RunChange, RunResult, RunTarget } from "./config-run-store";

/** One definition's diffable fields, canonicalised to strings. */
type Signature = Record<string, string>;

export type CatalogueSnapshot = {
	agents: Record<string, Signature>;
	teams: Record<string, Signature>;
};

/** The operator's words for a field, so the summary never says `tools`. */
const FIELD_LABEL: Record<string, string> = {
	description: "description",
	kind: "kind",
	tools: "tools",
	effort: "effort tier",
	delegate: "delegation",
	action_class: "class",
	manager: "manager",
	members: "members",
	instructions: "instructions",
};

function agentSignature(profile: ReusableProfile): Signature {
	return {
		description: profile.description ?? "",
		kind: profile.kind,
		/*
		 * `null` and `[]` are the same meaning on this wire ("every tool"), and a
		 * diff that reported a change between them would be a change the operator
		 * cannot make and cannot see.
		 */
		tools:
			profile.tools && profile.tools.length > 0
				? [...profile.tools].sort().join(",")
				: "*",
		effort: profile.effort ?? "inherit",
		delegate: String(Boolean(profile.delegate)),
	};
}

function teamSignature(team: ReusableTeam): Signature {
	return {
		description: team.description ?? "",
		manager: team.manager ?? "",
		members: (team.members ?? [])
			.map((member) => `${member.kind}:${member.role}x${member.count}`)
			.sort()
			.join(","),
	};
}

export function snapshotCatalogue(
	profiles: readonly ReusableProfile[] | undefined,
	teams: readonly ReusableTeam[] | undefined,
): CatalogueSnapshot {
	return {
		agents: Object.fromEntries(
			(profiles ?? []).map((row) => [row.name, agentSignature(row)]),
		),
		teams: Object.fromEntries(
			(teams ?? []).map((row) => [row.name, teamSignature(row)]),
		),
	};
}

/** The tool names/verbs whose edits are worth saying out loud, widened or narrowed. */
function describeTools(before: string, after: string): string {
	if (before === after) return "tools";
	const set = (value: string) =>
		value === "*" ? null : new Set(value.split(","));
	const first = set(before);
	const second = set(after);
	if (second === null) return "tools widened to every tool";
	if (first === null) return "tools narrowed to a list";
	const added = [...second].filter((tool) => !first.has(tool));
	const removed = [...first].filter((tool) => !second.has(tool));
	if (added.length && !removed.length)
		return added.length === 1
			? `tool added: ${added[0]}`
			: `${added.length} tools added`;
	if (removed.length && !added.length)
		return removed.length === 1
			? `tool removed: ${removed[0]}`
			: `${removed.length} tools removed`;
	return "tools changed";
}

function describeField(field: string, before: string, after: string): string {
	if (field === "tools") return describeTools(before, after);
	if (field === "delegate")
		return after === "true" ? "delegation turned on" : "delegation turned off";
	if (field === "members") {
		const count = (value: string) => (value ? value.split(",").length : 0);
		return `members changed (${count(before)} to ${count(after)})`;
	}
	return `${FIELD_LABEL[field] ?? field} changed`;
}

/**
 * What the run did, from the two snapshots and the definitions its tool rows
 * named.
 *
 * A CREATE is reported for a name that was absent before and present after; an
 * UPDATE for a name present in both whose fields differ. A definition the run
 * touched but whose catalogue fields did not move is reported with an empty
 * change list, and the strip says the honest sentence for it — the run wrote
 * something the list cannot show (instructions), or it wrote the same values
 * back.
 */
export function diffCatalogue(
	before: CatalogueSnapshot,
	after: CatalogueSnapshot,
	touched: readonly RunTarget[],
): RunResult[] {
	const results: RunResult[] = [];
	const seen = new Set<string>();

	for (const target of touched) {
		const key = `${target.kind}:${target.name}`;
		if (seen.has(key)) continue;
		seen.add(key);
		const beforeRow =
			before[target.kind === "agent" ? "agents" : "teams"][target.name];
		const afterRow =
			after[target.kind === "agent" ? "agents" : "teams"][target.name];
		if (!afterRow) continue; // Deleted, or a name the run only read.
		if (!beforeRow) {
			results.push({ target, created: true, changes: [] });
			continue;
		}
		const changes: RunChange[] = [];
		for (const field of Object.keys(afterRow)) {
			if (afterRow[field] === beforeRow[field]) continue;
			changes.push({
				label: describeField(field, beforeRow[field], afterRow[field]),
				before: beforeRow[field],
				after: afterRow[field],
			});
		}
		results.push({ target, created: false, changes });
	}

	/*
	 * A row that APPEARED but whose tool row the strip could not read (the frames
	 * that name a tool call and its target are a spike item on the backend side)
	 * is still a change the operator must be told about. Reported after the named
	 * ones, and never a duplicate of them.
	 */
	for (const [kind, rows] of [
		["agent", after.agents],
		["team", after.teams],
	] as const) {
		for (const name of Object.keys(rows)) {
			if (seen.has(`${kind}:${name}`)) continue;
			const existedBefore =
				kind === "agent" ? before.agents[name] : before.teams[name];
			if (existedBefore) continue;
			results.push({ target: { kind, name }, created: true, changes: [] });
		}
	}

	return results;
}
