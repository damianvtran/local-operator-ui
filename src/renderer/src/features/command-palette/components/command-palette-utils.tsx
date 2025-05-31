import type { FC, ReactElement } from "react";
import React from 'react'; // Import React for JSX
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { SettingsSection } from "@features/settings/components/settings-sidebar";

export const getIconElement = (section: SettingsSection): ReactElement => {
	if (section.isImage && typeof section.icon === "string") {
		return <img src={section.icon} alt={section.label} style={{ width: 20, height: 20, objectFit: "contain" }} />;
	}
	if (section.isFontAwesome) {
		return <FontAwesomeIcon icon={section.icon as IconDefinition} size="lg" style={{ width: 20, height: 20 }} />;
	}
	const IconComponent = section.icon as FC<{ size?: number; strokeWidth?: number }>;
	return <IconComponent size={20} />;
};
