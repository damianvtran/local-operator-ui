
/* ===================================================================== *
 *        QA ROUND 3 (independent) — the /btw aside, delta since 97ff24e1d
 *
 * Appended to a COPY of scripts/renderer-driver.mjs (with round 1/2's helper layer
 * and round 2's scenes above it). The app's source is unmodified.
 *
 * The delta: U1 (ask again after a refusal), U2 (follow-up while answering), D6
 * (append scrolls the new turn into view), the fold's off-record staged-payload
 * settle, #479's in-flight composer beside the aside, and the 409 copy.
 *
 * WIRE READINGS come from the proxy's own stats file (QA_PROXY_STATS), which it
 * rewrites every second and on every aside/message POST.
 * ===================================================================== */

const R3 = {
	FIELD: 'textarea[aria-label="Message"]',
	TAIL: "wrong, not the provider",
	ANSWER_HEAD: "Transport failures and owner",
	LONG_END: "LONG-END.",
	UNANSWERED: "did not answer your aside in text",
	EMPTY: "answered your aside with no text at all",
	ESCAPE: "Close this aside and start a new one with /btw.",
	BUSY: "The aside is still answering \u2014 send the question when it finishes.",
	FILES: "An aside answers text only. Remove the attached files to ask it.",
	NO_LONGER: "This aside is no longer available",
	PH_ASIDE: "Ask off the record \u2014 Esc closes the aside",
	PH_SENDING: "Sending your message",
};

function r3stats() {
	try {
		return JSON.parse(readFileSync(process.env.QA_PROXY_STATS, "utf8"));
	} catch {
		return { asidePosts: [], messagePosts: [] };
	}
}
const r3posts = (needle) =>
	(r3stats().asidePosts ?? []).filter((p) => (p.text ?? p.questionHead ?? "").includes(needle));
const r3msgs = (needle) =>
	(r3stats().messagePosts ?? []).filter((p) => (p.text ?? "").includes(needle));

/** The composer + panel facts this round needs beyond readQaBand. */
function r3Read(cdp) {
	return cdp.evaluate(`(() => {
		const flat = (el) => (el ? el.textContent.replace(/\\s+/g, " ").trim() : null);
		const field = document.querySelector('textarea[aria-label="Message"]');
		const panel = document.querySelector("[data-lo-aside-panel]");
		const region = panel ? panel.querySelector('[aria-label="The aside exchange"]') : null;
		const send = document.querySelector('button[type="submit"][aria-label="Send message"], button[type="submit"][aria-label="Ask the aside"]');
		const band = document.querySelector("[data-lo-composer-band]");
		const replies = Array.from(document.querySelectorAll('[aria-label="Remove reply"]')).map((b) => {
			const span = b.closest("div") ? b.closest("div").querySelector("span[title]") : null;
			return span ? span.getAttribute("title") : "?";
		});
		const attachments = document.querySelectorAll('[aria-label="Remove attachment"]').length;
		const alerts = panel ? Array.from(panel.querySelectorAll('[role="alert"]')).map(flat) : [];
		const bandLines = band
			? Array.from(band.querySelectorAll("p, [role=alert]"))
					.filter((n) => !n.closest("[data-lo-aside-panel]"))
					.filter((n) => !(n.parentElement && n.parentElement.closest("p, [role=alert]")))
					.map(flat)
					.filter(Boolean)
			: [];
		let geo = null;
		if (region) {
			const rr = region.getBoundingClientRect();
			const turns = Array.from(region.children);
			const last = turns[turns.length - 1] ?? null;
			const lr = last ? last.getBoundingClientRect() : null;
			const q = last ? last.querySelector("p") : null;
			const qr = q ? q.getBoundingClientRect() : null;
			geo = {
				scrollTop: Math.round(region.scrollTop * 10) / 10,
				clientHeight: region.clientHeight,
				scrollHeight: region.scrollHeight,
				maxScroll: region.scrollHeight - region.clientHeight,
				turns: turns.length,
				lastTurnContentOffset: lr ? Math.round((region.scrollTop + lr.top - rr.top) * 10) / 10 : null,
				questionTopInRegion: qr ? Math.round((qr.top - rr.top) * 10) / 10 : null,
				questionBottomInRegion: qr ? Math.round((qr.bottom - rr.top) * 10) / 10 : null,
				questionFullyVisible: qr ? qr.top >= rr.top - 0.5 && qr.bottom <= rr.bottom + 0.5 : null,
				questionText: q ? flat(q) : null,
			};
		}
		return {
			value: field ? field.value : null,
			placeholder: field ? field.placeholder : null,
			activeIsField: document.activeElement === field,
			sendLabel: send ? send.getAttribute("aria-label") : null,
			sendDisabled: send ? send.disabled : null,
			replies,
			attachments,
			panelUp: panel !== null,
			alerts,
			bandLines,
			geo,
		};
	})()`);
}

async function r3AwaitRead(cdp, want, attempts = 100, gap = 100) {
	let r = await r3Read(cdp);
	for (let i = 0; i < attempts; i++) {
		if (want(r)) return r;
		await wait(gap);
		r = await r3Read(cdp);
	}
	return r;
}

/** Select `needle` inside the transcript and press the real Quote control. */
async function r3StageQuote(cdp, needle) {
	const selected = await cdp.evaluate(`(() => {
		const root = document.querySelector("[data-lo-transcript-content]");
		if (!root) return "no transcript";
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		// The LAST occurrence: the newest answer is the one on screen (an older turn
		// scrolled out of view mounts its Quote control with no box).
		const hits = [];
		let n = walker.nextNode();
		while (n) {
			if (n.nodeValue.indexOf(${JSON.stringify(needle)}) >= 0 && !n.parentElement.closest("[data-lo-quote-toolkit]")) hits.push(n);
			n = walker.nextNode();
		}
		let node = hits.length ? hits[hits.length - 1] : null;
		if (node) node.scrollIntoView?.call(node.parentElement, { block: "center" });
		while (node) {
			const at = node.nodeValue.indexOf(${JSON.stringify(needle)});
			if (at >= 0) {
				const range = document.createRange();
				range.setStart(node, at);
				range.setEnd(node, at + ${needle.length});
				const s = window.getSelection();
				s.removeAllRanges();
				s.addRange(range);
				return "selected";
			}
			node = walker.nextNode();
		}
		return "not found";
	})()`);
	let control = null;
	for (let i = 0; i < 30 && selected === "selected"; i++) {
		control = await cdp.evaluate(`(() => {
			const b = document.querySelector('button[aria-label="Quote"]');
			if (!b) return null;
			const r = b.getBoundingClientRect();
			if (r.width === 0) return null;
			return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
		})()`);
		if (control) break;
		await wait(100);
	}
	if (control) await qaPressPoint(cdp, control);
	await wait(300);
	return { selected, pressed: control !== null };
}

/**
 * Stage an image chip through the composer's own onPaste handler. SYNTHETIC: a
 * ClipboardEvent carrying a real File in a DataTransfer, dispatched on the field;
 * the handler's FileReader path then writes the chip exactly as a real paste does.
 * (A real OS paste of a file cannot be driven headless; the Attach button opens a
 * native dialog.)
 */
async function r3PasteImage(cdp, name) {
	await cdp.evaluate(`(() => {
		const field = document.querySelector('textarea[aria-label="Message"]');
		const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
		const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
		const file = new File([bin], ${JSON.stringify(name)}, { type: "image/png" });
		const dt = new DataTransfer();
		dt.items.add(file);
		field.focus();
		field.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
		return true;
	})()`);
	await wait(400);
}

async function r3RemoveAll(cdp, label) {
	for (let i = 0; i < 6; i++) {
		const p = await cdp.evaluate(`(() => {
			const b = document.querySelector('[aria-label=${JSON.stringify(label)}]');
			if (!b) return null;
			const r = b.getBoundingClientRect();
			return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
		})()`);
		if (!p) return;
		await qaPressPoint(cdp, p);
		await wait(250);
	}
}

/**
 * A per-animation-frame AND per-mutation sampler of the composer's three payload
 * registers and the transcript echo, installed in the page before the press, so
 * "one moment" is read at the granularity a user can see (a frame) and at the
 * granularity the DOM changes (a mutation), not at CDP round-trip resolution.
 */
function r3ArmFrameSampler(cdp, echoNeedle) {
	return cdp.evaluate(`(() => {
		const read = () => {
			const field = document.querySelector('textarea[aria-label="Message"]');
			const root = document.querySelector("[data-lo-transcript-content]");
			const text = root ? root.textContent : "";
			let echo = 0, at = text.indexOf(${JSON.stringify(echoNeedle)});
			while (at !== -1) { echo += 1; at = text.indexOf(${JSON.stringify(echoNeedle)}, at + 1); }
			return [
				field ? field.value.length : -1,
				document.querySelectorAll('[aria-label="Remove reply"]').length,
				document.querySelectorAll('[aria-label="Remove attachment"]').length,
				echo,
				field ? field.placeholder : null,
			];
		};
		const t0 = performance.now();
		const s = { frames: [], mutations: [], stop: false };
		window.__qa3 = s;
		const frame = () => {
			if (s.stop) return;
			s.frames.push([Math.round(performance.now() - t0), ...read()]);
			if (performance.now() - t0 < 1500) requestAnimationFrame(frame);
		};
		requestAnimationFrame(frame);
		const mo = new MutationObserver(() => {
			const r = read();
			const last = s.mutations[s.mutations.length - 1];
			if (!last || JSON.stringify(last.slice(1, 5)) !== JSON.stringify(r.slice(0, 4)))
				s.mutations.push([Math.round(performance.now() - t0), ...r.slice(0, 4)]);
		});
		mo.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
		const input = () => {
			const r = read();
			s.mutations.push([Math.round(performance.now() - t0), ...r.slice(0, 4), "input"]);
		};
		document.addEventListener("input", input, true);
		setTimeout(() => { mo.disconnect(); document.removeEventListener("input", input, true); }, 1500);
		return true;
	})()`);
}
/** Frames where ONE register has left and the other has not, against the pre-press state. */
function r3Split(frames) {
	const first = frames[0];
	if (!first) return [];
	const chips0 = first[2] + first[3];
	return frames.filter((f) => {
		const textGone = f[1] === 0;
		const chipsGone = chips0 > 0 && f[2] + f[3] < chips0;
		return chips0 > 0 && textGone !== chipsGone;
	});
}
async function r3ReadFrameSampler(cdp) {
	return cdp.evaluate(`(() => {
		const s = window.__qa3;
		if (!s) return { frames: [], mutations: [] };
		// Keep only the frames around the change: first 3, every frame that differs from its predecessor, last 2.
		const f = s.frames;
		const keep = f.filter((x, i) => i < 3 || i >= f.length - 2 || JSON.stringify(x.slice(1, 5)) !== JSON.stringify(f[i - 1].slice(1, 5)) || (i + 1 < f.length && JSON.stringify(x.slice(1, 5)) !== JSON.stringify(f[i + 1].slice(1, 5))));
		return { frames: keep, all: f.length, mutations: s.mutations };
	})()`);
}

async function sceneBtwR3(cdp) {
	const facts = await factsOf(cdp);
	r2check(
		"window mode is headless and the window is never shown",
		facts.windowMode === "headless" && facts.visible === false,
		`mode=${facts.windowMode} visible=${facts.visible} focused=${facts.focused}`,
	);
	const { sessionId } = await qaOpenSession(cdp);
	note("R3 session", sessionId);
	const frames = [];
	const PREFIX = RUN_LABEL ? `qa3-${RUN_LABEL}` : "qa3";
	const take = async (label, mode = "raw") => {
		const frame =
			mode === "settled"
				? await captureSettled(cdp, `${PREFIX}-${label}`)
				: await capture(cdp, `${PREFIX}-${label}`);
		frames.push({ ...frame, mode });
		note("frame", JSON.stringify({ label: frame.label, mode, ...frame.pixels }));
		return frame;
	};
	const enter = () => pressChord(cdp, { key: "Enter", code: "Enter", virtualKeyCode: 13 });
	const escape = () => pressChord(cdp, { key: "Escape", code: "Escape", virtualKeyCode: 27 });
	const type = async (text) => {
		await cdp.send("Input.insertText", { text });
		await wait(150);
	};
	const replaceComposer = async (text) => {
		await clickAt(cdp, R3.FIELD);
		await pressChord(cdp, { key: "a", code: "KeyA", virtualKeyCode: 65, modifiers: MODIFIER.meta, commands: ["selectAll"] });
		await pressChord(cdp, { key: "Backspace", code: "Backspace", virtualKeyCode: 8 });
		if (text) await cdp.send("Input.insertText", { text });
		await wait(200);
	};
	const band = () => readQaBand(cdp);
	const awaitBand = (want, n = 80) => qaAwaitPanel(cdp, want, n);
	const idle = () => awaitBand((b) => b.transcriptStreaming === false && b.transcriptWorking === false, 400);
	/*
	 * SETTLED, not "tail visible": the deltas carry the whole answer ~0.6 s before the
	 * POST resolves (the stub's finish + usage chunks), and the app's `streaming` flag
	 * is the POST's. Round 3's first pass raced this window; waiting on the proxy's
	 * recorded status AND the panel's own live region is the app's own definition.
	 */
	const awaitSettled = async (needle, n = 300) => {
		for (let i = 0; i < n; i++) {
			const post = r3posts(needle)[0];
			const b = await band();
			if (post && post.status !== null && b.panelAnnounce !== "Asking the aside") return { post, band: b };
			await wait(100);
		}
		return { post: r3posts(needle)[0] ?? null, band: await band() };
	};
	const closePanel = async () => {
		await clickAt(cdp, R3.FIELD);
		await escape();
		await awaitBand((b) => b.panel === null, 60);
	};

	// ---- S0: a thread turn to quote from ---------------------------------------
	await clickAt(cdp, R3.FIELD);
	await type("seed turn for quoting");
	await enter();
	await awaitBand((b) => (b.transcriptText ?? "").includes(R3.TAIL), 300);
	await idle();

	// ---- S1 / Q18: U1 — refused, then ask again in the SAME panel ---------------
	const U1_REFUSE = "TOOLCALL2: u1 refuse this first ask";
	await replaceComposer(`/btw ${U1_REFUSE}`);
	await enter();
	const refused = await r3AwaitRead(cdp, (r) => r.alerts.length > 0, 200);
	const refusedPost = r3posts("u1 refuse this first ask")[0] ?? null;
	r2check(
		"Q18a fresh ask refused (409 aside_unanswered): the panel's alert is the owner's sentence, with NO escape clause",
		refused.alerts.length === 1 && refused.alerts[0].includes(R3.UNANSWERED) && !refused.alerts[0].includes(R3.ESCAPE),
		JSON.stringify({ alerts: refused.alerts, wire: refusedPost && { status: refusedPost.status, continues: refusedPost.continues, response: refusedPost.response } }),
	);
	await take("01-u1-fresh-refused");
	const U1_AGAIN = "u1 a plain question after the refusal";
	await clickAt(cdp, R3.FIELD);
	await type(U1_AGAIN);
	await enter();
	await awaitSettled(U1_AGAIN);
	const again = await band();
	const againRead = await r3Read(cdp);
	const againPost = r3posts(U1_AGAIN)[0] ?? null;
	r2check(
		"Q18b U1: asking again in the SAME panel after a refusal is ANSWERED (no 'no longer available')",
		qaCount(again.panelText, R3.TAIL) === 1 && qaCount(again.panelText, R3.NO_LONGER) === 0 && againRead.alerts.length === 1,
		JSON.stringify({ alerts: againRead.alerts, wire: againPost && { status: againPost.status, continues: againPost.continues } }),
	);
	r2check(
		"Q18b wire: the retry is a FRESH ask (no aside_id continuation of the refused id) and the owner answered 200",
		againPost !== null && againPost.status === 200 && againPost.continues === null,
		JSON.stringify(againPost && { status: againPost.status, continues: againPost.continues, refusedId: refusedPost?.asideId }),
	);
	await take("02-u1-asked-again-answered", "settled");

	const U1_CONT = "TOOLCALL2: u1 refuse a continuation";
	await clickAt(cdp, R3.FIELD);
	await type(U1_CONT);
	await enter();
	await awaitSettled("u1 refuse a continuation");
	const contRefused = await r3AwaitRead(cdp, (r) => r.alerts.length >= 2, 200);
	const contPost = r3posts("u1 refuse a continuation")[0] ?? null;
	r2check(
		"Q18c a refused CONTINUATION states the owner's sentence PLUS the escape clause",
		contRefused.alerts.length === 2 && contRefused.alerts[1].includes(R3.UNANSWERED) && contRefused.alerts[1].includes(R3.ESCAPE),
		JSON.stringify({ alerts: contRefused.alerts, wire: contPost && { status: contPost.status, continues: contPost.continues } }),
	);
	r2check(
		"Q18c wire: the continuation named the last ANSWERED turn's id",
		contPost !== null && contPost.status === 409 && contPost.continues === againPost?.asideId,
		JSON.stringify({ continues: contPost?.continues, answeredId: againPost?.asideId }),
	);
	await take("03-u1-continuation-refused-escape-clause");
	const U1_AFTER = "u1 a question after the refused continuation";
	await clickAt(cdp, R3.FIELD);
	await type(U1_AFTER);
	await enter();
	await awaitSettled(U1_AFTER);
	const after = await band();
	const afterPost = r3posts(U1_AFTER)[0] ?? null;
	r2check(
		"Q18d after a refused continuation the next ask continues the last ANSWERED turn and is answered",
		qaCount(after.panelText, R3.TAIL) === 2 && qaCount(after.panelText, R3.NO_LONGER) === 0 && afterPost?.status === 200 && afterPost?.continues === againPost?.asideId,
		JSON.stringify({ wire: afterPost && { status: afterPost.status, continues: afterPost.continues } }),
	);
	const U1_EMPTY = "EMPTYANS: u1 empty continuation";
	await clickAt(cdp, R3.FIELD);
	await type(U1_EMPTY);
	await enter();
	await awaitSettled("u1 empty continuation");
	const emptyRefused = await r3AwaitRead(cdp, (r) => r.alerts.some((a) => a.includes(R3.EMPTY)), 200);
	const emptyPost = r3posts("u1 empty continuation")[0] ?? null;
	r2check(
		"Q23a 409 aside_empty_answer on a continuation: the owner's sentence + escape clause, on the panel",
		emptyRefused.alerts.some((a) => a.includes(R3.EMPTY) && a.includes(R3.ESCAPE)),
		JSON.stringify({ alerts: emptyRefused.alerts, wire: emptyPost && { status: emptyPost.status, response: emptyPost.response } }),
	);
	await take("04-u1-answered-after-refused-continuation-and-empty", "settled");

	// ---- S2 / Q19: U2 — follow-up while the answer is still streaming ------------
	const U2_FIRST = "u2 first question, answer streams";
	await clickAt(cdp, R3.FIELD);
	await type(U2_FIRST);
	await enter();
	const midstream = await awaitBand((b) => {
		const a = qaAnswerOf(b.panelText, U2_FIRST);
		return a.length > 0 && !a.includes(R3.TAIL);
	}, 80);
	const midLen = qaAnswerOf(midstream.panelText, U2_FIRST).length;
	const U2_FOLLOW = "u2 follow-up typed while the answer streams";
	const postsBefore = (r3stats().asidePosts ?? []).length;
	await type(U2_FOLLOW);
	await enter();
	await wait(300);
	const blocked = await r3Read(cdp);
	const blockedBand = await band();
	const stillStreaming = !qaAnswerOf(blockedBand.panelText, U2_FIRST).includes(R3.TAIL);
	r2check(
		"Q19a U2 composer door: Enter mid-stream keeps the text in the box and says why",
		blocked.value === U2_FOLLOW && blocked.bandLines.some((l) => l.includes(R3.BUSY)) && stillStreaming,
		JSON.stringify({ midLenAtPress: midLen, value: blocked.value, band: blocked.bandLines, stillStreaming }),
	);
	r2check(
		"Q19a nothing left: the follow-up is not on the panel and no aside POST was made for it",
		qaCount(blockedBand.panelText, U2_FOLLOW) === 0 && r3posts(U2_FOLLOW).length === 0,
		JSON.stringify({ postsBefore, postsNow: (r3stats().asidePosts ?? []).length, onPanel: qaCount(blockedBand.panelText, U2_FOLLOW) }),
	);
	await take("05-u2-followup-refused-midstream-text-kept");
	const tailSeen = await awaitBand((b) => qaAnswerOf(b.panelText, U2_FIRST).includes(R3.TAIL), 300);
	const tailAt = Date.now();
	const inWindow = await r3Read(cdp);
	note("Q19 the moment the whole first answer is visible (before its POST settles)", JSON.stringify({ announce: tailSeen.panelAnnounce, value: inWindow.value, band: inWindow.bandLines }));
	await awaitSettled(U2_FIRST);
	note("Q19 tail-visible -> settled window", `${Date.now() - tailAt}ms`);
	const settledU2 = await band();
	const afterSettle = await r3Read(cdp);
	r2check(
		"Q19b once the first answer settles the box still holds the follow-up (no loss), no alert on the panel from it",
		afterSettle.value === U2_FOLLOW && qaCount(settledU2.panelText, R3.NO_LONGER) === 0,
		JSON.stringify({ value: afterSettle.value, alerts: afterSettle.alerts, band: afterSettle.bandLines }),
	);
	await clickAt(cdp, R3.FIELD);
	await enter();
	await awaitSettled(U2_FOLLOW);
	const u2answered = await band();
	const u2read = await r3Read(cdp);
	const u2post = r3posts(U2_FOLLOW)[0] ?? null;
	r2check(
		"Q19c the kept follow-up, sent after settle, is answered in the same panel; the busy line is retired",
		qaAnswerOf(u2answered.panelText, U2_FOLLOW).includes(R3.TAIL) && u2post?.status === 200 && !u2read.bandLines.some((l) => l.includes(R3.BUSY)) && u2read.value === "",
		JSON.stringify({ wire: u2post && { status: u2post.status, continues: u2post.continues }, band: u2read.bandLines, value: u2read.value }),
	);
	await take("06-u2-followup-answered-after-settle", "settled");
	// slash door mid-stream
	const U2_SECOND = "u2 second question for the slash door";
	await clickAt(cdp, R3.FIELD);
	await type(U2_SECOND);
	await enter();
	await awaitBand((b) => (b.panelText ?? "").includes(U2_SECOND), 40);
	const U2_SLASH = "u2 slash follow-up while answering";
	const pageBefore = qaCount(await r2PageText(cdp), R3.BUSY);
	await type(`/btw ${U2_SLASH}`);
	await enter();
	await wait(400);
	const slashBlocked = await r3Read(cdp);
	const slashBand = await band();
	r2check(
		"Q19d U2 /btw door mid-answer: 'retained' — the box keeps `/btw <q>`, the busy sentence is stated, nothing sent",
		slashBlocked.value === `/btw ${U2_SLASH}` && qaCount(await r2PageText(cdp), R3.BUSY) > pageBefore && r3posts(U2_SLASH).length === 0 && qaCount(slashBand.panelText, U2_SLASH) === 0,
		JSON.stringify({ value: slashBlocked.value, busyOnPage: qaCount(await r2PageText(cdp), R3.BUSY), inTranscript: qaCount(slashBand.transcriptText, R3.BUSY) }),
	);
	await take("07-u2-slash-door-retained-midstream");
	await awaitSettled(U2_SECOND);
	await replaceComposer("");
	await closePanel();

	// ---- S3 / Q20: D6 — a follow-up under a long answer is scrolled into view ---
	await replaceComposer("/btw LONGANSWER: d6 first, a long answer");
	await enter();
	await awaitSettled("d6 first, a long answer");
	await wait(300);
	const longSettled = await r3Read(cdp);
	note("Q20 geometry after the long first answer settled", JSON.stringify(longSettled.geo));
	await take("08-d6-long-first-answer-settled", "settled");
	const D6Q = "d6 follow-up asked under a long answer";
	await clickAt(cdp, R3.FIELD);
	await type(D6Q);
	const beforeAppend = await r3Read(cdp);
	await enter();
	const samples = [];
	const t0 = Date.now();
	let appended = null;
	for (let i = 0; i < 200; i++) {
		const r = await r3Read(cdp);
		if (r.geo && r.geo.questionText && r.geo.questionText.includes(D6Q)) {
			samples.push({ ms: Date.now() - t0, ...r.geo });
			if (appended === null && samples.length >= 3) appended = r.geo;
		}
		const b = await band();
		if (qaAnswerOf(b.panelText, D6Q).includes(R3.TAIL)) break;
		await wait(40);
	}
	const first = samples[0] ?? null;
	const expected = first ? Math.min(first.maxScroll, Math.max(0, first.lastTurnContentOffset)) : null;
	note("Q20 scroll samples after the append (ms, scrollTop, maxScroll, turn offset, question top/bottom in region, visible)",
		JSON.stringify(samples.map((s) => [s.ms, s.scrollTop, s.maxScroll, s.lastTurnContentOffset, s.questionTopInRegion, s.questionBottomInRegion, s.questionFullyVisible])));
	r2check(
		"Q20a D6: before the append the region overflowed and rested at its top (the state the bug needs)",
		beforeAppend.geo !== null && beforeAppend.geo.scrollHeight > beforeAppend.geo.clientHeight + 1 && beforeAppend.geo.scrollTop === 0,
		JSON.stringify(beforeAppend.geo),
	);
	r2check(
		"Q20b D6: on the append the region scrolled to the new turn — scrollTop == min(maxScroll, turn offset), question fully visible",
		first !== null && Math.abs(first.scrollTop - expected) <= 1 && first.scrollTop > 0 && first.questionFullyVisible === true,
		JSON.stringify({ first, expectedScrollTop: expected }),
	);
	const tops = [...new Set(samples.map((s) => s.scrollTop))];
	r2check(
		"Q20c D6: ONE scroll per append — scrollTop does not follow the chunks while the follow-up streams",
		tops.length === 1,
		`distinct scrollTop values while streaming: ${JSON.stringify(tops)}; samples ${samples.length}`,
	);
	await take("09-d6-after-append-turn-in-view");
	await awaitSettled(D6Q);
	const d6settled = await r3Read(cdp);
	note("Q20 geometry after the follow-up settled", JSON.stringify(d6settled.geo));
	await take("10-d6-follow-up-settled", "settled");
	await closePanel();

	// ---- S4 / Q21: the composer's staged payload across an aside ask ------------
	const QUOTE_A = "Transport failures and owner";
	const qa = await r3StageQuote(cdp, QUOTE_A);
	await r3PasteImage(cdp, "qa3-d1.png");
	const staged = await r3Read(cdp);
	note("Q21 staged", JSON.stringify({ quote: qa, replies: staged.replies, attachments: staged.attachments }));
	await replaceComposer("/btw");
	await enter();
	await awaitBand((b) => b.panel !== null, 60);
	const D1 = "d1 ask with a file staged";
	await clickAt(cdp, R3.FIELD);
	await type(D1);
	await enter();
	await wait(500);
	const d1 = await r3Read(cdp);
	r2check(
		"Q21a an aside ask with a FILE chip is refused before it leaves: text, quote and file chip all kept, reason stated",
		d1.value === D1 && d1.replies.length === 1 && d1.attachments === 1 && d1.bandLines.some((l) => l.includes(R3.FILES)) && r3posts(D1).length === 0,
		JSON.stringify({ value: d1.value, replies: d1.replies, attachments: d1.attachments, band: d1.bandLines }),
	);
	await take("11-d-file-chip-refused-locally-all-kept");
	await r3RemoveAll(cdp, "Remove attachment");
	await clickAt(cdp, R3.FIELD);
	await enter();
	const d2think = await r3AwaitRead(cdp, (r) => r.value === "", 30, 30);
	const d2thinkBand = await band();
	r2check(
		"Q21b the ask leaves with the quote: the box empties at the press but the QUOTE chip stays while the answer is pending",
		d2think.value === "" && d2think.replies.length === 1 && d2thinkBand.panelThinking === true,
		JSON.stringify({ value: d2think.value, replies: d2think.replies, thinking: d2thinkBand.panelThinking }),
	);
	await take("12-d-quote-kept-while-answer-pending");
	const QUOTE_B = "per provider";
	const qb = await r3StageQuote(cdp, QUOTE_B);
	await r3PasteImage(cdp, "qa3-during-flight.png");
	const during = await r3Read(cdp);
	note("Q21 staged DURING the flight", JSON.stringify({ quote: qb, replies: during.replies, attachments: during.attachments }));
	const d2tail = await awaitBand((b) => qaAnswerOf(b.panelText, D1).includes(R3.TAIL), 300);
	const d2tailRead = await r3Read(cdp);
	note("Q21 when the answer text is complete but the POST has not settled", JSON.stringify({ announce: d2tail.panelAnnounce, replies: d2tailRead.replies }));
	await awaitSettled(D1);
	await wait(200);
	const d2done = await r3Read(cdp);
	const d2post = r3posts(D1)[0] ?? null;
	r2check(
		"Q21c wire: the aside POST carried the staged quote as a <reply-to> prefix and was answered",
		d2post !== null && d2post.status === 200 && (d2post.text ?? "").includes(`<reply-to>${QUOTE_A}</reply-to>`),
		JSON.stringify(d2post && { status: d2post.status, text: d2post.text }),
	);
	r2check(
		"Q21d ANSWERED: the quote the ask carried is cleared; the quote and file staged during the flight are KEPT",
		d2done.replies.length === 1 && d2done.replies[0] !== QUOTE_A && d2done.replies[0].includes(QUOTE_B) && d2done.attachments === 1,
		JSON.stringify({ replies: d2done.replies, attachments: d2done.attachments }),
	);
	await take("13-d-answered-carried-quote-cleared-new-ones-kept", "settled");
	await r3RemoveAll(cdp, "Remove attachment");
	const D3 = "TOOLCALL2: d3 refused with a quote staged";
	await clickAt(cdp, R3.FIELD);
	await type(D3);
	await enter();
	await awaitSettled("d3 refused with a quote staged");
	await wait(300);
	const d3r = await r3Read(cdp);
	const d3post = r3posts("d3 refused with a quote staged")[0] ?? null;
	r2check(
		"Q21e REFUSED (409): the quote the ask carried is KEPT in the composer",
		d3post?.status === 409 && d3r.replies.length === 1 && d3r.replies[0].includes(QUOTE_B),
		JSON.stringify({ wire: d3post && { status: d3post.status, text: d3post.text }, replies: d3r.replies, alerts: d3r.alerts }),
	);
	await take("14-d-refused-quote-kept");
	await r3RemoveAll(cdp, "Remove reply");
	await replaceComposer("");
	await closePanel();

	// ---- S5 / Q22: #479 beside the aside ----------------------------------------
	await idle();
	const QUOTE_C = "moving window";
	const qc = await r3StageQuote(cdp, QUOTE_C);
	await r3PasteImage(cdp, "qa3-thread.png");
	const HOLD = "HOLDSEND e thread message carrying a quote and a file";
	await clickAt(cdp, R3.FIELD);
	await type(HOLD);
	const pre = await r3Read(cdp);
	note("Q22 before the press", JSON.stringify({ quote: qc, value: pre.value, replies: pre.replies, attachments: pre.attachments, placeholder: pre.placeholder, send: pre.sendLabel }));
	await r3ArmFrameSampler(cdp, "HOLDSEND e thread message");
	await enter();
	await wait(1200);
	const trace = await r3ReadFrameSampler(cdp);
	note("Q22 per-animation-frame trace after the press [t ms, value length, replies, attachments, echo rows, placeholder]", JSON.stringify(trace.frames.slice(0, 40)));
	note("Q22 per-mutation trace (every DOM change, not only painted frames) [t, value, replies, attachments, echo]", JSON.stringify(trace.mutations.slice(0, 40)));
	const split = r3Split(trace.frames);
	r2check(
		"Q22a #479: in every PAINTED frame the text and the chips are both present or both gone (one moment)",
		split.length === 0 && trace.frames.some((f) => f[1] === 0 && f[2] + f[3] === 0 && f[4] > 0),
		JSON.stringify({ splitFrames: split }),
	);
	const inflight = await r3Read(cdp);
	r2check(
		"Q22b #479: while the message is held in flight the empty box says 'Sending your message'; Send is named 'Send message'",
		inflight.placeholder === R3.PH_SENDING && inflight.sendLabel === "Send message",
		JSON.stringify({ placeholder: inflight.placeholder, send: inflight.sendLabel, heldPosts: r3msgs("HOLDSEND").map((m) => ({ held: m.held, forwardedAt: m.forwardedAt ?? null })) }),
	);
	await take("15-e-thread-send-in-flight-sending-placeholder");
	// the aside, asked while that message is in flight — slash door
	const E_ASIDE = "e aside asked while a message is in flight";
	await type(`/btw ${E_ASIDE}`);
	await enter();
	const eUp = await r3AwaitRead(cdp, (r) => r.panelUp, 40);
	r2check(
		"Q22c with the message still in flight, `/btw <q>` attaches the panel; the box names the aside, not 'Sending'; Send is 'Ask the aside'",
		eUp.panelUp && eUp.placeholder === R3.PH_ASIDE && eUp.sendLabel === "Ask the aside" && eUp.value === "" && (r3msgs("HOLDSEND")[0]?.forwardedAt ?? null) === null,
		JSON.stringify({ placeholder: eUp.placeholder, send: eUp.sendLabel, value: eUp.value, messageForwarded: r3msgs("HOLDSEND")[0]?.forwardedAt ?? null }),
	);
	await awaitSettled(E_ASIDE);
	const eDone = await band();
	const ePost = r3posts(E_ASIDE)[0] ?? null;
	r2check(
		"Q22d the aside asked during the flight is answered (200) while the message is STILL held",
		qaAnswerOf(eDone.panelText, E_ASIDE).includes(R3.TAIL) && ePost?.status === 200 && (r3msgs("HOLDSEND")[0]?.forwardedAt ?? null) === null,
		JSON.stringify({ wire: ePost && { status: ePost.status }, messageForwarded: r3msgs("HOLDSEND")[0]?.forwardedAt ?? null, alert: eDone.panelAlert }),
	);
	await take("16-e-aside-answered-while-message-in-flight", "settled");
	// the composer door while the thread send is still in flight
	const E_COMP = "e composer-door question during the flight";
	await clickAt(cdp, R3.FIELD);
	await type(E_COMP);
	await enter();
	await wait(1500);
	const eComp = await r3Read(cdp);
	const eCompBand = await band();
	const eCompPost = r3posts(E_COMP)[0] ?? null;
	note("Q22e composer door during the flight (observation)", JSON.stringify({
		value: eComp.value, sendLabel: eComp.sendLabel, sendDisabled: eComp.sendDisabled, onPanel: qaCount(eCompBand.panelText, E_COMP), post: eCompPost && { status: eCompPost.status },
		band: eComp.bandLines, placeholder: eComp.placeholder, messageForwarded: r3msgs("HOLDSEND")[0]?.forwardedAt ?? null,
	}));
	r2check(
		"Q22e composer-door ask while a thread message is in flight: the text is not lost (asked, or kept in the box)",
		eComp.value === E_COMP || (eCompPost !== null && qaCount(eCompBand.panelText, E_COMP) > 0),
		JSON.stringify({ value: eComp.value, posted: eCompPost !== null }),
	);
	await take("17-e-composer-door-during-flight");
	// Wait for the hold to release and see where the composer-door text ends up.
	const released = await r3AwaitRead(cdp, () => (r3msgs("HOLDSEND")[0]?.forwardedAt ?? null) !== null, 200);
	await wait(2500);
	const eAfter = await r3Read(cdp);
	const eAfterBand = await band();
	const eCompPost2 = r3posts(E_COMP)[0] ?? null;
	note("Q22f after the held message was forwarded", JSON.stringify({
		value: eAfter.value, onPanel: qaCount(eAfterBand.panelText, E_COMP), post: eCompPost2 && { status: eCompPost2.status },
		placeholder: eAfter.placeholder, band: eAfter.bandLines, message: r3msgs("HOLDSEND")[0],
	}));
	const holdMsg = r3msgs("HOLDSEND")[0] ?? null;
	r2check(
		"Q22g wire: the held thread message carried the quote prefix and the image (what the chips staged)",
		holdMsg !== null && (holdMsg.text ?? "").includes(`<reply-to>${QUOTE_C}</reply-to>`) && holdMsg.images === 1,
		JSON.stringify(holdMsg && { text: holdMsg.text, images: holdMsg.images, status: holdMsg.status }),
	);
	await take("18-e-after-release");
	await clickAt(cdp, R3.FIELD);
	await enter();
	await awaitSettled(E_COMP);
	const eAgain = await band();
	const eAgainPost = r3posts(E_COMP)[0] ?? null;
	r2check(
		"Q22h once the thread message has settled, the same Enter on the kept text asks the aside and is answered",
		eAgainPost?.status === 200 && qaAnswerOf(eAgain.panelText, E_COMP).includes(R3.TAIL),
		JSON.stringify({ wire: eAgainPost && { status: eAgainPost.status } }),
	);
	await take("19-e-composer-door-after-release-answered", "settled");
	await replaceComposer("");
	await closePanel();
	const phAfter = await r3Read(cdp);
	note("Q22 placeholder after Esc", JSON.stringify({ placeholder: phAfter.placeholder, send: phAfter.sendLabel }));
	await idle();
	r2FramesCheck(frames);
	return { tree: "qa3", frames };
}
