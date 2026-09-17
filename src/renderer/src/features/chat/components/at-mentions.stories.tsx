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
import type { Meta, StoryObj } from "@storybook/react";
import { userEvent } from "@storybook/test";
import type { ReactNode } from "react";
import type { Message } from "../types/message";
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
 * The desktop bridge, installed at module scope for the reason
 * `./story-electron-shim` states for `window.electron`: the composer reaches the
 * bridge from an effect on mount, and Storybook's preview mocks `window.api`
 * rather than these two channels. Only the two channels this surface uses are
 * replaced, so the preview's own mocks for everything else survive.
 */
const installFixtureBridge = () => {
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
	window.api = api as typeof window.api;
};
installFixtureBridge();

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
	/** Where the caret is left, when the state is about the caret. */
	moveCaretTo?: (box: HTMLTextAreaElement) => void;
	/** True once the state the frame is OF exists on screen. */
	settled: () => boolean;
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

/** The picker's one-row notice, or null when the list has rows (or is not up). */
const noticeText = (): string | null => {
	const list = document.querySelector('[role="listbox"][aria-label="Files"]');
	if (!list) return null;
	if (list.querySelector('[role="option"]')) return null;
	return list.textContent ?? null;
};

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
			installFixtureBridge();
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
 * touch: each is its own rectangle with its own 6px overhang, and the space
 * itself is unpainted.
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
 * The needs-approval fill, beside an ordinary one.
 *
 * The chip asserts nothing about the approval decision — the gate stays where it
 * is, at submit — it only says which references will raise a card. The step is a
 * HUE step (ΔE00 5.37 at its worst, where the luminance ratio for the same pair
 * is 1.06:1), which is why the two states are one weight and the contrast
 * contract measures the pair that way.
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
 * the region's height is a whole multiple of the 36px pitch, computed from the
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
});
