/**
 * The control for the delegated-work retention window: named stops plus an
 * exact entry, over a number of HOURS.
 *
 * WHAT THE READER GETS. Nine stops (2h, 6h, 12h, 24h, 48h, 3d, 7d, 14d, 30d) for
 * the answers people actually give, an exact field (a whole number, hours or
 * days) for everything between, and one line that says the current choice in
 * words ("48 hours", "7 days", "1 month") so the unit is never something to
 * infer from a number. See `retention-duration.ts` for why it is stepped, why
 * the stored unit is hours, and where the 2..720 range comes from.
 *
 * WHAT IT DOES NOT DO. It does not save: like every other control on this page it
 * reports a draft upward and the row's Save decides when a write happens. It
 * does not decide validity either - `validateHours` does, the same function
 * `editOutcome` calls before a request exists - so the message here and the
 * refusal at Save can never disagree about a value.
 *
 * THE STOPS ARE `Tabs`, the app's own segmented control (the shape
 * `transcript-display-mode-setting.tsx` uses for the same job), rather than a
 * new bespoke one: selection reads as the same lightness step as every other
 * segmented control, and the arrow keys move within the group for free. A value
 * that is not a stop (100 hours) leaves every segment unselected, which is the
 * truthful state: the exact field and the status line carry it.
 */

import type { BackendSetting } from "@shared/api/local-operator/desktop-api";
import {
	Button,
	Input,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Tabs,
	TabsList,
	TabsTrigger,
} from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { type FC, useEffect, useId, useState } from "react";
import {
	type DurationUnit,
	WHOLE_NUMBER_TEXT,
	durationSpec,
	entryToDraft,
	formatHours,
	shortLabel,
	splitEntry,
	validateHours,
} from "../retention-duration";

export type RetentionDurationControlProps = {
	setting: BackendSetting;
	/** The serialized draft: a number of hours, or whatever invalid text was typed. */
	value: string;
	/** Saving, or gated off by the master switch. */
	disabled?: boolean;
	onValueChange: (hours: string) => void;
	/** The id of the row's help sentence, when the row renders one. */
	helpId?: string;
};

/** The exact-entry fields for a draft: a number splits into count and unit. */
const entryFromDraft = (value: string): { text: string; unit: DurationUnit } =>
	WHOLE_NUMBER_TEXT.test(value.trim())
		? splitEntry(Number(value))
		: { text: value, unit: "hours" };

/**
 * The ACTIVE segment takes the disabled ink too (design round 1, D2).
 *
 * The primitive paints `data-[state=active]:text-ink` and
 * `data-[disabled]:text-ink-disabled` with ONE attribute selector each, so on a
 * disabled+selected trigger the active rule is the one that wins: the design
 * round measured the selected 48h chip at the enabled pair (ink on the pill's
 * own fill) while its eight siblings stepped to the disabled ink, so the one
 * chip that cannot be pressed out-read the row it was greyed with, starkest in
 * the light frame. Chaining the two attributes out-specifies either
 * single-attribute rule; the selection stays identifiable by the pill's own
 * fill (`bg-surface`), which does not step - disabled changes colour, never
 * opacity (branding § 6).
 */
const DISABLED_ACTIVE_INK =
	"data-[disabled]:data-[state=active]:text-ink-disabled";

export const RetentionDurationControl: FC<RetentionDurationControlProps> = ({
	setting,
	value,
	disabled = false,
	onValueChange,
	helpId,
}) => {
	const spec = durationSpec(setting);
	const ids = useId();
	const [entry, setEntry] = useState(() => entryFromDraft(value));

	/*
	 * The entry fields follow the draft when something OTHER than typing moved it
	 * (a stop pressed, `Use default`, a save re-seeding). The comparison is what
	 * keeps typing stable: "3 days" writes the draft "72", and 72 would split to
	 * "3 days" anyway, but "72 hours" would split to "3 days" too - so without it
	 * a reader who chose hours would watch their unit flip under the cursor.
	 */
	useEffect(() => {
		if (entryToDraft(entry) !== value.trim()) setEntry(entryFromDraft(value));
	}, [value, entry]);

	if (!spec) return null;
	const verdict = validateHours(value, spec);
	const errorId = `${ids}-error`;
	const statusId = `${ids}-status`;
	const activeStop = verdict.ok ? String(verdict.hours) : "";

	const commit = (next: { text: string; unit: DurationUnit }) => {
		setEntry(next);
		onValueChange(entryToDraft(next));
	};

	return (
		<div
			data-retention-duration=""
			className="flex w-full min-w-0 flex-col gap-2"
		>
			<Tabs value={activeStop} onValueChange={(next) => onValueChange(next)}>
				<TabsList
					aria-label={`${setting.label}: common choices`}
					// The track is `h-8 w-fit` for a short list; nine stops wrap inside it
					// at a narrow column instead of overflowing the row.
					className="h-auto max-w-full flex-wrap"
				>
					{spec.stops.map((hours) => (
						<TabsTrigger
							key={hours}
							value={String(hours)}
							disabled={disabled}
							title={
								hours === spec.defaultHours
									? `${formatHours(hours)} (default)`
									: formatHours(hours)
							}
							className={cn("px-2.5", DISABLED_ACTIVE_INK)}
						>
							{/* Spoken in words: "48h" read aloud is "forty-eight h". */}
							<span aria-hidden="true">{shortLabel(hours)}</span>
							<span className="sr-only">{formatHours(hours)}</span>
						</TabsTrigger>
					))}
				</TabsList>
			</Tabs>

			<div className="flex flex-wrap items-center gap-2">
				<label
					htmlFor={`${ids}-count`}
					className={cn(
						"text-meta",
						disabled ? "text-ink-disabled" : "text-ink-muted",
					)}
				>
					Exact time
				</label>
				<Input
					id={`${ids}-count`}
					type="text"
					inputMode="numeric"
					autoComplete="off"
					value={entry.text}
					disabled={disabled}
					inputSize="sm"
					className="w-20"
					aria-invalid={!verdict.ok}
					aria-describedby={
						[verdict.ok ? statusId : errorId, helpId]
							.filter(Boolean)
							.join(" ") || undefined
					}
					onChange={(event) => commit({ ...entry, text: event.target.value })}
				/>
				<Select
					value={entry.unit}
					disabled={disabled}
					onValueChange={(unit) =>
						commit({ ...entry, unit: unit as DurationUnit })
					}
				>
					<SelectTrigger
						aria-label={`${setting.label}: unit`}
						selectSize="sm"
						className="w-24"
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="hours">hours</SelectItem>
						<SelectItem value="days">days</SelectItem>
					</SelectContent>
				</Select>
			</div>

			{verdict.ok ? (
				<p
					id={statusId}
					className={cn(
						"text-meta",
						disabled ? "text-ink-disabled" : "text-ink-muted",
					)}
				>
					{formatHours(verdict.hours)} with no activity
					{verdict.hours === spec.defaultHours ? " (default)" : ""}
				</p>
			) : (
				// Announced politely as it changes: this appears while typing, so it is
				// not the interruption a failed save is (that one is a `role="alert"`
				// on the row).
				<div
					id={errorId}
					aria-live="polite"
					className="flex flex-wrap items-center gap-2"
				>
					<p className="text-meta text-danger">{verdict.error}</p>
					{verdict.nearest !== null && (
						<Button
							variant="secondary"
							size="sm"
							disabled={disabled}
							onClick={() => onValueChange(String(verdict.nearest))}
						>
							Use {formatHours(verdict.nearest)}
						</Button>
					)}
				</div>
			)}
		</div>
	);
};
