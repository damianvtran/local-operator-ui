import { type WithoutParams, t } from "@shared/i18n";
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
import { classOf } from "../utils/agent-class";
import type { RunChange, RunResult, RunTarget } from "./config-run-store";

/**
 * The tool rows this feature reads, and nothing else on the wire is consulted.
 *
 * BOTH registry tools, because those are the only two the run's declared
 * inventory holds (`agent`, `team`); a row for anything else is a tool the run
 * should not have and is deliberately not projected.
 */
export const RUN_TOOL_NAMES: ReadonlySet<string> = new Set(["agent", "team"]);

/** One tool row of the run's own transcript, as this projection reads it. */
export type RunToolRow = {
	toolName: string;
	args: Record<string, unknown> | null;
	phase: string;
	/** The row's own instant, for ordering the strip's steps. */
	ts: number;
	/**
	 * The transcript's own verdicts on the call, and the reason `writes` needs
	 * them: an op that WRITES is not the same fact as a write that LANDED. Both
	 * are optional because the projection is also called by tests and by callers
	 * that hold only a name and args.
	 */
	isError?: boolean;
	notRunReason?: string | null;
	neverSent?: boolean;
};

/** The stable activity descriptor retained from a transcript row. */
export type RunToolVerb =
	| {
			operation: "create" | "update";
			kind: RunTarget["kind"];
			name: string | null;
	  }
	| { operation: "install"; name: string | null }
	| { operation: "read"; kind: RunTarget["kind"]; name: string | null }
	| { operation: "unknown"; kind: RunTarget["kind"]; running: boolean };

/** Format activity at render time, after any live language switch. */
export function formatRunToolVerb(verb: RunToolVerb): string {
	switch (verb.operation) {
		case "create":
			return verb.name
				? t("ui.agents.config.summary_creating_named", {
						kind: verb.kind,
						name: verb.name,
					})
				: t("ui.agents.config.summary_creating_kind", { kind: verb.kind });
		case "update":
			return verb.name
				? t("ui.agents.config.summary_updating_named", {
						kind: verb.kind,
						name: verb.name,
					})
				: t("ui.agents.config.summary_updating_kind", { kind: verb.kind });
		case "install":
			return verb.name
				? t("ui.agents.config.summary_installing_named", { name: verb.name })
				: t("ui.agents.config.summary_installing_agent");
		case "read":
			return verb.name
				? t("ui.agents.config.summary_reading_named", { name: verb.name })
				: t("ui.agents.config.summary_reading_kind", { kind: verb.kind });
		case "unknown":
			return verb.running
				? t("ui.agents.config.summary_working_kind", { kind: verb.kind })
				: t("ui.agents.config.summary_checked_kind", { kind: verb.kind });
	}
}

/**
 * One tool row's own words for what it is doing, when it names a definition.
 *
 * WHICH FRAMES NAME A TOOL CALL AND ITS TARGET IS A SPIKE ITEM ON THE BACKEND
 * SIDE (design consult § 8 Q4), so this projection is deliberately tolerant: it
 * reads the argument names the tools' OWN schemas use (`op`, `name` — the row's
 * arguments are the call's arguments, and `AgentParams`/`TeamParams` are what
 * produced them), and it reports nothing rather than guessing when they are
 * absent. A strip that said "Updating something" would be worse than one that
 * only shows the elapsed time.
 *
 * IT ALSO CLASSIFIES THE CALL, and that half is not cosmetic: the run's
 * inventory includes `list`/`show`/`search`, so a summary built from every row
 * that NAMES a definition would report a definition the run merely LOOKED UP as
 * "updated, changed nothing". A read paints a step line and nothing else.
 *
 * A WRITE IS NOT COUNTED UNTIL IT LANDED, which is the other half of the same
 * question (review round 1, M4): a refused create (`role 'x' already exists`),
 * an `update` the backend rejects, or a call the harness never ran is a row
 * that NAMES a definition and does not change one. Counting those put "Updated
 * reviewer: its settings changed" on the one surface whose whole job is to say
 * exactly what changed — and it was false. So `writes` means the registry was
 * WRITTEN: the op writes, the row settled, and it neither failed nor was
 * skipped. A pending or failed call leaves the touched set alone, and the row
 * still paints its step line in the Watch list.
 */
export function projectRunToolRow(row: RunToolRow): {
	verb: RunToolVerb;
	target: RunTarget | null;
	/** Whether this call WRITES the registry rather than reading it. */
	writes: boolean;
} {
	const op = typeof row.args?.op === "string" ? row.args.op : null;
	const name = typeof row.args?.name === "string" ? row.args.name : null;
	const kind: "agent" | "team" = row.toolName === "team" ? "team" : "agent";
	const target = name ? { kind, name } : null;
	/*
	 * Landed, not merely attempted. `phase` is the transcript's own compose →
	 * queued → running → done ladder, and a row that is not `done` may still be
	 * dictating its arguments or waiting behind a sibling; `notRunReason` is the
	 * harness's statement that the call will never run, and `isError` is the
	 * tool's own failure. `neverSent` covers the third absence — a turn that died
	 * with the call still in flight — where there is no verdict to read.
	 */
	const landed =
		row.phase === "done" && !row.isError && !row.notRunReason && !row.neverSent;
	const write = (writes: boolean) => ({ writes: writes && landed });
	switch (op) {
		case "create":
			return {
				verb: { operation: "create", kind, name },
				target,
				...write(true),
			};
		case "update":
			return {
				verb: { operation: "update", kind, name },
				target,
				...write(true),
			};
		case "install":
			return {
				verb: { operation: "install", name },
				target,
				...write(true),
			};
		case "list":
		case "search":
		case "show":
			return {
				verb: { operation: "read", kind, name },
				target,
				...write(false),
			};
		default:
			/*
			 * An op this projection cannot read counts as a WRITE once it has landed:
			 * the failure direction is to report a change nobody made over hiding one
			 * the operator will see in the list.
			 */
			return {
				verb: {
					operation: "unknown",
					kind,
					running: row.phase === "running",
				},
				target,
				...write(true),
			};
	}
}

/** One definition's diffable fields, canonicalised to strings. */
type Signature = Record<string, string>;

export type CatalogueSnapshot = {
	agents: Record<string, Signature>;
	teams: Record<string, Signature>;
};

/** The operator's words for a field, so the summary never says `tools`. */
function fieldLabelKey(field: string): WithoutParams | undefined {
	switch (field) {
		case "description":
			return "ui.agents.config.summary_field_description";
		case "kind":
			return "ui.agents.config.summary_field_kind";
		case "tools":
			return "ui.agents.config.summary_field_tools";
		case "effort":
			return "ui.agents.config.summary_field_effort";
		case "delegate":
			return "ui.agents.config.summary_field_delegate";
		case "action_class":
			return "ui.agents.config.summary_field_class";
		case "manager":
			return "ui.agents.config.summary_field_manager";
		case "members":
			return "ui.agents.config.summary_field_members";
		case "instructions":
			return "ui.agents.config.summary_field_instructions";
		default:
			return undefined;
	}
}

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
		/*
		 * THE CLASS IS DIFFABLE like every other definition field, and it has to
		 * be: a configuration run can set it (`agent_tool`'s `action_class`), so a
		 * signature that left it out would report a run that flipped an agent to
		 * proactive as one that "changed no listed field" — the run summary
		 * silently endorsing an agent that has just started messaging the operator.
		 * Read through `classOf` rather than off the payload so the absent spelling
		 * and `reactive` collapse to the same value, which is how the wire treats
		 * them.
		 */
		action_class: classOf(profile),
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
	if (before === after) return t("ui.agents.config.summary_tools");
	const set = (value: string) =>
		value === "*" ? null : new Set(value.split(","));
	const first = set(before);
	const second = set(after);
	if (second === null) return t("ui.agents.config.summary_tools_widened");
	if (first === null) return t("ui.agents.config.summary_tools_narrowed");
	const added = [...second].filter((tool) => !first.has(tool));
	const removed = [...first].filter((tool) => !second.has(tool));
	if (added.length && !removed.length)
		return added.length === 1
			? t("ui.agents.config.summary_tool_added", { tool: added[0] })
			: t("ui.agents.config.summary_tools_added", { count: added.length });
	if (removed.length && !added.length)
		return removed.length === 1
			? t("ui.agents.config.summary_tool_removed", { tool: removed[0] })
			: t("ui.agents.config.summary_tools_removed", { count: removed.length });
	return t("ui.agents.config.summary_tools_changed");
}

/** Format one retained change in the locale of the settled result's current render. */
export function formatRunChange(
	field: string,
	before: string,
	after: string,
): string {
	if (field === "tools") return describeTools(before, after);
	if (field === "delegate")
		return after === "true"
			? t("ui.agents.config.summary_delegation_on")
			: t("ui.agents.config.summary_delegation_off");
	/*
	 * The class page follows `delegate`'s shape on purpose: the two are the
	 * definition's BEHAVIOUR switches, and "class changed" would leave the reader
	 * to work out which way — which is the one fact this sentence exists for when
	 * the new value means the agent may message them unprompted.
	 */
	if (field === "action_class")
		return after === "proactive"
			? t("ui.agents.config.summary_class_proactive")
			: t("ui.agents.config.summary_class_reactive");
	if (field === "members") {
		const count = (value: string) => (value ? value.split(",").length : 0);
		return t("ui.agents.config.summary_members_changed", {
			before: count(before),
			after: count(after),
		});
	}
	const label = fieldLabelKey(field);
	return t("ui.agents.config.summary_field_changed", {
		field: label ? t(label) : field,
	});
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
				field,
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
