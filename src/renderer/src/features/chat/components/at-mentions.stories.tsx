/*
 * The composer's `@` picker and its inline mention chips, on the PRODUCTION
 * composer, driven by REAL keystrokes.
 *
 * WHY THIS IS A STORY SET AND NOT A DRIVER SCENE. Everything here happens inside
 * the composer, and the composer only exists on a pane with a live backend: the
 * driver's own `mentions` scene was written first and had to refuse, because on a
 * backend-less run the chat route paints its offline card and
 * `textarea[aria-label="Message"]` is not mounted at all. So this surface is
 * photographed where the repo already photographs this composer's popups
 * (`chat-slash-completion` is the same shape), and the ONE thing fixtures stand
 * in for is the IPC boundary: `probe-files` and `list-directory` are answered
 * from a named tree below, and every keystroke, every measure and every paint
 * after that is the shipped code.
 *
 * WHAT THAT MEANS FOR A READER OF A FRAME: the ROWS are a fixture tree, so this
 * set is evidence about what the picker does with a listing rather than about what
 * a particular directory contains; and a chip's resolution comes from the fixture
 * facts, so a chip here proves the drawing, the measurement and the rule
 * (`chip <=> the token resolves`), not that `stat` agrees. The live half of both
 * claims is what `scripts/renderer-driver.mjs --scene mentions` is for; its doc
 * block names the flags it needs and why it cannot run without them.
 *
 * Every state is reached by TYPING its draft rather than by handing a component a
 * state, so a frame cannot show a state the composer would not produce: the
 * picker's own debounce, the listing round trip and the chip's re-measure after
 * every keystroke all have to happen for a frame to exist at all.
 */

/*
 * The desktop bridge, installed at module scope and BEFORE the composer is
 * imported: `MessageInput` reaches `window.electron` from a passive effect on
 * mount, and a story that mounts it without the stand-in dies in
 * `commitHookEffectListMount` with "Cannot read properties of undefined (reading
 * 'ipcRenderer')". That module carries the measurement behind the ordering.
 */
import "./story-electron-shim";
import { desktopFeatureEnabled } from "@shared/api/local-operator/desktop-hooks";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent } from "@storybook/test";
import type { ReactNode } from "react";
import type { DesktopCapabilities } from "../../../../../shared/desktop-contract";
import type { Message } from "../types/message";
import { AT_UNAVAILABLE_REASON } from "./at-contract";
import { DEFAULT_MESSAGE_SUGGESTIONS } from "./composer-suggestions";
import { MessageInput } from "./message-input";

type Entry = { name: string; directory: boolean };

/**
 * The tree the picker lists, keyed by the directory AS TYPED.
 *
 * A named fixture rather than a fabricated filesystem: the names are the shapes
 * the frames have to answer — a directory to drill into, a nested one whose rows
 * carry a parent column, a file whose name has a space in it, an empty directory,
 * and enough entries for the row budget to bind — and every state's draft types a
 * path that exists here, so a frame cannot show a chip the fixture does not back.
 */
const TREE: Record<string, Entry[]> = {
	"": [
		// Ten entries, so the region's measured budget binds rather than showing the
		// whole listing: this is the frame the row budget is read from.
		{ name: "docs", directory: true },
		{ name: "empty", directory: true },
		{ name: "src", directory: true },
		{ name: "AGENTS.md", directory: false },
		{ name: "my file.txt", directory: false },
		{ name: "package.json", directory: false },
		{ name: "README.md", directory: false },
		{ name: "tsconfig.json", directory: false },
		{ name: "vitest.config.ts", directory: false },
		{ name: "SECURITY.md", directory: false },
		/*
		 * A NAME WIDER THAN THE NARROWEST REGION, so the frames carry the shape QA
		 * round 2's Q-5 measured rather than only the shape that fits: a 58-character
		 * name is ~450px of `font-mono`, against the 242px region an 800x600 window
		 * gives this popup. It sorts LAST on purpose — the frames above read the
		 * leading rows and the footer's count, and a long first row would change what
		 * they say — while the region's own `scrollWidth` sees every row it holds,
		 * visible or not, which is what the row must not be able to move.
		 */
		{
			name: "zz-a-name-far-too-long-for-the-narrowest-region-this-popup-has.tsx",
			directory: false,
		},
	],
	"src/": [
		{ name: "components", directory: true },
		{ name: "app.py", directory: false },
		{ name: "main.ts", directory: false },
	],
	"src/components/": [
		{ name: "button.tsx", directory: false },
		{ name: "card.tsx", directory: false },
		{ name: "dialog.tsx", directory: false },
	],
	"docs/": [{ name: "notes.md", directory: false }],
	"empty/": [],
};

/**
 * The paths the probe resolves, and which of them need approval.
 *
 * The second column is the ONE fact the chip's warning fill states, and it is
 * answered here the way the main process answers it — so a frame is evidence
 * about the fill and not about the containment test, which
 * `scripts/directory-listing.test.mjs` covers against real symlinks.
 */
const FILES: Record<string, { outside?: boolean }> = {
	"README.md": {},
	"package.json": {},
	"my file.txt": {},
	"AGENTS.md": {},
	src: {},
	"src/app.py": {},
	"src/components": {},
	"src/components/button.tsx": {},
	// A name long enough to wrap the TOKEN itself at a 420px column, which is the
	// only way the two-fills-per-token rule can be photographed at all.
	"src/components/super-long-component-name.tsx": {},
	"docs/notes.md": {},
	"~/notes/personal.md": { outside: true },
};

/** The directory a listing is asked for, normalised the way the picker asks. */
const asListingKey = (dir: string): string =>
	dir === "" || dir === "." ? "" : dir.endsWith("/") ? dir : `${dir}/`;

/**
 * The two CAPABILITY answers the fixture boundary now has to give, because the
 * `@` affordance is gated on one of them.
 *
 * `mentionsEnabled` is decided by the shipped `desktopFeatureEnabled`, fed the
 * answer below rather than a hand-set boolean: a story that passed `true` would
 * photograph a decision nobody made, and the whole point of the gate is that the
 * DECISION is what has to be right.
 *
 * `WITHOUT_MENTIONS` is not a hypothetical. It is every install that exists: the
 * expansion is `local_operator/references.py`, which no release tag through
 * v0.56.8 carries, and the harness half that adds it (PR #1220) publishes no
 * capability key at all yet — so the key is what the composer reads, and its
 * ABSENCE is the case a user on today's release would meet.
 */
const HARNESS: Record<string, DesktopCapabilities> = {
	// A backend that expands a mention, and says so.
	withMentions: {
		desktop_contract: 1,
		desktop_available: true,
		desktop_auth: "bearer",
		features: { references: 1, commands: 1, session_catalogue: 1 },
	},
	// Every backend that exists today: no `references` key, so no affordance.
	withoutMentions: {
		desktop_contract: 1,
		desktop_available: true,
		desktop_auth: "bearer",
		features: { commands: 1, session_catalogue: 1 },
	},
};

/**
 * The desktop bridge, installed at module scope for the reason
 * `./story-electron-shim` states for `window.electron`: the composer reaches the
 * bridge from an effect on mount, and Storybook's preview mocks `window.api`
 * rather than these channels. Three channels are replaced - the two listing ones
 * and `capabilities`, whose answer the mention gate reads - and every other op is
 * a 5xx, so a story that starts depending on another one says so loudly instead
 * of rendering a surface with quietly missing data.
 */
const installFixtureBridge = (harness: (typeof HARNESS)[string]) => {
	const api = (window.api ?? {}) as Record<string, unknown>;
	api.listDirectory = async (dir: string) => {
		// `boom/` is a directory that cannot be read: the error row is a state the
		// design names, and a rejection is the honest way to reach it.
		if (asListingKey(dir) === "boom/")
			throw new Error("EACCES: permission denied");
		return {
			dir: `/Users/you/project/${dir}`,
			entries: TREE[asListingKey(dir)] ?? [],
			truncated: false,
		};
	};
	api.probeFiles = async (paths: string[]) =>
		paths.map((input) => {
			const hit = FILES[input];
			return {
				input,
				resolved: `/Users/you/project/${input}`,
				exists: Boolean(hit),
				isFile: !input.endsWith("components"),
				sizeBytes: 12,
				mtimeMs: 1,
				outsideWorkspace: hit?.outside,
			};
		});
	api.desktop = {
		request: async (request: { op: string }) =>
			request.op === "capabilities"
				? {
						status: 200,
						body: { result: harness },
					}
				: { status: 501, body: { detail: "this story has no backend" } },
	};
	window.api = api as typeof window.api;
};
installFixtureBridge(HARNESS.withMentions);

/** The store key a state's draft lives under: per conversation, so two states
 *  cannot show each other's text. */
const storyColumn = (story: string) => `at-mentions-${story}`;

/**
 * The band the composer lives in, at the app's own default width.
 *
 * `h-screen` and `flex-col` so the band's own `grow` resolves the way it does in
 * the app, and a label in the slot the app's header would occupy — which is what
 * keeps the composer off the viewport's bottom edge and stops a frame reading as
 * a full-window screenshot it is not. Copied in shape from
 * `composer-band.stories.tsx`'s `Column`, for the reason every story file here
 * carries its own: a frame's harness is the frame's business.
 */
const Column = ({
	label,
	width,
	story,
	children,
}: {
	label: string;
	width?: number;
	story: string;
	children: ReactNode;
}) => (
	<div className="flex h-screen w-screen justify-center bg-canvas">
		<div
			className="flex h-full w-full flex-col"
			style={width ? { width } : undefined}
			data-story-column={width ?? "viewport"}
		>
			<span className="border-hairline border-b bg-canvas px-6 py-2 font-mono text-ink-dim text-mono-sm">
				{label}
			</span>
			<div
				className="flex grow flex-col justify-end"
				data-story-composer={story}
			>
				{children}
			</div>
		</div>
	</div>
);

const EMPTY: Message[] = [];

/**
 * One state: what the play types, and the precondition the frame waits for.
 *
 * The precondition is part of the state rather than a per-story detail because it
 * is the assertion the frame rests on: a capture taken before the listing
 * resolved would be a photograph of "Reading this folder…" wearing another
 * state's name.
 */
type DraftStory = {
	/** This state's own key: the draft store is per conversation, and distinct ids
	 *  are what keep one state's draft out of another one's frame. */
	story: string;
	/** What the play types into the box, character by character. */
	draft: string;
	/** The sentence printed above the frame. */
	label: string;
	/** A narrower column, for the wrap and budget states. */
	width?: number;
	/**
	 * The composer's SMALL VIEW — the app's own "this column is under 550px" flag
	 * (`chat-content.tsx`), not a width. It is what switches the field's inset to
	 * `px-1.5`, which is the number the 6px overhang was chosen against.
	 */
	smallView?: boolean;
	/**
	 * Which harness this state is photographed against. Defaults to the one that
	 * expands a mention; `withoutMentions` is the harness every release carries
	 * today, and the gate's own state.
	 */
	harness?: keyof typeof HARNESS;
	/** Where the caret is left, when the state is about the caret. */
	moveCaretTo?: (box: HTMLTextAreaElement) => void;
	/** True once the state the frame is OF exists on screen. */
	settled: () => boolean;
	/**
	 * A GESTURE this state is about, run once `settled` holds and before the frame
	 * is taken. Real keys through `userEvent`, for the reason the draft is typed:
	 * the composer's caret is React state fed by real keystrokes, and a range set
	 * from outside does not reliably reach it (QA round 1 measured exactly that).
	 *
	 * Named `gesture` and not `then`: an object property called `then` makes the
	 * object a thenable, and biome refuses the name outright for that reason.
	 */
	gesture?: (box: HTMLTextAreaElement) => Promise<void>;
	/**
	 * The precondition the frame needs AFTER `then`, and the assertion that makes
	 * the gesture's outcome evidence rather than decoration: a play that throws
	 * never releases the shutter, so the capture fails loudly instead of
	 * photographing a state the gesture did not reach.
	 */
	after?: () => boolean;
};

/*
 * The capturer's shutter, and the once-per-document play guard, both copied from
 * `composer-band.stories.tsx`'s contract rather than re-invented: a play runs MORE
 * THAN ONCE per load when the story's args settle after the first render, so an
 * unguarded play types the draft twice into a box that already holds it.
 */
const holdShutter = () => {
	document.documentElement.dataset.capturePending = "1";
};
const releaseShutter = () => {
	delete document.documentElement.dataset.capturePending;
};
const played = new Set<string>();

const poll = async (predicate: () => boolean, what: string) => {
	for (let attempt = 0; attempt < 80; attempt++) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error(`the story's state never arrived: ${what}`);
};

/** The rows the picker is showing, or 0 when there is no list at all. */
const rowCount = (): number =>
	document.querySelectorAll(
		'[role="listbox"][aria-label="Files"] [role="option"]',
	).length;

/** The chip fills on screen: the chip layer's own count. */
const chipCount = (): number =>
	document.querySelectorAll("[data-mention-chip]").length;

/** The composer's own value, read off the DOM: what a gesture left in the box. */
const boxValue = (): string =>
	document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')
		?.value ?? "";

/**
 * The picker's one-row notice, or null when no notice is up.
 *
 * READ BY ITS OWN HOOK rather than through the listbox's text, because the notice
 * is now two things: the row an empty listing paints INSIDE the listbox, and the
 * whole of the `harness-cannot-expand` shell, which is deliberately not a listbox
 * (there are no options to be in) — a selector that went through the role could
 * not reach the sentence this set exists to photograph (UX round 2, U12). The row
 * carries `data-mention-notice` in both places for exactly that reason.
 */
const noticeText = (): string | null =>
	document.querySelector("[data-mention-notice]")?.textContent ?? null;

/**
 * The play every state shares: install the bridge, type the draft, wait for the
 * state, and only then let the capturer's shutter close.
 *
 * The draft is TYPED rather than seeded because the two things a frame here is
 * evidence about — the picker opening on the token under the caret, and the chip
 * being re-measured after every keystroke — are properties of the typing path. A
 * seeded draft would photograph the last state of a derivation nobody ran.
 */
const draftPlay =
	(state: DraftStory) =>
	async ({ canvasElement }: { canvasElement: HTMLElement }) => {
		if (played.has(state.story)) return;
		played.add(state.story);
		holdShutter();
		try {
			installFixtureBridge(HARNESS[state.harness ?? "withMentions"]);
			const box = canvasElement.querySelector<HTMLTextAreaElement>(
				'textarea[aria-label="Message"]',
			);
			if (!box) throw new Error("the composer's textarea is not in this story");
			/*
			 * IDEMPOTENT, and that is not tidiness. A play can run more than once for
			 * one mounted story — Storybook re-runs it when the args settle after the
			 * first render, and an HMR update re-runs it on the story already on
			 * screen — so a play that only types leaves `@@` in the box on the second
			 * pass, which is a draft the composer would never have produced and a
			 * frame taken of it would be evidence about a typo. Clearing first makes
			 * the second pass converge on the state the first one reached.
			 */
			if (box.value !== state.draft) {
				await userEvent.clear(box);
				await userEvent.type(box, state.draft);
			}
			await userEvent.click(box);
			if (box.value !== state.draft)
				throw new Error(
					`the draft did not reach the field: ${JSON.stringify(box.value)}`,
				);
			if (state.moveCaretTo) state.moveCaretTo(box);
			await poll(state.settled, `after typing ${JSON.stringify(state.draft)}`);
			if (state.gesture) await state.gesture(box);
			/*
			 * `after` runs whether or not there was a gesture, because two of the states
			 * that need it are not gestures at all: the row budget's own arithmetic
			 * (QA round 1's Q-1) is a MEASUREMENT of the region the frame is about, and
			 * a frame whose cap is not a whole number of rows is not evidence about a
			 * budget. It is polled like `settled`, and it may throw through `expect`: the
			 * capturer stops the sweep on a play that threw (`capture-evidence.mjs`),
			 * which is what makes this an assertion rather than a note.
			 */
			if (state.after)
				await poll(
					state.after,
					`after the gesture that follows ${JSON.stringify(state.draft)}`,
				);
		} finally {
			releaseShutter();
		}
	};

const meta: Meta = {
	title: "Chat/Mention chips",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/** One state, rendered and driven: the frame and its play cannot describe
 *  different drafts, because there is one object. */
const stateStory = (state: DraftStory): Story => ({
	render: () => (
		<Column label={state.label} width={state.width} story={state.story}>
			{/*
			 * The pool is passed so the frame carries the band the app's empty chat
			 * shows — tip row, suggestion chips and all — because the design's third
			 * prediction is about the SPLASH that the stack claims, and a story without
			 * suggestions has no splash to measure. Its fourth is about the row budget,
			 * and the splash is most of what the picker's anchor has to fit under.
			 */}
			<MessageInput
				isLoading={false}
				messages={EMPTY}
				conversationId={storyColumn(state.story)}
				cwd="/Users/you/project"
				initialSuggestions={DEFAULT_MESSAGE_SUGGESTIONS}
				isSmallView={state.smallView ?? false}
				/*
				 * THE GATE, evaluated by the SHIPPED function rather than handed in as a
				 * boolean: the story feeds it the fixture's capability answer, so the frame
				 * is evidence about the decision the app makes and not about a prop a story
				 * chose. `desktop-hooks.ts`'s `references` is the key, and the
				 * `withoutMentions` harness below is what every release carries today.
				 */
				mentionsEnabled={desktopFeatureEnabled(
					HARNESS[state.harness ?? "withMentions"],
					"references",
				)}
				/*
				 * The other half of the gate, from the same fixture answer: the composer's
				 * sentence may only be said when the BACKEND is the reason the affordance is
				 * absent, so the story derives the unsupported fact the way `chat-page.tsx`
				 * does — an answer that arrived (the fixture bridge always answers) and says
				 * the harness is available without the key.
				 */
				mentionsUnsupported={
					!desktopFeatureEnabled(
						HARNESS[state.harness ?? "withMentions"],
						"references",
					)
				}
				onSendMessage={async () => true}
			/>
		</Column>
	),
	play: draftPlay(state),
});

/*
 * ---- the chip -----------------------------------------------------------------
 */

/**
 * BEFORE: the same sentence with no `@` token at all.
 *
 * The pair's other half, and the honest before frame: it is what `origin/main`
 * paints for a draft that names the same file as prose, because main has no chip
 * layer at all. A reader comparing this with `MentionAtRest` is comparing the
 * feature rather than two of its states.
 */
export const BeforeNoMentions: Story = stateStory({
	story: "before",
	label: "before: the same sentence, no @ token - what origin/main paints",
	draft: "look at src/app.py then fix the parser",
	settled: () => chipCount() === 0,
});

/** A mention at rest, mid-sentence: the chip's ordinary state. */
export const MentionAtRest: Story = stateStory({
	story: "at-rest",
	label:
		"a mention mid-sentence: the fill sits behind the sentence's own glyphs",
	draft: "look at @src/app.py then fix the parser",
	settled: () => chipCount() === 1,
});

/**
 * The two EDGES: one mention opening the draft and one closing it.
 *
 * At the start the 6px overhang lands inside the field's own `px-2` inset and
 * never reaches the box's 16px padding, which is why the overhang is 6px rather
 * than 8px. At the end the fill stops at the token's last glyph plus overhang,
 * with the caret outside it — which is what makes the atomic Backspace read as
 * "delete this whole thing".
 */
export const MentionsAtTheEdges: Story = stateStory({
	story: "edges",
	label: "a mention at the very start of the draft, and one at the very end",
	// A trailing space closes the token, so the frame is the chip AT REST: the
	// grammar makes a token that ends at the buffer's edge the active one, and an
	// active token opens the picker over the sentence.
	draft: "@src/app.py is the entry point and @README.md ",
	settled: () => chipCount() === 2,
});

/**
 * Two mentions on one line, separated by the space's own advance.
 *
 * True adjacency is impossible by grammar — a token opens only at a boundary, so
 * `@a.py@b.py` is ONE unresolvable span and not two chips — and this is the
 * reachable case. The property to read off the frame is that the two fills never
 * touch: the side each chip turns toward the other spends the whole space as
 * separator (the overhang there is 0, because the ground one space wide is
 * exactly the advance a facing side must leave unpainted), while the outer 6px
 * overhangs stand on both chips.
 *
 * WHAT THIS FRAME IS NOT: it is the one-space case, and the rule's distance term
 * (design round 2, D9) is what keeps it from being the ONLY case — a chip whose
 * neighbour is 39px or 149px away keeps its full 6px on that side, which is what
 * `mentions-at-the-edges` and `chip-needs-approval` show. Three mentions on one
 * line at one space each leave the MIDDLE chip flush at both ends; the design
 * record's § 5 state 10 states that consequence, and no committed frame covers it.
 */
export const AdjacentMentions: Story = stateStory({
	story: "adjacent",
	label: "two mentions on one line: the two fills do not touch",
	// The trailing space is what makes these two chips a state rather than a
	// gesture: an active token opens the picker, and this frame is about the two
	// fills and the ground between them.
	draft: "@src/app.py @README.md ",
	settled: () => chipCount() === 2,
});

/**
 * THE QUOTED FORM, and the frame the merge defect was invisible in: `@"my file.txt"`
 * paints ONE fill over a space.
 *
 * `adjacent-mentions` argues that two chips are not one, by measuring the ground
 * through the seam; this is the other half of that pair, because a single token
 * that legitimately spans a space is exactly what a merged pair USED to look like
 * — the two same-coloured fills covering both tokens and the separator between them
 * are one rectangle over one space. So a reader needs this frame beside that one:
 * one fill over a name with a space, and two fills with a space's advance of
 * unpainted ground down the middle. Both design round 1's D2 and review round 2
 * named the absent frame (design round 2's D2 / code round 2's M5 note).
 *
 * The token is TYPED, and the grammar recognises it rather than the picker writing
 * it: the quoted form is the port of the harness's own `@"…"` (`at-token.ts`), so
 * this is the same rule the picker's write satisfies, reached the other way.
 */
export const QuotedMention: Story = stateStory({
	story: "quoted",
	label: 'the quoted form @"my file.txt": one fill over a name with a space',
	draft: 'open @"my file.txt" then stop',
	settled: () => chipCount() === 1,
});

/**
 * A token that does NOT resolve, beside one that does.
 *
 * The valuable half of `chip <=> the token resolves`, and the one place this
 * surface can close a gap the terminal cannot: the harness sends an unresolved
 * token verbatim and silently, so the chip's ABSENCE is where that notice lives.
 * `@src/ap.py` is one character away from a file that exists and is plain text.
 */
export const UnresolvedStaysProse: Story = stateStory({
	story: "unresolved",
	label:
		"a path that names nothing is prose: no chip, no notice, sent as written",
	draft: "look at @src/ap.py and @README.md ",
	settled: () => chipCount() === 1,
});

/**
 * The outside-workspace fill, beside an ordinary one.
 *
 * WHAT IT ENCODES IS CONTAINMENT, not the approval decision: the gate stays where
 * it is, at submit, and a deny-listed path INSIDE the workspace takes the ordinary
 * fill while still raising a card (design round 1, D8 — the constant is named for
 * the fact it can answer).
 *
 * The step is a HUE step, and in three palettes it is not a step a reader can see
 * — `kanagawaLotus` ΔE00 0.72, `sage` 1.44, `paper` 1.61 between the two fills —
 * which is why this chip ALSO carries a `border-warning-border` edge (design round
 * 1, D1). Read the frame for that: the outside fill's boundary is a rule the
 * ordinary chip does not have, and it is the signal that survives the palettes
 * whose two washes are one colour.
 */
export const ChipNeedsApproval: Story = stateStory({
	story: "approval",
	label:
		"a reference outside the workspace takes the warning wash; the ordinary one does not",
	draft: "compare @src/app.py with @~/notes/personal.md ",
	settled: () => chipCount() === 2,
});

/**
 * The caret INSIDE a token: the picker opens on it, filtered by the text left of
 * the caret.
 *
 * Clicking into the middle of a chip cannot split it — there is one decoration per
 * maximal token span, and a span is not divisible by a click — so the observable
 * consequence of that gesture is this frame: the chip is still there, with the
 * list up over it offering what the token's directory holds. The caret itself is
 * not painted in a headless capture, and this frame does not claim to show it.
 */
export const CaretInsideToken: Story = stateStory({
	story: "caret-inside",
	label:
		"the caret inside a mention: the list opens on the token, filtered left of the caret",
	draft: "@src/components/button.tsx",
	moveCaretTo: (box) => box.setSelectionRange(15, 15),
	settled: () =>
		chipCount() === 1 &&
		document.querySelector('[role="listbox"][aria-label="Files"]') !== null,
});

/** A token that wraps: two fills, with the line gap between them. */
export const WrappedMention: Story = stateStory({
	story: "wrapped",
	width: 420,
	label:
		"a mention that wraps at a 420px column: two fills, clear ground between them",
	// A name long enough that the TOKEN itself crosses the line: 43 characters at
	// 14px mono is wider than the 338px field a 420px column leaves.
	draft: "see @src/components/super-long-component-name.tsx",
	// Exactly two, so a frame where the token did not wrap cannot pass as
	// evidence about wrapping.
	settled: () => chipCount() === 2,
});

/*
 * ---- the picker ---------------------------------------------------------------
 */

/** The bare `@`: the whole working directory, ranked, with the count on the right. */
export const PickerOpen: Story = stateStory({
	story: "picker-open",
	label:
		"a bare @ lists the working directory, ranked, with the row budget measured",
	draft: "@",
	settled: () => rowCount() > 0,
});

/**
 * Drilled one level: the header names the directory and the rows carry a parent
 * column, which is what keeps a deep path readable.
 */
export const PickerDrilled: Story = stateStory({
	story: "picker-drilled",
	label:
		"drilled into src/: the header states the directory, each row where it lives",
	draft: "@src/",
	settled: () => rowCount() > 0,
});

/**
 * A query that narrows — and the descend rule, taken from the reference: a
 * directory that MATCHES contributes its own children as rows, appended after it,
 * bounded to the top two matching directories and one level each.
 *
 * The draft has to be DRILLED for this to be reachable: `components` lives in
 * `src/`, so a bare `@com` at the working directory matches nothing in the
 * fixture and is photographed as the no-match state instead (measured, and the
 * reason this story's draft carries `src/`). Under `src/`, `components` is a
 * prefix match, so the frame carries that row and the three files under it, whose
 * parent column then reads `src/components/`. Without a parent column a descended
 * row would be a name with no address, which is why the reference has one.
 */
export const PickerDescend: Story = stateStory({
	story: "picker-descend",
	label:
		"a fuzzy query that matches a directory and its children, one level deep",
	draft: "@src/com",
	settled: () => rowCount() > 0,
});

/**
 * NOTHING MATCHES, and the picker stays up with a one-row notice.
 *
 * The state the harness's own picker gets wrong: PR #1220 records its composer
 * moving one row — measured at +17px across one keystroke — because its no-match
 * branch closes the list outright. A still cannot show "nothing moved"; what it
 * shows is that the list is STILL THERE, which is the half that makes +0px
 * possible. The numbers are the driver scene's.
 */
export const PickerNoMatch: Story = stateStory({
	story: "picker-no-match",
	label: "nothing matches: the picker holds, with a notice naming the query",
	draft: "@zzzz",
	settled: () => noticeText() !== null,
});

/** An empty directory: a different fact from "nothing matches", so a different sentence. */
export const PickerEmptyFolder: Story = stateStory({
	story: "picker-empty",
	label: "an empty directory: a fact about the folder, not about the query",
	draft: "@empty/",
	settled: () => (noticeText() ?? "").includes("empty"),
});

/** A directory that cannot be read: what happened, then what it means. */
export const PickerUnreadable: Story = stateStory({
	story: "picker-error",
	label: "an unreadable directory: the reason travels with the sentence",
	draft: "@boom/",
	settled: () => (noticeText() ?? "").includes("Could not read"),
});

/**
 * The row budget at its ceiling, and then at its floor.
 *
 * The same story captured twice by the rig, at a normal window and at a short one:
 * the region's height is a whole multiple of the 35.5px pitch, computed from the
 * space between the anchor and the nearest clipping ancestor, so a short window
 * shows FEWER ROWS rather than a shell pushed off the bottom. That is the design's
 * open item 3, and it is a claim about two frames rather than about arithmetic.
 */
export const PickerManyRows: Story = stateStory({
	story: "picker-rows",
	label:
		"ten entries listed: the region stops at its measured budget and scrolls",
	draft: "@",
	settled: () => rowCount() > 0,
	/*
	 * THE ROW BUDGET, MEASURED IN THE BROWSER RATHER THAN RECOMPUTED (QA round 1,
	 * Q-1). The region's cap is `budget x AT_ROW_PITCH` and the rows measure their
	 * own height, so the one thing the arithmetic cannot check about itself is
	 * whether those two numbers agree — which is exactly what was wrong: a 36px
	 * pitch over 35.5px rows capped the region 4.0px into a ninth row and painted a
	 * sliver of it. This reads BOTH numbers off the rendered DOM, at every viewport
	 * this story is captured at (1380x768, 1380x872, 800x600 and 768x520), and
	 * throws if the cap is not a whole number of the rows the browser actually laid
	 * out. A sweep that captures a budget frame therefore also asserts the budget.
	 *
	 * AND THE REGION MUST NOT SCROLL SIDEWAYS, which is the same claim one step out
	 * (QA round 2, Q-5): an `overflow-x` bar takes 8px off the region's CLIENT box,
	 * so at 800x600 the cap above was right to the half pixel and the region still
	 * painted four rows and 28px of a fifth while the footer counted five. The
	 * fixture's own long name is what makes that measurable here rather than in an
	 * argument, and the assertion is on the box the ROWS get, not on the class list.
	 */
	after: () => {
		const list = document.querySelector('[role="listbox"][aria-label="Files"]');
		if (!list) return false;
		const region = [...list.children].find(
			(child): child is HTMLElement =>
				child instanceof HTMLElement && child.style.maxHeight !== "",
		);
		const row = list.querySelector<HTMLElement>('[role="option"]');
		if (!region || !row) return false;
		const cap = Number.parseFloat(region.style.maxHeight);
		const pitch = row.getBoundingClientRect().height;
		// The visible box, not `clientHeight`: that rounds to an integer, and every
		// number in this geometry is a half pixel.
		const visible = region.getBoundingClientRect().height;
		expect(pitch).toBeGreaterThan(0);
		expect(Math.abs(cap - Math.round(cap / pitch) * pitch)).toBeLessThan(0.02);
		expect(
			Math.abs(visible - Math.round(visible / pitch) * pitch),
		).toBeLessThan(0.02);
		// Q-5: no horizontal bar, so the rows keep the whole cap. `clientWidth` is
		// the box the rows are laid out in and `scrollWidth` is what they needed.
		expect(region.scrollWidth).toBeLessThanOrEqual(region.clientWidth);
		return true;
	},
});

/*
 * ---- the two states the gates exist for ---------------------------------------
 */

/**
 * A HARNESS THAT DOES NOT EXPAND A MENTION: no list, no chip, plain text.
 *
 * THE STATE EVERY RELEASE CARRIES TODAY. The expansion is
 * `local_operator/references.py`, which no tag through v0.56.8 has, and the
 * harness half that adds it is PR #1220 — in review, and publishing no capability
 * key at all yet. So the composer reads `desktop-hooks.ts`'s `references` key and
 * withholds the whole affordance when it is absent, because the alternative is a
 * picker whose pick writes a chip claiming a reference the model never receives.
 *
 * The draft carries BOTH facts in one frame on purpose: a token that would be a
 * chip if the harness could expand it, and a bare `@` at the caret that would open
 * the list. Read off the frame: neither happens, the text is exactly what will be
 * sent, and the ONE SENTENCE the caret's `@` brings on says why (UX round 2,
 * U12). That sentence is the whole of this state's answer to "I typed `@` and
 * nothing happened": it names the backend as the reason, promises no update, and
 * costs the composer no geometry because it stands in the list's own
 * `absolute bottom-full` slot.
 */
export const HarnessCannotExpand: Story = stateStory({
	story: "no-references",
	harness: "withoutMentions",
	label:
		"a harness that cannot expand a mention: no list, no chip, one sentence saying why, the path sent as written",
	draft: "look at @src/app.py then fix @",
	settled: () =>
		chipCount() === 0 &&
		rowCount() === 0 &&
		noticeText() === AT_UNAVAILABLE_REASON,
});

/**
 * The SMALL VIEW: the field's 6px inset, which is the number the overhang was
 * chosen against.
 *
 * `isSmallView` is the app's own flag for a column under 550px, and it is what
 * switches the composer box to `px-1.5`. The design's § 5.11 prediction is that a
 * mention opening the draft reaches that inset's edge EXACTLY and stops there at
 * this width — the one number that decided 6px rather than 8px — and no committed
 * frame had shown it (design round 1, D7). The narrowest frame that existed was a
 * normal-view composer in a narrow window, which is the one thing this is not.
 */
export const SmallViewMention: Story = stateStory({
	story: "small-view",
	width: 520,
	smallView: true,
	label:
		"the small view (column under 550px): the fill reaches the field's 6px inset edge",
	draft: "@src/app.py is the entry point",
	settled: () => chipCount() === 1,
});

/**
 * The FIELD'S OWN SCROLL, with a chip on it.
 *
 * The chip layer is a drawing translated by the field's `scrollTop`, and the
 * design states that as a property of the layer. It had never been executed: every
 * story's draft was a single line, so nothing in the set showed the field past
 * `max-h-28` (review round 1, N3). The precondition asserts the scroll, not just
 * the chip, so a frame taken with the field at rest cannot pass as evidence about
 * it.
 */
export const ScrolledDraft: Story = stateStory({
	story: "scrolled",
	label: "a draft past max-h-28: the fills travel with the field's own scroll",
	draft: `${"the parser needs a second pass over the tree before it can answer ".repeat(6)}see @src/app.py`,
	settled: () => {
		const box = document.querySelector<HTMLTextAreaElement>(
			'textarea[aria-label="Message"]',
		);
		return chipCount() === 1 && (box?.scrollTop ?? 0) > 0;
	},
});

/**
 * THE ATOMIC DELETE, which is the one chip promise that is not a drawing.
 *
 * One Backspace with the caret at a chip's right edge takes the whole token — and
 * the single separator in front of it — in one keystroke. It routes through the
 * same `replaceSpan` the inline slash gesture uses, and it is exercised here with
 * REAL keys: the composer's caret is React state, and QA round 1 measured that a
 * range set from outside does not reliably reach it.
 *
 * Seven arrow presses from the end of `see @README.md please` land the caret on
 * the token's last cell. `after` asserts what the gesture left in the box, so a
 * frame is only taken if the delete actually happened.
 */
export const AtomicDelete: Story = stateStory({
	story: "atomic-delete",
	label:
		"one Backspace at a chip's edge: the whole token goes, in one keystroke",
	draft: "see @README.md please",
	settled: () => chipCount() === 1,
	gesture: async () => {
		for (let press = 0; press < 7; press++)
			await userEvent.keyboard("{ArrowLeft}");
		await userEvent.keyboard("{Backspace}");
	},
	after: () => boxValue() === "see please" && chipCount() === 0,
});

/**
 * ENTER OVER A LIST WITH NO ROWS, which is the reflex "choose this file".
 *
 * The picker is up on a query that matched nothing — the state a brand-new chat's
 * first `@` reached on the reviewed head, because the draft's cwd of `"~"` listed
 * nothing. Enter used to be handed straight to the composer's submit path, so the
 * user's half-written sentence was SENT while they believed they had picked a row
 * (UX round 1, U3). It is now held by the open list.
 *
 * The frame is the note: the draft is still in the box and the list is still up,
 * and `after` is what makes that an assertion rather than a picture.
 */
export const NoRowsEnter: Story = stateStory({
	story: "no-rows-enter",
	label:
		"Enter over a list with no rows: the sentence is not sent, the list stands",
	draft: "@zzzz",
	settled: () => noticeText() !== null,
	gesture: async () => {
		await userEvent.keyboard("{Enter}");
	},
	after: () => boxValue() === "@zzzz" && noticeText() !== null,
});
