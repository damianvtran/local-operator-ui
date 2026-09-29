import { Badge } from "@shared/components/ui";
import { Check } from "lucide-react";
import type { FC } from "react";
import { projectStatusMeta, statusCarriesCheck } from "../project-model";

/**
 * The one way a project's status chip is drawn.
 *
 * WHY IT EXISTS (design round 1, D1): `active` (accent) and `done` (success)
 * are all but the same chip in the brand palettes - ΔE00 2.22 in
 * localOperatorLight and 5.07 in localOperatorDark, whose washes are
 * byte-identical - and the Status column puts them side by side. `accent` is
 * excluded from the contrast contract's separability family, so no palette
 * change is owed; what the channel owes is a reading that does not depend on
 * the hue at all, which is why `done` carries a check glyph beside its label.
 * That covers every palette (monokai's `active` ≡ `done` at ΔE00 0.00
 * included, per the contract's own fleet reading) and survives a monochrome
 * reading of the screen.
 *
 * ONE COMPONENT, TWO CALL SITES, ONE RULE: the list's Status column and the
 * detail header drew the badge twice, so a mark added to one would have left
 * the other saying something different about the same state. The glyph's rule
 * (`statusCarriesCheck`) lives in the model so this tab's lane pins it.
 *
 * The glyph is DECORATIVE (`aria-hidden`): the label beside it is the name,
 * and a screen reader announcing "Done check" would be reading the paint.
 * The status menus (the form's select, the card menu) do not carry it: those
 * are lists of words read one at a time against the marked current state,
 * not the side-by-side render this distinction exists for.
 */
export const ProjectStatusBadge: FC<{ status: string }> = ({ status }) => {
	const meta = projectStatusMeta(status);
	return (
		<Badge variant={meta.variant}>
			{statusCarriesCheck(status) && <Check aria-hidden={true} />}
			{meta.label}
		</Badge>
	);
};
