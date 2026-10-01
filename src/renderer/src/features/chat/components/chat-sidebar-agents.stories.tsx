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
 *
 * ## The dismissal, and why every story pins it
 *
 * The built-ins offer is dismissible, and the dismissal persists into
 * `ui-preferences-storage` — ONE localStorage key on ONE browser origin, shared
 * by every story the capture sweep visits in a session. A story that left the
 * offer dismissed would therefore render the next story's section differently
 * than that story's own frame claims — and the batch stories' plays would press
 * a button a dismissed section no longer has. Every story below mounts
 * `OfferDismissalFixture`, which states the stored value at render, so the set
 * is order-independent by construction: a story cannot inherit a dismissal it
 * did not ask for.
 */

import { cn } from "@shared/lib/utils";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, screen, userEvent, waitFor } from "@storybook/test";
import { useLayoutEffect } from "react";
import type { DesktopResponse } from "../../../../../shared/desktop-contract";
import { DEFAULT_SIDEBAR_VIEW } from "../chat-sidebar-view";
import { ChatSidebar } from "./chat-sidebar";

/* Hoisted out of the play callback: a regex literal inside a callback is what
 * `useTopLevelRegex` reports, and this file is being touched anyway. */
const INSTALLING_FOURTH = /Installing 4 of 6/;

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

/** One row in `sessions.list`'s own wire field names, as the backend sends it. */
type WireRow = {
	id: string;
	name: string;
	mtime: number;
	preview: string;
	live_state: string;
	pending: string | null;
	active: boolean;
	pinned?: boolean;
	binding: { agent: string | null; team: string | null };
	status: { code: string; label: string };
	status_revision: number;
	status_epoch: string;
};

const EPOCH = "3f2a1b4c5d6e7f8091a2b3c4d5e6f708";

/**
 * One session, shaped as the sections stories shape theirs - the same wire, so
 * the two fixtures cannot disagree about what a catalogue row is.
 */
const row = (
	id: string,
	name: string,
	mtime: number,
	over: Partial<WireRow> = {},
): WireRow => ({
	id,
	name,
	mtime,
	preview: "",
	live_state: "attached",
	pending: null,
	active: true,
	binding: { agent: null, team: null },
	status: { code: "idle", label: "Recent" },
	status_revision: 1,
	status_epoch: EPOCH,
	...over,
});

type InstallBehaviour = {
	/** How each name answers. Anything unnamed succeeds. */
	answers?: Record<string, "ok" | "already" | "collision">;
	/** Never settle the first install, so the progress line is the subject. */
	hold?: boolean;
	/**
	 * Answer the first N installs and never settle the one after them, so a frame
	 * can photograph a bar with a FILL in it. `hold` alone photographs the bar at
	 * its starting position, which is the only moment the set used to capture —
	 * and the reason the determinate treatment was never actually seen (design
	 * round 1, D2).
	 */
	holdAfter?: number;
};

const installBridge = ({
	profiles,
	install,
	sessions = [],
}: {
	profiles: WireProfile[];
	install?: InstallBehaviour;
	/**
	 * The catalogue the sidebar reads, for the roster states: recency ordering is
	 * a fact about the SESSIONS (an agent's newest conversation), so the frames
	 * that claim it have to seed them. Empty is the right default for every story
	 * above, which is about the profiles catalogue alone.
	 */
	sessions?: WireRow[];
}) => {
	const { answers = {}, hold = false, holdAfter } = install ?? {};
	let installed = 0;
	const ok = <T,>(result: T): DesktopResponse => ({
		status: 200,
		body: { result },
	});

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
				return ok({ sessions, truncated: false });
			case "teams.list":
				return ok({ teams: [] });
			case "profiles.list":
				return ok({ profiles });
			case "profiles.install": {
				const name = request.name ?? "";
				installed += 1;
				if (
					(hold && installed === 1) ||
					(holdAfter !== undefined && installed === holdAfter + 1)
				) {
					return await new Promise(() => {});
				}
				switch (answers[name]) {
					case "already":
						// The additive field, and the only thing that distinguishes an
						// idempotent copy from a first one: both are 200.
						return ok({
							...profile(name, "role", "installed"),
							already_installed: true,
						});
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
		api?: {
			desktop?: { request: (r: BridgeRequest) => Promise<DesktopResponse> };
		};
	};
	const api = page.api ?? {};
	page.api = api;
	api.desktop = { request: bridge };
};

/* --------------------------------------------------------------- stories */

/* ---------------------------------------------------- the dismissal fixture */

/**
 * States the persisted dismissal for the story it is mounted in.
 *
 * WHY EVERY STORY CARRIES ONE is the header's "The dismissal" section: the
 * sweep shares one origin, so `ui-preferences-storage` is shared too, and this
 * is what makes the set order-independent — each story states the value it
 * expects instead of inheriting whatever ran before it.
 *
 * A LAYOUT effect, so the store holds the fixture's value BEFORE the story's
 * first paint: a passive effect would let the first frame — and any play that
 * starts at mount — record the pre-fixture value.
 */
const OfferDismissalFixture = ({ signature }: { signature: string }) => {
	const dismissBuiltinOffer = useUiPreferencesStore(
		(state) => state.dismissBuiltinOffer,
	);
	useLayoutEffect(() => {
		dismissBuiltinOffer(signature);
	}, [dismissBuiltinOffer, signature]);
	return null;
};

/**
 * The sidebar's VIEW, stated for every story in this file.
 *
 * The same shared-origin discipline as the dismissal above, for the same reason
 * and one more: `ui-preferences-storage` carries the `pinnedAgents` a press
 * writes, so `pinned-first`'s own gesture would photograph the NEXT story's
 * roster with an agent already pinned - and with the reset ONLY in the stories
 * that need it, the set's frames would depend on the order the sweep happens to
 * visit them in. Stating the default before mount is what makes the set
 * order-independent by construction, exactly as the dismissal fixture does for
 * the offer.
 *
 * `togglePinnedAgent` (the press `pinned-first` drives) runs AFTER this layout
 * effect, so the reset is not a race it could clobber: the effect states the
 * default before the first paint, and nothing later writes the view except the
 * story's own gesture.
 */
const ViewFixture = () => {
	const setChatSidebarView = useUiPreferencesStore(
		(state) => state.setChatSidebarView,
	);
	useLayoutEffect(() => {
		setChatSidebarView(DEFAULT_SIDEBAR_VIEW);
	}, [setChatSidebarView]);
	return null;
};

const Page = () => (
	<>
		<OfferDismissalFixture signature="" />
		<ViewFixture />
		<div className={cn("flex h-screen overflow-hidden bg-canvas text-ink")}>
			<div className="w-[360px] shrink-0 border-r border-hairline">
				<ChatSidebar
					selectedConversation={undefined}
					onSelectConversation={() => undefined}
					onStageDraft={() => undefined}
				/>
			</div>
		</div>
	</>
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
 * the catalogue. The dismiss control rides the "No agents yet" line — this is
 * the frame that shows it.
 */
export const EmptyWithShortcut: Story = {
	render: () => {
		installBridge({ profiles: BUILTINS });
		return <Page />;
	},
};

/**
 * The offer AFTER the reader dismissed it: the empty-state block is gone — no
 * line, no sentence, no action — and the section is its heading and the create
 * row the caret landed on. The press is a real click on the shipped control in
 * the play, so the frame is the component REACTING to a dismissal rather than a
 * prop that fakes the state.
 */
export const OfferDismissed: Story = {
	render: () => {
		installBridge({ profiles: BUILTINS });
		return <Page />;
	},
	play: async () => {
		await userEvent.click(await screen.findByTestId("agents-offer-dismiss"));
		await waitFor(() => {
			expect(screen.queryByTestId("agents-sidebar-empty")).toBeNull();
		});
		// The control went with the block, and the create row is what is left.
		expect(screen.queryByTestId("agents-offer-dismiss")).toBeNull();
		expect(screen.getByRole("button", { name: "Create agent" })).toBeTruthy();
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
				...BUILTINS.map((builtin) =>
					profile(builtin.name, "role", "installed"),
				),
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
			await screen.findByRole("button", {
				name: "Install all built-in agents",
			}),
		);
		await screen.findByTestId("install-builtins-progress");
	},
};

/**
 * The batch MID-RUN, which is the frame the set was missing: three installs
 * answered and the fourth never settles, so the bar is at 4 of 6 — the step the
 * sentence beside it reports — rather than at its starting position. `Installing`
 * photographs the moment the two used to disagree about (design round 1, D2).
 */
export const InstallingMidRun: Story = {
	render: () => {
		installBridge({ profiles: BUILTINS, install: { holdAfter: 3 } });
		return <Page />;
	},
	play: async () => {
		await userEvent.click(
			await screen.findByRole("button", {
				name: "Install all built-in agents",
			}),
		);
		await screen.findByText(INSTALLING_FOURTH);
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
			await screen.findByRole("button", {
				name: "Install all built-in agents",
			}),
		);
		await screen.findByTestId("install-builtins-summary");
	},
};

/* ---------------------------------------------- the roster's navigation */

/**
 * A roster of twelve agents, past the section's eight-row cap, with the five
 * conversations spread across four of them.
 *
 * `source: "installed"` on every row, deliberately, for the reason
 * `chat-sidebar-sections.stories.tsx` states at its own fixture: a `builtin`
 * profile is not drawn as a row at all - it is grouped behind the built-ins
 * shortcut - so a fixture built out of builtins would photograph an empty
 * entity region. The five sessions are what makes the RECENCY half of the
 * ordering a fact a reader can check in the frame: builder is newest, then
 * release-captain, bug-intake, docs-writer, scout, and the seven agents nobody
 * has used have their roster order kept at the tail.
 */
const ROSTER = [
	profile("release-captain", "role", "installed"),
	profile("ledger-auditor", "specialist", "installed"),
	profile("bug-intake", "role", "installed"),
	profile("docs-writer", "role", "installed"),
	profile("scout", "role", "installed"),
	profile("builder", "role", "installed"),
	profile("incident-scribe", "role", "installed"),
	profile("metrics-analyst", "specialist", "installed"),
	profile("translator", "role", "custom"),
	profile("patch-reviewer", "role", "installed"),
	profile("night-shift", "role", "custom"),
	profile("archivist", "role", "installed"),
];

const ROSTER_SESSIONS = [
	row("ro-1", "Release checklist", 1_760_003_500, {
		binding: { agent: "release-captain", team: null },
	}),
	row("ro-2", "Intake triage notes", 1_760_003_000, {
		binding: { agent: "bug-intake", team: null },
	}),
	row("ro-3", "Writer's brief", 1_760_002_000, {
		binding: { agent: "docs-writer", team: null },
	}),
	row("ro-4", "Scouting pass", 1_760_001_000, {
		binding: { agent: "scout", team: null },
	}),
	row("ro-5", "Build the deploy script", 1_760_003_900, {
		binding: { agent: "builder", team: null },
	}),
	row("ro-6", "Retry the build matrix", 1_760_003_800, {
		binding: { agent: "builder", team: null },
	}),
];

/** The roster's first drawn name, read out of the DOM rather than assumed. */
const firstEntityName = () =>
	document.querySelector("[data-entity-name]")?.textContent?.trim() ?? "";

const drawnEntityNames = () =>
	[...document.querySelectorAll("[data-entity-name]")].map(
		(node) => node.textContent?.trim() ?? "",
	);

/**
 * THE LONG ROSTER (issue #663), the state the section is now for: twelve agents,
 * the filter field drawn because the section is cap-bound, and the order by use -
 * builder (twice), release-captain, bug-intake, docs-writer, scout first; the
 * seven never-used ones after them in roster order; eight drawn and a
 * `Show 4 more` foot for the rest.
 *
 * A frame is not a rule, so the RULES are pinned in
 * `scripts/chat-sidebar-agents.test.mjs`; this story's job is the rendering - the
 * field sits where the reader looks for it, the pins are the row's own marks,
 * and the section still reads as the list's sibling rather than a second panel.
 */
export const LongRoster: Story = {
	render: () => {
		installBridge({ profiles: ROSTER, sessions: ROSTER_SESSIONS });
		return <Page />;
	},
	play: async () => {
		await screen.findByLabelText("Filter agents");
		await waitFor(() => {
			if (document.querySelectorAll("[data-agent-pin]").length !== 8)
				return false;
			return firstEntityName() === "builder";
		});
	},
};

/**
 * THE FILTER WITH MATCHES: `er` narrows the twelve to the four names carrying it
 * (builder and docs-writer by use, ledger-auditor and patch-reviewer never used),
 * the section cap is bypassed so EVERY match draws - which is how
 * patch-reviewer's row appears at all - and the show-more foot goes with the cap,
 * so the frame cannot offer a page the section is not on.
 */
export const RosterFiltered: Story = {
	render: () => {
		installBridge({ profiles: ROSTER, sessions: ROSTER_SESSIONS });
		return <Page />;
	},
	play: async () => {
		await userEvent.type(await screen.findByLabelText("Filter agents"), "er");
		await waitFor(() => {
			const names = drawnEntityNames();
			return (
				names.length === 4 &&
				names[0] === "builder" &&
				names.includes("patch-reviewer") &&
				document.querySelector("[data-sidebar-section-more]") === null
			);
		});
	},
};

/**
 * THE FILTER WITH NO MATCH: the sentence says so rather than the full roster
 * falling back in - a filter that appeared to do nothing would leave the reader
 * re-checking their spelling against a list that is not answering them.
 */
export const RosterNoMatch: Story = {
	render: () => {
		installBridge({ profiles: ROSTER, sessions: ROSTER_SESSIONS });
		return <Page />;
	},
	play: async () => {
		await userEvent.type(await screen.findByLabelText("Filter agents"), "zzz");
		await screen.findByText("No agents match");
	},
};

/**
 * THE PINNED-FIRST ORDER, driven by the press the feature is: ledger-auditor is
 * drawn mid-list (never used, so it sorts into the tail band), its pin control is
 * pressed, and the row moves to the top of the roster - above builder, whose
 * conversations made it the most recently used - with the pin drawn filled at
 * rest (`aria-pressed`, not only the pointer reveal the row's glyphs wear).
 */
export const PinnedFirst: Story = {
	render: () => {
		installBridge({ profiles: ROSTER, sessions: ROSTER_SESSIONS });
		return <Page />;
	},
	play: async () => {
		/*
		 * The rows arrive with the profiles query; the filter field is drawn in
		 * the same commit (both are gated on the catalogue), so waiting for the
		 * field IS waiting for the roster - the first version of this play queried
		 * the pin control immediately and photographed nothing but its own race
		 * (the sweep refused the frame rather than filing a lie).
		 */
		await screen.findByLabelText("Filter agents");
		const pin = await waitFor(() => {
			const control = document.querySelector(
				'[data-agent-pin="ledger-auditor"]',
			);
			if (!(control instanceof HTMLButtonElement))
				throw new Error("the ledger-auditor pin control is not drawn yet");
			return control;
		});
		await userEvent.click(pin);
		await waitFor(() => firstEntityName() === "ledger-auditor");
		expect(pin.getAttribute("aria-pressed")).toBe("true");
	},
};
