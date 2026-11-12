/**
 * The New chat header's agent/team chip, as pure rules.
 *
 * WHY THIS EXISTS (operator request, 2026-11-11): a New chat pane offered no way
 * to choose who answers it - the only doors were the sidebar's "New chat with
 * <name>" rows and the `/agent` `/team` slash commands, neither discoverable
 * from the pane itself. The chip is a third door onto the SAME act: a pick
 * stages the draft's `target` through `restageDraft` (the dispatcher's draft
 * route and the sidebar's row stage exactly this), and the first send's
 * `sessions.create` carries it. Nothing here is a new source of truth; the
 * draft row's `target` is the only state the chip reads or writes.
 *
 * Kept free of React and `t()` so the rules are pinned by
 * `scripts/draft-target-chip.test.mjs` without a renderer; the component maps
 * the answers onto pixels and copy.
 */

import type {
	ChatTarget,
	ReusableProfile,
	ReusableTeam,
} from "@shared/api/local-operator/profile-hooks";
import { teamDisplayName } from "@shared/api/local-operator/team-display";

/** One pickable row: the slug the wire takes and the name the reader sees. */
export type DraftTargetRow = {
	kind: ChatTarget["kind"];
	name: string;
	label: string;
};

/**
 * Whether the chip exists on this pane: a NEW chat only.
 *
 * A live session keeps the header's identity switchers and the slash commands
 * (re-addressing a running conversation is a different act - `sessions.command`,
 * not a staged target). A draft whose create has already answered
 * (`draftSessionId`) is a conversation too: re-staging it would fork a fresh
 * draft out from under the failed message the row is holding for retry.
 */
export function draftTargetChipShown(input: {
	sessionId?: string | null;
	draftKey?: string | null;
	draftSessionId?: string | null;
}): boolean {
	return !input.sessionId && Boolean(input.draftKey) && !input.draftSessionId;
}

/**
 * The roster the menu offers, in the catalogue's own order.
 *
 * Agents are the NON-BUILTIN profiles - the sidebar's "agents you have" and the
 * project start-session picker's rule: a packaged profile that is not installed
 * cannot answer a session, so offering it would be a row that refuses on send.
 * Teams are every authored team, shown by label with the slug kept as `name`.
 */
export function draftTargetRoster(input: {
	profiles?: readonly ReusableProfile[] | null;
	teams?: readonly ReusableTeam[] | null;
}): { agents: DraftTargetRow[]; teams: DraftTargetRow[] } {
	return {
		agents: (input.profiles ?? [])
			.filter((profile) => profile.source !== "builtin")
			.map((profile) => ({
				kind: "agent" as const,
				name: profile.name,
				label: profile.name,
			})),
		teams: (input.teams ?? []).map((team) => ({
			kind: "team" as const,
			name: team.name,
			label: teamDisplayName(team),
		})),
	};
}

/**
 * The chip's label for a staged target, or `null` for the default agent (the
 * component owns that copy). A team reads by its label, resolved through the
 * caller's lookup - the same `teamLabelFor` the draft title uses, so the chip
 * and "New chat with …" can never name one team two ways.
 */
export function draftTargetLabel(
	target: ChatTarget | undefined,
	teamLabelFor: (name: string) => string,
): string | null {
	if (!target) return null;
	return target.kind === "team" ? teamLabelFor(target.name) : target.name;
}

/** Whether `row` (or the default row, `null`) is what the draft has staged. */
export function draftTargetIsCurrent(
	current: ChatTarget | undefined,
	row: Pick<DraftTargetRow, "kind" | "name"> | null,
): boolean {
	if (!row) return !current;
	return current?.kind === row.kind && current.name === row.name;
}

/**
 * What a pick does: `null` when it would change nothing (re-picking the staged
 * row), otherwise the target to re-stage - `undefined` meaning the default
 * agent. A no-op pick must not reach `restageDraft`: a bare draft re-staged
 * mints a NEW `draft:<uuid>` row, so re-picking "Default agent" would orphan
 * the row the reader is standing on.
 */
export function draftTargetPick(
	current: ChatTarget | undefined,
	row: Pick<DraftTargetRow, "kind" | "name"> | null,
): { target: ChatTarget | undefined } | null {
	if (draftTargetIsCurrent(current, row)) return null;
	return { target: row ? { kind: row.kind, name: row.name } : undefined };
}

/*
 * The chip's classes, here so the busy state is pinned without a renderer.
 *
 * BUSY STEPS COLOUR, NEVER OPACITY (design round 1, D-1; AGENTS.md "Design and
 * branding", `docs/branding.md` "Disabled changes colour, never opacity"):
 * opacity also fades the ground, producing a colour nobody designed. Busy is
 * seen on every first send from a New chat, so it takes `ink-disabled` on the
 * label, glyph and chevron, and drops the hover and open grounds entirely -
 * a control that will not open must not answer the pointer.
 *
 * The open ground is `bg-elevated`, the live identity chips' (`TRIGGER_BOX` in
 * `chat-header-identity.tsx`; design D-3): `row-hover` on `canvas` is 1.01:1 in
 * light, so the open state was imperceptible there.
 */
const CHIP_BOX =
	// The device chip's own contract (`chat-header-device.tsx`): `h-5` and
	// `rounded-xs` keep the title block's line height, `pe-1` pairs with the
	// zero-width carrier.
	"inline-flex h-5 max-w-full shrink-0 items-center gap-1 rounded-xs pe-1 select-none whitespace-nowrap text-body-sm";

export const draftTargetChipClass = (busy: boolean): string =>
	busy
		? `${CHIP_BOX} cursor-default text-ink-disabled`
		: `${CHIP_BOX} cursor-pointer text-ink-muted hover:bg-row-hover hover:text-ink data-[state=open]:bg-elevated data-[state=open]:text-ink`;

export const draftTargetGlyphClass = (busy: boolean): string =>
	busy ? "size-3 shrink-0 text-ink-disabled" : "size-3 shrink-0 text-ink-dim";
