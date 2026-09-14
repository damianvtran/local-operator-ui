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
import { ConfirmationModal } from "@shared/components/common/confirmation-modal";
import { Spinner } from "@shared/components/common/spinner";
import { Button, Tooltip } from "@shared/components/ui";
import {
	useCreateSessionVariable,
	useDeleteSessionVariable,
	useSessionVariables,
	useUpdateSessionVariable,
} from "@shared/hooks/use-session-variables";
import { cn } from "@shared/lib/utils";
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
import { VariableFormDialog } from "./variable-form-dialog";

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

// Utility function to truncate text
const truncateText = (text: string, maxLength: number): string => {
	if (text.length <= maxLength) return text;
	return `${text.substring(0, maxLength)}...`;
};

// Individual variable display component
type VariableDisplayProps = {
	variable: SessionVariable;
	onEdit: (variable: SessionVariable) => void;
	onDelete: (variableKey: string) => void;
};

const VariableRow: FC<VariableDisplayProps> = memo(
	({ variable, onEdit, onDelete }) => {
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
		const isEditable = variable.editable;

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
						"flex min-h-8 items-center gap-1 pr-1",
						"transition-colors duration-fast ease-out-quart hover:bg-elevated",
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
							"flex min-w-0 flex-1 cursor-pointer select-none items-center gap-2 px-2 py-1 text-left font-mono text-mono-sm",
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
								className="size-3 shrink-0 text-ink-dim"
							/>
						) : (
							<ChevronRight
								aria-hidden="true"
								className="size-3 shrink-0 text-ink-dim"
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
						<Tooltip content={copied ? "Copied" : "Copy value"}>
							<Button
								variant="ghost"
								size="icon-sm"
								onClick={handleCopy}
								aria-label="Copy value"
							>
								<Copy />
							</Button>
						</Tooltip>
						{isEditable ? (
							<Tooltip content="Edit variable">
								<Button
									variant="ghost"
									size="icon-sm"
									onClick={handleEdit}
									aria-label="Edit variable"
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
							<Tooltip content="This variable can't be edited because its type is not yet supported for editing.">
								<Button
									variant="ghost"
									size="icon-sm"
									aria-disabled="true"
									aria-label="Edit variable"
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
						<Tooltip content="Delete variable">
							<Button
								variant="ghost"
								size="icon-sm"
								onClick={handleDelete}
								aria-label="Delete variable"
								className={cn("hover:bg-danger-wash hover:text-danger")}
							>
								<Trash2 />
							</Button>
						</Tooltip>
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
	({ sessionId }) => {
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
					<p className={cn("text-body-sm text-ink-muted")}>Loading variables</p>
				</CenteredState>
			);
		}

		if (!supported) {
			return (
				<CenteredState>
					<p className={cn("text-heading text-ink")}>
						Update the backend to read code memory.
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
						Code memory starts when you send your first message.
					</p>
				</CenteredState>
			);
		}

		if (isLoading) {
			return (
				<CenteredState>
					<Spinner size="sm" />
					<p className={cn("text-body-sm text-ink-muted")}>Loading variables</p>
				</CenteredState>
			);
		}

		if (isError) {
			/*
			 * A 404 here is a STALE capabilities answer, not a missing session:
			 * the gate above already established that this build advertises the
			 * surface, so the route itself is what is absent. That is the same
			 * family of sentence as the gate's, because it is the same fix.
			 */
			if (isSessionVariablesMissing(error)) {
				return (
					<CenteredState>
						<p className={cn("text-heading text-ink")}>
							Update the backend to read code memory.
						</p>
					</CenteredState>
				);
			}
			return (
				<CenteredState>
					<p className={cn("text-heading text-ink")}>
						Could not load variables
					</p>
					<p className={cn("max-w-80 text-body-sm text-ink-muted")}>
						The session's code memory could not be read. Check that Local
						Operator is running, then try again.
					</p>
				</CenteredState>
			);
		}

		if (data?.state === "unsupported") {
			return (
				<CenteredState>
					<p className={cn("text-heading text-ink")}>
						This chat cannot read code memory.
					</p>
				</CenteredState>
			);
		}

		if (variables.length === 0) {
			if (isBusy) {
				return (
					<CenteredState>
						<Spinner size="sm" />
						<p className={cn("text-body-sm text-ink-muted")}>Reading…</p>
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
						{kernelAbsent ? "No code memory yet" : "Nothing stored yet"}
					</p>
					<p className={cn("max-w-80 text-body-sm text-ink-muted")}>
						{kernelAbsent
							? "It fills in when code runs in this chat."
							: "When the agent runs code for you, the values it keeps around between steps show up here. You can add one yourself too."}
					</p>
					{kernelAbsent ? null : (
						<Button
							variant="secondary"
							size="sm"
							onClick={handleOpenCreateForm}
						>
							<Plus aria-hidden="true" />
							New variable
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
						<span className={cn("font-medium text-ink")}>Code memory</span>
						<span className={cn("mx-1.5 text-ink-dim")}>·</span>
						{variables.length}{" "}
						{variables.length === 1 ? "variable" : "variables"}
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
								<span className={cn("ml-1.5")}>Reading…</span>
							</>
						) : null}
					</p>
					<Button variant="ghost" size="sm" onClick={handleOpenCreateForm}>
						<Plus aria-hidden="true" />
						New
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
						title="Delete variable"
						message={
							<>
								Are you sure you want to delete the variable{" "}
								<strong className={cn("font-mono text-ink")}>
									{variableToDeleteKey}
								</strong>
								? This action cannot be undone.
							</>
						}
						confirmText="Delete"
						cancelText="Cancel"
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
