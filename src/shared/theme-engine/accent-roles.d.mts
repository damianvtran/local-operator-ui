import type { WithoutParams } from "../../i18n/keys.gen";
export type AccentFamily = Readonly<{
	id: string;
	role: string;
	storage: "seeds" | "overrides";
	labelKey: WithoutParams;
	usageKey: WithoutParams;
	variants: readonly string[];
	preview: "interaction" | "identity";
	ink: string;
	wash: string;
}>;
export declare const ACCENT_FAMILIES: readonly AccentFamily[];
export declare const isAccentFamilyRole: (role: string) => boolean;
