import {
	profileDisclosure,
	profileQueuedReceipt,
	profileSavedRecord,
} from "../../../../../../shared/profile-consent";
import { preferProgressDetails } from "./tool-row-model";

/** `profile_save` names the approval operation, not the native tool. */
export const PROFILE_SAVE_TOOLS: ReadonlySet<string> = new Set([
	"agent",
	"team",
]);

/* A disclosure can carry two 100k-character images; this ceiling leaves room for
 * their UTF-8 representation without letting opaque legacy/action fields retain
 * arbitrary transcript payloads. It applies only to the added profile carrier:
 * the established progress carrier keeps its existing admission/equality rules. */
export const PROFILE_METADATA_MAX_BYTES = 1_048_576;

/** Preserve the producer's exact identity and facts, not a reconstructed receipt. */
export function profileWriteDetails(
	toolName: string,
	details: unknown,
): Record<string, unknown> | null {
	if (!PROFILE_SAVE_TOOLS.has(toolName)) return null;
	if (!details || typeof details !== "object" || Array.isArray(details))
		return null;
	try {
		const encoded = JSON.stringify(details);
		if (
			new TextEncoder().encode(encoded).byteLength > PROFILE_METADATA_MAX_BYTES
		)
			return null;
	} catch {
		// Non-JSON/cyclic values cannot have come from either native JSON carrier.
		return null;
	}
	if (
		!profileSavedRecord(details) &&
		!profileQueuedReceipt(details) &&
		!profileDisclosure(details)
	)
		return null;
	return details as Record<string, unknown>;
}

/**
 * Live settle and cold history must admit the same bounded metadata. Keeping this
 * below the view-model layer avoids pulling card/i18n rendering into the reducer.
 * Absent, readonly, foreign-tool and oversized profile payloads still pass through
 * the existing progress selector, including its prior-value/reference semantics.
 */
export function preferToolResultDetails(
	toolName: string,
	details: unknown,
	previous: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
	return (
		profileWriteDetails(toolName, details) ??
		preferProgressDetails(details, previous)
	);
}
