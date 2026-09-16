/**
 * The chat sidebar's Agents section: who is listed, and the built-ins shortcut.
 *
 * ## Why this surface needed a story at all
 *
 * `profiles.list` deliberately includes the packaged profiles beside the user's
 * own, so a fresh install listed six built-ins under a heading that reads
 * "Agents" — the section said "agents you have" while showing agents the user
 * had never installed, and there was nothing that told the two apart. The change
 * is a grouping, an empty state and an action, and all three are RENDERINGS: a
 * green assertion about `source === "builtin"` would not show whether a reader
 * can tell an installed role from an available one.
 *
 * ## What is stubbed, and what is not
 *
 * The real `ChatSidebar`, its real `useProfiles` query, the real empty state and
 * the real `InstallBuiltinAgents` action — the same component the agents page
 * mounts, so the two mount points cannot disagree about what "already present"
 * means. Below them, `window.api.desktop.request` is stubbed with the two
 * catalogue reads this section makes plus `profiles.install`, whose per-name
 * answers the summary is built from.
 *
 * ## What a frame here does NOT prove
 *
 * That the local backend answers `profiles.install` with `already_installed` —
 * that field is additive and a backend older than it omits it (read as
 * "installed", which `install-builtin-agents.tsx` explains). The 409 path is a
 * fixture shaped like the route's own refusal (`install_seed`'s
 * `NameTakenError`), not a live call. Whether the real server copies the seed is
 * QA's job against a real app.
 */

import { cn } from "@shared/lib/utils";
import type { Meta, StoryObj } from "@storybook/react";
import { screen, userEvent } from "@storybook/test";
import type { DesktopResponse } from "../../../../../shared/desktop-contract";
import { ChatSidebar } from "./chat-sidebar";

/* --------------------------------------------------------------- the bridge */

type BridgeRequest = {
	op: string;
	name?: string;
};

/** One row of `profiles.list`, in the wire's own field names. */
type WireProfile = {
	name: string;
	kind: "role" | "specialist";
	source: "builtin" | "installed" | "custom";
	agent_id: string | null;
	description: string;
	tools: string[] | null;
	effort: string | null;
	delegate: boolean;
	seed_origin?: string | null;
	divergent_fields?: string[];
};

const profile = (
	name: string,
	kind: "role" | "specialist",
	source: WireProfile["source"],
): WireProfile => ({
	name,
	kind,
	source,
	agent_id: source === "builtin" ? null : `agent-${name}`,
	description: `${name} — reusable instructions for this role.`,
	tools: null,
	effort: null,
	delegate: name === "manager",
	seed_origin: source === "installed" ? name : null,
	divergent_fields: [],
});

/**
 * The six packaged profiles, named as `local_operator/agent_seeds/` names them.
 * A built-in is a row the user has NOT installed: `source` is `"builtin"` and
 * `agent_id` is null.
 */
const BUILTINS = [
	profile("coder", "role", "builtin"),
	profile("reviewer", "role", "builtin"),
	profile("designer", "role", "builtin"),
	profile("architect", "role", "builtin"),
	profile("qa-tester", "role", "builtin"),
	profile("manager", "role", "builtin"),
];

type InstallBehaviour = {
	/** How each name answers. Anything unnamed succeeds. */
	answers?: Record<string, "ok" | "already" | "collision">;
	/** Never settle the first install, so the progress line is the subject. */
	hold?: boolean;
};

const installBridge = ({
	profiles,
	install,
}: {
	profiles: WireProfile[];
	install?: InstallBehaviour;
}) => {
	const { answers = {}, hold = false } = install ?? {};
	let installed = 0;
	const ok = <T,>(result: T): DesktopResponse => ({ status: 200, body: { result } });

	const bridge = async (request: BridgeRequest): Promise<DesktopResponse> => {
		switch (request.op) {
			case "capabilities":
				return ok({
					desktop_contract: 1,
					desktop_available: true,
					desktop_auth: "bearer",
					features: {
						session_catalogue: 2,
						profile_catalogue: 1,
						team_catalogue: 1,
					},
				});
			case "sessions.list":
				return ok({ sessions: [], truncated: false });
			case "teams.list":
				return ok({ teams: [] });
			case "profiles.list":
				return ok({ profiles });
			case "profiles.install": {
				const name = request.name ?? "";
				if (hold && installed === 0) {
					installed += 1;
					return await new Promise(() => {});
				}
				installed += 1;
				switch (answers[name]) {
					case "already":
						// The additive field, and the only thing that distinguishes an
						// idempotent copy from a first one: both are 200.
						return ok({ ...profile(name, "role", "installed"), already_installed: true });
					case "collision":
						// `install_seed` raises `NameTakenError` when the name belongs to
						// an agent the user already holds; the route answers 409.
						return {
							status: 409,
							body: {
								detail:
									"That name belongs to another agent. Choose a different name to extend the packaged profile.",
							},
						};
					default:
						return ok(profile(name, "role", "installed"));
				}
			}
			default:
				throw new Error(`unexpected desktop op in this story: ${request.op}`);
		}
	};

	const page = window as unknown as {
		api?: { desktop?: { request: (r: BridgeRequest) => Promise<DesktopResponse> } };
	};
	const api = page.api ?? {};
	page.api = api;
	api.desktop = { request: bridge };
};

/* --------------------------------------------------------------- stories */

const Page = () => (
	<div className={cn("flex h-screen overflow-hidden bg-canvas text-ink")}>
		<div className="w-[360px] shrink-0 border-r border-hairline">
			<ChatSidebar
				selectedConversation={undefined}
				onSelectConversation={() => undefined}
				onStageDraft={() => undefined}
			/>
		</div>
	</div>
);

const meta: Meta = {
	title: "Chat sidebar/Agents",
	parameters: { layout: "fullscreen" },
};

export default meta;

type Story = StoryObj;

/**
 * A user with no agents of their own, and six built-ins waiting: the state the
 * program item is about, where the next step is one action rather than a tour of
 * the catalogue.
 */
export const EmptyWithShortcut: Story = {
	render: () => {
		installBridge({ profiles: BUILTINS });
		return <Page />;
	},
};

/**
 * The same empty section on a backend that has no packaged profiles to offer —
 * an install without seeds, or an older server. The shortcut is absent rather
 * than broken, because there is nothing to install; the create row remains.
 */
export const EmptyWithoutShortcut: Story = {
	render: () => {
		installBridge({ profiles: [] });
		return <Page />;
	},
};

/**
 * A user with three agents of their own and three built-ins still available:
 * installed rows are the list, and what is left to install is one quiet line
 * above them.
 */
export const InstalledWithBuiltins: Story = {
	render: () => {
		installBridge({
			profiles: [
				profile("release-captain", "role", "installed"),
				profile("ledger-auditor", "specialist", "installed"),
				profile("my-reviewer", "role", "custom"),
				profile("coder", "role", "builtin"),
				profile("reviewer", "role", "builtin"),
				profile("designer", "role", "builtin"),
			],
		});
		return <Page />;
	},
};

/** Every built-in installed: no line, no action, nothing left to say about them. */
export const AllInstalled: Story = {
	render: () => {
		installBridge({
			profiles: [
				profile("release-captain", "role", "installed"),
				...BUILTINS.map((builtin) => profile(builtin.name, "role", "installed")),
			],
		});
		return <Page />;
	},
};

/**
 * The batch in flight: a determinate bar and the name being installed. The first
 * install never settles, which is the state a slow copy leaves on screen.
 */
export const Installing: Story = {
	render: () => {
		installBridge({ profiles: BUILTINS, install: { hold: true } });
		return <Page />;
	},
	play: async () => {
		// The empty state mounts the action as its primary button, not as the quiet
		// row a user who already has agents sees; both are the same component.
		await userEvent.click(
			await screen.findByRole("button", { name: "Install all built-in agents" }),
		);
		await screen.findByTestId("install-builtins-progress");
	},
};

/**
 * The end of a mixed batch: one name already present, one the user already holds
 * as an ordinary agent, the rest installed. The summary counts what happened
 * rather than what was attempted, and the skip is reported by name — the case
 * the loop exists to survive instead of aborting on.
 */
export const InstallSummary: Story = {
	render: () => {
		installBridge({
			profiles: BUILTINS,
			install: { answers: { coder: "already", reviewer: "collision" } },
		});
		return <Page />;
	},
	play: async () => {
		// The empty state mounts the action as its primary button, not as the quiet
		// row a user who already has agents sees; both are the same component.
		await userEvent.click(
			await screen.findByRole("button", { name: "Install all built-in agents" }),
		);
		await screen.findByTestId("install-builtins-summary");
	},
};
