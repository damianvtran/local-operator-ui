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
import type { DesktopFeature } from "../../../shared/api/local-operator/desktop-hooks";
import type { ChatTarget } from "../../../shared/api/local-operator/profile-hooks";
import type { ArgumentSource } from "../components/slash-argument-rows";
import { runMoveSessionFromDispatch } from "../move-session";
import type { MoveRunContext } from "../move-session";
import {
	AnalyticsView,
	ApprovalsPicker,
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
	/**
	 * The aside panel: attached to the composer, never mounted as a dialog.
	 *
	 * A kind of its own rather than a `picker`, because the difference is the one
	 * that mattered here: a picker is presented by `PickerHost`, which is a Radix
	 * MODAL — a focus trap around a dialog, exactly what made the composer
	 * unusable while `/btw` was open. The panel this kind stands for is an in-flow
	 * sibling of the composer box, so the renderer has to route it somewhere else
	 * than the presentation slot, and saying so in this table is what keeps "what
	 * does this destination mean" one answer (`slash-dispatch.ts` is the only
	 * reader).
	 */
	| ({ kind: "aside" } & ArgsBehavior)
	/**
	 * Aida's own conversation (`/aida`).
	 *
	 * A kind of its own because it is the one destination that addresses no
	 * conversation and yet does not act on the machine: it OPENS her session —
	 * resolved through the desktop route (`aida.open`'s handler in
	 * `slash-dispatch.ts`, which owns the open-then-send order) — and its trailing
	 * text becomes that conversation's next user message. That combination is why
	 * it cannot ride an existing kind: a `direct` action has no session to open, a
	 * `picker` has a component to mount (there is none), and every kind below
	 * treats a pane-less or draft pane as a refusal, which this one must not.
	 *
	 * IT LIVES IN THIS TABLE, and not as a name check in the dispatcher, for the
	 * reason the table's own header gives: `destinationNeedsSession` derives its
	 * answer from here, and a destination outside the table answers "needs a
	 * conversation" — which would have the composer promise a refusal ("Needs an
	 * open conversation; start one first.") for a command that then runs, the
	 * exact class of disagreement the predicate was centralised to prevent.
	 */
	| ({ kind: "aida" } & ArgsBehavior)
	| ({
			kind: "picker";
			component: FC<PickerContext>;
			inline?: InlineArgumentSource;
			/**
			 * This picker addresses no conversation; presentable on a pane with
			 * none (issue #625).
			 *
			 * The rows carrying it are the five `docs/design/panels-without-session.md`
			 * § 12.5 measured as session-free and set aside as "one table row each
			 * when they are wanted" — `/help`, `/theme`, `/login`, `/logout` and
			 * `/resume`; #625 is that wanting. It is a per-ROW opt-in rather than a
			 * widening of the whole kind because not every neighbour is
			 * session-free: `/skills`, `/mcp` and `/reload` read `sessionId`
			 * themselves, and this flag is a claim — "this one does not" — that
			 * only the measured rows may make. `destinationNeedsSession` below is
			 * its one reader, which is what keeps the dispatcher's gate, the
			 * composer's staged line, its Enter footer and the palette in
			 * agreement.
			 */
			sessionless?: true;
			/**
			 * This picker is answerable on a DRAFT pane, by STAGING the draft's
			 * identity (`/team`, `/agent` — issue #780).
			 *
			 * Unlike `sessionless` (which claims the row "reads no session"), this
			 * claims the row knows what to DO without one: on a pane with no
			 * conversation its list is read from the sessionless roster routes
			 * (`teams.list` / `profiles.list` — the reads the sidebar and the
			 * Agents page already make), and a pick routes to
			 * `stageDraft({kind, name})`, the same act as the sidebar's "New chat
			 * with <team>", instead of addressing a session that does not exist.
			 * The kind is the `ChatTarget` the stage writes, carried explicitly
			 * rather than derived from the destination string.
			 *
			 * READ BY the dispatcher's `!sessionId` branch (which presents the
			 * draft route before `destinationNeedsSession` can refuse it) and by
			 * the composer's pick path (`draftStageForSource` below). The
			 * predicate itself does NOT change: these destinations still address
			 * a conversation in the ordinary sense, which is what keeps the
			 * palette's route-does-this-need-a-chat question answered the same.
			 */
			draftIdentity?: ChatTarget["kind"];
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
			action:
				| "clear"
				| "exit"
				| "focus-cwd-chip"
				| "compact"
				/*
				 * The three conversation-level actions (`sessions.archive`,
				 * `sessions.unarchive`, `sessions.delete`). Each is a LOCAL act with no UI of
				 * its own: `archive`/`unarchive` write the store's optimistic op and offer an
				 * undo, and `request-delete` STAGES a candidate in the store rather than
				 * deleting anything - the confirmation dialog is the only thing in the app
				 * that sends `confirmed: true`.
				 */
				| "archive"
				| "unarchive"
				| "request-delete";
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
	 * (`desktop_catalogues.py:237-305`), the `model`/`effort`/`approvals`/
	 * `team`/`agent` subset of what the backend advertises in
	 * `native_action.data.entities` (`desktop_commands.py:51-65`). `theme` is
	 * the one renderer-local source: the same `@shared/themes` table its dialog
	 * reads. `providers`, `provider-accounts` and `mcp` are the SESSIONLESS
	 * backend sources (the census, the stored accounts and the MCP catalog).
	 * `scripts/slash-row-format.test.mjs` pins all three categories, because a
	 * stale id renders an empty list rather than failing.
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
	/**
	 * The capability this list is LICENSED by; absent means unconditional (the
	 * lists that predate capability negotiation). Resolved through
	 * `effectiveInlineArgument` (`slash-argument-rows.ts`) so a backend that
	 * does not advertise the feature sees no list, and every reader — the
	 * fetch, both footer lines and the pick gate — reads the one answer.
	 *
	 * The census and accounts lists are `provider_catalogue`; the MCP lists are
	 * `mcp_catalog` >= 2 (the same document gained `verbs` — the version floor
	 * lives in `INLINE_REQUIRED_VERSIONS`).
	 */
	requires?: DesktopFeature;
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
	/*
	 * Aida's row reaches her through the desktop route (`aida.status`/`aida.control`)
	 * rather than through anything the pane holds, because her conversation is not
	 * the pane's: `/aida` must open it from a conversation-less route as much as
	 * from another chat. No component and no args behavior — the dispatcher's own
	 * `kind === "aida"` arm owns the open-then-send order (see the kind's note).
	 */
	"aida.open": { kind: "aida" },
	/*
	 * `/help` on a sessionless pane (issue #625): it reads the command
	 * catalogue and nothing else, so the pane it was typed on is not an input —
	 * the palette IS the read.
	 */
	commands: { kind: "picker", component: HelpPalette, sessionless: true },
	"window.close": { kind: "direct", action: "exit" },
	"transcript.clear": { kind: "direct", action: "clear" },
	"transcript.copy": { kind: "picker", component: CopyPicker },
	"sessions.new": { kind: "picker", component: NewSessionPicker },
	"sessions.reload": { kind: "picker", component: ReloadPicker },
	/*
	 * `/resume` on a sessionless pane (issue #625): it lists every canonical
	 * session and reads the pane's id only to mark the CURRENT row — a pane
	 * with no conversation has no current row, and the pick is the very act of
	 * choosing one.
	 */
	"sessions.resume": {
		kind: "picker",
		component: ResumePicker,
		sessionless: true,
	},
	"sessions.stop": { kind: "picker", component: StopPicker },
	"session.rename": {
		kind: "picker",
		component: RenamePicker,
		/*
		 * `/rename` takes free text, so its list cannot be a chooser of titles —
		 * the app does not know what a conversation should be called. It offers the
		 * ONE thing a user could not guess: the `--refresh` flag, in a static
		 * spelling list (`slash-argument-rows.ts`'s `TITLE_REFRESH_ROWS`).
		 *
		 * `runs: true`, and this is the second half of the operator's report. The
		 * row's CLICK must perform the refresh rather than autofill the composer
		 * and wait for Enter, which is what `runs: true` buys: an argument row's
		 * click runs when its list says `runs` (`message-input.tsx`'s
		 * `handleSlashPick`), so the flag reaches the dispatcher as the command's
		 * argument in one gesture. It is NOT the `/theme` case (`runs: false`):
		 * there a run opens a DIALOG the user still has to commit, while here the
		 * run IS the outcome — nothing is left to confirm.
		 *
		 * The bare and titled forms are UNTOUCHED by this row. Bare `/rename` still
		 * presents `RenamePicker` as a form - answered by the BACKEND's empty-args
		 * rule (a `native_action` for the word with no arguments,
		 * `local_operator/server/routes/desktop_sessions.py`) and mounted by the
		 * dispatcher's `isNativeAction` branch; `PRESENT_DIRECTLY` holds
		 * `session.goal`/`session.context` and no rename - and `/rename some title`
		 * still sets that title. Only a pick of the flag row changes behaviour,
		 * because only there is there something to run without a name.
		 */
		inline: { source: "title-refresh", nameThenMessage: false, runs: true },
	},
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
	"session.aside": { kind: "aside" },
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
	/*
	 * The archive family, and why these destinations are `sessions.*` while every
	 * other session-scoped destination in this table is `session.*`: these three
	 * identifiers are the FROZEN wire contract's own - they arrive on the backend's
	 * command catalogue rows, which is the vocabulary this table exists to resolve -
	 * and renaming them here to match the neighbourhood would be this app disagreeing
	 * with the daemon about one string. The table's job is to resolve a destination,
	 * not to tidy it.
	 *
	 * All three are `direct`: none of them presents a control of its own. `/archive`
	 * and `/unarchive` are writes with one line of feedback and an undo offer, and
	 * `/delete`'s control is the confirmation dialog the pane already owns, which
	 * staging a candidate opens - a picker here would be a second dialog asking the
	 * same question in a different place.
	 */
	"sessions.archive": { kind: "direct", action: "archive" },
	"sessions.unarchive": { kind: "direct", action: "unarchive" },
	"sessions.delete": { kind: "direct", action: "request-delete" },
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
		draftIdentity: "team",
		inline: { source: "team", nameThenMessage: true, runs: false },
	},
	"session.agent": {
		kind: "picker",
		component: AgentPicker,
		draftIdentity: "agent",
		inline: { source: "agent", nameThenMessage: true, runs: false },
	},
	appearance: {
		kind: "picker",
		component: ThemePicker,
		/*
		 * `/theme` on a sessionless pane (issue #625): the component reads
		 * `onClose` and `action` and never the pane.
		 */
		sessionless: true,
		/*
		 * `runs: false` on purpose, unlike the other five. `/theme`'s destination
		 * resolves to a DIALOG, and a dialog opened by an inline pick is exactly
		 * the pattern rejected for `/model` (DESIGN §5.2): a modal that closes
		 * the list and hands focus back. So an unambiguous Enter completes the id
		 * and the next Enter runs the command the user already had, which is the
		 * same path typing `/theme <id>` takes. The LIST is inline; the apply
		 * path is unchanged - and since #676 that dialog is a CONFIRMATION when
		 * the argument names a theme (`ThemePicker` omits its grid and presents
		 * the result line), so the table is never re-presented as a second
		 * chooser for a choice the inline list already made.
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
	/*
	 * `/login` and `/logout` on a sessionless pane (issue #625): they read the
	 * provider grid and the stored accounts, never the conversation.
	 *
	 * THE INLINE LISTS come from the same provider registry the TUI's pickers
	 * read, over the sessionless routes (`provider_catalogue`'s licence: the
	 * census rows and the two lists land together). `/login` runs on a pick —
	 * choosing a provider IS the gesture, and its argument is the provider the
	 * dialog would have been opened for. `/logout` deliberately does NOT run:
	 * its rows remove a credential, the TUI's destructive gate only fires on
	 * the keyboard, and a pointer click bypasses that gate by design — so the
	 * per-list `runs: false` is the pointer's whole floor (spec §4.1).
	 */
	"auth.login": {
		kind: "picker",
		component: LoginPicker,
		sessionless: true,
		inline: {
			source: "providers",
			nameThenMessage: false,
			runs: true,
			requires: "provider_catalogue",
		},
	},
	"auth.logout": {
		kind: "picker",
		component: LogoutPicker,
		sessionless: true,
		inline: {
			source: "provider-accounts",
			nameThenMessage: false,
			runs: false,
			requires: "provider_catalogue",
		},
	},
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
	/*
	 * `/accounts` lists stored credentials, and the Providers section is where
	 * credentials live now: it is the same grid onboarding uses, documented as
	 * "one place for a provider's sign-in methods, states and stored
	 * credentials", and the section `/login` and `/logout` already land on.
	 *
	 * It pointed at `?section=credentials` until this branch deleted that
	 * section from `sectionRefs`; `settings-page`'s deep-link effect returns
	 * early on an unknown key, so `/accounts` stranded the user on `general`.
	 * The route must name a section key that exists in `sectionRefs`
	 *. `scripts/settings-section-routes.test.mjs` pins that for every
	 * `?section=` route in the tree, so a later deletion cannot re-open it.
	 *
	 * U4 (design/UX round 1): the landing is a sign-in grid rather than a plain
	 * credential LIST, so "List stored credentials" — the command's own label,
	 * published by the backend's slash catalogue and not owned here — sets an
	 * expectation the destination only partly meets. The route STAYS: the keys
	 * and the session-store secrets are what that grid's rows and API-key tabs
	 * are about, and no other section lists them. Re-wording the label is a
	 * backend change (`local-operator` `slash_commands.py`), deferred rather
	 * than faked here with a second name for one command.
	 */
	accounts: { kind: "navigate", route: () => "/settings?section=providers" },
	updates: { kind: "navigate", route: () => "/settings?section=updates" },
	mcp: {
		kind: "picker",
		component: McpPicker,
		/*
		 * The MCP catalog's own lists: the verbs, then their servers (the
		 * document's `verbs` is the same `mcp_catalog` v2 contract this list is
		 * licensed by). `runs: false` for the same reason `/logout`'s is — the
		 * source contains destructive rows (`remove`, `logout`, `reauth`), and a
		 * pointer pick may not run any of them (spec §4.1).
		 *
		 * THE ACCEPTED COST, recorded where the next reader will look for it
		 * (review round 1, R2): `runs: false` also strips `/mcp login` — a
		 * non-destructive verb — of the TUI's one-keystroke run on a single
		 * unambiguous match; Enter can only ever complete, even when the name is
		 * exact. Accepted on purpose: the pointer floor is a per-SOURCE bit, so
		 * keeping the run for login would need a per-row run flag; pointer safety
		 * outranks the extra keypress. Revisit only with that per-row flag —
		 * flipping this one is what §4.1 forbids.
		 */
		inline: {
			source: "mcp",
			nameThenMessage: false,
			runs: false,
			requires: "mcp_catalog",
		},
	},
};

/**
 * The stage a DRAFT PANE's pick of this inline list performs, if any.
 *
 * The composer's argument-list pick and the dispatcher's `!sessionId` branch
 * both mean the same act when they fire (issue #780): on a pane with no
 * conversation, choosing a team/agent row STAGES the draft's identity with
 * `stageDraft({kind, name})` — the sidebar's "New chat with <team>" path —
 * rather than completing a word for a command the pane then cannot run. What
 * makes a list eligible is the ROW's own `draftIdentity` opt-in; deriving the
 * map from the table (rather than switching on source names here) is what keeps
 * a second draft-capable row from needing a second edit beside this one.
 *
 * The composer keys its path on the INLINE SOURCE (that is the only handle its
 * pick carries — the popup's row names a value, not a destination), and an
 * inline list belongs to exactly one destination, so the two spellings cannot
 * drift while the table keeps one row per source.
 */
const DRAFT_STAGE_SOURCES = new Map<ArgumentSource, ChatTarget["kind"]>();
for (const entry of Object.values(DESTINATIONS)) {
	if (entry.kind !== "picker" || !entry.draftIdentity || !entry.inline)
		continue;
	DRAFT_STAGE_SOURCES.set(entry.inline.source, entry.draftIdentity);
}

export function draftStageForSource(
	source: ArgumentSource | undefined,
): ChatTarget["kind"] | undefined {
	return source ? DRAFT_STAGE_SOURCES.get(source) : undefined;
}

/**
 * Whether this destination addresses a conversation at all.
 *
 * ONE derivation, because several surfaces quote the same refusal: the
 * dispatcher's `!sessionId` gate, the composer's staged line (which prints the
 * dispatcher's own sentence as a promise about the next Enter), its Enter
 * footer, and the palette's routing. Two copies of this predicate disagree the
 * moment one of them learns about a session-free row — the composer would
 * promise a refusal the dispatcher no longer gives, or print one for a command
 * that then runs.
 *
 * `undefined` (and any destination the catalogue has no row for) answers `true`:
 * an unknown destination is refused for the same reason the dispatcher's gate
 * refuses one.
 */
export function destinationNeedsSession(
	destination: string | undefined,
): boolean {
	if (!destination) return true;
	const entry = DESTINATIONS[destination];
	if (!entry) return true;
	/*
	 * THREE EXEMPTIONS, and each is exempt for the same reason: it addresses no
	 * conversation. TWO KINDS — a machine panel describes the machine, and
	 * `/aida` (the `aida` kind) OPENS her conversation, so a pane without one is
	 * exactly the state it is written for rather than the refusal these callers
	 * promise — plus the `picker` rows carrying the per-row `sessionless`
	 * opt-in (issue #625): those were measured as reading no session and
	 * present with `""` on a pane with none. Keeping the answer on the table is
	 * what lets the dispatcher, the composer's two copy sites and the palette
	 * agree without a name list — see the predicate's own header for the failure
	 * the centralisation prevents.
	 */
	if (entry.kind === "machine-panel" || entry.kind === "aida") return false;
	return !(entry.kind === "picker" && entry.sessionless === true);
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
