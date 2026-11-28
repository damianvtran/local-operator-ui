/**
 * Draw an org's display name inside a translated sentence, isolated for bidi
 * (security review U1 r1, S-2).
 *
 * WHY A MARKER, AND NOT `<bdi>` AROUND THE SENTENCE. The name is untrusted text an
 * admin chose, and the sentence around it is the catalogue's. `<bdi>` around the whole
 * sentence would resolve its direction from the FIRST strong character (it is `dir=auto`),
 * which is exactly what i18n audit 2 (C1) forbids for Guard text: an Urdu sentence that
 * opens with "Guard" or an org name would lay out left-to-right. So the sentence keeps
 * the page direction and only the NAME is isolated.
 *
 * HOW. The model formats each sentence with `ORG_MARK` where the org goes (a private-use
 * code point `sanitizeOrgName` strips from every real name, so no name can forge it),
 * and this component splits on the mark and puts the real name in a `<bdi>`. The same
 * technique `mesh-approvals.namedApprovalRefusalParts` uses: no manual bidi controls are
 * stored in copy, and the untrusted text is inserted AFTER the template is formatted, so
 * a name containing `{org}` or ICU syntax can never be read as a template field.
 */

import { type FC, Fragment } from "react";
import { ORG_MARK } from "./guard-org-mark";

/** The sentence with the org drawn in `<bdi>` at each mark. */
export const OrgText: FC<{ text: string; org: string }> = ({ text, org }) => {
	const parts = text.split(ORG_MARK);
	return (
		<>
			{parts.map((part, index) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: the parts are positional and never reorder.
				<Fragment key={index}>
					{index > 0 ? <bdi>{org}</bdi> : null}
					{part}
				</Fragment>
			))}
		</>
	);
};
