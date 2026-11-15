import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useId } from "react";
import type { FC } from "react";
import type { AgentMessagesScreening } from "../../../../shared/agent-messages-contract";

/** Radix refuses an empty item value; the wire's "" (clear) maps to this. */
const AUTOMATIC = "__automatic__";

/**
 * Settings -> Agent messages -> Screening model (local-operator #3632).
 *
 * WHAT IT IS. A PREFERENCE for which vetted model screens incoming Team Bridge
 * messages first on this machine. The runtime only re-orders its evaluated
 * screener chain and always keeps the receiver's own default and fallback
 * cascade behind the choice, so a chosen model that is unavailable or out of
 * quota falls through and the message is still screened (operator directive
 * 2026-11-04: a pin must never block Team Bridge). The helper copy says exactly
 * that, and Automatic is the default and first option, so nothing here reads as
 * a choice the user has to make.
 *
 * WHY THE LIST COMES FROM THE RUNTIME. `models` is the runtime's evaluated
 * table, spelled as a write accepts it. A renderer-side list would offer
 * entries the chain silently ignores. An off-table stored value already reads
 * as `preferred: null` on the wire, so it shows as Automatic, which is what
 * the chain does with it.
 *
 * "DEFAULT TO THE FIRST AVAILABLE MODEL". Automatic IS the table's order, so it
 * screens with `models[0]` first; the option names that model so the default is
 * visible without being stored. Storing `models[0]` explicitly would freeze a
 * choice the user never made and stop following the table when it changes.
 *
 * The write itself (state re-assertion, no consent fields) lives in the
 * section; this component only renders and reports the chosen value.
 */
export const ScreeningModelSelect: FC<{
	screening: AgentMessagesScreening;
	pending: boolean;
	disabled: boolean;
	/** "" clears back to Automatic; otherwise one `models[].value`. */
	onSave: (value: string) => Promise<void> | void;
}> = ({ screening, pending, disabled, onSave }) => {
	const helpId = useId();
	const { models, preferred } = screening;
	const first = models[0]?.value ?? null;
	/*
	 * Only a listed value is shown as selected. The runtime already folds an
	 * off-table choice to null, so this is the second gate: a value the list
	 * does not carry must not render as a selected model that does nothing.
	 */
	const selected =
		preferred !== null && models.some((model) => model.value === preferred)
			? preferred
			: AUTOMATIC;
	return (
		<div
			data-agent-messages-screening-model=""
			data-search-row="agent-messages.screening-model"
			data-search-control
			/* Search keys, not copy: the runtime's setting name and the words a
			   reader types for it, like the sibling rows' terms. */
			data-search-terms="team bridge team_bridge screening screening_model moderation model"
			className="flex flex-col gap-2"
		>
			<h3 className="text-heading text-ink">
				{t("ui.agentMessages.settings.screening.title")}
			</h3>
			<p id={helpId} className="max-w-2xl text-meta text-ink-dim">
				{t("ui.agentMessages.settings.screening.help")}
			</p>
			{first === null ? (
				/* The runtime answered with no vetted models. Screening still runs
				   on its own default and fallbacks; only the preference is missing,
				   so say that rather than offering an empty picker. */
				<p
					data-agent-messages-screening-unavailable=""
					className="max-w-2xl rounded-md border border-hairline bg-sunken p-3 text-body-sm text-ink-muted"
				>
					{t("ui.agentMessages.settings.screening.unavailable")}
				</p>
			) : (
				<Select
					value={selected}
					disabled={disabled}
					onValueChange={(next) => {
						if (next === selected) return;
						void onSave(next === AUTOMATIC ? "" : next);
					}}
				>
					<SelectTrigger
						className="w-full max-w-md"
						aria-label={t("ui.agentMessages.settings.screening.title")}
						aria-describedby={helpId}
						aria-busy={pending || undefined}
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={AUTOMATIC}>
							{t("ui.agentMessages.settings.screening.automatic", {
								model: first,
							})}
						</SelectItem>
						{models.map((model) => (
							<SelectItem key={model.value} value={model.value}>
								{/* A model id is machine voice (branding: monospace is for
								    machine identifiers only). */}
								<span className="font-mono">{model.value}</span>
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			)}
			{pending && (
				<p className="text-meta text-ink-dim" aria-live="polite">
					{t("ui.agentMessages.settings.saving")}
				</p>
			)}
		</div>
	);
};
