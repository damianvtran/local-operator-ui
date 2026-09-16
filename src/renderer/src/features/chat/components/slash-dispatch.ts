/**
 * Slash command dispatch for the composer.
 *
 * Submissions whose first token is `/word` are commands, not prompts: the
 * backend rejects slash text on the message endpoint with 422, and the
 * baseline bug was `/settings` reaching model chat and hanging. This hook is
 * the interception point — it returns true when it consumed the text, and the
 * caller's model path never runs.
 *
 * WHAT IT IS HANDED, AND WHY IT IS NOT TEXT. `dispatch` takes a
 * `SlashCommandInvocation` — a name and its args, already split by
 * `planSlashSubmission` — and never a draft. It used to take the raw string and
 * ask `SLASH_SUBMISSION` whether the whole thing was a command, and that second
 * judgement is how a two-line draft whose caret was on line 2 got dispatched as
 * `/usage` with line 2 as its argument, the composer emptied, and nothing sent
 * to the model: the planner had correctly answered "prose", and this guard
 * overruled it (`[\s\S]*` reads a newline as the command/argument separator).
 * There is now no question left here that could disagree with the planner —
 * args cannot span lines because they were cut from the command's own line — so
 * a second whole-draft guard cannot be reintroduced without changing this
 * signature. See `slash-submit.ts` for the rule and where the split lives, and
 * `message-input.tsx`'s `applyPlan` for the composer side of the seam.
 *
 * Every command is posted to the session command endpoint first: an owner
 * command returns the owner's real SlashResult (painted as a system line), an
 * interactive or native command returns a `native_action` presentation
 * request. That request is resolved through `pickers/picker-registry`: a
 * picker adapter mounts in the host, a navigate destination routes to the
 * existing settings surface, and the direct actions run here (`/clear`
 * view-only, `/exit` detach-only, a bare `/move` focusing the composer's
 * own working-directory chip - resolved locally rather than by mounting a
 * dialog, because the control it opens already exists in the composer - and
 * `/compact`, which asks the owner to start a pass and mounts nothing at all).
 * An unknown command names the closest matches so the user can fix the typo
 * rather than guess.
 */

import { desktopResult } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	desktopKeys,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import type { CanonicalSessionHandle } from "@shared/hooks/use-canonical-session";
import {
	PANEL_REQUEST_TTL_MS,
	useChatPanelRequestStore,
} from "@shared/store/chat-panel-request-store";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { v4 as uuidv4 } from "uuid";
import type { NativeDesktopAction } from "../../../../../shared/desktop-control-contract";
import type { DesktopCommandReceipt } from "../../../../../shared/desktop-session-contract";
import type { DraftPickerDestination } from "../draft-selection";
import {
	MOVE_NOT_READY_REASON,
	MOVE_UNAVAILABLE_REASON,
	type MoveCommitOutcome,
	sessionMoveEnabled,
} from "../move-session";
import type {
	DraftPickerSession,
	PickerContext,
} from "../pickers/destination-pickers";
import { DESTINATIONS } from "../pickers/picker-registry";
import { isNativeAction } from "../pickers/use-picker-backend";
import type { Message } from "../types/message";
import { commandBudgetRefusal } from "../utils/message-budget";
import type { SlashCommandMeta } from "./slash-commands";
import type { SlashCommandInvocation } from "./slash-submit";

type SlashDispatchOptions = {
	/** Canonical session the commands address. */
	sessionId: string | undefined;
	addMessage: (message: Message) => void;
	/** The canonical stream handle; adapters read frontend state from it. */
	canonical: CanonicalSessionHandle;
	/** Bind the current agent to another canonical session (resume/fork/new). */
	rebind: (sessionId: string) => void;
	/**
	 * Put focus back in the composer.
	 *
	 * Only used when a picker's invoking control no longer exists on close; see
	 * `invoker` below for why that happens and what it broke.
	 */
	focusComposer?: () => void;
	/**
	 * The DRAFT pane's own selection, when this composer sits on a pane with no
	 * session yet.
	 *
	 * Present only where the backend can select for a draft. It is what the two
	 * chips that CAN open on a draft open: `/model` and `/effort` are commands that
	 * need a session to address, so a draft's pick cannot travel the command path
	 * at all — it travels this one, into the SAME pickers, reading and writing the
	 * pane's selection instead of a session's.
	 */
	draftPicker?: DraftPickerSession;
	/**
	 * Focus the composer's working-directory chip and open its menu.
	 *
	 * The bare `/move` form's effect, and the reason the destination entry is
	 * `direct` rather than a picker: the chip IS the chooser, so a dialog hosting a
	 * second one nested a dropdown inside a modal and lost two of its three ways to
	 * choose (UX U2's measurement), and the user reached the same control by typing
	 * `/move` as by clicking it.
	 */
	focusCwdChip?: () => void;
	/** Shares the composer's request latch, receipt and eval-history state. */
	moveSession: (path: string) => Promise<MoveCommitOutcome>;
	/**
	 * Whether a move can be asked for on this pane AT ALL, as the chip decides it.
	 *
	 * `sessionMoveEnabled` answers a question about the BACKEND; the chip's gate is
	 * that answer AND a session that is not still a draft. Both surfaces of this one
	 * write path have to ask the same two questions, or the chip can refuse with
	 * "its working directory can be moved as soon as it is live" while the typed form
	 * posts a move for the same session (agent review round 2, R-3). Absent means
	 * `true`, so a caller that has no pane readiness to report is not silently
	 * downgraded to the read-only answer.
	 */
	moveReady?: boolean;
};

/**
 * What the composer must do with the text it handed to `dispatch`.
 *
 * A boolean could not say this. `true` meant "consumed", which retires the
 * draft, and `false` meant "not a command", which sends the text to the model -
 * so a command that was refused BEFORE it ran had no honest answer: reporting
 * `true` discarded the user's text, and reporting `false` would have posted
 * `/theme <200,000 characters>` as a chat message. A 200,001-character argument
 * took the first of those and 200,001 characters of the user's paste were gone
 * (round 2, Q-7).
 *
 * `retained` is the missing third case: the line WAS a command, it was not run,
 * and the composer must keep the text so the user can shorten it and try again -
 * the same contract `use-message-input.ts:167` states for messages, where
 * admission and not the keypress is what retires a draft.
 */
export type SlashDispatchOutcome = "not-a-command" | "consumed" | "retained";

/**
 * The catalogue row for a destination, or a stand-in where the catalogue has none.
 *
 * A picker opened by a CHIP or by the COMMAND PALETTE arrives without a
 * `SlashCommandMeta`, and none is needed: no adapter reads `spec`, and
 * `PickerOutlet` routes on `action.destination`. The catalogue's own row is
 * preferred where it exists, so this is the same object typing the command would
 * have built; the stand-in keeps the two callers from depending on a command
 * surface they are not allowed to need — a draft's picker availability comes from
 * `draft_selection`, and the palette's rows are already gated on the pane.
 *
 * `destination` is a plain string rather than `DraftPickerDestination` because
 * these are no longer only the draft's two readings: the palette names any
 * picker destination (`info`, `usage`, `analytics`, `session.diagnostics`), and
 * the stand-in's name is looked up in a table instead of being inferred from
 * "is it the model one" — which answered `effort` for every destination that
 * was not `session.model`, including the four the palette can now name.
 */
function draftPickerSpec(
	destination: string,
	commands: SlashCommandMeta[] | undefined,
): SlashCommandMeta {
	const known = commands?.find(
		(command) => command.destination === destination,
	);
	if (known) return known;
	return {
		name: FALLBACK_SLASH_NAMES[destination] ?? destination,
		description: "",
		aliases: [],
		arguments: "optional",
		echo: true,
		consumes_prompt: false,
		destination,
		execution: "native",
	};
}

/**
 * The slash spelling of a destination whose catalogue row is not in hand.
 *
 * Only used when `commands.list` has not answered — a backend that cannot serve
 * the catalogue cannot present these panels either, so the name only has to be
 * right enough to appear in a message rather than to be typed.
 */
const FALLBACK_SLASH_NAMES: Record<string, string> = {
	"session.model": "model",
	"session.effort": "effort",
	info: "info",
	usage: "usage",
	analytics: "analytics",
	"session.diagnostics": "session",
};

function systemMessage(text: string, status?: Message["status"]): Message {
	return {
		id: uuidv4(),
		role: "system",
		message: text,
		timestamp: new Date(),
		status,
	};
}

/** Levenshtein-closest known commands, so a typo names what the user meant. */
function closestCommands(
	needle: string,
	commands: SlashCommandMeta[],
): string[] {
	const distance = (a: string, b: string): number => {
		const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
		for (let i = 1; i <= a.length; i++) {
			let prev = dp[0];
			dp[0] = i;
			for (let j = 1; j <= b.length; j++) {
				const current = dp[j];
				dp[j] = Math.min(
					dp[j] + 1,
					dp[j - 1] + 1,
					prev + (a[i - 1] === b[j - 1] ? 0 : 1),
				);
				prev = current;
			}
		}
		return dp[b.length];
	};
	return commands
		.map((command) => ({
			name: command.name,
			score: distance(needle, command.name),
		}))
		.sort((a, b) => a.score - b.score)
		.slice(0, 3)
		.map((entry) => `/${entry.name}`);
}

const PRESENT_DIRECTLY = new Set(["session.goal", "session.context"]);

export function useSlashDispatch({
	sessionId,
	addMessage,
	canonical,
	rebind,
	focusComposer,
	draftPicker,
	focusCwdChip,
	moveSession,
	moveReady,
}: SlashDispatchOptions) {
	const navigate = useNavigate();
	const capabilities = useDesktopCapabilities();
	const commandsEnabled = desktopFeatureEnabled(capabilities.data, "commands");
	/*
	 * Whether a move can be executed at all against this backend.
	 *
	 * Read here rather than inside the runner because the ANSWER changes what the
	 * user is told, not merely whether a request succeeds: with the route absent, a
	 * typed `/move <path>` must report the same thing the read-only chip does
	 * instead of spending a round trip to learn 404. The catalogue deliberately
	 * still offers `/move` on such a backend - the catalogue is the backend's own
	 * (`desktop_commands.command_catalogue`), and filtering it renderer-side would
	 * be a second source of truth about what a destination can do.
	 */
	const canMove = sessionMoveEnabled(capabilities.data);
	/*
	 * The pane's half of the gate: the capability says the backend can move a live
	 * session, `moveReady` says THIS session is live enough to move. "Not ready" is
	 * a different sentence from "cannot", and the difference is the whole of R-3.
	 */
	const paneReady = moveReady ?? true;

	const commandsQuery = useQuery({
		queryKey: desktopKeys.commands,
		queryFn: () =>
			desktopResult<{ commands: SlashCommandMeta[] }>({
				op: "commands.list",
			}).then((result) => result.commands),
		enabled: commandsEnabled,
		staleTime: 300_000,
	});
	// The one active presentation request. A new command replaces it; Esc or
	// Done clears it. Consumed once per command receipt, never per reconnect.
	const [picker, setPicker] = useState<PickerContext | null>(null);
	/**
	 * The control that opened the current picker, so Escape can give focus back.
	 *
	 * A picker opened by TYPING has the composer focused when it opens and the
	 * composer is still mounted when it closes, so focus lands somewhere useful
	 * without help. A picker opened by CLICKING a chip does not: the chip that
	 * invoked it can be replaced during the picker's life - the model and effort
	 * chips repaint from the canonical stream while the picker is open, the
	 * context chip happens not to - and Radix then restores focus to a detached
	 * node, which the browser resolves as BODY. Keyboard users landed at the
	 * document start and could not Tab back within 25 presses (round 1, U4).
	 *
	 * Recorded here rather than in the strip because this hook owns the open and
	 * close edges; the strip only knows about the open one.
	 */
	const invoker = useRef<HTMLElement | null>(null);
	const closePicker = useCallback(() => {
		setPicker(null);
		const origin = invoker.current;
		invoker.current = null;
		if (!origin) return;
		/*
		 * After the dialog has unmounted and Radix has done its own restoration,
		 * so this is the last word rather than a race with it. A node that was
		 * replaced while the picker was open is no longer in the document, and
		 * focusing it would be the same silent no-op that produces the defect -
		 * so the composer, which is always mounted, takes it instead.
		 */
		requestAnimationFrame(() => {
			if (origin.isConnected) origin.focus();
			else focusComposer?.();
		});
	}, [focusComposer]);

	// Receipts land in the transcript the user is looking at: the canonical
	// one when the session is live, the legacy chat store otherwise.
	const note = useCallback(
		(text: string, error = false) => {
			if (sessionId && canonical.status !== "unavailable") {
				canonical.addNote(text, error ? "error" : "info");
				return;
			}
			addMessage(systemMessage(text, error ? "error" : undefined));
		},
		[addMessage, canonical.addNote, canonical.status, sessionId],
	);

	/**
	 * Bare `/move`: hand the choice to the composer's own chip.
	 *
	 * Three things it does NOT do, each of them measured or decided rather than
	 * assumed:
	 *
	 *  - it does not post to the command endpoint. The request would only ask the
	 *    backend to ask this surface to open something it already owns, and the
	 *    destination table is the one place that answers "what does this mean".
	 *  - it does not mount a dialog. The picker that used to is gone: it hosted this
	 *    same chip, and inside its modal the chip's menu opened 620px tall at
	 *    `y=-192` with `overflow-y: hidden`, putting two of the three choosing
	 *    affordances out of pointer reach and the focused row out of sight (UX U2).
	 *  - it does not stay silent. A focus change with no words is a command that
	 *    appears to do nothing, so one line says where the choice happens - and it
	 *    names the argument form too, which is the shortcut for a user who already
	 *    knows the path.
	 */
	const presentCwdChip = useCallback(
		(command: string) => {
			if (!sessionId) {
				note(`/${command} needs an open conversation. Start one first.`, true);
				return;
			}
			if (!canMove) {
				// The same sentence the read-only chip carries, from the same constant:
				// a user who types the command and a user who clicks the chip are told
				// the same thing about the same backend.
				note(MOVE_UNAVAILABLE_REASON, true);
				return;
			}
			if (!paneReady) {
				// The chip's other refusal, for the same reason: its read-only reason is
				// MOVE_NOT_READY_REASON while the session is being created, and a typed
				// `/move` in that window must not do what the chip refuses (R-3).
				note(MOVE_NOT_READY_REASON, true);
				return;
			}
			note(
				"Choose the folder in the working directory chip above, or type /move <path> to move straight there.",
			);
			focusCwdChip?.();
		},
		[canMove, focusCwdChip, paneReady, note, sessionId],
	);
	const dispatch = useCallback(
		async (
			invocation: SlashCommandInvocation,
		): Promise<SlashDispatchOutcome> => {
			const { name: word, args } = invocation;
			if (!commandsEnabled) return "not-a-command";
			const commands = commandsQuery.data ?? [];
			const spec =
				commands.find((command) => command.name === word) ??
				commands.find((command) => command.aliases.includes(word));

			if (!spec) {
				const suggestions = closestCommands(word, commands);
				note(
					suggestions.length > 0
						? `Unknown command /${word}. Did you mean ${suggestions.join(", ")}? Type / for the full list.`
						: `Unknown command /${word}. Type / for the full list.`,
					true,
				);
				return "consumed";
			}

			const entry = DESTINATIONS[spec.destination];

			// A destination whose ARGUMENTS are the action runs them rather than opening
			// anything. `/move <path>` is the only one, and it is the TUI's own rule for
			// the same command (`_cmd_move` applies the argument form and only opens the
			// chooser for the bare form). Resolving the destination BEFORE posting saves
			// a round trip whose only answer would be "please now do the thing", and it
			// is why a path is never sent to the command endpoint - there, the runtime's
			// own slash dispatcher would answer `move` with its "run it from a
			// terminal" refusal, which is false about this command on this surface.
			//
			// This branch sits ABOVE the direct/navigate ones because it is about the
			// ARGUMENTS rather than about the kind: `/move <path>` executes even though
			// its destination is a `direct` entry, and testing the kind first would send
			// the path to the bare form's handler and drop it.
			if (entry && entry.argsBehavior === "execute" && args) {
				if (!sessionId) {
					note(
						`/${spec.name} needs an open conversation. Start one first.`,
						true,
					);
					return "consumed";
				}
				if (!canMove) {
					note(MOVE_UNAVAILABLE_REASON, true);
					return "consumed";
				}
				if (!paneReady) {
					// The chip's own refusal for this window, asked here too: `/move <path>`
					// used to consult the capability alone, so it posted a move for a session
					// the chip beside it was refusing to touch (agent review round 2, R-3).
					note(MOVE_NOT_READY_REASON, true);
					return "consumed";
				}
				if (entry.runArgs) {
					await entry.runArgs({
						sessionId,
						cwd: args,
						canonical,
						note,
						moveTo: moveSession,
					});
				} else {
					// Unreachable: the registry's one `execute` entry always carries its
					// runner. Named rather than silently dropped, because a destination that
					// says it executes and then does nothing is exactly the silent dead end
					// this table exists to make loud.
					note(
						`/${spec.name} is not available in the desktop app yet. Run it in the terminal with local-operator.`,
						true,
					);
				}
				return "consumed";
			}

			// Direct and navigate destinations need no owner round trip; the
			// backend's native_action for them carries no fields either.
			if (entry?.kind === "direct") {
				if (entry.action === "focus-cwd-chip") {
					presentCwdChip(spec.name);
					return "consumed";
				}
				if (entry.action === "compact") {
					/*
					 * `/compact`: the ONE direct destination that asks the owner to do
					 * something rather than acting on this surface. It posts the owner
					 * command the way every non-direct destination does, from here.
					 *
					 * WHY THIS CANNOT MOUNT A PICKER, which is the regression this
					 * change must not have: the destination table says `direct` for
					 * `session.compact`, so this block answers it and RETURNS — and the
					 * `setPicker` call site below, the one a `native_action` reaches, is
					 * never executed for this destination. The branch is keyed on the
					 * table's own `kind`, so the guarantee is structural rather than a
					 * second list of names kept in step with it.
					 */
					if (!sessionId) {
						note(
							`/${spec.name} needs an open conversation. Start one first.`,
							true,
						);
						return "consumed";
					}
					try {
						const receipt = await desktopResult<DesktopCommandReceipt>({
							op: "sessions.command",
							sessionId,
							requestId: uuidv4(),
							command: spec.name,
							args,
						});
						const result = receipt.result;
						if (isNativeAction(result)) {
							// A backend that still presents the pass as a dialog is asking
							// this surface for a control it no longer has. Reported rather
							// than mounted, and reported rather than swallowed: a command
							// that appears to do nothing is the failure mode this branch
							// exists to avoid.
							note(
								`/${spec.name} asked for a dialog this build does not have, so nothing ran. Run it in the terminal with local-operator.`,
								true,
							);
							return "consumed";
						}
						/*
						 * The receipt of a pass that STARTS is the terminal host's own
						 * optimistic notice (`compacting context…`), and it is deliberately
						 * NOT ported. The operator asked for the working line while the pass
						 * runs and the compaction info line when it settles; a note on top
						 * of both would announce the same thing a third time. A receipt that
						 * is not that notice IS the command's own answer — a refusal, or a
						 * crash reported before the canonical events could carry it — so it
						 * is reported like any other refusal.
						 */
						if (
							result.text &&
							!(result.kind === "notice" && result.style === "info")
						) {
							note(
								result.text,
								result.kind === "error" || result.style === "error",
							);
						}
					} catch (error) {
						note(
							`/${spec.name} could not run: ${
								error instanceof Error
									? error.message
									: "the backend refused it"
							}`,
							true,
						);
					}
					return "consumed";
				}
				if (entry.action === "clear") {
					// View-only by contract: history on disk is untouched.
					canonical.clearView();
					return "consumed";
				}
				// exit: close the window through main (detach-only; the backend
				// keeps every session's owner running). In the browser harness
				// there is no window to close, and the note says so honestly.
				if (window.api?.desktop?.closeWindow) {
					await window.api.desktop.closeWindow();
				} else {
					note(
						"Close this window to quit. Conversations keep running in the background.",
					);
				}
				return "consumed";
			}
			if (entry?.kind === "navigate") {
				navigate(entry.route(args, sessionId ?? ""));
				return "consumed";
			}

			if (!sessionId) {
				note(
					`/${spec.name} needs an open conversation. Start one first.`,
					true,
				);
				return "consumed";
			}

			// Owner commands whose bare form is a READ (goal shows the goal,
			// context shows the breakdown, compact starts a pass) present in the
			// host straight away: the adapter makes the same owner call and shows
			// the same answer, with the form or the live state beside it. Going
			// through the owner first would only paint the answer twice.
			if (!args && PRESENT_DIRECTLY.has(spec.destination)) {
				setPicker({
					action: {
						kind: "native_action",
						destination: spec.destination,
						session_id: sessionId,
						args: "",
						fields: [],
						data: {},
					},
					spec,
					sessionId,
					canonical,
					commands,
					onClose: closePicker,
					note,
					dispatch: (invocation) => void dispatch(invocation),
					rebind,
				});
				return "consumed";
			}

			// `/login <x>` and `/logout <x>` are validated by the backend against
			// the provider registry; `/credential <x>` is refused so a secret can
			// never land in command text. Everything else posts as typed.
			const commandArgs = spec.name === "credential" ? "" : args;
			// Weighed before admission for the same reason a message is: `args`
			// accepts 200,000 characters, and main's backstop 413 can only say "too
			// large" once the text is already gone from the composer.
			const refusal = commandBudgetRefusal(spec.name, commandArgs);
			if (refusal) {
				note(refusal, true);
				// Retained, not consumed: the command never ran, so the text the user
				// has to shorten must still be in the composer to shorten. Reporting
				// "consumed" here threw away the paste that caused the refusal and
				// left them advice they could not act on (round 2, Q-7).
				return "retained";
			}
			try {
				const receipt = await desktopResult<DesktopCommandReceipt>({
					op: "sessions.command",
					sessionId,
					requestId: uuidv4(),
					command: spec.name,
					args: commandArgs,
				});
				const result = receipt.result;
				if (isNativeAction(result)) {
					const action: NativeDesktopAction = result;
					const target = DESTINATIONS[action.destination];
					if (target?.kind === "navigate") {
						navigate(target.route(action.args, sessionId));
						return "consumed";
					}
					if (target?.kind === "direct" && target.action === "focus-cwd-chip") {
						// A backend that still presents `/move` as a native_action lands in the
						// same place as the locally resolved form: the destination table decides
						// what a destination MEANS, so both entry points reach one control. A
						// `picker` entry would be mounted here instead, which is why this is a
						// branch and not a name check in the table.
						presentCwdChip(spec.name);
						return "consumed";
					}
					if (!target) {
						// Names the command and the next action, never the routing id
						// behind it: "radient.mobile" is not something a user can act
						// on, and "this build" describes the app to its own user
						// (design D4, UX U8). Reaching this at all means a command was
						// offered that cannot be presented, which is a defect in the
						// catalogue rather than something the user did.
						note(
							`/${spec.name} is not available in the desktop app yet. Run it in the terminal with local-operator.`,
							true,
						);
						return "consumed";
					}
					invoker.current =
						document.activeElement instanceof HTMLElement
							? document.activeElement
							: null;
					setPicker({
						action,
						spec,
						sessionId,
						canonical,
						commands,
						onClose: closePicker,
						note,
						dispatch: (invocation) => void dispatch(invocation),
						rebind,
					});
					return "consumed";
				}
				if (result.text) {
					note(
						result.text,
						result.kind === "error" || result.style === "error",
					);
				} else if (result.kind === "block") {
					const data = result.data as {
						items?: [string, string][];
						title?: string;
					};
					if (Array.isArray(data.items)) {
						note(
							[data.title, ...data.items.map(([k, v]) => `${k}: ${v}`)]
								.filter(Boolean)
								.join("\n"),
						);
					}
				}
				// A team/agent attachment admits its consumed prompt once on the
				// backend; the renderer must not resubmit result.data.request.
				return "consumed";
			} catch (error) {
				note(
					`/${spec.name} could not run: ${
						error instanceof Error ? error.message : "the backend refused it"
					}`,
					true,
				);
				// The command did not run, whatever refused it, so the composer keeps
				// the line. This is the same rule messages follow - admission retires a
				// draft, a keypress does not - and it is what makes "could not run"
				// recoverable: a transport refusal, a dropped backend or a schema parse
				// all leave the text there to retry or edit (round 2, Q-7).
				return "retained";
			}
		},
		[
			commandsEnabled,
			commandsQuery.data,
			sessionId,
			note,
			navigate,
			canonical,
			rebind,
			closePicker,
			canMove,
			paneReady,
			moveSession,
			presentCwdChip,
		],
	);

	/**
	 * Run a command the user did not type, and never fail silently.
	 *
	 * `dispatch` is written for the COMPOSER, where "not-a-command" means "the
	 * command surface is off, so this is ordinary text". A chip has no such next
	 * step: it is only ever a command, so the same return value means the command
	 * did not run and nothing anywhere will say so. That is exactly what happened
	 * with the backend down - `commandsEnabled` is false while capabilities are
	 * unreachable, so clicking a chip returned "not-a-command" into a `void`
	 * and the user watched a dead control for 16 seconds while typing `/model`
	 * in the same state explained the failure and offered a retry (round 1, U2).
	 *
	 * The note is the composer's own error idiom, not a second one, so the chip
	 * and the typed command report through the same surface.
	 *
	 * It RETURNS the outcome as well as reporting it. A caller that spliced a
	 * command token out of a draft needs to know whether it ran before deciding
	 * what the composer should hold afterwards — and that decision must not come
	 * with a second copy of this sentence (see `message-input.tsx`).
	 */
	const dispatchFromControl = useCallback(
		async (
			invocation: SlashCommandInvocation,
		): Promise<SlashDispatchOutcome> => {
			const outcome = await dispatch(invocation);
			if (outcome === "not-a-command") {
				note(
					"The backend could not complete this request. Check its connection and try again.",
					true,
				);
			}
			return outcome;
		},
		[dispatch, note],
	);

	/**
	 * Open a reading's picker for a NEW conversation pane.
	 *
	 * A draft's chips cannot travel the command path: `/model` and `/effort` are
	 * owner commands, and `dispatch` refuses every picker destination without a
	 * session (the `!sessionId` branch above), which is correct — there is no owner
	 * to address. This opens the SAME two adapters with the pane's own selection
	 * attached instead, so the app still has exactly one model list, one effort
	 * list and one picker implementation.
	 *
	 * The invoking chip is recorded exactly as the command path records it, so
	 * Escape returns focus to the control that opened the dialog (round 1, U4): a
	 * chip is a control for a keyboard user too.
	 */
	const openDraftPicker = useCallback(
		(destination: DraftPickerDestination) => {
			if (!draftPicker) return;
			invoker.current =
				document.activeElement instanceof HTMLElement
					? document.activeElement
					: null;
			setPicker({
				action: {
					kind: "native_action",
					destination,
					// Empty, not a session: this pick addresses the pane's draft, and the
					// adapters' draft branches never read this field.
					session_id: "",
					args: "",
					fields: [],
					data: {},
				},
				spec: draftPickerSpec(destination, commandsQuery.data),
				sessionId: "",
				canonical,
				commands: commandsQuery.data ?? [],
				onClose: closePicker,
				note,
				dispatch: (invocation) => void dispatch(invocation),
				rebind,
				draft: draftPicker,
			});
		},
		[
			canonical,
			closePicker,
			commandsQuery.data,
			dispatch,
			draftPicker,
			note,
			rebind,
		],
	);

	/*
	 * A panel asked for from OUTSIDE this pane — the command palette.
	 *
	 * The palette owns no picker: `/info`, `/usage`, `/analytics` and `/session`
	 * are destinations whose adapters need this pane's session handle, command
	 * catalogue and rebind path, so the palette writes a REQUEST and this hook —
	 * the one owner of the presentation slot — consumes it exactly the way a typed
	 * command is consumed. Same destinations table, same adapters, same close
	 * path; the palette's whole contribution is naming one.
	 *
	 * Two deliberate details:
	 *
	 * - The request is retired BEFORE it is acted on. `consumePanel` matches on the
	 *   nonce, so a newer request raised while this effect ran is not cleared by
	 *   it; retiring first is what makes the panel a one-shot rather than a state
	 *   this pane re-opens on every render.
	 * - An EXPIRED request is dropped without acting. Nothing can consume a request
	 *   while no chat pane is mounted, and the palette's own navigation is what
	 *   mounts one — so an old request means the pane never arrived, and acting on
	 *   it later would open a panel the user asked for in another context with
	 *   nothing on screen to explain it (see the store's TTL note).
	 */
	const panelRequest = useChatPanelRequestStore((state) => state.request);
	const consumePanelRequest = useChatPanelRequestStore(
		(state) => state.consumePanel,
	);
	useEffect(() => {
		if (!panelRequest) return;
		consumePanelRequest(panelRequest.nonce);
		if (Date.now() - panelRequest.requestedAt > PANEL_REQUEST_TTL_MS) return;
		const target = DESTINATIONS[panelRequest.destination];
		if (target?.kind !== "picker") return;
		/*
		 * No invoking control: the row that asked for this closed with the palette,
		 * and the palette restores focus to its own door. Leaving a stale element in
		 * `invoker` would send Escape's focus somewhere unrelated.
		 */
		invoker.current = null;
		setPicker({
			action: {
				kind: "native_action",
				destination: panelRequest.destination,
				// Empty on a draft pane, which the two session-scoped panels are never
				// offered from; `info` and `usage` do not read it.
				session_id: sessionId ?? "",
				args: "",
				fields: [],
				data: {},
			},
			spec: draftPickerSpec(panelRequest.destination, commandsQuery.data),
			sessionId: sessionId ?? "",
			canonical,
			commands: commandsQuery.data ?? [],
			onClose: closePicker,
			note,
			dispatch: (invocation) => void dispatch(invocation),
			rebind,
		});
	}, [
		panelRequest,
		consumePanelRequest,
		sessionId,
		canonical,
		commandsQuery.data,
		closePicker,
		note,
		dispatch,
		rebind,
	]);

	return {
		dispatch,
		dispatchFromControl,
		picker,
		closePicker,
		openDraftPicker,
		note,
	};
}
