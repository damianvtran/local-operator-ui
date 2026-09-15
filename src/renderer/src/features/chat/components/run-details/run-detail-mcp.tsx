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
 * now holds the same place's copy rather than a copy of its own.
 *
 * Encoding follows the other two sections: the state is said in a MARK and a
 * WORD, the mark is `aria-hidden` decoration, colour is spent on failure and on
 * nothing else (the dock band's own ink law), and the section has no cap — a cap
 * is an answer to an unbounded stream of children, not to the finite servers a
 * user configured.
 */

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
import { Link } from "react-router-dom";
import { McpAuthDialog } from "./mcp-auth-dialog";
import {
	MCP_SETTINGS_ACTION_LABEL,
	mcpServerSettingsRoute,
} from "./mcp-failure";
import {
	MCP_CONTROL_WORD,
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
		className={cn("truncate self-start text-ink-muted text-meta leading-4")}
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
 * 1. an operation that is `running` IS the line, with the cancel that belongs to
 *    it — a grant the backend has finished is NOT a state this line renders (`round
 *    1, finding 1`): the row's own status closes it, and a `complete` op left in
 *    the read for the rest of the session must not delete the remedy from a row
 *    that is a problem again;
 * 2. a grant that is `failed` or `cancelled` IS the line, with the retry that
 *    belongs to it. The cancelled case appends the credential's fate, because
 *    `grants.py:168-175` records that a cancel between the grant's delete and its
 *    reconnect leaves the server with NO credential — "cancelled" alone would send
 *    the reader to a server that cannot connect;
 * 3. a refusal the surface has established replaces the control with its cause;
 * 4. otherwise the remedy itself: a link control, or the sentence for the states
 *    this surface cannot act on.
 *
 * The control is a `link`, never a filled button and never a clickable row: the
 * row's second line is 16px and a `size="sm"` box would take it to 28px, growing
 * every problem row's height budget (`§ 8`), while a row that lit up would promise
 * one action where two are possible. Disabled is a colour step, never opacity
 * (`branding.md` § 6).
 *
 * Every shape this returns carries `self-start`.
 *
 * `button.tsx` gives every control `inline-flex justify-center`, which is right
 * inside a row and wrong inside the COLUMN this line is a child of: a stretched
 * flex item fills the content column and its own `justify-center` then centres the
 * label, so the link landed mid-pane while the sentence form and the to-do
 * blocked row it borrows its shape from both sit left at the name column — and,
 * worse, the whole empty second line became pressable, so a stray press on the
 * row's blank space started a grant that deletes the stored credential before it
 * re-consents (design review round 1, D1). `self-start` fixes the indent and
 * shrinks the target to the label in one class.
 *
 * The grant line WRAPS where the single-control forms do not. It is the one line
 * that can hold three things — the state word, the credential's fate and the
 * control — and round 1's D5 measured it at 369px inside the 375px column a 420px
 * pane gives, so at the pane's own 320px floor it must take a second line rather
 * than ellipsise mid-sentence beside a live control. `§ 8` budgets 48px for a row
 * with a remedy and up to 80px with the diagnosis, so the 64px it becomes is
 * inside the contract.
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
	/** The key remedy, as the control both the remedy and a refusal can reach. */
	const keyControl = (
		<Button
			variant="link"
			size="sm"
			disabled={disabled}
			data-mcp-remedy="key"
			className="self-start"
			onClick={() => onPress({ ...row, remedy: { kind: "key" } })}
		>
			{MCP_CONTROL_WORD.key}
		</Button>
	);
	const grant = row.grant;
	if (grant) {
		return (
			<span
				className={cn("flex min-w-0 flex-wrap items-baseline gap-2 self-start")}
			>
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

	const refusal = remedy.refusalFor(row);
	if (refusal === "not-oauth") {
		/*
		 * The probe said this transport cannot do OAuth, so the grant is not the fix
		 * — but a config that DECLARES credential fields can still be fixed here, by
		 * writing the credential its `${NAME}` reference points at. Where it declares
		 * none, the row keeps the sentence that names the surface that owns them.
		 */
		return row.keyNames.length > 0 ? keyControl : words(MCP_CREDENTIALS_WORD);
	}
	/*
	 * An unexplained refusal was the end of the road here: the sentence replaced
	 * the row's control and nothing else was offered, so a refusal that is not
	 * about OAuth at all — a config this app must not write, a server that needs
	 * reloading — left the reader with a diagnosis and no move (UX review round 2,
	 * U1). The sentence stays, because it is true and it is in the app's own words;
	 * beside it is the route to the row that owns everything this surface does not
	 * (`Reload`, `Remove` with its scope, the server's own `Sign in`).
	 */
	if (refusal === "refused")
		return (
			<span className={cn("flex min-w-0 flex-wrap items-baseline gap-2")}>
				{words(MCP_REFUSED_WORD)}
				<Button
					asChild
					variant="link"
					size="sm"
					className="self-start"
					data-mcp-failure-action="settings"
				>
					<Link to={mcpServerSettingsRoute(row.name)}>
						{MCP_SETTINGS_ACTION_LABEL}
					</Link>
				</Button>
			</span>
		);

	if (!row.remedy) return null;
	if (row.remedy.kind === "words") return words(row.remedy.label);
	if (row.remedy.kind === "key") return keyControl;
	return (
		<Button
			variant="link"
			size="sm"
			disabled={disabled}
			className="self-start"
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
			{/*
			 * The column's own gap is the section's 4px tier, and it is here because of
			 * the measurement in design review round 3 (D2): with no gap the name, the
			 * remedy and the diagnosis sat on one ~6px pitch against the section's own
			 * 24px rhythm, so the CLI incantation read as the second sentence of the
			 * remedy line rather than as the annotation under it.
			 */}
			<div className={cn("flex min-w-0 flex-1 flex-col gap-1")}>
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
					 * by the remedy on the second line.
					 *
					 * A COLD row has no word: one jargon word repeated N times is what
					 * the section refuses, and the cold line says it once instead.
					 */}
					{!cold && (
						/*
						 * The state word takes the NAME's type step and a medium weight, and
						 * that is D2's other half judged as ranking rather than as hue: the word
						 * that says why the row is red was the DARKEST text on it (5.4:1 against
						 * the remedy's 8.8:1 and the diagnosis's 7.5:1), so a problem row read as
						 * a disabled one. The role is unchanged — `danger` is the app's failure
						 * ink and `branding.md` § 2 owns it — and the step that fixed the ranking
						 * is the type scale's, because the alternative is inventing a colour.
						 */
						<span
							className={cn(
								"shrink-0 text-body-sm font-medium",
								inkFor(row.status),
							)}
						>
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
				 * pushed the remedy out entirely to make room for the wire's own failure text,
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
					/*
					 * The diagnosis is the QUIETEST line in the row (`ink-dim`), one step
					 * below the remedy's own sentence and two below the action: it is the
					 * machine's verbatim reason, not an instruction, and D2 measured it as the
					 * second-brightest text in the panel — above the state word it was
					 * supposedly qualifying.
					 */
					<span
						className={cn(
							"line-clamp-2 font-mono text-ink-dim text-mono-sm leading-4",
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
	/**
	 * Whether the read carries an operation that is still running.
	 *
	 * A prop rather than a fold over the rows, and that is the difference between
	 * locking the controls and not: a row exists only where the read carries a
	 * server, so an operation for a server that was removed or renamed still holds
	 * the backend's one-grant lock while no row would show it (code review round 1,
	 * finding 5). Derived at the page from the document's own `operations`
	 * (`mcpGrantInFlight`).
	 */
	grantRunning,
	remedy,
}: {
	servers: readonly McpServerRow[];
	grantRunning: boolean;
	/**
	 * The pane's remedy controls, threaded from the page (`chat-page.tsx`).
	 *
	 * A prop rather than a hook call here, so this section stays presentational and
	 * the pane renders from a fixture in the story set and from the real controls in
	 * the app.
	 */
	remedy: McpRemedyControls;
}) => {
	const [authTarget, setAuthTarget] = useState<McpServerRow | null>(null);
	if (servers.length === 0) return null;
	const cold = mcpServersAreCold(servers);
	/*
	 * One grant per session, so while one is running every OTHER row's control is
	 * disabled. `grantRunning` comes from the read's own operations rather than from
	 * these rows (see the prop), and every row's control is judged against it: the
	 * operation keeps the backend's lock for the whole session, wherever it came
	 * from — the TUI, another conversation, or a server this pane no longer lists.
	 */
	const disabledFor = (row: McpServerRow) =>
		grantRunning && row.grant?.status !== "running";
	const start = (row: McpServerRow) => {
		if (row.remedy?.kind === "grant" || row.remedy?.kind === "key") {
			setAuthTarget(row);
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
						controlDisabled={disabledFor(row)}
						onPress={start}
					/>
				))}
			</ul>
			{authTarget ? (
				<McpAuthDialog
					row={authTarget}
					action="reauth"
					remedy={remedy}
					onClose={() => setAuthTarget(null)}
				/>
			) : null}
		</section>
	);
};
