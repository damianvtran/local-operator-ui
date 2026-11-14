import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@shared/components/ui/popover";
import {
	TooltipContent,
	TooltipPortal,
	TooltipProvider,
	TooltipRoot,
	TooltipTrigger,
} from "@shared/components/ui/tooltip";
import { t } from "@shared/i18n";
import { ChevronDown, Info } from "lucide-react";
import { type FC, useEffect, useRef, useState } from "react";
import type { TeamBridgeMessage } from "../../../../shared/team-bridge-contract";
import {
	TEAM_BRIDGE_DELIVERY_SEGMENTS,
	type TeamBridgeDeliveryCounts,
	type TeamBridgeDeliveryLine,
	teamBridgeDeliverySummary,
} from "./team-bridge-delivery-annotation-model";
import { type ChiefLabels, recipientLabel } from "./team-bridge-model";

/**
 * The muted per-recipient delivery lines: "Not delivered to Aida (Sam):
 * refused by their moderation", or "Not delivered to Aida (Sam) yet…". Since
 * the collapsed summary (2026-11-09) they render INSIDE its details popover,
 * never directly under a message.
 *
 * TONE (contract v1, "UI"). A refusal is the RECIPIENT's policy acting, not the
 * sender's error, and most refusals are a misread request rather than abuse.
 * So the line is ink-muted at caption size with no danger colour, no alert role
 * and no icon besides the explanatory info glyph: the sender learns the message
 * did not arrive and that rephrasing usually helps, without being accused.
 *
 * The tooltip has TWO fixed texts, one for refusals and one for holds, and
 * neither varies with the class (design review round 1, D4). Held vs refused is
 * already on screen; copy that varied with the class would leak more about the
 * recipient's screening than the one coarse phrase the contract allows, and
 * would turn the tooltip into a probing oracle. The owner-only "screened,
 * delivery pending" line carries no glyph: neither text describes it truthfully.
 *
 * Renders nothing when there are no lines.
 */
export const TeamBridgeDeliveryLines: FC<{
	lines: readonly TeamBridgeDeliveryLine[];
}> = ({ lines }) => {
	if (lines.length === 0) return null;
	return (
		// `gap-1` between recipients against the 1.5 line height inside one: a
		// wrapped continuation must not read as the next recipient (D8).
		<ul className="m-0 flex min-w-0 list-none flex-col gap-1 p-0 text-[12px] text-ink-muted [overflow-wrap:anywhere]">
			{lines.map((line) => (
				<li key={line.key}>
					<DeliveryLine line={line} />
				</li>
			))}
		</ul>
	);
};

/**
 * The info glyph, inline after the line's last word so it always trails the
 * text, wrapped or not (D2).
 *
 * WHY NOT THE SHARED `Tooltip`. Its Radix trigger CLOSES on click and on
 * pointerdown, so a click-first or touch user pressing an "i" whose only job is
 * to explain got nothing (D3). This keeps the shared panel styling
 * (`TooltipContent`) but controls `open`: hover and focus still open it through
 * Radix's own `onOpenChange`, and a press always OPENS it (not a toggle: a
 * pointer press lands after hover already opened it, so toggling would close
 * the panel the user is pressing to read). `preventDefault` on our handlers is
 * what makes Radix skip its closing ones (`composeEventHandlers` honours
 * `defaultPrevented`). Escape, blur and pointer leave still close it.
 */
const DeliveryInfo: FC<{ text: string }> = ({ text }) => {
	const [open, setOpen] = useState(false);
	return (
		<TooltipProvider>
			<TooltipRoot open={open} onOpenChange={setOpen}>
				<TooltipTrigger asChild>
					<button
						type="button"
						aria-label={t("ui.teamBridge.delivery.info_label")}
						onPointerDown={(event) => event.preventDefault()}
						onClick={(event) => {
							event.preventDefault();
							setOpen(true);
						}}
						className="inline-flex translate-y-px items-center rounded-sm align-baseline text-ink-dim hover:text-ink-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
					>
						<Info size={12} aria-hidden="true" />
					</button>
				</TooltipTrigger>
				<TooltipPortal>
					<TooltipContent side="top" align="center">
						{text}
					</TooltipContent>
				</TooltipPortal>
			</TooltipRoot>
		</TooltipProvider>
	);
};

/**
 * The chief forms for a recipient named INSIDE a delivery sentence. Module
 * level because `t()` reads the locale at call time, so one object serves
 * every render (review n1).
 *
 * `named` is the rows' own `chief.label` ("Aida (Ben Tran)"). `unnamed` is NOT
 * the rows' `chief.unnamed`: that is a standalone label, and mid-sentence after
 * a preposition or before a postposition several locales need another form
 * (hi/ur oblique genitive, fr/es the article; i18n audit C1-C4 on #1643). The
 * composition rule is still the shared `composeChiefLabel`; only the copy of
 * the unnamed form differs.
 */
const DELIVERY_CHIEF_LABELS: ChiefLabels = {
	named: (agent, person) => t("ui.teamBridge.chief.label", { agent, person }),
	unnamed: (person) =>
		t("ui.teamBridge.delivery.recipient_unnamed", { person }),
};

/*
 * ONE grapheme segmenter for every line: the split below must not cut a
 * combining mark (hi, ur) or an emoji sequence off its base character.
 */
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * CJK sentence-final and closing punctuation, whose glyph already includes the
 * whitespace on its trailing side.
 *
 * NO JOINING SPACE AFTER THESE (design review D2 on #1666). The glyph sits in a
 * full-width em box with its ink on the leading side, so `。` renders its own
 * gap; adding the Latin sentence's space on top doubled it (measured zh-CN
 * `<nobr>。 ⓘ</nobr>` against ru `<nobr>. ⓘ</nobr>`). A Latin `.` has no such
 * bearing, which is why the space stays for every other final grapheme - the
 * space is what keeps the glyph off the word. Listed rather than derived: the
 * marks are the ones CJK copy actually ends a sentence or a quotation with, and
 * a regex over East Asian Width is not expressible in ECMAScript.
 */
const CJK_CLOSING_PUNCTUATION = /[。、，．：；！？）」』】》〉〕］｝]/u;

/** `text` split before its final grapheme cluster: `[head, last]`. */
function splitLastGrapheme(text: string): [string, string] {
	let last = "";
	for (const { segment } of GRAPHEMES.segment(text)) last = segment;
	return [text.slice(0, text.length - last.length), last];
}

/**
 * The sentence, then the info glyph that explains it.
 *
 * THE GLYPH NEVER WRAPS ALONE (design review D2 on #1643). The button is an
 * atomic inline, and a line break is allowed before one, so a sentence that
 * filled its line pushed the glyph onto a continuation line by itself (ru
 * `refused_out_of_scope` at the narrow pane width). The sentence's FINAL
 * grapheme and the glyph now sit in one `whitespace-nowrap` span, separated by
 * a space except after CJK closing punctuation (see
 * `CJK_CLOSING_PUNCTUATION`): a break inside the span would strand the glyph,
 * so the last word moves with it.
 *
 * Only the final grapheme is bound, never the whole last word: a nowrap run
 * cannot take the list's `[overflow-wrap:anywhere]`, so binding a long
 * unspaced recipient name that ends a template ("…screened by {recipient}…")
 * would overflow a narrow pane. The head keeps its emergency breaks. CJK
 * copy has no spaces at all and is covered the same way, since a break is
 * never allowed between the closing punctuation and the text before it.
 */
const DeliveryLine: FC<{ line: TeamBridgeDeliveryLine }> = ({ line }) => {
	const text = deliveryLineText(line);
	if (line.kind === "pending") return <>{text}</>;
	const [head, last] = splitLastGrapheme(text);
	/* The separator is a character of its own, so a CJK sentence can end flush
	 * against the glyph without losing the space every other script needs. */
	const join = CJK_CLOSING_PUNCTUATION.test(last) ? "" : " ";
	return (
		<>
			{head}
			<span className="whitespace-nowrap">
				{last}
				{join}
				<DeliveryInfo
					text={
						line.kind === "refused"
							? t("ui.teamBridge.delivery.info_refused")
							: t("ui.teamBridge.delivery.info_held")
					}
				/>
			</span>
		</>
	);
};

function deliveryLineText(line: TeamBridgeDeliveryLine): string {
	/*
	 * ONE composed `{recipient}`, never "{agent} ({owner})" spliced here: an
	 * agent member stored by an older client already reads "Aida (Ben Tran)",
	 * and splicing it rendered "Aida (Ben Tran) (Ben Tran)" (operator report,
	 * 2026-11-03). Every delivery entry is an agent recipient (contract v1). A
	 * label that names nobody falls back to the shared placeholder rather than
	 * rendering "Not delivered to  ()" (review round 1, R2).
	 */
	const params = {
		recipient:
			recipientLabel(
				{ kind: "agent", label: line.agent, ownerLabel: line.owner },
				DELIVERY_CHIEF_LABELS,
			) ?? t("ui.teamBridge.sender.unknown_agent"),
	};
	if (line.kind === "pending") {
		return t("ui.teamBridge.delivery.pending", params);
	}
	if (line.kind === "held") {
		/* The coarse phase (cross-PR contract 2026-11-09) is the same bucket the
		 * summary line counts, so the row says what the line above it says
		 * (review R1/D1, UX U3). A stale entry reads "not reviewed" whatever its
		 * class: what happened and what to do (UX U2), with no "yet…" for an
		 * entry the hub has counted as not reviewed; a late verdict can still
		 * deliver it (agent-server #352), so the copy never promises it won't.
		 * Otherwise an owner's class copy is the more specific and wins. "Held
		 * for {person}'s review" is safe for the sender: the member-visible
		 * summary already counts review holds, and the label names the owner. */
		if (line.phase === "not_reviewed")
			return t("ui.teamBridge.delivery.held_not_reviewed", params);
		if (line.holdReason === null && line.phase === "screening")
			return t("ui.teamBridge.delivery.held_screening", params);
		const reason =
			line.holdReason ??
			(line.phase === "held" ? ("awaiting_review" as const) : null);
		switch (reason) {
			case "screening_unavailable":
				return t("ui.teamBridge.delivery.held_screening_unavailable", params);
			case "awaiting_review":
				// Names whose review it waits on: "waiting to be screened" was
				// false for a hold that only the owner can release (2026-11-09).
				return line.owner
					? t("ui.teamBridge.delivery.held_awaiting_review", {
							...params,
							person: line.owner,
						})
					: t("ui.teamBridge.delivery.held_awaiting_review_unnamed", params);
			default:
				return t("ui.teamBridge.delivery.held", params);
		}
	}
	switch (line.refusalClass) {
		case "manipulation":
			return t("ui.teamBridge.delivery.refused_manipulation", params);
		case "personal_info":
			return t("ui.teamBridge.delivery.refused_personal_info", params);
		case "abusive":
			return t("ui.teamBridge.delivery.refused_abusive", params);
		case "unsafe_content":
			return t("ui.teamBridge.delivery.refused_unsafe_content", params);
		case "out_of_scope":
			return t("ui.teamBridge.delivery.refused_out_of_scope", params);
		default:
			return t("ui.teamBridge.delivery.refused", params);
	}
}

/*
 * One translated segment per count. A switch, not a key template: `t()`'s
 * generated types only accept literal keys, and each key is a full ICU plural so
 * every locale inflects its own count.
 */
export function segmentText(
	segment: (typeof TEAM_BRIDGE_DELIVERY_SEGMENTS)[number],
	count: number,
): string {
	switch (segment) {
		case "delivered":
			return t("ui.teamBridge.delivery.summary.delivered", { count });
		case "screening":
			return t("ui.teamBridge.delivery.summary.screening", { count });
		case "held":
			return t("ui.teamBridge.delivery.summary.held", { count });
		case "notReviewed":
			return t("ui.teamBridge.delivery.summary.not_reviewed", { count });
		case "notDelivered":
			return t("ui.teamBridge.delivery.summary.not_delivered", { count });
	}
}

/*
 * The uncounted standalone form of a segment, for a message with exactly one
 * recipient agent in total (see `isSingleRecipient`). Separate keys rather than
 * a `=1` arm in the counted plurals: the counted keys must keep saying
 * "1 being screened" when that one sits beside other segments, and only the
 * caller knows whether the line has one recipient or one-in-a-bucket.
 *
 * Outstanding segments only: there is no uncounted "Delivered" because since
 * #1858 a fully delivered message renders no line, and a single recipient is
 * either delivered or outstanding, never both.
 */
function singleSegmentText(
	segment: Exclude<(typeof TEAM_BRIDGE_DELIVERY_SEGMENTS)[number], "delivered">,
): string {
	switch (segment) {
		case "screening":
			return t("ui.teamBridge.delivery.summary.single.screening");
		case "held":
			return t("ui.teamBridge.delivery.summary.single.held");
		case "notReviewed":
			return t("ui.teamBridge.delivery.summary.single.not_reviewed");
		case "notDelivered":
			return t("ui.teamBridge.delivery.summary.single.not_delivered");
	}
}

/*
 * The text of one present segment: uncounted when `single`, which only
 * `teamBridgeDeliverySummary` decides (it alone knows whether the counts are the
 * hub's whole-message total or one viewer's partial view; see its
 * `isSingleRecipient`). The counts here cannot tell those apart.
 */
function summarySegmentText(
	segment: (typeof TEAM_BRIDGE_DELIVERY_SEGMENTS)[number],
	counts: TeamBridgeDeliveryCounts,
	single: boolean,
): string {
	// `delivered` keeps its counted form even when `single`: the summary model
	// never yields that pair (complete is silent, #1858), so this is only a
	// defensive path for direct callers of the exported text helpers.
	return single && segment !== "delivered"
		? singleSegmentText(segment)
		: segmentText(segment, counts[segment]);
}

/**
 * "Delivered to 3 · 2 being screened · 2 not delivered", zero segments omitted;
 * just "Being screened" (or "Held for review", ...) for a single recipient.
 */
export function teamBridgeDeliverySummaryText(
	counts: TeamBridgeDeliveryCounts,
	single = false,
): string {
	return TEAM_BRIDGE_DELIVERY_SEGMENTS.filter((segment) => counts[segment] > 0)
		.map((segment) => summarySegmentText(segment, counts, single))
		.join(t("ui.teamBridge.delivery.summary.separator"));
}

/**
 * The summary text as two runs: the "Delivered to N" segment, and everything
 * outstanding after it (with its leading separator).
 *
 * WHY TWO RUNS (design review D5). The line truncates on one row, and the order
 * is fixed delivered-first, so a narrow pane ellipsised away exactly the
 * segments that need attention ("not delivered", "held") while keeping
 * "Delivered to 12". Rendering the runs as flex items where the delivered run
 * shrinks first keeps the operator's order at full width and gives up the
 * least useful words first when space is short. The concatenation is always
 * byte-identical to `teamBridgeDeliverySummaryText`, which stays the
 * accessible name and `title`.
 */
export function teamBridgeDeliverySummaryRuns(
	counts: TeamBridgeDeliveryCounts,
	single = false,
): { delivered: string; rest: string } {
	const separator = t("ui.teamBridge.delivery.summary.separator");
	const delivered =
		counts.delivered > 0 ? summarySegmentText("delivered", counts, single) : "";
	const outstanding = TEAM_BRIDGE_DELIVERY_SEGMENTS.filter(
		(segment) => segment !== "delivered" && counts[segment] > 0,
	)
		.map((segment) => summarySegmentText(segment, counts, single))
		.join(separator);
	return {
		delivered,
		rest: delivered && outstanding ? separator + outstanding : outstanding,
	};
}

/* The two runs in a flex row. `shrink-[999]` makes the delivered run absorb
 * nearly all the shrinkage (flex-shrink weights by basis), so it truncates
 * first; the outstanding run truncates only once the delivered run is gone. */
const SummaryRuns: FC<{
	counts: TeamBridgeDeliveryCounts;
	single: boolean;
}> = ({ counts, single }) => {
	const { delivered, rest } = teamBridgeDeliverySummaryRuns(counts, single);
	return (
		// `whitespace-pre`, not `truncate`'s `nowrap`: each run is its own flex
		// item, and `nowrap` would strip the separator's leading space.
		<span className="flex min-w-0">
			{delivered ? (
				<span className="min-w-0 shrink-[999] overflow-hidden text-ellipsis whitespace-pre">
					{delivered}
				</span>
			) : null}
			{rest ? (
				<span className="min-w-0 overflow-hidden text-ellipsis whitespace-pre">
					{rest}
				</span>
			) : null}
		</span>
	);
};

/*
 * Hover intent, in ms. OPEN waits long enough that a pointer crossing a busy
 * channel on its way elsewhere does not flash a panel per message; CLOSE gives
 * the pointer time to cross the 6px gap into the panel. Both match the shared
 * tooltip's feel rather than a measured distribution: they bound a gesture,
 * not a system latency.
 */
const HOVER_OPEN_MS = 300;
const HOVER_CLOSE_MS = 150;

/**
 * ONE muted summary line under a message, in DMs, groups and channels alike:
 * "Delivered to 3 · 2 being screened · 2 not delivered" (operator report
 * 2026-11-09: one line per recipient "would get crazy in large group chats",
 * and members other than the sender could not tell a message was held).
 *
 * TWO VIEWS, decided by what the hub already sent this viewer, never by a
 * renderer-side guess about who is looking (see `teamBridgeDeliverySummary`):
 * - a viewer with per-recipient entries (the sender, an agent's owner) gets the
 *   line as a button whose popover lists the per-recipient lines. It opens on
 *   hover, on click or tap, and on Enter/Space; a hover-opened panel does not
 *   take focus, and a click pins it open until Escape or an outside press;
 * - every other member gets the same counts as plain text: no names, no
 *   reasons, nothing to open.
 *
 * Single line, truncating with an ellipsis ("Delivered to N" first, D5); the
 * full text stays available as the button's accessible name and, for the plain
 * view, its `title`. It renders nothing once delivery is complete (every
 * recipient delivered, operator 2026-11-10; see `teamBridgeDeliverySummary`),
 * so the shared row mounts it unconditionally and reserves no space for it.
 */
export const TeamBridgeDeliveryAnnotation: FC<{
	message: Pick<TeamBridgeMessage, "delivery_states"> &
		Partial<Pick<TeamBridgeMessage, "delivery_summary" | "origin" | "sender">>;
}> = ({ message }) => {
	const summary = teamBridgeDeliverySummary(message);
	if (!summary) return null;
	const text = teamBridgeDeliverySummaryText(summary.counts, summary.single);
	if (summary.lines.length === 0) {
		return (
			<p
				className="m-0 mt-0.5 flex min-w-0 text-[12px] text-ink-muted"
				title={text}
			>
				<SummaryRuns counts={summary.counts} single={summary.single} />
			</p>
		);
	}
	return (
		<DeliveryDetails
			counts={summary.counts}
			lines={summary.lines}
			single={summary.single}
		/>
	);
};

/*
 * Popover footer for a stale hold the rows cannot show (UX U2): the hub counts
 * `not_reviewed` for every recipient, but a sender's rows carry a phase only
 * for the entries the hub scoped to them (and an older hub sends no phase). The
 * footer covers the difference so the panel never says less than its line.
 */
function unmatchedNotReviewed(
	counts: TeamBridgeDeliveryCounts,
	lines: readonly TeamBridgeDeliveryLine[],
): boolean {
	const rows = lines.filter(
		(line) => line.kind === "held" && line.phase === "not_reviewed",
	).length;
	return counts.notReviewed > rows;
}

const DeliveryDetails: FC<{
	counts: TeamBridgeDeliveryCounts;
	lines: readonly TeamBridgeDeliveryLine[];
	single: boolean;
}> = ({ counts, lines, single }) => {
	const [open, setOpen] = useState(false);
	// True while the panel is open only because the pointer is over it: such a
	// panel must not steal focus, and leaving closes it. A click clears it.
	const hoverOpen = useRef(false);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const panel = useRef<HTMLDivElement>(null);
	// Whether THIS open moved focus into the panel. Only then may close return
	// focus to the trigger (UX U1): a hover-opened panel never took focus, and
	// Radix's default close focus would yank it out of the composer.
	const panelTookFocus = useRef(false);
	const clearTimer = () => {
		if (timer.current) clearTimeout(timer.current);
		timer.current = null;
	};
	// An unmount mid-intent must not fire a pending open/close on a dead tree.
	useEffect(
		() => () => {
			if (timer.current) clearTimeout(timer.current);
		},
		[],
	);
	const pointerEnter = (event: { pointerType?: string }) => {
		// Touch has no hover; its tap is the click below.
		if (event.pointerType === "touch") return;
		clearTimer();
		if (open) return;
		timer.current = setTimeout(() => {
			hoverOpen.current = true;
			setOpen(true);
		}, HOVER_OPEN_MS);
	};
	const pointerLeave = () => {
		clearTimer();
		if (!hoverOpen.current) return;
		timer.current = setTimeout(() => {
			hoverOpen.current = false;
			setOpen(false);
		}, HOVER_CLOSE_MS);
	};
	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				// Escape, an outside press, focus leaving: always honoured.
				clearTimer();
				hoverOpen.current = false;
				setOpen(next);
			}}
		>
			<div className="mt-0.5 flex min-w-0">
				<PopoverTrigger asChild>
					<button
						type="button"
						onPointerEnter={pointerEnter}
						onPointerLeave={pointerLeave}
						onClick={(event) => {
							// Ours, not Radix's toggle (`preventDefault` makes Radix skip
							// its handler): a press on a panel hover already opened PINS
							// it instead of closing what the user is reaching for, the
							// same rule as the info glyph (D3). Otherwise it toggles.
							event.preventDefault();
							clearTimer();
							if (open && hoverOpen.current) {
								hoverOpen.current = false;
								return;
							}
							hoverOpen.current = false;
							setOpen(!open);
						}}
						// `min-h-6`: a 24 px tap target around 12 px text (UX U5).
						className="inline-flex min-h-6 min-w-0 max-w-full items-center gap-1 rounded-sm text-left text-[12px] text-ink-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
					>
						<SummaryRuns counts={counts} single={single} />
						<ChevronDown
							size={12}
							aria-hidden="true"
							className="shrink-0 text-ink-dim"
						/>
					</button>
				</PopoverTrigger>
			</div>
			<PopoverContent
				side="bottom"
				align="start"
				aria-label={t("ui.teamBridge.delivery.summary.details_label")}
				ref={panel}
				tabIndex={-1}
				onOpenAutoFocus={(event) => {
					// Never Radix's first-tabbable focus: that is a line's info glyph,
					// whose tooltip would pop open on its own. A click or keyboard open
					// focuses the panel itself (Tab then reaches the glyphs, Escape
					// returns to the trigger); a hover open takes no focus at all.
					event.preventDefault();
					panelTookFocus.current = !hoverOpen.current;
					if (panelTookFocus.current) panel.current?.focus();
				}}
				onCloseAutoFocus={(event) => {
					// Radix returns focus to the trigger on every non-outside close,
					// including a hover panel closing on pointer leave or an Escape
					// typed in the composer, so the next keystroke went to this button
					// (UX U1). Return it only when the panel had taken it.
					if (!panelTookFocus.current) event.preventDefault();
					panelTookFocus.current = false;
				}}
				onPointerEnter={clearTimer}
				onPointerLeave={pointerLeave}
				className="w-auto min-w-56 max-w-[min(26rem,calc(100vw-2rem))] p-3 outline-none"
			>
				<TeamBridgeDeliveryLines lines={lines} />
				{unmatchedNotReviewed(counts, lines) ? (
					<p className="m-0 mt-2 text-[12px] text-ink-muted">
						{t("ui.teamBridge.delivery.summary.not_reviewed_note")}
					</p>
				) : null}
			</PopoverContent>
		</Popover>
	);
};
