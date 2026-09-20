#!/usr/bin/env node
/**
 * Prove, by clicking, that a pending `ask` gate's option is a real control.
 *
 *     node scripts/click-proof.mjs <origin> <out-dir> [session-id]
 *
 * Drives the app the way `scripts/capture-evidence.mjs` drives it: a PRIVATE
 * `--headless=new` Chromium with a fresh profile under the system temp dir,
 * spoken to over raw CDP with Node's built-in WebSocket. No browser-automation
 * dependency is installed for this, and no window is opened or focused.
 *
 * ## Why this is a committed script and not a throwaway rig
 *
 * It was a throwaway rig, and the QA round said so: the frames in
 * `docs/evidence/ask-options-live/` named `/tmp/ask-gate-rig/proof.mjs`, which
 * exists on one machine and nowhere else, so nobody else could re-derive the
 * evidence they were asked to trust. The repository keeps its reusable drivers
 * (`scripts/diff-body-evidence.mjs`, `scripts/usage-real-evidence.mjs`); this
 * is that same piece for the click, and the README beside the frames gives the
 * two commands that stand the other two thirds of the rig up.
 *
 * ## What it asserts, and what it deliberately does not
 *
 * The click is dispatched at the option's PAINTED pixels after asking the page
 * which element owns them (`elementFromPoint`), never as a synthetic
 * `element.click()`, so a control that is painted but not hit-testable fails
 * here. What it cannot see is Electron's IPC/preload channel: the app in a
 * plain browser takes its shipped `/__desktop` branch, and the README states
 * that limit rather than implying otherwise.
 *
 * `click-result.json` records the pre-click DOM state, the aim point, the
 * post-click state and any surface the after-frame still carries. The
 * accessible name is computed here the way a screen reader computes it — the
 * `aria-hidden` ordinals removed — because the raw `textContent` includes them
 * and reading that as "the name" is the specific confusion the round-1 review
 * found in this file (its `names` array carried "2.Popup is not open…").
 */

import { execFileSync, spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withMockKeychain } from "./chrome-keychain.mjs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = process.argv[2] ?? "http://localhost:5199";
const OUT = process.argv[3] ?? "docs/evidence/ask-options-live";
const SESSION = process.argv[4] ?? "a1a1a1a1a1a1";
/* The app's own default window (src/main/index.ts). A live frame is only worth
 * anything if it is the window the operator runs. */
const WIDTH = Number(process.env.CLICK_PROOF_WIDTH ?? 1380);
const HEIGHT = Number(process.env.CLICK_PROOF_HEIGHT ?? 900);
/*
 * The option to press. Named rather than indexed, and named as the SECOND row
 * of the armed gate after the harness rotates `recommended` to the front — so
 * a pass cannot be an index-0 accident and cannot be the recommended option
 * either.
 */
const TARGET =
	process.env.CLICK_PROOF_TARGET ?? "Popup is open - generate the pairing code";
/*
 * The sentences the composer can show under a press, and which run shows which.
 *
 * They are duplicated from `ask-answer.ts` here deliberately: this driver is how
 * a reviewer checks that the SHIPPED copy is the one the module holds, and a
 * driver that imported the module would agree with it by construction.
 *
 * `SETTLED_SENTENCE` is the wording the pre-fix build rendered for EVERY failed
 * press, and the one this branch renders only where the live facts establish it
 * (no gate pending — see `answerReport`). So the BEFORE run of the forced pair
 * asserts it and the AFTER run asserts silence, and the two runs differ by the
 * tree alone.
 */
const SETTLED_SENTENCE =
	"That question was already answered somewhere else, so your answer was not sent.";
const MOVED_ON_SENTENCE =
	"That question had already been settled or moved on, so your answer was not sent.";
/*
 * The unknown-outcome sentence, for a failure that carried no HTTP response at
 * all. Asserted from the page's own text like the others, and for the same
 * reason: a run that never rendered it must not be able to pass as one that did.
 */
const UNCONFIRMED_LEAD = "Whether your answer landed is not knowable.";

/**
 * The sentence a run expects to find ON THE CARD when it declared one.
 *
 * The register belongs to the outcome and not to the surface (UX round 2, U7),
 * so a card that survives a press can carry either the not-sent sentence or the
 * unknown one — and `CLICK_PROOF_EXPECT=card-unknown` is how a run says which.
 * Read from the expectation rather than from a new knob so the declaration is
 * still made in one place.
 */
const cardSentence = () =>
	EXPECT === "card-unknown" ? UNCONFIRMED_LEAD : "Your answer was not sent.";
/*
 * What this run must find on the page after the press, when the caller says.
 *
 * `silent` is the shipping contract for a press the owner TOOK — the user's bug
 * — so a run that finds a sentence there must not overwrite the committed
 * record with it. `moved-on` is the contract for a press the answer route
 * refused without a code, `unknown` for a failure that carried no response, and
 * `not-sent` for any other failure. The BEFORE run of the forced pair asserts
 * `settled`, because the pre-fix build rendered that sentence for every failed
 * press rather than only where it is true. Unset records without asserting, which
 * is how the set was first taken.
 *
 * `CLICK_PROOF_EXPECT_ORDER` is the same idea for the ordering the run exists
 * to force: `cleared-first` (the card left the screen before the response was
 * delivered — the order that inverted the old verdict) or `delivered-first`.
 * The record already carried the verdict; until this knob existed nothing
 * asserted it, so a run whose `--answer-delay-ms` did not take could be
 * committed as proof of the losing order while showing the winning one (code
 * review round 1, m3).
 */
const EXPECT = process.env.CLICK_PROOF_EXPECT ?? "";
const EXPECT_ORDER = process.env.CLICK_PROOF_EXPECT_ORDER ?? "";
const ORDER_VERDICTS = {
	"cleared-first": "the card cleared before the response was delivered",
	"delivered-first": "the response was delivered before the card cleared",
};
/*
 * HOW THIS RUN ENDS, because the two kinds of press end differently.
 *
 * `cleared` is the ordinary contract and the one both halves of the original
 * pair use: the owner TAKES the press, the future returns, and the backend stops
 * projecting a pending gate. `refused` is the other end state, and it is the one
 * `--reject-answers` produces: the route refuses, nothing is settled, and the
 * card is STILL UP carrying the refusal — the arm whose refusal used to be
 * written where nothing renders (design round 1, D1). A run in that mode that
 * waited for the card to clear would wait out its whole deadline and report
 * itself unresolved while the page showed exactly the behaviour under test.
 */
const RESOLUTION = process.env.CLICK_PROOF_RESOLUTION ?? "cleared";

/*
 * What the composer says about the press, read as the user reads it.
 *
 * Both sentences are matched against the page's own TEXT rather than against an
 * alert node this driver hoped to find, so a run that rendered nothing cannot be
 * mistaken for one that rendered the right thing. `notSentCopy` is scoped to the
 * alerts so the general sentence can never satisfy the arm that is about a
 * failure the card could not explain.
 */
const READ_REPORT = `(() => {
	const alerts = [...document.querySelectorAll('[role="alert"]')]
		.map((n) => n.textContent.replace(/\\s+/g, " ").trim())
		.filter(Boolean);
	const field = document.querySelector('fieldset[aria-label="Answer options"]');
	const notSent = "Your answer was not sent.";
	const inAlerts = alerts.some((a) => a.includes(notSent));
	return {
		movedOnSentence: document.body.innerText.includes(${JSON.stringify(MOVED_ON_SENTENCE)}),
		settledSentence: document.body.innerText.includes(${JSON.stringify(SETTLED_SENTENCE)}),
		unconfirmedSentence: document.body.innerText.includes(${JSON.stringify(UNCONFIRMED_LEAD)}),
		notSentCopy: alerts.filter((a) => a.includes(notSent)),
		cardUp: Boolean(field),
		/*
		 * The card's OWN refusal: the sentence is on the page, the card is still up,
		 * and the sentence is NOT inside the composer's alert band. That last clause
		 * is what makes this a reading of the card rather than of the page — the two
		 * surfaces carry the same sentence on purpose (unsentAnswerMessage builds
		 * both), so which one painted it is the whole question a refused-press frame
		 * is asked.
		 */
		cardRefusal:
			Boolean(field) && document.body.innerText.includes(notSent) && !inAlerts,
		/*
		 * The card's UNKNOWN register, read the same way and for the same reason:
		 * the register is the outcome's, so the card carries the same sentence the
		 * composer would (UX round 2, U7). Without this reading a run of that arm
		 * could only be described as "cardRefusal: false", i.e. as a run whose card
		 * said nothing — which is the shape round 2's finding was about.
		 */
		cardUnknown:
			Boolean(field) &&
			document.body.innerText.includes(${JSON.stringify(UNCONFIRMED_LEAD)}) &&
			!inAlerts,
		alerts,
	};
})()`;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const dataDir = mkdtempSync(join(tmpdir(), "ask-click-proof-"));
const chrome = spawn(
	CHROME,
	withMockKeychain([
		"--headless=new",
		"--no-sandbox",
		"--disable-gpu",
		"--hide-scrollbars",
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
});

const browser = new WebSocket(wsUrl);
await new Promise((resolve) => {
	browser.onopen = resolve;
});
let nextId = 1;
const pending = new Map();
browser.onmessage = (event) => {
	const msg = JSON.parse(event.data);
	if (msg.id && pending.has(msg.id)) {
		const { resolve, reject } = pending.get(msg.id);
		pending.delete(msg.id);
		msg.error
			? reject(new Error(JSON.stringify(msg.error)))
			: resolve(msg.result);
	}
};
/* `?? {}` at the use site rather than a defaulted parameter: `useDefaultParameterLast`
 * refuses a default before a required one, and `sessionId` is the optional one
 * here, so the default moves to where the value is read. */
const raw = (method, params, sessionId) =>
	new Promise((resolve, reject) => {
		const id = nextId++;
		pending.set(id, { resolve, reject });
		browser.send(
			JSON.stringify({
				id,
				method,
				params: params ?? {},
				...(sessionId ? { sessionId } : {}),
			}),
		);
	});

const target = await raw("Target.createTarget", { url: "about:blank" });
const attached = await raw("Target.attachToTarget", {
	targetId: target.targetId,
	flatten: true,
});
const sessionId = attached.sessionId;
const send = (method, params = {}) => raw(method, params, sessionId);

async function evaluate(expression) {
	const res = await send("Runtime.evaluate", {
		expression,
		awaitPromise: true,
		returnByValue: true,
	});
	if (res.exceptionDetails) {
		throw new Error(
			res.exceptionDetails.exception?.description ?? "page error",
		);
	}
	return res.result.value;
}

/**
 * The state of the gate, read from the DOM exactly as a user would find it.
 *
 * `accessibleName` strips `aria-hidden` subtrees rather than reading
 * `innerText`, because the ordinal IS `aria-hidden` and reading the raw text
 * is what made the previous record look like it contradicted the claim it
 * supported.
 */
const READ_STATE = `(() => {
	const field = document.querySelector('fieldset[aria-label="Answer options"]');
	const buttons = field ? [...field.querySelectorAll("button")] : [];
	const name = (b) => {
		const copy = b.cloneNode(true);
		copy.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
		return copy.textContent.replace(/\\s+/g, " ").trim();
	};
	return {
		found: Boolean(field),
		count: buttons.length,
		tags: buttons.map((b) => b.tagName),
		textContent: buttons.map((b) => b.textContent.replace(/\\s+/g, " ").trim()),
		accessibleName: buttons.map(name),
		ordinalHidden: buttons.length > 0 && buttons.every((b) => b.querySelector('span[aria-hidden="true"]')),
		disabled: buttons.map((b) => b.disabled),
		pointerEvents: buttons[0] ? getComputedStyle(buttons[0]).pointerEvents : null,
		eyebrow: document.querySelector('section[aria-label="Question from the agent"] p')?.textContent ?? null,
		alerts: [...document.querySelectorAll('[role="alert"]')].map((n) => n.textContent.replace(/\\s+/g, " ").trim()).filter(Boolean),
		incidentRow: document.body.innerText.includes("session incident"),
	};
})()`;

async function shoot(name) {
	mkdirSync(join(OUT, name), { recursive: true });
	const theme =
		(await evaluate(
			`document.documentElement.dataset.theme || (document.documentElement.classList.contains("dark") ? "localOperatorDark" : "localOperatorLight")`,
		)) ?? "localOperatorDark";
	const { data } = await send("Page.captureScreenshot", {
		format: "webp",
		quality: 88,
	});
	const path = join(OUT, name, `${theme}.webp`);
	writeFileSync(path, Buffer.from(data, "base64"));
	return { path, theme };
}

const record = {
	origin: ORIGIN,
	session: SESSION,
	viewport: { width: WIDTH, height: HEIGHT },
	driver: "scripts/click-proof.mjs",
	at: new Date().toISOString(),
};

/**
 * The rig's own record of the answer request, once its response has been
 * DELIVERED — not merely produced.
 *
 * `deliveredAt` is the moment the hold `harness/serve-gate.py`'s
 * `--answer-delay-ms` imposes ends, which is the moment the app's
 * `sessions.answer` promise settles and the moment its verdict is decided.
 * Waiting for it is what makes the record's ordering claim a measurement: the
 * alternative is a fixed sleep, which would be a guess about the very latency
 * the run exists to place.
 */
/*
 * The rig's answer log, from whichever source still has it.
 *
 * `/rig-state` is the rig's own route and the usual source, but a run that KILLS
 * the backend (the U1 arm — see the harness's `--die-after-answer-ms`) takes that
 * route down with it, and the log is the whole record of what the owner did. The
 * harness flushes it to a file before it can die; this reads it from there, and
 * the record says which source it came from so a reader knows whether the live
 * route or the file was read.
 */
const RIG_DIR = process.env.CLICK_PROOF_RIG_DIR ?? "";
async function readRigState() {
	try {
		return {
			...(await evaluate(`fetch("${ORIGIN}/rig-state").then((r) => r.json())`)),
			from: "route",
		};
	} catch (error) {
		if (!RIG_DIR) throw error;
		const file = join(RIG_DIR, "answer-log.json");
		if (!existsSync(file)) throw error;
		return { ...JSON.parse(readFileSync(file, "utf8")), from: "file" };
	}
}

async function waitForAnswer() {
	const deadline = Date.now() + 60_000;
	for (;;) {
		const state = await readRigState();
		const answers = state.answers ?? [];
		/*
		 * Every request has reached its end: delivered, or dropped on purpose.
		 *
		 * A `--drop-answers` run has an entry with `dropped: true` and no
		 * `deliveredAt`, and it is FINISHED — waiting for a delivery that the run
		 * deliberately prevented would time out and report the run as broken while
		 * the page showed exactly the failure under test. The two are separate
		 * flags rather than one, so the record still says which happened.
		 */
		if (
			answers.length > 0 &&
			answers.every(
				(entry) =>
					entry.deliveredAt != null ||
					entry.dropped === true ||
					entry.held === true,
			)
		)
			return state;
		if (Date.now() > deadline)
			throw new Error(
				`the rig never recorded a finished answer: ${JSON.stringify(state)}`,
			);
		await wait(250);
	}
}

/* Page-side errors and console output, collected so a failed run explains
 * itself: the round-1 rig died between its two frames with nothing recorded,
 * and the frames it left behind were read as evidence. */
const pageProblems = [];
browser.addEventListener("message", (event) => {
	const msg = JSON.parse(event.data);
	if (msg.method === "Runtime.exceptionThrown") {
		pageProblems.push(
			`exception: ${msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text}`,
		);
	}
	if (
		msg.method === "Runtime.consoleAPICalled" &&
		msg.params.type === "error"
	) {
		pageProblems.push(
			`console.error: ${msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(" ")}`,
		);
	}
});

/*
 * The output directory exists BEFORE anything can fail.
 *
 * The failure path below writes `click-result.diagnostic.json` into it, and with
 * `mkdirSync` only inside `shoot()` a run that failed before its first frame —
 * including the driver's own "the option never became hit-testable" path, which
 * round 2 hit — could not write the diagnostic at all: the write threw ENOENT
 * and REPLACED the real error with a filesystem one, so the report this file
 * exists to produce was lost in exactly the failure it was written for (code
 * review round 2, F5, reproduced).
 */
mkdirSync(OUT, { recursive: true });

try {
	await send("Page.enable");
	await send("Runtime.enable");
	await send("Emulation.setDeviceMetricsOverride", {
		width: WIDTH,
		height: HEIGHT,
		deviceScaleFactor: 1,
		mobile: false,
	});
	/*
	 * The provider-onboarding modal opens on any install with no credential and
	 * would cover the transcript, so it is settled the way a returning user has
	 * it: the store's own persisted completion flags (`onboarding-storage`),
	 * seeded before the app's modules run. `CLICK_PROOF_NO_SEED=1` skips it,
	 * which is how the effect of the seed itself was isolated.
	 */
	if (process.env.CLICK_PROOF_NO_SEED !== "1") {
		await send("Page.addScriptToEvaluateOnNewDocument", {
			source: `try {
			window.localStorage.setItem("onboarding-storage", JSON.stringify({
				state: { isModalComplete: true, isTourComplete: true },
				version: 0,
			}));
		} catch {}`,
		});
	}
	await send("Page.navigate", { url: `${ORIGIN}/#/chat/${SESSION}` });

	// Wait for the app SHELL, then arm the card.
	//
	// Order matters and cost a debugging round: the rig's host denies an
	// unanswered gate after 30 seconds when nothing can present it, and this
	// app takes 15-25 seconds to paint in a plain browser. A card armed at rig
	// startup therefore expires into the harness's "user escaped" answer before
	// the page that would click it exists, and the result reads like a failed
	// click. Arming when the composer is on screen is the ordering a user
	// produces: the surface is ready, then the question arrives.
	const shellDeadline = Date.now() + 90_000;
	for (;;) {
		if (
			await evaluate(
				`Boolean(document.querySelector('textarea[aria-label="Message"]'))`,
			)
		)
			break;
		if (Date.now() > shellDeadline)
			throw new Error("the app shell never painted");
		await wait(1000);
	}
	const armed = await evaluate(
		`fetch("${ORIGIN}/rig-arm").then((r) => r.json())`,
	);
	record.arm = armed;

	const deadline = Date.now() + 60_000;
	for (;;) {
		if (
			await evaluate(
				`Boolean(document.querySelector('fieldset[aria-label="Answer options"]'))`,
			)
		)
			break;
		if (Date.now() > deadline) {
			throw new Error("the gate never rendered");
		}
		await wait(1000);
	}
	// Wait until the option is actually hit-testable, not merely present.
	//
	// The card arrives with the frontend state while the session's history rows
	// arrive on their own request: between the two, `CanonicalTranscript` is
	// collapsed, so the option exists in the DOM with a rect above the top of
	// the viewport. Measured on the running app at that moment: `top: -30`
	// inside a zero-height scroller, `elementFromPoint` returning a container.
	// Aiming then would either fail or, worse, land somewhere else.
	const hittableDeadline = Date.now() + 45_000;
	for (;;) {
		const probe = await evaluate(`(() => {
			const field = document.querySelector('fieldset[aria-label="Answer options"]');
			if (!field) return { ok: false, why: "no fieldset" };
			const buttons = [...field.querySelectorAll("button")];
			const strip = (b) => { const c = b.cloneNode(true);
				c.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
				return c.textContent.replace(/\\s+/g, " ").trim(); };
			const b = buttons.find((node) => strip(node).startsWith(${JSON.stringify(TARGET)}));
			if (!b) return { ok: false, why: "no option with that label" };
			const r = b.getBoundingClientRect();
			const x = Math.round(r.left + r.width / 2);
			const y = Math.round(r.top + r.height / 2);
			const hit = document.elementFromPoint(x, y);
			return { ok: Boolean(hit) && hit.closest("button") === b, x, y, top: Math.round(r.top), iw: innerWidth, ih: innerHeight };
		})()`);
		if (probe.ok) break;
		if (Date.now() > hittableDeadline)
			throw new Error(
				`the option never became hit-testable: ${JSON.stringify(probe)}`,
			);
		await wait(500);
	}

	record.before = await evaluate(READ_STATE);
	const before = await shoot("before-click");
	record.frames = { before: `${before.theme}.webp` };

	const aim = await evaluate(`(() => {
		const field = document.querySelector('fieldset[aria-label="Answer options"]');
		const buttons = [...field.querySelectorAll("button")];
		const strip = (b) => { const c = b.cloneNode(true);
			c.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
			return c.textContent.replace(/\\s+/g, " ").trim(); };
		const index = buttons.findIndex((b) => strip(b).startsWith(${JSON.stringify(TARGET)}));
		if (index < 0) return { ok: false, reason: "no option with that label" };
		const r = buttons[index].getBoundingClientRect();
		const x = Math.round(r.left + r.width / 2);
		const y = Math.round(r.top + r.height / 2);
		const hit = document.elementFromPoint(x, y);
		return {
			ok: Boolean(hit) && hit.closest("button") === buttons[index],
			x, y, index,
			label: strip(buttons[index]),
			hitTested: hit ? hit.tagName + (hit.closest("button") === buttons[index] ? " (the option itself)" : " (NOT the option)") : null,
			rect: { top: Math.round(r.top), height: Math.round(r.height) },
		};
	})()`);
	record.aim = aim;
	if (!aim.ok)
		throw new Error(`cannot aim at the option: ${JSON.stringify(aim)}`);

	// A real press and release at those pixels.
	const pressedAt = Date.now();
	for (const type of ["mousePressed", "mouseReleased"]) {
		await send("Input.dispatchMouseEvent", {
			type,
			x: aim.x,
			y: aim.y,
			button: "left",
			clickCount: 1,
		});
	}

	// The gate clearing IS the resolution in `cleared` mode: the owner's future
	// returns and the backend stops projecting a pending gate. In `refused` mode
	// the gate is NOT cleared — that is what a refusal means — so the end state is
	// the refusal itself, rendered where the press was made: the card still up
	// with the not-sent sentence inside it. See `RESOLUTION`.
	const settleDeadline = Date.now() + 30_000;
	let resolved = false;
	let gateCleared = false;
	for (;;) {
		const state = await evaluate(`(() => {
			const field = document.querySelector('fieldset[aria-label="Answer options"]');
			const alerts = [...document.querySelectorAll('[role="alert"]')];
			return {
				up: Boolean(field),
				refusal: document.body.innerText.includes("Your answer was not sent.") &&
					!alerts.some((a) => a.textContent.includes("Your answer was not sent.")),
			};
		})()`);
		/*
		 * A CARD THAT STAYS UP IS AN EVENT, and which sentence it is carrying is
		 * part of it: the register is the outcome's, so the arm where the card
		 * survives can carry the not-sent sentence or the unknown one (UX round 2,
		 * U7). Waiting for the literal not-sent string would time this arm out on a
		 * card that had already said everything it was going to say.
		 */
		const cardSentencePresent = await evaluate(
			`document.body.innerText.includes(${JSON.stringify(cardSentence())})`,
		);
		if (
			RESOLUTION === "refused" ? state.up && cardSentencePresent : !state.up
		) {
			resolved = true;
			gateCleared = RESOLUTION !== "refused";
			break;
		}
		if (Date.now() > settleDeadline) break;
		await wait(250);
	}
	record.resolved = resolved;
	record.resolution = RESOLUTION;
	record.gateCleared = gateCleared;
	const clearedAt = gateCleared ? Date.now() : null;
	/*
	 * The answer's OWN record, read from the rig instead of guessed at with a
	 * sleep.
	 *
	 * This is the half the DOM cannot supply. `deliveredAt` is when the response
	 * the route produced actually reached the page, and `clearedAt` is when the
	 * card left the screen; on the build whose verdict came from the DOM, the
	 * press was reported lost whenever the second of those came first, whatever
	 * the first said. The two timestamps are what let a reader see the order
	 * rather than be told about it, and both are epoch milliseconds on this one
	 * machine.
	 */
	const state = await waitForAnswer();
	record.answers = state.answers;
	// Which source the log came from: the live route, or the file a run that
	// killed the backend left behind. See `readRigState`.
	record.answersFrom = state.from;
	/*
	 * THE VALUE THE OWNER TOOK, carried into the record rather than left in a
	 * sibling file a reader has to know about. A press's `200` says the route took
	 * it, and this is what makes "the press WON" checkable from the artifact
	 * alone: the label here is the pressed option's label (code review round 1,
	 * m3).
	 */
	record.ownerAnswer = state.ownerAnswer ?? null;
	/*
	 * WHICH TREE this record is of. The pair's whole claim is that the same run
	 * on two builds differs, and until this field existed that claim rested on the
	 * manifest's prose: a reader could not check from the artifact which `src/`
	 * the frames were taken on. `srcTree` is the one that matters (the renderer is
	 * what the frame shows); `head` is the commit.
	 */
	record.tree = (() => {
		const rev = (spec) => {
			try {
				return execFileSync("git", ["rev-parse", spec], {
					encoding: "utf8",
				}).trim();
			} catch {
				return null;
			}
		};
		/*
		 * `srcDirty` is what keeps a REVERTED-SOURCE run honest. The BEFORE half of
		 * the pair is taken with this branch's two renderer files set back to the
		 * base revision in the working tree, and `HEAD:src` alone would then name a
		 * tree the run did not use. Recording the porcelain answer means the record
		 * says which tree it was on without a reader having to be told.
		 */
		const status = (() => {
			try {
				return execFileSync("git", ["status", "--porcelain", "--", "src"], {
					encoding: "utf8",
				}).trim();
			} catch {
				return "";
			}
		})();
		return {
			head: rev("HEAD"),
			srcTree: rev("HEAD:src"),
			srcDirty: status !== "",
			srcStatus: status === "" ? null : status,
		};
	})();
	record.clearedAt = clearedAt;
	record.clearedAfterPressMs =
		clearedAt === null ? null : clearedAt - pressedAt;
	const deliveredAt = state.answers[0]?.deliveredAt ?? null;
	record.ordering =
		clearedAt !== null && deliveredAt !== null
			? {
					clearedAt,
					deliveredAt,
					verdict:
						clearedAt < deliveredAt
							? "the card cleared before the response was delivered"
							: "the response was delivered before the card cleared",
				}
			: null;
	/*
	 * WAIT ON THE SENTENCE THE RUN DECLARED, not on a clock.
	 *
	 * A failure the app can only learn about after its own control deadline (the
	 * `--hold-answers-ms` arm) lands tens of seconds after the gate cleared, and a
	 * fixed sleep would read the composer before the app had said anything —
	 * reporting a run as contradicting its declaration when it was merely early.
	 * The declaration is the event, so the run waits for it and the deadline is
	 * only the bound.
	 */
	const declaredSentence = {
		silent: null,
		settled: SETTLED_SENTENCE,
		"moved-on": MOVED_ON_SENTENCE,
		unknown: UNCONFIRMED_LEAD,
		// The same register on the CARD, which is the arm UX round 2's U7 and QA's
		// Q1 measured: the deadline shape leaves the card up *because* the request
		// is still in flight, so this is what a plain press reaches.
		"card-unknown": UNCONFIRMED_LEAD,
	}[EXPECT];
	if (declaredSentence) {
		const sentenceDeadline = Date.now() + 45_000;
		for (;;) {
			const seen = await evaluate(
				`document.body.innerText.includes(${JSON.stringify(declaredSentence)})`,
			);
			if (seen || Date.now() > sentenceDeadline) break;
			await wait(500);
		}
	}
	await wait(1500);
	record.report = await evaluate(READ_REPORT);
	record.after = await evaluate(READ_STATE);
	const after = await shoot("after-click");
	record.frames.after = `${after.theme}.webp`;

	/*
	 * The run's own verdict on what the composer said, when the caller declared
	 * what it must say. A contradiction is a FAILED run and takes the diagnostic
	 * path below rather than overwriting the committed pair with a frame of the
	 * wrong behaviour — the same rule the unresolved-gate case already follows,
	 * and the reason `CLICK_PROOF_EXPECT` exists at all: the two runs of this pair
	 * differ only in the build under them, so the run that produced the old
	 * behaviour and the run that produced the new one must be told apart by the
	 * caller and not by whoever reads the frames later.
	 */
	const report = record.report;
	const contradicted =
		EXPECT === "silent"
			? report.settledSentence ||
				report.movedOnSentence ||
				report.settledSentence ||
				report.unconfirmedSentence ||
				report.notSentCopy.length > 0 ||
				report.cardRefusal
			: EXPECT === "moved-on"
				? !report.movedOnSentence
				: EXPECT === "settled"
					? !report.settledSentence
					: EXPECT === "unknown"
						? !report.unconfirmedSentence
						: EXPECT === "not-sent"
							? report.notSentCopy.length === 0
							: EXPECT === "card-refusal"
								? !report.cardRefusal
								: EXPECT === "card-unknown"
									? !report.cardUnknown
									: false;
	/*
	 * And the ORDERING the run was told to force, asserted rather than merely
	 * recorded: the verdict is computed from two timestamps and can be the other
	 * one whenever the delay did not take (a rig started without
	 * `--answer-delay-ms`, a response that was already on the wire), and a
	 * committed "before" frame read as the losing order while showing the winning
	 * one is exactly the kind of evidence this repository refuses (code review
	 * round 1, m3). `-` means the run makes no ordering claim — a refused press
	 * never clears the gate, so it has no clearing to order against.
	 */
	const orderContradicted =
		EXPECT_ORDER !== "" &&
		EXPECT_ORDER !== "-" &&
		record.ordering?.verdict !== ORDER_VERDICTS[EXPECT_ORDER];

	if (resolved && !contradicted && !orderContradicted) {
		writeFileSync(
			join(OUT, "click-result.json"),
			`${JSON.stringify(record, null, 2)}\n`,
		);
		console.log(
			`click-proof: the gate resolved at ${aim.x},${aim.y} -> ${aim.label}` +
				` (answer ${record.answers[0]?.status}, report ${EXPECT || "unasserted"})`,
		);
	} else {
		/*
		 * A RUN WHOSE PRESS DID NOT CLEAR THE GATE IS NOT EVIDENCE, for the same
		 * reason the catch below gives: `click-result.json` is the record the
		 * committed live pair is read against, and a run that could not resolve the
		 * gate must not replace it with `resolved: false` (code review round 3,
		 * n2). The run reports itself in the diagnostic beside it instead, which is
		 * the shape the failure path already uses.
		 *
		 * The two frames go back with it. They are pictures of a run that did not
		 * resolve - and, worse, `after-click/` holds a card that never cleared, next
		 * to a committed `after-click/` that did. Leaving modern frames behind to be
		 * read as evidence is the round-1 incident this file's own comments exist
		 * for, and a third frame in a set the manifest declares as two also fails
		 * the evidence gate. A path git knows is restored to what the tree holds; one
		 * it does not is removed.
		 */
		record.error = resolved
			? `the run contradicted its own declaration: expect=${EXPECT || "any"} order=${EXPECT_ORDER || "any"} saw ${JSON.stringify({ report, ordering: record.ordering })}`
			: `the gate did not resolve: nothing cleared the pending gate within 30s of the press at ${aim.x},${aim.y} (${aim.label})`;
		record.pageProblems = pageProblems;
		record.frames.restored = [];
		for (const shot of [before, after]) {
			try {
				execFileSync("git", ["checkout", "--", shot.path]);
				record.frames.restored.push(shot.path);
			} catch {
				rmSync(shot.path, { force: true });
			}
		}
		mkdirSync(OUT, { recursive: true });
		writeFileSync(
			join(OUT, "click-result.diagnostic.json"),
			`${JSON.stringify(record, null, 2)}\n`,
		);
		console.error(
			`click-proof FAILED: ${record.error} The committed record and frames were left alone.`,
		);
		process.exitCode = 1;
	}
} catch (error) {
	/*
	 * A FAILED RUN IS NOT EVIDENCE, so it does not overwrite the record the
	 * committed frames are read against. It writes a diagnostic beside it and
	 * exits non-zero - which is the property the round-1 rig lacked: it died
	 * mid-run, left its frames, and nothing about the run said so.
	 */
	record.error = String(error?.stack ?? error);
	record.pageProblems = pageProblems;
	record.pageText = await evaluate("document.body.innerText").catch(() => null);
	// `recursive` again rather than trusting the up-front one: this is the only
	// branch whose whole purpose is to run when something unexpected happened,
	// and it must not be able to fail on its own precondition.
	mkdirSync(OUT, { recursive: true });
	writeFileSync(
		join(OUT, "click-result.diagnostic.json"),
		`${JSON.stringify(record, null, 2)}\n`,
	);
	console.error(`click-proof FAILED: ${record.error}`);
	process.exitCode = 1;
} finally {
	try {
		browser.close();
		chrome.kill();
		/* The profile is Chrome's, and Chrome may still be releasing it; a
		 * failure to remove a temp directory must never replace the run's own
		 * error, which is what hid this run's first failure. */
		await wait(1000);
		rmSync(dataDir, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 200,
		});
	} catch {}
}
