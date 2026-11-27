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
 *   the popover offers This session (Ask / Auto) and a default (Ask / Auto)
 *   for sessions that follow it.
 *   Opening is local UI state: it starts background reads, never a write, so
 *   it is instant even when the backend is slow.
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
 * disagree. A row press uses the selected scope's authority, then invalidates
 * the reads; checks reflect the backend rather than the press. A session
 * choice can be refused or apply live without being saved for resume. A default
 * choice edits only the setting, leaving any explicit override alone (unlike
 * the pending card's intentionally combined action).
 *
 * ## Why a slow press is bounded, and by what
 *
 * A session press is `sessions.command`, which the transport already bounds:
 * `desktopRequestDeadlineMs` gives it the 20 s control deadline in main (plus
 * the renderer's 5 s margin), after which `desktopResult` throws and
 * the live outcome classifier presents the deadline detail.
 * No second timeout is added here: the pressed row shows its spinner for as
 * long as the request is genuinely in flight, and the popover stays usable (it
 * can be closed; an incomplete outcome stays available on the trigger).
 */
import { Spinner } from "@shared/components/common/spinner";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@shared/components/ui/popover";
import { Tooltip } from "@shared/components/ui/tooltip";
import { useOptionalQueryClient } from "@shared/hooks/use-optional-query-client";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { type QueryClient, useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, ShieldAlert, ShieldCheck } from "lucide-react";
import { type FC, useCallback, useId, useRef, useState } from "react";
// Cycle-safe like `useEntities` below: the card's exports are only called at
// run time, never at module evaluation.
import {
	APPROVAL_ESCAPE_COPY,
	setLiveApprovalMode,
} from "../components/trace/approval-escape";
import { useEntities } from "../pickers/destination-pickers";
import { errorText, useSessionCommand } from "../pickers/use-picker-backend";
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
 * any approvals mutation, whichever surface sent it, because the entity row
 * is the shared read of the current live mode.
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
 * Read at mount rather than on open so the checkmarks can already be there
 * when it opens; opening never waits on the network.
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

const MODES = ["ask", "auto"] as const;

/** A receipt belongs to the acted-on scope, not to a refreshed read. */
export type ApprovalPickerNotice = {
	scope: ApprovalChoice["scope"];
	kind: "refused" | "not-saved-for-resume";
	detail: string;
};

const scopeLabel = (scope: ApprovalChoice["scope"]) =>
	scope === "session"
		? t("ui.chat.pickers.destination_pickers.this_session")
		: t(
				"ui.chat.pickers.destination_pickers.default_for_all_sessions_that_follow_it",
			);

const modeWord = (mode: "ask" | "auto"): string =>
	mode === "auto"
		? t("ui.chat.approval.mode.auto")
		: t("ui.chat.approval.mode.ask");

const ROW =
	"flex min-h-8 w-full items-center gap-2 rounded-sm px-2 text-start text-body-sm text-ink transition-colors duration-fast ease-out-quart hover:bg-accent-wash aria-disabled:cursor-default aria-disabled:hover:bg-transparent aria-pressed:font-medium";

const ApprovalChoiceGroup: FC<{
	scope: ApprovalChoice["scope"];
	checked: "ask" | "auto" | null;
	loading: boolean;
	pending: ApprovalChoice | null;
	notice: string | null;
	onChoose: (choice: ApprovalChoice) => void;
}> = ({ scope, checked, loading, pending, notice, onChoose }) => {
	const descriptionId = useId();
	return (
		<fieldset
			aria-describedby={!checked || notice ? descriptionId : undefined}
			className="min-w-0"
		>
			<legend className="px-2 pt-1 text-ink-dim text-meta">
				{scopeLabel(scope)}
			</legend>
			<div id={descriptionId}>
				{!checked && (
					<p className="px-2 pb-0.5 text-ink-dim text-meta">
						{loading
							? t("ui.chat.slash.empty.loading")
							: t("ui.chat.pickers.destination_pickers.unknown")}
					</p>
				)}
				{notice && (
					<p
						data-approval-mode-notice={scope}
						className="px-2 pb-1 text-danger text-meta [overflow-wrap:anywhere]"
					>
						{notice}
					</p>
				)}
			</div>
			{MODES.map((mode) => {
				const isPending = pending?.scope === scope && pending.mode === mode;
				return (
					<button
						key={mode}
						type="button"
						aria-pressed={checked === mode}
						aria-busy={isPending || undefined}
						// Commands need Enter/Space, not radio arrows that write on move.
						// Keep the keyboard on this row if its command is refused.
						aria-disabled={pending !== null || undefined}
						data-approval-choice={`${scope}:${mode}`}
						data-pending={isPending || undefined}
						onClick={() => {
							if (!pending) onChoose({ scope, mode });
						}}
						className={cn(ROW, mode === "auto" && "text-warning")}
					>
						<span className="flex size-3.5 shrink-0 items-center justify-center">
							{isPending ? (
								<Spinner size="xs" />
							) : checked === mode ? (
								<Check aria-hidden="true" className="size-3.5" />
							) : null}
						</span>
						<span className="min-w-0 truncate">{modeWord(mode)}</span>
					</button>
				);
			})}
		</fieldset>
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
	defaultLoading?: boolean;
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
	defaultLoading = false,
	open,
	onOpenChange,
	pending = null,
	notice = null,
	onChoose,
	className,
}) => {
	useI18nLocale();
	const titleId = useId();
	const statusId = useId();
	/*
	 * Unknown mode: the bare noun, reusing the slash popup's one-word `/approvals`
	 * heading (already audited in every locale) rather than a new key.
	 */
	const unknownWord = t("ui.chat.pickers.slash.source.approvals");
	const word = mode ? modeWord(mode) : unknownWord;
	const label = mode
		? t("ui.chat.approval.chip.label", { mode: word })
		: unknownWord;
	const title = t("ui.chat.pickers.approvals.title");
	const noticeText = notice
		? notice.kind === "refused" && notice.scope === "session"
			? APPROVAL_ESCAPE_COPY.unchanged(notice.detail)
			: notice.detail
		: null;
	const statusText = notice && `${scopeLabel(notice.scope)}: ${noticeText}`;
	const Shield = notice ? ShieldAlert : ShieldCheck;
	return (
		<Popover open={open} onOpenChange={onOpenChange}>
			<Tooltip
				content={statusText ? `${title} — ${statusText}` : title}
				// The tooltip would sit over the popover it names.
				suppressed={open}
				discardWhileSuppressed
			>
				<PopoverTrigger asChild>
					<button
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
						aria-describedby={statusText && !open ? statusId : undefined}
						aria-busy={pending !== null || undefined}
						className={cn(
							READING_BUTTON,
							// Auto keeps the old chip's warning tint: it is the mode that
							// removes a check, so it should not read as neutral.
							mode === "auto" && "text-warning hover:text-warning",
							!mode && "text-ink-dim",
							className,
						)}
					>
						{pending ? (
							<Spinner size="xs" className="approval-mode-trigger-spinner" />
						) : (
							<Shield
								aria-hidden="true"
								className={cn(
									"size-3.5 shrink-0",
									notice
										? "text-danger"
										: cn(
												"@max-[620px]/chatcol:hidden",
												mode === "auto" ? "text-warning" : "text-ink-dim",
											),
								)}
							/>
						)}
						<span className={cn("truncate", loading && !mode && "opacity-70")}>
							{word}
						</span>
						<ChevronDown
							aria-hidden="true"
							className="size-3 shrink-0 text-ink-dim"
						/>
					</button>
				</PopoverTrigger>
			</Tooltip>
			{/* Mount the live region outside the dismissible panel, before a write starts. */}
			<output id={statusId} className="sr-only" data-approval-mode-status="">
				{statusText}
			</output>
			<PopoverContent
				side="top"
				align="start"
				collisionPadding={8}
				aria-labelledby={titleId}
				data-approval-mode-popover=""
				className="flex max-h-[var(--radix-popover-content-available-height)] w-64 max-w-[var(--radix-popover-content-available-width)] flex-col gap-2 overflow-y-auto rounded-lg p-2"
				onOpenAutoFocus={(event) => {
					// Start in the session scope even when only the default is known.
					const panel = event.currentTarget as HTMLElement | null;
					const row =
						panel?.querySelector<HTMLElement>(
							'[data-approval-choice^="session:"][aria-pressed="true"]',
						) ?? panel?.querySelector<HTMLElement>("[data-approval-choice]");
					if (row) {
						event.preventDefault();
						row.focus({ preventScroll: true });
					}
				}}
			>
				<h2
					id={titleId}
					className="px-2 pt-1 font-medium text-body-sm text-ink"
				>
					{title}
				</h2>
				<ApprovalChoiceGroup
					scope="session"
					checked={mode}
					loading={loading}
					pending={pending}
					notice={notice?.scope === "session" ? noticeText : null}
					onChoose={onChoose}
				/>
				<ApprovalChoiceGroup
					scope="all"
					checked={defaultMode}
					loading={defaultLoading}
					pending={pending}
					notice={notice?.scope === "all" ? noticeText : null}
					onChoose={onChoose}
				/>
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
}> = (props) => <SessionApprovalModePicker key={props.sessionId} {...props} />;

// Key the interaction, not just the reads: a slow receipt from the previous
// conversation must never appear in the newly selected conversation.
const SessionApprovalModePicker: typeof ApprovalModePicker = ({
	sessionId,
	className,
}) => {
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
	const onOpenChange = useCallback(
		(next: boolean) => {
			setOpen(next);
			if (!next) return;
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
			inFlight.current = true;
			setPending(choice);
			setNotice(null);
			try {
				if (choice.scope === "all") {
					// Like /approvals' default scope, this edit must not pin this
					// session. The runtime decides which sessions follow the default.
					const row = await desktopResult<{ key: string; value: unknown }>({
						op: "settings.edit",
						key: "tool_approval_mode",
						value: choice.mode,
					});
					if (row?.value !== choice.mode) {
						setNotice({
							scope: choice.scope,
							kind: "refused",
							detail: t(
								"ui.chat.pickers.destination_pickers.the_default_was_not_saved",
							),
						});
						return;
					}
				} else {
					// A cached checkmark is not authority to skip a deliberate re-arm:
					// the live gate may differ (or may be inheriting, not overridden).
					const live = await setLiveApprovalMode(
						(name, args) =>
							command.run(
								name,
								args,
								APPROVAL_ESCAPE_COPY.notChanged(),
								// Only this explicit session choice can re-arm Auto after Team
								// Bridge content; the default editor and pending card cannot.
								choice.mode === "auto" ? { bridgeAck: true } : undefined,
							),
						choice.mode,
					);
					if (!live.ok) {
						setNotice({
							scope: choice.scope,
							kind: "refused",
							detail: live.detail,
						});
						return;
					}
					if (live.notSavedForResume !== undefined) {
						setNotice({
							scope: choice.scope,
							kind: "not-saved-for-resume",
							detail: live.notSavedForResume,
						});
						return;
					}
				}
				setOpen(false);
			} catch (error) {
				setNotice({
					scope: choice.scope,
					kind: "refused",
					detail: errorText(error),
				});
			} finally {
				// Repaint from the backend's answer, success or refusal alike.
				invalidateApprovalMode(client, sessionId);
				if (choice.scope === "all")
					void client.invalidateQueries({ queryKey: approvalDefaultKey });
				inFlight.current = false;
				setPending(null);
			}
		},
		[command, client, sessionId],
	);
	return (
		<ApprovalModePickerView
			mode={mode}
			loading={loading}
			defaultMode={defaultMode}
			defaultLoading={defaults.isLoading}
			open={open}
			onOpenChange={onOpenChange}
			pending={pending}
			notice={notice}
			onChoose={(choice) => void choose(choice)}
			className={className}
		/>
	);
};
