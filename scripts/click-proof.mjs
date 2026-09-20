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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
 * The sentence the composer shows when the answer route refused because the
 * owner had already settled the question. Duplicated from `ask-answer.ts` here
 * deliberately: this driver is the way a reviewer checks that the shipped copy
 * is the one the module holds, and a driver that imported it would agree with
 * the module by construction.
 */
const SETTLED_SENTENCE =
	"That question was already answered somewhere else, so your answer was not sent.";
/*
 * What this run must find on the page after the press, when the caller says.
 * `silent` is the shipping contract for a press the owner TOOK: it is the
 * user's bug, so a run that finds a sentence there must not overwrite the
 * committed record with it. `settled` is the contract for a press the owner
 * refused. Unset records without asserting, which is how the pair was first
 * taken.
 */
const EXPECT = process.env.CLICK_PROOF_EXPECT ?? "";

/*
 * What the composer says about the press, read as the user reads it.
 *
 * `settledSentence` is read from the page's own TEXT rather than from the
 * sentence this driver holds, so a run that found an empty alert area in a
 * page that never rendered the message cannot be mistaken for one that
 * rendered nothing.
 */
const READ_REPORT = `(() => {
	const alerts = [...document.querySelectorAll('[role="alert"]')]
		.map((n) => n.textContent.replace(/\\s+/g, " ").trim())
		.filter(Boolean);
	return {
		settledSentence: document.body.innerText.includes(${JSON.stringify(SETTLED_SENTENCE)}),
		notSentCopy: alerts.filter((a) => a.includes("Your answer was not sent.")),
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
async function waitForAnswer() {
	const deadline = Date.now() + 60_000;
	for (;;) {
		const state = await evaluate(
			`fetch("${ORIGIN}/rig-state").then((r) => r.json())`,
		);
		const answers = state.answers ?? [];
		if (
			answers.length > 0 &&
			answers.every((entry) => entry.deliveredAt != null)
		)
			return state;
		if (Date.now() > deadline)
			throw new Error(
				`the rig never recorded a delivered answer: ${JSON.stringify(state)}`,
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

	// The gate clearing IS the resolution: the owner's future returns and the
	// backend stops projecting a pending gate.
	const cleared = Date.now() + 30_000;
	let resolved = false;
	while (Date.now() < cleared) {
		if (
			!(await evaluate(
				`Boolean(document.querySelector('fieldset[aria-label="Answer options"]'))`,
			))
		) {
			resolved = true;
			break;
		}
		await wait(250);
	}
	record.resolved = resolved;
	const clearedAt = resolved ? Date.now() : null;
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
			? report.settledSentence || report.notSentCopy.length > 0
			: EXPECT === "settled"
				? !report.settledSentence
				: false;

	if (resolved && !contradicted) {
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
			? `the composer's report contradicted CLICK_PROOF_EXPECT=${EXPECT}: ${JSON.stringify(report)}`
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
