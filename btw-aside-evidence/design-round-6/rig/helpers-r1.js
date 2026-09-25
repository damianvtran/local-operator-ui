
/* ===================================================================== *
 *                     QA ROUND 1 (independent) — the /btw aside
 *
 * A SECOND scene rather than an edit of `btw-aside`, because this pass exists to
 * DRIVE what the first one could only photograph: the adopt actually executed,
 * the refusal while the session is streaming, and the panel's stream read at two
 * different text lengths. It is the same app, the same rig and the same built
 * bundle; only the instrument is new.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: it never touches the app's source, never
 * re-implements a product judgement, and reads the panel's text, its buttons and
 * its alert as the app paints them.
 * ===================================================================== */

/** One reading of the aside band, the composer and the transcript, as painted. */
function readQaBand(cdp) {
	return cdp.evaluate(`(() => {
		const box = (el) => {
			if (!el) return null;
			const r = el.getBoundingClientRect();
			return {
				x: Math.round(r.x), y: Math.round(r.y),
				right: Math.round(r.right), bottom: Math.round(r.bottom),
				w: Math.round(r.width), h: Math.round(r.height),
			};
		};
		const flat = (el) =>
			el ? el.textContent.replace(/\\s+/g, " ").trim() : null;
		const panel = document.querySelector("[data-lo-aside-panel]");
		const field = document.querySelector('textarea[aria-label="Message"]');
		const send = document.querySelector('button[type="submit"][aria-label="Send message"], button[type="submit"][aria-label="Ask the aside"]');
		const stop = document.querySelector('button[aria-label="Stop agent"]');
		const content = document.querySelector("[data-lo-transcript-content]");
		const root = document.querySelector("[data-lo-canonical-transcript]");
		return {
			panel: box(panel),
			panelText: flat(panel),
			panelButtons: panel
				? Array.from(panel.querySelectorAll("button")).map((b) => ({
						text: b.textContent.replace(/\\s+/g, " ").trim(),
						label: b.getAttribute("aria-label"),
						disabled: b.disabled,
					}))
				: null,
			panelAlert: panel ? flat(panel.querySelector('[role="alert"]')) : null,
			/*
			 * THE EXCHANGE REGION'S OWN GEOMETRY, because a still of a capped block
			 * shows the symptom and these numbers show the cause: the cap, the box it
			 * caps, and the streaming answer's OWN line box - so "the last visible row
			 * is a whole line" is checkable as cap / line-height being an integer
			 * rather than as a judgement about the pixels.
			 */
			exchange: (() => {
				if (!panel) return null;
				const region = Array.from(panel.children).find(
					(node) => node.style && node.style.maxHeight !== "",
				);
				if (!region) return null;
				/*
				 * THE ANSWER'S OWN LINE BOXES, from a Range over its text rather than
				 * from a computed style: what the cap has to divide into is the box the
				 * BROWSER lays the text out in, and the last one's visible fraction is
				 * what "the cap cuts through a line" means as a number (design round 1's
				 * D1). A whole-line cap leaves the last visible line entirely inside the
				 * clip, or a whole number of lines visible.
				 */
				const answer = region.querySelector('[style*="line-height"]');
				const rects = [];
				if (answer) {
					const walk = document.createTreeWalker(answer, NodeFilter.SHOW_TEXT);
					let node = walk.nextNode();
					while (node) {
						if (node.nodeValue && node.nodeValue.trim()) {
							const range = document.createRange();
							range.selectNodeContents(node);
							for (const rect of range.getClientRects())
								rects.push({ top: rect.top, bottom: rect.bottom, height: rect.height });
						}
						node = walk.nextNode();
					}
				}
				const clip = region.getBoundingClientRect();
				const last = rects.length ? rects[rects.length - 1] : null;
				const style = answer ? getComputedStyle(answer) : null;
				return {
					cap: getComputedStyle(region).maxHeight,
					answerFontSize: style ? style.fontSize : null,
					answerLineHeight: style ? style.lineHeight : null,
					lines: rects.length,
					lineHeights: [...new Set(rects.map((r) => Math.round(r.height * 10) / 10))],
					fullyVisibleLines: rects.filter((r) => r.bottom <= clip.bottom + 0.5).length,
					clippedLastLineFraction: last
						? Math.round(
								(Math.max(0, Math.min(last.bottom, clip.bottom) - last.top) /
									last.height) *
									1000,
							) / 1000
						: null,
					boxHeight: Math.round(region.clientHeight),
					contentHeight: Math.round(region.scrollHeight),
					overflowing: region.scrollHeight > region.clientHeight + 1,
				};
			})(),
			panelAnnounce: panel ? flat(panel.querySelector("output")) : null,
			panelThinking: panel ? panel.textContent.includes("thinking…") : null,
			fieldValue: field ? field.value : null,
			activeIsField: document.activeElement === field,
			active: document.activeElement
				? document.activeElement.tagName.toLowerCase() +
					(document.activeElement.getAttribute("aria-label")
						? "[" + document.activeElement.getAttribute("aria-label") + "]"
						: "")
				: null,
			send: send
				? { present: true, disabled: send.disabled }
				: { present: false, disabled: null },
			/*
			 * WHAT THE COMPOSER BAND IS SAYING, which is where this app reports a
			 * refusal ("Still sending your last message. Your message was not sent -
			 * send it again in a moment."). Read from the band and NOT from the
			 * textarea, so a refusal the user sees is visible to this scene too: a
			 * press that produced nothing is otherwise indistinguishable from a press
			 * that never landed.
			 */
			bandNotice: (() => {
				const band = document.querySelector("[data-lo-composer-band]");
				if (!band) return null;
				const copy = Array.from(band.querySelectorAll("p, [role=alert]")).filter((n) => !n.closest("[data-lo-aside-panel]") && !(n.parentElement && n.parentElement.closest("p, [role=alert]") && band.contains(n.parentElement.closest("p, [role=alert]"))))
					.map((n) => n.textContent.replace(/\\s+/g, " ").trim())
					.filter((line) => line.length > 0);
				return copy.length === 0 ? null : copy.join(" | ");
			})(),
			stop: stop !== null,
			transcriptText: flat(content),
			transcriptStreaming: root
				? root.querySelector("[data-lo-streaming]") !== null
				: null,
			transcriptWorking: root
				? root.querySelector("[data-lo-working-line]") !== null
				: null,
			transcriptChildren: content ? content.children.length : null,
		};
	})()`);
}

/** Poll a reader until its predicate holds, so a scene waits on the app. */
async function qaAwaitPanel(cdp, want, attempts = 80) {
	let band = await readQaBand(cdp);
	for (let attempt = 0; attempt < attempts; attempt++) {
		if (want(band)) return band;
		await wait(100);
		band = await readQaBand(cdp);
	}
	return band;
}

/** The panel's own adopt control, with its box and its disabled state. */
function qaAdoptControl(cdp) {
	return cdp.evaluate(`(() => {
		const panel = document.querySelector("[data-lo-aside-panel]");
		if (!panel) return null;
		const b = Array.from(panel.querySelectorAll("button")).find(
			(n) => n.textContent.trim() === "Add to conversation",
		);
		if (!b) return null;
		const r = b.getBoundingClientRect();
		return {
			x: Math.round(r.x + r.width / 2),
			y: Math.round(r.y + r.height / 2),
			disabled: b.disabled,
		};
	})()`);
}

/** A real press at a point, through Chromium's input pipeline. */
async function qaPressPoint(cdp, point) {
	await cdp.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		x: point.x,
		y: point.y,
		button: "none",
		buttons: 0,
	});
	await cdp.send("Input.dispatchMouseEvent", {
		type: "mousePressed",
		x: point.x,
		y: point.y,
		button: "left",
		buttons: 1,
		clickCount: 1,
	});
	await cdp.send("Input.dispatchMouseEvent", {
		type: "mouseReleased",
		x: point.x,
		y: point.y,
		button: "left",
		buttons: 0,
		clickCount: 1,
	});
	return point;
}

/**
 * The answer's own text, cut out of the panel's flattened text.
 *
 * The panel paints, in order: the title, the contract sentence, the close
 * control, the exchange (one question line then the answer, per turn), then the
 * adopt control and any refusal sentence. So the answer of the LAST turn is what
 * follows the last question and precedes the adopt control's label — read that way
 * rather than by a class name, because the class is not part of the contract.
 */
function qaAnswerOf(panelText, question) {
	if (panelText === null) return "";
	const at = panelText.lastIndexOf(question);
	if (at === -1) return "";
	const rest = panelText.slice(at + question.length);
	const end = rest.indexOf("Add to conversation");
	const turn = (end === -1 ? rest : rest.slice(0, end)).trim();
	/*
	 * The thinking line sits in the same slot as the answer, so it is stripped
	 * rather than counted: a length of 9 taken from it would read as "the answer
	 * grew" in a state where no answer has arrived yet, which is exactly the claim
	 * this scene must not make by accident.
	 */
	return turn.startsWith("thinking…")
		? turn.slice("thinking…".length).trim()
		: turn;
}

/** How many times `needle` occurs in `haystack`. */
function qaCount(haystack, needle) {
	if (haystack === null || haystack === undefined) return 0;
	let count = 0;
	let from = 0;
	for (;;) {
		const at = haystack.indexOf(needle, from);
		if (at === -1) return count;
		count += 1;
		from = at + 1;
	}
}

/** The session's own message list, from the daemon the app is talking to. */
async function qaSessionHistory(sessionId) {
	const response = await fetch(
		`${BACKEND}/v1/desktop/sessions/${sessionId}/history?limit=500`,
		{
			headers: {
				authorization: `Bearer ${process.env.LOCAL_OPERATOR_DESKTOP_TOKEN}`,
			},
		},
	).catch(() => null);
	if (!response) return { status: null, body: null };
	const body = await response.json().catch(() => null);
	return { status: response.status, body };
}

/** Submit a turn to the session the way the app's own `sessions.message` does. */
async function qaSubmitTurn(sessionId, text) {
	const response = await fetch(
		`${BACKEND}/v1/desktop/sessions/${sessionId}/messages`,
		{
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${process.env.LOCAL_OPERATOR_DESKTOP_TOKEN}`,
			},
			body: JSON.stringify({
				request_id: randomUUID(),
				text,
				images: [],
				mode: "prompt",
			}),
		},
	).catch(() => null);
	if (!response) return { status: null, body: null };
	const body = await response.json().catch(() => null);
	return { status: response.status, body };
}

/** Bring the session's owner up, the way the renderer's own warm does. */
async function qaWarmSession(sessionId) {
	await fetch(`${BACKEND}/v1/desktop/sessions/${sessionId}/warm`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${process.env.LOCAL_OPERATOR_DESKTOP_TOKEN}`,
		},
		body: "{}",
	}).catch(() => null);
	for (let attempt = 0; attempt < 120; attempt++) {
		const response = await fetch(`${BACKEND}/v1/desktop/sessions/${sessionId}`, {
			headers: {
				authorization: `Bearer ${process.env.LOCAL_OPERATOR_DESKTOP_TOKEN}`,
			},
		}).catch(() => null);
		const body = response ? await response.json().catch(() => null) : null;
		if (body && JSON.stringify(body).includes('"cold":false')) return true;
		await wait(500);
	}
	return false;
}

/** The session-on-this-run's-own-backend opening the scene's other states share. */
async function qaOpenSession(cdp) {
	await verb(cdp, "navigate", "/chat");
	await verb(cdp, "setTheme", "localOperatorDark");
	const workspace = join(SCRATCH, "btw-qa-workspace");
	mkdirSync(workspace, { recursive: true });
	const created = await createBackendSession(workspace);
	if (!created.id) {
		throw new Error(
			`no session on the backend (${JSON.stringify(created.body)}): this scene needs --backend and --backend-records`,
		);
	}
	await verb(cdp, "navigate", `/chat/${created.id}`);
	for (let attempt = 0; attempt < 80; attempt++) {
		const present = await cdp.evaluate(
			'document.querySelector(\'textarea[aria-label="Message"]\') !== null',
		);
		if (present) break;
		await wait(100);
	}
	const rested = await readQaBand(cdp);
	check(
		"the composer is on screen before anything is typed",
		rested.fieldValue !== null,
		JSON.stringify({ fieldValue: rested.fieldValue }),
	);
	const warmed = await qaWarmSession(created.id);
	note(
		"the session's owner",
		warmed ? "warm (snapshot.cold = false)" : "NEVER WARMED",
	);
	return { sessionId: created.id, rested };
}

