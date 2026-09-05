/**
 * Slash command dispatch for the composer.
 *
 * Submissions whose first token is `/word` are commands, not prompts: the
 * backend rejects slash text on the message endpoint with 422, and the
 * baseline bug was `/settings` reaching model chat and hanging. This hook is
 * the interception point — it returns true when it consumed the text, and the
 * caller's model path never runs.
 *
 * Owner commands go to the session command endpoint; native destinations act
 * locally (navigation, transcript clear, pickers). Interactive commands with
 * no argument resolve their backend `native_action` presentation request and
 * hand it to the picker host. An unknown command names the closest matches so
 * the user can fix the typo rather than guess.
 */

import { desktopResult } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	desktopKeys,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { useChatStore } from "@shared/store/chat-store";
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { v4 as uuidv4 } from "uuid";
import type { Message } from "../types/message";
import type { SlashCommandMeta } from "./slash-commands";

type SlashDispatchOptions = {
	sessionId: string | undefined;
	addMessage: (message: Message) => void;
};

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

/** Destinations that act in the renderer without a backend command call. */
const LOCAL_DESTINATIONS: Record<string, string> = {
	settings: "/settings",
	"settings.search": "/settings?filter=web-search",
	appearance: "/settings?section=appearance",
	providers: "/settings?section=backend",
	accounts: "/settings?section=credentials",
	updates: "/settings?section=updates",
};

export function useSlashDispatch({
	sessionId,
	addMessage,
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
	const clearMessages = useChatStore((state) => state.clearConversation);

	return useCallback(
		async (text: string): Promise<boolean> => {
			const match = SLASH_SUBMISSION.exec(text.trim());
			if (!match) return false;
			if (!commandsEnabled) return false;
			const [, word, rawArgs] = match;
			const args = rawArgs?.trim() ?? "";
			const commands = commandsQuery.data ?? [];
			const spec =
				commands.find((command) => command.name === word) ??
				commands.find((command) => command.aliases.includes(word));

			if (!spec) {
				const suggestions = closestCommands(word, commands);
				addMessage(
					systemMessage(
						suggestions.length > 0
							? `Unknown command /${word}. Did you mean ${suggestions.join(", ")}? Type / for the full list.`
							: `Unknown command /${word}. Type / for the full list.`,
						"error",
					),
				);
				return true;
			}

			if (spec.arguments === "required" && !args) {
				addMessage(
					systemMessage(
						`/${spec.name} needs a value. ${spec.description}`,
						"error",
					),
				);
				return true;
			}

			// Local destinations act here. `/settings` is the canonical case: it
			// must NEVER reach the model path.
			const localRoute = LOCAL_DESTINATIONS[spec.destination];
			if (localRoute) {
				navigate(localRoute);
				return true;
			}

			if (spec.destination === "transcript.clear") {
				// View-only by contract: history on disk is untouched.
				if (sessionId) clearMessages(sessionId);
				return true;
			}

			if (spec.destination === "window.close") {
				addMessage(
					systemMessage(
						"Close the window to quit. Detached conversations keep running.",
					),
				);
				return true;
			}

			if (!sessionId) {
				addMessage(
					systemMessage(
						`/${spec.name} needs an open conversation. Start one first.`,
						"error",
					),
				);
				return true;
			}

			try {
				const receipt = await desktopResult<{
					command: string;
					result: {
						kind: string;
						text?: string;
						style?: string;
						destination?: string;
						data?: Record<string, unknown>;
					};
				}>({
					op: "sessions.command",
					sessionId,
					requestId: uuidv4(),
					command: spec.name,
					args,
				});
				const result = receipt.result;
				if (result.kind === "native_action") {
					// A presentation request: the picker host renders fields and
					// submits through data.submit. Until a destination-specific host
					// exists, the receipt is an honest note, never a fake success.
					const destination = result.destination ?? spec.destination;
					addMessage(
						systemMessage(
							`/${spec.name} opens ${destination}. ${spec.description}`,
						),
					);
					return true;
				}
				if (result.text) {
					addMessage(
						systemMessage(
							result.text,
							result.style === "error" ? "error" : undefined,
						),
					);
				}
				// A team/agent attachment admits its consumed prompt once on the
				// backend; the renderer must not resubmit result.data.request.
				return true;
			} catch (error) {
				addMessage(
					systemMessage(
						`/${spec.name} could not run: ${
							error instanceof Error ? error.message : "the backend refused it"
						}`,
						"error",
					),
				);
				return true;
			}
		},
		[
			commandsEnabled,
			commandsQuery.data,
			sessionId,
			addMessage,
			navigate,
			clearMessages,
		],
	);
}
