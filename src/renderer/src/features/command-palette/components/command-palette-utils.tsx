import type { SettingsSection } from "@features/settings/components/settings-sidebar";
import type { LucideIcon } from "lucide-react";
import type { ReactElement } from "react";

/**
 * The glyph for a settings section row.
 *
 * A section carries either a lucide component or an image path, and the two
 * render at the same optical size so a mixed list does not jump. Both are
 * decorative here: the row's label is right beside them.
 */
export const getIconElement = (section: SettingsSection): ReactElement => {
	if (section.isImage && typeof section.icon === "string") {
		return (
			<img
				src={section.icon}
				alt=""
				aria-hidden="true"
				className="size-5 object-contain"
			/>
		);
	}
	const IconComponent = section.icon as LucideIcon;
	return <IconComponent size={16} aria-hidden="true" />;
};
