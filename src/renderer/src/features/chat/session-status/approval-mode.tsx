import { desktopResult } from "@shared/api/local-operator/desktop-api";
/**
 * The session's tool-approval mode: the one shared read (`useApprovalMode`),
 * the invalidation every approvals route calls, and the composer's approvals
 * PICKER - a trigger in the composer's bottom row that opens a popover with
 * the scopes and modes to choose from.
 *
 * ## Why it is a picker in the bottom row, and why a press never switches
 *
 * Operator request (2026-11-25): the previous control was a chip in the top
 * status strip that switched the mode on a single click. Three things were
 * wrong with it, all reported from use:
 *
 * - It sat in the wrong place. The mode is a setting the operator CHOOSES, like
 *   the model and the effort, so it lives beside those two selectors, in their
 *   exact trigger style (`READING_BUTTON` plus the composer's
 *   `[data-composer-picker]` sizing), immediately after the effort selector.
 * - A click flipped the mode with no confirmation of what it would do, and
 *   offered no way to choose a SCOPE. The trigger now only opens a popover;
 *   the popover offers This session (Ask / Auto) and All sessions (Ask / Auto).
 *   Opening is local UI state: nothing is sent on open, so it is instant even
 *   when the backend is slow.
 * - It "only sometimes appeared" (root cause below), so it now always renders
 *   for a live session, in a neutral `Approvals` form while the mode is unknown.
 *
 * ## Why the trigger was missing for some sessions (root cause)
 *
 * The mode is `current` of the `commands.entities` `approvals` row, which core
 * fills from `FrontendSessionState.approval_mode`
 * (`server/routes/desktop_catalogues.py`, "null only when no runtime gate has
 * stated one"). Only a serving owner runtime publishes that field
 * (`ServingSessionHandle._publish_approval_mode`, at construction and on every
 * gate change), so the answer is `null` for an owner process that started on a
 * build before core PR #4558 (it keeps running the old code), and for a cold
 * facade whose durable checkpoint - written once per TURN END
 * (`frontend_state.checkpoint`) - predates that owner's first publication. The
 * old chip returned `null` for an
 * unknown mode, AND the answer was cached for `useEntities`' 15 s stale time
 * with nothing re-reading it when the runtime later published - so whether the
 * chip showed depended on whether the first read raced the runtime's start.
 * The fix here: the trigger always renders (a session with an unknown mode
 * can still be SET - the command binds the runtime), and every open re-reads
 * the row in the background so a stale `null` catches up.
 *
 * ## Where the state comes from, and why it is never optimistic
 *
 * The same `commands.entities` query (same key, via `useEntities`) the
 * `/approvals` picker dialog and the approval card read, so the surfaces cannot
 * disagree. A row press goes through `runApprovalEscape` - the card's own
 * routes and outcome classifier, not a fork of them - and then INVALIDATES that
 * query; the trigger repaints from the backend's next answer, never from the
 * press. The loosening direction can be refused (operator-consent and Team
 * Bridge latch rules live in core), and a trigger that flipped first would claim
 * a mode the runtime never took. A refusal renders inside the popover as
 * `Unchanged: <detail>`; the all-sessions arms have a partial state (default
 * saved, this conversation refused) that says both halves.
 *
 * ## Why a slow press is bounded, and by what
 *
 * A press is `sessions.command`, which the transport already bounds:
 * `desktopRequestDeadlineMs` gives it the 20 s control deadline in main (plus
 * the renderer's 5 s margin), after which `desktopResult` throws and
 * `runApprovalEscape` classifies the throw as `Unchanged: <deadline sentence>`.
 * No second timeout is added here: the pressed row shows its spinner for as
 * long as the request is genuinely in flight, and the popover stays usable (it
 * can be closed; the result still repaints the trigger).
 */
import { Spinner } from "@shared/components/common/spinner";
import {
	Popover,
	PopoverAnchor,
	PopoverContent,
} from "@shared/components/ui/popover";
import { Tooltip } from "@shared/components/ui/tooltip";
import { useOptionalQueryClient } from "@shared/hooks/use-optional-query-client";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { type QueryClient, useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, ShieldCheck } from "lucide-react";
import {
	type FC,
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
// Cycle-safe like `useEntities` below: the card's exports are only called at
// run time, never at module evaluation.
import {
	APPROVAL_ESCAPE_COPY,
	type ApprovalEscapeTarget,
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
 * Ask the composer picker (and the popup/picker rows) to re-read the mode. Called after
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
 * round 1, D1): the composer picker and the approval card both call this, so a picker press,
 * a card link or a typed `/approvals` - each of which invalidates this key -
 * repaints both. `updatedAt` is 0 until a first answer, which lets the card
 * keep its gate-carried mode until the query has said something newer.
 */
export function useApprovalMode(sessionId: string): {
	mode: "auto" | "ask" | null;
	updatedAt: number;
	/** The first read is still in flight (the picker's neutral form says so). */
	loading: boolean;
} {
	const entities = useEntities<{ value: string }>(sessionId, "approvals");
	return {
		mode: approvalModeFrom(entities.data?.current),
		updatedAt: entities.data === undefined ? 0 : entities.dataUpdatedAt,
		loading: entities.isLoading,
	};
}

/** The query key the machine default (`tool_approval_mode`) is cached under. */
export const approvalDefaultKey = ["desktop", "settings", "tool_approval_mode"];

/**
 * The machine default (`tool_approval_mode`) as the settings route reports it.
 *
 * ONE query shared with the `/approvals` picker dialog (same key, same
 * `settings.list` read), so a default written from either surface repaints
 * both. `enabled: provided` for the reason `useEntities` gives: the composer
 * also mounts in the mini view, which has no `QueryClientProvider`.
 *
 * Read at mount rather than on open, so the popover's checkmarks and its
 * provenance line are already there when it opens - opening never waits on the
 * network.
 */
export function useApprovalDefault() {
	const { client, provided } = useOptionalQueryClient();
	return useQuery(
		{
			queryKey: approvalDefaultKey,
			queryFn: () =>
				desktopResult<{ settings: { key: string; value: unknown }[] }>({
					op: "settings.list",
				}).then(
					(result) =>
						result.settings.find((row) => row.key === "tool_approval_mode") ??
						null,
				),
			enabled: provided,
			staleTime: 10_000,
		},
		client,
	);
}

/** One choice the popover offers: a scope and the mode to set for it. */
export type ApprovalChoice = { scope: "session" | "all"; mode: "ask" | "auto" };

const CHOICES: readonly ApprovalChoice[] = [
	{ scope: "session", mode: "ask" },
	{ scope: "session", mode: "auto" },
	{ scope: "all", mode: "ask" },
	{ scope: "all", mode: "auto" },
];

/**
 * The `runApprovalEscape` arm a choice runs. Exported so the suite can pin the
 * mapping without a DOM: this session rides the live-gate arms (`approvals
 * ask|auto` through `sessions.command`), all sessions the settings-write arms
 * that then move this conversation too.
 */
export function approvalChoiceTarget(
	choice: ApprovalChoice,
): ApprovalEscapeTarget {
	if (choice.scope === "session")
		return choice.mode === "auto" ? "session" : "ask";
	return choice.mode === "auto" ? "all" : "all-ask";
}

/**
 * Whether a choice would change nothing that the backend has reported: a
 * session row that is already the mode, or an all-sessions row whose default
 * AND live mode both already match. Such a press closes the popover instead of
 * sending a command whose only possible answer is "already so".
 */
export function approvalChoiceIsNoop(
	choice: ApprovalChoice,
	mode: "ask" | "auto" | null,
	defaultMode: "ask" | "auto" | null,
): boolean {
	if (choice.scope === "session") return mode === choice.mode;
	return mode === choice.mode && defaultMode === choice.mode;
}

/** What the last press left to say inside the popover, if anything. */
export type ApprovalPickerNotice =
	| { kind: "refused"; detail: string }
	| { kind: "default-only"; mode: "ask" | "auto"; detail: string };

const modeWord = (mode: "ask" | "auto"): string =>
	mode === "auto"
		? t("ui.chat.approval.mode.auto")
		: t("ui.chat.approval.mode.ask");

/**
 * The provenance line, only where it is a FACT. A live mode that differs from
 * the machine default is a session override by definition; an equal pair could
 * be either (following the default, or an explicit choice that happens to
 * match), and the entity row carries no provenance to tell them apart - so that
 * case says nothing rather than guess.
 */
export function approvalPickerProvenance(
	mode: "ask" | "auto" | null,
	defaultMode: "ask" | "auto" | null,
): string | null {
	if (!mode || !defaultMode || mode === defaultMode) return null;
	return APPROVAL_ESCAPE_COPY.sessionOverrideOf(
		modeWord(mode),
		modeWord(defaultMode),
	);
}

const ROW =
	"flex min-h-8 w-full items-center gap-2 rounded-sm px-2 text-start text-body-sm text-ink transition-colors duration-fast ease-out-quart hover:bg-accent-wash disabled:cursor-default disabled:hover:bg-transparent aria-checked:font-medium";

const ApprovalChoiceGroup: FC<{
	label: string;
	scope: ApprovalChoice["scope"];
	checked: "ask" | "auto" | null;
	pending: ApprovalChoice | null;
	onChoose: (choice: ApprovalChoice) => void;
}> = ({ label, scope, checked, pending, onChoose }) => {
	const labelId = useId();
	return (
		<div className="flex flex-col gap-0.5">
			<p id={labelId} className="px-2 pt-1 text-ink-dim text-meta">
				{label}
			</p>
			<div
				role="radiogroup"
				aria-labelledby={labelId}
				className="flex flex-col"
			>
				{CHOICES.filter((choice) => choice.scope === scope).map((choice) => {
					const isPending =
						pending?.scope === choice.scope && pending.mode === choice.mode;
					return (
						<button
							key={choice.mode}
							type="button"
							/* biome-ignore lint/a11y/useSemanticElements: a press here is an action with a pending state and a refusal, not a form value; a native radio would change its checked state before the backend answers, which is the optimistic repaint this control must never make. */
							role="radio"
							aria-checked={checked === choice.mode}
							aria-busy={isPending || undefined}
							// One press at a time (the card's one-press lock): every row is
							// disabled while any row is in flight, so a second policy call
							// cannot land after the first's confirmation.
							disabled={pending !== null}
							data-approval-choice={`${choice.scope}:${choice.mode}`}
							data-pending={isPending || undefined}
							onClick={() => onChoose(choice)}
							className={cn(ROW, choice.mode === "auto" && "text-warning")}
						>
							<span className="flex size-3.5 shrink-0 items-center justify-center">
								{isPending ? (
									<Spinner size="xs" />
								) : checked === choice.mode ? (
									<Check aria-hidden="true" className="size-3.5" />
								) : null}
							</span>
							<span className="min-w-0 truncate">{modeWord(choice.mode)}</span>
						</button>
					);
				})}
			</div>
		</div>
	);
};

/**
 * The trigger and its popover, pure over props so the stories and the suite
 * can put it in every state (loading, unknown, ask, auto, open, pending,
 * refused, partial) without a backend.
 */
export const ApprovalModePickerView: FC<{
	mode: "auto" | "ask" | null;
	/** The mode's first read is still in flight. */
	loading?: boolean;
	defaultMode?: "auto" | "ask" | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	pending?: ApprovalChoice | null;
	notice?: ApprovalPickerNotice | null;
	onChoose: (choice: ApprovalChoice) => void;
	className?: string;
}> = ({
	mode,
	loading = false,
	defaultMode = null,
	open,
	onOpenChange,
	pending = null,
	notice = null,
	onChoose,
	className,
}) => {
	useI18nLocale();
	const triggerRef = useRef<HTMLButtonElement>(null);
	const titleId = useId();
	/*
	 * Unknown mode: the bare noun, reusing the slash popup's one-word `/approvals`
	 * heading (already audited in every locale) rather than a new key.
	 */
	const unknownWord = t("ui.chat.pickers.slash.source.approvals");
	const word = mode ? modeWord(mode) : unknownWord;
	const label = mode
		? t("ui.chat.approval.chip.label", { mode: word })
		: unknownWord;
	const provenance = approvalPickerProvenance(mode, defaultMode);
	/*
	 * The partial state states BOTH halves (the card's rule): the default the
	 * `/approvals` dialog's own sentence reports as saved, then this
	 * conversation's refusal in the `Unchanged:` register. Composed from those
	 * two audited sentences rather than a new key.
	 */
	const noticeText =
		notice?.kind === "refused"
			? APPROVAL_ESCAPE_COPY.unchanged(notice.detail)
			: notice?.kind === "default-only"
				? `${t(
						"ui.chat.pickers.destination_pickers.default_approvals_for_all_sessions_that_follow_it_this_session_follows_i",
						{ string: modeWord(notice.mode) },
					)} ${APPROVAL_ESCAPE_COPY.unchanged(notice.detail)}`
				: null;
	return (
		<Popover open={open} onOpenChange={onOpenChange}>
			<PopoverAnchor virtualRef={triggerRef as never} />
			<Tooltip
				content={t("ui.chat.pickers.approvals.title")}
				// The tooltip would sit over the popover it names.
				suppressed={open}
			>
				<button
					ref={triggerRef}
					type="button"
					/*
					 * `data-composer-picker` buys the model/effort triggers' exact dock
					 * sizing (`styles/index.css`, `.composer-dock [data-composer-picker]`)
					 * and their narrow-width chevron rule, so the three read as one set.
					 */
					data-composer-picker="approvals"
					data-approval-mode-trigger=""
					data-mode={mode ?? "unknown"}
					aria-label={label}
					aria-haspopup="dialog"
					aria-expanded={open}
					aria-busy={pending !== null || undefined}
					onClick={() => onOpenChange(!open)}
					className={cn(
						READING_BUTTON,
						// Auto keeps the old chip's warning tint: it is the mode that
						// removes a check, so it should not read as neutral.
						mode === "auto" && "text-warning hover:text-warning",
						!mode && "text-ink-dim",
						className,
					)}
				>
					<ShieldCheck
						aria-hidden="true"
						className={cn(
							"size-3.5 shrink-0 @max-[620px]/chatcol:hidden",
							mode === "auto" ? "text-warning" : "text-ink-dim",
						)}
					/>
					<span className={cn("truncate", loading && !mode && "opacity-70")}>
						{word}
					</span>
					{pending ? (
						<Spinner size="xs" />
					) : (
						<ChevronDown
							aria-hidden="true"
							className="size-3 shrink-0 text-ink-dim"
						/>
					)}
				</button>
			</Tooltip>
			<PopoverContent
				side="top"
				align="start"
				collisionPadding={8}
				aria-labelledby={titleId}
				data-approval-mode-popover=""
				className="flex w-64 flex-col gap-2 rounded-lg p-2"
				onOpenAutoFocus={(event) => {
					// Focus the checked row (or the first) rather than the panel, so
					// the keyboard lands on a choice.
					event.preventDefault();
					const panel = event.currentTarget as HTMLElement | null;
					(
						panel?.querySelector<HTMLElement>('[aria-checked="true"]') ??
						panel?.querySelector<HTMLElement>("[data-approval-choice]")
					)?.focus({ preventScroll: true });
				}}
				onInteractOutside={(event) => {
					// The trigger toggles itself; dismissing on its pointer-down would
					// reopen the popover on the click that follows.
					const target = event.detail.originalEvent.target;
					if (target instanceof Node && triggerRef.current?.contains(target))
						event.preventDefault();
				}}
			>
				<div className="flex flex-col gap-0.5 px-2 pt-1">
					<h2 id={titleId} className="font-medium text-body-sm text-ink">
						{t("ui.chat.pickers.approvals.title")}
					</h2>
					{provenance && (
						<p
							data-approval-mode-provenance=""
							className="text-ink-dim text-meta"
						>
							{provenance}
						</p>
					)}
				</div>
				<ApprovalChoiceGroup
					label={t("ui.chat.pickers.destination_pickers.this_session")}
					scope="session"
					checked={mode}
					pending={pending}
					onChoose={onChoose}
				/>
				<ApprovalChoiceGroup
					label={t(
						"ui.chat.pickers.destination_pickers.default_for_all_sessions_that_follow_it",
					)}
					scope="all"
					checked={defaultMode}
					pending={pending}
					onChoose={onChoose}
				/>
				{/* `<output>` announces the refusal once without moving focus. */}
				{noticeText && (
					<output
						data-approval-mode-refusal={notice?.kind}
						className="block px-2 text-danger text-meta"
					>
						{noticeText}
					</output>
				)}
				<p
					data-approval-guardrails-note=""
					className="border-hairline border-t px-2 pt-2 text-ink-dim text-meta"
				>
					{APPROVAL_ESCAPE_COPY.guardrailsNote()}
				</p>
			</PopoverContent>
		</Popover>
	);
};

/** The connected picker. `sessionId` must be a wire session id (12 hex). */
export const ApprovalModePicker: FC<{
	sessionId: string;
	className?: string;
}> = ({ sessionId, className }) => {
	const { mode, loading } = useApprovalMode(sessionId);
	const defaults = useApprovalDefault();
	const defaultMode = approvalModeFrom(defaults.data?.value);
	const command = useSessionCommand(sessionId);
	// Optional: the shared composer also mounts in documents with no provider
	// (the mini view), where `useQueryClient` would throw.
	const { client } = useOptionalQueryClient();
	const [open, setOpen] = useState(false);
	const [pending, setPending] = useState<ApprovalChoice | null>(null);
	const [notice, setNotice] = useState<ApprovalPickerNotice | null>(null);
	// A ref, not `pending`: two presses in one tick both see the pre-render state.
	const inFlight = useRef(false);
	// A refusal describes the mode it failed to leave; once the mode moves (any
	// surface), it is no longer true.
	useEffect(() => {
		if (mode) setNotice(null);
	}, [mode]);
	const onOpenChange = useCallback(
		(next: boolean) => {
			setOpen(next);
			if (!next) return;
			if (!inFlight.current) setNotice(null);
			/*
			 * A BACKGROUND re-read, not a gate on opening: the popover is already
			 * open with what the cache holds. This is what lets a `null` cached
			 * before the runtime published its mode catch up (see "root cause").
			 */
			invalidateApprovalMode(client, sessionId);
			void client.invalidateQueries({ queryKey: approvalDefaultKey });
		},
		[client, sessionId],
	);
	const choose = useCallback(
		async (choice: ApprovalChoice) => {
			if (inFlight.current) return;
			if (approvalChoiceIsNoop(choice, mode, defaultMode)) {
				setOpen(false);
				return;
			}
			inFlight.current = true;
			setPending(choice);
			setNotice(null);
			try {
				const outcome = await runApprovalEscape(approvalChoiceTarget(choice), {
					// The caller's own words for a call that never reached the owner:
					// this press is not a typed slash command.
					runCommand: (name, args) =>
						command.run(name, args, APPROVAL_ESCAPE_COPY.notChanged()),
					editDefault: (value) =>
						desktopResult<{ key: string; value: unknown }>({
							op: "settings.edit",
							key: "tool_approval_mode",
							value,
						}),
				});
				if (outcome.kind === "saved") setOpen(false);
				else
					setNotice(
						outcome.kind === "default-only"
							? {
									kind: "default-only",
									mode: choice.mode,
									detail: outcome.detail,
								}
							: { kind: "refused", detail: outcome.detail },
					);
			} finally {
				// Repaint from the backend's answer, success or refusal alike.
				invalidateApprovalMode(client, sessionId);
				if (choice.scope === "all")
					void client.invalidateQueries({ queryKey: approvalDefaultKey });
				inFlight.current = false;
				setPending(null);
			}
		},
		[mode, defaultMode, command, client, sessionId],
	);
	return (
		<ApprovalModePickerView
			mode={mode}
			loading={loading}
			defaultMode={defaultMode}
			open={open}
			onOpenChange={onOpenChange}
			pending={pending}
			notice={notice}
			onChoose={(choice) => void choose(choice)}
			className={className}
		/>
	);
};
