/**
 * Who the composer can @-mention, built ONLY from data the page already holds.
 *
 * WHY NO FETCH. The popover must open on the `@` keystroke. The organization
 * directory (`useTeamBridgeDirectory`, react-query, 30 s stale time) and the
 * open conversation's `members` are already in the cache by the time a reader
 * can type, so the candidate list is a pure projection of the two and costs
 * no request. A directory that has not answered yet still offers the
 * conversation's own members by their participant labels.
 *
 * Labels match the rest of Team Bridge: a person is `personDisplayLabel`, an
 * agent is the composed chief label ("Aida (Ben Tran)" or "Ben Tran's chief
 * of staff") from the same `ChiefLabels` the rail and message rows use, so
 * the name inserted after `@` is the name the reader sees everywhere else.
 */
import type {
	TeamBridgeConversation,
	TeamBridgeDirectoryMember,
} from "../../../../../shared/team-bridge-contract";
import {
	type ChiefLabels,
	composeChiefLabel,
	personDisplayLabel,
	personRowState,
} from "../team-bridge-model";
import type { MentionCandidate } from "./matcher";

/** A candidate plus the directory row its avatar is drawn from. */
export type MentionCandidateRow = MentionCandidate & {
	profile?: TeamBridgeDirectoryMember;
};

function liveMemberKeys(
	conversation: TeamBridgeConversation | null,
): ReadonlySet<string> {
	return new Set(
		(conversation?.members ?? [])
			.filter((m) => m.state === "active" || m.state === "invited")
			.map((m) => `${m.kind}:${m.account_id}`),
	);
}

export function buildMentionCandidates(input: {
	conversation: TeamBridgeConversation | null;
	people: readonly TeamBridgeDirectoryMember[];
	selfAccountId: string | undefined;
	chiefLabels: ChiefLabels;
	/** "chief of staff of {person}", localized by the caller. */
	agentSecondary: (person: string) => string;
}): MentionCandidateRow[] {
	const { conversation, people, selfAccountId, chiefLabels } = input;
	const members = liveMemberKeys(conversation);
	const rows: MentionCandidateRow[] = [];
	const seen = new Set<string>();
	for (const person of people) {
		const personLabel = personDisplayLabel(person);
		const state = personRowState(person, selfAccountId);
		const personOff = state === "unavailable";
		/*
		 * The reader's own human row is left out: mentioning yourself notifies
		 * nobody and only adds a row above the people the reader is looking
		 * for. Their own AGENT stays, because addressing it is a real action.
		 */
		if (state !== "self") {
			const key = `human:${person.account_id}`;
			seen.add(key);
			rows.push({
				kind: "human",
				accountId: person.account_id,
				label: personLabel,
				secondary: person.profile?.title || undefined,
				member: members.has(key),
				bridgeOff: personOff,
				profile: person,
			});
		}
		const agent = person.agent;
		if (!agent) continue;
		const key = `agent:${person.account_id}`;
		seen.add(key);
		const agentName = agent.name.trim();
		rows.push({
			kind: "agent",
			accountId: person.account_id,
			endpointId: agent.endpoint_id,
			label: composeChiefLabel(agentName, personLabel, chiefLabels),
			// "@ben" finds Ben's agent too; "@aida" finds it by its own name.
			aliases: [agentName, personLabel].filter((name) => name !== ""),
			secondary: input.agentSecondary(personLabel),
			member: members.has(key),
			bridgeOff:
				personOff || !(agent.state === "active" || agent.state === "paused"),
			profile: person,
		});
	}
	/*
	 * Members the directory does not list (the merged view before its rosters
	 * answer, a guest from another organization) are still in the room, so
	 * they are offered by their participant label. An agent member here has
	 * no endpoint on the participant row unless the hub passes one through;
	 * without it the token stays readable text and is left out of
	 * `mentions[]` (see `serializeMentions`), never sent as a row the backend
	 * would refuse.
	 */
	for (const member of conversation?.members ?? []) {
		const key = `${member.kind}:${member.account_id}`;
		if (seen.has(key) || !members.has(key)) continue;
		if (member.kind === "human" && member.account_id === selfAccountId)
			continue;
		seen.add(key);
		const endpoint = (member as { endpoint_id?: unknown }).endpoint_id;
		rows.push({
			kind: member.kind,
			accountId: member.account_id,
			...(member.kind === "agent" && typeof endpoint === "string"
				? { endpointId: endpoint }
				: {}),
			label: member.display_label,
			member: true,
			bridgeOff: false,
		});
	}
	return rows;
}
