import { Tooltip } from "@shared/components/ui/tooltip";
import { t } from "@shared/i18n";
import { Info } from "lucide-react";
import type { FC } from "react";
import type { TeamBridgeMessage } from "../../../../shared/team-bridge-contract";
import {
	type TeamBridgeDeliveryLine,
	type TeamBridgeHoldClass,
	teamBridgeDeliveryLines,
} from "./team-bridge-delivery-annotation-model";

/**
 * The muted per-recipient delivery lines under a message: "not delivered to
 * Aida (Sam): refused by their moderation", or "Waiting to be screened…".
 *
 * TONE (contract v1, "UI"). A refusal is the RECIPIENT's policy acting, not the
 * sender's error, and most refusals are a misread request rather than abuse.
 * So the line is ink-muted at caption size with no danger colour, no alert role
 * and no icon besides the explanatory info glyph: the sender learns the message
 * did not arrive and that rephrasing usually helps, without being accused.
 *
 * The tooltip is IDENTICAL for every class on purpose: copy that varied with the
 * class would leak more about the recipient's screening than the one coarse
 * phrase the contract allows, and would turn the tooltip into a probing oracle.
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
		<div className="mt-0.5 flex min-w-0 items-start gap-1.5 text-[12px] text-ink-muted">
			<ul className="m-0 flex min-w-0 list-none flex-col gap-0.5 p-0 [overflow-wrap:anywhere]">
				{lines.map((line) => (
					<li key={line.key}>
						<DeliveryLineText line={line} />
					</li>
				))}
			</ul>
			<Tooltip content={t("ui.teamBridge.delivery.info")}>
				<button
					type="button"
					aria-label={t("ui.teamBridge.delivery.info_label")}
					// The glyph sits on the first line's baseline; it is a focusable
					// control so keyboard users reach the same explanation.
					className="mt-px inline-flex shrink-0 items-center rounded-sm text-ink-dim hover:text-ink-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
				>
					<Info size={12} aria-hidden="true" />
				</button>
			</Tooltip>
		</div>
	);
};

const DeliveryLineText: FC<{ line: TeamBridgeDeliveryLine }> = ({ line }) => {
	if (line.kind === "held") {
		return (
			<>
				{t("ui.teamBridge.delivery.held")}
				{line.holdClass && (
					<span className="text-ink-dim">
						{" · "}
						{holdReason(line.holdClass)}
					</span>
				)}
			</>
		);
	}
	const params = { agent: line.agent, owner: line.owner };
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

function holdReason(holdClass: TeamBridgeHoldClass): string {
	switch (holdClass) {
		case "screening_unavailable":
			return t("ui.teamBridge.delivery.hold_screening_unavailable");
		case "awaiting_review":
			return t("ui.teamBridge.delivery.hold_awaiting_review");
		case "delivery_pending":
			return t("ui.teamBridge.delivery.hold_delivery_pending");
	}
}
