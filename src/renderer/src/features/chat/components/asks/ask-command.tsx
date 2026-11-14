import { ConfirmationModal } from "@shared/components/common/confirmation-modal";
/**
 * The ask card's SUGGESTED-COMMAND row and its Run confirmation.
 *
 * The rules — what is a valid command, where the agent works, when Run may be
 * offered — are pure functions in `../../ask-command.ts`; this file only draws
 * them. Design intent (operator request, 2026-11-13): consistent, minimal and
 * smoothly integrated with the existing card, so the row adds no new visual
 * vocabulary: a terminal glyph, the command in the app's monospace token, and
 * ghost `Button`s at the dense size — the same quiet secondary the app uses for
 * in-card actions — with the shared `CopyButton` and `ConfirmationModal`.
 *
 * ## The two actions
 *
 *  - INSERT types the command into a NEW terminal tab of this conversation and
 *    does NOT press Enter: no dialog, because nothing runs until the user does.
 *  - RUN… types it AND presses Enter, and only after `AskCommandRunDialog`'s
 *    explicit confirm. The dialog's default focus is Cancel and it has no Enter
 *    handler (`ConfirmationModal`'s rule), so neither a stray Enter nor a chord
 *    can run anything. Run is drawn only when `askCommandRunnable` says the
 *    command will run on the device it is meant for; otherwise the row says why
 *    (`askCommandNotice`) and keeps Insert and Copy.
 *
 * The command is printed whole — `whitespace-pre-wrap break-all`, never
 * truncated (it is at most 500 characters) and selectable — because what the
 * user reads must be exactly what the terminal receives.
 */
import { CopyButton } from "@shared/components/common/copy-button";
import { Button, Tooltip } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { SquareTerminal, TriangleAlert } from "lucide-react";
import { type FC, useId } from "react";
import { t } from "../../../../../../i18n/messages";
import {
	type AskAgentPlacement,
	type AskCommandHint,
	type AskCommandNotice,
	askCommandDialogDevice,
	askCommandNotice,
	askCommandRunnable,
} from "../../ask-command";

const noticeText = (notice: AskCommandNotice): string => {
	switch (notice.kind) {
		case "elsewhere":
			return t("ui.chat.ask_command.notice_elsewhere", {
				device: notice.device,
			});
		case "elsewhere_unnamed":
			return t("ui.chat.ask_command.notice_elsewhere_unnamed");
		case "unplaced":
			return t("ui.chat.ask_command.notice_unplaced");
		case "target_unknown":
			return t("ui.chat.ask_command.notice_target_unknown");
	}
};

/** The command, verbatim, in the app's monospace token. Shared by the row and
 * the dialog so the two can never print it two ways. */
export const AskCommandText: FC<{ command: string; className?: string }> = ({
	command,
	className,
}) => (
	<code
		/* `dir="ltr"`: a shell command is a left-to-right machine string even in
		   an RTL interface (Urdu), and bidi reordering would show a different
		   command than the one that runs. No bidi controls are inserted — the
		   attribute isolates the element instead. */
		dir="ltr"
		data-ask-command-text=""
		className={cn(
			"select-text whitespace-pre-wrap break-all font-mono text-ink text-mono-sm",
			className,
		)}
	>
		{command}
	</code>
);

/**
 * The compact row under the question prose.
 *
 * `onInsert` absent (a read-only mount: notifications detail, a story) draws
 * the command and Copy only — never an action that would do nothing. `onRun`
 * asks the PANEL to open the confirmation: the dialog lives there, not here,
 * so it survives this card collapsing when the ask settles under it and can
 * say so instead of vanishing (see `AskPanel`'s `runConfirm`).
 */
export const AskCommandRow: FC<{
	hint: AskCommandHint;
	placement: AskAgentPlacement;
	onInsert?: () => void;
	onRun?: () => void;
	/** False when the card cannot act right now (an answer in flight). */
	enabled: boolean;
}> = ({ hint, placement, onInsert, onRun, enabled }) => {
	const runnable = askCommandRunnable(hint, placement);
	const notice = askCommandNotice(hint, placement);
	const ids = useId();
	// i18n: ignore useId-derived element id; must stay stable for aria-describedby and is never rendered as text.
	const noticeId = `${ids}-notice`;
	// i18n: ignore useId-derived element id; must stay stable for aria-describedby and is never rendered as text.
	const insertHintId = `${ids}-insert-hint`;
	// i18n: ignore useId-derived element id; must stay stable for aria-describedby and is never rendered as text.
	const runHintId = `${ids}-run-hint`;
	/*
	 * THE DEVICE NOTICE IS PART OF EACH BUTTON'S DESCRIPTION (UX round 1, U3): a
	 * screen-reader user tabbing Copy → Open in terminal never reached the bare
	 * paragraph, so never heard that the command runs HERE, not where the agent
	 * works. `aria-describedby` is used rather than `aria-description` because
	 * the two do not combine (accname: a present `aria-describedby` wins), and
	 * each button needs its own hint AND the notice; the hints are therefore
	 * hidden spans the attribute can name (hidden referenced text still counts).
	 */
	const describedBy = (hintId: string | null) =>
		[hintId, notice ? noticeId : null].filter(Boolean).join(" ") || undefined;
	return (
		<fieldset
			data-ask-command=""
			data-ask-command-runnable={runnable && onRun ? "" : undefined}
			aria-label={t("ui.chat.ask_command.label")}
			aria-describedby={notice ? noticeId : undefined}
			/*
			 * ONE WRAPPING LINE (design round 1, D2): the command takes its natural
			 * width (`flex-auto`, shrinking with `min-w-0`) and the actions sit at the
			 * end of the same line when they fit. A short command is one line tall; a
			 * command wider than the room left beside the buttons wraps them below,
			 * and the device notice (when there is one) always takes its own line
			 * with the actions, as it did before.
			 */
			className="m-0 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-hairline bg-sunken px-2 py-1.5"
		>
			<div className="flex min-w-0 flex-auto items-start gap-2">
				<SquareTerminal
					aria-hidden="true"
					size={14}
					className="mt-0.5 shrink-0 text-ink-muted"
				/>
				<AskCommandText command={hint.command} className="min-w-0 flex-1" />
			</div>
			<span id={insertHintId} hidden>
				{t("ui.chat.ask_command.insert_hint")}
			</span>
			<span id={runHintId} hidden>
				{t("ui.chat.ask_command.run_hint")}
			</span>
			{/*
			 * THE ACTIONS ARE ONE UNIT that never splits across lines (design round 1,
			 * D2): it sits beside a short command, beside the device notice when both
			 * fit, and otherwise wraps whole onto its own line, right-aligned — so Copy
			 * is never stranded beside the notice with Open in terminal alone below.
			 */}
			<div
				className={cn(
					"flex min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1",
					notice ? "basis-full" : "ms-auto",
				)}
			>
				{notice ? (
					<p
						id={noticeId}
						data-ask-command-notice={notice.kind}
						/* Indented to the command's column — glyph 14 + gap 8 = 22px,
						   `ps-5.5` — so the well keeps one left edge (design round 1, D5). */
						className="me-auto min-w-0 ps-5.5 text-ink-muted text-meta"
					>
						{noticeText(notice)}
					</p>
				) : null}
				{/* Wraps inside itself only when the group alone is wider than the
				    whole line (a narrow window in a long-label locale): overflow is
				    worse than a split. */}
				<div className="flex flex-wrap items-center justify-end gap-1">
					<CopyButton
						value={hint.command}
						label={t("ui.chat.ask_command.copy")}
						aria-describedby={describedBy(null)}
					/>
					{onInsert ? (
						<Tooltip content={t("ui.chat.ask_command.insert_hint")}>
							<Button
								variant="ghost"
								size="sm"
								data-ask-command-insert=""
								disabled={!enabled}
								aria-describedby={describedBy(insertHintId)}
								onClick={onInsert}
							>
								{t("ui.chat.ask_command.insert")}
							</Button>
						</Tooltip>
					) : null}
					{onRun && runnable ? (
						<Tooltip content={t("ui.chat.ask_command.run_hint")}>
							<Button
								variant="ghost"
								size="sm"
								data-ask-command-run=""
								disabled={!enabled}
								aria-describedby={describedBy(runHintId)}
								aria-haspopup="dialog"
								onClick={onRun}
							>
								{t("ui.chat.ask_command.run")}
							</Button>
						</Tooltip>
					) : null}
				</div>
			</div>
		</fieldset>
	);
};

/**
 * "Run this command?" — the only door to `submit: true`.
 *
 * Built on `ConfirmationModal`: Cancel takes the focus on open (the dialog
 * primitive focuses the first tabbable), there is no Enter handler, Escape and an outside click
 * cancel. The device line says where it runs (D7): a NEW terminal on THIS
 * computer, in the home folder — and for a conversation whose agent is on
 * another device, that it runs here, not there. If the ask closes or expires
 * while the dialog is up, the confirm is withheld with a short note: the
 * request the command came from is no longer one the agent is waiting on.
 */
export const AskCommandRunDialog: FC<{
	open: boolean;
	command: string;
	placement: AskAgentPlacement;
	/** The ask is still answerable. False disables the confirm. */
	askOpen: boolean;
	/** The press-time re-check refused the last confirm (agent review m3):
	 * the confirm is withheld and a reason shown, rather than a silent close. */
	refused?: boolean;
	onCancel: () => void;
	onConfirm: () => void;
}> = ({
	open,
	command,
	placement,
	askOpen,
	refused = false,
	onCancel,
	onConfirm,
}) => {
	const device = askCommandDialogDevice(placement);
	const deviceLine =
		device.kind === "local"
			? t("ui.chat.ask_command.dialog_device_local")
			: device.device
				? t("ui.chat.ask_command.dialog_device_remote", {
						device: device.device,
					})
				: t("ui.chat.ask_command.dialog_device_remote_unnamed");
	return (
		<ConfirmationModal
			open={open}
			title={t("ui.chat.ask_command.dialog_title")}
			confirmText={t("ui.chat.ask_command.dialog_confirm")}
			cancelText={t("ui.common.actions.cancel")}
			/*
			 * NO `focusCancelSignal`: the dialog primitive already focuses the first
			 * tabbable — Cancel — on open (`ConfirmationModal`'s note), and there is no
			 * refusal here to restore from. Enter on that Cancel cancels.
			 *
			 * A CLOSED ASK WITHHOLDS ONLY THE CONFIRM (`confirmDisabled`, not `busy`,
			 * which would also lock Cancel and Escape): the request the command came
			 * from is no longer one the agent is waiting on, and the note below says so.
			 */
			confirmDisabled={!askOpen || refused}
			onConfirm={() => {
				if (askOpen && !refused) onConfirm();
			}}
			onCancel={onCancel}
			/*
			 * WIDER THAN THE DEFAULT 448px PANEL, AND NO SCROLL CAP ON THE COMMAND
			 * (design round 1, D1): the box was capped at 192px, so a command at the
			 * contract's 500-character maximum hid its tail below the fold — with
			 * macOS overlay scrollbars, invisibly — while the confirm stayed enabled.
			 * Reading the whole command is this dialog's entire job. At 560px a
			 * 500-character unbroken command wraps to 8 lines (measured, round-1
			 * design experiment: box 174px, panel 375px), which fits a 1024×700 window
			 * whole; the dialog primitive's own height cap still guards smaller ones.
			 */
			panelClassName="w-[35rem] max-w-[calc(100vw-4rem)]"
			message={
				<div className="flex flex-col gap-3" data-ask-command-dialog="">
					<div className="rounded-md border border-hairline bg-sunken px-3 py-2">
						<AskCommandText command={command} />
					</div>
					<p data-ask-command-device={device.kind}>{deviceLine}</p>
					{/*
					 * THE CAUTION OUTRANKS THE DEVICE LINE (design round 1, D3): it is the
					 * dialog's only risk sentence, and drawn exactly like the device line
					 * it read as fine print. Full ink plus the app's existing warning
					 * glyph and tone (`TriangleAlert`, `text-warning`), not the danger
					 * role, which `docs/branding.md` keeps for destructive actions.
					 */}
					<p
						data-ask-command-caution=""
						className="flex items-start gap-2 text-ink"
					>
						<TriangleAlert
							aria-hidden="true"
							className="mt-0.5 size-3.5 shrink-0 text-warning"
						/>
						<span>{t("ui.chat.ask_command.dialog_caution")}</span>
					</p>
					{askOpen ? null : (
						<p data-ask-command-closed="" className="text-ink">
							{t("ui.chat.ask_command.dialog_closed")}
						</p>
					)}
					{askOpen && refused ? (
						<p data-ask-command-refused="" className="text-ink">
							{t("ui.chat.ask_command.dialog_refused")}
						</p>
					) : null}
				</div>
			}
		/>
	);
};
