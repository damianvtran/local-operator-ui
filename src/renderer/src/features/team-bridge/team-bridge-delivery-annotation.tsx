import {
	TooltipContent,
	TooltipPortal,
	TooltipProvider,
	TooltipRoot,
	TooltipTrigger,
} from "@shared/components/ui/tooltip";
import { t } from "@shared/i18n";
import { Info } from "lucide-react";
import { type FC, useState } from "react";
import type { TeamBridgeMessage } from "../../../../shared/team-bridge-contract";
import {
	type TeamBridgeDeliveryLine,
	teamBridgeDeliveryLines,
} from "./team-bridge-delivery-annotation-model";
import { type ChiefLabels, recipientLabel } from "./team-bridge-model";

/**
 * The muted per-recipient delivery lines under a message: "Not delivered to
 * Aida (Sam): refused by their moderation", or "Waiting to be screened by Aida
 * (Sam)…".
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
 * Renders nothing when the message carries no `delivery_states` (a third member,
 * an old hub) or every recipient was delivered, so the shared row can mount it
 * unconditionally.
 */
export const TeamBridgeDeliveryAnnotation: FC<{
	message: Pick<TeamBridgeMessage, "delivery_states"> &
		Partial<Pick<TeamBridgeMessage, "origin" | "sender">>;
}> = ({ message }) => {
	const lines = teamBridgeDeliveryLines(message.delivery_states, message);
	if (lines.length === 0) return null;
	return (
		// `gap-1` between recipients against the 1.5 line height inside one: a
		// wrapped continuation must not read as the next recipient (D8).
		<ul className="m-0 mt-0.5 flex min-w-0 list-none flex-col gap-1 p-0 text-[12px] text-ink-muted [overflow-wrap:anywhere]">
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
 * grapheme, the space and the glyph now sit in one `whitespace-nowrap` span:
 * the last word has no break opportunity inside it, so the whole word travels
 * with the glyph to the next line instead.
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
	return (
		<>
			{head}
			<span className="whitespace-nowrap">
				{last}{" "}
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
		switch (line.holdReason) {
			case "screening_unavailable":
				return t("ui.teamBridge.delivery.held_screening_unavailable", params);
			case "awaiting_review":
				return t("ui.teamBridge.delivery.held_awaiting_review", params);
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
