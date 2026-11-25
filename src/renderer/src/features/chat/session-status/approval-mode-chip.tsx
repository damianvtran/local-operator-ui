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
import { ArrowRightLeft } from "lucide-react";
import { type FC, useCallback, useEffect, useState } from "react";
// Cycle-safe like `useEntities` below: the card's exports are only called at
// run time, never at module evaluation.
import {
	APPROVAL_ESCAPE_COPY,
	runApprovalEscape,
} from "../components/trace/approval-escape";
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

/**
 * The session's live approval mode as the backend last reported it, plus when
 * that report landed. THE ONE READ every approval-mode surface shares (design
 * round 1, D1): the chip and the approval card both call this, so a chip press,
 * a card link or a typed `/approvals` - each of which invalidates this key -
 * repaints both. `updatedAt` is 0 until a first answer, which lets the card
 * keep its gate-carried mode until the query has said something newer.
 */
export function useApprovalMode(sessionId: string): {
	mode: "auto" | "ask" | null;
	updatedAt: number;
} {
	const entities = useEntities<{ value: string }>(sessionId, "approvals");
	return {
		mode: approvalModeFrom(entities.data?.current),
		updatedAt: entities.data === undefined ? 0 : entities.dataUpdatedAt,
	};
}

/** The command a press sends: the opposite of the reported mode. */
export const approvalToggleArgs = (mode: "auto" | "ask"): "auto" | "ask" =>
	mode === "auto" ? "ask" : "auto";

export const ApprovalModeChipView: FC<{
	mode: "auto" | "ask" | null;
	busy?: boolean;
	/**
	 * The backend's reason the last press did not change the mode (agent review
	 * round 1, M1). Shown as the card shows it - `Unchanged: <detail>` - so a
	 * refused loosening (bridge latch, operator consent) is never a silent no-op.
	 */
	refusal?: string | null;
	onToggle: () => void;
	className?: string;
}> = ({ mode, busy = false, refusal = null, onToggle, className }) => {
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
	const refused = refusal ? APPROVAL_ESCAPE_COPY.unchanged(refusal) : null;
	return (
		<span className="inline-flex min-w-0 items-center gap-1">
			<button
				type="button"
				data-approval-mode-chip=""
				data-mode={mode}
				aria-busy={busy || undefined}
				disabled={busy}
				title={refused ? `${refused}\n${tip}` : tip}
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
				{/*
				 * The resting affordance (design round 1, D2): at rest the chip used the
				 * static readings' type and ink, so only hover showed it was a control.
				 * The swap glyph says "press to switch" without a second label.
				 */}
				<ArrowRightLeft
					aria-hidden="true"
					className="size-3 shrink-0 opacity-70"
				/>
			</button>
			{/*
			 * The refusal sits beside the chip, truncated (the strip has no room for a
			 * sentence); the full text is the chip's tooltip and this element's title.
			 * `<output>` announces it once without moving focus.
			 */}
			{refused ? (
				<output
					data-approval-mode-refusal=""
					title={refused}
					className="block max-w-64 truncate text-danger text-meta"
				>
					{refused}
				</output>
			) : null}
		</span>
	);
};

/** The connected chip. `sessionId` must be a wire session id (12 hex). */
export const ApprovalModeChip: FC<{
	sessionId: string;
	className?: string;
}> = ({ sessionId, className }) => {
	const { mode } = useApprovalMode(sessionId);
	const command = useSessionCommand(sessionId);
	// Optional: the shared composer also mounts in documents with no provider
	// (the mini view), where `useQueryClient` would throw.
	const { client } = useOptionalQueryClient();
	const [pressing, setPressing] = useState(false);
	const [refusal, setRefusal] = useState<string | null>(null);
	// A refusal describes the mode it failed to leave; once the mode moves (any
	// surface), it is no longer true.
	useEffect(() => {
		if (mode) setRefusal(null);
	}, [mode]);
	const toggle = useCallback(async () => {
		if (!mode || pressing) return;
		setPressing(true);
		setRefusal(null);
		try {
			/*
			 * The card's own classifier, not a second reading of the receipt: a
			 * `notice` that is the no-gates sentence, a `block`, a `native_action`
			 * and a transport failure are all refusals there, and the chip must not
			 * call any of them a switch. Only the live-gate arms run, so the
			 * default-setting port is never reached.
			 */
			const outcome = await runApprovalEscape(
				approvalToggleArgs(mode) === "auto" ? "session" : "ask",
				{
					// This press is the owner's explicit session-mode choice, not an answer
					// to a pending approval or an automatic reaction to incoming content.
					runCommand: (name, args) =>
						command.run(
							name,
							args,
							APPROVAL_ESCAPE_COPY.notChanged(),
							args === "auto" ? { bridgeAck: true } : undefined,
						),
					editDefault: () =>
						Promise.reject(new Error("the chip never edits the default")),
				},
			);
			if (outcome.kind !== "saved") setRefusal(outcome.detail);
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
			refusal={refusal}
			onToggle={() => void toggle()}
			className={className}
		/>
	);
};
