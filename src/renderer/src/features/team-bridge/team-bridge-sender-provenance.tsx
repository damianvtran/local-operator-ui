import type { TeamBridgeMessage } from "../../../../shared/team-bridge-contract";
import { teamBridgeSessionProvenanceLabel } from "./team-bridge-model";

/** A quiet second line UNDER the agent's author line, not a verified identity
 * badge. React escapes the host-provided name; title preserves the truncated
 * text. No link, profile lookup or authority decision may be derived from it.
 *
 * Renders ONLY a session name the header does not already show. There is no
 * placeholder: PR #2035 painted "Unknown agent" here for every agent message
 * while the core does not yet attach `agent_session` (capability
 * `team_bridge_agent_session_display` not live), which read as if the agent
 * were unknown (operator report, 2026-11-23). See
 * `teamBridgeSessionProvenanceLabel`. */
export function TeamBridgeSenderProvenance({
	message,
	shownNames = [],
}: {
	message: TeamBridgeMessage;
	/** Names the author line already paints; a session equal to one is hidden. */
	shownNames?: readonly (string | null | undefined)[];
}) {
	const label = teamBridgeSessionProvenanceLabel(message, shownNames);
	if (label === null) return null;
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
