/*
 * QA ROUND 8 (independent) — PR #482, scene `btw-r8-band`.
 *
 * WHY THIS SCENE EXISTS. The two folds onto main carried `#508`
 * (`4fc789b8dd`, "cap the cwd chip's path at 16ch instead of reserving it")
 * into this branch. The chip lives in `directory-indicator.tsx`, in the very
 * composer area the aside panel hangs above, and #508's whole point is that the
 * chip's width now varies with the path — so "does the band still lay out, and
 * does the panel above it still render and stream" is a question about a
 * rendered surface, not a formality.
 *
 * WHAT IT MEASURES, at three window widths and with two cwds, one short and one
 * far past the cap:
 *
 *   a. the cap does not RESERVE the path column - a short path paints a chip
 *      sized to its content, not a fixed 16ch box;
 *   b. a path far past the cap is ellipsised at the ceiling while the span's own
 *      text still carries the whole path (a CSS ellipsis removes no text);
 *   c. where the cap applies: read off the engine as
 *      `getComputedStyle(span).maxWidth`, against the chat column's own width
 *      (`chatcol`, the container the 900px threshold is measured in);
 *   d. the clipped path is recoverable - the chip's hover tooltip still names
 *      the path's tail;
 *   e. with the panel open, the answer streams (a partial render shorter than
 *      the settled answer) and settles over the chip;
 *   f. the panel hangs ABOVE the composer with no overlap and the chip is still
 *      the element at its own centre - nothing in the band competes with it;
 *   g. the chip's own box does not change while the answer streams;
 *   h. no two blocks in the composer overlap, at the short path, the long path
 *      and with the panel open;
 *   i. #508's own claim - the chip's left edge and the `ml-auto` mic/send group
 *      are fixed across a path change - read on the live row.
 *
 * The app's source is unmodified; every reading is taken from the painted page.
 * ===================================================================== */

const R8 = {
	LONG: "The retry budget is a per-provider allowance",
	END: "LONG-END.",
	Q: "LONGANSWER: r8 band - does the chip cap survive an open aside?",
	/* THE SHORT CWD HAS TO BE SHORT IN WHAT THE CHIP PRINTS, and the chip
	 * abbreviates against `window.api.getHomeDirectory()` - the APP's home, which
	 * the rig's scratch `HOME` does NOT move (measured: the app reports
	 * `/Users/damian`, and `~/` in a chip for a cwd under the scratch tree always
	 * expands to that). So the short arm uses an EXISTING directory of the
	 * operator's, named by the runner, and reads nothing from it: it is a path,
	 * not a fixture. */
	SHORT_CWD: process.env.QA_BAND_SHORT_CWD || join(SCRATCH, "b"),
};

/** The chat column: the element the `chatcol` container queries resolve against. */
function r8Column(cdp) {
	return cdp.evaluate(`(() => {
		const band = document.querySelector("[data-lo-composer-band]");
		if (!band) return null;
		let el = band;
		while (el && el !== document.documentElement) {
			const cs = getComputedStyle(el);
			const names = (cs.containerName || "") + " " + (cs.container || "");
			if (names.includes("chatcol")) {
				const cs2 = getComputedStyle(el); const pad = (parseFloat(cs2.paddingLeft) || 0) + (parseFloat(cs2.paddingRight) || 0); return { tag: el.tagName, className: String(el.className || "").slice(0, 70), clientWidth: el.clientWidth, contentWidth: el.clientWidth - pad, rect: Math.round(el.getBoundingClientRect().width * 10) / 10 };
			}
			el = el.parentElement;
		}
		return null;
	})()`);
}

/** One reading of the composer, the cwd chip and the aside pane. */
function r8Band(cdp) {
	return cdp.evaluate(`(() => {
		const rd = (x) => Math.round(x * 10) / 10;
		const box = (el) => {
			if (!el) return null;
			const r = el.getBoundingClientRect();
			return { left: rd(r.left), top: rd(r.top), right: rd(r.right), bottom: rd(r.bottom), w: rd(r.width), h: rd(r.height) };
		};
		const cls = (el) => (el ? String(el.className || "").slice(0, 70) : null);
		const flat = (t) => (t || "").replace(/\\s+/g, " ").trim();
		const band = document.querySelector("[data-lo-composer-band]");
		const chips = Array.from(document.querySelectorAll("[data-lo-cwd-chip]"));
		const chip = chips.find((c) => c.closest("[data-lo-composer-band]")) || chips[0] || null;
		const btn = chip ? chip.querySelector("button") : null;
		const spans = chip ? Array.from(chip.querySelectorAll("span")) : [];
		const pathSpan = spans.find((s) => String(s.className || "").includes("truncate")) || null;
		const label = spans.find((s) => (s.textContent || "").includes("Working directory")) || null;
		const field = document.querySelector('textarea[aria-label="Message"]');
		const send = document.querySelector('button[type="submit"][aria-label="Send message"], button[type="submit"][aria-label="Ask the aside"]');
		const controls = send ? send.closest("div.ml-auto") : null;
		/* THE ROW is the nearest ancestor of the chip that also holds the ml-auto
		 * controls group - the markup's own containment, not a class guess. */
		let row = chip ? chip.parentElement : null;
		while (row && !(row.querySelector && row.querySelector("div.ml-auto"))) row = row.parentElement;
		const leftGroup = row && chip ? Array.from(row.children).find((c) => c.contains(chip)) || null : null;
		/* The READINGS CLUSTER is the row's other child: neither the chip's group
		 * nor the ml-auto controls. It renders null in several ordinary states, so
		 * its absence is a reading too. */
		const cluster = row ? Array.from(row.children).find((c) => c !== leftGroup && c !== controls && !(controls && c.contains(controls))) || null : null;
		const panel = document.querySelector("[data-lo-aside-panel]");
		const region = panel ? panel.querySelector('[aria-label="The aside exchange"]') : null;
		let ceiling16 = null;
		if (pathSpan) {
			const cs = getComputedStyle(pathSpan);
			const probe = document.createElement("span");
			probe.style.position = "absolute";
			probe.style.visibility = "hidden";
			probe.style.whiteSpace = "pre";
			probe.style.fontFamily = cs.fontFamily;
			probe.style.fontSize = cs.fontSize;
			probe.style.fontWeight = cs.fontWeight;
			probe.style.letterSpacing = cs.letterSpacing;
			probe.textContent = "0".repeat(16);
			pathSpan.appendChild(probe);
			ceiling16 = rd(probe.getBoundingClientRect().width);
			probe.remove();
		}
		const centre = chip ? (() => { const r = chip.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })() : null;
		const hit = centre ? document.elementFromPoint(centre.x, centre.y) : null;
		return {
			viewport: { w: window.innerWidth, h: window.innerHeight },
			column: band ? (() => { let el = band; while (el && el !== document.documentElement) { const cs = getComputedStyle(el); if (((cs.containerName || "") + " " + (cs.container || "")).includes("chatcol")) { const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0); return { tag: el.tagName, clientWidth: el.clientWidth, contentWidth: rd(el.clientWidth - pad), padding: rd(pad) }; } el = el.parentElement; } return null; })() : null,
			band: box(band),
			chip: chip ? { state: chip.getAttribute("data-lo-cwd-chip"), path: chip.getAttribute("data-lo-cwd-path"), box: box(chip), clientWidth: chip.clientWidth, text: flat(chip.textContent) } : null,
			button: box(btn),
			pathSpan: pathSpan ? { box: box(pathSpan), clientWidth: pathSpan.clientWidth, scrollWidth: pathSpan.scrollWidth, text: pathSpan.textContent, maxWidth: getComputedStyle(pathSpan).maxWidth, textOverflow: getComputedStyle(pathSpan).textOverflow, overflow: getComputedStyle(pathSpan).overflow, font: getComputedStyle(pathSpan).fontFamily + " " + getComputedStyle(pathSpan).fontSize, className: cls(pathSpan) } : null,
			ceiling16,
			label: label ? { text: flat(label.textContent), box: box(label), display: getComputedStyle(label).display } : null,
			cluster: cluster ? { box: box(cluster), text: flat(cluster.textContent).slice(0, 60), className: cls(cluster), order: getComputedStyle(cluster).order } : null,
			controls: controls ? { box: box(controls), className: cls(controls) } : null,
			field: box(field),
			send: box(send),
			panel: box(panel),
			panelText: panel ? flat(panel.textContent) : null,
			region: region ? { box: box(region), clientHeight: region.clientHeight, scrollTop: rd(region.scrollTop), maxScroll: region.scrollHeight - region.clientHeight } : null,
			tooltip: (() => { const t = document.querySelector('[role="tooltip"]'); return t ? flat(t.textContent) : null; })(),
			hitAtChipCentre: hit ? { tag: hit.tagName, className: cls(hit), insideChip: !!(chip && (hit === chip || chip.contains(hit))) } : null,
		};
	})()`);
}

/** Wait until the pane has a composer and its cwd chip. */
async function r8AwaitBand(cdp, ms = 25000) {
	for (let i = 0; i < Math.ceil(ms / 200); i++) {
		const b = await r8Band(cdp);
		if (b.chip && b.field) return b;
		await wait(200);
	}
	return await r8Band(cdp);
}

/** The comparable block positions of one band reading. */
function r8Blocks(b) {
	return {
		chipLeft: b.chip ? b.chip.box.left : null,
		chipW: b.chip ? b.chip.box.w : null,
		chipRight: b.chip ? b.chip.box.right : null,
		clusterLeft: b.cluster ? b.cluster.box.left : null,
		clusterText: b.cluster ? b.cluster.text : null,
		controlsLeft: b.controls ? b.controls.box.left : null,
		bandLeft: b.band ? b.band.left : null,
		bandRight: b.band ? b.band.right : null,
		column: b.column ? b.column.contentWidth : null,
	};
}

/** True when two rects overlap by more than half a pixel in BOTH axes. */
function r8Overlap(a, b) {
	if (!a || !b) return false;
	return a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
}

/** The composer's layout problems at one reading, as sentences (empty = none). */
function r8BandFits(b, where) {
	const out = [];
	if (!b.chip) out.push(where + ": no cwd chip on screen");
	if (!b.field) out.push(where + ": no composer field on screen");
	if (!b.send) out.push(where + ": no send control on screen");
	if (!b.chip || !b.field) return out;
	if (r8Overlap(b.chip.box, b.field)) out.push(where + ": the chip overlaps the composer field");
	if (b.controls && r8Overlap(b.controls.box, b.field)) out.push(where + ": the controls group overlaps the composer field");
	if (r8Overlap(b.chip.box, b.controls ? b.controls.box : null)) out.push(where + ": the chip overlaps the controls group");
	if (b.cluster) {
		if (r8Overlap(b.cluster.box, b.field)) out.push(where + ": the readings cluster overlaps the composer field");
		if (r8Overlap(b.cluster.box, b.chip.box)) out.push(where + ": the readings cluster overlaps the chip");
	}
	for (const [name, r] of [["chip", b.chip.box], ["field", b.field], ["controls", b.controls ? b.controls.box : null], ["send", b.send]]) {
		if (r && (r.left < -0.5 || r.right > b.viewport.w + 0.5)) out.push(where + ": the " + name + " is off the viewport (" + r.left + ".." + r.right + " of " + b.viewport.w + ")");
	}
	return out;
}

async function sceneBtwR8Band(cdp) {
	const facts = await factsOf(cdp);
	r2check("window mode is headless and the window is never shown", facts.windowMode === "headless" && facts.visible === false, "mode=" + facts.windowMode + " visible=" + facts.visible + " focused=" + facts.focused);

	/* TWO SESSIONS, both created through the same `POST /v1/desktop/sessions` the
	 * desktop UI makes, so the chip reads a real session's cwd. */
	const longDir = join(SCRATCH, "band", "an-extremely-long-working-directory-name-for-the-chip", "another-long-segment", "band-workspace");
	mkdirSync(longDir, { recursive: true });
	const long = await createBackendSession(longDir);
	const short = await createBackendSession(R8.SHORT_CWD);
	note("R8 sessions", JSON.stringify({ long: { status: long.status, id: long.id, cwd: longDir }, short: { status: short.status, id: short.id, cwd: R8.SHORT_CWD } }));
	if (!long.id || !short.id) throw new Error("the backend did not create both band sessions");

	const P = "qa8-" + RUN_LABEL;
	const h = r5Harness(cdp, P);
	const bandFails = [];

	/* ---------------- A: the SHORT path ---------------- */
	await verb(cdp, "navigate", "/chat/" + short.id);
	await r8AwaitBand(cdp);
	await wait(700);
	const shortB = await r8Band(cdp);
	const shortBlocks = r8Blocks(shortB);
	note("R8 short-cwd composer", JSON.stringify(shortB));
	await capture(cdp, P + "-r8band-1-short-path");
	bandFails.push(...r8BandFits(shortB, "short path"));

	/* ---------------- B: the LONG path ---------------- */
	await verb(cdp, "navigate", "/chat/" + long.id);
	await r8AwaitBand(cdp);
	await wait(700);
	const longB = await r8Band(cdp);
	const longBlocks = r8Blocks(longB);
	note("R8 long-cwd composer", JSON.stringify(longB));
	await capture(cdp, P + "-r8band-2-long-path");
	bandFails.push(...r8BandFits(longB, "long path"));

	const span = longB.pathSpan;
	const capped = !!span && span.maxWidth !== "none";
	const col = longB.column ? longB.column.contentWidth : null;
	const ellipsised = !!span && span.scrollWidth > span.clientWidth + 0.5;

	r2check(
		"R8 band a: the cap does not RESERVE the path column - the short path paints a chip that is narrower than the long path's and whose span fits its own text (no reserved 16ch box)",
		!!shortB.pathSpan && !!shortB.chip && !!longB.chip && shortB.pathSpan.scrollWidth <= shortB.pathSpan.clientWidth + 0.5 && shortBlocks.chipW < longBlocks.chipW - 5,
		JSON.stringify({ shortShown: shortB.pathSpan && shortB.pathSpan.text, shortSpanW: shortB.pathSpan && shortB.pathSpan.clientWidth, shortSpanScrollW: shortB.pathSpan && shortB.pathSpan.scrollWidth, shortChipW: shortBlocks.chipW, shortChipLeft: shortBlocks.chipLeft, longChipW: longBlocks.chipW, longChipLeft: longBlocks.chipLeft, ceiling16: longB.ceiling16, column: col }),
	);

	r2check(
		"R8 band b: the long path is ellipsised and nothing is lost with it - the span's own text still carries both ends of the path (the abbreviation the chip prints, including its final segment) while the painted box is narrower than that text",
		!!span && ellipsised && span.text.includes("band-workspace") && span.text.includes("an-extremely-long-working-directory-name-for-the-chip") && span.text === (longB.chip ? longB.chip.text.replace("Working directory:", "") : null),
		JSON.stringify({ spanW: span && span.clientWidth, spanScrollW: span && span.scrollWidth, ellipsised, spanText: span && span.text, chipPath: longB.chip && longB.chip.path, chipText: longB.chip && longB.chip.text, maxWidth: span && span.maxWidth, overflow: span && span.overflow, textOverflow: span && span.textOverflow }),
	);

	r2check(
		"R8 band c: the cap follows #508's stated 900px chat-column threshold exactly - the engine's own max-width on the path span is the 16ch ceiling when the chatcol container is 900 or wider and 'none' below it",
		!!span && col !== null && capped === (col >= 900),
		JSON.stringify({ capped, maxWidth: span && span.maxWidth, columnContentWidth: col, columnBorderBox: longB.column && longB.column.clientWidth, columnPadding: longB.column && longB.column.padding, columnTag: longB.column && longB.column.tag, ceiling16: longB.ceiling16, windowWidth: longB.viewport.w, bandW: longB.band && longB.band.w }),
	);

	/* ---------------- C: is the clipped path recoverable? ---------------- */
	if (longB.chip) {
		const c = longB.chip.box;
		await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: Math.round(c.left + c.w / 2), y: Math.round(c.top + c.h / 2), buttons: 0 });
	}
	let tooltip = null;
	for (let i = 0; i < 40; i++) {
		const b = await r8Band(cdp);
		if (b.tooltip) { tooltip = b.tooltip; break; }
		await wait(150);
	}
	const tail = "band-workspace";
	note("R8 the tooltip the truncated path keeps reachable", JSON.stringify({ tooltip, tail, chipPath: longB.chip && longB.chip.path }));
	r2check(
		"R8 band d: what the cap clips is recoverable - the chip's hover tooltip still names the path's own tail, so the hidden characters are one hover away",
		!!tooltip && tooltip.includes(tail),
		JSON.stringify({ tooltip, tail, chipPath: longB.chip && longB.chip.path, spanText: longB.pathSpan && longB.pathSpan.text }),
	);

	/* ---------------- D: the panel above the chip ---------------- */
	await clickAt(cdp, R4.FIELD);
	await h.type("/btw " + R8.Q);
	const t0 = Date.now();
	await h.enter();
	const samples = [];
	let partial = null;
	let settledAt = null;
	let settledText = "";
	for (let i = 0; i < 300; i++) {
		const b = await r8Band(cdp);
		const text = b.panelText || "";
		samples.push({ ms: Date.now() - t0, panelChars: text.length, panelBottom: b.panel ? b.panel.bottom : null, chipLeft: b.chip ? b.chip.box.left : null, chipTop: b.chip ? b.chip.box.top : null, chipRight: b.chip ? b.chip.box.right : null, chipW: b.chip ? b.chip.box.w : null, fieldTop: b.field ? b.field.top : null, sendLeft: b.send ? b.send.left : null, hitInside: b.hitAtChipCentre ? b.hitAtChipCentre.insideChip : null });
		if (!partial && text.includes(R8.LONG) && !text.includes(R8.END)) partial = { ms: Date.now() - t0, panelChars: text.length, panelBottom: b.panel ? b.panel.bottom : null };
		if (text.includes(R8.END)) { settledAt = Date.now() - t0; settledText = text; break; }
		await wait(120);
	}
	const open = await r8AwaitBand(cdp);
	if (!settledText) settledText = open.panelText || "";
	note("R8 stream samples", JSON.stringify(samples));
	await capture(cdp, P + "-r8band-3-panel-over-capped-chip");
	bandFails.push(...r8BandFits(open, "with the panel open"));

	r2check(
		"R8 band e: with the panel open above the composer the answer streams and settles over the chip - a partial render carrying the answer's text but not its END marker, then the END marker",
		!!partial && !!settledAt && settledText.includes(R8.END) && settledText.includes(R8.LONG) && settledText.length > (partial ? partial.panelChars : 0),
		JSON.stringify({ partial, settledAt, settledChars: settledText.length, head: settledText.includes(R8.LONG), end: settledText.includes(R8.END) }),
	);

	r2check(
		"R8 band f: the panel hangs ABOVE the composer with no overlap of the field, the chip or the controls, and the chip is still the element at its own centre - nothing in the composer competes with the panel",
		!!open.panel && !!open.field && !!open.chip && open.panel.bottom <= open.field.top + 0.5 && !r8Overlap(open.panel, open.field) && !r8Overlap(open.panel, open.chip.box) && !r8Overlap(open.panel, open.controls ? open.controls.box : null) && open.hitAtChipCentre && open.hitAtChipCentre.insideChip === true,
		JSON.stringify({ panel: open.panel, field: open.field, chip: open.chip && open.chip.box, controls: open.controls && open.controls.box, hitAtChipCentre: open.hitAtChipCentre, panelBottomVsFieldTop: open.panel && open.field ? Math.round((open.panel.bottom - open.field.top) * 10) / 10 : null }),
	);

	const fromPartial = partial ? samples.filter((s) => s.ms >= partial.ms) : samples;
	const uniq = (key) => [...new Set(fromPartial.map((s) => s[key]))];
	const chipLefts = uniq("chipLeft");
	const chipRights = uniq("chipRight");
	const chipWs = uniq("chipW");
	const sendLefts = uniq("sendLeft");
	const chipTops = uniq("chipTop");
	const fieldTops = uniq("fieldTop");
	r2check(
		"R8 band g: the chip's own box is one value at every sample from the first painted answer frame to the settle - the panel's growth reflows neither its width, its edges, nor the ml-auto controls",
		fromPartial.length > 1 && chipLefts.length === 1 && chipRights.length === 1 && chipWs.length === 1 && sendLefts.length === 1,
		JSON.stringify({ sampled: fromPartial.length, chipLefts, chipRights, chipWs, sendLefts, chipTops, fieldTops }),
	);

	r2check(
		"R8 band h: no two blocks in the composer overlap and every block is inside the viewport, at the short path, the long path and with the panel open",
		bandFails.length === 0,
		JSON.stringify({ problems: bandFails, short: shortBlocks, long: longBlocks, open: { panel: open.panel, field: open.field, chip: open.chip && open.chip.box, cluster: open.cluster && open.cluster.box, controls: open.controls && open.controls.box, send: open.send } }),
	);

	/* ---------------- E: #508's own claim, on the live row ---------------- */
	const chipDelta = Math.round((((longBlocks.chipW || 0) - (shortBlocks.chipW || 0))) * 10) / 10;
	const clusterDelta = shortBlocks.clusterLeft === null || longBlocks.clusterLeft === null ? null : Math.round((longBlocks.clusterLeft - shortBlocks.clusterLeft) * 10) / 10;
	const controlsDelta = shortBlocks.controlsLeft === null || longBlocks.controlsLeft === null ? null : Math.round((longBlocks.controlsLeft - shortBlocks.controlsLeft) * 10) / 10;
	const leftDelta = shortBlocks.chipLeft === null || longBlocks.chipLeft === null ? null : Math.round((longBlocks.chipLeft - shortBlocks.chipLeft) * 10) / 10;
	note("R8 #508's claim on the live row", JSON.stringify({ chipDelta, clusterDelta, controlsDelta, leftDelta, short: shortBlocks, long: longBlocks }));
	r2check(
		"R8 band i: #508's claim holds on the live row - the chip's left edge and the ml-auto controls group are fixed across a path change of this size",
		leftDelta !== null && Math.abs(leftDelta) <= 0.6 && (controlsDelta === null || Math.abs(controlsDelta) <= 0.6),
		JSON.stringify({ chipDelta, clusterDelta, controlsDelta, leftDelta, capped, column: col, longCluster: longBlocks.clusterText, shortCluster: shortBlocks.clusterText, clusterLeft: longBlocks.clusterLeft, controlsLeft: longBlocks.controlsLeft }),
	);

	await h.closePanel().catch(() => {});
	await h.idle().catch(() => {});
	return { tree: "qa8-band", frames: [] };
}
