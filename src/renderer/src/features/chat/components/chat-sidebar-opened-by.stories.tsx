/**
 * The chat sidebar's AGENT-OPENED rows: a conversation an agent opened as an
 * explicitly-requested parallel workstream, marked so it cannot be read as a chat
 * the operator opened himself.
 *
 * ## Why this surface needed a story at all
 *
 * The incident is a READING failure, not a data one. On 2026-09-18 a session an
 * agent had opened sat in this list looking exactly like the operator's own
 * conversations, and he had no way to tell them apart from the panel. The wire
 * now carries `opened_by` on such a row, and the row draws it — so the claim
 * under test is "a reader can tell the two rows apart, and the row says WHAT it
 * is", which is a claim about pixels. A green assertion that the store holds the
 * field would prove the data moved, not that anything on screen changed.
 *
 * ## The three fixtures, and why each one is here
 *
 *   - `AgentOpenedNamed` — `opened_by` present with an agent and a requesting
 *     conversation name. The two rows beside it are the controls: one bound to
 *     the SAME agent with no `opened_by` (the binding still draws), and one with
 *     neither (a plain conversation). The panel's `Agents` section also draws the
 *     opened row NESTED under the agent that opened it, which is deliberate
 *     coverage rather than a side effect: provenance is the row's own fact, not
 *     an identity it inherits from the parent, so the marker is drawn in both
 *     places (see `rowTrailingStatement`).
 *   - `AgentOpenedUnnamed` — `opened_by` present with ALL THREE members null. The
 *     wire documents that as a normal case (the backend may know nothing about
 *     the requester while knowing an agent opened the row), so the marker has to
 *     be drawn from the field's PRESENCE; a rendering that fell back to the label
 *     would draw nothing here, which is the row that most needs to say something.
 *   - `NotAgentOpened` — no `opened_by` at all: today's list, which must render
 *     exactly as it does on the pre-change tree.
 *
 * ## This file is run against the PRE-CHANGE tree as well
 *
 * The rows below are plain objects in the wire's own field names, cast nowhere
 * and typed by this file's own `WireRow` — so the file compiles unchanged against
 * `origin/main`, where `opened_by` is a key the renderer never reads and the row
 * draws no marker. That pair is the point: the same fixture, one tree apart,
 * shows the field is what moved the row. It is the arrangement
 * `chat-sidebar-status-feed.stories.tsx` documents for its own baseline set.
 *
 * ## What is stubbed, and what is not
 *
 * The real `ChatSidebar`, its real catalogue read, its real row (status glyph,
 * title, trailing slot) and its real `title` attribute. Below them,
 * `window.api.desktop.request` answers the four reads this panel makes —
 * `capabilities`, `sessions.list`, `profiles.list`, `teams.list` — and refuses
 * anything else BY NAME, so a story that starts issuing a fifth call fails loudly
 * instead of hanging on a promise nothing answers.
 *
 * ## What a frame here does NOT prove, stated rather than implied
 *
 *   - **Not a real backend.** That the requested side of the field is populated
 *     the way the backend populates it is the wire's contract, not this file's;
 *     what is photographed is how the renderer reads the three shapes it may
 *     receive. The two branches the renderer does NOT draw — a session past the
 *     catalogue page reaching this panel only as a search hit, and the loading /
 *     error states of the catalogue read — are out of scope here for the same
 *     reason: the row has no loading or error state of its own to photograph, and
 *     inventing one would photograph something the app cannot render.
 *   - **Not the truncation.** The marker's own 45% cap is the binding slot's
 *     established geometry, measured in the review rounds that docstring records;
 *     this set photographs the marker's TEXT and its presence beside a long
 *     title, not a sweep of panel widths.
 *
 * ## The readout is what makes the tooltip legible
 *
 * A `title` attribute is not painted, so a still can never show it. The caption
 * beside the panel is read out of the DOM every 200ms — each row's trailing
 * statement, whether it is nested, and its own `title` attribute — so a frame
 * carries the tooltip's bytes as well as the pixels it sits behind.
 */

import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { Meta, StoryObj } from "@storybook/react";
import { type FC, useEffect, useState } from "react";
import type { DesktopResponse } from "../../../../../shared/desktop-contract";
import { ChatSidebar } from "./chat-sidebar";

/* --------------------------------------------------------------- the bridge */

type BridgeRequest = { op: string };

/**
 * The three members of `opened_by`, independently nullable, exactly as the wire
 * types them: a requesting side may be known by role, by conversation name, by
 * neither, or by nothing at all.
 */
type WireOpenedBy = {
	agent: string | null;
	label: string | null;
	session: string | null;
};

/** One row in `sessions.list`'s own wire field names, as the backend sends it. */
type WireRow = {
	id: string;
	name: string;
	mtime: number;
	preview: string;
	live_state: string;
	pending: string | null;
	active: boolean;
	binding: { agent: string | null; team: string | null };
	status: { code: string; label: string };
	status_revision: number;
	status_epoch: string;
	/**
	 * The field this story is about. ABSENT on the rows that must render as they
	 * always have — not null — because a client older than the field is the case
	 * that has to stay inert, and absent is the shape such a backend sends.
	 */
	opened_by?: WireOpenedBy;
};

const EPOCH = "8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e";

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

/**
 * The requesting conversation, named the way a real one is: the operator asks an
 * agent for a workstream INSIDE a conversation, so the label is that
 * conversation's own title — long, sentence-cased, and nothing like an agent
 * name. It is what the marker's tooltip clause carries and what the trailing
 * slot deliberately does not draw.
 */
const REQUESTER = {
	agent: "coder",
	label: "Harden lop secret against agent credential leaks",
	session: "6b5a4c3d2e1f0a9b8c7d6e5f4a3b2c1d",
};

const ROSTER_NAMED: WireRow[] = [
	row("9c1d2e3f4a5b", "Retry ladder for superseded tokens", 1_760_001_000, {
		binding: { agent: "coder", team: null },
		opened_by: REQUESTER,
	}),
	row("1f2e3d4c5b6a", "Release notes for 0.30.10", 1_760_000_900, {
		binding: { agent: "coder", team: null },
	}),
	row("2a3b4c5d6e7f", "Tidy the migration fixtures", 1_760_000_800),
];

const ROSTER_UNNAMED: WireRow[] = [
	row("3b4c5d6e7f80", "Scratch: bench the pinned interpreter", 1_760_001_000, {
		opened_by: { agent: null, label: null, session: null },
	}),
	row("4c5d6e7f8091", "Tidy the migration fixtures", 1_760_000_900),
];

const ROSTER_PLAIN: WireRow[] = [
	row("1f2e3d4c5b6a", "Release notes for 0.30.10", 1_760_001_000, {
		binding: { agent: "coder", team: null },
	}),
	row("2a3b4c5d6e7f", "Tidy the migration fixtures", 1_760_000_900),
];

/*
 * `source: "installed"` rather than `"builtin"`, deliberately: a built-in profile
 * is not drawn as a row at all (the section groups the packaged ones behind a
 * shortcut), so a fixture built out of builtins would photograph an empty entity
 * region and make the nested-row claim in this file vacuous. The rule is the one
 * `chat-sidebar-agents.stories.tsx` documents at length.
 */
const PROFILES = [
	{
		name: "coder",
		kind: "role",
		source: "installed",
		agent_id: "agent-coder",
		description: "coder — reusable instructions for this role.",
		tools: null,
		effort: null,
		delegate: false,
		seed_origin: "coder",
		divergent_fields: [],
	},
];

const bridge = (rows: WireRow[]) => {
	const ok = (result: unknown): DesktopResponse => ({
		status: 200,
		body: { result },
	});
	const handler = async (request: BridgeRequest): Promise<DesktopResponse> => {
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
				return ok({ sessions: rows, truncated: false });
			case "profiles.list":
				return ok({ profiles: PROFILES });
			case "teams.list":
				return ok({ teams: [] });
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
	api.desktop = { request: handler };
};

/* --------------------------------------------------------------- the page */

/**
 * One row's two channels, as the DOM holds them.
 *
 * `trailing` is the row's own `· …` statement — the only element in the row whose
 * text begins with the separator — and `tooltip` is the `title` attribute, which
 * is the channel no still can paint. Reading both is the point: the accessible
 * description must never be narrower than the pixels, and this is the pair that
 * says whether it is.
 */
type RowFact = {
	nested: boolean;
	name: string;
	trailing: string;
	tooltip: string;
};

const rowFacts = (): RowFact[] =>
	[...document.querySelectorAll<HTMLElement>("[data-chat-row]")]
		/*
		 * Conversation rows only: `data-chat-row` is also on this panel's navigation
		 * rows (`All chats`, `New chat`, `+ Create agent`), which carry no title and
		 * no trailing statement - a caption counting them would print empty entries
		 * beside the rows the claim is about. The title anchor is the discriminator,
		 * because it exists on exactly the rows that draw a conversation.
		 */
		.filter((node) => node.querySelector("[data-session-title]") !== null)
		.map((node) => {
			const trailing = [...node.querySelectorAll<HTMLElement>(":scope > span")]
				.map((span) => span.textContent?.trim() ?? "")
				.filter((text) => text.startsWith("·"))
				.join(" ");
			return {
				nested: node.dataset.child === "true",
				name:
					node
						.querySelector<HTMLElement>("[data-session-title]")
						?.textContent?.trim() ?? "",
				trailing,
				tooltip: node.getAttribute("title") ?? "",
			};
		});

/**
 * The caption, in the idiom the sidebar's other stories use: the facts the frame
 * is DRAWN from, read out of the DOM rather than typed by hand, so a caption
 * cannot claim a state the panel does not hold.
 */
const Readout: FC = () => {
	const [facts, setFacts] = useState<RowFact[]>([]);
	useEffect(() => {
		const poll = () => setFacts(rowFacts());
		poll();
		const timer = window.setInterval(poll, 200);
		return () => window.clearInterval(timer);
	}, []);
	return (
		<div
			data-readout-rows={facts.length}
			className="w-[520px] shrink-0 overflow-auto border-l border-hairline p-4 font-mono text-[11px] text-ink-muted"
		>
			{facts.map((fact) => (
				<p
					key={`${fact.nested ? "nested" : "flat"}:${fact.name}`}
					className="mb-3"
				>
					<span className="text-ink">
						{fact.name}
						{fact.nested ? " (nested)" : ""}
					</span>
					<br />
					trailing: {fact.trailing || "(none)"}
					<br />
					title: {fact.tooltip}
				</p>
			))}
		</div>
	);
};

/*
 * The split the panel draws at, written before it mounts so every frame is a
 * resolved layout rather than a transition — and every field is written on every
 * call, because this store PERSISTS: a story that set only one of them would
 * inherit another story's answer for the others.
 */
const pinLayout = () => {
	useUiPreferencesStore.setState({
		chatSidebarRegions: "both",
		chatSidebarListHeight: null,
		chatSidebarOrder: "entities-first",
	});
	/*
	 * The disclosure state is the PANEL's own, read once on mount from
	 * `localStorage["chat-sidebar-disclosures"]` and written by every chevron press,
	 * so it belongs to whatever profile the browser is carrying rather than to this
	 * story - a story that left it alone would photograph whatever the last reader
	 * of this Storybook had expanded, which is how the rows a claim is about come
	 * back collapsed. Written here, in the app's own shape, so the frame is the
	 * state the story is about rather than the state the profile happened to hold.
	 */
	window.localStorage.setItem(
		"chat-sidebar-disclosures",
		JSON.stringify({
			agents: true,
			teams: true,
			pinned: true,
			active: true,
			previous: true,
			// An entity's own chevron: `agent:coder` is the key `children()` opens by,
			// and the row nested under it is half of what this set photographs.
			"agent:coder": true,
		}),
	);
};

const Page = ({ rows }: { rows: WireRow[] }) => {
	bridge(rows);
	pinLayout();
	return (
		<div className="flex h-screen overflow-hidden bg-canvas text-ink">
			<div className="w-[360px] shrink-0 border-r border-hairline">
				<ChatSidebar
					selectedConversation={undefined}
					onSelectConversation={() => undefined}
					onStageDraft={() => undefined}
				/>
			</div>
			<Readout />
		</div>
	);
};

const meta: Meta = {
	title: "Chat sidebar/Agent-opened rows",
	parameters: { layout: "fullscreen" },
};

export default meta;

type Story = StoryObj;

/** `opened_by` present, with the requesting agent and conversation named. */
export const AgentOpenedNamed: Story = {
	render: () => <Page rows={ROSTER_NAMED} />,
};

/** `opened_by` present with all three members null — the presence is the fact. */
export const AgentOpenedUnnamed: Story = {
	render: () => <Page rows={ROSTER_UNNAMED} />,
};

/** No `opened_by` at all: the list as it has always rendered. */
export const NotAgentOpened: Story = {
	render: () => <Page rows={ROSTER_PLAIN} />,
};
