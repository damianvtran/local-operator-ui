#!/usr/bin/env node
/**
 * Photograph what the composer does with a refusal the session owner raised
 * before admission, one arm per state.
 *
 *     node docs/evidence/owner-refusal-send/harness/capture.mjs <out-dir> [--tree=after]
 *
 * One command, self-contained and reaped: this script starts the scripted owner
 * (`stub-owner.mjs`), the app's own browser dev server (`app.vite.mjs`) and its
 * own private headless Chrome, drives the shipped composer through a send, and
 * kills all three on the way out - including on a failure - so a run leaves
 * nothing behind for the next session to find. The alternative (three terminals
 * and a hand-taken screenshot) is what the frames beside this file exist to
 * replace.
 *
 * WHAT IS REAL HERE, and what the README repeats beside the frames: the
 * transport, the error decoding, the canonical store's classification, the
 * composer and its copy are the SHIPPING code, reached through
 * `desktopProxyPlugin`'s `/__desktop` route - the same `requestDesktop` in
 * `src/main/desktop-transport.ts` that Electron's IPC handler calls. The OWNER's
 * verdict is substituted at the HTTP boundary, because reaching a real build
 * drain or a wedged owner on demand is not reproducible; the sentences it
 * answers with are quoted from the backend's own (`session/errors.py` and the
 * two owner codes in `shared/desktop-contract.ts`). Packaged Electron IPC, a
 * native window and the real ladder's timing are NOT proven here.
 *
 * WHAT IS ASSERTED, and why a frame alone cannot carry it. Every arm is driven
 * through the same pipeline with the same box, and the finding is a DIFFERENCE
 * between the halves: the state the refusal leaves (which of the box, the echo,
 * the claim and the retry hint move) - so the run records those readings per
 * arm as JSON and fails if the screen does not show what the arm claims to have
 * reached. A frame with no alert and no explanation is evidence for nothing,
 * which is how the blank-frame class this rig guards against reaches a PR.
 */

import { spawn } from "node:child_process";
import {
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
/* The one thing this rig shares with `scripts/`: the switch that keeps its own
   Chrome out of the operator's keychain. A scratch `HOME` has no login keychain,
   and Chrome then asks the operator to authorize creating one. */
import { withMockKeychain } from "../../../../scripts/chrome-keychain.mjs";

const ROOT = resolve(import.meta.dirname, "../../../..");
const HARNESS = import.meta.dirname;
const OUT = process.argv[2];
const TREE = (
	process.argv.find((a) => a.startsWith("--tree=")) ?? "--tree=after"
).split("=")[1];
/** `--only=<arm>` runs one arm, for the inner loop while this rig is being built. */
const ONLY = (
	process.argv.find((a) => a.startsWith("--only=")) ?? "--only="
).split("=")[1];
if (!OUT) {
	process.stderr.write("usage: capture.mjs <out-dir> [--tree=after|before]\n");
	process.exit(2);
}

const APP_PORT = Number(process.env.OWNER_REFUSAL_APP_PORT ?? 5197);
const OWNER_PORT = Number(process.env.OWNER_REFUSAL_OWNER_PORT ?? 8791);
const CDP_PORT = Number(process.env.OWNER_REFUSAL_CDP_PORT ?? 9333);
/* `localhost` rather than `127.0.0.1`: the dev server binds the name, which on
   this host is the IPv6 loopback, and a run that asked for the v4 literal waited
   out its own readiness window against a server that was already up. */
const ORIGIN = `http://localhost:${APP_PORT}`;
/* A realistic sentence, because the frames' geometry is part of what they
   record: the owner's two-line refusal is the longest prose this composer
   renders in these states, and a short stand-in would hide a cap. */
const MESSAGE =
	"Please re-run the failing case with the trace enabled and paste the last twenty lines here.";
/*
 * THE LINE THE USER TYPES WHILE THE SEND IS STILL IN FLIGHT (review round 2). The
 * duplicate arrived through Send rather than Retry precisely because this is an
 * ordinary thing to do: the message is out, the box is empty, and the next line
 * goes in before the first one settles.
 */
const FOLLOW_UP =
	"and here is my own next line, typed while that one was still on its way";

/**
 * The arms, and what each one is for. `refusals` is the number of message
 * requests the owner refuses BEFORE it starts admitting, which is what makes an
 * arm show a refusal at all: `busy-exhausted` refuses four because the app
 * spends three of its own repeats (`BUSY_RESENDS`) before the composer is told.
 */
const ARMS = [
	{
		name: "retiring",
		refusals: 1,
		expectRefusal: true,
		// The change under evidence: a 409 `runtime_retiring` is raised before
		// admission, so the text belongs back in the box.
		why: "one refusal, then admission - the 409 the incident turned into a held draft",
	},
	{
		name: "busy-exhausted",
		refusals: 4,
		expectRefusal: true,
		why: "the 503 `runtime_busy` that survives the app's own three repeats",
	},
	{
		name: "busy-internal",
		refusals: 2,
		expectRefusal: false,
		why: "the same 503 answered by the app's own repeats, so the composer never sees it",
	},
	{
		name: "unreachable",
		refusals: Number.POSITIVE_INFINITY,
		expectRefusal: true,
		why: "the CONTROL: a hop failure whose ack may be the only thing lost stays held",
	},
	/*
	 * THE DEADLINE ARM, and the one the operator's screenshot came from (review
	 * round 1, B3/B4 and the Q-matrix's Q2-Q5): the owner holds the first request
	 * past the app's own 20 s budget and then ADMITS it, so the frame is the real
	 * transport deadline over the real composer rather than a substituted error.
	 *
	 * THREE CLAIMS IN ONE RUN: the message and its file are still in the box with
	 * one sentence and both controls (the whole PR); the retry is the operator's own
	 * remedy and it works (the second send admits); and the two attempts carry ONE
	 * request id, which is what makes the owner's receipt a de-duplication rather
	 * than a second message - the no-duplicate proof, read off the owner's own log.
	 */
	{
		name: "timeout-admitted",
		refusals: 0,
		holdMs: 21_000,
		expectRefusal: true,
		why: "the transport deadline over a live, slow owner: the message is kept and one sentence offers the retry the receipt de-duplicates",
	},
	/*
	 * THE DUPLICATE ARM (review round 2, R2/U1), and the reason the owner has to
	 * admit the message AFTER the deadline: that is what makes the app reconcile. The
	 * user types their next line while the first is in flight, so the returned message
	 * lands in the box IN FRONT of their words - and the app then learns the first one
	 * was delivered. The box must end up holding ONLY the typed line, and pressing
	 * Send must put only that line on the wire: everything else is the a9cbe9bf /
	 * c47f3028 pair.
	 */
	{
		name: "late-typed",
		refusals: 0,
		holdMs: 21_000,
		expectRefusal: true,
		custom: "late-typed",
		why: "typed while in flight, then the owner admits it: the box keeps only the typed line and the next send carries only that",
	},
	/*
	 * THE PRESS THAT LANDS INSIDE THE FLIGHT (UX round 3, U6). The first send is held
	 * by the owner, the user types their next line, and they press Send while the
	 * request is still out. Before the fix the press reached an ENABLED control and
	 * answered nothing at all - no line on screen, no second attempt - which is what
	 * makes a user press again over a box that by then holds both messages. The arm
	 * asserts the DOM the user is looking at, and the owner's own log for the other
	 * half of the claim: the press admitted nothing, so nothing went out twice.
	 */
	{
		name: "press-during-flight-settles",
		refusals: 0,
		holdMs: 8_000,
		expectRefusal: false,
		custom: "press-during-flight",
		why: "a press inside a flight that SUCCEEDS: the line is answered during it, and gone once the message is in the transcript",
	},
	{
		name: "press-twice-no-stall",
		refusals: 0,
		holdMs: 900,
		expectRefusal: false,
		custom: "press-twice-no-stall",
		why: "a press inside an ordinary slow send, then the user's next line: two rows, not one glued row, and no line left behind",
	},
	{
		name: "budget-409",
		refusals: 1,
		expectRefusal: true,
		custom: "budget-409",
		why: "the daemon's own codeless budget refusal: one sentence and Clear only, the same before and after a remount",
	},
	{
		name: "press-during-flight",
		refusals: 0,
		holdMs: 21_000,
		expectRefusal: true,
		custom: "press-during-flight",
		why: "a press while the first send is still out: the composer answers it in words, and no second attempt reaches the owner",
	},
	/*
	 * AND TWO FAILED ROUNDS (UX round 2, U9): the composer's text accumulated across
	 * consecutive failures and came back after a reload as one run-together blob. The
	 * question the frame answers is what the box holds once, after the second round and
	 * a reload.
	 */
	{
		name: "rounds-two",
		refusals: 2,
		expectRefusal: true,
		custom: "rounds-two",
		why: "two rounds that both fail, then a reload: the message is in the box once, not accumulated",
	},
];

/** Same minimal CDP client as `scripts/capture-evidence.mjs`. */
class Cdp {
	constructor(ws) {
		this.ws = ws;
		this.next = 0;
		this.pending = new Map();
		ws.addEventListener("message", (ev) => {
			const msg = JSON.parse(ev.data);
			if (msg.id !== undefined && this.pending.has(msg.id)) {
				const { resolve, reject } = this.pending.get(msg.id);
				this.pending.delete(msg.id);
				msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
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
 * The DOM readings a frame can only illustrate.
 *
 * `alertProse` is the alert region's PARAGRAPHS rather than its whole text: the
 * pinned control row's labels sit in the same region, and "the app says a fact"
 * is a claim about a sentence. `visibleProse` is what is actually painted - the
 * region caps itself, so text taken from the DOM can name words the window never
 * shows - and `boxValue` is the finding that matters most here: the text the
 * composer is holding for the operator, which is empty on a held claim and
 * carries their message when the refusal handed it back.
 */
/*
 * The note, in EITHER register (UX round 7, U22). A muted statement of fact is
 * role=status - the late-delivery line is one - and this probe read only role=alert, so it
 * had no source at all for that note's prose, which is one of the two reasons the
 * late-typed arm cannot see the line it is about. Same widening the geometry rig needed
 * (design round 4, D12), and the comment deliberately sits OUTSIDE the template: a
 * backtick inside it would end the literal, which is how that rig broke.
 */
const PROBE = `(() => {
	const region = document.querySelector('[role="alert"], [role="status"]');
	const textarea = document.querySelector("textarea");
	const press = (el) => {
		if (!el) return;
		el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 }));
		el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }));
		el.click();
	};
	window.__ownerRefusalPress = press;
	const paragraphs = region ? [...region.querySelectorAll("p")] : [];
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
			const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
			let run = "";
			for (let node = walker.nextNode(); node; node = walker.nextNode()) {
				const text = node.nodeValue || "";
				for (let i = 0; i < text.length; i++) {
					const range = document.createRange();
					range.setStart(node, i);
					range.setEnd(node, i + 1);
					const painted = [...range.getClientRects()].some(
						(r) => r.height > 0 && r.top >= top - 0.5 && r.bottom <= bottom + 0.5,
					);
					if (painted) run += text[i];
					else if (run.trim()) { parts.push(run.trim()); run = ""; }
				}
				if (run.trim()) { parts.push(run.trim()); run = ""; }
			}
		}
		return parts.join(" ").replace(/\\s+/g, " ").trim();
	};
	const controlLabels = region
		? [...region.querySelectorAll("button")].map((b) => (b.textContent || "").trim())
		: [];
	const scroller = document.querySelector("[data-lo-canonical-transcript]");
	const transcriptRows = scroller ? [...scroller.querySelectorAll("[data-record-id]")] : [];
	const hasKind = Boolean(scroller?.querySelector("[data-record-kind]"));
	return {
		regionPresent: !!region,
		alertProse: region
			? paragraphs.map((p) => p.textContent || "").join(" ").replace(/\\s+/g, " ").trim()
			: null,
		visibleProse: visibleProse(),
		controlLabels,
		boxValue: textarea ? textarea.value : null,
		textareas: [...document.querySelectorAll("textarea")].map((t) => t.getAttribute("aria-label")),
		/* The transcript's painted rows, and - where the page can name a row's
		   SPEAKER - how many of them are the operator's own. Two fields rather than
		   one because the marker the count needs is itself part of this branch: the
		   probe that preceded these matched '[data-role="user"],
		   [data-testid="user-row"]', none of which exists anywhere in 'src/', so it
		   read 0 over frames that plainly painted the echo - a dead instrument
		   standing under the one claim the transcript half of these frames makes
		   (agent review R-5, design D1).

		   'transcriptRows' spans BOTH halves ('data-record-id' is on every row of
		   the shipping transcript, including origin/main's), so it is the reading the
		   two halves can be compared on. 'transcriptUserRows' is the speaker-scoped
		   one, and it is 'null' ONLY where rows are painted on a page that carries no
		   'data-record-kind' (the origin/main half): "this page cannot name a
		   speaker" and "no user row is painted" are different facts, and the second
		   is the one the frames are about - a page with no rows at all answers 0,
		   which is exactly what a retracted echo leaves behind. */
		/* The rows' own words, so a frame can show WHICH message is in the
		   transcript rather than only how many: the duplicate is a second row
		   carrying the first one's text, which a count alone cannot tell from a
		   legitimate second message. */
		transcriptRowTexts: transcriptRows.map((row) =>
			(row.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 160),
		),
		transcriptRows: transcriptRows.length,
		transcriptUserRows:
			transcriptRows.length === 0
				? 0
				: hasKind
					? transcriptRows.filter((row) => row.dataset.recordKind === "user").length
					: null,
		theme: document.documentElement.dataset.theme,
		/* What the page SAYS, for the failure a frame cannot explain on its own: a run
		   that reports "nothing mounted" is a question about a screen nobody saw. */
		bodyText: document.body.innerText.replace(/\\s+/g, " ").slice(0, 500),
	};
})()`;

/*
 * THE TWO ARMS WHOSE SHAPE IS A SEQUENCE RATHER THAN ONE PRESS, and they are the
 * arms that reproduce what round 2 found: a send that is still in flight while the
 * user types their next line, and two rounds that both fail.
 *
 * `late-typed` is the duplicate. The first message is held past the app's own
 * deadline, which puts it back in the box; the user's line was typed while it was
 * out, so the returned message lands IN FRONT of it. The owner then ADMITS the
 * message, and the app learns that from the owner's own row - which is why this
 * rig's owner serves the admitted message as durable history (`stub-owner.mjs`):
 * a stub whose history is empty can never make the reconciliation run, and the
 * duplicate it prevents stays as invisible in a rig as it was on the screen. The
 * reload is how the row is read: the app opens the conversation again, reads its
 * history, and the reconciliation fires on the mounted composer.
 *
 * `rounds-two` is the accumulation (U9): two failures and a reload, and the box
 * must hold the message ONCE.
 */
const runCustom = async (
	arm,
	{ evaluate, shoot, logPath, first, waitForSendSettled },
) => {
	const boxValue = () =>
		evaluate(`(() => {
			const area = document.querySelector('textarea[aria-label="Message"]');
			return area ? area.value : null;
		})()`);
	const typeInto = (text) =>
		evaluate(`(() => {
			const area = document.querySelector('textarea[aria-label="Message"]');
			const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
			setter.call(area, ${JSON.stringify(text)});
			area.dispatchEvent(new Event("input", { bubbles: true }));
			return area.value;
		})()`);
	const pressSend = () =>
		evaluate(`(() => {
			const send = document.querySelector('button[aria-label="Send message"]');
			if (!send) throw new Error("no send control");
			send.click();
			return true;
		})()`);
	/*
	 * COUNTED rather than sliced from a byte offset: the wait is for ONE MORE
	 * admission than there was when the typing started, which cannot be fooled by a
	 * log that grew, was rewritten, or holds the same sentence from an earlier arm.
	 */
	const admissions = () =>
		(readFileSync(logPath, "utf8").match(/-> 200 admitted/g) ?? []).length;
	const waitForOwnerToAdmit = async () => {
		/*
		 * ONE admission in THIS ARM'S OWN log, and no target arithmetic: the log is
		 * `wireDir/<arm>.log`, one file per arm, and by the time this runs the hold may
		 * already have expired - the typing and the frame happen while the request is
		 * still pending, but the settle wait that precedes them can outlast the 21 s
		 * hold, so "one more than before" is a target the arm has already passed.
		 */
		for (let attempt = 0; attempt < 60; attempt++) {
			if (admissions() >= 1) return;
			await sleep(1000);
		}
		throw new Error(
			`${arm.name}: the owner never admitted the message (log:\n${readFileSync(logPath, "utf8")})`,
		);
	};
	/*
	 * THE RELOAD IS THE HISTORY READ. The owner's row is served by the stub's history
	 * page, and the pane reads that page when it mounts - so a fresh mount is what
	 * makes the reconciliation run, exactly as it does for a user who quits and comes
	 * back to a message that had been sent.
	 */
	const reload = async () => {
		await evaluate(`(() => { location.reload(); return true; })()`);
		for (let attempt = 0; attempt < 240; attempt++) {
			if (
				await evaluate(
					`Boolean(document.querySelector('textarea[aria-label="Message"]'))`,
				)
			) {
				// One more beat for the pane's reconciliation effect, which runs on the
				// commit after the transcript's own row lands.
				await sleep(4000);
				return;
			}
			await sleep(1000);
		}
		throw new Error(
			`${arm.name}: the composer never came back after the reload, so this frame would photograph the wrong screen`,
		);
	};

	/*
	 * THE TWO ARMS WHOSE WORK IS DONE BEFORE THIS FUNCTION RUNS. Both press INSIDE the
	 * flight, and this function is reached after the rig's own settle wait - so their
	 * assertions have already run against the live DOM by the time control arrives
	 * here, and an arm that pressed a flight that is now over has nothing left to say.
	 */
	if (
		arm.custom === "press-during-flight-settles" ||
		arm.custom === "press-twice-no-stall"
	)
		return {};

	if (arm.custom === "budget-409") {
		/*
		 * M1'S OWN ARM: one failure, one sentence, and the SAME one after a remount.
		 * The pane used to classify this failure itself from the pre-send row while the
		 * store's row said something else, so the screen and the row disagreed until a
		 * remount flipped the screen to the row's answer.
		 */
		const before = await evaluate(PROBE);
		await shoot("refused");
		process.stdout.write(
			`  ${arm.name}: alert=${JSON.stringify((before.alertProse ?? "").slice(0, 200))} box=${JSON.stringify((before.boxValue ?? "").slice(0, 60))} controls=${JSON.stringify(before.controlLabels ?? [])}\n`,
		);
		await reload();
		const afterReload = await evaluate(PROBE);
		await shoot("after-reload");
		process.stdout.write(
			`  ${arm.name} after reload: alert=${JSON.stringify((afterReload.alertProse ?? "").slice(0, 200))} controls=${JSON.stringify(afterReload.controlLabels ?? [])}\n`,
		);
		if ((before.alertProse ?? "") !== (afterReload.alertProse ?? ""))
			throw new Error(
				`${arm.name}: one failure rendered two ways - before the remount ${JSON.stringify((before.alertProse ?? "").slice(0, 160))}, after ${JSON.stringify((afterReload.alertProse ?? "").slice(0, 160))}`,
			);
		if (/Sending it again is safe/.test(before.alertProse ?? ""))
			throw new Error(
				`${arm.name}: the unknown-outcome sentence rendered over a refusal the daemon stated (${JSON.stringify((before.alertProse ?? "").slice(0, 200))})`,
			);
		return { afterReload };
	}

	if (arm.custom === "press-during-flight") {
		/*
		 * AND THE FLIGHT SETTLES: the owner admits the first message after its hold, the
		 * app reconciles, and the transcript must hold it exactly once - the side effect
		 * every duplicate in this round was measured as. The press above added no second
		 * request, which the owner's own log is the record of.
		 */
		await waitForOwnerToAdmit();
		await sleep(5000);
		const settled = await evaluate(PROBE);
		await shoot("after-flight-settled");
		process.stdout.write(
			`  ${arm.name} settled: ${JSON.stringify({ userRows: settled.transcriptUserRows, box: (settled.boxValue ?? "").slice(0, 60), alert: (settled.alertProse ?? "").slice(0, 160) })}\n`,
		);
		/*
		 * The claim this arm owns is the count of REQUESTS, not the transcript's own
		 * timing: the press added none, so one message went out once. The transcript
		 * reading is printed rather than asserted, because the row's arrival here rides
		 * the live stream after a hold this rig ends with a kill.
		 */
		/*
		 * DISTINCT IDS, not attempts: the app's own ladder repeats a request the owner
		 * has not answered yet, and those repeats are supposed to be there - they carry
		 * the SAME request id, which is what makes the owner's receipt a de-duplication.
		 * A second id is a second message, and ruling that out is what this arm exists for.
		 */
		const ids = new Set(
			(
				readFileSync(logPath, "utf8").match(/request_id=([0-9a-f-]+)/g) ?? []
			).map((line) => line.slice("request_id=".length)),
		);
		if (ids.size !== 1)
			throw new Error(
				`${arm.name}: ${ids.size} request ids reached the owner for one message and one refused press (${[...ids].join(", ")})`,
			);
		/*
		 * `afterReload` under its own name because that is the field the readings summary
		 * and this set's page read for every custom arm; here it is the settled state.
		 */
		return { afterReload: settled };
	}

	if (arm.custom === "late-typed") {
		const typed = `${await boxValue()}\n\n${FOLLOW_UP}`;
		await typeInto(typed);
		await sleep(600);
		await shoot("typed-in-flight");
		await waitForOwnerToAdmit();
		/*
		 * FIRST the LIVE path: the owner publishes the row on the session stream, so
		 * the app reconciles with the pane mounted - which is the flow the round
		 * reproduced (a9cbe9bf, then c47f3028). The reload that follows is the second
		 * route to the same fact, the history page a returning reader gets.
		 */
		await sleep(6000);
		const live = await evaluate(PROBE);
		process.stdout.write(
			`  ${arm.name} live: ${JSON.stringify({
				rows: live.transcriptRowTexts,
				userRows: live.transcriptUserRows,
				box: live.boxValue,
				alert: (live.alertProse ?? "").slice(0, 160),
			})}\n`,
		);
		await shoot("after-late-delivery-live");
		await reload();
		const afterReload = await evaluate(PROBE);
		process.stdout.write(
			`  ${arm.name} after reload: ${JSON.stringify({
				rows: afterReload.transcriptRowTexts,
				userRows: afterReload.transcriptUserRows,
				box: afterReload.boxValue,
				alert: (afterReload.alertProse ?? "").slice(0, 160),
			})}\n`,
		);
		await shoot("after-late-delivery");
		/*
		 * THE DUPLICATE'S OWN ASSERTION, and the reason this arm exists: the delivered
		 * words are OUT of the box, the user's line is what is left, the note says so,
		 * and the transcript holds the message exactly once.
		 */
		if (afterReload.boxValue !== FOLLOW_UP)
			throw new Error(
				`${arm.name}: the box after the late delivery is ${JSON.stringify(afterReload.boxValue)} - it must hold ONLY the typed line, or the next press sends the delivered words a second time (probe: ${JSON.stringify({ rows: afterReload.transcriptRowTexts, userRows: afterReload.transcriptUserRows, alert: (afterReload.alertProse ?? "").slice(0, 200), body: (afterReload.bodyText ?? "").slice(0, 300) })}; owner log:\n${readFileSync(logPath, "utf8")})`,
			);
		if (afterReload.transcriptUserRows !== 1)
			throw new Error(
				`${arm.name}: the transcript holds ${afterReload.transcriptUserRows} user rows for one delivered message (${JSON.stringify(afterReload.transcriptRowTexts)})`,
			);
		const prose = `${afterReload.alertProse ?? ""} ${afterReload.bodyText ?? ""}`;
		if (!prose.includes("Your earlier message was delivered"))
			throw new Error(
				`${arm.name}: the muted late-delivery line never rendered (prose: ${JSON.stringify(prose.slice(0, 240))})`,
			);
		if (!prose.includes("What's here now hasn't been sent"))
			throw new Error(
				`${arm.name}: the note does not say that what is in the box has not been sent, so the user cannot tell their line from the message that went (prose: ${JSON.stringify(prose.slice(0, 240))})`,
			);
		// And the press that follows carries the typed line ALONE.
		const beforeSecond = readFileSync(logPath, "utf8");
		await pressSend();
		await waitForSendSettled(evaluate, logPath, arm, "second", "sent");
		await sleep(1500);
		const afterSecond = await evaluate(PROBE);
		await shoot("after-next-send");
		const attempts = [
			...readFileSync(logPath, "utf8").matchAll(/request_id=([0-9a-f-]+)/g),
		].map((m) => m[1]);
		const bodies = [
			...readFileSync(logPath, "utf8").matchAll(/text=(.*?)(?: ->|$)/gm),
		].map((m) => m[1]);
		if (attempts.length !== 2)
			throw new Error(
				`${arm.name}: expected two attempts at the owner (one delivered, one the user's own line), saw ${attempts.length}`,
			);
		if (bodies.length >= 2) {
			const second = bodies.at(-1);
			if (!second.includes("my own next line"))
				throw new Error(
					`${arm.name}: the second message is not the user's typed line (${JSON.stringify(second)})`,
				);
			if (second.includes("Please re-run the failing case"))
				throw new Error(
					`${arm.name}: THE DUPLICATE - the second message carries the delivered words too (${JSON.stringify(second)})`,
				);
		}
		const delivered = (afterSecond.transcriptRowTexts ?? []).filter((text) =>
			text.includes("Please re-run the failing case"),
		);
		return {
			typed,
			live,
			afterReload,
			afterSecond,
			requestIds: attempts,
			bodies,
			deliveredRows: delivered.length,
			secondWire: beforeSecond.length ? "recorded" : "recorded",
		};
	}

	if (arm.custom === "rounds-two") {
		const firstBox = await boxValue();
		await pressSend();
		await sleep(6000);
		const secondBox = await boxValue();
		await reload();
		const afterReload = await evaluate(PROBE);
		await shoot("after-reload");
		const occurrences = (afterReload.boxValue ?? "").split(MESSAGE).length - 1;
		if (afterReload.boxValue !== MESSAGE)
			throw new Error(
				`${arm.name}: the box after two failed rounds and a reload is ${JSON.stringify(afterReload.boxValue)} (${occurrences} copies of the message) - it must hold the message exactly once`,
			);
		return { firstBox, secondBox, afterReload, occurrences };
	}

	throw new Error(`${arm.name}: unknown custom arm`);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const children = [];
const reap = () => {
	for (const child of children.splice(0)) killGroup(child);
};
const launch = (command, args, options = {}) => {
	const child = spawn(command, args, {
		detached: true,
		stdio: "ignore",
		...options,
	});
	children.push(child);
	return child;
};

/** Each abandoned profile is ~180MB that nothing else collects; a run killed by
 * a wrapper never reaches `reap`. */
const sweepStaleProfiles = () => {
	const mine = `lo-owner-refusal-${process.pid}`;
	for (const name of readdirSync(tmpdir())) {
		if (!name.startsWith("lo-owner-refusal-") || name === mine) continue;
		try {
			process.kill(Number(name.slice("lo-owner-refusal-".length)), 0);
			continue;
		} catch {
			rmSync(join(tmpdir(), name), { recursive: true, force: true });
		}
	}
};

/**
 * Whether something is listening on a loopback port.
 *
 * A raw `net.connect` rather than `fetch`: a fetch to a CLOSED port on this Node
 * (26.5.0) throws `setTypeOfService EINVAL` out of undici rather than rejecting
 * with a connection error, which kills the run instead of answering the question.
 */
const portOpen = (host, port) =>
	new Promise((resolve) => {
		const socket = connect({ host, port });
		socket.setTimeout(400);
		socket.once("connect", () => {
			socket.destroy();
			resolve(true);
		});
		socket.once("timeout", () => {
			socket.destroy();
			resolve(false);
		});
		socket.once("error", () => {
			socket.destroy();
			resolve(false);
		});
	});

/** Wait for a listener, and then for one HTTP answer, so a run cannot photograph a half-started server. */
const waitForHttp = async (url, timeoutMs) => {
	const deadline = Date.now() + timeoutMs;
	// The host the URL itself names, not a loopback literal: the dev server binds
	// the NAME, which is the IPv6 loopback here, so a v4 probe never sees it.
	const { hostname, port } = new URL(url);
	for (;;) {
		if (await portOpen(hostname, Number(port))) {
			try {
				const response = await fetch(url);
				if (response.ok) return true;
			} catch {
				/* listening but not answering yet */
			}
		}
		if (Date.now() > deadline) return false;
		await sleep(300);
	}
};

/**
 * Kill one launched process and its group.
 *
 * Every launch here is `detached` precisely so this can kill the GROUP: the
 * children these processes spawn (Chrome's helpers, esbuild under vite) are not
 * ours to name by pid, and an abandoned one holds a port the next arm needs.
 */
const killGroup = (child) => {
	try {
		process.kill(-child.pid, "SIGKILL");
	} catch {
		try {
			child.kill("SIGKILL");
		} catch {
			/* already gone */
		}
	}
};

/** Wait for a port to be free again, so the next arm's owner is the one answering. */
const waitForPortFree = async (host, port, timeoutMs) => {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		if (!(await portOpen(host, port))) return true;
		if (Date.now() > deadline) return false;
		await sleep(200);
	}
};

/**
 * Wait until a send has settled into the shape THIS arm can end in.
 *
 * A refusal paints its sentence in the alert region; an arm that refuses nothing
 * empties the box and paints the message in the transcript. Anything else is
 * still in flight - a cold engage, or the app's own paced busy repeats - and
 * photographing that records a state neither half of the evidence is about. The
 * two shapes are polled SEPARATELY rather than as one "something happened": on
 * the created-session arm the box empties when the echo paints, milliseconds
 * BEFORE the refusal arrives, so a predicate that accepted either would stop at
 * the empty box and photograph a send still in flight (measured: it did, on the
 * arm whose owner is busy).
 *
 * The transcript is probed by its TEXT, with the sidebar excluded: what the frame
 * has to show is the operator's own words in the conversation, and a staged
 * draft's row title carries those same words on a surface that is not a send.
 * The transcript's markup is a component's business rather than this rig's.
 *
 * The owner's log is quoted in the timeout message, because the interesting
 * failure is a send that never settled for a reason only that log can name.
 */
const waitForSendSettled = async (evaluate, wirePath, arm, which, expects) => {
	const needle = MESSAGE.slice(0, 40);
	let state = null;
	for (let attempt = 0; attempt < 90; attempt++) {
		state = await evaluate(`(() => {
			const region = document.querySelector('[role="alert"]');
			const textarea = document.querySelector("textarea");
			const prose = region
				? [...region.querySelectorAll("p")].map((p) => p.textContent || "").join(" ")
				: "";
			let spoken = "";
			const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
			for (let node = walker.nextNode(); node; node = walker.nextNode()) {
				if (node.parentElement && node.parentElement.closest("nav")) continue;
				spoken += node.nodeValue || "";
			}
			return {
				alert: Boolean(prose.trim()),
				box: textarea ? textarea.value : null,
				onScreen: spoken.includes(${JSON.stringify(needle)}),
			};
		})()`);
		// THE SHAPE THIS SEND CAN END IN, never "either": see the note above. The two
		// call sites differ on purpose - the second send is always an admission, even
		// on an arm whose FIRST one is refused (that is the operator's remedy, and the
		// frame exists to show it lands).
		const settled =
			expects === "refusal" ? state.alert : state.box === "" && state.onScreen;
		if (settled) {
			// One more commit: a refusal's retraction and the composer's restore of the
			// text are state updates that land after the alert's first paint.
			await sleep(700);
			return state;
		}
		await sleep(1000);
	}
	throw new Error(
		`${arm.name}: the ${which} send never settled - neither the owner's sentence nor the message in the transcript (last probe: ${JSON.stringify(state)}; owner log:\n${readFileSync(wirePath, "utf8")})`,
	);
};

const main = async () => {
	sweepStaleProfiles();
	mkdirSync(OUT, { recursive: true });

	/* The app's own browser dev server: the shipped renderer over the shipped
	   `/__desktop` transport. It holds no arm of its own - the arm lives in the
	   owner it proxies to - so it starts once and stays up for every arm. */
	launch(
		process.execPath,
		[
			join(ROOT, "node_modules/vite/bin/vite.js"),
			"--config",
			join(HARNESS, "app.vite.mjs"),
		],
		{
			cwd: ROOT,
			env: {
				...process.env,
				LOCAL_OPERATOR_DESKTOP_BACKEND_URL: `http://127.0.0.1:${OWNER_PORT}`,
				LOCAL_OPERATOR_DESKTOP_TOKEN: "owner-refusal-stub",
				OWNER_REFUSAL_APP_PORT: String(APP_PORT),
			},
		},
	);
	if (!(await waitForHttp(`${ORIGIN}/`, 90_000)))
		throw new Error("the app dev server never came up");

	const dataDir = join(tmpdir(), `lo-owner-refusal-${process.pid}`);
	mkdirSync(dataDir, { recursive: true });
	launch(
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		withMockKeychain([
			"--headless=new",
			"--no-sandbox",
			"--disable-gpu",
			"--hide-scrollbars",
			`--remote-debugging-port=${CDP_PORT}`,
			`--user-data-dir=${dataDir}`,
			"--no-first-run",
			"--no-default-browser-check",
			"about:blank",
		]),
	);

	const readings = { tree: TREE, message: MESSAGE, arms: [] };
	const wireLog = [];
	/* The owner's own log is the second half of the evidence: it records every
	   message request with its `request_id` and the answer it got, so "the repeat
	   carries the same identity" is a measurement rather than a reading of our own
	   code. Per-arm logs are written out of tree and collected into one file beside
	   the frames, so the evidence directory holds frames and readings and nothing
	   a run scribbles. */
	const wireDir = join(tmpdir(), `lo-owner-refusal-wire-${process.pid}`);
	mkdirSync(wireDir, { recursive: true });
	let owner = null;
	for (const arm of ARMS.filter((a) => !ONLY || a.name === ONLY)) {
		/* EACH ARM'S OWNER REPLACES THE LAST ONE'S, and the port is waited free
		   rather than assumed: a launch that fails to bind (EADDRINUSE, stdio
		   discarded) leaves the PREVIOUS arm's script answering, which is how a run
		   photographs the wrong owner's verdict while every assertion still passes. */
		killGroup(owner);
		if (owner && !(await waitForPortFree("127.0.0.1", OWNER_PORT, 10_000)))
			throw new Error(`the previous arm's owner still holds ${OWNER_PORT}`);
		const logPath = join(wireDir, `${arm.name}.log`);
		owner = launch(process.execPath, [join(HARNESS, "stub-owner.mjs")], {
			env: {
				...process.env,
				OWNER_REFUSAL_ARM: arm.name,
				OWNER_REFUSAL_PORT: String(OWNER_PORT),
				OWNER_REFUSAL_LOG: logPath,
			},
		});
		if (
			!(await waitForHttp(
				`http://127.0.0.1:${OWNER_PORT}/v1/capabilities`,
				30_000,
			))
		)
			throw new Error(`the scripted owner did not start for arm ${arm.name}`);

		// A fresh page per arm: the composer is per-conversation state, and one
		// arm's refusal must not seed the next one's box.
		let target = null;
		for (let attempt = 0; attempt < 120 && !target; attempt++) {
			// The PORT is asked first, with a socket rather than a fetch: a fetch to a
			// closed port on this Node throws `setTypeOfService EINVAL` from inside
			// undici's own socket handler, where a try/catch around the await cannot
			// reach it - measured, twice, as a crashed capture whose frames were half
			// written.
			if (await portOpen("127.0.0.1", CDP_PORT)) {
				try {
					const list = await (
						await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)
					).json();
					target = list.find((t) => t.type === "page");
				} catch {
					/* chrome listening but not answering yet */
				}
			}
			if (!target) await sleep(250);
		}
		if (!target) throw new Error("no devtools page target");

		const ws = new WebSocket(target.webSocketDebuggerUrl);
		await new Promise((res, rej) => {
			ws.addEventListener("open", res, { once: true });
			ws.addEventListener("error", rej, { once: true });
		});
		const cdp = new Cdp(ws);
		await cdp.send("Page.enable");
		await cdp.send("Runtime.enable");
		await cdp.send("Emulation.setDeviceMetricsOverride", {
			width: 1440,
			height: 900,
			deviceScaleFactor: 2,
			mobile: false,
		});
		const evaluate = async (expression) => {
			const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", {
				expression,
				awaitPromise: true,
				returnByValue: true,
			});
			if (exceptionDetails)
				throw new Error(
					exceptionDetails.exception?.description ?? "eval failed",
				);
			return result.value;
		};
		const shoot = async (name) => {
			const { data } = await cdp.send("Page.captureScreenshot", {
				format: "webp",
				quality: 100,
			});
			writeFileSync(
				join(OUT, `${arm.name}-${name}.webp`),
				Buffer.from(data, "base64"),
			);
			process.stdout.write(`  captured ${arm.name}-${name}.webp\n`);
		};

		await cdp.send("Page.navigate", { url: `${ORIGIN}/` });
		// POLLED, not slept: the dev server transforms the app's modules on demand, so
		// a cold first load here is measured in tens of seconds (and once in ~2 min) -
		// a fixed settle is either a race or a wasted minute.
		//
		// AND THE COMPOSER IS BEHIND THE APP'S OWN DOOR. With no sessions on this
		// stub, the shell opens on its "Start a chat" empty state, where no textarea
		// exists at all: the composer belongs to a staged draft, so the New chat row
		// has to be pressed - the product's own control, not the store - before a box
		// exists to type into. Every pass through the loop tries it, so the click can
		// arrive before OR after the shell paints its sidebar.
		const composer = `document.querySelector('textarea[aria-label="Message"]')`;
		for (let attempt = 0; attempt < 240; attempt++) {
			if (await evaluate(`Boolean(${composer})`)) break;
			// If a first-run "New chat" control is what reveals the composer, that is
			// the product's own door and it is pressed through. Every loop pass, because
			// the shell paints its sidebar at its own pace and the row is not there yet
			// on the first pass - the earlier shape clicked once at a guessed attempt
			// and photographed the empty state when it guessed early.
			await evaluate(`(() => {
				const button = [...document.querySelectorAll("button, [role='button']")].find(
					(b) => (b.textContent || "").trim().replace(/[\\s\u00a0]+/g, " ") === "New chat");
				if (button) button.click();
				return Boolean(button);
			})()`);
			await sleep(1000);
		}
		if (!(await evaluate(`Boolean(${composer})`))) {
			// A frame of the state that failed, written out rather than discarded: the
			// first question about a rig that reports "nothing mounted" is what WAS on
			// the screen.
			const { data } = await cdp.send("Page.captureScreenshot", {
				format: "webp",
				quality: 100,
			});
			writeFileSync(
				join(OUT, `${arm.name}-no-composer.webp`),
				Buffer.from(data, "base64"),
			);
			throw new Error(
				`arm ${arm.name}: the composer never mounted, so this frame would photograph nothing (page: ${JSON.stringify(await evaluate(PROBE))})`,
			);
		}

		// React tracks the textarea's value on its own descriptor, so a plain
		// assignment is not seen: setting through the prototype setter and firing
		// a bubbling input event is how a real keystroke reaches the component.
		await evaluate(`(() => {
			const area = document.querySelector('textarea[aria-label="Message"]');
			const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
			setter.call(area, ${JSON.stringify(MESSAGE)});
			area.dispatchEvent(new Event("input", { bubbles: true }));
			return area.value.length;
		})()`);
		await sleep(1200);
		await shoot("composed");

		// The product's own send control, not its store.
		await evaluate(`(() => {
			const send = document.querySelector('button[aria-label="Send message"]');
			if (!send) throw new Error("no send control");
			send.click();
			return true;
		})()`);
		/*
		 * THE PRESS INSIDE THE FLIGHT (UX round 3, U6), and it has to happen HERE rather
		 * than in `runCustom`: the app's own 20 s control budget ends the flight for the
		 * app whether or not the owner has answered, so a press taken after the settle
		 * wait is a press against a failure notice rather than against a send that is
		 * still out. The user types their next line - which is what makes the control
		 * live at all, the flight having emptied the box at the echo - and presses Send
		 * while the request is pending. What must happen is a sentence on screen and
		 * NOTHING on the wire; before the fix it was nothing on screen and, on a live
		 * control, no way for the user to tell the press from a broken key.
		 */
		if (
			arm.custom === "press-during-flight" ||
			arm.custom === "press-during-flight-settles" ||
			arm.custom === "press-twice-no-stall"
		) {
			/*
			 * WAIT FOR THE FLIGHT'S OWN CLEAR FIRST. The echo empties the box when the
			 * admission is issued and that lands asynchronously against this phase, so
			 * typing too early is typing into a box the echo is about to clear - which
			 * leaves the control disabled and measures nothing (measured: a run where the
			 * clear arrived after this rig's own keystroke reported `disabled: true` on an
			 * empty box). The press below is the round's press only once the box holds the
			 * user's line and the control is live.
			 */
			for (let attempt = 0; attempt < 40; attempt++) {
				const boxed = await evaluate(
					`(() => { const a = document.querySelector('textarea[aria-label="Message"]'); return a ? a.value : null; })()`,
				);
				if (boxed === "") break;
				await sleep(250);
			}
			await evaluate(`(() => {
				const area = document.querySelector('textarea[aria-label="Message"]');
				const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
				setter.call(area, ${JSON.stringify(FOLLOW_UP)});
				area.dispatchEvent(new Event("input", { bubbles: true }));
				return area.value;
			})()`);
			await sleep(700);
			const control = await evaluate(`(() => {
				const send = document.querySelector('button[aria-label="Send message"]');
				return send ? { disabled: send.disabled } : null;
			})()`);
			const attemptsBefore = (
				readFileSync(logPath, "utf8").match(/request_id=/g) ?? []
			).length;
			await evaluate(`(() => {
				const send = document.querySelector('button[aria-label="Send message"]');
				if (!send) throw new Error("no send control");
				send.click();
				return true;
			})()`);
			await sleep(1500);
			const pressed = await evaluate(PROBE);
			await shoot("after-press-in-flight");
			process.stdout.write(
				`  ${arm.name}: control=${JSON.stringify(control)} box=${JSON.stringify((pressed.boxValue ?? "").slice(0, 60))} alert=${JSON.stringify((pressed.alertProse ?? "").slice(0, 200))}\n`,
			);
			if (control?.disabled)
				throw new Error(
					`${arm.name}: the control is disabled during the flight, so this arm is not measuring the press the round measured`,
				);
			/*
			 * THE ASSERTION IS THE DOM THE USER IS LOOKING AT, not a predicate in the
			 * source: the composer's own sentence, in the region the notice renders in.
			 */
			if (
				!(pressed.alertProse ?? "").includes(
					"Your last message is still sending",
				)
			)
				throw new Error(
					`${arm.name}: the press was answered by NOTHING on screen - no notice line anywhere (alert prose: ${JSON.stringify((pressed.alertProse ?? "").slice(0, 240))}; body: ${JSON.stringify((pressed.bodyText ?? "").slice(0, 240))})`,
				);
			if ((pressed.boxValue ?? "") !== FOLLOW_UP)
				throw new Error(
					`${arm.name}: the press changed the box - a refused press must leave the user's line alone (box: ${JSON.stringify(pressed.boxValue)})`,
				);
			const attemptsDuring = (
				readFileSync(logPath, "utf8").match(/request_id=/g) ?? []
			).length;
			if (attemptsDuring !== attemptsBefore)
				throw new Error(
					`${arm.name}: the press reached the owner as a second attempt (${attemptsBefore} -> ${attemptsDuring}), so the sentence on screen describes something that was sent`,
				);
			if (
				!(await evaluate(
					`Boolean(document.querySelector('textarea[aria-label="Message"]'))`,
				))
			)
				throw new Error(
					`${arm.name}: the composer went away during the flight`,
				);
		}

		/*
		 * THE FLIGHT'S OWN ENDING, WHICH IS WHAT THESE TWO ARMS ARE FOR (review round
		 * 4's M2 = QA's Q4-1 = the designer's D11 = UX's U16). The committed 21 s arm
		 * always ends in the app's own deadline, so it can only ever see the FAILURE
		 * settle, where the store's sentence replaces the line. These two hold INSIDE
		 * the budget, so the message is delivered - and the line must go with it,
		 * because it is a claim about a send that is no longer out.
		 */
		if (
			arm.custom === "press-during-flight-settles" ||
			arm.custom === "press-twice-no-stall"
		) {
			for (let attempt = 0; attempt < 40; attempt++) {
				if (/-> 200 admitted/.test(readFileSync(logPath, "utf8"))) break;
				await sleep(1000);
			}
			await sleep(6000);
			const settled = await evaluate(PROBE);
			await shoot("after-flight-settled");
			process.stdout.write(
				`  ${arm.name} settled: ${JSON.stringify({ userRows: settled.transcriptUserRows, box: (settled.boxValue ?? "").slice(0, 60), alert: (settled.alertProse ?? "").slice(0, 160) })}\n`,
			);
			if ((settled.alertProse ?? "").includes("still sending"))
				throw new Error(
					`${arm.name}: "Your last message is still sending." is still on screen after the message was delivered (${JSON.stringify(settled.alertProse)}) - the screen claims a send that has already landed`,
				);
			if (settled.transcriptUserRows !== 1)
				throw new Error(
					`${arm.name}: the transcript holds ${settled.transcriptUserRows} user rows for one delivered message`,
				);
			/*
			 * AND THE FOLLOW-UP IS ITS OWN ROW (UX's U16: `g03a quick follow-upg03b
			 * first` was ONE glued row). The box was cleared only so the rig's own settle
			 * detector could see the flight land, so the line goes back in and pressing
			 * Send must land a second row carrying it alone.
			 */
			if (arm.custom === "press-twice-no-stall") {
				await evaluate(`(() => {
						const area = document.querySelector('textarea[aria-label="Message"]');
						const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
						setter.call(area, ${JSON.stringify(FOLLOW_UP)});
						area.dispatchEvent(new Event("input", { bubbles: true }));
						return area.value;
					})()`);
				await sleep(600);
				await evaluate(`(() => {
					const send = document.querySelector('button[aria-label="Send message"]');
					if (!send) throw new Error("no send control");
					send.click();
					return true;
				})()`);
				await sleep(3000);
				const after = await evaluate(PROBE);
				await shoot("after-next-send");
				process.stdout.write(
					`  ${arm.name} after next send: ${JSON.stringify({ rows: after.transcriptRowTexts, userRows: after.transcriptUserRows, box: after.boxValue })}\n`,
				);
				if (after.transcriptUserRows !== 2)
					throw new Error(
						`${arm.name}: the follow-up did not become its own row (${after.transcriptUserRows} user rows: ${JSON.stringify(after.transcriptRowTexts)})`,
					);
				for (const row of after.transcriptRowTexts ?? [])
					if (
						row.includes(FOLLOW_UP.slice(0, 24)) &&
						/Please re-run the failing case/.test(row)
					)
						throw new Error(
							`${arm.name}: one row carries BOTH messages - the glued row UX measured (${JSON.stringify(row)})`,
						);
			}
		}
		/*
		 * AND THE BOX GOES BACK EMPTY, because the rig's own settle detector reads the
		 * composer: a flight that succeeds empties it under the echo and this phase has
		 * just put the user's next line in it. Nothing is lost - the line is typed where
		 * it is the arm's subject - and without this the detector waits for a state this
		 * arm has already changed.
		 */
		/*
		 * FOR THE TWO ARMS THAT NEED IT AND NO OTHERS (design round 5, D13). Their
		 * flights SUCCEED, so the rig's own settle detector - which reads the composer -
		 * waits for an empty box that this phase has just filled. A clear on EVERY arm
		 * rewrites the arms whose subject IS the box: re-capturing the committed deadline
		 * arm at head produced a frame where the user's typed follow-up had disappeared,
		 * which is the data loss this change exists to remove - evidence lying about the
		 * product it measures.
		 */
		/*
		 * AND IT SKIPS THE CLEAR, NOT THE ARM (design round 6, D14/D15). As written this
		 * guard `return`ed from the whole run: the two arms it did not match produced one
		 * frame each and then exit 0 with no readings, no wire log and no summary - silent
		 * evidence loss for every arm but one, including the arm the manifest names as the
		 * source of both composer frame sets. Keyed on `arm.name` too, because no arm
		 * carries these strings as `custom` (the settling arms are `custom:
		 * "press-during-flight"`); matching a field nothing sets meant matching nothing.
		 * Every arm therefore still reaches the settle detector below - only the box clear
		 * is conditional.
		 */
		if (
			arm.name === "press-during-flight-settles" ||
			arm.name === "press-twice-no-stall"
		)
			await evaluate(`(() => {
				const area = document.querySelector('textarea[aria-label="Message"]');
				const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
				setter.call(area, "");
				area.dispatchEvent(new Event("input", { bubbles: true }));
				return area.value;
			})()`);
		// POLLED as well, on the two shapes a send can settle into: a refusal's alert,
		// or the composer emptying under a painted echo. A fixed wait photographs
		// whichever of them the host happened to reach first.
		await waitForSendSettled(
			evaluate,
			logPath,
			arm,
			"first",
			arm.expectRefusal ? "refusal" : "sent",
		);
		const first = await evaluate(PROBE);
		/*
		 * WHAT THE NOTICE OFFERS, read while it is still on screen. It is read here
		 * rather than after the remedy because the remedy removes it - measured: a
		 * read taken afterwards found an empty control list and reported the notice as
		 * offering nothing.
		 */
		const firstControls = await evaluate(
			`[...document.querySelectorAll('[role="alert"] button')].map((b) => b.textContent.trim())`,
		);
		await shoot("after-first-send");

		if (arm.custom) {
			const custom = await runCustom(arm, {
				evaluate,
				shoot,
				logPath,
				first,
				waitForSendSettled,
			});
			readings.arms.push({ ...arm, first, ...custom });
			wireLog.push(`${arm.name}:\n${readFileSync(logPath, "utf8").trim()}`);
			killGroup(owner);
			owner = null;
			process.stdout.write(`arm ${arm.name}: ${arm.why}\n`);
			continue;
		}

		if (arm.expectRefusal) {
			if (!first.regionPresent || !(first.alertProse ?? "").trim())
				throw new Error(
					`arm ${arm.name}: the arm refuses the first send, but no alert region rendered its sentence (probe: ${JSON.stringify(first)})`,
				);
			// The second send, once the owner admits, is the operator's own remedy.
			await evaluate(`(() => {
				const send = document.querySelector('button[aria-label="Send message"]');
				if (send) send.click();
				return true;
			})()`);
			await waitForSendSettled(evaluate, logPath, arm, "second", "sent");
			await shoot("after-second-send");
		}

		const second = await evaluate(PROBE);
		/*
		 * THE WIRE CLAIM, for the arm whose whole point is one message: the attempts
		 * this arm made carry the SAME request id, so the owner's receipt answers the
		 * second with the first's admission. A fresh id here is a second message the
		 * user never asked for, and it is counted rather than argued.
		 */
		if (arm.name === "timeout-admitted") {
			const ids = [
				...readFileSync(logPath, "utf8").matchAll(/request_id=([0-9a-f-]+)/g),
			].map((m) => m[1]);
			if (ids.length < 2)
				throw new Error(
					`arm ${arm.name}: expected two attempts at the owner, saw ${ids.length} (${JSON.stringify(ids)})`,
				);
			if (new Set(ids).size !== 1)
				throw new Error(
					`arm ${arm.name}: the retry went out under a DIFFERENT request id, so one message became two: ${JSON.stringify(ids)}`,
				);
			if (!first.boxValue?.includes(MESSAGE.slice(0, 20)))
				throw new Error(
					`arm ${arm.name}: the failed send did not keep the message in the box (box: ${JSON.stringify(first.boxValue)})`,
				);
			const controls = firstControls;
			if (!controls.includes("Retry") || !controls.includes("Clear"))
				throw new Error(
					`arm ${arm.name}: the notice does not offer both controls (${JSON.stringify(controls)})`,
				);
			readings.arms.push({
				...arm,
				first,
				second,
				requestIds: ids,
				controls,
			});
			wireLog.push(`${arm.name}:\n${readFileSync(logPath, "utf8").trim()}`);
			killGroup(owner);
			owner = null;
			process.stdout.write(`arm ${arm.name}: ${arm.why}\n`);
			continue;
		}
		readings.arms.push({ ...arm, first, second });
		wireLog.push(`${arm.name}:\n${readFileSync(logPath, "utf8").trim()}`);
		// The owner that answered these frames is done with before the next one
		// starts, so no arm can be served by another arm's script.
		killGroup(owner);
		owner = null;
		process.stdout.write(`arm ${arm.name}: ${arm.why}\n`);
	}

	writeFileSync(
		join(OUT, "readings.json"),
		`${JSON.stringify(readings, null, 1)}\n`,
	);
	writeFileSync(join(OUT, "wire.log"), `${wireLog.join("\n")}\n`);
	process.stdout.write(
		`${JSON.stringify(
			readings.arms.map((a) => ({
				arm: a.name,
				firstAlert: (a.first?.alertProse ?? "").slice(0, 130),
				firstBox: a.first?.boxValue,
				/*
				 * Optional, because a CUSTOM arm continues before the remedy press: it has
				 * no `second` reading, and a summary that threw on one would report a rig
				 * defect as a failed arm (measured: this line masked the exit code of an
				 * arm whose own assertions had passed).
				 */
				secondBox: a.second?.boxValue ?? null,
				secondAlert: a.second?.regionPresent ?? null,
			})),
			null,
			1,
		)}\n`,
	);
};

/** `--only` narrows the run for the inner loop while a rig is being built. */
process.on("exit", reap);
process.on("SIGINT", () => process.exit(130));
process.on("SIGTERM", () => process.exit(143));
main().then(
	() => {
		reap();
		rmSync(join(tmpdir(), `lo-owner-refusal-${process.pid}`), {
			recursive: true,
			force: true,
		});
		rmSync(join(tmpdir(), `lo-owner-refusal-wire-${process.pid}`), {
			recursive: true,
			force: true,
		});
	},
	(error) => {
		reap();
		process.stderr.write(`${error.stack ?? error}\n`);
		process.exit(1);
	},
);
