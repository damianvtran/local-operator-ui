import {
	type BackendSettings,
	desktopResult,
} from "@shared/api/local-operator/desktop-api";
import { desktopKeys } from "@shared/api/local-operator/desktop-hooks";
import { useOptionalQueryClient } from "@shared/hooks/use-optional-query-client";
import { t } from "@shared/i18n";
import { useQuery } from "@tanstack/react-query";
import {
	PUSH_TO_TALK_SETTING_KEY,
	START_RECORDING_SETTING_KEY,
} from "../../../../../shared/recording-shortcut";
import { PushToTalkShortcutRow } from "./push-to-talk-shortcut-row";
import { StartRecordingShortcutRow } from "./start-recording-shortcut-row";

/**
 * The Speech to text group: the primary Start recording chord and the
 * secondary Push to talk hold, under one heading and one settings read.
 *
 * It owns its heading so an older backend leaves no empty group: each row shows
 * only when the backend serves its setting, and with neither the group is
 * absent. Both keys are promoted out of Backend settings
 * (`promoted-setting-sections.ts`), so this is the one editor for each.
 */
export function SpeechShortcutsGroup({
	focusKey,
}: {
	/** The `?setting=` deep link's key, so a promoted row can take the focus. */
	focusKey?: string | null;
}) {
	const { client, provided } = useOptionalQueryClient();
	const settings = useQuery(
		{
			queryKey: desktopKeys.settings,
			queryFn: () => desktopResult<BackendSettings>({ op: "settings.list" }),
			enabled: provided,
			staleTime: 10_000,
		},
		client,
	);
	const find = (key: string) =>
		settings.data?.settings.find((row) => row.key === key);
	const start = find(START_RECORDING_SETTING_KEY);
	const hold = find(PUSH_TO_TALK_SETTING_KEY);
	if (!provided) return null;
	const heading = (
		<h3 className="pt-1 text-body-sm font-medium text-ink">
			{t("ui.settings.shortcuts.category.speech_to_text")}
		</h3>
	);
	if (!start && !hold) {
		return settings.isPending ? (
			<div className="min-h-24 space-y-3" aria-busy="true">
				{heading}
			</div>
		) : null;
	}
	return (
		<div className="space-y-3" data-shortcut-recording>
			{heading}
			{start && (
				<StartRecordingShortcutRow
					setting={start}
					refetch={settings.refetch}
					focusKey={focusKey}
				/>
			)}
			{hold && (
				<PushToTalkShortcutRow
					setting={hold}
					refetch={settings.refetch}
					focusKey={focusKey}
				/>
			)}
		</div>
	);
}
