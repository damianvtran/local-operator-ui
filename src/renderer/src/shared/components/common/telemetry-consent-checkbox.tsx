/**
 * The optional "share anonymous usage statistics" checkbox for onboarding
 * (2026-11-24).
 *
 * WHY PRESENTATIONAL. Telemetry is default-off and opt-in; the consent lives in
 * main (`src/main/telemetry-consent.ts`). This component only renders the
 * choice: `onChange` is the ONLY thing that persists consent or fires any event,
 * so mounting it, showing it or skipping past it sends nothing. The caller
 * decides when to call `setTelemetryConsent` (e.g. from `onChange`).
 *
 * PLACEMENT CONTRACT (from the onboarding lane, PR #2090): no card, border or
 * box; centred within a `max-w-[34rem]` measure; label `text-meta
 * text-ink-muted`, explanation `text-meta text-ink-dim`. Unchecked by default —
 * pass `checked` from state the caller initialises to `false`.
 *
 * It is NOT wired into onboarding here: onboarding is being rewritten in
 * PR #2090 and the placement is coordinated with that lane.
 */

import { Checkbox } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { type FC, useId } from "react";

export type TelemetryConsentCheckboxProps = {
	/** Whether the user has ticked it. Callers start from `false`. */
	checked: boolean;
	/** The one place a choice is persisted or any event is fired. */
	onChange: (checked: boolean) => void;
	disabled?: boolean;
	className?: string;
};

/** DOM id suffixes (not copy) linking the box to its label and explanation. */
const LABEL_ID_SUFFIX = "-label"; // i18n: ignore DOM id suffix, not copy
const DESCRIPTION_ID_SUFFIX = "-description"; // i18n: ignore DOM id suffix, not copy

export const TelemetryConsentCheckbox: FC<TelemetryConsentCheckboxProps> = ({
	checked,
	onChange,
	disabled = false,
	className,
}) => {
	useI18nLocale();
	const id = useId();
	const labelId = id + LABEL_ID_SUFFIX;
	const descriptionId = id + DESCRIPTION_ID_SUFFIX;
	return (
		<div className={cn("mx-auto w-full max-w-[34rem]", className)}>
			<div className="flex items-start gap-3">
				<Checkbox
					id={id}
					checked={checked}
					disabled={disabled}
					aria-labelledby={labelId}
					aria-describedby={descriptionId}
					// Radix answers `"indeterminate"` only when given it; this control
					// never is, so anything but literal `true` is unchecked.
					onCheckedChange={(next) => onChange(next === true)}
					className="mt-0.5"
				/>
				<div className="min-w-0 flex-1">
					<label
						id={labelId}
						htmlFor={id}
						className="block cursor-pointer text-meta text-ink-muted"
					>
						{t("ui.settings.privacy.usage_label")}
					</label>
					<p id={descriptionId} className="mt-1 text-meta text-ink-dim">
						{t("ui.settings.privacy.usage_explanation")}
					</p>
				</div>
			</div>
		</div>
	);
};
