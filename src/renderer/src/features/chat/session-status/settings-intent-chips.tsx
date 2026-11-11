/*
 * THE SETTINGS-INTENT CHIPS: one line per model/effort/fast/cwd change the
 * server is still applying (or could not apply), above the composer row.
 *
 * WHY A LINE OF ITS OWN. The composer's control row is one `flex-nowrap` line
 * whose every item already yields width (design D21), so a sentence such as
 * "Couldn't switch to GPT-6: the session did not respond in time [Retry]
 * [Dismiss]" cannot live inside it. It takes the slot the dictation retry row
 * uses, with the same register: quiet metadata ink while a change is on its
 * way, the danger glyph once it failed. The band itself (the model and effort
 * readings) shows the TARGET value optimistically; these chips say what is
 * happening to it.
 *
 * A pure projection of the mirrored slots it is handed (`settings-intents.ts`);
 * Retry/Dismiss/Cancel are callbacks so stories and tests drive it without a
 * backend. `applied` and `superseded` slots render nothing here - a superseded
 * pick becomes a transcript note at the session handle instead.
 */
import { Spinner } from "@shared/components/common/spinner";
import { Button } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import {
	type MirroredIntent,
	type MirroredSlots,
	chipIntents,
} from "@shared/store/settings-intents";
import { CircleAlert, Clock } from "lucide-react";
import type { FC, MouseEvent } from "react";
import { effortDisplay } from "./session-model";

export type SettingsIntentChipsProps = {
	slots: MirroredSlots | undefined;
	/** Display name for a `provider/model` selector (the catalogue's label). */
	describeModel?: (selector: string) => string;
	/** Display form of a directory (home-relative). */
	describeDir?: (path: string) => string;
	onRetry: (intent: MirroredIntent) => void;
	/** Dismiss a failure, or cancel a change that is still waiting. */
	onDismiss: (intent: MirroredIntent) => void;
	/*
	 * Where keyboard focus goes after Retry, Dismiss or Cancel (UX U2). Each
	 * of those buttons unmounts the moment it is used - the slot moves to
	 * `applying` or is removed - so without this a keyboard user is left on
	 * `<body>` and must Tab back in from the top. The composer passes its own
	 * input, the control the user was in before they reached the chip.
	 */
	restoreFocus?: () => void;
	className?: string;
};

/** What a pane hands the composer: the chips' props minus layout. */
export type SettingsIntentsBand = Omit<SettingsIntentChipsProps, "className">;

const bareModel = (selector: string) =>
	selector.includes("/") ? selector.slice(selector.indexOf("/") + 1) : selector;

/** The failure's reason sentence; budget exhaustion gets its own words. */
function reasonText(intent: MirroredIntent): string {
	const error = intent.error;
	if (error?.code === "retry_budget_exhausted")
		return t("ui.chat.settings_intents.reason_budget");
	return error?.message?.trim() || t("ui.chat.settings_intents.reason_unknown");
}

/** The chip's sentence for one slot (exported for the store tests' sibling). */
export function settingsIntentChipText(
	intent: MirroredIntent,
	describeModel: (selector: string) => string = bareModel,
	describeDir: (path: string) => string = (path) => path,
): string {
	const value = intent.value;
	const model = typeof value === "string" ? describeModel(value) : "";
	const level = typeof value === "string" ? effortDisplay(value) : "";
	const dir = typeof value === "string" ? describeDir(value) : "";
	if (intent.state === "failed") {
		const reason = reasonText(intent);
		switch (intent.kind) {
			case "model":
				return t("ui.chat.settings_intents.failed_model", { model, reason });
			case "effort":
				return t("ui.chat.settings_intents.failed_effort", { level, reason });
			case "fast":
				return t("ui.chat.settings_intents.failed_fast", { reason });
			case "cwd":
				return t("ui.chat.settings_intents.failed_cwd", { dir, reason });
		}
	}
	if (intent.state === "queued_next_step") {
		switch (intent.kind) {
			case "model":
				return t("ui.chat.settings_intents.model_queued", { model });
			case "effort":
				return t("ui.chat.settings_intents.effort_queued", { level });
			case "fast":
				return t("ui.chat.settings_intents.fast_queued");
			case "cwd":
				return t("ui.chat.settings_intents.cwd_waiting", { dir });
		}
	}
	switch (intent.kind) {
		case "model":
			return t("ui.chat.settings_intents.switching_model", { model });
		case "effort":
			return t("ui.chat.settings_intents.setting_effort", { level });
		case "fast":
			return value === true
				? t("ui.chat.settings_intents.setting_fast_on")
				: t("ui.chat.settings_intents.setting_fast_off");
		case "cwd":
			return intent.state === "waiting_idle"
				? t("ui.chat.settings_intents.cwd_waiting", { dir })
				: t("ui.chat.settings_intents.moving_cwd", { dir });
	}
}

export const SettingsIntentChips: FC<SettingsIntentChipsProps> = ({
	slots,
	describeModel,
	describeDir,
	onRetry,
	onDismiss,
	restoreFocus,
	className,
}) => {
	useI18nLocale();
	/*
	 * Run the action, then hand focus back once React has committed: only if
	 * the button that held it is gone (or focus already fell to `<body>`), so
	 * a Retry that leaves its row in place, or a user who clicked elsewhere,
	 * is never yanked.
	 */
	const act = (
		event: MouseEvent<HTMLButtonElement>,
		run: (intent: MirroredIntent) => void,
		intent: MirroredIntent,
	) => {
		const button = event.currentTarget;
		run(intent);
		if (!restoreFocus) return;
		requestAnimationFrame(() => {
			const active = document.activeElement;
			if (
				!button.isConnected ||
				active === null ||
				active === document.body ||
				active === button
			)
				restoreFocus();
		});
	};
	const chips = chipIntents(slots);
	if (chips.length === 0) return null;
	return (
		<section
			data-settings-intents=""
			aria-label={t("ui.chat.settings_intents.chips_label")}
			className={cn("mt-1 flex flex-col gap-0.5 px-2", className)}
		>
			{chips.map((intent) => {
				const failed = intent.state === "failed";
				const waiting = intent.state === "waiting_idle";
				const queued = intent.state === "queued_next_step";
				const text = settingsIntentChipText(intent, describeModel, describeDir);
				return (
					<output
						key={intent.kind}
						data-settings-intent={intent.kind}
						data-state={intent.state}
						/*
						 * `<output>` is a `status` live region, so a screen reader hears
						 * the line change without focus moving. A failure is deliberately
						 * not `alert`: it carries its own buttons and must not interrupt.
						 */
						/*
						 * A FAILED row wraps instead of truncating (design D1 / UX U1):
						 * its sentence carries the reason, the one part the user needs,
						 * and a single ellipsised line clipped it behind Retry/Dismiss -
						 * entirely so in a narrow pane or a long locale. The buttons ride
						 * in their own group that drops under the sentence when the line
						 * cannot hold both, and the icon aligns to the first line. The
						 * in-progress states stay one quiet line (their sentence is short
						 * and repeated on the band); the `title` still gives a clipped
						 * path or model name in full on hover.
						 */
						className={cn(
							"flex min-w-0 gap-x-2 [min-height:1.5rem]",
							failed ? "flex-wrap items-start" : "items-center",
						)}
					>
						{failed ? (
							<CircleAlert
								aria-hidden="true"
								// 1.5rem line box: centre the glyph on the first text line.
								className="mt-[0.3125rem] size-3.5 shrink-0 text-danger"
							/>
						) : waiting || queued ? (
							<Clock
								aria-hidden="true"
								className="size-3.5 shrink-0 text-ink-dim"
							/>
						) : (
							<Spinner size="xs" />
						)}
						<span
							title={text}
							className={cn(
								"min-w-0 font-medium text-body-sm",
								failed
									? // `basis` is the width below which the buttons wrap
										// under the sentence rather than squeezing it.
										"flex-1 basis-48 whitespace-normal py-0.5 text-ink [overflow-wrap:anywhere]"
									: "truncate text-ink-muted",
							)}
						>
							{text}
						</span>
						{failed && (
							<span className="ms-auto flex shrink-0 items-center">
								{intent.error?.retryable !== false && (
									<Button
										type="button"
										variant="link"
										size="sm"
										className="h-7 shrink-0 px-2 underline"
										onClick={(event) => act(event, onRetry, intent)}
									>
										{t("ui.common.actions.retry")}
									</Button>
								)}
								<Button
									type="button"
									variant="link"
									size="sm"
									className="h-7 shrink-0 px-2 underline"
									onClick={(event) => act(event, onDismiss, intent)}
								>
									{t("ui.common.actions.dismiss")}
								</Button>
							</span>
						)}
						{waiting && (
							<Button
								type="button"
								variant="link"
								size="sm"
								className="h-7 shrink-0 px-2 underline"
								onClick={(event) => act(event, onDismiss, intent)}
							>
								{t("ui.common.actions.cancel")}
							</Button>
						)}
					</output>
				);
			})}
		</section>
	);
};
