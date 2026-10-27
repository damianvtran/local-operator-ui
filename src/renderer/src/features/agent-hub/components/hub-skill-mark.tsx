/**
 * The hub-skill card vocabulary shared by every surface that draws a skill's
 * hub state: the Hub's Skills library (catalogue rows) and the Agents page's
 * Skills tab (local rows). MOVED VERBATIM out of `hub-skills-library.tsx` so the
 * second surface reuses the one mark/sentence mapping instead of growing a copy
 * that could drift (a waiting update must read differently from an applied one
 * on BOTH surfaces, in the same words).
 */
import { HubStateIcon } from "@features/chat/components/hub-update-mark";
import {
	type HubMark,
	type HubUpdateItem,
	hubMarkFor,
} from "@shared/api/local-operator/hub-updates";
import { type WithoutParams, t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import type { HubSkillState } from "../hub-skill-state";

/**
 * The chip's ink follows the SAME mark vocabulary as the sidebar and the update
 * panel: a waiting update is accent (an action to take), an applied one is
 * success (a finished fact). Hue alone does not separate them at this size — the
 * two roles measure ΔE00 2.22 apart in the light palettes — so the WORD carries
 * the distinction and the colour only reinforces it.
 */
export const MARK_INK: Record<HubMark["kind"], string> = {
	available: "text-accent",
	applied: "text-success",
	failed: "text-danger",
	review: "text-warning",
	updating: "text-ink-muted",
};

/**
 * The mark vocabulary's labels, in this surface's sentence case. `available`,
 * `applied` and `failed` are skill-specific sentences ("Update available"), not
 * the lowercase aggregate words the sidebar uses for a rolled-up count.
 */
export const MARK_KEY: Record<HubMark["kind"], WithoutParams> = {
	available: "ui.hub.skills.update_available",
	applied: "ui.hub.skills.update_applied",
	failed: "ui.hub.skills.update_failed",
	review: "ui.hub.links.mark_review",
	updating: "ui.hub.links.mark_busy",
};

export const STATE_KEY: Record<
	Exclude<HubSkillState["kind"], "update" | "unknown">,
	WithoutParams
> = {
	"not-present": "ui.hub.skills.not_downloaded",
	subscribed: "ui.hub.skills.subscribed_absent",
	pulled: "ui.hub.skills.pulled",
	manual: "ui.hub.skills.manual",
	detached: "ui.hub.skills.detached",
};

/**
 * The mark a skill row draws, from the state that already decided what is true.
 *
 * An `available` updates row exists for a skill with NO copy too (core reports
 * the remote revision with `local: null`), so the mark cannot be drawn straight
 * from the updates store: that would label a skill that is not installed
 * "update available" and hide the Download that is actually next. Only an
 * `update` state earns the waiting mark. `applied` and a FAILURE draw in every
 * state — they are the outcome and the reason a check did not land, and an
 * applied update that left no mark made the card identical to one that never
 * needed one.
 */
export function skillMark(
	state: HubSkillState,
	update: HubUpdateItem | undefined,
	hasCopy: boolean,
): HubMark | null {
	const mark = update ? hubMarkFor(update) : null;
	/*
	 * An OUTCOME mark (applied/failed) needs bytes to be about: the detail mounts
	 * no update panel for a link with no copy, so "Update failed — open to retry"
	 * on a subscribed-but-absent skill pointed at a Retry that is not there
	 * (review round 1, minor 8). Without a copy the next act is Download, which
	 * the card's own state sentence already names.
	 */
	if (
		mark &&
		(state.kind === "update" ||
			(hasCopy &&
				(update?.state === "applied" ||
					update?.state === "failed" ||
					update?.error_class)))
	)
		return mark;
	if (state.kind === "update")
		return { kind: "available", auto: state.automatic };
	return null;
}

/** The fact a row states in words. An update keeps the copy/subscription fact. */
export function stateSentence(
	state: HubSkillState,
	/** What to say while the inventory has not answered (loading or refused). */
	unknown: string,
): string {
	if (state.kind === "unknown") return unknown;
	if (state.kind !== "update") return t(STATE_KEY[state.kind]);
	return t(
		state.link.policy.subscribe
			? "ui.hub.skills.pulled"
			: "ui.hub.skills.manual",
	);
}

export function SkillMarkChip({ mark }: { mark: HubMark | null }) {
	useI18nLocale();
	if (!mark) return null;
	return (
		<span
			data-hub-mark-state={mark.kind}
			className={cn(
				"flex shrink-0 items-center gap-1 text-meta",
				MARK_INK[mark.kind],
			)}
		>
			<HubStateIcon mark={mark} />
			<span>{t(MARK_KEY[mark.kind])}</span>
		</span>
	);
}
