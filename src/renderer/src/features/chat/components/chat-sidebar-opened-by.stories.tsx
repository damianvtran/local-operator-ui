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
 * ## The fixtures, and why each one is here
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
 *   - `NotAgentOpened` — no workstream row: one row with the key absent and one
 *     with it explicitly null (the two non-workstream shapes the wire permits),
 *     which must render exactly as they do on the pre-change tree.
 *   - `AgentOpenedAndSearchMarked` — the template row is BOTH agent-opened and
 *     matched by the CONVERSATION rather than by its own label, so the row draws
 *     the search mark and the agent-opened fact reaches the reader through the
 *     row's flyout only. That is the precedence case `rowTrailingStatement` documents
 *     (`marked` outranks `agent_opened`), photographed here rather than asserted
 *     — the panel's box is searched by the story itself, in the panel's own box.
 *   - `AgentOpenedNotSent` — the OTHER claim above the new one: an unfinished
 *     draft in this window still holds the row's id, so the row draws
 *     `· Not sent yet` and the attribution again rides the flyout.
 *
 * ## The width is an arg, because a claim about truncation needs widths
 *
 * THE PANEL'S WIDTH IS A USER PREFERENCE, not a function of the window:
 * `ChatLayout` clamps `chatSidebarWidth` at 240..360 with a default of 280, and
 * the per-row controls shed against a container query on the PANEL. A story that
 * fixed the width in its own wrapper (this file's first version pinned
 * `w-[360px]`) therefore made the product's own default and floor UNREACHABLE:
 * design round 1 had to photograph the truncation it reported (D1) from a private
 * rig, and QA round 1 recorded the narrow-cell measurement as BLOCKED for the
 * same reason. So every story here takes the width as an arg and mounts the app's
 * OWN `ChatLayout`, which writes the same `chatSidebarWidth` preference the
 * divider writes and clamps it the same way — the frame cannot claim a width the
 * panel does not hold. `width` is a story arg offering the floor (240), the
 * default (280, the arg's own default) and the ceiling (360), so every state
 * below is reachable at every width from the URL.
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
 * title, trailing slot, screen-reader sentence and flyout), inside the app's real
 * `ChatLayout`. Below them, `window.api.desktop.request` answers the four reads
 * this panel makes — `capabilities`, `sessions.list`, `profiles.list`,
 * `teams.list` — and, on the stories that ask for a query, a fifth,
 * `sessions.search`; it refuses anything else BY NAME, so a story that starts
 * issuing a call nothing answers fails loudly instead of hanging on a promise.
 *
 * ## What a frame here does NOT prove, stated rather than implied
 *
 *   - **Not a real backend.** That the requested side of the field is populated
 *     the way the backend populates it is the wire's contract, not this file's;
 *     what is photographed is how the renderer reads the three shapes it may
 *     receive. The same holds for the search story: its `sessions.search` answer
 *     is a stub the story states for itself, so the frame proves how THIS client
 *     joins a hit to a row, not that a real index would return it. The loading and
 *     error states of the catalogue read are out of scope here for their own
 *     reason: the row has no loading or error state of its own to photograph, and
 *     inventing one would photograph something the app cannot render.
 *   - **Not the hit-only row, and that is a WIRE gap rather than a decision.** A
 *     conversation past the catalogue page reaches this panel only as a
 *     `SessionSearchHit`, whose shape carries no `opened_by` at all
 *     (`desktop-session-contract.ts`), so the row synthesized for it in
 *     `chatSearch` has nothing to read and draws no marker — measured, not
 *     assumed: this story's own search answer proves the marked path, and the
 *     synthesized path is the one place a future `opened_by` on a hit would land.
 *     It is recorded as deferred on the pull request with the backend PR named as
 *     its home, because the client cannot publish a field the wire does not carry.
 *   - **The truncation is bounded by the fixture, not by the marker.** The panel
 *     width is swept (240/280/360), and the marker is a fixed string, so its own
 *     width is width-independent by construction; what the title does with the
 *     remaining space is what these frames show. The agent-name case a 64-char
 *     limit allows is NOT drawn here: the marker carries no name any more, which
 *     is what took it out of the row's width arithmetic altogether.
 *
 * ## The readout is what makes the unpainted channel legible
 *
 * The row's accessible name carries the attribution through an `sr-only` span,
 * which no still can paint. The caption beside the panel is read out of the DOM
 * every 200ms — each row's trailing statement, whether it is nested, its
 * accessible name, and the geometry above — so a frame carries those bytes and
 * the row's widths as well as the pixels. The row's flyout (main's replacement
 * for the native `title`, design D7 of #430) is a Radix tooltip that exists
 * only while open, so it is photographed by hovering the row, not read here.
 */

import { SESSION_RANK_BODY } from "@features/chat/chat-search";
import { ChatLayout } from "@shared/components/common/chat-layout";
import {
	type ChatDraft,
	useCanonicalSessionsStore,
} from "@shared/store/canonical-sessions-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { Meta, StoryObj } from "@storybook/react";
import { type FC, useEffect, useState } from "react";
import type { DesktopResponse } from "../../../../../shared/desktop-contract";
import { ChatSidebar } from "./chat-sidebar";

/* --------------------------------------------------------------- the bridge */

type BridgeRequest = { op: string; q?: string };

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
	 *
	 * NULLABLE like the contract (`opened_by?: SessionOpenedBy | null` in
	 * `desktop-session-contract.ts`), which is the QA round 1 nit Q2: the frozen
	 * wire permits an EXPLICIT null beside the absent key, the renderer treats the
	 * two identically (`agentOpenedRow` tests `!= null`), and a fixture type
	 * narrower than the wire could not say so. `NotAgentOpened` draws both shapes.
	 */
	opened_by?: WireOpenedBy | null;
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
 * name. It is what the marker's flyout clause carries and what the trailing
 * slot deliberately does not draw.
 */
const REQUESTER = {
	agent: "coder",
	label: "Harden lop secret against agent credential leaks",
	session: "6b5a4c3d2e1f0a9b8c7d6e5f4a3b2c1d",
};

/**
 * The row this set marks, named once because three fixtures share it: the named,
 * the search-marked and the unstarted stories all photograph the SAME row, so a
 * frame from one can be read against a frame from another.
 */
const TEMPLATE_ID = "9c1d2e3f4a5b";
const TEMPLATE_NAME = "Retry ladder for superseded tokens";
const TEMPLATE_MTIME = 1_760_001_000;

/**
 * The query `AgentOpenedAndSearchMarked` puts in the box, and why it is that word.
 *
 * It has to be a phrase the TEMPLATE row carries in its CONVERSATION and not in
 * its label: `searchChats` marks a row only when the backend's hit is a body match
 * AND the row's own title/agent/team does not contain the query (that rule is what
 * keeps `· in conversation` off a row whose title visibly contains it). A query the
 * title matched would be admitted by the local half, carry no mark, and draw the
 * agent-opened marker instead — a frame of the wrong state, not a frame of the
 * precedence case.
 */
const MARKED_QUERY = "credential";

/**
 * The row the `AgentOpenedNotSent` story's own draft holds: an unfinished draft in
 * this window carrying a session id is what `unstarted` reads, and it is the only
 * way the `not_sent` branch — the other claim `rowTrailingStatement` puts above the
 * marker — is reachable at all (`chat-sidebar.tsx`'s `unstarted` memo).
 */
const UNSTARTED_ID = "8f9012345678";

const ROSTER_NAMED: WireRow[] = [
	row(TEMPLATE_ID, TEMPLATE_NAME, TEMPLATE_MTIME, {
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

/*
 * Both non-workstream shapes the wire permits, one per row: the key ABSENT (what a
 * backend older than the field sends) and the key EXPLICITLY null (what a current
 * backend sends on every non-workstream row). Both must render as the list always
 * has, and this pair is also what the inertness frames compare across trees.
 */
const ROSTER_PLAIN: WireRow[] = [
	row("1f2e3d4c5b6a", "Release notes for 0.30.10", 1_760_001_000, {
		binding: { agent: "coder", team: null },
	}),
	row("2a3b4c5d6e7f", "Tidy the migration fixtures", 1_760_000_900, {
		opened_by: null,
	}),
];

/**
 * The search-marked set: the SAME template row, plus a second row the query
 * matches BY ITS OWN TITLE.
 *
 * The second row is the control the precedence frame needs. It is admitted by the
 * local half of the join (`matchesLabel`), so it carries no mark and draws its
 * binding — which is what shows that the marked row's `· in conversation` is the
 * search's statement rather than something every row in a filtered list gets.
 */
const ROSTER_MARKED: WireRow[] = [
	row(TEMPLATE_ID, TEMPLATE_NAME, TEMPLATE_MTIME, {
		binding: { agent: "coder", team: null },
		opened_by: REQUESTER,
	}),
	row("5d6e7f80913a", "Credential handling notes", 1_760_000_950, {
		binding: { agent: "coder", team: null },
	}),
];

/**
 * What the backend answers for {@link MARKED_QUERY} in that story: ONE hit, on the
 * template row, as a BODY match (`body_match: true`, the rank the backend sets for
 * a hit whose visible name did not match). Stated as a fixture rather than implied,
 * because it is the story's own claim that a conversation match — not a title
 * match — is what admits that row.
 */
const MARKED_HITS = [
	{
		id: TEMPLATE_ID,
		name: TEMPLATE_NAME,
		mtime: TEMPLATE_MTIME,
		forked: false,
		rank: SESSION_RANK_BODY,
		body_match: true,
		archived: false,
	},
];

/** The unstarted set: one row, whose id an unfinished draft holds in this window. */
const ROSTER_UNSTARTED: WireRow[] = [
	row(UNSTARTED_ID, "Scratch: bench the pinned interpreter", 1_760_001_000, {
		opened_by: REQUESTER,
	}),
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

/**
 * The bridge, with the search answer switched on only where a story asks for it.
 *
 * `search` is a parameter rather than unconditional because advertising
 * `session_search` changes the capability answer every story sees — a story about
 * the marker's PIXELS has no business negotiating a feature it never uses, and the
 * frames of those stories are meant to stay comparable with the ones taken before
 * this parameter existed.
 */
const bridge = (rows: WireRow[], options: { search?: boolean } = {}) => {
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
						...(options.search ? { session_search: 1 } : {}),
					},
				});
			case "sessions.list":
				return ok({ sessions: rows, truncated: false });
			/*
			 * The answer is ECHOED with the question it answers, because that echo is
			 * what the panel checks before using it (`hitsAnswerQuery`): an answer
			 * whose `query` is not the string in the box is ignored, by design.
			 */
			case "sessions.search":
				return ok({
					query: request.q ?? "",
					sessions: MARKED_HITS,
					limit: 20,
				});
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
 * One row's channels, as the DOM holds them.
 *
 * `trailing` is the row's own `· …` statement — the only element in the row whose
 * text begins with the separator — and `spoken` is the button's accessible name
 * as its text content composes it (visible words plus the `sr-only` sentence),
 * which is the channel no still can paint. Reading both is the point: the
 * accessible name must never be narrower than the pixels, and this is the pair
 * that says whether it is.
 *
 * The GEOMETRY is here for the same reason the words are, and it is design round
 * 1's ask (D1/D4): the finding was arithmetic — a 117px trailing slot leaving the
 * title 77px of its 228px at the panel's default width — and arithmetic is checked
 * rather than looked at. Every box is `clientWidth` against `scrollWidth`, the pair
 * that tells a box that FITS (`w/client/scroll` equal) from one that truncates, so
 * a frame carries the cause as well as the symptom.
 */
type RowFact = {
	nested: boolean;
	name: string;
	trailing: string;
	spoken: string;
	rowBox: number;
	titleBox: number;
	titleText: number;
	trailingBox: number;
	trailingText: number;
};

/**
 * The row's drawn trailing slot.
 *
 * Two spans can carry `·` in one row: the visible statement and, on the two that
 * use the arrangement, its `sr-only` twin. The visible one is the one with a box,
 * so the widest match is the drawn slot and the twin is never measured.
 */
const trailingSlot = (node: HTMLElement) =>
	[...node.querySelectorAll<HTMLElement>(":scope > span")]
		.filter((span) => (span.textContent ?? "").trim().startsWith("·"))
		.reduce<HTMLElement | null>(
			(kept, span) =>
				kept === null || span.clientWidth > kept.clientWidth ? span : kept,
			null,
		);

/**
 * The text a screen reader composes for the row: every text node under the
 * button except those inside an `aria-hidden` subtree. It is an approximation
 * of AccName (no `aria-label` on this button, so name-from-content is the rule
 * that applies) and good enough to show whether the sentence is there once.
 */
const spokenText = (node: HTMLElement): string => {
	const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
	let out = "";
	for (let text = walker.nextNode(); text; text = walker.nextNode()) {
		if (text.parentElement?.closest("[aria-hidden='true']")) continue;
		out += text.textContent ?? "";
	}
	return out.replace(/\s+/g, " ").trim();
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
			const trailing = trailingSlot(node);
			const title = node.querySelector<HTMLElement>("[data-session-title]");
			return {
				nested: node.dataset.child === "true",
				name: title?.textContent?.trim() ?? "",
				trailing: trailing?.textContent?.trim() ?? "",
				// `aria-hidden` visible words are dropped, as a screen reader drops them.
				spoken: spokenText(node),
				rowBox: Math.round(node.getBoundingClientRect().width),
				titleBox: title?.clientWidth ?? 0,
				titleText: title?.scrollWidth ?? 0,
				trailingBox: trailing?.clientWidth ?? 0,
				trailingText: trailing?.scrollWidth ?? 0,
			};
		});

/**
 * The query in force, read from the box itself.
 *
 * The same rule as the per-row facts: the caption states what the panel HOLDS
 * rather than what the story asked for, so a frame of the search-precedence case
 * cannot be mistaken for one where the query never reached the panel.
 */
const boxQuery = (): string =>
	document.querySelector<HTMLInputElement>(
		'input[aria-label="Search chats and agents"]',
	)?.value ?? "";

/**
 * The caption, in the idiom the sidebar's other stories use: the facts the frame
 * is DRAWN from, read out of the DOM rather than typed by hand, so a caption
 * cannot claim a state the panel does not hold.
 */
const Readout: FC = () => {
	const [facts, setFacts] = useState<RowFact[]>([]);
	const [query, setQuery] = useState("");
	useEffect(() => {
		const poll = () => {
			setFacts(rowFacts());
			setQuery(boxQuery());
		};
		poll();
		const timer = window.setInterval(poll, 200);
		return () => window.clearInterval(timer);
	}, []);
	return (
		<div
			data-readout-rows={facts.length}
			className="w-[520px] shrink-0 overflow-auto border-l border-hairline p-4 font-mono text-[11px] text-ink-muted"
		>
			<p className="mb-4 text-ink">query: {query || "(empty)"}</p>
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
					geometry: row {fact.rowBox} · title {fact.titleBox}/{fact.titleText} ·
					trailing {fact.trailingBox}/{fact.trailingText}
					<br />
					spoken: {fact.spoken}
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
 *
 * `chatSidebarWidth` is written here for the same reason and it is the field the
 * WIDTH of every frame comes from: it is the user's preference, the one
 * `ChatLayout` clamps at 240..360 and the divider writes, so a story cannot reach
 * a width the product would refuse. Nothing here clamps it — the clamp belongs to
 * the product, and a story that restated it would be a second answer to the same
 * question.
 */
const pinLayout = (width: number) => {
	useUiPreferencesStore.setState({
		chatSidebarRegions: "both",
		chatSidebarListHeight: null,
		chatSidebarOrder: "entities-first",
		chatSidebarWidth: width,
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

const Page = ({
	rows,
	width = DEFAULT_PANEL_WIDTH,
	query,
	drafts = {},
}: PageProps) => {
	bridge(rows, { search: Boolean(query) });
	pinLayout(width);
	setDrafts(drafts);
	useEffect(() => {
		if (query) putQueryInTheBox(query);
	}, [query]);
	return (
		<div className="flex h-screen overflow-hidden bg-canvas text-ink">
			<ChatLayout
				sidebar={
					<ChatSidebar
						selectedConversation={undefined}
						onSelectConversation={() => undefined}
						onStageDraft={() => undefined}
					/>
				}
				content={<Readout />}
			/>
		</div>
	);
};

/**
 * Put a query in the panel's OWN box, the way a reader does.
 *
 * WHY THE STORY HAS TO TYPE, stated because it looks like a shortcut and is the
 * opposite of one: the box's value is the sidebar's own state, written only by its
 * `onChange`, so no prop and no store field can seed it. That is exactly why the
 * `conversation`/`marked` branch had no frame before this round (QA round 1, Q1)
 * and why its author could only reach it by hand. Dispatching through the input's
 * NATIVE value setter is what makes React's own change handling see the write:
 * React records the last value it rendered and ignores an event whose value it
 * believes it already has, and the prototype setter is the supported way around
 * that tracker.
 *
 * The effect runs after the commit, so the box is in the document; a missing box
 * throws rather than photographing an unsearched panel under a caption claiming a
 * search, and the readout's own `query:` line is the second check.
 */
const putQueryInTheBox = (text: string) => {
	const box = document.querySelector<HTMLInputElement>(
		'input[aria-label="Search chats and agents"]',
	);
	if (box === null) {
		throw new Error("the panel's search box is not in the document");
	}
	Object.getOwnPropertyDescriptor(
		HTMLInputElement.prototype,
		"value",
	)?.set?.call(box, text);
	box.dispatchEvent(new Event("input", { bubbles: true }));
};

/**
 * The panel's width, in the only currency the product has for it: the user's own
 * `chatSidebarWidth` preference. The floor and the ceiling are `ChatLayout`'s
 * (240 and 360) and its default is 280.
 */
const DEFAULT_PANEL_WIDTH = 280;

/**
 * The store field the `not_sent` branch reads, written on EVERY story — including
 * the empty map — because the drafts live in the canonical sessions store, which
 * is shared across stories: a story that left it alone would photograph another
 * one's unfinished draft as its own.
 */
const setDrafts = (drafts: Record<string, ChatDraft>) => {
	useCanonicalSessionsStore.setState({ drafts });
};

/** The unfinished draft that makes the `AgentOpenedNotSent` story's row unstarted. */
const UNSTARTED_DRAFT: Record<string, ChatDraft> = {
	[`send:${UNSTARTED_ID}`]: {
		key: `send:${UNSTARTED_ID}`,
		createRequestId: "story-unstarted",
		admissionRequestId: "story-unstarted",
		sessionId: UNSTARTED_ID,
	},
};

type PageProps = {
	rows: WireRow[];
	/** The panel's width, as the preference `ChatLayout` clamps. */
	width?: number;
	/** Type this into the panel's own search box once it is mounted. */
	query?: string;
	/** Unfinished drafts in this window, which is what makes a row `not_sent`. */
	drafts?: Record<string, ChatDraft>;
};

/**
 * The width is a STORY ARG, declared once here rather than as one export per
 * width, so the capture rig reaches every state at every width through the URL
 * (`&args=theme:<id>;width:<px>`) the same way it already reaches the theme. The
 * options are `ChatLayout`'s floor, default and ceiling; nothing else is offered
 * because nothing else is a width the design question is about.
 */
type StoryArgs = { width: number };

const meta: Meta<StoryArgs> = {
	title: "Chat sidebar/Agent-opened rows",
	parameters: { layout: "fullscreen" },
	argTypes: {
		width: { control: "select", options: [240, 280, 360] },
	},
	args: { width: DEFAULT_PANEL_WIDTH },
};

export default meta;

type Story = StoryObj<StoryArgs>;

/** `opened_by` present, with the requesting agent and conversation named. */
export const AgentOpenedNamed: Story = {
	render: ({ width }) => <Page rows={ROSTER_NAMED} width={width} />,
};

/** `opened_by` present with all three members null — the presence is the fact.
 *  At 240 this is the case design round 1 (D2) measured clipping its own noun. */
export const AgentOpenedUnnamed: Story = {
	render: ({ width }) => <Page rows={ROSTER_UNNAMED} width={width} />,
};

/** The row is agent-opened AND matched by its CONVERSATION: `marked` outranks
 *  `agent_opened`, so the marker yields and the flyout is the only channel that
 *  still carries the attribution. The query is typed into the panel's own box. */
export const AgentOpenedAndSearchMarked: Story = {
	render: ({ width }) => (
		<Page rows={ROSTER_MARKED} width={width} query={MARKED_QUERY} />
	),
};

/** The other claim above the marker: an unfinished draft in this window holds the
 *  row's id, so the row draws `· Not sent yet`. */
export const AgentOpenedNotSent: Story = {
	render: ({ width }) => (
		<Page rows={ROSTER_UNSTARTED} width={width} drafts={UNSTARTED_DRAFT} />
	),
};

/** No `opened_by` at all: the list as it has always rendered. */
export const NotAgentOpened: Story = {
	render: ({ width }) => <Page rows={ROSTER_PLAIN} width={width} />,
};
