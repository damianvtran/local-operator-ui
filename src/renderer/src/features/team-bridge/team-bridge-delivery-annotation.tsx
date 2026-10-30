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
	message: Pick<TeamBridgeMessage, "delivery_states">;
}> = ({ message }) => {
	const lines = teamBridgeDeliveryLines(message.delivery_states);
	if (lines.length === 0) return null;
	return (
		// `gap-1` between recipients against the 1.5 line height inside one: a
		// wrapped continuation must not read as the next recipient (D8).
		<ul className="m-0 mt-0.5 flex min-w-0 list-none flex-col gap-1 p-0 text-[12px] text-ink-muted [overflow-wrap:anywhere]">
			{lines.map((line) => (
				<li key={line.key}>
					<DeliveryLineText line={line} />
					{line.kind !== "pending" && (
						<>
							{" "}
							<DeliveryInfo
								text={
									line.kind === "refused"
										? t("ui.teamBridge.delivery.info_refused")
										: t("ui.teamBridge.delivery.info_held")
								}
							/>
						</>
					)}
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

const DeliveryLineText: FC<{ line: TeamBridgeDeliveryLine }> = ({ line }) => {
	// A blank wire label falls back to the shared placeholders rather than
	// rendering "Not delivered to  ()" (review round 1, R2).
	const params = {
		agent: line.agent || t("ui.teamBridge.sender.unknown_agent"),
		owner: line.owner || t("ui.teamBridge.sender.unknown_person"),
	};
	if (line.kind === "pending") {
		return <>{t("ui.teamBridge.delivery.pending", { agent: params.agent })}</>;
	}
	if (line.kind === "held") {
		switch (line.holdReason) {
			case "screening_unavailable":
				return (
					<>{t("ui.teamBridge.delivery.held_screening_unavailable", params)}</>
				);
			case "awaiting_review":
				return <>{t("ui.teamBridge.delivery.held_awaiting_review", params)}</>;
			default:
				return <>{t("ui.teamBridge.delivery.held", params)}</>;
		}
	}
	switch (line.refusalClass) {
		case "manipulation":
			return <>{t("ui.teamBridge.delivery.refused_manipulation", params)}</>;
		case "personal_info":
			return <>{t("ui.teamBridge.delivery.refused_personal_info", params)}</>;
		case "abusive":
			return <>{t("ui.teamBridge.delivery.refused_abusive", params)}</>;
		case "unsafe_content":
			return <>{t("ui.teamBridge.delivery.refused_unsafe_content", params)}</>;
		case "out_of_scope":
			return <>{t("ui.teamBridge.delivery.refused_out_of_scope", params)}</>;
		default:
			return <>{t("ui.teamBridge.delivery.refused", params)}</>;
	}
};
