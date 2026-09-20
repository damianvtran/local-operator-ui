import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { act } from "react";

/*
 * THE TRANSFER ROW'S OWN DOM CONTRACT, against the SHIPPED component.
 *
 * WHY THIS IS A TEST AND NOT ONLY THE FRAMES. Round 2's findings against this
 * surface were all about DOM shape rather than pixels: the ticking progress span
 * sitting INSIDE the row's `aria-live` region (U8), a refusal carrying no age
 * (U9), an upload line naming a count instead of the files (U11), a cancelled
 * write saying "nothing was saved" about a partial that existed (R2-5), and the
 * specimens rendering nothing because their fixtures were older than the TTL
 * (D10). A frame can show the last of those; none of the others is visible in a
 * still, and the one that is (the clipped rule clause) needs a layout engine.
 *
 * WHAT IS AND IS NOT EVIDENCE HERE. jsdom has no layout engine, so this file
 * holds the DOM contract — which text is in the live region, which spans are
 * `aria-hidden`, what the row's `title` carries, and what a fixture older than the
 * TTL renders. The LAYOUT half (which span clips at 800px) is `G8` in
 * `browser-file-transfer-proof.mjs` against the built app, and the pixels are the
 * committed frames. Neither half stands in for the other.
 *
 * The shipped TypeScript is bundled in memory with esbuild, the same way
 * `browser-tab-strip-focus.test.mjs` drives the tab strip.
 */

// React DOM feature-detects input events at import time, so the document has to
// exist before it is loaded. A real origin, not jsdom's opaque default.
const dom = new JSDOM(
	'<!doctype html><html><body><div id="root"></div></body></html>',
	{ pretendToBeVisual: true, url: "http://localhost/" },
);
globalThis.window = dom.window;
globalThis.document = dom.window.document;
for (const key of Object.getOwnPropertyNames(dom.window)) {
	if (key in globalThis) continue;
	try {
		globalThis[key] = dom.window[key];
	} catch {
		// Accessors jsdom defines on the window take no new value; the DOM globals
		// this file needs are the ones already copied above.
	}
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");

after(() => {
	dom.window.close();
	globalThis.window = undefined;
	globalThis.document = undefined;
});

const ENTRY = `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { BrowserFileTransferRow } from "./src/renderer/src/features/browser/components/browser-file-transfer-row";

/**
 * The row is a pure function of the projection, so one mount is one state.
 *
 * \`tabLabelKind\` selects the surface's own closure shape: it answers from the
 * SECOND argument alone, which is exactly the case U10 is about — the host's
 * recorded kind being the only thing left when the tab record is gone.
 */
export function mount(container, props) {
	const tabLabel = props.answerFromOwnerKind
		? (_tabId, ownerKind) =>
				ownerKind === "agent" ? "· on the agent's tab" : "· on another tab"
		: undefined;
	const root = createRoot(container);
	root.render(
		createElement(BrowserFileTransferRow, {
			transfers: props.transfers,
			onReveal: () => {},
			tabLabel,
		}),
	);
	return root;
}

/**
 * THE STORYBOOK SPECIMENS' OWN FIXTURES, mounted through the shipped component.
 *
 * The stories module has no runtime dependency on Storybook (its Meta/StoryObj
 * imports are type-only), so the committed props can be rendered here — which is what
 * makes "every decided specimen paints" a check rather than a screenshot somebody has
 * to take again. See the D10 case below for why that matters.
 */
export * as stories from "./src/renderer/src/features/browser/components/browser-file-transfer-row.stories";
`;

const bundle = await build({
	stdin: {
		contents: ENTRY,
		resolveDir: process.cwd(),
		sourcefile: "file-transfer-row.mjs",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	jsx: "automatic",
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
	},
	loader: { ".css": "empty" },
	write: false,
});
const bundlePath = new URL(
	`./_file-transfer-row-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { mount, stories } = await import(bundlePath.href);
await unlink(bundlePath);

const DIR =
	"/Users/someone/Library/Application Support/Local Operator/browser/downloads/20260919-120000-session1";

/** The host's own note shape, as the projection carries it. */
const note = (over = {}) => ({
	name: "receipt-1.pdf",
	count: 1,
	dir: DIR,
	outcome: "saved",
	reason: "",
	at: Date.now() - 5_000,
	direction: "download",
	site: "",
	refusal: null,
	tabId: 7,
	ownerKind: "user",
	...over,
});

const activity = (notes, active = null) => ({
	active,
	dir: DIR,
	notes,
	activeTabId: 7,
	recent: null,
});

/** Mount one state and hand back the row, as the DOM holds it.
 *
 * THE UNMOUNT IS REGISTERED ON THE TEST, not on a file-level hook: the row keeps a
 * 15 s `setInterval` for its age while a note is on screen, `setInterval` has no
 * `unref`, and only the component's own cleanup clears it — so a test that FAILS
 * mid-assertion would otherwise leave a live timer behind and the runner would sit
 * on an event loop that never drains (measured: the whole file timed out at 900 s
 * on the first draft, and at 300 s on the second, with every case already passed). */
async function open(t, props) {
	// A FRESH CONTAINER PER TEST: `createRoot` on a container that already held a
	// root warns and then reuses the old one, which is how a previous test's tree
	// leaks into the next.
	const container = document.createElement("div");
	document.body.append(container);
	let root = null;
	await act(() => {
		root = mount(container, props);
	});
	t.after(async () => {
		await act(() => root.unmount());
		container.remove();
	});
	const row = container.querySelector(
		'[data-tour-tag="browser-file-transfer-row"]',
	);
	const spans = () =>
		[...(row?.querySelectorAll("span") ?? [])].map((span) => ({
			text: span.textContent.trim(),
			hidden: span.getAttribute("aria-hidden") === "true",
			className: span.className,
			title: span.getAttribute("title"),
		}));
	return {
		container,
		row,
		text: () => row?.textContent?.replace(/\s+/g, " ").trim() ?? "",
		/** THE SENTENCE A BROWSER READS, which is not `textContent`.
		 *
		 * The row is a flex container, so its spans are blockified — and both `innerText`
		 * and a screen reader put a break where the box model does. jsdom has no layout
		 * engine, so its `textContent` runs the spans together ("brief.pdf+ 2 morewere
		 * attached toforms.example"), which is not what the rig reads out of the real
		 * app (`row.innerText` there, spaces and all). Joining the spans models the
		 * browser's own separation rather than asserting a run-together string that no
		 * user is ever shown. */
		spoken: () =>
			spans()
				.map((span) => span.text)
				.filter(Boolean)
				.join(" "),
		/** The row's ANNOUNCEMENT CHANNEL: the text an `aria-live` region would read,
		 * with everything `aria-hidden` taken out. */
		announced: () => {
			if (!row) return "";
			const clone = row.cloneNode(true);
			for (const hidden of clone.querySelectorAll("[aria-hidden]")) {
				hidden.remove();
			}
			return clone.textContent.replace(/\s+/g, " ").trim();
		},
		spans,
		title: () => row?.querySelector("p")?.getAttribute("title") ?? null,
	};
}

test("the ticking progress is OUT of the row's live region (review round 2, U8)", async (t) => {
	// The row is `<output aria-live="polite">`, so every change inside it is a
	// queued announcement. UX round 2 measured 15 mutation records / 6 distinct
	// texts in 2.5 s — ~2.4 announcements per second for as long as a transfer runs,
	// with the sentence that matters queued behind them.
	const slow = await open(t, {
		transfers: activity([], {
			name: "slow-a.pdf",
			received: 832 * 1024,
			total: 4 * 1024 * 1024,
			tabId: 7,
		}),
	});
	assert.ok(slow.row, "the row renders for a transfer in flight");
	const progress = slow.spans().find((span) => span.text.startsWith("(20%"));
	assert.ok(progress, "the progress copy is its own span");
	assert.equal(
		progress.hidden,
		true,
		"the moving number is aria-hidden, so it is not announced per tick",
	);
	assert.ok(
		!slow.announced().includes("832.0 KiB"),
		`the byte count must not be in the announced text: ${slow.announced()}`,
	);
	assert.match(
		slow.announced(),
		/Downloading\s*slow-a\.pdf/,
		"the state — which file is downloading — is still announced",
	);
});

test("a settled row's age is visible but not announced (review round 2, U8/U9)", async (t) => {
	// The age is a staleness cue for the glance that finds the row still on screen;
	// it re-renders on the 15 s tick, so announcing it would be the same flood as
	// the progress line, slower.
	const saved = await open(t, { transfers: activity([note()]) });
	assert.match(saved.spoken(), /· just now/, "the age is on screen");
	const age = saved.spans().find((span) => span.text.includes("just now"));
	assert.equal(age?.hidden, true, "and it is aria-hidden");
	assert.ok(
		!saved.announced().includes("just now"),
		`the announcement is the sentence, not the clock: ${saved.announced()}`,
	);
});

test("a refusal carries its age too (review round 2, U9)", async (t) => {
	// It is the loud half, the half a user may have to act on, and deliberately the
	// longest-lived — so it was the only row that could not say whether it happened
	// now or five minutes ago.
	const refused = await open(t, {
		transfers: activity([
			note({
				name: "huge.pdf",
				outcome: "refused",
				reason:
					"refused: `huge.pdf` is over the 256 MiB per-file download limit; nothing was saved (it is 268435457 bytes)",
				refusal: { rule: "limit", bytes: 268_435_457, limit: 268_435_456 },
				at: Date.now() - 70_000,
			}),
		]),
	});
	assert.match(refused.spoken(), /Download refused —/);
	assert.match(
		refused.spoken(),
		/· 1 min ago/,
		"a refusal older than a minute says so rather than reading as new",
	);
});

test("the runtime cap's refusal says the partial was discarded, not that nothing was saved (review round 2, R2-5)", async (t) => {
	const overrun = await open(t, {
		transfers: activity([
			note({
				name: "endless.bin",
				outcome: "refused",
				reason:
					"refused: `endless.bin` went over the 256 MiB per-file download limit while it was being written; it was cancelled and the partial file was discarded",
				refusal: { rule: "overrun", bytes: 268_435_457, limit: 268_435_456 },
			}),
		]),
	});
	assert.match(
		overrun.spoken(),
		/went over the 256 MiB per-file download limit while it was being written\./,
		"the rule clause names WHEN the limit was passed",
	);
	assert.match(
		overrun.spoken(),
		/The partial file was discarded\./,
		"and the consequence is the discard, because the write did exist on disk",
	);
	assert.ok(
		!overrun.spoken().includes("Nothing was saved."),
		"the pre-write cap's consequence must not be borrowed for this rule",
	);
});

test("an upload names the first file and counts the rest (review round 2, U11)", async (t) => {
	const sent = await open(t, {
		transfers: activity([
			note({
				name: "brief.pdf",
				count: 3,
				dir: "",
				outcome: "sent",
				direction: "upload",
				site: "forms.example",
			}),
		]),
	});
	assert.match(
		sent.spoken(),
		/brief\.pdf \+ 2 more were attached to forms\.example/,
		`the line names what left, not only how many: ${sent.spoken()}`,
	);
});

test("a single-file upload reads as one file, not as a count (review round 2, U11)", async (t) => {
	const sent = await open(t, {
		transfers: activity([
			note({
				name: "brief.pdf",
				count: 1,
				dir: "",
				outcome: "sent",
				direction: "upload",
				site: "forms.example",
			}),
		]),
	});
	assert.match(
		sent.spoken(),
		/brief\.pdf was attached to forms\.example/,
		`one file takes the singular verb: ${sent.spoken()}`,
	);
	assert.ok(!sent.spoken().includes("more"), "and no count clause");
});

test("the in-flight row names the directory it opens (review round 2, D12)", async (t) => {
	// D8's remediation said the reveal is live "in every state — including
	// mid-flight, where the row now says which directory it opens", and mid-flight it
	// did not: the path was rendered only in the decided branch.
	const slow = await open(t, {
		transfers: activity([], {
			name: "slow-a.pdf",
			received: 1_024,
			total: 0,
			tabId: 7,
		}),
	});
	assert.equal(
		slow.title(),
		DIR,
		"the row carries the directory as its own title while the write is running",
	);
});

test("the refusal's NAME is the span that yields and its RULE keeps its room (review rounds 2 D11 / 3 D14)", async (t) => {
	// ONE SENTENCE, TWO ROUNDS, PULLING IN OPPOSITE DIRECTIONS. Round 2 (D11) found the
	// first failure: the name was only shrinkable, so a long name ate the line and the
	// rule — the only statement of WHY the file was refused — clipped to `is an exec…`.
	// Round 3 (D14) found the cost of that fix: `max-w-[32ch] shrink-0` is an ABSOLUTE
	// 237.5 px at every width, so at the app's 800 px minimum the rule gave up every px
	// of the narrowing and read `is …` — a fragment again, by the other span's hand.
	//
	// Round 4 (D16 / R4-1) found the limit of that fix: at the app's 800 px minimum
	// window the paragraph is 268.7 px while the row's NON-ELIDABLE clauses alone need
	// 316.5 px, so no division of the two spans can put the sentence on one line — with
	// both floored, four runs painted into the same columns there.
	//
	// What three rounds settled on is a RANK and a BREAK rather than a fixed width: the
	// name is capped so it cannot eat the line at the app's default window and yields
	// FIRST when the row narrows; the rule carries no floor at all (one wider than the
	// clause is a 26.5 px hole mid-sentence where the row has room — D17); and the
	// sentence WRAPS when one line cannot hold its clauses, which is what lets the rule
	// take its own measure — uncut — at the width where round 3 measured `is …` at 22 px.
	//
	// jsdom has no layout engine, so this pins the RANK and the BREAK (which span
	// shrinks, which span carries no floor, which container wraps) and that the rule is
	// recoverable in full from its own `title`. The geometry — rectangles that do not
	// intersect, at both widths, on BOTH branches — is `G8c` against the built app.
	const { container, spans: refusedSpans } = await open(t, {
		transfers: activity([
			note({
				name: "quarterly-financial-statements-and-notes-2026-q3-final-v7.pdf",
				outcome: "refused",
				reason:
					"refused: `quarterly-financial-statements-and-notes-2026-q3-final-v7.pdf` is an executable/script type; nothing was saved",
				refusal: { rule: "executable", bytes: 0, limit: 0 },
			}),
		]),
	});
	const name = refusedSpans().find((span) =>
		span.text.startsWith("quarterly-financial"),
	);
	assert.ok(name, "the name is its own span");
	assert.match(
		name.className,
		/max-w-\[min\(32ch,45%\)\]/,
		"the name stays capped at the app's default window, which is what round 2's D11 asked for — and proportionally, so a row too narrow for its own sentence is not handed the name's px as well (D14)",
	);
	assert.match(
		name.className,
		/min-w-\[min\(6ch,20%\)\]/,
		"and the name does not VANISH when it yields: a zero-width name is a layout bug rather than a clip",
	);
	assert.ok(
		!/shrink-0/.test(name.className),
		"and the name YIELDS: an absolute cap is what took every px of the narrowing from the rule (D14)",
	);
	const rule = refusedSpans().find((span) =>
		span.text.startsWith("is an executable"),
	);
	assert.ok(rule, "the rule is its own span");
	assert.ok(
		!/min-w-\[min\(24ch/.test(rule.className),
		"the rule carries NO `ch` floor: one wider than the clause it protects is the 26.5 px hole design round 4 measured mid-sentence at the default window (D17), and one narrower does not save the clause at 800 px either — the wrap is what protects it there",
	);
	assert.match(
		rule.className,
		/min-w-0/,
		"it keeps `min-w-0` instead, so a paragraph narrower than the clause clips it rather than painting it over the row's controls",
	);
	assert.match(
		rule.className,
		/truncate/,
		"and it still clips rather than overflowing the row when a longer rule needs more room",
	);
	assert.equal(
		rule.title,
		"is an executable/script type.",
		"the full rule rides the span's own title, so a clipped clause is still recoverable",
	);
	const paragraph = container.querySelector("p");
	assert.match(
		paragraph.className,
		/@max-\[64rem\]\/browserrow:flex-wrap/,
		"and the sentence WRAPS — but only under the row's own width (design round 5, R5-1/D1): an ungated `flex-wrap` tripled this row at the app's DEFAULT window, because `flex-wrap` breaks on each item's content size and a truncating span cannot yield inside its line",
	);
	assert.ok(
		!/(^|\s)flex-wrap(\s|$)/.test(paragraph.className),
		"and the wrap is not also unconditional: the two together would mean the gate does nothing",
	);
	assert.match(
		container.querySelector('[data-tour-tag="browser-file-transfer-row"]')
			.className,
		/@container\/browserrow/,
		"the row is the container the gate measures, which is what makes the threshold the row's own width rather than the window's",
	);
});

test("the DECIDED branch's name takes the refusal's cap, and its sentence wraps too (design round 4, D16)", async (t) => {
	// DESIGN ROUND 4'S UNPHOTOGRAPHED OBSERVATION, pinned where it can fail without a
	// rig run. This branch kept the old absolute shape — `max-w-[32ch] shrink-0` — while
	// the refusal's became proportional in round 3, so at the app's 800 px minimum window
	// (268.7 px of paragraph) its own sentence collided exactly as the refusal's had:
	// ~237.5 px of name, plus `was saved to`, plus the age cannot share that line, and
	// `shrink-0` left the row no way to give either of them room. Same shape as the
	// refusal's now — proportional cap, a floor so the name cannot vanish, `shrink` so it
	// yields, and a wrapping sentence — and `G8c` photographs BOTH branches at that width.
	const { container, spans } = await open(t, {
		transfers: activity([
			note({ name: "quarterly-accounts-and-notes-2026-q3-final-v7.pdf" }),
		]),
	});
	const name = spans().find((span) =>
		span.text.startsWith("quarterly-accounts-and-notes"),
	);
	assert.ok(name, "the saved row's name is its own span");
	assert.match(
		name.className,
		/max-w-\[min\(32ch,45%\)\]/,
		"the decided row's name is capped PROPORTIONALLY, like the refusal's, rather than at an absolute 237.5 px",
	);
	assert.match(
		name.className,
		/min-w-\[min\(6ch,20%\)\]/,
		"and its floor keeps the name from vanishing when it yields",
	);
	assert.ok(
		!/shrink-0/.test(name.className),
		"and it YIELDS: `shrink-0` is what left this branch with nothing to give at the app's minimum window",
	);
	assert.match(
		container.querySelector("p").className,
		/@max-\[64rem\]\/browserrow:flex-wrap/,
		"and the decided sentence wraps as well, so its clauses share no columns at 800 px — under the same gate, so the app's default window keeps its one quiet line (round 5, R5-1)",
	);
	// D4: the age can land ALONE on a line at the minimum window, where the leading
	// separator is a stray mark rather than a separator — so the mark is its own span and
	// the narrow row hides it. The words are untouched.
	const separator = spans().find((span) => span.text === "·");
	assert.ok(separator, "the decided row's separator is its own span");
	assert.match(
		separator.className,
		/@max-\[64rem\]\/browserrow:hidden/,
		"and it is hidden at the narrow width, because the refused branch's age never lands alone (its line carries the consequence) while the decided branch's does",
	);
});

test("a decision taken on a CLOSED tab is still named by the kind the host recorded (review round 2, U10)", async (t) => {
	// The renderer's tab list has no record for a closed tab, so the marker used to
	// fall back to "· on another tab" — a marker pointing at a tab that no longer
	// exists, which is the one thing a marker about whose action this was must not
	// be. The note's own `ownerKind` is still true of a closed tab.
	const closed = await open(t, {
		transfers: activity([note({ tabId: 3, ownerKind: "agent" })]),
		answerFromOwnerKind: true,
	});
	assert.match(
		closed.spoken(),
		/· on the agent's tab/,
		`the closed tab's kind survives it: ${closed.spoken()}`,
	);
});

test("a note older than its TTL renders nothing, which is what the frozen fixtures were doing (review round 2, D10)", async (t) => {
	// The stories' fixtures carried `at: 1_789_000_000_000` (2026-09-10), and this
	// round's TTL makes the component return null past it — so every decided specimen
	// painted an empty ground and the 800px state had no rendered artifact at all.
	// Pinning the mechanism here is what keeps the next fixture from freezing.
	const stale = await open(t, {
		transfers: activity([note({ at: Date.now() - 9 * 24 * 60 * 60 * 1000 })]),
	});
	assert.equal(
		stale.row,
		null,
		"a nine-day-old decision is retired, not rendered",
	);

	// A REFUSAL gets the longer window, and is still there inside it.
	const fresh = await open(t, {
		transfers: activity([
			note({
				outcome: "refused",
				refusal: { rule: "executable", bytes: 0, limit: 0 },
				at: Date.now() - 4 * 60_000,
			}),
		]),
	});
	assert.ok(fresh.row, "a four-minute-old refusal is still on screen");
});

test("EVERY committed story specimen paints, which is the defect D10 was (review round 2, D10)", async (t) => {
	// The stories exist so "the copy and the two grounds can be judged against each
	// other, in every theme, without a running transfer" — and on the round-2 head
	// every DECIDED specimen painted an empty ground, because the fixtures carried a
	// frozen `at` (1_789_000_000_000 = 2026-09-10) and this round's TTL retires a note
	// past it. The single specimen that painted (`Downloading`) is the one with no
	// decided note to gate on.
	//
	// RENDERING THE COMMITTED FIXTURES IS THE FIX'S CHECK: a screenshot proves it
	// painted once, this proves it cannot silently stop again — a future pass that
	// re-freezes a fixture fails here instead of shipping a blank rectangle that a
	// green capture run happily stamps.
	const shipped = [
		"Downloading",
		"DownloadingUnknownSize",
		"Saved",
		"Refused",
		"OverCap",
		"OverCapWhileWriting",
		"Sent",
		"LongNameAtMinimumWindow",
		"OtherTabsTransfer",
	];
	const painted = [];
	for (const name of shipped) {
		const story = stories[name];
		assert.ok(story, `the specimen ${name} is exported`);
		const view = await open(t, {
			transfers: story.args?.transfers,
			answerFromOwnerKind: typeof story.args?.tabLabel === "function",
		});
		assert.ok(
			view.row,
			`${name} renders nothing: its fixture is older than the row's TTL`,
		);
		painted.push(name);
	}
	assert.deepEqual(painted, shipped);
	// AND THE ONE THAT IS SUPPOSED TO BE ABSENT STAYS ABSENT: a guard that demanded a
	// row everywhere would fail on the specimen whose whole point is that there is
	// nothing to say.
	const nothing = await open(t, { transfers: stories.Nothing.args?.transfers });
	assert.equal(
		nothing.row,
		null,
		"the Nothing specimen renders nothing by design",
	);
});
