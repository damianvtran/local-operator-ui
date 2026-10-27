/**
 * The Skills tab's pure rules: how a `skills.list` row becomes a card, how a
 * card joins the hub link it belongs to, and how the details view recovers the
 * SKILL.md body from a response that may not carry it inline.
 *
 * Pure on purpose (no React, no transport) so each rule is pinned without
 * mounting anything, and so the page and the tests read ONE definition.
 *
 * WHAT CORE SENDS (local-operator #2998, `skill_library:1`): every field past
 * `name` is optional on the wire. A backend that predates the capability never
 * reaches this module (the tab is not offered), but a row can still arrive short
 * - a missing `source` is an unknown source, a missing `installed` is installed -
 * and a card degrades to what it knows instead of throwing.
 */

import type { HubLink } from "@shared/api/local-operator/hub-links";
import {
	type HubUpdateItem,
	hubItemKey,
} from "@shared/api/local-operator/hub-updates";
import type {
	SkillDetailWire,
	SkillRowWire,
} from "../../../../shared/desktop-contract";
import {
	type HubSkillState,
	hubSkillState,
} from "../agent-hub/hub-skill-state";

/**
 * The five labels core classifies a skill into, in the order it checks them
 * (`desktop_skills.SourceClassifier`). FIVE, not the hub's four: `external`
 * (another tool's skills folder) and `project` (a folder's own skills) are
 * read-only places the hub has no word for.
 */
export const SKILL_SOURCES = [
	"builtin",
	"hub",
	"local",
	"external",
	"project",
] as const;
export type SkillSource = (typeof SKILL_SOURCES)[number];

/** A list row, normalised: the shape the roster and the details pane draw. */
export type SkillCard = {
	name: string;
	description: string;
	/** Null when core sent a label this build does not know (or none at all). */
	source: SkillSource | null;
	/** Set only for `source === "hub"` rows with a confirmed origin. */
	linkId: string | null;
	/** False = a subscribed link whose content is absent on this machine. */
	installed: boolean;
	fingerprint: string | null;
	form: "document" | "bundle" | null;
};

function sourceOf(value: string | null | undefined): SkillSource | null {
	return (SKILL_SOURCES as readonly string[]).includes(value ?? "")
		? (value as SkillSource)
		: null;
}

export function toSkillCard(row: SkillRowWire): SkillCard {
	return {
		name: row.name,
		description: row.description ?? "",
		source: sourceOf(row.source),
		linkId: row.link_id ?? null,
		// ABSENT READS AS INSTALLED: only an explicit `false` is "subscribed, not
		// installed". An older row has no such field and is, by construction, a
		// discovered folder on disk.
		installed: row.installed !== false,
		fingerprint: row.fingerprint ?? null,
		form: row.form === "document" || row.form === "bundle" ? row.form : null,
	};
}

/** Alphabetical, so a refetch never reshuffles the roster under the reader. */
export function toSkillCards(rows: readonly SkillRowWire[]): SkillCard[] {
	return rows
		.map(toSkillCard)
		.sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * The hub facts a card is drawn from, joined by `link_id` and never by name.
 *
 * Only `hub` rows have a hub relationship: a built-in, local, external or
 * project skill returns `null`, and the card says nothing about the hub rather
 * than inventing "not downloaded" for a folder that is plainly on disk.
 *
 * The state itself is `hubSkillState()` - the Hub's own function - so a waiting
 * update, an applied one, a subscription and a manual copy are decided in one
 * place for both surfaces.
 */
export type SkillHubJoin = {
	state: HubSkillState;
	link: HubLink | undefined;
	update: HubUpdateItem | undefined;
};

export function joinSkillHub(
	card: SkillCard,
	links: readonly HubLink[] | undefined,
	updates: ReadonlyMap<string, HubUpdateItem>,
	/** False while the links inventory is loading or has failed. */
	inventoryReady: boolean,
): SkillHubJoin | null {
	if (card.source !== "hub") return null;
	const link = card.linkId
		? links?.find(
				(entry) => entry.kind === "skill" && entry.link_id === card.linkId,
			)
		: undefined;
	const update = link ? updates.get(hubItemKey("skill", link.name)) : undefined;
	return {
		state: hubSkillState(link, update, inventoryReady),
		link,
		update,
	};
}

/**
 * The text filter: name, description or source word, case-insensitive.
 * `sourceWord` is the TRANSLATED label so a reader can type the word they see.
 */
export function filterSkills(
	cards: readonly SkillCard[],
	search: string,
	sourceWord: (source: SkillSource | null) => string,
): SkillCard[] {
	const needle = search.trim().toLowerCase();
	if (!needle) return [...cards];
	return cards.filter(
		(card) =>
			card.name.toLowerCase().includes(needle) ||
			card.description.toLowerCase().includes(needle) ||
			sourceWord(card.source).toLowerCase().includes(needle),
	);
}

/**
 * The SKILL.md body of a details read.
 *
 * Core sends the body ONE of two ways, never both, so a 1 MiB file is not a
 * doubled response:
 *
 *  - `body_in_detail: true` -> `skill_detail.body` is null and the body is the
 *    PREFIX of the same response's `detail` text: `detail.slice(0, body_length)`.
 *    `body_length` is in UTF-16 CODE UNITS, which is exactly what JavaScript's
 *    `String.prototype.slice` and `.length` count, so the slice is right for an
 *    emoji (2 units here; 1 code point in Python) without any conversion. Do NOT
 *    "fix" this with `Array.from` or a code-point iterator: that counts the
 *    wrong thing and would cut a body that holds an astral character short.
 *  - otherwise the body is inlined as `skill_detail.body`.
 *
 * Returns null when there is nothing to show: a subscribed-not-installed skill
 * (no SKILL.md on this machine), or a response whose `detail` is missing while
 * the body claims to live there.
 */
export function skillBody(
	detail: string | null | undefined,
	skillDetail: SkillDetailWire | null | undefined,
): string | null {
	if (!skillDetail) return null;
	if (skillDetail.body_in_detail) {
		if (typeof detail !== "string") return null;
		if (typeof skillDetail.body_length !== "number") return null;
		return detail.slice(0, skillDetail.body_length);
	}
	return typeof skillDetail.body === "string" ? skillDetail.body : null;
}
