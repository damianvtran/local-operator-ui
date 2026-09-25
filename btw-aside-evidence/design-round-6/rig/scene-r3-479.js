
/* QA round 3 — #479 one-moment probe, runnable on BOTH the PR head and main (no aside). */
async function sceneR3OneMoment(cdp) {
	const facts = await factsOf(cdp);
	r2check("window mode is headless and the window is never shown", facts.windowMode === "headless" && facts.visible === false, `mode=${facts.windowMode} visible=${facts.visible}`);
	const { sessionId } = await qaOpenSession(cdp);
	note("479 session", sessionId);
	const enter = () => pressChord(cdp, { key: "Enter", code: "Enter", virtualKeyCode: 13 });
	const idle = () => qaAwaitPanel(cdp, (b) => b.transcriptStreaming === false && b.transcriptWorking === false, 400);
	await clickAt(cdp, R3.FIELD);
	await cdp.send("Input.insertText", { text: "seed turn for quoting" });
	await enter();
	await qaAwaitPanel(cdp, (b) => (b.transcriptText ?? "").includes(R3.TAIL), 300);
	await idle();
	const SEED = Number(process.env.QA_SEED_TURNS ?? 0);
	for (let k = 0; k < SEED; k++) {
		await clickAt(cdp, R3.FIELD);
		await cdp.send("Input.insertText", { text: `extra seed turn ${k}` });
		await enter();
		await qaAwaitPanel(cdp, (b) => qaCount(b.transcriptText, R3.TAIL) >= k + 2, 300);
		await idle();
	}
	note("seed turns", String(SEED + 1));
	if (process.env.QA_ASIDE_FIRST === "1") {
		await clickAt(cdp, R3.FIELD);
		await cdp.send("Input.insertText", { text: "/btw an aside before the probe" });
		await enter();
		for (let k = 0; k < 200 && !(r3posts("an aside before the probe")[0]?.status); k++) await wait(100);
		await wait(500);
		await clickAt(cdp, R3.FIELD);
		await pressChord(cdp, { key: "Escape", code: "Escape", virtualKeyCode: 27 });
		await qaAwaitPanel(cdp, (b) => b.panel === null, 60);
		note("aside used and closed before the probe", JSON.stringify(r3posts("an aside before the probe").map((x) => x.status)));
	}
	const RUNS = Number(process.env.QA_RUNS ?? 0);
	const variants = RUNS > 0 ? Array.from({ length: RUNS }, () => ({ name: "quote+file", quote: true, file: true })) : [
		{ name: "quote+file", quote: true, file: true },
		{ name: "quote+file", quote: true, file: true },
		{ name: "quote+file", quote: true, file: true },
		{ name: "quote only", quote: true, file: false },
		{ name: "file only", quote: false, file: true },
	];
	let i = 0;
	for (const v of variants) {
		i += 1;
		if (v.quote) await r3StageQuote(cdp, "Transport failures and owner");
		if (v.file) await r3PasteImage(cdp, `qa3-479-${i}.png`);
		const text = `HOLDSEND one-moment probe ${i} (${v.name})`;
		await clickAt(cdp, R3.FIELD);
		await cdp.send("Input.insertText", { text });
		await wait(200);
		await r3ArmFrameSampler(cdp, `HOLDSEND one-moment probe ${i} `);
		await enter();
		await wait(1600);
		const trace = await r3ReadFrameSampler(cdp);
		const split = r3Split(trace.frames);
		const staged = trace.frames[0] ? { replies: trace.frames[0][2], attachments: trace.frames[0][3] } : null;
		note(`479 run ${i} staged at the press`, JSON.stringify(staged));
		note(`479 run ${i} (${v.name}) frames [t, value, replies, attachments, echo, placeholder]`, JSON.stringify(trace.frames));
		note(`479 run ${i} (${v.name}) mutations [t, value, replies, attachments, echo]`, JSON.stringify(trace.mutations));
		const mChips = trace.mutations.find((m) => m[2] + m[3] < staged.replies + staged.attachments);
		const mText = trace.mutations.find((m) => m[1] === 0);
		note(`479 run ${i} GAP chips-left -> text-left (mutation ms)`, String(mChips && mText ? mText[0] - mChips[0] : "n/a"));
		r2check(`479 run ${i} (${v.name}): no painted frame shows the text without its chips (or the reverse)`, split.length === 0, JSON.stringify({ split }), JSON.stringify({ frames: trace.all }));
		if (i === 1) {
			const r = await r3Read(cdp);
			r2check("479: the empty box says 'Sending your message' while held", r.placeholder === R3.PH_SENDING, JSON.stringify({ placeholder: r.placeholder }));
			await capture(cdp, `qa3-${RUN_LABEL}-479-in-flight`);
		}
		for (let k = 0; k < 200 && !(r3msgs(`probe ${i} `)[0]?.status); k++) await wait(100);
		await idle();
		await wait(500);
	}
	return { tree: "qa3-479", frames: [] };
}
