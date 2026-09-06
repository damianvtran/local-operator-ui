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
 *   - `picker`: a component from `destination-pickers` rendered in the host.
 *   - `navigate`: an existing settings surface; the picker would duplicate it.
 *   - `direct`: an immediate local action with no UI (clear, exit).
 */

import type { FC } from "react";
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
	SkillsPicker,
	StopPicker,
	ThemePicker,
	UsageView,
} from "./destination-pickers";

export type DestinationEntry =
	| { kind: "picker"; component: FC<PickerContext> }
	| { kind: "navigate"; route: (args: string, sessionId: string) => string }
	| { kind: "direct"; action: "clear" | "exit" };

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
	"session.model": { kind: "picker", component: ModelPicker },
	"session.effort": { kind: "picker", component: EffortPicker },
	"session.fast": { kind: "picker", component: FastPicker },
	"session.goal": { kind: "picker", component: GoalPicker },
	"session.loop": { kind: "picker", component: LoopPicker },
	"session.aside": { kind: "picker", component: AsidePicker },
	"session.compact": { kind: "picker", component: CompactView },
	"session.approvals": { kind: "picker", component: ApprovalsPicker },
	"session.context": { kind: "picker", component: ContextView },
	"session.failovers": { kind: "picker", component: FailoversView },
	"session.credential": { kind: "picker", component: CredentialPicker },
	"session.team": { kind: "picker", component: TeamPicker },
	"session.agent": { kind: "picker", component: AgentPicker },
	appearance: { kind: "picker", component: ThemePicker },
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
	mcp: {
		kind: "navigate",
		route: (args) =>
			`/settings?section=integrations${args ? `&mcp=${encodeURIComponent(args)}` : ""}`,
	},
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
