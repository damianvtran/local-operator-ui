/**
 * The org-name placeholder the view model formats into each sentence (see
 * `guard-org-text.tsx` for why a marker and not `<bdi>` around the sentence).
 * A private-use code point that `sanitizeOrgName` strips from every real name, so
 * no name can forge it.
 */
export const ORG_MARK = "\uE000";

/** The sentence as plain text (tests, aria labels): the mark replaced by the name. */
export function plainOrgText(text: string, org: string): string {
	return text.split(ORG_MARK).join(org);
}
