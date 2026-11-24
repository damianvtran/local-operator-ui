import { useOptionalQueryClient } from "@shared/hooks/use-optional-query-client";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
/**
 * The composer strip's approval-mode chip: `Approvals: Auto` / `Approvals: Ask`,
 * one click to switch.
 *
 * ## Why it exists
 *
 * Operator request (2026-11-24, from Ryan Copp's feedback): once a session is on
 * auto there was nothing on screen saying so, and the only way back was typing
 * `/approvals ask`. The approval card's "Auto-approve this session" link makes
 * loosening one click, so the mode has to be visible where the operator works —
 * beside the model/effort readings — with a one-click way back.
 *
 * ## Where the state comes from, and why it is never optimistic
 *
 * `current` of the `commands.entities` `approvals` list: the same query (same
 * key, via `useEntities`) the `/approvals` popup and picker dialog read, so the
 * three surfaces cannot disagree. A press posts `approvals ask|auto` through the
 * owner route (`sessions.command`, via `useSessionCommand`) and then INVALIDATES
 * that query; the chip repaints from the backend's next answer, never from the
 * press. The loosening direction can be refused (operator-consent / bridge latch
 * rules live in core), and a chip that flipped first would claim a mode the
 * runtime never took. Every other approvals route (card links, `/approvals`)
 * invalidates the same key — see `invalidateApprovalMode`.
 *
 * Hidden when `current` is unknown (older backend, no session, query failed):
 * a guessed mode is worse than no chip.
 */
import type { QueryClient } from "@tanstack/react-query";
import { type FC, useCallback, useState } from "react";
import { useEntities } from "../pickers/destination-pickers";
import { useSessionCommand } from "../pickers/use-picker-backend";
import { READING_BUTTON } from "./session-status-strip";

/** The query key prefix every approvals change must invalidate. */
export const approvalModeKey = (sessionId: string) => [
	"desktop",
	"entities",
	sessionId,
	"approvals",
];

/**
 * Ask the chip (and the popup/picker rows) to re-read the mode. Called after
 * any approvals command receipt, whatever surface sent it, because the receipt
 * itself is prose and the entity row is the one machine-readable answer.
 */
export function invalidateApprovalMode(
	client: QueryClient | null | undefined,
	sessionId: string | undefined,
): void {
	if (!client || !sessionId) return;
	void client.invalidateQueries({ queryKey: approvalModeKey(sessionId) });
}

/** The mode the entity row reports, or `null` when it is not a known mode. */
export function approvalModeFrom(current: unknown): "auto" | "ask" | null {
	return current === "auto" || current === "ask" ? current : null;
}

/** The command a press sends: the opposite of the reported mode. */
export const approvalToggleArgs = (mode: "auto" | "ask"): "auto" | "ask" =>
	mode === "auto" ? "ask" : "auto";

export const ApprovalModeChipView: FC<{
	mode: "auto" | "ask" | null;
	busy?: boolean;
	onToggle: () => void;
	className?: string;
}> = ({ mode, busy = false, onToggle, className }) => {
	useI18nLocale();
	if (!mode) return null;
	const word =
		mode === "auto"
			? t("ui.chat.approval.mode.auto")
			: t("ui.chat.approval.mode.ask");
	const action =
		mode === "auto"
			? t("ui.chat.approval.chip.switch_to_ask")
			: t("ui.chat.approval.chip.switch_to_auto");
	// The tooltip carries what the switch does AND what auto never disables
	// (the operator's condition: guardrails still bind in auto mode).
	const tip = `${action} ${t("ui.chat.approval.escape.guardrails_note")}`;
	return (
		<button
			type="button"
			data-approval-mode-chip=""
			data-mode={mode}
			aria-busy={busy || undefined}
			disabled={busy}
			title={tip}
			aria-label={`${t("ui.chat.approval.chip.label", { mode: word })}. ${tip}`}
			onClick={onToggle}
			className={cn(
				READING_BUTTON,
				mode === "auto" && "text-warning",
				"disabled:cursor-progress",
				className,
			)}
		>
			{t("ui.chat.approval.chip.label", { mode: word })}
		</button>
	);
};

/** The connected chip. `sessionId` must be a wire session id (12 hex). */
export const ApprovalModeChip: FC<{
	sessionId: string;
	className?: string;
}> = ({ sessionId, className }) => {
	const entities = useEntities<{ value: string }>(sessionId, "approvals");
	const command = useSessionCommand(sessionId);
	// Optional: the shared composer also mounts in documents with no provider
	// (the mini view), where `useQueryClient` would throw.
	const { client } = useOptionalQueryClient();
	const [pressing, setPressing] = useState(false);
	const mode = approvalModeFrom(entities.data?.current);
	const toggle = useCallback(async () => {
		if (!mode || pressing) return;
		setPressing(true);
		try {
			await command.run("approvals", approvalToggleArgs(mode));
		} finally {
			// Repaint from the backend's answer, success or refusal alike.
			await client.invalidateQueries({ queryKey: approvalModeKey(sessionId) });
			setPressing(false);
		}
	}, [mode, pressing, command, client, sessionId]);
	return (
		<ApprovalModeChipView
			mode={mode}
			busy={pressing || command.busy}
			onToggle={() => void toggle()}
			className={className}
		/>
	);
};
