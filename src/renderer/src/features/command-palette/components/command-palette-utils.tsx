import type { SettingsSection } from "@features/settings/components/settings-sidebar";
import type { ReactElement } from "react";

/**
 * The glyph for a settings section row.
 *
 * Every section now hands over a component that draws in `currentColor`, so
 * there is one branch and one size. The Radient row used to arrive as a PNG
 * and had to be drawn at 20px against the others' 16 to look the same weight —
 * a full-colour cube shrunk into a row of outlines, which read as a blob and
 * needed the size fudge to be seen at all. It has an outline drawing of its
 * own now, on the same grid as the rest.
 *
 * Decorative here: the row's label is right beside it.
 */
export const getIconElement = (section: SettingsSection): ReactElement => (
	<section.icon size={16} />
);
