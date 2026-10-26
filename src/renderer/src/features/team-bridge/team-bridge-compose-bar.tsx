import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { Bot, X } from "lucide-react";
import type { FC } from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { type TeamBridgeRecipient, recipientKey } from "./team-bridge-model";

/**
 * The "To:" bar at the top of a new-message draft, Slack's new-message header.
 *
 * WHY A BAR AND NOT A DIALOG (operator review, 2026-10-21). Starting a group
 * is "pick people, then say something": the bar sits where the conversation
 * header will be, the composer is already live below it, and NOTHING IS
 * CREATED UNTIL THE FIRST SEND. One recipient makes a DM (find-or-create, so
 * it lands on the existing thread when there is one); two or more make a
 * private group. Closing the draft costs nothing because no row was written.
 *
 * The picker is a filtered listbox over the organization's reachable people
 * and chiefs of staff (the caller passes them already labelled), driven from
 * the text field with arrow keys + Enter, and Backspace on an empty field
 * removes the last chip. A combobox in the ARIA sense: the field owns focus,
 * `aria-activedescendant` names the highlighted option.
 */
export const TeamBridgeComposeBar: FC<{
	recipients: readonly TeamBridgeRecipient[];
	candidates: readonly TeamBridgeRecipient[];
	onChange: (next: TeamBridgeRecipient[]) => void;
	/** Focus the field on mount (a fresh draft starts in the To: field). */
	autoFocus?: boolean;
}> = ({ recipients, candidates, onChange, autoFocus = true }) => {
	useI18nLocale();
	const listId = useId();
	const field = useRef<HTMLInputElement>(null);
	const [query, setQuery] = useState("");
	const [open, setOpen] = useState(false);
	const [active, setActive] = useState(0);
	/*
	 * Keep the highlighted option visible as the arrows move it (review round 1,
	 * R1-10): the popup scrolls at 8 rows, and a highlight below the fold is a
	 * selection the reader cannot see.
	 */
	useEffect(() => {
		document
			.getElementById(`${listId}-${active}`)
			?.scrollIntoView({ block: "nearest" });
	}, [active, listId]);
	const chosen = useMemo(
		() => new Set(recipients.map(recipientKey)),
		[recipients],
	);
	const options = useMemo(() => {
		const needle = query.trim().toLocaleLowerCase();
		return candidates.filter(
			(candidate) =>
				!chosen.has(recipientKey(candidate)) &&
				(needle === "" || candidate.label.toLocaleLowerCase().includes(needle)),
		);
	}, [candidates, chosen, query]);
	const add = (recipient: TeamBridgeRecipient) => {
		onChange([...recipients, recipient]);
		setQuery("");
		setActive(0);
		field.current?.focus();
	};
	const showList = open && options.length > 0;

	return (
		<div className="relative shrink-0 px-5 pt-3 pb-2">
			<div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg bg-elevated px-2 py-1">
				<span className="pe-1 text-[13px] text-ink-dim">
					{t("ui.teamBridge.compose.to")}
				</span>
				{recipients.map((recipient) => (
					<span
						key={recipientKey(recipient)}
						className="flex h-6 items-center gap-1 rounded-md bg-accent-wash pe-0.5 ps-1.5 text-[13px] text-ink"
					>
						{recipient.kind === "agent" && (
							<Bot size={12} aria-hidden="true" className="text-accent" />
						)}
						{recipient.label}
						<button
							type="button"
							aria-label={t("ui.teamBridge.compose.remove", {
								name: recipient.label,
							})}
							onClick={() =>
								onChange(
									recipients.filter(
										(other) => recipientKey(other) !== recipientKey(recipient),
									),
								)
							}
							className="flex size-5 items-center justify-center rounded-sm text-ink-dim hover:bg-row-hover hover:text-ink"
						>
							<X size={12} />
						</button>
					</span>
				))}
				<input
					ref={field}
					// biome-ignore lint/a11y/noAutofocus: a fresh draft starts in its To: field, as Slack's new message does; the reader opened it on purpose.
					autoFocus={autoFocus}
					role="combobox"
					aria-expanded={showList}
					aria-controls={listId}
					aria-autocomplete="list"
					aria-activedescendant={
						showList
							? `${listId}-${Math.min(active, options.length - 1)}`
							: undefined
					}
					aria-label={t("ui.teamBridge.compose.label")}
					placeholder={
						recipients.length === 0
							? t("ui.teamBridge.compose.placeholder")
							: undefined
					}
					value={query}
					onFocus={() => setOpen(true)}
					onBlur={() => setOpen(false)}
					onChange={(event) => {
						setQuery(event.target.value);
						setActive(0);
						setOpen(true);
					}}
					onKeyDown={(event) => {
						if (event.key === "ArrowDown") {
							event.preventDefault();
							setOpen(true);
							// Clamped at 0 too: with no options there is nothing to land on,
							// and -1 would leave aria-activedescendant naming no element.
							setActive((index) =>
								Math.max(0, Math.min(index + 1, options.length - 1)),
							);
						} else if (event.key === "ArrowUp") {
							event.preventDefault();
							setActive((index) => Math.max(index - 1, 0));
						} else if (event.key === "Enter" && showList) {
							event.preventDefault();
							const pick = options[Math.min(active, options.length - 1)];
							if (pick) add(pick);
						} else if (event.key === "Escape") {
							setOpen(false);
						} else if (
							event.key === "Backspace" &&
							query === "" &&
							recipients.length > 0
						) {
							onChange(recipients.slice(0, -1));
						}
					}}
					className="h-7 min-w-32 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-dim"
				/>
			</div>
			{showList && (
				<div
					id={listId}
					tabIndex={-1}
					// biome-ignore lint/a11y/useSemanticElements: an ARIA combobox popup (input + aria-activedescendant + arrows/Enter); a native <select> cannot hold the person/agent glyph rows or stay open under a typing field. Same shape as `mini-view/mini-sheet.tsx`.
					role="listbox"
					aria-label={t("ui.teamBridge.compose.label")}
					className="absolute top-full right-5 left-5 z-20 mt-1 max-h-64 overflow-y-auto rounded-lg bg-elevated p-1 shadow-lg"
				>
					{options.map((option, index) => (
						<button
							key={recipientKey(option)}
							id={`${listId}-${index}`}
							type="button"
							tabIndex={-1}
							// biome-ignore lint/a11y/useSemanticElements: the option of the combobox popup above; `<option>` cannot carry the glyph and label row.
							role="option"
							aria-selected={index === active}
							// mousedown default prevented: the field keeps focus (so its
							// blur does not close the list before the click lands).
							onMouseDown={(event) => event.preventDefault()}
							onClick={() => add(option)}
							onMouseEnter={() => setActive(index)}
							className={cn(
								"flex h-[30px] w-full cursor-default items-center gap-2 rounded-md px-2 text-start text-[13px]",
								index === active ? "bg-row-hover text-ink" : "text-ink-muted",
							)}
						>
							<span
								aria-hidden="true"
								className={cn(
									"flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-[5px] text-[10px] font-medium",
									/* Borderless, as every Team Bridge plate: the active
									   option paints `row-hover`, and `media-surface` stays
									   apart from it by value (see the message list's plate). */
									option.kind === "agent"
										? "bg-media-surface text-accent"
										: "bg-media-surface text-ink-muted",
								)}
							>
								{option.kind === "agent" ? (
									<Bot size={12} />
								) : (
									option.label.trim().charAt(0).toUpperCase() || "?"
								)}
							</span>
							<span className="min-w-0 flex-1 truncate">{option.label}</span>
						</button>
					))}
				</div>
			)}
		</div>
	);
};
