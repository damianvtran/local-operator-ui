import { t } from "@shared/i18n";
import type { TeamBridgeMessage } from "../../../../shared/team-bridge-contract";
import {
	teamBridgeAgentSessionLabel,
	teamBridgeSenderPresentation,
} from "./team-bridge-model";

/** A quiet second line UNDER the human owner, not a verified identity badge.
 * React escapes the host-provided name; title preserves the truncated text.
 * No link, profile lookup or authority decision may be derived from this leaf.
 * Reuse the localized unknown-agent copy: absent provenance names no session. */
export function TeamBridgeSenderProvenance({
	message,
}: { message: TeamBridgeMessage }) {
	if (teamBridgeSenderPresentation(message) !== "agent") return null;
	const label =
		teamBridgeAgentSessionLabel(message) ??
		t("ui.teamBridge.sender.unknown_agent");
	return (
		<div
			className="min-w-0 text-meta text-ink-muted"
			data-sender-provenance="session"
		>
			<span className="block truncate" title={label} dir="auto">
				{label}
			</span>
		</div>
	);
}
