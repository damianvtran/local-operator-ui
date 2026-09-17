/**
 * Destination -> adapter table, and the host that mounts the active one.
 *
 * The backend registry carries every command's `destination`; this table is
 * the renderer's answer for each one. It is keyed by destination rather than
 * by command name so an alias (`/models`, `/config`) needs no entry, and so a
 * new registry row fails loudly here (unknown destination -> honest note)
 * instead of silently doing nothing.
 *
 * Four kinds of answer:
 *   - `picker`: a component from `destination-pickers` rendered in the host —
 *     either a decision picker or, for the read-only diagnostics, one of the
 *     panel views (`destination-pickers` re-exports them from `./panels`).
 *   - `machine-panel`: a view that describes the MACHINE rather than a
 *     conversation. Its context is a strict subset of `PickerContext`, which is
 *     what lets either presenter mount it: the chat pane when one is up (so a
 *     conversation on screen keeps its own scope) and the shell's `PanelOutlet`
 *     when none is. `/info`, `/usage` and `/analytics`.
 *   - `navigate`: an existing settings surface; the picker would duplicate it.
 *   - `direct`: an immediate local action with no UI (clear, exit, compact -
 *     the last one runs the owner command itself; see its row below).
 */

import type { FC } from "react";
import type { NativeDesktopAction } from "../../../../../shared/desktop-control-contract";
import type { CanonicalFrontendState } from "../../../../../shared/desktop-session-contract";
import type { ArgumentSource } from "../components/slash-argument-rows";
import { runMoveSessionFromDispatch } from "../move-session";
import type { MoveRunContext } from "../move-session";
import {
	AnalyticsView,
	ApprovalsPicker,
	AsidePicker,
	ContextView,
	CopyPicker,
	CredentialPicker,
	EffortPicker,
	FailoversView,
	FastPicker,
	ForkPicker,
	GoalPicker,
	HelpPalette,
	InfoView,
	LoginPicker,
	LogoutPicker,
	LoopPicker,
	ModelPicker,
	NewSessionPicker,
	type PickerContext,
	ProfilePicker,
	ReloadPicker,
	RenamePicker,
	ResumePicker,
	SessionView,
	SkillsPicker,
	StopPicker,
	ThemePicker,
	UsageView,
} from "./destination-pickers";
import { McpPicker } from "./mcp-picker";

/**
 * How a destination answers a command that CARRIES arguments.
 *
 * `present` (every entry but one): mount the picker (or run the direct action)
 * and let it consume the args - `/model gpt-5` opens the picker preselected, and
 * the user still confirms.
 *
 * `execute`: the args ARE the action, so they run through `runArgs` instead of
 * opening anything. `/move <path>` is the only case, and it is the TUI's rule in
 * the same words (`_cmd_move` applies the argument form and only opens the
 * chooser for the bare form). Carried on every member of the union below rather
 * than only on the picker kind, because the ONE entry that uses it is a `direct`
 * one: the real `/move` presents by focusing the composer's chip, and its
 * argument form still has to execute. `runArgs` lives on the entry rather than in
 * a name check in `slash-dispatch` so this table stays the one place that
 * answers "what does this destination mean", which is the stated reason it is
 * keyed by destination at all.
 */
type ArgsBehavior = {
	argsBehavior?: "present" | "execute";
	runArgs?: (context: MoveRunContext) => Promise<void>;
};

export type MachinePanelContext = {
	/** The registry's own action, with `args` — UsageView's provider filter. */
	action: NativeDesktopAction;
	/** "" when the shell presents it; the live id when the chat pane does. */
	sessionId: string;
	/** The conversation in front of the user, or null when there is none. */
	frontend: CanonicalFrontendState | null;
	onClose: () => void;
};

export type DestinationEntry =
	| ({
			kind: "picker";
			component: FC<PickerContext>;
			inline?: InlineArgumentSource;
	  } & ArgsBehavior)
	| ({
			kind: "machine-panel";
			component: FC<MachinePanelContext>;
	  } & ArgsBehavior)
	| ({
			kind: "navigate";
			route: (args: string, sessionId: string) => string;
	  } & ArgsBehavior)
	| ({
			kind: "direct";
			action: "clear" | "exit" | "focus-cwd-chip" | "compact";
	  } & ArgsBehavior);

/**
 * One argument list's rows, and how they may be acted on.
 *
 * Presence of this field is itself the statement "completing this command's
 * word inserts a trailing space and opens the list" — there is deliberately no
 * second flag for that, because the composer never submits on the completing
 * keystroke, so "does the space open a list" has exactly one behaviour per
 * destination and one place to say so.
 *
 * NOTE ON THE REGISTRY. This is NOT a second copy of the shared `arguments`
 * field. That field states what the TUI's KEYBOARD does — whether a space
 * offers a list and whether Enter on a bare word may also submit
 * (`autocomplete.py`) — and it remains the sole authority on the TUI. This
 * table states which HOST ROUTE a registry `destination` resolves to, which is
 * the same job `DESTINATIONS` already does for navigation, and the desktop's
 * Enter does not submit on a completion in any phase. Nothing here reads or
 * writes `metadata.arguments`; that field remains on the wire only for the
 * command row's hint in the command list.
 */
export type InlineArgumentSource = {
	/**
	 * Which source fills this list. The five entity ids are exactly the
	 * commands the backend's `command-entities` route serves
	 * (`desktop_catalogues.py:237-305`), and the `model`/`effort`/`approvals`/
	 * `team`/`agent` subset of what the backend advertises in
	 * `native_action.data.entities` (`desktop_commands.py:51-65`). `theme` is
	 * the one renderer-local source: the same `@shared/themes` table its dialog
	 * reads. `scripts/slash-row-format.test.mjs` pins the five ids against that
	 * advertised set, because a stale id renders an empty list rather than
	 * failing.
	 */
	source: InlineArgumentSourceId;
	/**
	 * A NAME followed by free text (`/team`, `/agent`). Enter/Tab on a row fills
	 * the name and a space and NEVER runs; the message is typed after it. See
	 * `NAME_ARGUMENT_COMMANDS` in `tui/widgets/editor.py:1964`.
	 */
	nameThenMessage: boolean;
	/**
	 * Whether picking a row with an unambiguous Enter RUNS the command rather
	 * than only completing it. Always false when `nameThenMessage` — for those,
	 * "a name is chosen" is not "run it", it is "ready for the message".
	 */
	runs: boolean;
};

export type InlineArgumentSourceId = ArgumentSource;

/**
 * The inline disposition of a registry `destination`, if it has one.
 *
 * Exported so the composer asks the table rather than keeping a second list of
 * command names: a new registry row with a destination that does not appear here
 * fails in exactly one place, which is the property this table was built for.
 */
export function inlineArgumentFor(
	destination: string,
): InlineArgumentSource | undefined {
	const entry = DESTINATIONS[destination];
	return entry?.kind === "picker" ? entry.inline : undefined;
}

const TeamPicker: FC<PickerContext> = (props) => (
	<ProfilePicker {...props} which="team" />
);
const AgentPicker: FC<PickerContext> = (props) => (
	<ProfilePicker {...props} which="agent" />
);

export const DESTINATIONS: Record<string, DestinationEntry> = {
	commands: { kind: "picker", component: HelpPalette },
	"window.close": { kind: "direct", action: "exit" },
	"transcript.clear": { kind: "direct", action: "clear" },
	"transcript.copy": { kind: "picker", component: CopyPicker },
	"sessions.new": { kind: "picker", component: NewSessionPicker },
	"sessions.reload": { kind: "picker", component: ReloadPicker },
	"sessions.resume": { kind: "picker", component: ResumePicker },
	"sessions.stop": { kind: "picker", component: StopPicker },
	"session.rename": { kind: "picker", component: RenamePicker },
	"session.fork": { kind: "picker", component: ForkPicker },
	/*
	 * `/move`: the one destination that presents by focusing an EXISTING control.
	 *
	 * It used to be a picker that hosted the composer's own chip in a modal dialog,
	 * and inside that dialog the chip's menu opened 620px tall at `y=-192` with
	 * `overflow-y: hidden` - two of the three ways to choose were unreachable by
	 * pointer and the focused row was off-screen (UX U2). The control the user
	 * already has does not have that problem, so the bare form focuses it and opens
	 * its menu in place (design § 5.2's alternative), while `/move <path>` still
	 * executes directly - one destination, one write path, and no popper inside a
	 * dialog.
	 */
	"session.move": {
		kind: "direct",
		action: "focus-cwd-chip",
		argsBehavior: "execute",
		runArgs: runMoveSessionFromDispatch,
	},
	"session.model": {
		kind: "picker",
		component: ModelPicker,
		inline: { source: "model", nameThenMessage: false, runs: true },
	},
	"session.effort": {
		kind: "picker",
		component: EffortPicker,
		inline: { source: "effort", nameThenMessage: false, runs: true },
	},
	"session.fast": { kind: "picker", component: FastPicker },
	"session.goal": { kind: "picker", component: GoalPicker },
	"session.loop": { kind: "picker", component: LoopPicker },
	"session.aside": { kind: "picker", component: AsidePicker },
	/*
	 * `/compact`: a DIRECT destination, the way `/clear` is, because there is no
	 * decision to present. It used to be a picker whose only job was to run the
	 * command and then wait for the canonical `compaction` record before it would
	 * say the pass had finished - a wait nothing retired when the record never
	 * landed, so the dialog stayed up over a finished pass and only the manual
	 * Close could dismiss it. The pass narrates itself now: the working line shows
	 * `compacting context` while it runs and the info line is painted when it
	 * settles, so the dialog had nothing left to say. `slash-dispatch.ts`'s direct
	 * branch owns the owner call and why a `native_action` for this destination
	 * can never mount a picker.
	 */
	"session.compact": { kind: "direct", action: "compact" },
	"session.approvals": {
		kind: "picker",
		component: ApprovalsPicker,
		inline: { source: "approvals", nameThenMessage: false, runs: true },
	},
	"session.context": { kind: "picker", component: ContextView },
	// `/session` used to answer "not available in the desktop app yet" because
	// this row was missing; the destination has existed all along.
	"session.diagnostics": { kind: "picker", component: SessionView },
	"session.failovers": { kind: "picker", component: FailoversView },
	"session.credential": { kind: "picker", component: CredentialPicker },
	"session.team": {
		kind: "picker",
		component: TeamPicker,
		inline: { source: "team", nameThenMessage: true, runs: false },
	},
	"session.agent": {
		kind: "picker",
		component: AgentPicker,
		inline: { source: "agent", nameThenMessage: true, runs: false },
	},
	appearance: {
		kind: "picker",
		component: ThemePicker,
		/*
		 * `runs: false` on purpose, unlike the other five. `/theme`'s destination
		 * resolves to a DIALOG, and a dialog opened by an inline pick is exactly
		 * the pattern rejected for `/model` (DESIGN §5.2): a modal that closes
		 * the list and hands focus back. So an unambiguous Enter completes the id
		 * and the next Enter runs the command the user already had, which is the
		 * same path typing `/theme <id>` takes. The LIST is inline; the apply
		 * path is unchanged.
		 */
		inline: { source: "theme", nameThenMessage: false, runs: false },
	},
	/*
	 * The three MACHINE panels, and why each one is in this kind.
	 *
	 * `/info` and `/analytics` are the two the operator's requirement names: both
	 * are pure reads — `/info` describes the install and every runtime on the
	 * machine, `/analytics` the ledger across every conversation — so neither may
	 * be refused for want of a conversation, and both must be viewable from a page
	 * that is not chat. `/usage` joins them because the codebase already treats it
	 * as session-free in one of its two doors: the palette offers "Provider usage"
	 * on a draft pane, and the dispatcher's own request path already passed it an
	 * empty session id. Leaving it a `picker` would be two doors disagreeing about
	 * one destination, which is the defect class this table exists to prevent.
	 */
	info: { kind: "machine-panel", component: InfoView },
	skills: { kind: "picker", component: SkillsPicker },
	usage: { kind: "machine-panel", component: UsageView },
	analytics: { kind: "machine-panel", component: AnalyticsView },
	"auth.login": { kind: "picker", component: LoginPicker },
	"auth.logout": { kind: "picker", component: LogoutPicker },
	// Existing surfaces: navigate, never duplicate.
	settings: {
		kind: "navigate",
		route: (args) =>
			args ? `/settings?filter=${encodeURIComponent(args)}` : "/settings",
	},
	"settings.search": {
		kind: "navigate",
		route: () => "/settings?section=backend&filter=web-search",
	},
	providers: { kind: "navigate", route: () => "/settings?section=providers" },
	accounts: { kind: "navigate", route: () => "/settings?section=credentials" },
	updates: { kind: "navigate", route: () => "/settings?section=updates" },
	mcp: { kind: "picker", component: McpPicker },
};

/**
 * Whether this destination addresses a conversation at all.
 *
 * ONE derivation, because two surfaces quote the same refusal: the dispatcher's
 * `!sessionId` gate and the composer's staged line, which prints the dispatcher's
 * own sentence as a promise about the next Enter. Two copies of this predicate
 * disagree the moment one of them learns about a machine panel — the composer
 * would promise a refusal the dispatcher no longer gives, or print one for a
 * command that then runs.
 *
 * `undefined` (and any destination the catalogue has no row for) answers `true`:
 * an unknown destination is refused for the same reason the dispatcher's gate
 * refuses one.
 */
export function destinationNeedsSession(
	destination: string | undefined,
): boolean {
	if (!destination) return true;
	return DESTINATIONS[destination]?.kind !== "machine-panel";
}

/**
 * The component for a MACHINE panel destination, or nothing if it is not one.
 *
 * The shell host's resolver. `PickerOutlet` answers the same question for the
 * pane by mapping the pane's `PickerContext` down to `MachinePanelContext`, and
 * both read the component from THIS table rather than from a list of names —
 * which is what keeps "what does this destination mean" one answer.
 */
export function machinePanelFor(
	destination: string,
): FC<MachinePanelContext> | undefined {
	const entry = DESTINATIONS[destination];
	return entry?.kind === "machine-panel" ? entry.component : undefined;
}

/** Mounts the adapter for the active presentation request. */
export const PickerOutlet: FC<{ context: PickerContext | null }> = ({
	context,
}) => {
	if (!context) return null;
	const entry = DESTINATIONS[context.action.destination];
	if (!entry) return null;
	if (entry.kind === "machine-panel") {
		const Component = entry.component;
		return (
			<Component
				key={`${context.action.destination}:${context.action.args}`}
				action={context.action}
				sessionId={context.sessionId}
				/*
				 * The ONE field the pane has and a machine panel must not: mapped down
				 * from the handle rather than passed, so the panel's contract stays a
				 * subset of the picker's. A machine panel renders its own notices in its
				 * body — `note` writes into a transcript, and a pane that is not on
				 * screen has none — so it is dropped here along with `commands`,
				 * `dispatch`, `rebind` and `draft`.
				 */
				frontend={context.canonical.frontend ?? null}
				onClose={context.onClose}
			/>
		);
	}
	if (entry.kind !== "picker") return null;
	const Component = entry.component;
	// Keyed by destination + args so a second `/model` after the first closes
	// mounts fresh state rather than reusing a settled picker.
	return (
		<Component
			key={`${context.action.destination}:${context.action.args}`}
			{...context}
		/>
	);
};
