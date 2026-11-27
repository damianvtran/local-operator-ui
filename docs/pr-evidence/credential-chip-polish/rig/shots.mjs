// BEFORE/AFTER stills of the transcript chip and the composer chip. PNG only.
import { mkdirSync } from "node:fs";
import { evaluate, launch, openStory, shot, sleep, teardown } from "./lib.mjs";
const [label, outdir] = process.argv.slice(2);
mkdirSync(outdir, { recursive: true });
const THEMES = (
	process.env.THEMES ?? "localOperatorDark,localOperatorLight,everforest"
).split(",");
const cdp = await launch();
const clipOf = async (selector, pad = 12) => {
	const r = JSON.parse(
		await evaluate(
			cdp,
			`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return "null"; const r = e.getBoundingClientRect(); return JSON.stringify({x:r.left,y:r.top,width:r.width,height:r.height}); })()`,
		),
	);
	if (!r) throw new Error(`no ${selector}`);
	const x = Math.max(0, r.x - pad);
	const y = Math.max(0, r.y - pad);
	return {
		x,
		y,
		width: Math.min(1024 - x, r.width + 2 * pad),
		height: r.height + 2 * pad,
	};
};
try {
	for (const theme of THEMES) {
		// transcript
		for (const [story, name, w, h, ready] of [
			[
				"chat-canonical-credential-citation--citation-mid-sentence",
				"transcript-live",
				1024,
				260,
				"[data-lo-canonical-transcript] span[title]",
			],
			[
				"chat-canonical-credential-citation--citation-not-stored",
				"transcript-not-stored",
				1024,
				260,
				"[data-lo-canonical-transcript] span[title]",
			],
			[
				"chat-canonical-credential-citation--citation-unconfirmed-narrow",
				"transcript-narrow-440",
				440,
				300,
				"[data-lo-canonical-transcript] span[title]",
			],
		]) {
			await openStory(cdp, story, { theme, width: w, height: h, ready });
			await shot(cdp, `${outdir}/${label}-${theme}-${name}.png`);
		}
		// composer
		for (const [story, name] of [
			["chat-message-input--credential-pill-mid-prose", "composer-live"],
			["chat-message-input--credential-pill-unbacked", "composer-not-stored"],
			["chat-message-input--credential-pill-small-view", "composer-small-440"],
		]) {
			const w = name.includes("440") ? 440 : 1024;
			await openStory(cdp, story, {
				theme,
				width: w,
				height: 300,
				ready: "[data-credential-chips],[data-credential-run]",
			});
			await sleep(300);
			await evaluate(
				cdp,
				"document.activeElement && document.activeElement.blur && document.activeElement.blur(); 0",
			);
			const clip = await clipOf("textarea", 14);
			await shot(cdp, `${outdir}/${label}-${theme}-${name}.png`, clip);
		}
		// Only with EXTRAS=1 (the dark and light themes): the 4x zoom of the composer chip's
		// corners over the marker's bracket glyphs, and a marker that wraps (it keeps the wash
		// and draws no chip). Re-shot with the raised dark fill because both show the material.
		if (process.env.EXTRAS === "1") {
			await openStory(cdp, "chat-message-input--credential-pill-mid-prose", {
				theme,
				width: 1024,
				height: 300,
				ready: "[data-credential-chips],[data-credential-run]",
			});
			await sleep(300);
			await evaluate(cdp, "document.activeElement?.blur?.(); 0");
			const chip = await clipOf("[data-credential-chips] span[title]", 6);
			await shot(
				cdp,
				`${outdir}/${label}-${theme}-composer-zoom4x.png`,
				chip,
				4,
			);
			await openStory(cdp, "chat-message-input--credential-pill-mid-prose", {
				theme,
				width: 1024,
				height: 300,
				ready: "[data-credential-chips],[data-credential-run]",
			});
			await evaluate(
				cdp,
				"(() => { const f = document.querySelector('textarea'); f.focus(); f.setSelectionRange(0, 0); 0; })()",
			);
			await cdp.send("Input.insertText", {
				text: "Please walk through every step of the staging rollout carefully and then ",
			});
			await sleep(300);
			await evaluate(cdp, "document.activeElement?.blur?.(); 0");
			await shot(
				cdp,
				`${outdir}/${label}-${theme}-wrapped-run.png`,
				await clipOf("textarea", 14),
			);
		}
		// scrolled
		await openStory(cdp, "chat-message-input--credential-pill-scrolled", {
			theme,
			width: 1024,
			height: 300,
		});
		await evaluate(
			cdp,
			`(async () => { const f = document.querySelector('textarea'); f.setSelectionRange(0,0); f.scrollTop = f.scrollHeight; f.dispatchEvent(new Event('scroll')); await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); await new Promise(r=>setTimeout(r,250)); })()`,
		);
		await shot(
			cdp,
			`${outdir}/${label}-${theme}-composer-scrolled.png`,
			await clipOf("textarea", 14),
		);
	}
} finally {
	teardown();
}
