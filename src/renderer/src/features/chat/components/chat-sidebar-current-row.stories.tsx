import { cn } from "@shared/lib/utils";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import type { Meta, StoryObj } from "@storybook/react";
import type { FC } from "react";
import { ChatSidebar } from "./chat-sidebar";

/*
 * The chat sidebar with a row that is CURRENT, and with the New chat row current.
 *
 * Two states one change touched, photographed on the panel's own ground in every
 * theme. `chat-sidebar-status-feed.stories.tsx` renders this same component for
 * the frame-delivered row status, and this file exists for the same reason it
 * does: the sidebar cannot be rendered in isolation — it reads the router, the
 * canonical sessions store and the desktop capability hooks — and a claim about
 * which GROUND a row paints is a claim about pixels, not about a class string.
 * `scripts/chat-sidebar-selection.test.mjs` resolves the class expressions, and a
 * green assertion there proves the merge, not that the panel looks right.
 *
 * ## What is stubbed, and how little
 *
 * Only the desktop transport: `capabilities` (which is what puts the New chat row
 * on screen at all — `ready` is `session_catalogue` 2 over an answered list) and
 * `sessions.list`. The rows, the store, the component and every Tailwind role
 * utility are the app's own, and the ground under them is whatever the theme says
 * `surface` and `highlight` are. The roster is a fixture because a story has no
 * backend; nothing about its content is under test.
 *
 * ## Why BOTH states are here rather than one
 *
 * They are the two places the change is visible in this panel: a conversation row
 * wearing `highlight`, and the New chat row wearing it while its caps sit on top
 * of it. The second was a special case until this change — the caps carried the
 * same `sunken` fill the row's ground was, so on this one row they needed a
 * caller-supplied outline to be visible at all — and the pair is what shows the
 * special case is gone.
 *
 * The rest of the panel is deliberately not re-shot here: the All chats filter,
 * the entity rows and the hover states are the same role at the same call sites
 * (`docs/evidence/chat-sidebar-selection/` carries them, with its own note on
 * where its frames stop describing the shipped ground).
 */

/** The `sessions.list` wire row, in the fields the sidebar reads. */
const wireRow = (id: string, name: string, mtime: number) => ({
	id,
	name,
	mtime,
	preview: "",
	live_state: "attached",
	pending: null,
	active: true,
	binding: { agent: null, team: null },
	status: { code: "idle", label: "Recent" },
});

const REVENUE = "0f1e2d3c4b5a";
const LEDGER = "1a2b3c4d5e6f";
const DEPLOY = "2b3c4d5e6f70";

/*
 * The third row is the current one, and the roster is ordered newest-first the
 * way the catalogue returns it: the sidebar draws top-down, and a current row
 * that lands below a frame's fold would be a picture of the wrong thing.
 */
const roster = [
	wireRow(LEDGER, "Reconcile the supplier ledger", 1_760_000_300),
	wireRow(DEPLOY, "Migrate the deploy script", 1_760_000_200),
	wireRow(REVENUE, "Quarterly revenue model", 1_760_000_100),
];

/** Which conversation is marked current, per story. */
let selected: string | undefined = REVENUE;

/**
 * Whether a draft is staged against the New chat row itself.
 *
 * `activeDraftKey` with NO entry in `drafts` is the shape the app reaches through
 * the `⌘N` chord: the key is the row's own mark (`Boolean(activeDraftKey) &&
 * !draft?.target`), and a draft carrying a target belongs to an ENTITY row
 * instead, which would mark a different row than this story is about.
 */
let draftKey: string | null = null;

if (typeof window !== "undefined") {
	const page = window as unknown as {
		api?: {
			desktop?: {
				request: (request: { op: string }) => Promise<unknown>;
			};
		};
	};
	const api = (page.api ?? {}) as NonNullable<typeof page.api>;
	const desktop = (api.desktop ?? {}) as NonNullable<
		NonNullable<typeof page.api>["desktop"]
	>;
	const ok = (result: unknown) => ({ status: 200, body: { result } });
	/*
	 * Anything else is refused BY NAME rather than left to hang: a story that
	 * starts issuing a third call fails loudly instead of photographing a spinner.
	 */
	desktop.request = async (request: { op: string }) => {
		switch (request.op) {
			case "capabilities":
				return ok({
					desktop_contract: 1,
					desktop_available: true,
					desktop_auth: "bearer",
					features: { session_catalogue: 2 },
				});
			case "sessions.list":
				return ok({ sessions: roster, truncated: false });
			default:
				throw new Error(`unexpected desktop op in this story: ${request.op}`);
		}
	};
	api.desktop = desktop;
	page.api = api;
}

/** Wait for the catalogue read to land, so the frame is not a picture of "loading". */
const catalogueSettled = async (rows: number, timeoutMs = 4_000) => {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		if (useCanonicalSessionsStore.getState().sessions.length >= rows) return;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The panel at the width the app gives it, plus a caption.
 *
 * The caption names the state and the roles in play rather than describing the
 * palette, because the palette is the theme's business: what a reader checks here
 * is WHICH ground the row and the caps are drawn on, and the caption is what makes
 * that checkable by eye across twelve themes.
 */
const Page: FC<{ note: string }> = ({ note }) => (
	<div className={cn("flex h-screen overflow-hidden bg-canvas text-ink")}>
		<div className="w-[280px] shrink-0 border-hairline border-r">
			<ChatSidebar
				selectedConversation={selected}
				onSelectConversation={() => undefined}
				onStageDraft={() => undefined}
			/>
		</div>
		<div className="w-[420px] shrink-0 space-y-3 p-4 text-meta text-ink-muted">
			<p className="text-ink">{note}</p>
			<p>
				The current row is drawn on <code className="font-mono">highlight</code>
				, a shallow step off the panel's{" "}
				<code className="font-mono">surface</code>; the hover step the same rows
				carry is <code className="font-mono">elevated</code>. The caps carry no
				fill and no border on any of them.
			</p>
			<p>
				{selected
					? `selectedConversation = ${selected}`
					: "selectedConversation = (none)"}
				{` · activeDraftKey = ${draftKey ?? "(none)"}`}
			</p>
		</div>
	</div>
);

const meta = {
	title: "Chat/Sidebar current row",
	parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj;

/** A conversation row is the current one, and the pointer is somewhere else. */
export const SelectedRow: Story = {
	render: () => {
		selected = REVENUE;
		draftKey = null;
		return <Page note="A conversation row is current" />;
	},
	play: async () => {
		await catalogueSettled(3);
		useCanonicalSessionsStore.setState({ activeDraftKey: null });
		/*
		 * The paint the capture photographs, not the store write: React renders on
		 * the frame after the store's, and a capture taken between them is a frame
		 * of the previous state.
		 */
		await sleep(300);
	},
};

/**
 * The New chat row is current, with its chord beside it.
 *
 * This is the state the chord itself creates, and the one where the caps used to
 * need an edge to stay visible.
 */
export const NewChatRowCurrent: Story = {
	render: () => {
		selected = undefined;
		draftKey = "draft-untargeted";
		return (
			<Page note="The New chat row is current, staging an untargeted draft" />
		);
	},
	play: async () => {
		await catalogueSettled(3);
		useCanonicalSessionsStore.setState({
			activeDraftKey: draftKey,
			drafts: {},
		});
		await sleep(300);
	},
};
