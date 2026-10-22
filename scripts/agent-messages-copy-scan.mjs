import { createHash } from "node:crypto";

// RFC §5.2 and internal/bridge/texts.go byte-equal on 2026-10-12 (1079 UTF-8
// bytes). Only this IMMUTABLE artifact permits the otherwise banned human-group
// noun. A prefix, substring or modified consent is not a copy-scan exemption.
export const AGENT_MESSAGES_CANONICAL_CONSENT_SHA256 =
	"04939536c78bad5de750576add63f661c7c5cc6c7bb0da4799142dc39e3d1134";

export function copyScanAgentMessages(text, { canonicalConsent = false } = {}) {
	if (
		canonicalConsent &&
		createHash("sha256").update(text).digest("hex") ===
			AGENT_MESSAGES_CANONICAL_CONSENT_SHA256
	)
		return [];
	// "Team Bridge" is the product's own name (operator-approved banner title,
	// batch-5 deliverable 4), not the banned human-group noun; it is qualified
	// the same way "agent team" is. Case-sensitive on purpose: only the proper
	// noun is exempt, never a lower-case "team bridge" sentence.
	const qualified = text
		.replace(/\bagent teams?\b/gi, "")
		.replace(/\bTeam Bridge\b/g, "");
	return [...qualified.matchAll(/\b(?:teams?|teammates?)\b/gi)].map(
		(match) => ({ word: match[0], offset: match.index }),
	);
}
