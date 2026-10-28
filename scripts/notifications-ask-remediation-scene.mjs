/**
 * Ask-card remediation slice of the existing GitHub-hosted macOS scene.
 *
 * This is CLIENT + QUEUE evidence, not model delivery or credential-vault proof.
 * Real core store APIs seed the asks; real AskQueue.respond records acceptance.
 * A loopback fixture adapter fails the first two synthetic answer requests, then
 * passes a key-only cell to the queue (the substitution Session normally owns).
 * No provider, credential persistence, foreground bypass, or forged DOM is used.
 * The parent owns the only app/backend and enforces the hosted-runner guard.
 */
import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";

export const ASK_SCENE_SESSION = "146600000001";
export const ASK_SCENE_ID = "a-146a";
export const ASK_SCENE_KEY = "EDGE_SECRET";
const ORIGINAL = "synthetic-ci-original-not-a-credential";
const CORRECTED = "synthetic-ci-corrected-not-a-credential";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Kept inspectable/testable without launching core or Electron on a developer host. */
export function askSeedPython(config) {
	return `import json, time
from pathlib import Path
from types import SimpleNamespace
from local_operator.asks import store
from local_operator.asks.queue import AskQueue
from local_operator.notifications.store import NotificationStore
config = Path(${JSON.stringify(config)})
sid = ${JSON.stringify(ASK_SCENE_SESSION)}
sd = config / "sessions" / sid
sd.mkdir(parents=True, exist_ok=True)
now = store.now_ms()
# A synthetic journal makes the cold conversation discoverable. No model runs.
row = {"v": 1, "type": "message", "id": "ask-scene-user", "timestamp": time.time(), "payload": {"kind": "message", "role": "user", "content": [{"text": "Synthetic ask remediation scene; no external tools."}]}}
(sd / "transcript.jsonl").write_text(json.dumps(row) + "\\n")
questions = [
    (${JSON.stringify(ASK_SCENE_ID)}, {"id": ${JSON.stringify(ASK_SCENE_KEY)}, "question": "Enter a synthetic edge marker for the retry test", "secret": True, "persist": False, "options": []}),
    ("a-146b", {"id": "CHOICE", "question": "Keep the other question pending", "options": [{"label": "Blue"}, {"label": "Green"}]}),
    ("a-146c", {"id": "WITHDRAWN", "question": "The agent withdrew this long question after it learned that no change to the staging configuration was needed", "options": [{"label": "Blue"}]})
]
for aid, question in questions:
    assert store.append_event(sd, {"v": 1, "kind": "queued", "at": now, "ask_id": aid, "created_at": now, "expires_at": now + 86400000, "timeout_s": 86400, "urgent": False, "questions": [question]})
assert store.append_event(sd, {"v": 1, "kind": "withdrawn", "ask_id": "a-146c", "at": now, "reason": "no longer needed"})
queue = AskQueue(SimpleNamespace(), config_dir=config, session_id=sid, cwd=str(sd))
store.write_entry(config, sid, cwd=str(sd), asks=queue.projection())
item = NotificationStore(config).notify(sid, key="ask-remediation", title="Synthetic ask remediation", body_md="Client retry and localized withdrawn-card evidence only.", priority="normal")
print(json.dumps({"item": item.item_id, "asks": store.session_asks(config, sid)}))
`;
}

export function askAcceptPython(config) {
	return `import json
from types import SimpleNamespace
from local_operator.asks.queue import AskQueue
queue = AskQueue(SimpleNamespace(), config_dir=${JSON.stringify(config)}, session_id=${JSON.stringify(ASK_SCENE_SESSION)})
# Synthetic adapter: Session's value-to-key substitution is NOT under test here.
verdict = queue.respond(${JSON.stringify(ASK_SCENE_ID)}, {${JSON.stringify(ASK_SCENE_KEY)}: ["[EDGE_SECRET]"]}, by="desktop-ci-fixture")
assert verdict.get("ok"), verdict
record = next(row for row in queue.records() if row["ask_id"] == ${JSON.stringify(ASK_SCENE_ID)})
assert record["status"] == "answered", record
assert not record.get("delivered"), "This fixture must never claim agent delivery"
print(json.dumps({"verdict": verdict, "record": record}))
`;
}

/** Transparent for normal requests, including the original foreground controls. */
export async function createAskFaultProxy({ base, token, accept }) {
	const attempts = [];
	const intercepted = [];
	const sockets = new Set();
	/*
	 * WHY A FORWARDED LEDGER EXISTS. The 2026-10-28 hosted run failed with
	 * `intercepted: []` and `attempts: []`, which is ambiguous between two very
	 * different defects: the press issued no request at all, or the renderer posted
	 * past the proxy to core. A row per forwarded non-fixture request (method and
	 * path only, never a body) separates them: traffic here proves the app is talking
	 * through this adapter, so an empty `intercepted` then means the gesture itself
	 * produced nothing. Bounded so a long page load cannot grow it without limit.
	 */
	const forwarded = [];
	const path = `/v1/desktop/sessions/${ASK_SCENE_SESSION}/answers`;
	/* Pipe, do not collect: the pre-existing scene's SSE must arrive before EOF.
	 * Preserve request headers (including Host/auth), status, response headers and
	 * raw bytes. The destination stays pinned to core, never to a client URL. */
	const forward = (req, res, body) => {
		if (forwarded.length < 40) forwarded.push(`${req.method} ${req.url}`);
		const target = new URL(base);
		const incoming = new URL(req.url, base);
		target.pathname = incoming.pathname;
		target.search = incoming.search;
		const upstream = httpRequest(
			target,
			{ method: req.method, headers: req.headers },
			(answer) => {
				res.writeHead(answer.statusCode, answer.statusMessage, answer.headers);
				answer.pipe(res);
			},
		);
		upstream.on("error", () => {
			if (!res.headersSent) res.writeHead(502);
			res.end();
		});
		if (body === undefined) req.pipe(upstream);
		else upstream.end(body);
		res.on("close", () => upstream.destroy());
	};
	const server = createServer(async (req, res) => {
		if (req.method !== "POST" || req.url !== path) {
			forward(req, res);
			return;
		}
		let observationRow;
		try {
			const chunks = [];
			let size = 0;
			for await (const chunk of req) {
				size += chunk.length;
				assert.ok(size < 65536, "bounded fixture request");
				chunks.push(chunk);
			}
			const body = Buffer.concat(chunks);
			let submitted;
			try {
				submitted = JSON.parse(body.toString("utf8"));
			} catch {
				forward(req, res, body);
				return;
			}
			// A different ask, even in this synthetic session, remains core's request.
			if (submitted.ask_id !== ASK_SCENE_ID) {
				forward(req, res, body);
				return;
			}
			observationRow = {
				method: req.method,
				path: req.url,
				askId: submitted.ask_id,
				status: null,
			};
			intercepted.push(observationRow);
			res.setHeader("content-type", "application/json");
			if (req.headers.authorization !== `Bearer ${token}`) {
				observationRow.status = 401;
				res.writeHead(401);
				res.end(JSON.stringify({ detail: "Fixture bearer required" }));
				return;
			}
			const value = submitted.answers?.[ASK_SCENE_KEY]?.[0];
			// Only booleans enter the receipt; never retain plaintext for audit/logging.
			const observation = {
				original: value === ORIGINAL,
				corrected: value === CORRECTED,
			};
			attempts.push(observation);
			assert.equal(
				attempts.length <= 2 ? observation.original : observation.corrected,
				true,
				"request must be original, unchanged Retry, then corrected new Send",
			);
			assert.ok(attempts.length <= 3, "no duplicate sends");
			if (attempts.length <= 2) {
				observationRow.status = 503;
				res.writeHead(503);
				res.end(
					JSON.stringify({
						detail: "Fixture-controlled transport failure; no answer recorded.",
					}),
				);
			} else {
				const result = await accept();
				observationRow.status = 200;
				res.writeHead(200);
				res.end(JSON.stringify({ result: { detail: result.verdict } }));
			}
		} catch {
			if (observationRow) observationRow.status = 500;
			res.writeHead(500);
			res.end(
				JSON.stringify({
					detail: "Synthetic fixture refused the request; see boolean receipt.",
				}),
			);
		}
	});
	server.on("connection", (socket) => {
		sockets.add(socket);
		socket.on("close", () => sockets.delete(socket));
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	return {
		apiUrl: `http://127.0.0.1:${server.address().port}`,
		attempts,
		intercepted,
		forwarded,
		close: async () => {
			for (const socket of sockets) socket.destroy();
			await new Promise((resolve) => server.close(resolve));
		},
	};
}

export async function prepareAskRemediation({
	base,
	config,
	token,
	coreStore,
}) {
	const seeded = JSON.parse(coreStore(config, askSeedPython(config)));
	const receipt = {
		mode: "fixture-transport-and-real-core-queue; no vault or agent delivery",
		seeded,
	};
	const proxy = await createAskFaultProxy({
		base,
		token,
		accept: async () => {
			receipt.acceptance = JSON.parse(
				coreStore(config, askAcceptPython(config)),
			);
			return receipt.acceptance;
		},
	});
	receipt.intercepted = proxy.intercepted;
	receipt.attempts = proxy.attempts;
	receipt.forwarded = proxy.forwarded;
	return { ...proxy, receipt, item: seeded.item };
}

async function until(check, message, budget = 15000, diagnostic = null) {
	const end = Date.now() + budget;
	do {
		if (await check()) return;
		await pause(100);
	} while (Date.now() < end);
	// Restoration failures otherwise expose only a selector and hide whether the
	// route changed, reload stalled, or the reel mounted empty.
	const detail = diagnostic ? await diagnostic() : null;
	throw new Error(detail ? `${message}: ${JSON.stringify(detail)}` : message);
}

const cardSelector = `[data-lo-ask-row="${ASK_SCENE_ID}"]`;
const buttonExpression = (label) =>
	`Array.from(document.querySelectorAll('${cardSelector} button')).find(el => el.textContent.trim() === ${JSON.stringify(label)})`;

/** A trusted click, not DOM click(): scrolling is setup, hit-testing is asserted. */
async function click(cdp, expression) {
	const point = await cdp.evaluate(
		`(() => { const el = ${expression}; if (!el || el.disabled) return null; el.scrollIntoView({block:'center'}); const r=el.getBoundingClientRect(); const x=r.x+r.width/2,y=r.y+r.height/2; const hit=document.elementFromPoint(x,y); return hit && (hit===el || el.contains(hit)) ? {x,y} : null; })()`,
	);
	assert.ok(point, "native pointer target must exist, be enabled and hit-test");
	for (const type of ["mousePressed", "mouseReleased"])
		await cdp.send("Input.dispatchMouseEvent", {
			type,
			button: "left",
			clickCount: 1,
			...point,
		});
}
/** Scroll the measured state into the native viewport before taking evidence. */
async function reveal(cdp, expression) {
	await cdp.evaluate(
		`(() => {const el=${expression};if(!el)throw new Error('capture target absent');el.scrollIntoView({block:'center'});})()`,
	);
	await pause(100);
	assert.ok(
		await cdp.evaluate(
			`(() => {const r=(${expression}).getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight && r.left>=0 && r.right<=innerWidth;})()`,
		),
		"capture target must fit in the viewport",
	);
}
/*
 * A NATIVE PRESS, NOT A SCRIPTED ONE. `rawKeyDown` is the repository's gesture
 * convention, and Enter additionally carries `text: "\r"` because that is the field
 * Blink keys its default action off: a key event WITHOUT text reaches keydown
 * listeners but does not activate the focused button - the shape the 2026-10-28
 * hosted run recorded (Send focused, no request, no Retry). Both virtual key codes
 * travel so macOS and Chromium agree on the physical key.
 *
 * Exported so the payload itself is testable without a browser.
 */
export function nativeKeyEvent(name, code, modifiers = 0) {
	return {
		key: name,
		code: name,
		windowsVirtualKeyCode: code,
		nativeVirtualKeyCode: code,
		modifiers,
		...(name === "Enter" ? { text: "\r", unmodifiedText: "\r" } : {}),
	};
}
async function key(cdp, name, code, modifiers = 0) {
	const event = nativeKeyEvent(name, code, modifiers);
	for (const type of ["rawKeyDown", "keyUp"])
		await cdp.send("Input.dispatchKeyEvent", { type, ...event });
}
async function typeSecret(cdp, value) {
	await click(
		cdp,
		`document.querySelector('${cardSelector} input[data-ask-secret]')`,
	);
	await cdp.send("Input.dispatchKeyEvent", {
		type: "keyDown",
		key: "a",
		code: "KeyA",
		modifiers: 4,
		commands: ["selectAll"],
	});
	await cdp.send("Input.dispatchKeyEvent", {
		type: "keyUp",
		key: "a",
		code: "KeyA",
		modifiers: 4,
	});
	await cdp.send("Input.insertText", { text: value });
}
async function tabTo(cdp, expression) {
	for (let n = 0; n < 24; n++) {
		if (await cdp.evaluate(`document.activeElement === (${expression})`))
			return n;
		await key(cdp, "Tab", 9);
	}
	throw new Error("Keyboard traversal did not reach the enabled action");
}
const focus = (cdp) =>
	cdp.evaluate(
		`(() => {const el=document.activeElement;return {tag:el?.tagName,label:el?.getAttribute('aria-label'),text:el?.tagName==='BUTTON'?el.textContent:null,connected:!!el?.isConnected};})()`,
	);
const geometry = (cdp) =>
	cdp.evaluate(
		`(() => {const pane=document.querySelector('[data-notification-detail]');if(!pane)return null;const r=pane.parentElement.getBoundingClientRect();const bad=[pane.parentElement,pane,...pane.children].filter(el=>el.scrollWidth>el.clientWidth+1||el.getBoundingClientRect().right>innerWidth+1);return {width:innerWidth,left:r.left,right:r.right,overflow:bad.length,dir:document.documentElement.dir,lang:document.documentElement.lang,theme:document.documentElement.dataset.theme};})()`,
	);

/**
 * Put the parent scene back where its own negative controls expect it: English,
 * the saved window bounds, the reel route.
 *
 * A restoration failure is REPORTED WITH ITS PROBE, not as a bare selector. The
 * 2026-10-28 hosted run reported only `original Notifications reel did not return`,
 * which could equally be a stalled reload, a lost language write or an empty reel;
 * the probe records the route, the document state and the row count at that moment.
 */
export async function restoreNotifications({ cdp, nodeCdp, saved }) {
	const diagnostic = () =>
		cdp.evaluate(`(() => ({
			hash: location.hash,
			readyState: document.readyState,
			rows: document.querySelectorAll('[data-notification-row]').length,
			detail: !!document.querySelector('[data-notification-detail]'),
			text: document.body?.innerText.slice(0, 400)
		}))()`);
	await cdp.evaluate(
		"window.api.desktop.request({op:'settings.edit',key:'language',value:'en'})",
	);
	await nodeCdp.evaluate(
		`(() => {const e=process.mainModule?.require('electron')??globalThis.require('electron');e.BrowserWindow.getAllWindows()[0].setContentBounds(${JSON.stringify(saved)});})()`,
	);
	await cdp.evaluate(
		"window.location.hash='#/notifications';window.location.reload()",
	);
	await until(
		() => cdp.evaluate("!!document.querySelector('[data-notification-row]')"),
		"original Notifications reel did not return",
		15000,
		diagnostic,
	);
	return diagnostic();
}

/**
 * Restore the parent scene's conditions, and never let cleanup replace the scene's
 * own failure. The 2026-10-28 hosted run reported the cleanup message while the
 * scene had already failed earlier at `fixture failure did not expose Retry`; a
 * `finally` that throws masks the assertion that matters and costs a review round
 * its diagnosis. So: the original error always propagates, with cleanup evidence
 * attached; a cleanup error still fails a scene that otherwise SUCCEEDED, because
 * the parent's remaining foreground negatives would then run against the wrong
 * screen - never silently.
 *
 * `restore` is a seam so both halves are provable in a unit test, without Electron,
 * core or a provider.
 */
export async function withNotificationsRestore(
	{ cdp, nodeCdp, saved, receipt },
	scene,
	restore = restoreNotifications,
) {
	let failure = null;
	let result;
	try {
		result = await scene();
	} catch (error) {
		failure = error;
	}
	try {
		receipt.restore = await restore({ cdp, nodeCdp, saved });
	} catch (error) {
		if (!failure) throw error;
		failure.restoreFailure = {
			message: error.message,
			diagnostic: receipt.restore ?? null,
		};
	}
	if (failure) throw failure;
	return result;
}
export async function runAskRemediationScene({
	cdp,
	nodeCdp,
	fixture,
	screenshot,
}) {
	const receipt = fixture.receipt;
	const route = `#/notifications/${encodeURIComponent(fixture.item)}`;
	const navigate = async () => {
		await cdp.evaluate(`(window.location.hash=${JSON.stringify(route)})`);
	};
	const capturePair = async (label) => {
		const first = await geometry(cdp);
		assert.ok(first && first.overflow === 0, "pane geometry must fit");
		const a = await screenshot(cdp, `${label}-first`);
		await pause(300);
		const second = await geometry(cdp);
		const b = await screenshot(cdp, `${label}-settled`);
		assert.deepEqual(second, first, "consecutive frames must not reflow");
		return { first, second, frames: [a, b], focus: await focus(cdp) };
	};
	const saved = await nodeCdp.evaluate(
		`(() => {const e=process.mainModule?.require('electron')??globalThis.require('electron');return e.BrowserWindow.getAllWindows()[0].getContentBounds();})()`,
	);
	try {
		return await withNotificationsRestore(
			{ cdp, nodeCdp, saved, receipt },
			async () => {
				await navigate();
				await until(
					() =>
						cdp.evaluate(
							`!!document.querySelector('${cardSelector} input[data-ask-secret]')`,
						),
					"secret card did not mount",
				);
				await typeSecret(cdp, ORIGINAL);
				receipt.sendTabs = await tabTo(cdp, buttonExpression("Send answer"));
				/*
				 * THE PRESS IS MEASURED, NOT ASSUMED. The hosted run of 2026-10-28 failed
				 * here with `intercepted: []` and `attempts: []`, i.e. the button was
				 * reachable by keyboard but nothing was sent. Any future failure at this
				 * step must say WHICH link broke - the card's state, the button's gate, the
				 * focused element, and whether the app talked through the proxy at all -
				 * instead of a bare "Retry did not appear".
				 */
				const pressDiagnostic = () =>
					cdp
						.evaluate(`(() => ({
						status: document.querySelector('${cardSelector}')?.getAttribute('data-lo-ask-status') ?? null,
						sendDisabled: (${buttonExpression("Send answer")})?.disabled ?? null,
						retry: !!(${buttonExpression("Retry")}),
						active: document.activeElement?.textContent?.trim().slice(0, 40) ?? null,
						secretFilled: !!document.querySelector('${cardSelector} input[data-ask-secret]')?.value,
					}))()`)
						.then((state) => ({
							...state,
							attempts: fixture.attempts.length,
							intercepted: fixture.intercepted.length,
							forwarded: fixture.forwarded.length,
						}));
				await key(cdp, "Enter", 13);
				await until(
					() => cdp.evaluate(`!!(${buttonExpression("Retry")})`),
					"fixture failure did not expose Retry",
					15000,
					() => pressDiagnostic().then((probe) => ({ press: probe })),
				);
				receipt.retryGeometry = await cdp.evaluate(
					`(() => {const el=${buttonExpression("Retry")}; const r=el.getBoundingClientRect();return {height:r.height,width:r.width,sendDisabled:(${buttonExpression("Send answer")}).disabled};})()`,
				);
				assert.ok(
					receipt.retryGeometry.height >= 24 &&
						receipt.retryGeometry.sendDisabled,
				);
				await reveal(cdp, buttonExpression("Retry"));
				receipt.errorFrames = await capturePair("ask-remediation-error");
				// Start keyboard traversal from the real masked field, not the global reel.
				await click(
					cdp,
					`document.querySelector('${cardSelector} input[data-ask-secret]')`,
				);
				receipt.retryTabs = await tabTo(cdp, buttonExpression("Retry"));
				await key(cdp, "Enter", 13);
				await until(
					() => Promise.resolve(fixture.attempts.length === 2),
					"unchanged Retry did not send",
				);
				await until(
					() =>
						cdp.evaluate(
							`!!(${buttonExpression("Retry")}) && !(${buttonExpression("Retry")}).disabled`,
						),
					"second failure not settled",
				);
				await typeSecret(cdp, CORRECTED);
				assert.equal(
					await cdp.evaluate(`(${buttonExpression("Send answer")}).disabled`),
					false,
					"edited secret must re-arm Send",
				);
				receipt.correctedTabs = await tabTo(
					cdp,
					buttonExpression("Send answer"),
				);
				await key(cdp, "Enter", 13);
				await until(
					() =>
						cdp.evaluate(
							`document.querySelector('${cardSelector}')?.getAttribute('data-lo-ask-status')==='answered'`,
						),
					"corrected Send not accepted",
				);
				assert.equal(fixture.attempts.length, 3);
				receipt.attempts = fixture.attempts;
				receipt.intercepted = fixture.intercepted;
				assert.deepEqual(
					fixture.intercepted.map((row) => ({
						askId: row.askId,
						method: row.method,
						status: row.status,
					})),
					[503, 503, 200].map((status) => ({
						askId: ASK_SCENE_ID,
						method: "POST",
						status,
					})),
					"only the three intended synthetic ask requests may be intercepted",
				);
				assert.equal(
					await cdp.evaluate(
						`document.body.innerText.includes(${JSON.stringify(ORIGINAL)}) || document.body.innerText.includes(${JSON.stringify(CORRECTED)})`,
					),
					false,
					"synthetic secret leaked into visible text",
				);
				assert.equal(
					await cdp.evaluate(
						`document.querySelector('${cardSelector}')?.textContent.includes('[EDGE_SECRET]')`,
					),
					true,
				);
				await reveal(cdp, `document.querySelector('${cardSelector}')`);
				receipt.acceptedFrames = await capturePair("ask-remediation-accepted");
				assert.equal(receipt.acceptance.record.delivered ?? false, false);

				await nodeCdp.evaluate(
					`(() => {const e=process.mainModule?.require('electron')??globalThis.require('electron');e.BrowserWindow.getAllWindows()[0].setContentSize(820,900);})()`,
				);
				receipt.locales = {};
				for (const [locale, label, sentence] of [
					["fr", "Retirée", "Retirée — l’agent n’attend plus de réponse"],
					[
						"ur",
						"واپس لیا گیا",
						"واپس لیا گیا — ایجنٹ کو اب جواب کی ضرورت نہیں",
					],
				]) {
					const result = await cdp.evaluate(
						`window.api.desktop.request({op:'settings.edit',key:'language',value:${JSON.stringify(locale)}})`,
					);
					assert.equal(
						result.status,
						200,
						"actual backend locale setting must be accepted",
					);
					await cdp.evaluate("window.location.reload()");
					const trigger = `Array.from(document.querySelectorAll('[data-lo-ask-settled] button')).find(el => el.textContent.trim().startsWith(${JSON.stringify(label)}))`;
					await until(
						() => cdp.evaluate(`!!(${trigger})`),
						`${locale} withdrawn compact label not rendered`,
					);
					await reveal(cdp, trigger);
					const compact = await capturePair(
						`ask-remediation-withdrawn-${locale}-compact`,
					);
					assert.equal(
						compact.first.dir || "ltr",
						locale === "ur" ? "rtl" : "ltr",
					);
					assert.ok(
						Math.abs(compact.first.left - 24) <= 1 &&
							Math.abs(compact.first.width - compact.first.right - 24) <= 1,
						"narrow pane must keep 24px edge insets",
					);
					await click(cdp, trigger);
					await until(
						() =>
							cdp.evaluate(
								`document.querySelector('[data-notification-detail]')?.textContent.includes(${JSON.stringify(sentence)})`,
							),
						`${locale} expanded withdrawn sentence missing`,
					);
					await reveal(
						cdp,
						"document.querySelector('[data-lo-ask-row=\"a-146c\"]')",
					);
					const expanded = await capturePair(
						`ask-remediation-withdrawn-${locale}-expanded`,
					);
					receipt.locales[locale] = { compact, expanded };
				}
				receipt.result =
					"client-retry-and-localized-layout-confirmed-no-agent-delivery";
				return receipt;
			},
		);
	} catch (error) {
		if (error.restoreFailure) receipt.restoreFailure = error.restoreFailure;
		throw error;
	}
}
