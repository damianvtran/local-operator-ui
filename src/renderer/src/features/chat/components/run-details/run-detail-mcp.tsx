/**
 * The MCP servers section of the run panel (`docs/run-sidebar.md` § 7).
 *
 * It exists because there was no robust way to see which MCP servers are
 * connected and which are broken: an expired grant surfaced nowhere the operator
 * looks, and the fix (`Grant account access`) lives on a settings page they had
 * no reason to open during a run. The panel is the live view over the session, so
 * a server whose sign-in has expired belongs on it.
 *
 * **The remedy is actionable in place, and this panel still does not own
 * configuration.** A problem row's remedy is a control where this surface can
 * carry it out — a browser sign-in, a reconnect, and `cancel` for a grant already
 * running — because those three are operations the BACKEND owns and runs. The
 * panel starts them, watches them in the read it already polls (`mcp.list`
 * returns `operations`) and cancels one; it never writes configuration, and no
 * add, remove, reload, scope or credential entry appears here. Every state this
 * control cannot fix keeps its sentence and names the surface that owns the
 * configuration (`settings/components/mcp-management-section.tsx`).
 *
 * The rule the old refusal protected is kept rather than repealed: there is still
 * ONE place that owns the confirmation, the scope and the error copy — the
 * confirmation is the shared `ConfirmationModal`, held once here rather than per
 * row, and both surfaces speak the same control words. What was refused before
 * was a second PLACE to get those facts wrong; what changed is that this section
 * now holds the same place's copy rather than a copy of its own. What this
 * section owes the reader instead is the REMEDY in words on the row that needs
 * it, because the two problem states need different actions and the word alone
 * does not say which.
 *
 * Encoding follows the other two sections: the state is said in a MARK and a
 * WORD, the mark is `aria-hidden` decoration, colour is spent on failure and on
 * nothing else (the dock band's own ink law), and the section has no cap — a cap
 * is an answer to an unbounded stream of children, not to the finite servers a
 * user configured.
 */

import { ConfirmationModal } from "@shared/components/common/confirmation-modal";
import { Button } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import {
	Check,
	CircleAlert,
	CircleDashed,
	CircleHelp,
	LoaderCircle,
	X,
} from "lucide-react";
import { useState } from "react";
import {
	type McpServerRow,
	mcpServersAreCold,
	mcpTally,
} from "./run-detail-model";
import type { McpRemedyControls } from "./use-mcp-remedy";

/**
 * One mark per state, ported by MEANING rather than by codepoint, exactly as the
 * roster's own table is, so the panel has one vocabulary rather than two. The
 * four wire states plus the cold facade's; anything else gets the unknown mark.
 */
const MCP_ICON = {
	connected: Check,
	connecting: LoaderCircle,
	"auth-required": CircleAlert,
	disconnected: X,
	cold: CircleDashed,
} as const;

/**
 * Ink per state. Failure is the only colour: `auth-required` is the state the
 * operator could not see, and `disconnected` is the other terminal one.
 *
 * The FALLBACK is the quietest ink, and that is `§ 7.3`'s refusal made visible:
 * an unrecognised word TAKES ATTENTION — it lights the dot and appears in the
 * trigger's label — while rendering quietly, because a renderer must not paint a
 * `danger` failure it cannot name. The failure this design prevents is a MISSED
 * problem rather than a spurious dot; but a red word this build cannot explain
 * reads as a crash, which is the confusion the section exists to remove.
 */
const MCP_INK: Record<string, string> = {
	connected: "text-ink-dim",
	connecting: "text-ink-muted",
	cold: "text-ink-dim",
	"auth-required": "text-danger",
	disconnected: "text-danger",
};

/** The mark for every word this build has not been taught. */
const MCP_UNKNOWN_ICON = CircleHelp;

/**
 * The app's own control words for the remedies this surface can carry out.
 *
 * The same words the Settings section uses, because one state must not acquire
 * two spellings (`§ 7.2` amended): the confirmation is the shared modal and the
 * controls speak the shared vocabulary.
 */
const MCP_CONTROL_WORD = {
	grant: "Grant account access",
	reconnect: "Reconnect",
} as const;

/**
 * What the row's action line says while a grant is in the backend's hands.
 *
 * `Waiting for your browser` is a statement about what is happening, not a
 * spinner: the runtime opens the browser itself (`mcp/auth.py:2317`, in the
 * redirect handler), so this surface's job is to say that it is waiting and to
 * offer the cancel that is the only thing it can usefully do.
 */
const MCP_GRANT_WORD = {
	running: "Waiting for your browser",
	failed: "Sign-in failed",
	cancelled: "Sign-in cancelled",
} as const;

/**
 * The one sentence for a sign-in the backend refused.
 *
 * Reached only from a 409 whose cause the probe could NOT attribute to a
 * transport that cannot do OAuth: printing the wire's own sentence would be the
 * unhelpful-copy class `branding.md` § 8 refuses, because the route replaces
 * every cause with one fixed string (`routes/desktop_lifecycle.py:148-155`).
 */
const MCP_REFUSED_WORD =
	"This server refused the sign-in. Check its configuration.";

/**
 * Where a server whose credentials this surface cannot set keeps them.
 *
 * A stdio child, or a config that declares another `auth.type`, can never
 * complete a browser flow (`server_rejects_oauth`), so the row keeps words and
 * names the surface that owns the `env`/`headers` map.
 */
const MCP_CREDENTIALS_WORD = "Manage this server's credentials in Settings";

/** The sentence form of a remedy, prefixed the way the row's prose lines are. */
const words = (label: string) => (
	<span
		className={cn("truncate text-ink-muted text-meta leading-4")}
		title={label}
	>
		{`— ${label}`}
	</span>
);

/**
 * The row's action line: the remedy as a control where this surface can carry it
 * out, and as the sentence that names the other surface where it cannot.
 *
 * The order is fixed and it is the reason a terminal operation can never be read
 * as the row's state:
 *
 * 1. a grant the backend says is `complete` clears the line — the next read calls
 *    the server `connected` and the tool count appears, and this surface never
 *    says a sign-in finished before the backend does;
 * 2. a grant that is `running`, `failed` or `cancelled` IS the line, with the
 *    cancel or the retry that belongs to it. The cancelled case appends the
 *    credential's fate, because `grants.py:168-175` records that a cancel between
 *    the grant's delete and its reconnect leaves the server with NO credential —
 *    "cancelled" alone would send the reader to a server that cannot connect;
 * 3. a refusal the surface has established replaces the control with its cause;
 * 4. otherwise the remedy itself: a link control, or the sentence for the states
 *    this surface cannot act on.
 *
 * The control is a `link`, never a filled button and never a clickable row: the
 * row's second line is 16px and a `size="sm"` box would take it to 28px, growing
 * every problem row's height budget (`§ 8`), while a row that lit up would promise
 * one action where two are possible. Disabled is a colour step, never opacity
 * (`branding.md` § 6).
 */
const McpActionLine = ({
	row,
	remedy,
	disabled,
	onPress,
}: {
	row: McpServerRow;
	remedy: McpRemedyControls;
	disabled: boolean;
	onPress: (row: McpServerRow) => void;
}) => {
	const grant = row.grant;
	if (grant?.status === "complete") return null;
	if (grant) {
		return (
			<span className={cn("flex min-w-0 items-baseline gap-2")}>
				<span
					className={cn("min-w-0 truncate text-ink-muted text-meta leading-4")}
				>
					{MCP_GRANT_WORD[grant.status]}
				</span>
				{grant.status === "cancelled" && grant.credentialRemoved && (
					<span
						className={cn(
							"min-w-0 truncate text-ink-muted text-meta leading-4",
						)}
					>
						The stored credential was removed.
					</span>
				)}
				<Button
					variant="link"
					size="sm"
					onClick={() =>
						grant.status === "running" ? remedy.cancel(grant.id) : onPress(row)
					}
				>
					{grant.status === "running" ? "Cancel" : "Try again"}
				</Button>
			</span>
		);
	}

	const refusal = remedy.refusalFor(row.name);
	if (refusal === "not-oauth") return words(MCP_CREDENTIALS_WORD);
	if (refusal === "refused") return words(MCP_REFUSED_WORD);

	if (!row.remedy) return null;
	if (row.remedy.kind === "words") return words(row.remedy.label);
	return (
		<Button
			variant="link"
			size="sm"
			disabled={disabled}
			/*
			 * The capture rig's handle on this control, which is how the confirm frame is
			 * taken by clicking the real link rather than by opening the dialog by hand
			 * (`run-details.stories.tsx`, `useClickAndWait`). The remedy KIND is the
			 * value, so a later story can address whichever one its fixture renders.
			 */
			data-mcp-remedy={row.remedy.kind}
			onClick={() => onPress(row)}
		>
			{MCP_CONTROL_WORD[row.remedy.kind]}
		</Button>
	);
};

const iconFor = (status: string) =>
	MCP_ICON[status as keyof typeof MCP_ICON] ?? MCP_UNKNOWN_ICON;

const inkFor = (status: string) => MCP_INK[status] ?? "text-ink-dim";

const McpRow = ({
	row,
	cold,
	remedy,
	controlDisabled,
	onPress,
}: {
	row: McpServerRow;
	cold: boolean;
	remedy: McpRemedyControls;
	/**
	 * Whether this row's control is disabled because another row's grant is
	 * running.
	 *
	 * The backend allows ONE grant per session (`mcp/desktop.py:158-160`), so
	 * leaving the other links live would let every press refuse with the opaque 409
	 * of `§ 3.3-2` — and a disabled control is a better answer than an unhelpful
	 * sentence. Derived from the READ's `operations` rather than from local state,
	 * so a grant started in the TUI or another conversation disables these too.
	 */
	controlDisabled: boolean;
	onPress: (row: McpServerRow) => void;
}) => {
	const Mark = iconFor(row.status);
	/*
	 * The row's height is pinned by the design (`§ 8`): 32px healthy, 48px on a
	 * problem row. `py-1.5` around a 20px line and a 16px remedy line lands both —
	 * the roster's compact height, then the to-do blocked row's second line — and
	 * it is set here rather than derived from the content so a wrapped name cannot
	 * silently reflow the section.
	 */
	return (
		/*
		 * No hover ground, and the ROW is still not a control: it holds two possible
		 * actions (grant, reconnect) and a status, so "click anywhere" would have no
		 * single meaning, and a row that lit up would promise one. The remedy is its
		 * own link on the second line (`§ 7.2` amended) — Tab reaches it, the row
		 * does not. The roster's rows DO take a hover ground (`§ 4`), because they
		 * open a page; these do not, and a list that lit up because its neighbour did
		 * would be the inheritance the design round is asked to watch for.
		 */
		<li className={cn("flex min-h-8 gap-2 px-3 py-1.5")}>
			<span className={cn("pt-0.5")}>
				{/* A cold row has no state to mark, so it renders no mark at all. */}
				{cold ? null : (
					<span
						aria-hidden={true}
						className={cn(
							"flex size-4 shrink-0 items-center justify-center",
							inkFor(row.status),
						)}
					>
						<Mark
							className={cn(
								"size-4",
								// Reduced motion: the glyph holds its frame. Shape already
								// distinguishes the states, which is why motion is a bonus.
								row.status === "connecting" && "motion-safe:animate-spin",
							)}
						/>
					</span>
				)}
			</span>
			<div className={cn("flex min-w-0 flex-1 flex-col")}>
				{/*
				 * `min-w-0` on the row so the NAME absorbs the pressure: `§ 8` makes
				 * it the only segment allowed to shrink, and the fixed three (word,
				 * count, scope) are `shrink-0` because the numbers rule forbids
				 * truncating a value mid-figure.
				 */}
				<div className={cn("flex min-w-0 items-baseline gap-2")}>
					<span
						className={cn(
							"min-w-0 flex-1 truncate text-body-sm text-ink leading-5",
						)}
						title={row.name}
					>
						{row.name}
					</span>
					{/*
					 * The status word is the WIRE'S, verbatim — including
					 * `auth-required`. A friendlier spelling in this one renderer would
					 * make the panel and the Settings page disagree about one server's
					 * state, and the backend's own docstring makes rendering the string
					 * directly the contract between them. The human meaning is carried
					 * by the hint on the second line.
					 *
					 * A COLD row has no word: one jargon word repeated N times is what
					 * the section refuses, and the cold line says it once instead.
					 */}
					{!cold && (
						<span className={cn("shrink-0 text-meta", inkFor(row.status))}>
							{row.status}
						</span>
					)}
					{row.toolCount !== null && (
						/*
						 * A connected server's reach, in the panel's numbers grammar: only
						 * ever rendered for `connected` (the model omits it otherwise), so
						 * it cannot claim tools a disconnected server is not serving.
						 */
						<span
							className={cn("shrink-0 tabular-nums text-meta text-ink-dim")}
						>
							{row.toolCount === 1 ? "1 tool" : `${row.toolCount} tools`}
						</span>
					)}
					{/*
					 * The qualifier, on line ONE: `owned_scope` (`global` / `project`) or
					 * the source file's basename. It is a qualifier rather than a
					 * subject, and giving it a line of its own makes every healthy row
					 * two lines tall for a fact the reader is not looking for — in the
					 * pane's scarcest direction.
					 */}
					{row.scope && (
						<span
							className={cn("shrink-0 text-meta text-ink-dim")}
							title={row.scope}
						>
							{row.scope}
						</span>
					)}
				</div>
				{/*
				 * The row's second and third lines, and they answer the two halves of the
				 * question this section exists for.
				 *
				 * The REMEDY comes first (`§ 7.2`): an indented, quiet line in the to-do
				 * section's blocked-row shape, because "what do I do about a server that is
				 * down" is the ask, and a row that answers only with a diagnosis leaves it
				 * unanswered for exactly the broken case (round 2, U2-2 — round 1's U1-8 had
				 * pushed the hint out entirely to make room for the wire's own failure text,
				 * which was a choice where the design asks for both).
				 *
				 * The DIAGNOSIS follows, on its own line, when the read carries one (`§ 7.2`,
				 * round 1's U1-8): the wire's failure text is the only thing that says WHY a
				 * server is down — for QA's `/nonexistent/definitely-not-a-binary` the remedy
				 * above cannot work, and the reader can only know that from this line. It is
				 * machine voice and VERBATIM, like every other exception this app prints: a
				 * paraphrased diagnosis is a claim nobody can check. `line-clamp-2` is the
				 * roster's own wrapped-failure bound (`§ 8`), and the `title` carries the
				 * whole string for the rare errno that outruns it.
				 *
				 * An unrecognised word gets neither: a fix for a word this build cannot name
				 * would be a guess, and a guess is worse than the quiet unknown row that does
				 * still take attention.
				 */}
				<McpActionLine
					row={row}
					remedy={remedy}
					disabled={controlDisabled}
					onPress={onPress}
				/>
				{row.errorText ? (
					<span
						className={cn(
							"line-clamp-2 font-mono text-ink-muted text-mono-sm leading-4",
						)}
						title={row.errorText}
					>
						{row.errorText}
					</span>
				) : null}
			</div>
		</li>
	);
};

export const RunDetailMcp = ({
	servers,
	remedy,
}: {
	servers: readonly McpServerRow[];
	/**
	 * The pane's remedy controls, threaded from the page (`chat-page.tsx`).
	 *
	 * A prop rather than a hook call here, so this section stays presentational and
	 * the pane renders from a fixture in the story set and from the real controls in
	 * the app.
	 */
	remedy: McpRemedyControls;
}) => {
	/*
	 * The confirmation is ONE dialog for the pane, held here rather than per row,
	 * and that is the part of the old refusal that still holds (§ 7.2 amended):
	 * there is one place that owns the confirmation, the scope and the error copy.
	 *
	 * The grant is the only remedy that confirms, because the backend's `reauth` is
	 * destructive before it is constructive — `run_grant` deletes the stored row and
	 * disconnects before it re-consents (`mcp/grants.py:193-211`), and the control
	 * refuses without `confirmed: true` (`mcp/desktop.py:59-60`). It is deliberately
	 * NOT danger-styled: the operation is recoverable by completing the consent, and
	 * `DangerButton` is for the destructive-without-remedy class.
	 */
	const [confirmTarget, setConfirmTarget] = useState<McpServerRow | null>(null);
	if (servers.length === 0) return null;
	const cold = mcpServersAreCold(servers);
	/*
	 * One grant per session, so while any row's grant is running every OTHER row's
	 * control is disabled. Read off the rows, which are folded from the read's own
	 * `operations`: a grant started anywhere — the TUI, another conversation — locks
	 * these controls too, and local state could not know that.
	 */
	const grantRunning = servers.some((row) => row.grant?.status === "running");
	const start = (row: McpServerRow) => {
		if (row.remedy?.kind === "grant") {
			setConfirmTarget(row);
			return;
		}
		remedy.press(row);
	};
	return (
		<section className={cn("flex flex-col pb-1.5")}>
			{cold ? (
				/*
				 * The cold header is the ONE section header in the pane that does not
				 * sit on one line, and the reason is that its right-hand slot holds a
				 * SENTENCE rather than a tally.
				 *
				 * Measured on `mcp-cold`: the label takes x874-943 and the sentence is
				 * given x954-1268 — 314px for a 56-character line that needs ~336px at
				 * this size, four characters short, so the ellipsis landed inside
				 * `checked` and the section's ONLY explanation of why it reports
				 * nothing was cut mid-word. Sharing the line cannot be fixed by a wider
				 * budget at 320px either: the sentence needs the row.
				 *
				 * So the sentence gets its own line, the full pane width, and WRAPS
				 * (`text-pretty`, no truncate) — which is what makes the 320px floor
				 * honest too. It stays the section's quiet ink: nothing here is wrong,
				 * so nothing here is loud.
				 */
				<div className={cn("flex flex-col gap-0.5 px-3 pt-2 pb-1")}>
					<span className={cn("text-meta text-ink-muted")}>MCP servers</span>
					<span className={cn("text-meta text-ink-dim")}>
						{mcpTally(servers)}
					</span>
				</div>
			) : (
				<div
					className={cn(
						"flex items-baseline justify-between gap-2 px-3 pt-2 pb-1",
					)}
				>
					<span className={cn("shrink-0 text-meta text-ink-muted")}>
						MCP servers
					</span>
					<span
						className={cn(
							"min-w-0 flex-1 truncate text-right text-meta text-ink-dim",
						)}
					>
						{mcpTally(servers)}
					</span>
				</div>
			)}
			<ul className={cn("flex flex-col")}>
				{servers.map((row) => (
					<McpRow
						key={row.name}
						row={row}
						cold={cold}
						remedy={remedy}
						controlDisabled={grantRunning && row.grant?.status !== "running"}
						onPress={start}
					/>
				))}
			</ul>
			{/*
			 * `Grant account access`, not `Confirm`: the button says what it does, and
			 * the message states both consequences — the browser opens, and a stored
			 * credential is replaced — because both are facts the reader would otherwise
			 * discover afterwards.
			 *
			 * A navigation NEVER lands here on its own (`§ 3.2`): the deep link reveals
			 * the row and stops, because opening a confirm dialog and a browser tab is an
			 * action nobody asked for.
			 */}
			<ConfirmationModal
				open={confirmTarget !== null}
				title={`Grant account access to ${confirmTarget?.name ?? ""}?`}
				message="Your browser opens to approve access. A stored credential for this server is replaced."
				confirmText="Grant account access"
				onConfirm={() => {
					if (confirmTarget) remedy.press(confirmTarget);
					setConfirmTarget(null);
				}}
				onCancel={() => setConfirmTarget(null)}
			/>
		</section>
	);
};
