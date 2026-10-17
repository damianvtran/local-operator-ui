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
	const qualified = text.replace(/\bagent teams?\b/gi, "");
	return [...qualified.matchAll(/\b(?:teams?|teammates?)\b/gi)].map(
		(match) => ({ word: match[0], offset: match.index }),
	);
}
