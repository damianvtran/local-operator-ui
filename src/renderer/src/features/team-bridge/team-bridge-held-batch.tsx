import { Button } from "@shared/components/ui/button";
import { formatNumber, t } from "@shared/i18n";
import { useEffect, useRef, useState } from "react";
import type { DiscardBatchResult } from "./team-bridge-discard-batch";
import {
	type DiscardSnapshotEntry,
	type HoldItem,
	holdReference,
} from "./team-bridge-holds-model";
import type { DiscardAllOutcome } from "./use-team-bridge-holds";

export type BatchPreview = {
	phase: "confirm" | "busy" | "result";
	entries: DiscardSnapshotEntry[];
	results?: DiscardBatchResult[];
};

/** Storybook only: production always starts idle. */
export type TerminalDiscardPreview = {
	phase: "confirm" | "busy" | "result";
	count: number;
	outcome?: DiscardAllOutcome;
};

/** The second step names a closed snapshot, not an ever-changing count. Keep
 * the receipt/hash with each row until its result settles: fetching the live
 * list inside the operation would silently spend consent on unseen arrivals.
 */
export function HeldMessagesBatch({
	candidates,
	disabled,
	onDecide,
	onBlockingChange,
	initialPreview,
}: {
	candidates: DiscardSnapshotEntry[];
	disabled: boolean;
	onDecide: (
		entries: readonly DiscardSnapshotEntry[],
		onResult: (result: DiscardBatchResult) => void,
	) => Promise<void>;
	onBlockingChange: (blocked: boolean) => void;
	/** Storybook only: production always starts idle. */
	initialPreview?: BatchPreview;
}) {
	const [snapshot, setSnapshot] = useState<DiscardSnapshotEntry[] | null>(
		initialPreview?.entries ?? null,
	);
	const [phase, setPhase] = useState<"idle" | "confirm" | "busy" | "result">(
		initialPreview?.phase ?? "idle",
	);
	const [results, setResults] = useState<DiscardBatchResult[]>(
		initialPreview?.results ?? [],
	);
	const locked = useRef(false);
	const confirmRef = useRef<HTMLButtonElement>(null);
	const actionRef = useRef<HTMLButtonElement>(null);
	const previousPhase = useRef(phase);
	const statusRef = useRef<HTMLDivElement>(null);
	const [recordedIds, setRecordedIds] = useState(
		() =>
			new Set(
				(initialPreview?.results ?? [])
					.filter((result) => result.recorded)
					.map((result) => result.entry.item.message_id),
			),
	);
	// A successful record must not be offered twice while its query refresh is
	// still in flight. Refreshed list data alone is not a submission lock.
	const eligible = candidates.filter(
		(entry) => !recordedIds.has(entry.item.message_id),
	);
	const blocked = phase === "confirm" || phase === "busy";
	useEffect(() => {
		onBlockingChange(blocked);
	}, [blocked, onBlockingChange]);
	useEffect(() => {
		if (phase === "confirm") confirmRef.current?.focus();
		if (phase === "result") statusRef.current?.focus();
		if (phase === "idle" && previousPhase.current === "confirm")
			actionRef.current?.focus();
		previousPhase.current = phase;
	}, [phase]);
	const open = (entries: DiscardSnapshotEntry[]) => {
		if (disabled || locked.current || entries.length === 0) return;
		setSnapshot(entries);
		setResults([]);
		setPhase("confirm");
	};
	const submit = async () => {
		if (!snapshot || disabled || locked.current || phase !== "confirm") return;
		locked.current = true;
		setPhase("busy");
		try {
			await onDecide(snapshot, (result) => {
				setResults((current) => [...current, result]);
				if (result.recorded)
					setRecordedIds(
						(current) => new Set([...current, result.entry.item.message_id]),
					);
			});
		} finally {
			locked.current = false;
			setPhase("result");
		}
	};
	const failedIds = new Set(
		results
			.filter((result) => !result.recorded)
			.map((result) => result.entry.item.message_id),
	);
	// Retry is another explicit confirmation, restricted to failed identities.
	// It may capture refreshed proofs, but never silently includes new messages.
	const retry = eligible.filter((entry) =>
		failedIds.has(entry.item.message_id),
	);
	const total = snapshot?.length ?? 0;
	const succeeded = results.filter((result) => result.recorded).length;
	const failed = total - succeeded;
	return (
		<div
			className="flex flex-col items-start gap-2"
			onKeyDown={(event) => {
				if (event.key === "Escape" && phase === "confirm" && !locked.current) {
					event.stopPropagation();
					setPhase("idle");
					setSnapshot(null);
				}
			}}
		>
			{phase !== "confirm" && phase !== "busy" && (
				<Button
					size="sm"
					variant="secondary"
					ref={actionRef}
					disabled={disabled || eligible.length === 0}
					onClick={() => open(eligible)}
				>
					{t("ui.teamBridge.holdsBatch.action")}
				</Button>
			)}
			{phase === "confirm" && (
				<>
					<p className="max-w-prose text-sm text-ink">
						{t("ui.teamBridge.holdsBatch.confirm", {
							count: formatNumber(total),
						})}
					</p>
					<ul className="flex flex-wrap gap-x-3 text-meta text-ink-muted">
						{snapshot?.map(({ item }) => (
							<li className="font-mono" key={item.message_id}>
								{holdReference(item.message_id)}
							</li>
						))}
					</ul>
					<div className="flex gap-2">
						<Button
							ref={confirmRef}
							size="sm"
							variant="secondary"
							disabled={disabled}
							onClick={() => void submit()}
						>
							{t("ui.teamBridge.holdsBatch.submit", {
								count: formatNumber(total),
							})}
						</Button>
						<Button
							size="sm"
							variant="ghost"
							onClick={() => {
								setPhase("idle");
								setSnapshot(null);
							}}
						>
							{t("ui.teamBridge.holds.confirm.cancel")}
						</Button>
					</div>
				</>
			)}
			{phase === "busy" && (
				<output className="text-sm text-ink-muted">
					{t("ui.teamBridge.holdsBatch.progress", {
						done: formatNumber(results.length),
						total: formatNumber(total),
					})}
				</output>
			)}
			{phase === "result" && (
				<div
					ref={statusRef}
					tabIndex={-1}
					aria-live="polite"
					className="flex flex-col gap-2 text-sm text-ink-muted"
				>
					<p>
						{t("ui.teamBridge.holdsBatch.result", {
							succeeded: formatNumber(succeeded),
							failed: formatNumber(failed),
						})}
					</p>
					<ul className="flex flex-col gap-1">
						{results.map((result) => (
							<li key={result.entry.item.message_id}>
								<span className="font-mono">
									{holdReference(result.entry.item.message_id)}
								</span>
								{" — "}
								{result.recorded
									? t("ui.teamBridge.holdsBatch.recorded")
									: result.error}
							</li>
						))}
					</ul>
					{retry.length > 0 && (
						<Button
							size="sm"
							variant="secondary"
							disabled={disabled}
							onClick={() => open(retry)}
						>
							{t("ui.teamBridge.holdsBatch.retry")}
						</Button>
					)}
				</div>
			)}
		</div>
	);
}

/**
 * Bulk discard for rows core marks `terminal_discard` (local-operator #4662).
 *
 * WHY THIS IS NOT `HeldMessagesBatch` ABOVE. That action spends a FROZEN proof
 * per row (a shown body's hash, or a receipt) and lives entirely in this app;
 * this one sends ONE request with no proof at all, and the daemon decides from
 * its own record which rows are undeliverable. Reusing the snapshot machinery
 * would have meant minting proofs these rows do not have — the exact dead end
 * this feature exists to remove. So the two actions share the bulk AREA and its
 * confirmation shape (a count, the short references, a result line, a cancelled
 * escape) and differ only in what they send.
 *
 * WHAT IT SHOWS BEFORE IT ACTS: the count, from list METADATA only, and the short
 * references, so the person sees which rows. It never includes a deliverable row
 * (`terminalDiscardCandidates` refuses one) and never re-reads the list
 * mid-flight, so the confirmed count is the count that was on screen.
 */
export function HeldTerminalDiscardBatch({
	candidates,
	disabled,
	onDiscard,
	onBlockingChange,
	initialPreview,
}: {
	candidates: readonly HoldItem[];
	disabled: boolean;
	onDiscard: (onSettled: (outcome: DiscardAllOutcome) => void) => Promise<void>;
	onBlockingChange: (blocked: boolean) => void;
	/** Storybook only: production always starts idle. */
	initialPreview?: TerminalDiscardPreview;
}) {
	const [phase, setPhase] = useState<"idle" | "confirm" | "busy" | "result">(
		initialPreview?.phase ?? "idle",
	);
	const [snapshot, setSnapshot] = useState<HoldItem[]>(
		initialPreview ? candidates.slice(0, initialPreview.count) : [],
	);
	const [outcome, setOutcome] = useState<DiscardAllOutcome | null>(
		initialPreview?.outcome ?? null,
	);
	/* A settled sweep is not offered again from the same snapshot: the rows are
	   gone from the next list read, and a second press would report `already`
	   for work this session already did. */
	const [cleared, setCleared] = useState(false);
	const locked = useRef(false);
	const confirmRef = useRef<HTMLButtonElement>(null);
	const actionRef = useRef<HTMLButtonElement>(null);
	const statusRef = useRef<HTMLDivElement>(null);
	const previousPhase = useRef(phase);
	const blocked = phase === "confirm" || phase === "busy";
	useEffect(() => {
		onBlockingChange(blocked);
	}, [blocked, onBlockingChange]);
	useEffect(() => {
		if (phase === "confirm") confirmRef.current?.focus();
		if (phase === "result") statusRef.current?.focus();
		if (phase === "idle" && previousPhase.current === "confirm")
			actionRef.current?.focus();
		previousPhase.current = phase;
	}, [phase]);
	const available = cleared ? [] : [...candidates];
	const total = snapshot.length;
	const open = () => {
		if (disabled || locked.current || available.length === 0) return;
		setSnapshot(available);
		setOutcome(null);
		setPhase("confirm");
	};
	const submit = async () => {
		if (disabled || locked.current || phase !== "confirm") return;
		locked.current = true;
		setPhase("busy");
		try {
			await onDiscard((settled) => {
				setOutcome(settled);
				if (settled.state === "done") setCleared(true);
			});
		} finally {
			locked.current = false;
			setPhase("result");
		}
	};
	return (
		<div
			className="flex flex-col items-start gap-2"
			onKeyDown={(event) => {
				if (event.key === "Escape" && phase === "confirm" && !locked.current) {
					event.stopPropagation();
					setPhase("idle");
					setSnapshot([]);
				}
			}}
		>
			{phase !== "confirm" && phase !== "busy" && (
				<Button
					size="sm"
					variant="secondary"
					ref={actionRef}
					disabled={disabled || available.length === 0}
					onClick={open}
				>
					{t("ui.teamBridge.holds.terminal_bulk.action")}
				</Button>
			)}
			{phase === "confirm" && (
				<>
					<p className="max-w-prose text-sm text-ink">
						{t("ui.teamBridge.holds.terminal_bulk.confirm", {
							count: formatNumber(total),
						})}
					</p>
					<ul className="flex flex-wrap gap-x-3 text-meta text-ink-muted">
						{snapshot.map((item) => (
							<li className="font-mono" key={item.message_id}>
								{holdReference(item.message_id)}
							</li>
						))}
					</ul>
					<div className="flex gap-2">
						<Button
							ref={confirmRef}
							size="sm"
							variant="secondary"
							disabled={disabled}
							onClick={() => void submit()}
						>
							{t("ui.teamBridge.holds.terminal_bulk.action")}
						</Button>
						<Button
							size="sm"
							variant="ghost"
							onClick={() => {
								setPhase("idle");
								setSnapshot([]);
							}}
						>
							{t("ui.teamBridge.holds.confirm.cancel")}
						</Button>
					</div>
				</>
			)}
			{phase === "busy" && (
				<output className="text-sm text-ink-muted">
					{t("ui.teamBridge.holds.discarding")}
				</output>
			)}
			{phase === "result" && (
				<div
					ref={statusRef}
					tabIndex={-1}
					aria-live="polite"
					className="flex flex-col gap-1 text-sm text-ink-muted"
				>
					{outcome?.state === "done" ? (
						<p>
							{t("ui.teamBridge.holds.terminal_bulk.result", {
								discarded: formatNumber(outcome.result.discarded),
								already: formatNumber(outcome.result.already),
								skipped: formatNumber(outcome.result.skipped),
							})}
						</p>
					) : (
						/* A refusal names no count: nothing was cleared, and inventing one
						   would report a write that may not have happened. */
						<p role="alert">
							{outcome?.state === "refused"
								? outcome.message
								: t("ui.teamBridge.holds.terminal_bulk.refusal")}
						</p>
					)}
				</div>
			)}
		</div>
	);
}
