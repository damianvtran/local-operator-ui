#!/usr/bin/env node
/**
 * Captures - and asserts - the composer's alert for a send the backend's STORE
 * refused, for each arm of the store-failure ladder.
 *
 *     node scripts/store-refusal-evidence.mjs [--json] [--out=<dir>] [--only=<substr>]
 *
 * Why this file exists. On 2026-09-17 the host volume reached 0 bytes free, the
 * backend's store could not write, and the desktop routes answered that with the
 * one 503 they had for every `sqlite3.Error` - lock contention, an unopenable
 * database, a corrupt one and a full disk alike - reading "Read state is busy
 * right now. It will catch up on its own." The composer relayed that sentence and
 * appended its own generic hint, "Your message is still in the composer. Send it
 * again.", which is the one instruction that cannot help when the disk is full.
 * The operator retried, with an image attached, repeatedly.
 *
 * The repair is a split: `store_busy` (503, genuinely transient - retry is right),
 * `store_out_of_space` (507, name the disk and free space) and `store_unavailable`
 * (500, retrying will not help). The renderer's half is that each code reaches the
 * composer, that `withholdsRetryHint` withholds the hint for the two the hint is
 * false for, and that the alert the operator is left with is one they can act on
 * (UX round 1, U1-U4).
 *
 * A green unit test cannot show that, and neither can a screenshot alone: the
 * claim is a DIFFERENCE between runs of the same pipeline with the same box, where
 * the only thing that moves is the code. So this drives
 * `scripts/store-refusal-evidence.html` - the SHIPPED `MessageInput` mounted on
 * what the app's own transport, `desktopResult`, `admitChatDraft`,
 * `withholdsRetryHint` and `isStoreWriteRefusal` produced - over raw CDP against a
 * private headless Chrome, the same approach as `composer-alert-geometry.mjs` and
 * `capture-evidence.mjs`: a fresh user-data-dir under /tmp, killed on exit, and no
 * browser-automation dependency added to the repo. The page is built and served by
 * `vite` in-process over `store-refusal-evidence.vite.mjs`.
 *
 * THREE STATES PER ARM (`--state=restored|held|altered`, see the page): the
 * refusal's own screen, the operator's remedy on it, and the box with the payload
 * back. What each frame is FOR is asserted below, one finding per assertion.
 *
 * WHAT IS WRITTEN WHEN (agent review round 1, R-1). The frames and
 * `readings.json` are held in memory and written only when EVERY case in the run
 * has passed its assertions. They used to be written inside the case loop, so a
 * capture taken on a regressed tree overwrote the committed frames - the bad ones
 * beside a `readings.json` whose `failures` array said so, and only the exit
 * status to notice it. A run with a failing case now writes nothing at all and
 * fails loudly; `--out` is a destination, not a scratch directory.
 *
 * What it does NOT prove: the Electron IPC hop (this page takes the transport's
 * real `/__desktop` HTTP path, `window.api.desktop` deliberately absent), the
 * packaged build, any theme other than the one named, and any screen-reader
 * behaviour (the `role="alert"` is present in the DOM, which is not the same as
 * hearing it). The BACKEND's own error ladder is the sibling PR's subject; what
 * is substituted here is its verdict, at the HTTP boundary - and the sentences it
 * substitutes are STAND-INS for that PR's copy (see `store-refusal-evidence.vite.mjs`).
 * The abandon controls are present but inert: a still cannot show what a press
 * did, so their LABEL is what these frames carry.
 */

import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { withMockKeychain } from "./chrome-keychain.mjs";
import { failureFor } from "./store-refusal-copy.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ARGS = process.argv.slice(2);
const AS_JSON = ARGS.includes("--json");
const flag = (name) =>
	ARGS.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const OUT = flag("out") ?? join(ROOT, "docs/evidence/store-refusal-alert");
const PORT = Number(flag("port") ?? 5431);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const ONLY = flag("only");
const THEME = flag("theme") ?? "localOperatorDark";

/**
 * The window these frames are shot in, as the app's own minimum and the
 * designer's own frame: `--viewport=WxH`, default 1440x817 (the frame the
 * committed set has always used).
 *
 * Promoted from a pair of module constants to a flag because the state that
 * matters most here is the one the app CLAMPS to - 800x568 - where the alert is at
 * its cap and a taller window would photograph a problem the operator at a
 * minimum window does not have (design round 1, D4; UX round 1, U3).
 */
const VIEWPORT_FLAG = flag("viewport");
const parseViewport = (value) => {
	const [width, height] = String(value ?? "")
		.split("x")
		.map(Number);
	return Number.isFinite(width) && Number.isFinite(height)
		? { width, height }
		: null;
};
const VIEWPORT = parseViewport(VIEWPORT_FLAG) ?? { width: 1440, height: 817 };
if (VIEWPORT_FLAG && !parseViewport(VIEWPORT_FLAG))
	throw new Error(`--viewport must be WxH, got \`${VIEWPORT_FLAG}\``);

/** The composer's track, `--column=N`: the width the chat column leaves it. */
const COLUMN = Number(flag("column") ?? 892);

/**
 * The cases, each naming what its frame is FOR.
 *
 * `arm` is the code the pipeline must land on, `message` the sentence the row must
 * hold, `hint` whether the RETRY HINT is rendered in the prose, `namesControl`
 * whether the prose names the restore control (UX round 1, U1), `box` what the
 * composer must hold, and `controls` whether the remedy row must be there at all.
 *
 * The three `-restored` arms are the controlled comparison the set has always
 * been: same box (holding the payload), same pipeline, same window, and the CODE
 * the only thing that moves - because the hint's own condition (the box holds
 * something the store would accept) is satisfied there, and an empty box withholds
 * it for a reason that has nothing to do with the code (which is what the `-held`
 * frames show, and UX round 1, U7 measured: on this route the 503 renders no hint
 * either).
 *
 * `*-held` is the state the operator actually lands on and the one U1/U4 are
 * about: the box is EMPTY because the claim holds the payload, so the store
 * sentence's own "send it again" is a step the app cannot take until the control
 * is named - and the shared held line's "whether it reached the agent is not
 * knowable" is false for a store that knows the write failed.
 *
 * `altered-held` is the operator's own remedy from the incident, one step on:
 * text restored, image dropped, Enter pressed. The guard really fires, so this is
 * the case that discriminates a chip-aware payload comparison from a text-only one
 * (UX round 1, U2).
 */
const CASES = [
	{
		file: "busy-restored",
		case: "busy",
		state: "restored",
		arm: "store_busy",
		status: 503,
		message: failureFor("busy").message,
		hint: true,
		withholds: false,
		storeWrite: false,
		claimStoreWrite: false,
		namesControl: false,
		box: "payload",
		chips: 1,
		controls: true,
		/*
		 * One control here, and it is the destructive one: the payload is back in the
		 * box, so `Restore message` has nothing to do and the alert offers the escape
		 * instead. This is the frame R-3 asked for - the stills used to omit the
		 * abandon control the real page renders.
		 */
		controlLabels: ["Discard this message"],
	},
	{
		/*
		 * THE CONTRAST FRAME FOR THE HELD LINE'S TWO REGISTERS (design round 2, D8).
		 *
		 * `isStoreWriteRefusal` makes the held claim arm-specific: the store arms get
		 * the known fact and contend it, the busy arm falls through to the shared
		 * "whether it reached the agent is not knowable" sentence. The set had
		 * `busy-restored` and no `busy-held`, so the one screen where the predicate
		 * CHANGES WHAT IS PAINTED was asserted in readings and never shown. Same
		 * claim, same empty box, same two controls - and the only sentence on the
		 * screen that differs from `out-of-space-held` is the held line.
		 */
		file: "busy-held",
		case: "busy",
		state: "held",
		arm: "store_busy",
		status: 503,
		message: failureFor("busy").message,
		/*
		 * The hint is absent from the SCREEN and un-withheld by the PREDICATE, and the
		 * two are different facts: `withholdsRetryHint(store_busy)` is false because
		 * contention really is worth retrying (UX round 1, U7), while the composer does
		 * not paint the hint at all in this state because the box is empty - there is
		 * nothing left to send (the post-admission reason the PR body's table states).
		 */
		hint: false,
		withholds: false,
		storeWrite: false,
		claimStoreWrite: false,
		/*
		 * The shared sentence does not name the control by its label: it says "restore
		 * it and send again only if no reply arrives", which is the lost-response
		 * register's own wording, unchanged by this PR (U1's naming clause is the store
		 * arm's). Asserted rather than assumed, because the two registers differ in
		 * exactly this.
		 */
		namesControl: false,
		unknowable: true,
		box: "empty",
		chips: 1,
		controls: true,
		controlLabels: ["Restore message", "Discard message"],
	},
	{
		file: "out-of-space-restored",
		case: "out-of-space",
		state: "restored",
		arm: "store_out_of_space",
		status: 507,
		message: failureFor("out-of-space").message,
		hint: false,
		withholds: true,
		storeWrite: true,
		claimStoreWrite: true,
		namesControl: false,
		box: "payload",
		chips: 1,
		controls: true,
		/*
		 * One control here, and it is the destructive one: the payload is back in the
		 * box, so `Restore message` has nothing to do and the alert offers the escape
		 * instead. This is the frame R-3 asked for - the stills used to omit the
		 * abandon control the real page renders.
		 */
		controlLabels: ["Discard this message"],
	},
	{
		file: "unavailable-restored",
		case: "unavailable",
		state: "restored",
		arm: "store_unavailable",
		status: 500,
		message: failureFor("unavailable").message,
		hint: false,
		withholds: true,
		storeWrite: true,
		claimStoreWrite: true,
		namesControl: false,
		box: "payload",
		chips: 1,
		controls: true,
		/*
		 * One control here, and it is the destructive one: the payload is back in the
		 * box, so `Restore message` has nothing to do and the alert offers the escape
		 * instead. This is the frame R-3 asked for - the stills used to omit the
		 * abandon control the real page renders.
		 */
		controlLabels: ["Discard this message"],
	},
	{
		file: "out-of-space-held",
		case: "out-of-space",
		state: "held",
		arm: "store_out_of_space",
		status: 507,
		message: failureFor("out-of-space").message,
		hint: false,
		withholds: true,
		storeWrite: true,
		claimStoreWrite: true,
		namesControl: true,
		knownFact: true,
		box: "empty",
		chips: 1,
		controls: true,
		/*
		 * Both of them, primary first: the empty box is the state that makes
		 * `Restore message` the way forward, and the destructive control is offered
		 * beside it as `Discard message` (an empty box means a discard costs nothing
		 * visible). UX round 1, U9 is the question of whether that second label is
		 * honest enough; the frames now show it rather than describing it.
		 */
		controlLabels: ["Restore message", "Discard message"],
	},
	{
		file: "unavailable-held",
		case: "unavailable",
		state: "held",
		arm: "store_unavailable",
		status: 500,
		message: failureFor("unavailable").message,
		hint: false,
		withholds: true,
		storeWrite: true,
		claimStoreWrite: true,
		namesControl: true,
		knownFact: true,
		box: "empty",
		chips: 1,
		controls: true,
		controlLabels: ["Restore message", "Discard message"],
	},
	{
		file: "altered-held",
		case: "altered",
		state: "altered",
		arm: "unconfirmed_send",
		status: null,
		message:
			"The previous send has not been confirmed, and it does not match what is in the composer now.",
		hint: false,
		withholds: true,
		storeWrite: false,
		claimStoreWrite: true,
		namesControl: true,
		knownFact: true,
		box: "payload",
		chips: 0,
		controls: true,
		/*
		 * The operator's remedy leaves the box holding the text and the chip row one
		 * file short, so the held payload is NOT in the box: `Restore message` comes
		 * back, and the abandon control reads `Stop holding it` - the honest label for
		 * a press that releases the claim without destroying what is typed (UX round 1,
		 * U9). The label is a consequence of the chip-aware comparison this frame
		 * exists to pin: a text-only one says the payload is back and offers `Discard
		 * this message` over the user's text instead.
		 *
		 * IT IS ALSO THE U10 FRAME, and it is the only one in the set where the code on
		 * screen and the claim's verdict differ: the sentence above is the GUARD's
		 * (`unconfirmed_send`, `storeWrite: false`), the claim still carries
		 * `store_out_of_space`, and the held line must state the KNOWN FACT under the
		 * guard's sentence rather than revert to "not knowable" one screen after the
		 * app said nothing was saved. `knownFact: true` is that assertion; before this
		 * round the frame asserted the reverse.
		 */
		controlLabels: ["Restore message", "Stop holding it"],
	},
	{
		/*
		 * THE APP'S OWN MINIMUM WINDOW, IN THE COLUMN THE APP ACTUALLY DERIVES.
		 *
		 * 800x568 is the size the app clamps to, and QA round 1 measured the composer's
		 * track in the DEFAULT layout at this window: 236px, not the ~472px an earlier
		 * comment here assumed from the sidebar's width (the picker and the canvas pane
		 * take it lower, and the default layout is where an operator starts). At 236px
		 * the backend's own sentence fills the whole capped window, and this frame is
		 * the one that showed the clause naming the remedy being the part cut off -
		 * with the still printing a PASS beside its own `overflowing: true` because
		 * `namesControl` was read off the DOM text rather than off what is painted
		 * (QA round 1's Q-1, design round 2's D5, agent review round 2's M1, UX round
		 * 2's U11).
		 *
		 * It is still the frame where the cap's own numbers are asserted, and it is the
		 * frame that must FAIL if the naming clause is not on screen: `namesControl` is
		 * now asked of the VISIBLE prose (see the probe), which is the instrument the
		 * design round asked for.
		 */
		file: "unavailable-narrow-held",
		case: "unavailable",
		state: "held",
		arm: "store_unavailable",
		status: 500,
		message: failureFor("unavailable").message,
		hint: false,
		withholds: true,
		storeWrite: true,
		claimStoreWrite: true,
		namesControl: true,
		knownFact: true,
		box: "empty",
		chips: 1,
		controls: true,
		controlLabels: ["Restore message", "Discard message"],
		viewport: { width: 800, height: 568 },
		column: 236,
		/*
		 * The block overflows here too: the sibling's 500 sentence wraps to eight lines
		 * at this track, so 120 of 160px are shown. (It read 120/120 while the
		 * horizontal clip was in place - a sentence whose every line is cut at the right
		 * edge uses fewer lines, which is how the other axis was hiding.) What this frame
		 * is FOR is the CLAUSE: it must be PAINTED at the app's minimum window, which is
		 * what `namesControl` and `knownFact` now ask of the visible rect. The 507 frame
		 * carries the longest copy the sibling's contract can produce.
		 */
		overflowing: true,
	},
	{
		/*
		 * THE LONGEST COPY THE SIBLING'S CONTRACT CAN PRODUCE, at the same window.
		 *
		 * The 507 sentence names the volume and where it is, which makes it the longest
		 * of the three (~180 characters with a real config root); the projection in
		 * design round 2's D5 was made from the 500 frame's character width, and this
		 * frame is that projection MEASURED rather than projected. It is the case the
		 * manager asked for by name: the same defect returns the moment
		 * local-operator#1243 merges if only the shorter sentence was ever validated.
		 */
		file: "out-of-space-narrow-held",
		case: "out-of-space",
		state: "held",
		arm: "store_out_of_space",
		status: 507,
		message: failureFor("out-of-space").message,
		hint: false,
		withholds: true,
		storeWrite: true,
		claimStoreWrite: true,
		namesControl: true,
		knownFact: true,
		box: "empty",
		chips: 1,
		controls: true,
		controlLabels: ["Restore message", "Discard message"],
		viewport: { width: 800, height: 568 },
		column: 236,
		overflowing: true,
	},
];

const RETRY_HINT = "Your message is still in the composer. Send it again.";
const RESTORE_LABEL = "Restore message";
/*
 * The known fact a store refusal licenses, as the shipped module builds it
 * (`heldClaimCopy` in `use-message-input`). A rig carries its own copy of the
 * strings it asserts - what it must NOT do is carry its own copy of the RULE,
 * which is why `withholdRetryHint`/`isStoreWriteRefusal` are read from the page's
 * shipped module rather than restated here.
 */
const STORE_CLAIM_KNOWN_FACT =
	"Nothing was saved, and the copy above is this app's own rather than the agent's.";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Cdp {
	constructor(ws) {
		this.ws = ws;
		this.next = 0;
		this.pending = new Map();
		/*
		 * Page-side console output and uncaught exceptions, kept for the failure
		 * message: a module that evaluates and then throws inside a React render
		 * leaves an empty document and no JS error in this process, so the only
		 * place that failure exists is the page's own console.
		 */
		this.log = [];
		ws.addEventListener("message", (ev) => {
			const msg = JSON.parse(ev.data);
			if (msg.id !== undefined && this.pending.has(msg.id)) {
				const { resolve, reject } = this.pending.get(msg.id);
				this.pending.delete(msg.id);
				msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
			} else if (msg.method === "Runtime.exceptionThrown") {
				this.log.push(
					msg.params.exceptionDetails.exception?.description ??
						msg.params.exceptionDetails.text,
				);
			} else if (msg.method === "Runtime.consoleAPICalled") {
				this.log.push(
					`${msg.params.type}: ${msg.params.args
						.map((a) => a.description ?? a.value ?? a.type)
						.join(" ")}`,
				);
			}
		});
	}
	send(method, params = {}) {
		const id = ++this.next;
		this.ws.send(JSON.stringify({ id, method, params }));
		return new Promise((resolve, reject) =>
			this.pending.set(id, { resolve, reject }),
		);
	}
}

/**
 * What the page is asked to report, in one call.
 *
 * Read off the DOM rather than off the harness's own record: the question is what
 * a person looking at these pixels can read, so the alert's TEXT is taken from the
 * rendered region, its PROSE separately (the sentences, without the pinned
 * controls' own labels beside them - U1's claim is that a sentence names a
 * control, and reading the region's whole text would be satisfied by the button
 * merely existing), and the box's own value is read so "the hint was withheld"
 * cannot be confused with "the hint had nothing to attach to": the composer gates
 * it on the box holding something.
 *
 * The geometry is here for UX round 1, U3, and it asks the two questions the fix
 * is made of - which element scrolls, and whether the remedy is inside it - from
 * the computed style rather than from a class name, so a later move of the cap is
 * noticed rather than assumed.
 */
const PROBE = `(() => {
	const region = document.querySelector('[role="alert"]');
	const textarea = document.querySelector("textarea");
	const round = (n) => Math.round(n * 10) / 10;
	const rect = (el) => {
		const r = el.getBoundingClientRect();
		return { top: round(r.top), bottom: round(r.bottom), height: round(r.height) };
	};
	const capped = region
		? [...region.children].find((el) => getComputedStyle(el).overflowY === "auto") ?? region
		: null;
	const controlsEl =
		region && capped ? [...region.children].find((el) => el !== capped) ?? null : null;
	const send =
		[...document.querySelectorAll("button")].find((b) =>
			/send message/i.test(b.getAttribute("aria-label") ?? ""),
		) ?? null;
	/*
	 * THE PROSE IS THE REGION'S PARAGRAPHS, not the capped block's (QA round 1's
	 * Q-1). The claim that names the remedy was moved OUT of the cap in this round -
	 * it is pinned with the control it names, because at the app's minimum window the
	 * backend's own sentence fills the window and the clause was the part cut off -
	 * so a read scoped to the capped block would report that the sentence is missing
	 * rather than that it moved. Both levels are measured instead: this is what the
	 * region SAYS, and visibleProse below is what a person can READ of it.
	 *
	 * The paragraphs and not the region's whole text: the pinned control row's labels
	 * sit in the same region, and U1's claim is that a SENTENCE names a control -
	 * reading the region's text would be satisfied by the button merely existing.
	 */
	const paragraphs = region ? [...region.querySelectorAll("p")] : [];
	/*
	 * WHAT IS ACTUALLY PAINTED, character by character.
	 *
	 * The text read above is blind to the cap: a sentence the window cuts off still
	 * reports itself in full, which is how this rig printed the naming clause in its
	 * PASS line beside a frame that did not paint those words - a PASS next to its
	 * own overflowing: true (QA round 1's Q-1, design round 2's D5, agent review round
	 * 2's M1, UX round 2's U11). Each character's own client rect has to sit inside
	 * every box that clips it - the paragraph's nearest scrolling ancestor, and the
	 * region itself - for it to count, so a line the window cuts or has scrolled past
	 * drops out and an assertion about this string is an assertion about the screen.
	 */
	const clipBox = (node) => {
		let el = node.parentElement;
		while (el && el !== region) {
			const overflow = getComputedStyle(el).overflowY;
			if (overflow === "auto" || overflow === "scroll" || overflow === "hidden") return el;
			el = el.parentElement;
		}
		return region;
	};
	const visibleProse = () => {
		if (!region) return null;
		const regionBox = region.getBoundingClientRect();
		const parts = [];
		for (const paragraph of paragraphs) {
			const clip = clipBox(paragraph).getBoundingClientRect();
			const top = Math.max(regionBox.top, clip.top);
			const bottom = Math.min(regionBox.bottom, clip.bottom);
			const left = Math.max(regionBox.left, clip.left);
			const right = Math.min(regionBox.right, clip.right);
			const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
			let run = "";
			for (let node = walker.nextNode(); node; node = walker.nextNode()) {
				const text = node.nodeValue || "";
				for (let i = 0; i < text.length; i++) {
					const range = document.createRange();
					range.setStart(node, i);
					range.setEnd(node, i + 1);
					const painted = [...range.getClientRects()].some(
						(r) =>
							r.height > 0 &&
							r.top >= top - 0.5 &&
							r.bottom <= bottom + 0.5 &&
							r.left >= left - 0.5 &&
							r.right <= right + 0.5,
					);
					if (painted) run += text[i];
					else if (run.trim()) {
						parts.push(run.trim());
						run = "";
					}
				}
				if (run.trim()) {
					parts.push(run.trim());
					run = "";
				}
			}
		}
		return parts.join(" ").replace(/\\s+/g, " ").trim();
	};
	return {
		regionPresent: !!region,
		alertText: region ? (region.textContent || "").replace(/\\s+/g, " ").trim() : null,
		alertProse: region
			? paragraphs
					.map((p) => p.textContent || "")
					.join(" ")
					.replace(/\\s+/g, " ")
					.trim()
			: null,
		visibleProse: visibleProse(),
		boxValue: textarea ? textarea.value : null,
		theme: document.documentElement.dataset.theme,
		fonts: document.fonts.status,
		evidence: window.__storeRefusalEvidence ?? null,
		capped: capped
			? {
					...rect(capped),
					clientHeight: capped.clientHeight,
					scrollHeight: capped.scrollHeight,
					/*
					 * The HORIZONTAL numbers as well: a sentence carrying a word the app
					 * does not control (the sibling's config root) used to lay out wider
					 * than this block and have every line cut mid-word at its right edge -
					 * a clip with no scrollbar to hint at it, and one the vertical
					 * instrument cannot see.
					 */
					clientWidth: capped.clientWidth,
					scrollWidth: capped.scrollWidth,
					overflowY: getComputedStyle(capped).overflowY,
				}
			: null,
		region: region
			? { ...rect(region), overflowY: getComputedStyle(region).overflowY }
			: null,
		controls: controlsEl
			? {
					...rect(controlsEl),
					labels: [...controlsEl.querySelectorAll("button")].map((b) =>
						(b.textContent || "").trim(),
					),
					insideCapped: capped ? capped.contains(controlsEl) : null,
				}
			: null,
		send: send ? rect(send) : null,
		viewport: { width: window.innerWidth, height: window.innerHeight },
	};
})();`;

let vite = null;
let chrome = null;
let dataDir = null;

const teardown = () => {
	if (vite) {
		vite.kill("SIGKILL");
		vite = null;
	}
	if (chrome) {
		chrome.kill("SIGKILL");
		chrome = null;
	}
	if (dataDir) {
		// Same race `composer-alert-geometry.mjs` documents: SIGKILL returns before
		// the profile stops being written to, so a plain recursive remove can throw
		// ENOTEMPTY and turn a successful capture into a failure.
		rmSync(dataDir, {
			recursive: true,
			force: true,
			maxRetries: 10,
			retryDelay: 100,
		});
		dataDir = null;
	}
};

const startVite = async () => {
	vite = spawn(
		process.execPath,
		[
			join(ROOT, "node_modules/vite/bin/vite.js"),
			"--config",
			join(ROOT, "scripts/store-refusal-evidence.vite.mjs"),
			"--port",
			String(PORT),
			"--strictPort",
			// Bound explicitly: vite's default host is `localhost`, which on this
			// platform resolves to ::1 while this driver waits on 127.0.0.1.
			"--host",
			"127.0.0.1",
		],
		{ cwd: ROOT, env: { ...process.env, STORE_REFUSAL_PORT: String(PORT) } },
	);
	vite.stderr.on("data", (d) => process.stderr.write(`[vite] ${d}`));
	vite.stdout.on("data", (d) => process.stderr.write(`[vite] ${d}`));
	for (let i = 0; i < 240; i++) {
		try {
			const res = await fetch(`${ORIGIN}/store-refusal-evidence.html`);
			if (res.ok) return;
		} catch {
			// not up yet
		}
		await sleep(500);
	}
	throw new Error("the harness page never came up");
};

const startChrome = async () => {
	dataDir = join(tmpdir(), `lo-store-refusal-${process.pid}`);
	mkdirSync(dataDir, { recursive: true });
	chrome = spawn(
		CHROME,
		withMockKeychain([
			"--headless=new",
			"--no-sandbox",
			"--disable-gpu",
			`--user-data-dir=${dataDir}`,
			"--remote-debugging-port=0",
			"about:blank",
		]),
	);
	const wsUrl = await new Promise((resolve, reject) => {
		let buf = "";
		const t = setTimeout(
			() => reject(new Error("Chrome did not report a debug port")),
			30_000,
		);
		chrome.stderr.on("data", (d) => {
			buf += d.toString();
			const m = buf.match(/DevTools listening on (ws:\/\/[^\s]+)/);
			if (m) {
				clearTimeout(t);
				resolve(m[1]);
			}
		});
		chrome.on("exit", (code) =>
			reject(new Error(`Chrome exited early (${code})`)),
		);
	});
	const { host } = new URL(wsUrl);
	const list = await fetch(`http://${host}/json`).then((r) => r.json());
	const target = list.find((t) => t.type === "page");
	const ws = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		ws.addEventListener("open", resolve, { once: true });
		ws.addEventListener("error", reject, { once: true });
	});
	const cdp = new Cdp(ws);
	await cdp.send("Page.enable");
	await cdp.send("Runtime.enable");
	return cdp;
};

/**
 * The assertions, stated once so the report can name the claim each one answers.
 *
 * One finding per assertion, and the ones about the prose and the geometry are
 * this round's remediation: U1 (the failure's own sentence names the control the
 * remedy needs), U2 (the unchanged-payload guard's code withholds the hint it
 * would contradict), U4 (the held line states the known fact on a store refusal
 * instead of the unknowable-outcome sentence under it), U3 (the remedy is outside
 * the scrolling block and on screen at the cap), U7 (what the 503 actually
 * renders, which is not what the PR's first description claimed).
 */
const assertions = (probe, expected) => {
	const failures = [];
	const fail = (message) => failures.push(message);
	const evidence = probe.evidence ?? {};

	if (!probe.regionPresent)
		fail("no alert region rendered at all, so the refusal reached no composer");
	if (!evidence.code)
		fail(
			`the refusal carried no code (evidence: ${JSON.stringify(evidence)}), so the alert's hint is decided by whatever code the row was last left holding`,
		);
	if (evidence.code !== expected.arm)
		fail(`the code is ${evidence.code}, expected ${expected.arm}`);
	if (evidence.status !== expected.status)
		fail(
			`the refusal arrived as ${evidence.status}, expected ${expected.status}`,
		);
	if (evidence.message !== expected.message)
		fail(
			`the sentence the composer holds is not the one this state's refusal produced: ${JSON.stringify(evidence.message)}`,
		);
	/*
	 * The PREDICATE, read in the page from the shipped module on the code the row
	 * holds - not from a prop the harness chose. `withholdRetryHint` answers the
	 * hint question and `isStoreWriteRefusal` answers the held line's (U4); they
	 * are separate assertions because they are separate facts, and one frame can
	 * show one of them.
	 */
	if (evidence.withholdRetryHint !== expected.withholds)
		fail(
			`withholdRetryHint is ${evidence.withholdRetryHint}, expected ${expected.withholds} for ${expected.arm}`,
		);
	if (evidence.storeWriteRefusal !== expected.storeWrite)
		fail(
			`isStoreWriteRefusal is ${evidence.storeWriteRefusal}, expected ${expected.storeWrite} for ${expected.arm}`,
		);
	/*
	 * And the SAME predicate over the CLAIM's verdict rather than the refusal on
	 * screen. They are the same value in every case but `altered`, and that case is
	 * the point: the composer's held line may only state the known fact when the
	 * payload it is describing was left held by a store write refusal (UX round 2,
	 * U10), and on the operator's own remedy the code on screen is the guard's.
	 */
	if (evidence.claimStoreWriteRefusal !== expected.claimStoreWrite)
		fail(
			`isStoreWriteRefusal(heldClaimCode) is ${evidence.claimStoreWriteRefusal}, expected ${expected.claimStoreWrite} for the claim ${JSON.stringify(evidence.heldClaimCode)} left by ${expected.arm}`,
		);
	/*
	 * The box, asserted because every claim about the hint is conditional on it and
	 * because this round's fix is about what the box does NOT hold. `held` is the
	 * state the refusal leaves - the claim has the payload, so the box is empty and
	 * the sentence's own "send it again" is not something the app can do yet.
	 */
	const boxHoldsText =
		typeof probe.boxValue === "string" && probe.boxValue.trim() !== "";
	if (expected.box === "payload" && !boxHoldsText)
		fail(
			`the composer's box is empty, so the hint's own condition was never met and its absence proves nothing`,
		);
	if (expected.box === "empty" && boxHoldsText)
		fail(
			`the composer's box holds ${JSON.stringify(probe.boxValue)}, so this is not the state a refusal leaves`,
		);
	const chipCount = evidence.boxAttachments?.length ?? -1;
	if (chipCount !== expected.chips)
		fail(
			`the composer carries ${chipCount} chip(s), expected ${expected.chips}: the chip row is half of what the guard compares`,
		);
	// The rendered sentence, not the pipeline's record of it: a withheld hint that
	// is absent because the sentence itself was dropped looks identical in a still.
	if (probe.alertProse === null) fail("the alert region holds no prose");
	else {
		if (!probe.alertProse.includes(expected.message))
			fail(
				`the alert does not render the refusal's sentence verbatim: ${JSON.stringify(probe.alertProse)}`,
			);
		const hasHint = probe.alertProse.includes(RETRY_HINT);
		if (hasHint !== expected.hint)
			fail(
				expected.hint
					? `the retry hint is missing from ${expected.arm}, where a resend is the remedy: ${JSON.stringify(probe.alertProse)}`
					: `the retry hint is rendered for ${expected.arm}, which a resend cannot answer: ${JSON.stringify(probe.alertProse)}`,
			);
		/*
		 * U1: while the payload is out of the box, the failure's own instruction
		 * cannot be carried out with the key it names - Enter sends nothing - so the
		 * sentence has to name the control that revives it. The label is read off the
		 * PROSE and the button separately, so a frame whose sentence names the control
		 * and a frame whose button merely exists are told apart.
		 */
		const proseNamesControl = probe.alertProse.includes(RESTORE_LABEL);
		/*
		 * THE SAME QUESTION, ASKED OF WHAT IS PAINTED (QA round 1's Q-1, design round
		 * 2's D5, agent review round 2's M1, UX round 2's U11).
		 *
		 * `alertProse` is textContent, which a cap cannot reach: it reported the
		 * naming clause in full on a frame that cut the clause off, so this rig printed
		 * a PASS beside its own `overflowing: true`. Both are asserted, and they are
		 * different findings when they disagree: "never written" versus "written where
		 * the operator cannot read it".
		 */
		const shownNamesControl = (probe.visibleProse ?? "").includes(
			RESTORE_LABEL,
		);
		if (expected.namesControl && !proseNamesControl)
			fail(
				`the prose never names ${RESTORE_LABEL}, which is the step the store sentence's "send it again" needs while the box is empty (UX round 1, U1): ${JSON.stringify(probe.alertProse)}`,
			);
		else if (expected.namesControl && !shownNamesControl)
			fail(
				`the prose names ${RESTORE_LABEL} but the window does not SHOW it, so the operator is left with a refusal and no statement of what to do about it (QA round 1's Q-1, D5, M1, U11). rendered: ${JSON.stringify(probe.alertProse)} / painted: ${JSON.stringify(probe.visibleProse)}`,
			);
		else if (!expected.namesControl && proseNamesControl)
			fail(
				`the prose names ${RESTORE_LABEL} where no restore is offered (UX round 1, U1): ${JSON.stringify(probe.alertProse)}`,
			);
		/*
		 * WHICH REGISTER THE CLAIM IS IN, on the screen rather than only in the
		 * reading: `knownFact` is the store arms' sentence (U4, and U10 for whose
		 * verdict picks it) and `unknowable` is the shared one contention keeps.
		 */
		if (expected.knownFact) {
			if (!(probe.alertProse ?? "").includes(STORE_CLAIM_KNOWN_FACT))
				fail(
					`the claim does not state the known fact a store refusal licenses: ${JSON.stringify(probe.alertProse)}`,
				);
			else if (!(probe.visibleProse ?? "").includes(STORE_CLAIM_KNOWN_FACT))
				fail(
					`the claim states the known fact somewhere the window does not paint: ${JSON.stringify(probe.visibleProse)}`,
				);
			if (/not knowable/.test(probe.alertProse ?? ""))
				fail(
					`the claim reverts to the lost-response register under a store refusal, which tells the operator to wait for a reply that cannot arrive (UX round 1, U4; UX round 2, U10): ${JSON.stringify(probe.alertProse)}`,
				);
		}
		if (expected.unknowable && !/not knowable/.test(probe.alertProse ?? ""))
			fail(
				`the contention arm no longer keeps the shared unknowable-outcome sentence, which is the register that IS true for it (design round 2, D8): ${JSON.stringify(probe.alertProse)}`,
			);
	}
	/*
	 * U3: the remedy is OUTSIDE the cap and on screen. Asked of the structure
	 * (which element scrolls, and whether the controls are inside it) as well as of
	 * the numbers, because "the controls are visible in this frame" is satisfiable
	 * by a frame whose copy happens to fit.
	 */
	if (expected.controls) {
		if (!probe.controls)
			fail(
				"the refusal offers no remedy control at all, so the state it leaves the operator in has no exit (UX round 1, U1/U9)",
			);
		else {
			if (probe.controls.insideCapped)
				fail(
					"the remedy controls are inside the scrolling prose block, so a long alert scrolls them out of the window (UX round 1, U3)",
				);
			if (probe.region?.overflowY === "auto")
				fail(
					"the alert region itself scrolls, so nothing in it can be pinned (UX round 1, U3)",
				);
			if (probe.controls.bottom > probe.viewport.height)
				fail(
					`the remedy controls are off screen: their bottom is ${probe.controls.bottom} in a ${probe.viewport.height}px window (UX round 1, U3)`,
				);
			const labels = probe.controls.labels ?? [];
			if (
				labels.length !== expected.controlLabels.length ||
				expected.controlLabels.some((label, i) => labels[i] !== label)
			)
				fail(
					`the controls are ${JSON.stringify(labels)}, expected ${JSON.stringify(expected.controlLabels)}: the label is what tells the operator whether the press keeps their text (UX round 1, U9)`,
				);
		}
	}
	/*
	 * The cap's own numbers, asserted only where the copy genuinely overflows: the
	 * point of the pinning is that the region can hold more prose than it shows.
	 */
	/*
	 * THE COPY WRAPS RATHER THAN OVERFLOWING SIDEWAYS, in every case.
	 *
	 * Not a styling preference: the block is `overflow-y: auto` with the other axis
	 * computing to `auto` too, so a paragraph wider than the block is clipped per
	 * LINE, mid-word, with no scrollbar drawn at rest - every line loses its tail,
	 * which is where this app's and the backend's actionable clauses both live. The
	 * trigger is a word the app does not control coming through `detail.message`
	 * (the sibling's config root), so the assertion is made on every frame rather
	 * than on the one that carries the long copy.
	 */
	if (probe.capped && probe.capped.scrollWidth > probe.capped.clientWidth + 0.5)
		fail(
			`the prose block overflows horizontally (${probe.capped.scrollWidth} in ${probe.capped.clientWidth}), so every line of the sentence is cut mid-word at its right edge and the remedy clause is beyond it on all of them`,
		);
	if (expected.overflowing) {
		if (!probe.capped) fail("no capped prose block found at all");
		else {
			if (probe.capped.clientHeight > 120.5)
				fail(
					`the prose block is ${probe.capped.clientHeight}px tall, over the composer band's 120px whole-line cap`,
				);
			if (probe.capped.scrollHeight <= probe.capped.clientHeight)
				fail(
					`the copy does not overflow the cap (${probe.capped.scrollHeight} in ${probe.capped.clientHeight}), so this frame cannot show what pinning the remedy buys`,
				);
		}
	}
	if (probe.send && probe.send.bottom > probe.viewport.height)
		fail(
			`the send control is off screen: its bottom is ${probe.send.bottom} in a ${probe.viewport.height}px window`,
		);
	return failures;
};

const main = async () => {
	await startVite();
	const cdp = await startChrome();

	/*
	 * The frames and the readings are held in memory and written at the END, and
	 * only when every case passed (agent review round 1, R-1). Writing them inside
	 * the loop meant a run on a regressed tree overwrote the committed frames with
	 * the bad ones - beside a `readings.json` whose `failures` array said so, and
	 * with only the exit status to notice it.
	 */
	const shots = new Map();
	const records = [];
	const problems = [];

	for (const expected of CASES) {
		if (ONLY && !expected.file.includes(ONLY)) continue;
		const viewport = expected.viewport ?? VIEWPORT;
		const column = expected.column ?? COLUMN;
		await cdp.send("Emulation.setDeviceMetricsOverride", {
			width: viewport.width,
			height: viewport.height,
			deviceScaleFactor: 2,
			mobile: false,
		});
		await cdp.send("Page.navigate", { url: "about:blank" });
		await sleep(120);
		await cdp.send("Page.navigate", {
			url: `${ORIGIN}/store-refusal-evidence.html?case=${expected.case}&state=${expected.state}&w=${column}&theme=${THEME}`,
		});
		/*
		 * Ready is three conditions, not one: the font faces are loaded (the
		 * sentence's height is a line count times a line-height, and a fallback
		 * face measures a different one), the composer's own textarea exists, and
		 * the page has recorded the alert it painted.
		 */
		let ready = false;
		for (let i = 0; i < 240 && !ready; i++) {
			const { result } = await cdp.send("Runtime.evaluate", {
				returnByValue: true,
				expression: `(() => {
					if (document.fonts.status !== "loaded") return false;
					if (!document.querySelector("textarea")) return false;
					if (!window.__storeRefusalEvidence) return false;
					return window.__storeRefusalEvidence.alertText !== undefined;
				})()`,
			});
			ready = result.value === true;
			if (!ready) await sleep(250);
		}
		if (!ready) {
			/*
			 * A page that never mounted and a page mounting slowly are different
			 * failures, and a bare timeout reports neither, so the throw carries what
			 * the document actually holds.
			 */
			const { result: diagnostic } = await cdp.send("Runtime.evaluate", {
				returnByValue: true,
				awaitPromise: true,
				expression: `(async () => ({
					url: location.href,
					fonts: document.fonts.status,
					textarea: !!document.querySelector("textarea"),
					alert: !!document.querySelector('[role="alert"]'),
					evidence: window.__storeRefusalEvidence ?? null,
					importError: await import("/store-refusal-evidence.tsx").then(
						() => null,
						(e) => String(e && e.message ? e.message : e),
					),
				}))()`,
			});
			throw new Error(
				`${expected.file}: never became measurable - ${JSON.stringify(
					diagnostic.value,
				)}${cdp.log.length > 0 ? `\npage log:\n  ${cdp.log.slice(-6).join("\n  ")}` : ""}`,
			);
		}
		await cdp.send("Runtime.evaluate", {
			awaitPromise: true,
			expression:
				"new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))",
		});
		const { result } = await cdp.send("Runtime.evaluate", {
			returnByValue: true,
			expression: PROBE,
		});
		if (!result.value)
			throw new Error(`${expected.file}: no probe value returned`);
		const probe = result.value;
		const failures = assertions(probe, expected);
		records.push({
			file: expected.file,
			case: expected.case,
			state: expected.state,
			expected,
			viewport,
			column,
			...probe,
			failures,
		});
		for (const failure of failures)
			problems.push(`${expected.file}: ${failure}`);

		/*
		 * SETTLE THE POINTER BEFORE THE SHOT (design round 2, D7).
		 *
		 * `altered-held` did not reproduce: 4,004 pixels differed from an independent
		 * re-run, confined to the send control's own box, because the still caught the
		 * control mid-transition at (51,179,95) where a re-run paints the resting
		 * accent `#38c96a`. Anything hover- or transition-dependent belongs to the
		 * pointer's history rather than to the state, so it is parked at the origin and
		 * the frame waits for the transition to finish before it is taken - the same
		 * reason the driver waits for the fonts.
		 */
		await cdp.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			x: 0,
			y: 0,
		});
		await sleep(400);
		await cdp.send("Runtime.evaluate", {
			awaitPromise: true,
			expression:
				"new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))",
		});
		const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
		shots.set(`${expected.file}.png`, Buffer.from(shot.data, "base64"));
	}

	teardown();

	const report = records.map((record) => ({
		file: record.file,
		state: record.state,
		expectedCode: record.expected.arm,
		status: record.evidence?.status,
		code: record.evidence?.code,
		rowCode: record.evidence?.rowCode,
		heldClaimCode: record.evidence?.heldClaimCode,
		withholdRetryHint: record.evidence?.withholdRetryHint,
		storeWriteRefusal: record.evidence?.storeWriteRefusal,
		claimStoreWriteRefusal: record.evidence?.claimStoreWriteRefusal,
		box: record.boxValue === "" ? "(empty)" : record.boxValue,
		controls: record.controls?.labels ?? null,
		alertProse: record.alertProse,
		visibleProse: record.visibleProse,
		alertText: record.alertText,
		failures: record.failures,
	}));

	if (problems.length > 0) {
		for (const problem of problems) process.stderr.write(`FAIL ${problem}\n`);
		process.stderr.write(
			`\n${problems.length} assertion(s) failed: nothing was written to ${OUT}, so the committed frames and readings are untouched (agent review round 1, R-1)\n`,
		);
		if (AS_JSON) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
		process.exitCode = 1;
		return;
	}

	mkdirSync(OUT, { recursive: true });
	for (const [name, bytes] of shots) writeFileSync(join(OUT, name), bytes);
	writeFileSync(
		join(OUT, "readings.json"),
		`${JSON.stringify(
			{
				capturedAt: new Date().toISOString(),
				theme: THEME,
				comment:
					"Read out of the live DOM per frame. `failures` is empty for every row by construction: a run with any failure writes neither the frames nor this file (agent review round 1, R-1).",
				cases: records.map((record) => ({
					file: record.file,
					case: record.case,
					state: record.state,
					viewport: record.viewport,
					column: record.column,
					status: record.evidence?.status,
					code: record.evidence?.code,
					rowCode: record.evidence?.rowCode,
					rowMessage: record.evidence?.rowMessage,
					message: record.evidence?.message,
					heldClaimCode: record.evidence?.heldClaimCode,
					withholdRetryHint: record.evidence?.withholdRetryHint,
					storeWriteRefusal: record.evidence?.storeWriteRefusal,
					claimStoreWriteRefusal: record.evidence?.claimStoreWriteRefusal,
					refusedBeforeAdmission: record.evidence?.refusedBeforeAdmission,
					admissionAttempted: record.evidence?.admissionAttempted,
					submittedText: record.evidence?.submittedText,
					submittedAttachments: record.evidence?.submittedAttachments,
					boxValue: record.boxValue,
					boxAttachments: record.evidence?.boxAttachments,
					alertProse: record.alertProse,
					visibleProse: record.visibleProse,
					alertText: record.alertText,
					region: record.region,
					capped: record.capped,
					controls: record.controls,
					send: record.send,
					failures: record.failures,
				})),
			},
			null,
			2,
		)}\n`,
	);

	if (AS_JSON) {
		process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
		return;
	}
	for (const row of report)
		process.stdout.write(
			`PASS ${row.file}: ${row.status}/${row.code} withholdRetryHint=${row.withholdRetryHint} storeWriteRefusal=${row.storeWriteRefusal} claimStoreWriteRefusal=${row.claimStoreWriteRefusal}\n  painted: ${row.visibleProse}\n  rendered: ${row.alertProse}\n  controls: ${JSON.stringify(row.controls)}\n`,
		);
	process.stdout.write(`\nframes: ${OUT}\n`);
};

await main();
