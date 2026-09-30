import type { CompanionAppearance } from "./companion-skin";

export interface CompanionSettings {
	enabled: boolean;
	introduced: boolean;
	character: string;
	characters: CompanionAppearance[];
}

export type CompanionSettingsChange = Partial<
	Pick<CompanionSettings, "enabled" | "character">
> & { introduced?: true };

export interface CompanionSettingsAPI {
	get(): Promise<CompanionSettings>;
	update(change: CompanionSettingsChange): Promise<CompanionSettings>;
	import(): Promise<CompanionSettings>;
	onChanged(listener: (settings: CompanionSettings) => void): () => void;
}

export function isCompanionSettingsChange(
	value: unknown,
): value is CompanionSettingsChange {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const change = value as Record<string, unknown>;
	return (
		Object.keys(change).length > 0 &&
		Object.keys(change).every((key) =>
			["enabled", "character", "introduced"].includes(key),
		) &&
		(change.enabled === undefined || typeof change.enabled === "boolean") &&
		(change.character === undefined ||
			(typeof change.character === "string" &&
				change.character.length > 0 &&
				change.character.length <= 128)) &&
		(change.introduced === undefined || change.introduced === true)
	);
}
