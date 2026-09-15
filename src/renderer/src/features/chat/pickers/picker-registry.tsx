/**
 * Destination -> adapter table, and the host that mounts the active one.
 *
 * The backend registry carries every command's `destination`; this table is
 * the renderer's answer for each one. It is keyed by destination rather than
 * by command name so an alias (`/models`, `/config`) needs no entry, and so a
 * new registry row fails loudly here (unknown destination -> honest note)
 * instead of silently doing nothing.
 *
 * Three kinds of answer:
 *   - `picker`: a component from `destination-pickers` rendered in the host —
 *     either a decision picker or, for the read-only diagnostics, one of the
 *     panel views (`destination-pickers` re-exports them from `./panels`).
 *   - `navigate`: an existing settings surface; the picker would duplicate it.
 *   - `direct`: an immediate local action with no UI (clear, exit).
 */

import type { FC } from "react";
import type { ArgumentSource } from "../components/slash-argument-rows";
import {
	AnalyticsView,
	ApprovalsPicker,
	AsidePicker,
	CompactView,
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

export type DestinationEntry =
	| {
			kind: "picker";
			component: FC<PickerContext>;
			inline?: InlineArgumentSource;
	  }
	| { kind: "navigate"; route: (args: string, sessionId: string) => string }
	| { kind: "direct"; action: "clear" | "exit" };

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
	"session.compact": { kind: "picker", component: CompactView },
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
	info: { kind: "picker", component: InfoView },
	skills: { kind: "picker", component: SkillsPicker },
	usage: { kind: "picker", component: UsageView },
	analytics: { kind: "picker", component: AnalyticsView },
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

/** Mounts the adapter for the active presentation request. */
export const PickerOutlet: FC<{ context: PickerContext | null }> = ({
	context,
}) => {
	if (!context) return null;
	const entry = DESTINATIONS[context.action.destination];
	if (!entry || entry.kind !== "picker") return null;
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
