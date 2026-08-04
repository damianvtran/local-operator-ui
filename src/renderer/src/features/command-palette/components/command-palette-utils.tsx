import type { SettingsSection } from "@features/settings/components/settings-sidebar";
import type { LucideIcon } from "lucide-react";
import type { ReactElement } from "react";

export const getIconElement = (section: SettingsSection): ReactElement => {
	if (section.isImage && typeof section.icon === "string") {
		return (
			<img
				src={section.icon}
				alt={section.label}
				style={{ width: 20, height: 20, objectFit: "contain" }}
			/>
		);
	}
	const IconComponent = section.icon as LucideIcon;
	return <IconComponent size={16} />;
};
