/**
 * Settings → Privacy: the one place a user opts in to (or out of) anonymous
 * usage statistics (2026-11-24).
 *
 * WHY. Telemetry is default-off and opt-in. The value lives in main
 * (`src/main/telemetry-consent.ts`); this switch writes it through the preload
 * bridge and main broadcasts the result, so the analytics client in every
 * window starts or stops immediately — no restart. A failed write reverts the
 * switch (ToggleSetting's own revert) and says so in a toast, because a privacy
 * control must never show a choice that was not saved.
 *
 * Absent without the desktop bridge (Storybook stories pass `bridgeless`
 * through `PrivacySectionView` instead).
 */

import { ToggleSetting } from "@shared/components/common/toggle-setting";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { showErrorToast } from "@shared/utils/toast-manager";
import { ShieldCheck } from "lucide-react";
import type { FC, RefObject } from "react";
import {
	consentBridge,
	setTelemetryConsent,
	useTelemetryConsent,
	useTelemetryConsentSync,
} from "../../../shared/analytics/use-telemetry-consent";
import { SettingsSection } from "./settings-section";

/** Presentational half, so Storybook can render every state without a bridge. */
export const PrivacySectionView: FC<{
	optedIn: boolean;
	launchAllows: boolean;
	onChange: (optedIn: boolean) => Promise<void>;
	sectionRef?: RefObject<HTMLDivElement>;
}> = ({ optedIn, launchAllows, onChange, sectionRef }) => {
	useI18nLocale();
	return (
		<SettingsSection
			title={t("ui.settings.privacy.title")}
			icon={ShieldCheck}
			description={t("ui.settings.privacy.description")}
			sectionRef={sectionRef}
			searchSection="privacy"
			searchSectionLabel={t("ui.settings.privacy.title")}
		>
			<div className="flex flex-col gap-3">
				<ToggleSetting
					searchRow="privacy.usage_statistics"
					value={optedIn}
					label={t("ui.settings.privacy.usage_label")}
					description={t("ui.settings.privacy.usage_explanation")}
					onChange={onChange}
				/>
				{!launchAllows && (
					<p className="text-meta text-ink-dim">
						{t("ui.settings.privacy.launch_off")}
					</p>
				)}
			</div>
		</SettingsSection>
	);
};

export const PrivacySection: FC<{ sectionRef?: RefObject<HTMLDivElement> }> = ({
	sectionRef,
}) => {
	useTelemetryConsentSync();
	const consent = useTelemetryConsent();
	if (!consentBridge()) return null;
	return (
		<PrivacySectionView
			optedIn={consent.optedIn}
			launchAllows={consent.launchAllows}
			sectionRef={sectionRef}
			onChange={async (optedIn) => {
				try {
					await setTelemetryConsent(optedIn);
				} catch (error) {
					showErrorToast(t("ui.settings.privacy.save_failed"));
					throw error; // ToggleSetting reverts the switch
				}
			}}
		/>
	);
};
