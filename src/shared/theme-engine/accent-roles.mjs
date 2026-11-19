import { PALETTE_ROLES } from "./roles.mjs";

// These are consumer families, not arbitrary numbered hues. V1 only accepts
// primary as a seed: secondary pins must remain sparse overrides, including
// their independent wash. Semantic status/chart hues are deliberately absent.
const family = (descriptor) => {
	for (const role of [descriptor.role, ...descriptor.variants]) {
		if (!PALETTE_ROLES.includes(role))
			throw new Error(`Unknown accent role: ${role}`);
	}
	return Object.freeze({
		...descriptor,
		variants: Object.freeze(descriptor.variants),
	});
};
export const ACCENT_FAMILIES = Object.freeze([
	family({
		id: "primary",
		role: "accent",
		storage: "seeds",
		labelKey: "ui.settings.appearance.editor.accent.primary",
		usageKey: "ui.settings.appearance.editor.accent.primary_usage",
		variants: ["accentHover", "accentActive", "accentWash", "onAccent"],
		preview: "interaction",
		ink: "accent",
		wash: "accentWash",
	}),
	family({
		id: "secondary",
		role: "accentAlt",
		storage: "overrides",
		labelKey: "ui.settings.appearance.editor.accent.secondary",
		usageKey: "ui.settings.appearance.editor.accent.secondary_usage",
		variants: ["accentAltWash"],
		preview: "identity",
		ink: "accentAlt",
		wash: "accentAltWash",
	}),
]);
export const isAccentFamilyRole = (role) =>
	ACCENT_FAMILIES.some(
		(family) => family.role === role || family.variants.includes(role),
	);
