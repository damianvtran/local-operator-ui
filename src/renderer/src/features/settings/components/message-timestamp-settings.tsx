import { desktopResult } from "@shared/api/local-operator/desktop-api";
import type {
	BackendSetting,
	BackendSettings,
} from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { t } from "@shared/i18n";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { FC } from "react";
import { tierFor } from "../backend-settings-tiers";
import { messageTimestampRows } from "../message-timestamp-rows";
import { BackendSettingRow, type SettingGate } from "./backend-setting-row";
import {
	type SettingDraft,
	draftFromSetting,
	editOutcome,
} from "./backend-settings-drafts";
import { backendSettingsKeys } from "./backend-settings-section";

/**
 * The message-timestamp rows inside Settings > Appearance: the master switch and
 * its dependent style, rendered by key from the backend registry through the
 * generic `BackendSettingRow` (so tier, gate note, Save and Use default behave
 * exactly as on the Backend page). Renders nothing while the registry is
 * unanswered, on a plane that does not advertise `settings`, or on a backend
 * that predates the keys. Same query key as the Backend section: one cache
 * entry, and a save here repaints every open transcript.
 */
export const MessageTimestampSettings: FC = () => {
	const capabilities = useDesktopCapabilities();
	const advertised = desktopFeatureEnabled(capabilities.data, "settings");
	const settingsQuery = useQuery({
		queryKey: backendSettingsKeys.all,
		queryFn: () => desktopResult<BackendSettings>({ op: "settings.list" }),
		enabled: advertised,
		staleTime: 10_000,
	});
	const settings = settingsQuery.data?.settings;
	const rows = useMemo(() => messageTimestampRows(settings ?? []), [settings]);

	const [drafts, setDrafts] = useState<Record<string, SettingDraft>>({});
	const [savingKeys, setSavingKeys] = useState<Record<string, boolean>>({});
	const [errors, setErrors] = useState<Record<string, string | null>>({});

	// Re-seed only rows that are not dirty: a refetch must not overwrite typing.
	useEffect(() => {
		setDrafts((current) => {
			let changed = false;
			const next = { ...current };
			for (const setting of rows) {
				const existing = current[setting.key];
				const seeded = draftFromSetting(setting);
				if (existing && existing.value !== seeded.value) continue;
				if (
					existing &&
					existing.value === seeded.value &&
					existing.cascadeBase === seeded.cascadeBase
				) {
					continue;
				}
				next[setting.key] = seeded;
				changed = true;
			}
			return changed ? next : current;
		});
	}, [rows]);

	if (!advertised || rows.length === 0) return null;

	const markSaving = (key: string, saving: boolean) =>
		setSavingKeys((current) => ({ ...current, [key]: saving }));
	const setError = (key: string, error: string | null) =>
		setErrors((current) => ({ ...current, [key]: error }));

	const run = async (
		setting: BackendSetting,
		request: () => Promise<unknown>,
		failure: string,
		after?: () => void,
	) => {
		markSaving(setting.key, true);
		setError(setting.key, null);
		try {
			await request();
			after?.();
			markSaving(setting.key, false);
			await settingsQuery.refetch();
		} catch (error) {
			markSaving(setting.key, false);
			setError(setting.key, error instanceof Error ? error.message : failure);
		}
	};

	const saveRow = async (setting: BackendSetting) => {
		const draft = drafts[setting.key];
		if (!draft) return;
		const outcome = editOutcome(setting, draft);
		if (!outcome.ok) {
			setError(setting.key, outcome.error);
			return;
		}
		await run(
			setting,
			() => desktopResult(outcome.request),
			t("ui.settings.speech.speech_section.the_setting_could_not_be_saved"),
		);
	};

	const resetRow = async (setting: BackendSetting) => {
		await run(
			setting,
			() => desktopResult({ op: "settings.reset", key: setting.key }),
			t("ui.settings.speech.speech_section.the_setting_could_not_be_reset"),
			() =>
				setDrafts((current) => ({
					...current,
					[setting.key]: draftFromSetting({
						...setting,
						value: setting.default,
						is_default: true,
					}),
				})),
		);
	};

	const gateFor = (setting: BackendSetting): SettingGate | null => {
		const key = setting.gated_by;
		if (!key) return null;
		const gate = rows.find((row) => row.key === key);
		return {
			key,
			label: gate?.label ?? key,
			on: gate?.value === true,
		};
	};

	return (
		<div
			className="flex flex-col gap-1"
			data-testid="message-timestamp-settings"
		>
			{rows.map((setting) => (
				<BackendSettingRow
					key={setting.key}
					setting={setting}
					draft={drafts[setting.key] ?? draftFromSetting(setting)}
					tier={tierFor(setting)}
					gate={gateFor(setting)}
					saving={Boolean(savingKeys[setting.key])}
					error={errors[setting.key] ?? null}
					onDraftChange={(draft) =>
						setDrafts((current) => ({ ...current, [setting.key]: draft }))
					}
					onSave={() => {
						void saveRow(setting);
					}}
					onReset={() => {
						void resetRow(setting);
					}}
				/>
			))}
		</div>
	);
};
