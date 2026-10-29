import { userFacingMessage } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import type {
	SessionVariable,
	SessionVariablesObserved,
	VariableWrite,
} from "@shared/api/local-operator/session-variables-api";
import { isSessionVariablesMissing } from "@shared/api/local-operator/session-variables-api";
import { sessionVariablesQueryKey } from "@shared/api/local-operator/session-variables-api";
import { isSessionVariablesSessionMissing } from "@shared/api/local-operator/session-variables-api";
import { ConfirmationModal } from "@shared/components/common/confirmation-modal";
import { Spinner } from "@shared/components/common/spinner";
import { Button, Tooltip } from "@shared/components/ui";
import {
	useCreateSessionVariable,
	useDeleteSessionVariable,
	useSessionVariables,
	useUpdateSessionVariable,
} from "@shared/hooks/use-session-variables";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import {
	ChevronDown,
	ChevronRight,
	Copy,
	Pen,
	Plus,
	Trash2,
} from "lucide-react";
import type { FC, ReactNode } from "react";
import {
	memo,
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { isWritableVariableKey } from "../../../../../../shared/desktop-contract";
import { VariableFormDialog } from "./variable-form-dialog";

/**
 * What the panel says when the backend did not answer at all.
 *
 * ONE sentence shared by the two branches that can hit it - the capabilities
 * query that never answered, and the read that failed - because the user is in
 * one situation either way. The heading above it says WHICH question went
 * unanswered; the sentence says what that means for this chat. Two sentences
 * saying the same thing in different tenses read as two different problems
 * (design round 2, D4).
 *
 * Both branches still prefer the transport's own sentence where there is one:
 * the transport is what knows whether the socket was refused or the bearer was
 * wrong, and neither of those is anything this constant can say.
 */
const BACKEND_SILENT = () =>
	t(
		"ui.canvas.variables_viewer.the_backend_did_not_answer_so_this_chat_s_code_memory_could_not_be_read",
	);

type CanvasVariablesViewerProps = {
	/**
	 * The canonical session whose code memory this panel shows, or `undefined`
	 * for a staged draft that has no session yet.
	 *
	 * Threaded from `chat-page.tsx` through `chat-content.tsx` and
	 * `canvas/index.tsx`, exactly as `cwd` is, and deliberately NOT re-derived
	 * here from `conversationId` or `agentId`: those are canvas-store keys, so
	 * they are the draft key while a chat is staged and the session id once it
	 * exists - which is precisely the confusion that made this panel address a
	 * session id at an agent-registry route and 404 on every load. The one
	 * question this panel asks the backend is "what is in this session's
	 * namespace", and the backend can only answer it for a real session id.
	 */
	sessionId?: string;
	/**
	 * The canonical stream's terminal event for the session's last turn, or null
	 * before one has ended.
	 *
	 * The panel's sentences are all statements about the namespace as it was
	 * when it was read ("Nothing stored yet", "No code memory yet. It fills in
	 * when code runs in this chat."), and this is what makes them true again
	 * after a cell runs: a turn's end is when the namespace has changed, so the
	 * reading is re-taken then (see the invalidation below).
	 *
	 * A REAL signal rather than another poll, because the panel cannot poll for
	 * this: `refetchInterval` only ticks once an answer was already `busy`
	 * (`use-session-variables.ts`), which is a state the panel only reaches if it
	 * happened to be watching while a cell ran. A user who opens the panel, sends
	 * a message and watches it - the tour's own instruction - saw the sentence
	 * from before the cell and no way to refresh it short of leaving the view,
	 * because the app's default `staleTime` is five minutes (UX round 2, U1).
	 */
	turnTerminal?: number;
};

/**
 * The three terminal states (loading, failed, empty) share one centred block.
 * Local to this panel rather than a shared primitive: nothing else needs it.
 */
const CenteredState: FC<{ children: ReactNode }> = ({ children }) => (
	<div
		className={cn(
			"flex h-full flex-col items-center justify-center gap-2 p-6 text-center",
		)}
	>
		{children}
	</div>
);

// Utility function to truncate text.
//
// One ellipsis form for the whole surface: the U+2026 this app's copy uses
// (`Reading…`, `Saving…`), not the three ASCII periods a value used to be cut
// with, so a truncated value and a truncated sentence read the same way.
const truncateText = (text: string, maxLength: number): string => {
	if (text.length <= maxLength) return text;
	return `${text.substring(0, maxLength)}…`;
};

// Individual variable display component
type VariableDisplayProps = {
	variable: SessionVariable;
	onEdit: (variable: SessionVariable) => void;
	onDelete: (variableKey: string) => void;
};

const VariableRow: FC<VariableDisplayProps> = memo(
	({ variable, onEdit, onDelete }) => {
		useI18nLocale();
		const [expanded, setExpanded] = useState(false);
		const [copied, setCopied] = useState(false);
		const contentId = useId();

		/*
		 * Editability is the BACKEND's answer, not a local list of type names.
		 *
		 * A table here would be a second copy of the coercion table the write
		 * path uses, and the two are free to disagree: the version this replaced
		 * offered `string`, `boolean`, `object` and `array` in the form while the
		 * worker's table had `str`/`bool`/`list`/`dict`, so an edit the panel
		 * offered could only be refused. `editable` is computed server-side from
		 * the same table the value is coerced with, so "the panel offers an edit"
		 * and "the write path accepts it" cannot drift apart.
		 */
		const isWritable = isWritableVariableKey(variable.key);
		const isEditable = variable.editable && isWritable;
		/*
		 * Delete is gated on the same predicate as Edit, and the reason is the one
		 * C-03 exists for: a name the routes cannot address cannot be deleted
		 * either - the schema refuses the DELETE before any request is built, and
		 * the user gets "Invalid desktop operation." on a control that looked
		 * available. Copy stays: reading a name never had to address it.
		 */
		const isDeletable = isWritable;
		/*
		 * ...and a name this renderer could not write is not editable however the
		 * backend feels about its type. `editable` answers "could this value be
		 * coerced back in" - the question it should answer - and it cannot answer
		 * "would the request leave": a name of dots is resolved away by `new URL`,
		 * and an empty, over-long or control-character name is refused by the
		 * schema after the click. Offering Edit there produces a refusal the user
		 * cannot act on. See `isWritableVariableKey`.
		 */

		// Memoize string value conversion with truncation
		const stringValue = useMemo(() => String(variable.value), [variable.value]);
		const truncatedValue = useMemo(
			() => truncateText(stringValue, 200),
			[stringValue],
		);
		const tooltipValue = useMemo(
			() => truncateText(stringValue, 1000),
			[stringValue],
		);

		// The braces were Python `repr` punctuation leaking into the UI. The type
		// is already set apart by its dim ink and its position between the name
		// and the value.
		const typeDisplay = variable.type;

		// Memoize callbacks
		const handleToggleExpand = useCallback(() => {
			setExpanded((prev) => !prev);
		}, []);

		const handleEdit = useCallback(
			(e: React.MouseEvent) => {
				e.stopPropagation();
				onEdit(variable);
			},
			[onEdit, variable],
		);

		const handleDelete = useCallback(
			(e: React.MouseEvent) => {
				e.stopPropagation();
				onDelete(variable.key);
			},
			[onDelete, variable.key],
		);

		const handleCopy = useCallback(
			async (e: React.MouseEvent) => {
				e.stopPropagation();
				try {
					await navigator.clipboard.writeText(stringValue);
					setCopied(true);
					setTimeout(() => setCopied(false), 2000);
				} catch (error) {
					console.error("Failed to copy to clipboard:", error);
				}
			},
			[stringValue],
		);

		return (
			<div className={cn("group border-hairline border-b last:border-b-0")}>
				<div
					className={cn(
						"flex min-h-8 items-center gap-1 pe-1",
						/* The row's hover is a step DOWN from the pane's ground and not up to
						   `elevated`: these rows have no plane of their own (they ride the pane,
						   `canvas/index.tsx`), so an `elevated` hover now measures ΔE00 0 against
						   the drawer's rung — the same reason the console's surface rows and the
						   subagent rows hover on `surface`. */
						"transition-colors duration-fast ease-out-quart hover:bg-surface",
					)}
				>
					{/*
					 * The disclosure trigger spans the whole reading half of the row
					 * so the click target matches what the eye reads, and the actions
					 * sit outside it — a button inside a button is invalid HTML.
					 */}
					<button
						type="button"
						onClick={handleToggleExpand}
						aria-expanded={expanded}
						aria-controls={contentId}
						className={cn(
							"flex min-w-0 flex-1 cursor-pointer select-none items-center gap-2 px-2 py-1 text-start font-mono text-mono-sm",
						)}
					>
						{/*
						 * A chevron, not a plus: a `+`/`-` pair here was a second
						 * expand/collapse language in a panel that already had one, and
						 * `+` also reads as "add" beside a create control that means
						 * exactly that.
						 *
						 * The chevron SWAPS rather than rotates, matching
						 * `@shared/components/ui/disclosure`. This row cannot use that
						 * component directly — the trigger is only the reading half of
						 * the row, with sibling action buttons outside it, and nesting a
						 * button inside a button is invalid HTML — so it reimplements the
						 * trigger and must not also reinvent the signal. Rotation was
						 * additionally a motion-rule violation: transitions are for
						 * entrances, and a toggle is not one.
						 */}
						{expanded ? (
							<ChevronDown
								aria-hidden="true"
								className="size-3 shrink-0 text-ink-dim rtl:-scale-x-100"
							/>
						) : (
							<ChevronRight
								aria-hidden="true"
								className="size-3 shrink-0 text-ink-dim rtl:-scale-x-100"
							/>
						)}
						<span className={cn("shrink-0 font-medium text-ink")}>
							{variable.key}
						</span>
						<span className={cn("shrink-0 text-ink-dim")}>{typeDisplay}</span>
						<Tooltip content={tooltipValue} align="start">
							<span className={cn("min-w-0 flex-1 truncate text-ink-muted")}>
								{truncatedValue}
							</span>
						</Tooltip>
					</button>
					{/*
					 * Row actions appear on hover or keyboard focus. Twenty-one
					 * permanently drawn icons down a seven-row list — seven of them
					 * red — read as a warning rather than as a set of controls, and
					 * they competed with the values, which are what the panel is for.
					 * Linear and Notion both reveal row actions this way. Focus goes
					 * through `group-focus-within`, so they stay keyboard-reachable.
					 */}
					<div
						className={cn(
							"flex shrink-0 items-center gap-0.5",
							"pointer-events-none opacity-0",
							"group-hover:pointer-events-auto group-hover:opacity-100",
							"group-focus-within:pointer-events-auto group-focus-within:opacity-100",
						)}
					>
						<Tooltip
							content={
								copied
									? t("ui.canvas.variables_viewer.copied")
									: t("ui.canvas.variables_viewer.copy_value")
							}
						>
							<Button
								variant="ghost"
								size="icon-sm"
								onClick={handleCopy}
								aria-label={t("ui.canvas.variables_viewer.copy_value")}
							>
								<Copy />
							</Button>
						</Tooltip>
						{isEditable ? (
							<Tooltip content={t("ui.canvas.variables_viewer.edit_variable")}>
								<Button
									variant="ghost"
									size="icon-sm"
									onClick={handleEdit}
									aria-label={t("ui.canvas.variables_viewer.edit_variable")}
								>
									<Pen />
								</Button>
							</Tooltip>
						) : (
							/*
							 * `aria-disabled` rather than `disabled`: a disabled button
							 * swallows pointer events, and the tooltip is the only place
							 * the reason is stated.
							 */
							<Tooltip
								content={
									// Two reasons, and they must not be swapped: the type gate is
									// the backend saying it cannot coerce this value back, the
									// name gate is this panel saying the row cannot be
									// addressed at all (review round 2, C-06).
									isWritable
										? t(
												"ui.canvas.variables_viewer.this_variable_can_t_be_edited_because_its_type_is_not_yet_supported_for",
											)
										: t(
												"ui.canvas.variables_viewer.this_variable_s_name_can_t_be_edited_from_here_copy_it_to_the_session_un",
											)
								}
							>
								<Button
									variant="ghost"
									size="icon-sm"
									aria-disabled="true"
									aria-label={t("ui.canvas.variables_viewer.edit_variable")}
									className={cn(
										"cursor-default text-ink-disabled hover:bg-transparent hover:text-ink-disabled",
									)}
								>
									<Pen />
								</Button>
							</Tooltip>
						)}
						{/*
						 * Neutral at rest, danger on hover. A red glyph on every row
						 * spends the danger role on a state where nothing is wrong.
						 */}
						{isDeletable && (
							<Tooltip
								content={t("ui.canvas.variables_viewer.delete_variable")}
							>
								<Button
									variant="ghost"
									size="icon-sm"
									onClick={handleDelete}
									aria-label={t("ui.canvas.variables_viewer.delete_variable")}
									className={cn("hover:bg-danger-wash hover:text-danger")}
								>
									<Trash2 />
								</Button>
							</Tooltip>
						)}
					</div>
				</div>
				{expanded ? (
					<div
						id={contentId}
						className={cn(
							"max-h-75 overflow-auto whitespace-pre-wrap break-words bg-sunken px-7 py-2 font-mono text-ink-muted text-mono-sm",
						)}
					>
						{stringValue}
					</div>
				) : null}
			</div>
		);
	},
);

VariableRow.displayName = "VariableRow";

export const CanvasVariablesViewer: FC<CanvasVariablesViewerProps> = memo(
	({ sessionId, turnTerminal }) => {
		useI18nLocale();
		const [isFormOpen, setIsFormOpen] = useState(false);
		const [editingVariable, setEditingVariable] =
			useState<SessionVariable | null>(null);
		const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
		const [variableToDeleteKey, setVariableToDeleteKey] = useState<
			string | null
		>(null);

		/*
		 * The capability gate comes first, and it is the only honest way to
		 * handle an older backend: an unadvertised surface means the routes are
		 * not there, so the panel offers the update rather than firing a call it
		 * knows will 404. `undefined` capabilities (still loading, or this app
		 * did not start a backend) is also false, so the gate fails closed.
		 */
		const capabilities = useDesktopCapabilities();
		const supported = desktopFeatureEnabled(
			capabilities.data,
			"session_variables",
		);

		const { data, isLoading, error, isError } = useSessionVariables(
			sessionId,
			supported,
		);

		/*
		 * Re-take the reading when a turn ends.
		 *
		 * The panel's four sentences are claims about the namespace at the moment
		 * it was read, and the one moment the namespace is guaranteed to have
		 * changed is the end of a turn. Without this, a reading taken before the
		 * cell ran stays on screen - "No code memory yet. It fills in when code
		 * runs in this chat." rendered AFTER the chat ran code - because the app's
		 * default `staleTime` is five minutes, so nothing re-asks on its own until
		 * a write happens to invalidate this key (UX round 2, U1).
		 *
		 * Keyed on observed completion pulses (`turn_end` / `agent_end`) rather
		 * than on an event name that repeats, or on a timer. A run can emit both
		 * endings; this is not a unique-turn count. The mount case is already
		 * covered by `refetchOnMount: "always"` on the read itself.
		 */
		const queryClient = useQueryClient();
		const turnsSeen = useRef(turnTerminal);
		useEffect(() => {
			const previous = turnsSeen.current;
			turnsSeen.current = turnTerminal;
			// A turn that ended while this panel was open, and only that: a panel
			// mounted after the turn has nothing to refresh, and the surface must be
			// one the backend can answer about at all.
			if (previous === undefined || turnTerminal === undefined) return;
			if (turnTerminal <= previous) return;
			if (!sessionId || !supported) return;
			void queryClient.invalidateQueries({
				queryKey: sessionVariablesQueryKey(sessionId),
			});
		}, [turnTerminal, sessionId, supported, queryClient]);

		const createVariableMutation = useCreateSessionVariable();
		const updateVariableMutation = useUpdateSessionVariable();
		const deleteVariableMutation = useDeleteSessionVariable();

		/*
		 * The last list the backend actually read.
		 *
		 * A `busy` answer means "a cell is running; the namespace cannot be read
		 * right now" and carries no variables by design. Blanking the panel there
		 * would turn a running cell into "nothing stored yet", so the previous
		 * reading is kept and the reading affordance sits beside it. Only a
		 * reading that was never taken renders the affordance alone.
		 */
		const lastObserved = useRef<SessionVariablesObserved | null>(null);
		useEffect(() => {
			if (data?.state === "observed") lastObserved.current = data;
		}, [data]);

		const observed = data?.state === "observed" ? data : lastObserved.current;
		const isBusy = data?.state === "busy";
		const variables = useMemo(() => observed?.variables ?? [], [observed]);

		const handleOpenCreateForm = useCallback(() => {
			setEditingVariable(null);
			setIsFormOpen(true);
		}, []);

		const handleOpenEditForm = useCallback((variable: SessionVariable) => {
			setEditingVariable(variable);
			setIsFormOpen(true);
		}, []);

		const handleCloseForm = useCallback(() => {
			setIsFormOpen(false);
			setEditingVariable(null);
		}, []);

		const handleSubmitVariableForm = useCallback(
			async (write: VariableWrite) => {
				// Unreachable through the UI (the form is only offered with a
				// session), but the panel never invents an identity to write to.
				if (!sessionId) return;
				try {
					if (editingVariable) {
						// Update existing variable
						await updateVariableMutation.mutateAsync({
							sessionId,
							...write,
							key: editingVariable.key, // Key cannot be changed
						});
					} else {
						await createVariableMutation.mutateAsync({ sessionId, ...write });
					}
					// The toast, success or refusal, belongs to the mutation hook:
					// it is the layer that holds the backend's own sentence.
				} catch (e) {
					// Rethrown so the dialog stays open on a refusal - the form is
					// where the user fixes a reserved name or a bad value.
					console.error("Submission failed in component:", e);
					throw e;
				}
			},
			[
				sessionId,
				editingVariable,
				createVariableMutation,
				updateVariableMutation,
			],
		);

		const handleDeleteVariable = useCallback((variableKey: string) => {
			setVariableToDeleteKey(variableKey);
			setIsDeleteConfirmOpen(true);
		}, []);

		const confirmDeleteVariable = useCallback(async () => {
			if (!sessionId || !variableToDeleteKey) {
				setIsDeleteConfirmOpen(false);
				setVariableToDeleteKey(null);
				return;
			}
			try {
				await deleteVariableMutation.mutateAsync({
					sessionId,
					key: variableToDeleteKey,
				});
			} catch (e) {
				// The refusal's own sentence is already on screen, from the hook.
				console.error("Deletion failed during confirmation:", e);
			} finally {
				setIsDeleteConfirmOpen(false);
				setVariableToDeleteKey(null);
			}
		}, [sessionId, variableToDeleteKey, deleteVariableMutation]);

		if (capabilities.isLoading) {
			return (
				<CenteredState>
					<Spinner size="sm" />
					<p className={cn("text-body-sm text-ink-muted")}>
						{t("ui.canvas.variables_viewer.loading_variables")}
					</p>
				</CenteredState>
			);
		}

		/*
		 * The capabilities query is the panel's FIRST question, and it can fail as
		 * well as answer. `desktopFeatureEnabled(undefined, …)` is false for both, so
		 * a backend that never answered used to be told to update itself - advice
		 * that cannot help when the real problem is that nothing is listening. The
		 * chat pane draws the same three distinctions for its own gate
		 * (`chat-page.tsx`); this mirrors it, and quotes the transport's own
		 * sentence rather than inventing one, because the transport is what knows
		 * whether it was a refused socket or a wrong bearer.
		 */
		if (capabilities.isError) {
			return (
				<CenteredState>
					<p className={cn("text-heading text-ink")}>
						{t("ui.canvas.variables_viewer.could_not_reach_the_backend")}
					</p>
					<p className={cn("max-w-80 text-body-sm text-ink-muted")}>
						{userFacingMessage(capabilities.error, BACKEND_SILENT())}
					</p>
				</CenteredState>
			);
		}

		if (!supported) {
			return (
				<CenteredState>
					<p className={cn("text-heading text-ink")}>
						{t(
							"ui.canvas.variables_viewer.update_the_backend_to_read_code_memory",
						)}
					</p>
					{/*
					 * The gate is deliberately control-free (the frozen state table says
					 * "none"), so the sentence has to carry the action itself: it names
					 * WHERE the update happens, which is the half a user with an old backend
					 * was left to guess. "Application updates and info" is the Settings
					 * section that installs it (`app-updates-section.tsx`).
					 */}
					<p className={cn("max-w-80 text-body-sm text-ink-muted")}>
						{t(
							"ui.canvas.variables_viewer.this_app_can_read_code_memory_the_backend_it_is_running_against_is_older",
						)}
					</p>
				</CenteredState>
			);
		}

		/*
		 * A draft has no session, so there is nothing to read and NOTHING is
		 * asked: the query stays disabled above, and this is the honest sentence
		 * rather than a request that could only 404.
		 */
		if (!sessionId) {
			return (
				<CenteredState>
					<p className={cn("text-heading text-ink")}>
						{t(
							"ui.canvas.variables_viewer.code_memory_starts_when_you_send_your_first_message",
						)}
					</p>
				</CenteredState>
			);
		}

		if (isLoading) {
			return (
				<CenteredState>
					<Spinner size="sm" />
					<p className={cn("text-body-sm text-ink-muted")}>
						{t("ui.canvas.variables_viewer.loading_variables")}
					</p>
				</CenteredState>
			);
		}

		if (isError) {
			/*
			 * Three different facts wear a 404, and the fix differs for each. The
			 * route-absent one is a STALE capabilities answer - the gate above
			 * established that this backend advertises the surface, so it is the same
			 * sentence and the same fix as the gate's. The session-missing one is the
			 * backend saying, in its own words, that it has no such session; that
			 * sentence IS the actionable one and is quoted instead of argued with
			 * (QA round 1, Q-5). Everything else is a failure this panel cannot
			 * diagnose, and it no longer guesses ("check that Local Operator is
			 * running" was false advice whenever the backend had answered at all).
			 */
			if (isSessionVariablesMissing(error)) {
				return (
					<CenteredState>
						<p className={cn("text-heading text-ink")}>
							{t(
								"ui.canvas.variables_viewer.update_the_backend_to_read_code_memory",
							)}
						</p>
						<p className={cn("max-w-80 text-body-sm text-ink-muted")}>
							{t(
								"ui.canvas.variables_viewer.settings_then_application_updates_and_info_installs_the_newer_backend",
							)}
						</p>
					</CenteredState>
				);
			}
			if (isSessionVariablesSessionMissing(error)) {
				return (
					<CenteredState>
						<p className={cn("text-heading text-ink")}>
							{t("ui.canvas.variables_viewer.could_not_load_variables")}
						</p>
						<p className={cn("max-w-80 text-body-sm text-ink-muted")}>
							{userFacingMessage(
								error,
								t(
									"ui.canvas.variables_viewer.the_backend_does_not_have_a_chat_with_this_session_id",
								),
							)}
						</p>
					</CenteredState>
				);
			}
			return (
				<CenteredState>
					<p className={cn("text-heading text-ink")}>
						{t("ui.canvas.variables_viewer.could_not_load_variables")}
					</p>
					<p className={cn("max-w-80 text-body-sm text-ink-muted")}>
						{BACKEND_SILENT()}
					</p>
				</CenteredState>
			);
		}

		if (data?.state === "unsupported") {
			return (
				<CenteredState>
					<p className={cn("text-heading text-ink")}>
						{t("ui.canvas.variables_viewer.this_chat_cannot_read_code_memory")}
					</p>
				</CenteredState>
			);
		}

		if (variables.length === 0) {
			if (isBusy) {
				return (
					<CenteredState>
						<Spinner size="sm" />
						<p className={cn("text-body-sm text-ink-muted")}>
							{t("ui.canvas.variables_viewer.reading")}
						</p>
					</CenteredState>
				);
			}
			/*
			 * A reading can come back observed, empty and truncated at once, and the
			 * frozen state table has no row for it: one name whose single value
			 * exceeds the whole reading budget is dropped by the owner, which then
			 * reports `truncated: true` with nothing to show for it. Rendering the
			 * ordinary empty sentence there would state a fact the backend did not -
			 * the namespace is not empty, it is unlistable - so it gets its own
			 * sentence and no New control (the write behind that control is exactly
			 * what the owner could not read).
			 */
			if (observed?.truncated && variables.length === 0 && !isBusy) {
				return (
					<CenteredState>
						<p className={cn("text-heading text-ink")}>
							{t("ui.canvas.variables_viewer.too_large_to_show_here")}
						</p>
						<p className={cn("max-w-80 text-body-sm text-ink-muted")}>
							{t(
								"ui.canvas.variables_viewer.this_chat_keeps_a_value_bigger_than_this_panel_can_list_so_nothing_is_sh",
							)}
						</p>
					</CenteredState>
				);
			}
			/*
			 * An empty namespace is only "empty" once a kernel exists to hold
			 * one. The two absences have their own sentences because they are
			 * different situations for the user: a chat that has not started yet
			 * versus one whose interpreter was released after sitting idle.
			 */
			const kernelAbsent =
				observed?.kernel === "absent" || observed?.runtime === "absent";
			return (
				<CenteredState>
					<p className={cn("text-heading text-ink")}>
						{kernelAbsent
							? t("ui.canvas.variables_viewer.no_code_memory_yet")
							: t("ui.canvas.variables_viewer.nothing_stored_yet")}
					</p>
					<p className={cn("max-w-80 text-body-sm text-ink-muted")}>
						{kernelAbsent
							? t(
									"ui.canvas.variables_viewer.it_fills_in_when_code_runs_in_this_chat",
								)
							: t(
									"ui.canvas.variables_viewer.when_the_agent_runs_code_for_you_the_values_it_keeps_around_between_step",
								)}
					</p>
					{kernelAbsent ? null : (
						<Button
							variant="secondary"
							size="sm"
							onClick={handleOpenCreateForm}
						>
							<Plus aria-hidden="true" />
							{t("ui.canvas.variables_viewer.new_variable")}
						</Button>
					)}
				</CenteredState>
			);
		}

		return (
			<div className={cn("flex h-full min-h-0 flex-col")}>
				{/*
				 * A one-line header, not a page masthead. The view switcher in the
				 * panel chrome already says which view this is, so a 16px title and
				 * a sentence of description restated it and spent 60px doing so.
				 * What is worth saying here is how many there are.
				 */}
				<div
					className={cn(
						"flex h-10 shrink-0 items-center justify-between gap-3 border-hairline border-b px-3",
					)}
				>
					<p
						className={cn(
							"flex min-w-0 items-center truncate text-body-sm text-ink-muted",
						)}
					>
						<span className={cn("font-medium text-ink")}>
							{t("ui.canvas.variables_viewer.code_memory")}
						</span>
						<span className={cn("mx-1.5 text-ink-dim")}>·</span>
						{t("ui.canvas.variables_viewer.count", {
							count: variables.length,
						})}
						{/*
						 * Busy keeps the list it was showing and says, quietly, that
						 * it is re-reading. It is not an error: the last answer is
						 * still the best one available, and a cell that is running is
						 * the normal way to reach this state.
						 */}
						{isBusy ? (
							<>
								<span className={cn("mx-1.5 text-ink-dim")}>·</span>
								<Spinner size="xs" />
								<span className={cn("ms-1.5")}>
									{t("ui.canvas.variables_viewer.reading")}
								</span>
							</>
						) : null}
					</p>
					<Button variant="ghost" size="sm" onClick={handleOpenCreateForm}>
						<Plus aria-hidden="true" />
						{/*
						 * "New variable", not "New": the empty state's control and this one
						 * submit the same form, so they are named the same way (design round 1,
						 * D6). The header is one line; the two extra words fit and say what
						 * appears.
						 */}
						{t("ui.canvas.variables_viewer.new_variable")}
					</Button>
				</div>
				{/*
				 * Full-bleed rows. The list used to sit in a `rounded-md bg-surface`
				 * box inset 24px inside a panel that is already `surface` — an
				 * invisible container costing 48px of the width the values need.
				 */}
				<div className={cn("min-h-0 flex-1 overflow-auto")}>
					{variables.map((variable) => (
						<VariableRow
							key={variable.key}
							variable={variable}
							onEdit={handleOpenEditForm}
							onDelete={handleDeleteVariable}
						/>
					))}
				</div>
				{/* Always mounted past the draft guard above: the form is where a
				    create or an edit lands, and both need a session to write to. */}
				<VariableFormDialog
					open={isFormOpen}
					onClose={handleCloseForm}
					onSubmit={handleSubmitVariableForm}
					initialData={editingVariable}
				/>
				{variableToDeleteKey && ( // Render modal only if there's a key to delete
					<ConfirmationModal
						open={isDeleteConfirmOpen}
						title={t("ui.canvas.variables_viewer.delete_variable")}
						message={
							<>
								{t(
									"ui.canvas.variables_viewer.are_you_sure_you_want_to_delete_the_variable",
								)}{" "}
								<strong className={cn("font-mono text-ink")}>
									{variableToDeleteKey}
								</strong>
								{t("ui.canvas.variables_viewer.this_action_cannot_be_undone")}
							</>
						}
						confirmText={t("ui.canvas.variables_viewer.delete")}
						cancelText={t("ui.canvas.variables_viewer.cancel")}
						isDangerous
						onConfirm={confirmDeleteVariable}
						onCancel={() => {
							setIsDeleteConfirmOpen(false);
							setVariableToDeleteKey(null);
						}}
					/>
				)}
			</div>
		);
	},
);

CanvasVariablesViewer.displayName = "CanvasVariablesViewer";
