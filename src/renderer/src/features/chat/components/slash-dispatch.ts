/**
 * Slash command dispatch for the composer.
 *
 * Submissions whose first token is `/word` are commands, not prompts: the
 * backend rejects slash text on the message endpoint with 422, and the
 * baseline bug was `/settings` reaching model chat and hanging. This hook is
 * the interception point — it returns true when it consumed the text, and the
 * caller's model path never runs.
 *
 * Every command is posted to the session command endpoint first: an owner
 * command returns the owner's real SlashResult (painted as a system line), an
 * interactive or native command returns a `native_action` presentation
 * request. That request is resolved through `pickers/picker-registry`: a
 * picker adapter mounts in the host, a navigate destination routes to the
 * existing settings surface, and the two direct actions (`/clear` view-only,
 * `/exit` detach-only) run here. An unknown command names the closest matches
 * so the user can fix the typo rather than guess.
 */

import { desktopResult } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	desktopKeys,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import type { CanonicalSessionHandle } from "@shared/hooks/use-canonical-session";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { v4 as uuidv4 } from "uuid";
import type { NativeDesktopAction } from "../../../../../shared/desktop-control-contract";
import type { DesktopCommandReceipt } from "../../../../../shared/desktop-session-contract";
import type { PickerContext } from "../pickers/destination-pickers";
import { DESTINATIONS } from "../pickers/picker-registry";
import { isNativeAction } from "../pickers/use-picker-backend";
import type { Message } from "../types/message";
import { commandBudgetRefusal } from "../utils/message-budget";
import type { SlashCommandMeta } from "./slash-commands";

type SlashDispatchOptions = {
	/** Canonical session the commands address. */
	sessionId: string | undefined;
	addMessage: (message: Message) => void;
	/** The canonical stream handle; adapters read frontend state from it. */
	canonical: CanonicalSessionHandle;
	/** Bind the current agent to another canonical session (resume/fork/new). */
	rebind: (sessionId: string) => void;
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

const SLASH_SUBMISSION = /^\/([A-Za-z]+)(?:\s([\s\S]*))?$/;

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

const PRESENT_DIRECTLY = new Set([
	"session.goal",
	"session.context",
	"session.compact",
]);

export function useSlashDispatch({
	sessionId,
	addMessage,
	canonical,
	rebind,
}: SlashDispatchOptions) {
	const navigate = useNavigate();
	const capabilities = useDesktopCapabilities();
	const commandsEnabled = desktopFeatureEnabled(capabilities.data, "commands");
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
	const closePicker = useCallback(() => setPicker(null), []);

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

	const dispatch = useCallback(
		async (text: string): Promise<SlashDispatchOutcome> => {
			const match = SLASH_SUBMISSION.exec(text.trim());
			if (!match) return "not-a-command";
			if (!commandsEnabled) return "not-a-command";
			const [, word, rawArgs] = match;
			const args = rawArgs?.trim() ?? "";
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

			// Direct and navigate destinations need no owner round trip; the
			// backend's native_action for them carries no fields either.
			if (entry?.kind === "direct") {
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
					dispatch: (line) => void dispatch(line),
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
					setPicker({
						action,
						spec,
						sessionId,
						canonical,
						commands,
						onClose: closePicker,
						note,
						dispatch: (line) => void dispatch(line),
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
		],
	);

	return { dispatch, picker, closePicker };
}
