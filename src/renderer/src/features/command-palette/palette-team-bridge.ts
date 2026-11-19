/**
 * Team Bridge rows for the command palette (operator, 2026-11-04: "make team
 * bridge and the various channels, groups, DMs, etc available through the
 * command palette ... hop into team bridge by searching for the channel, team
 * member, agent, DM, group").
 *
 * PURE, LIKE `palette-search.ts`. The hook beside it
 * (`use-palette-team-bridge.ts`) owns the React and the cache reads; this module
 * turns what those reads hold into palette rows, so the mapping - which rows
 * exist, what they are called, where they go - is pinned by
 * `scripts/palette-team-bridge.test.mjs` without a DOM.
 *
 * THE RAIL'S RULES, CALLED RATHER THAN RESTATED. Every decision about what a row
 * is comes from `team-bridge-model.ts`, the module the rail itself renders from:
 * titles (`conversationTitle`), the person's name (`personDisplayLabel`), who is
 * a chief of staff (`chiefsOfStaff`) and the owner-disambiguated label
 * "Aida (Ola Fagbemi)" (`composeChiefLabel`, #1643), which person a DM belongs
 * to (`dmWithPerson` / `dmWithAgent`), which DMs no person row paints
 * (`unmatchedDirects`) and whether a person row is inert (`personRowState`). A
 * palette that re-derived any of these would be the second opinion that makes
 * the two surfaces disagree about what a conversation is called.
 *
 * WHAT IS LEFT OUT, and why:
 * - archived conversations: the rail lists them only behind a section menu, never
 *   in its own lists, and the live list this reads carries none;
 * - the reader's own person row, and a person whose bridge is off with no DM to
 *   reopen: the rail draws both as inert, so a palette row for them would open
 *   nothing;
 * - muted counts: only an UNMUTED unread count is an attention mark, the rule the
 *   nav badge and the shared unread view apply (`team-bridge-unread-sync.ts`).
 */

import { t } from "../../../../i18n/messages";
import type {
	TeamBridgeConversation,
	TeamBridgeDirectoryMember,
} from "../../../../shared/team-bridge-contract";
import {
	type TeamBridgeLink,
	teamBridgeTargetPath,
} from "../team-bridge/team-bridge-deep-link";
import {
	type ChiefLabels,
	type TeamBridgeOrganization,
	chiefsOfStaff,
	composeChiefLabel,
	conversationOrganizationName,
	conversationTitle,
	dmWithAgent,
	dmWithPerson,
	personDisplayLabel,
	personRowState,
	railSections,
	showsMutedGlyph,
	unmatchedDirects,
} from "../team-bridge/team-bridge-model";
import type { PaletteIconName, PaletteItem } from "./palette-search";

export type PaletteTeamBridgeInput = {
	/** The account-scope live list (`teamBridgeKeys.conversations("all", ...)`). */
	conversations: readonly TeamBridgeConversation[];
	/** Loaded rosters by tenant; a pending or failed read is absent. */
	directories: Readonly<Record<string, readonly TeamBridgeDirectoryMember[]>>;
	organizations: readonly TeamBridgeOrganization[];
	selfAccountId: string;
	chiefLabels: ChiefLabels;
	/**
	 * The shared unread view's count for a conversation, when it holds one: the
	 * same number the rail and the nav badge show, which can be newer than the
	 * list row's `unread_count` (a read cursor patched after the list was read).
	 */
	unreadOf?: (tenantId: string, conversationId: string) => number | undefined;
};

const KIND_ICON: Record<TeamBridgeConversation["kind"], PaletteIconName> = {
	channel: "hash",
	group: "team",
	dm: "at-sign",
};

/*
 * The short words people type for each KIND (UX round 1, U4): "dm", "channels",
 * "people" used to reach only the destination row, so "dm ola" found nothing.
 * English, as every palette keyword list is (`use-palette-sources.ts`'s pages):
 * the localized kind noun is already in each row's hint, so a non-English
 * reader's own word ("Mensaje directo") matches through that field.
 */
const KIND_WORDS: Record<TeamBridgeConversation["kind"], readonly string[]> = {
	channel: ["channel", "channels"],
	group: ["group", "groups"],
	dm: ["dm", "dms", "direct message"],
};
const PERSON_WORDS: readonly string[] = [...KIND_WORDS.dm, "people", "person"];

const kindHint = (kind: TeamBridgeConversation["kind"]): string =>
	kind === "dm"
		? t("ui.teamBridge.kind.dm")
		: kind === "group"
			? t("ui.teamBridge.kind.group")
			: t("ui.teamBridge.kind.channel");

export function paletteTeamBridgeItems(
	input: PaletteTeamBridgeInput,
): PaletteItem[] {
	const { directories, organizations, selfAccountId, chiefLabels } = input;
	/*
	 * A conversation of an organization the hub does not list is a row the page
	 * refuses to render a thread for (`visibleConversationRows`), so the palette
	 * does not offer it either. With no organization list at all (the status
	 * has not named any yet), nothing is offered: a row whose organization
	 * cannot be named is a row whose open lands in the wrong place.
	 */
	const known = input.conversations.filter(
		(conversation) =>
			conversation.status !== "archived" &&
			conversationOrganizationName(conversation, organizations) !== null,
	);
	const multiOrg = organizations.length > 1;
	const hintFor = (kind: string, tenantId: string) => {
		if (!multiOrg) return kind;
		const organization = organizations.find(
			(row) => row.tenantId === tenantId,
		)?.name;
		return organization
			? t("ui.teamBridge.notify.subtitle", { place: kind, organization })
			: kind;
	};
	const attentionOf = (conversation: TeamBridgeConversation | null) => {
		if (!conversation || showsMutedGlyph(conversation)) return undefined;
		const count =
			input.unreadOf?.(conversation.tenant_id, conversation.id) ??
			conversation.unread_count;
		return count > 0 ? count : undefined;
	};
	const items: PaletteItem[] = [];
	const push = (
		row: Omit<PaletteItem, "kind" | "group" | "target" | "order"> & {
			link: TeamBridgeLink;
		},
	) => {
		const { link, ...rest } = row;
		items.push({
			...rest,
			kind: "bridge",
			group: "teamBridge",
			target: { type: "bridge", path: teamBridgeTargetPath(link) },
			order: items.length,
		});
	};
	const conversationRow = (conversation: TeamBridgeConversation) =>
		push({
			id: `bridge-conversation-${conversation.tenant_id}-${conversation.id}`,
			name:
				conversationTitle(conversation, selfAccountId) ??
				t("ui.teamBridge.list.untitled"),
			hint: hintFor(kindHint(conversation.kind), conversation.tenant_id),
			icon: KIND_ICON[conversation.kind],
			bridgeChannel: conversation.kind === "channel" || undefined,
			keywords: conversation.topic
				? [conversation.topic, ...KIND_WORDS[conversation.kind]]
				: [...KIND_WORDS[conversation.kind]],
			attention: attentionOf(conversation),
			link: {
				tenantId: conversation.tenant_id,
				target: { type: "conversation", id: conversation.id },
			},
		});

	// Organization order is the switcher's, so a two-org list reads as the rail does.
	for (const organization of organizations) {
		const tenantId = organization.tenantId;
		const rows = known.filter((row) => row.tenant_id === tenantId);
		const { channels, groups, directs } = railSections(rows);
		for (const conversation of [...channels, ...groups])
			conversationRow(conversation);
		const people = directories[tenantId];
		const chiefs = people ? chiefsOfStaff(people, selfAccountId) : [];
		for (const member of people ?? []) {
			const dm = dmWithPerson(directs, member.account_id, selfAccountId);
			const state = personRowState(member, selfAccountId);
			if (state === "self" || (state === "unavailable" && !dm)) continue;
			push({
				id: `bridge-person-${tenantId}-${member.account_id}`,
				name: personDisplayLabel(member),
				/*
				 * "Direct message", the rail's own kind word: choosing a person opens
				 * their DM (or an empty draft to them), which is what the row does.
				 */
				hint: hintFor(t("ui.teamBridge.kind.dm"), tenantId),
				icon: "person",
				keywords: [...PERSON_WORDS],
				attention: attentionOf(dm),
				link: {
					tenantId,
					target: { type: "person", accountId: member.account_id },
				},
			});
		}
		for (const chief of chiefs) {
			const owner = personDisplayLabel(chief.person);
			push({
				id: `bridge-chief-${tenantId}-${chief.person.account_id}`,
				name: composeChiefLabel(chief.agentName, owner, chiefLabels),
				/* The rail's own role noun, so the two surfaces name a chief identically. */
				hint: hintFor(t("ui.teamBridge.chief.fallback"), tenantId),
				icon: "agents",
				/* Typing the OWNER's name finds their chief too ("ola" -> Aida (Ola)). */
				keywords: [owner],
				attention: attentionOf(
					dmWithAgent(directs, chief.person.account_id, selfAccountId),
				),
				link: {
					tenantId,
					target: { type: "chief", accountId: chief.person.account_id },
				},
			});
		}
		/*
		 * DMs no person or chief row paints: a person who left, an agent whose
		 * owner unenrolled - and, while a roster is still loading or failed, every
		 * DM of that organization, so a cold palette can still reach them by the
		 * name the DM itself carries.
		 */
		for (const conversation of unmatchedDirects(
			directs,
			people ?? [],
			chiefs,
			selfAccountId,
		))
			conversationRow(conversation);
	}
	return items;
}
