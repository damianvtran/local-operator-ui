/**
 * The optional telemetry opt-in on onboarding's LAST step (operator request,
 * 2026-11-24): "a small optional checkmark in the onboarding which explains what
 * the telemetry is used for ... add at the end".
 *
 * - It reflects main's persisted consent (unchecked unless the user already
 *   opted in, e.g. via Settings -> Privacy) and follows live changes, because
 *   main owns the choice (`src/main/telemetry-consent.ts`).
 * - It never blocks Finish/Meet: it sits outside `onboardingFooter`'s decision.
 * - `onChange` is the only write, through the same `setTelemetryConsent` the
 *   Settings toggle uses; no analytics event is fired here.
 * - Without the consent bridge (a browser build, an older preload) there is
 *   nowhere to persist the choice, so it renders nothing, as Settings does.
 *
 * Where it shows is `showsTelemetryConsent` (onboarding-sequence.ts); the stage
 * places it in its `footerLead` slot, so no step component knows about it.
 */

import {
	consentBridge,
	setTelemetryConsent,
	useTelemetryConsent,
	useTelemetryConsentSync,
} from "@shared/analytics/use-telemetry-consent";
import { TelemetryConsentCheckbox } from "@shared/components/common/telemetry-consent-checkbox";
import { t } from "@shared/i18n";
import { showErrorToast } from "@shared/utils/toast-manager";
import { type FC, useState } from "react";

export const OnboardingTelemetryConsent: FC = () => {
	useTelemetryConsentSync();
	const consent = useTelemetryConsent();
	// Disabled while main saves, so a double click cannot race two writes.
	const [saving, setSaving] = useState(false);
	if (!consentBridge()) return null;
	return (
		<TelemetryConsentCheckbox
			checked={consent.optedIn}
			disabled={saving}
			onChange={(next) => {
				setSaving(true);
				// On failure the store keeps main's previous answer, so the box
				// reverts by itself; the toast says why (Settings' copy).
				setTelemetryConsent(next)
					.catch(() => showErrorToast(t("ui.settings.privacy.save_failed")))
					.finally(() => setSaving(false));
			}}
		/>
	);
};
