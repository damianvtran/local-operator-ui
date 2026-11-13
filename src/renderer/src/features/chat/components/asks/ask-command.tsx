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
import { SquareTerminal } from "lucide-react";
import type { FC } from "react";
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
	return (
		<fieldset
			data-ask-command=""
			data-ask-command-runnable={runnable && onRun ? "" : undefined}
			aria-label={t("ui.chat.ask_command.label")}
			className="m-0 flex min-w-0 flex-col gap-1 rounded-md border border-hairline bg-sunken px-2 py-1.5"
		>
			<div className="flex items-start gap-2">
				<SquareTerminal
					aria-hidden="true"
					size={14}
					className="mt-0.5 shrink-0 text-ink-muted"
				/>
				<AskCommandText command={hint.command} className="min-w-0 flex-1" />
			</div>
			<div className="flex flex-wrap items-center justify-end gap-1">
				{notice ? (
					<p
						data-ask-command-notice={notice.kind}
						className="me-auto min-w-0 text-ink-muted text-meta"
					>
						{noticeText(notice)}
					</p>
				) : null}
				<CopyButton
					value={hint.command}
					label={t("ui.chat.ask_command.copy")}
				/>
				{onInsert ? (
					<Tooltip content={t("ui.chat.ask_command.insert_hint")}>
						<Button
							variant="ghost"
							size="sm"
							data-ask-command-insert=""
							disabled={!enabled}
							aria-description={t("ui.chat.ask_command.insert_hint")}
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
							aria-description={t("ui.chat.ask_command.run_hint")}
							aria-haspopup="dialog"
							onClick={onRun}
						>
							{t("ui.chat.ask_command.run")}
						</Button>
					</Tooltip>
				) : null}
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
	onCancel: () => void;
	onConfirm: () => void;
}> = ({ open, command, placement, askOpen, onCancel, onConfirm }) => {
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
			confirmDisabled={!askOpen}
			onConfirm={() => {
				if (askOpen) onConfirm();
			}}
			onCancel={onCancel}
			message={
				<div className="flex flex-col gap-3" data-ask-command-dialog="">
					<div className="max-h-48 overflow-y-auto rounded-md border border-hairline bg-sunken px-3 py-2">
						<AskCommandText command={command} />
					</div>
					<p data-ask-command-device={device.kind}>{deviceLine}</p>
					<p>{t("ui.chat.ask_command.dialog_caution")}</p>
					{askOpen ? null : (
						<p data-ask-command-closed="" className="text-ink">
							{t("ui.chat.ask_command.dialog_closed")}
						</p>
					)}
				</div>
			}
		/>
	);
};
