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
	/**
	 * CORE'S OWN ANSWER to "may this skill be changed here", carried, never
	 * re-derived (design spec §5.1 / C3). Core decides `source ∈ {hub, local} &&
	 * form == "document"` and false for a not-installed row
	 * (`desktop_skills.py`); a second copy of that rule in the renderer would
	 * disagree the first time core moved it. Only an explicit `true` is editable.
	 */
	editable: boolean;
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
		editable: row.editable === true,
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

/* ------------------------------------------------------- front matter --- */

/**
 * A SKILL.md split into its YAML front matter and the instructions after it.
 *
 * WHY THE PANE STRIPS IT (design spec §0 finding 1, §3.3). The details pane says
 * the description once, under "When to use it"; the raw file then said it again
 * in monospace as `description:` inside the `---` block, and the instructions
 * themselves started below the fold. Core already parses `name` and
 * `description` onto the row, so the block is shown as instructions only, and
 * any OTHER key goes to Details → Other front matter, so nothing in the file
 * becomes unreachable.
 *
 * THE RULE IS NARROW ON PURPOSE: strip only when the body BEGINS with a `---`
 * line at offset 0 and a closing `---` line exists. Anything else - no front
 * matter, a fence that is not the first line, or a TRUNCATED body whose closing
 * fence was cut off - is returned untouched, so a file is never shown
 * half-stripped. Call it AFTER `skillBody`: the UTF-16 slice there is about the
 * raw body, and stripping first would desynchronise it.
 *
 * `head` and `tail` are the exact bytes around `meta` (the opening fence line
 * and the closing fence line), and `gap` is the blank lines between the closing
 * fence and the instructions, so `rebuildSkillMd` can put an unchanged file
 * back together byte for byte.
 */
export type SkillMdParts = {
	/** The text between the fences, or null when there is no front matter. */
	meta: string | null;
	/** The instructions, with the blank lines after the closing fence removed. */
	text: string;
	head: string;
	tail: string;
	gap: string;
};

const FRONT_MATTER =
	/^(---[ \t]*\r?\n)(?:([\s\S]*?)\r?\n)?(---[ \t]*(?:\r?\n|$))/;

const LEADING_BLANK_LINES = /^(?:[ \t]*\r?\n)*/;
const INDENTED = /^[ \t]+\S/;
const BLANK = /^[ \t]*$/;
const LINE_BREAK = /\r?\n/;
/**
 * What makes a description unsafe as a PLAIN YAML scalar, so it is quoted
 * instead: a line break, a leading indicator character, trailing space, a
 * `: ` or ` #` inside (a mapping or a comment), a trailing colon, or a word YAML
 * would read as a boolean, null or number.
 */
const YAML_UNSAFE: readonly RegExp[] = [
	/[\n\r]/,
	/^[\s\-?:,[\]{}#&*!|>'"%@`]/,
	/\s$/,
	/: |\s#/,
	/:$/,
	/^(true|false|null|yes|no|on|off|~|[-+]?[0-9][0-9_.eE+-]*)$/i,
];

export function splitFrontMatter(body: string): SkillMdParts {
	const match = FRONT_MATTER.exec(body);
	if (!match) return { meta: null, text: body, head: "", tail: "", gap: "" };
	const head = match[1];
	const meta = match[2] ?? "";
	// The closing fence and the newline that separated it from `meta`.
	const tail = match[0].slice(head.length + meta.length);
	const rest = body.slice(match[0].length);
	const gap = LEADING_BLANK_LINES.exec(rest)?.[0] ?? "";
	return { meta, text: rest.slice(gap.length), head, tail, gap };
}

/**
 * The line ranges of one top-level YAML key: the `key:` line plus its
 * continuation (indented lines, and blank lines that are followed by more
 * indented lines - a folded `description: >` block).
 */
function keyBlock(
	lines: readonly string[],
	key: string,
): [number, number] | null {
	const start = lines.findIndex((line) =>
		new RegExp(`^${key}[ \\t]*:`).test(line),
	);
	if (start < 0) return null;
	let end = start + 1;
	while (end < lines.length) {
		const line = lines[end];
		if (INDENTED.test(line)) {
			end += 1;
			continue;
		}
		if (BLANK.test(line)) {
			const next = lines.slice(end).findIndex((later) => !BLANK.test(later));
			if (next > 0 && INDENTED.test(lines[end + next])) {
				end += next;
				continue;
			}
		}
		break;
	}
	return [start, end];
}

/**
 * The front matter keys other than `name` and `description`, verbatim, or null.
 * These are what Details → Other front matter shows (design spec §3.3, item 4).
 */
export function otherFrontMatter(meta: string | null): string | null {
	if (meta === null) return null;
	const lines = meta.split(LINE_BREAK);
	const drop = new Set<number>();
	for (const key of ["name", "description"]) {
		const block = keyBlock(lines, key);
		if (!block) continue;
		for (let index = block[0]; index < block[1]; index += 1) drop.add(index);
	}
	const kept = lines
		.filter((_, index) => !drop.has(index))
		.join("\n")
		.trim();
	return kept ? kept : null;
}

/**
 * A YAML scalar for a one-field write. Plain when it is unambiguous, otherwise
 * double-quoted - which is JSON's string syntax, a valid YAML double-quoted
 * scalar, so escapes (a newline, a quote) round-trip through core's parser.
 */
function yamlScalar(value: string): string {
	const plain =
		value.length > 0 && !YAML_UNSAFE.some((pattern) => pattern.test(value));
	return plain ? value : JSON.stringify(value);
}

/**
 * The SKILL.md an inline edit saves: the ORIGINAL front matter with ONLY its
 * `description` replaced (every other key byte for byte, design spec §3.5 and
 * acceptance check 21), then the fences and the new instructions.
 *
 * A body with no front matter gets a minimal one naming the skill: core's
 * SKILL.md validation wants `name` and `description` there, and the edit's
 * description has to live somewhere.
 */
export function rebuildSkillMd(
	original: string,
	name: string,
	/** The new description, or null to keep the original's bytes untouched. */
	description: string | null,
	instructions: string,
): string {
	const parts = splitFrontMatter(original);
	if (parts.meta === null) {
		// No front matter at all and no new description: the file stays bare.
		if (description === null) return instructions;
		return `---\nname: ${yamlScalar(name)}\ndescription: ${yamlScalar(description.trim())}\n---\n\n${instructions}`;
	}
	if (description === null)
		// `head + meta + tail` is the original block byte for byte (an empty block's
		// `tail` already starts at its closing fence).
		return `${parts.head}${parts.meta}${parts.tail}${parts.gap}${instructions}`;
	const line = `description: ${yamlScalar(description.trim())}`;
	const lines = parts.meta === "" ? [] : parts.meta.split(LINE_BREAK);
	const block = keyBlock(lines, "description");
	if (block) lines.splice(block[0], block[1] - block[0], line);
	else lines.push(line);
	// An EMPTY meta matched without the newline before the closing fence, so the
	// rebuilt one supplies it.
	const meta = lines.join("\n");
	const tail = parts.meta === "" ? `\n${parts.tail}` : parts.tail;
	return `${parts.head}${meta}${tail}${parts.gap}${instructions}`;
}

/* -------------------------------------------------------- eligibility --- */

/**
 * What the open skill can have done to it, from core's facts alone (design spec
 * §3.2 / §5.1).
 *
 * - `edit`: inline Edit AND the composer. Only for an `editable` skill whose
 *   detail read reported NO reference files and an untruncated body, because
 *   `PUT /v1/desktop/skills/{name}` REPLACES the whole file set and the detail
 *   read carries only 2 KiB previews of the others: an inline save of SKILL.md
 *   alone would delete every reference file (spec C2).
 * - `ask`: `editable`, but the inline editor cannot be offered; the composer
 *   still can, because core's `skill` tool owns the file set. `reason` is the
 *   sentence the Instructions section gives.
 * - `read-only`: built-in, another tool's, a project's, a folder bundle, or a
 *   source this build does not know. `copy` says whether Copy to my skills is
 *   the way out (it is not for a bundle, which is already the reader's).
 * - `not-installed`: a subscribed hub link with no copy on this machine.
 */
export type SkillEditability =
	| { kind: "edit" }
	| { kind: "ask"; reason: "files" | "truncated" }
	| {
			kind: "read-only";
			reason: "builtin" | "external" | "project" | "bundle" | "unknown";
			copy: boolean;
	  }
	| { kind: "not-installed" };

export function skillEditability(
	card: SkillCard,
	detail: Pick<
		SkillDetailWire,
		"files" | "files_total" | "body_truncated"
	> | null,
): SkillEditability {
	if (!card.installed) return { kind: "not-installed" };
	if (card.editable) {
		const files = Math.max(
			detail?.files_total ?? 0,
			detail?.files?.length ?? 0,
		);
		if (files > 0) return { kind: "ask", reason: "files" };
		if (detail?.body_truncated) return { kind: "ask", reason: "truncated" };
		return { kind: "edit" };
	}
	if (card.form === "bundle")
		return { kind: "read-only", reason: "bundle", copy: false };
	if (
		card.source === "builtin" ||
		card.source === "external" ||
		card.source === "project"
	)
		return { kind: "read-only", reason: card.source, copy: true };
	return { kind: "read-only", reason: "unknown", copy: false };
}

/**
 * Why the Skills tab's docked composer refuses input, or null when it is live
 * (design spec §5.4). The backend's answer comes first: on a core without the
 * skill-run capability no row can be asked about, so the remedy (update) is the
 * one true sentence whatever is open.
 */
export type SkillComposerGate =
	| "backend"
	| "none"
	| "not-installed"
	| "read-only";

export function skillComposerGate(
	runEnabled: boolean,
	card: SkillCard | null,
): SkillComposerGate | null {
	if (!runEnabled) return "backend";
	if (!card) return "none";
	if (!card.installed) return "not-installed";
	if (!card.editable) return "read-only";
	return null;
}

/* --------------------------------------------------------- row states --- */

/**
 * The scope segments over the roster (design spec §2): four, not six. Other
 * tool and Project appear under All, and the search box matches their source
 * word.
 */
export const SKILL_SCOPES = ["all", "local", "hub", "builtin"] as const;
export type SkillScope = (typeof SKILL_SCOPES)[number];

export function scopeSkills(
	cards: readonly SkillCard[],
	scope: SkillScope,
): SkillCard[] {
	return scope === "all"
		? [...cards]
		: cards.filter((card) => card.source === scope);
}

/**
 * The ONE state word a roster row's second line leads with, or null (design
 * spec §2 table, highest priority first). The default - installed, following
 * updates, nothing waiting - says nothing: the source word already says where
 * the skill came from, and the old "Downloaded — subscribed" prefix is what
 * pushed every hub row's description out of view.
 *
 * `modified` needs a link check to have run: core's `classification` is null
 * before the first one, and null is "not known to be modified", never
 * "unmodified".
 */
export type SkillRowState =
	| "failed"
	| "available"
	| "applied"
	| "modified"
	| "not-installed"
	| "updates-off"
	| "unlinked";

const LOCAL_CHANGE_CLASSES: ReadonlySet<string> = new Set([
	"local-only",
	"both-changed",
]);

export function skillLocallyModified(join: SkillHubJoin | null): boolean {
	const classification = join?.link?.push?.classification;
	return typeof classification === "string"
		? LOCAL_CHANGE_CLASSES.has(classification)
		: false;
}

export function skillRowState(
	card: SkillCard,
	join: SkillHubJoin | null,
	/** The hub mark `skillMark()` already decided for this row. */
	markKind: "available" | "applied" | "failed" | "review" | "updating" | null,
): SkillRowState | null {
	if (!join) return null;
	if (markKind === "failed") return "failed";
	if (markKind === "available") return "available";
	if (markKind === "applied") return "applied";
	if (skillLocallyModified(join)) return "modified";
	if (!card.installed) return "not-installed";
	if (join.state.kind === "manual") return "updates-off";
	if (join.state.kind === "not-present") return "unlinked";
	return null;
}

/**
 * The plain state after the source word in the details header (design spec
 * §3.1), or null when the source word says it all (Local, Unknown source).
 */
export type SkillHeaderState =
	| "following"
	| "updates-off"
	| "not-installed"
	| "hub-unknown"
	| "unlinked"
	| "read-only";

export function skillHeaderState(
	card: SkillCard,
	join: SkillHubJoin | null,
): SkillHeaderState | null {
	// Core's `installed:false` is the fact whatever the source; the hub join only
	// adds WHY (subscribed with no copy).
	if (!card.installed) return "not-installed";
	if (
		card.source === "builtin" ||
		card.source === "external" ||
		card.source === "project"
	)
		return "read-only";
	if (card.source !== "hub" || !join) return null;
	switch (join.state.kind) {
		case "unknown":
			return "hub-unknown";
		case "not-present":
			return "unlinked";
		case "manual":
			return "updates-off";
		case "update":
			return join.state.link.policy.subscribe ? "following" : "updates-off";
		case "subscribed":
		case "detached":
			return "not-installed";
		default:
			return "following";
	}
}
