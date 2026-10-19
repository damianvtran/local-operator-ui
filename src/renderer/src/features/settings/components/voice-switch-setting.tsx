/**
 * The session-voice master switch (default OFF). The value lives in main
 * (`src/main/voice/qwen-voice-setting.ts`); turning it off there stops the
 * rig, the page and the microphone at once. Absent without the desktop bridge.
 */

import { ToggleSetting } from "@shared/components/common/toggle-setting";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import type { FC } from "react";
import {
	bridge,
	setVoiceSwitch,
	useVoiceSwitch,
	useVoiceSwitchSync,
} from "../../voice/use-voice-switch";

export const VoiceSwitchSetting: FC = () => {
	useI18nLocale();
	useVoiceSwitchSync();
	const enabled = useVoiceSwitch();
	if (!bridge()) return null;
	return (
		<ToggleSetting
			value={enabled}
			label={t("ui.settings.voice.label")}
			description={t("ui.settings.voice.description")}
			onChange={setVoiceSwitch}
		/>
	);
};
