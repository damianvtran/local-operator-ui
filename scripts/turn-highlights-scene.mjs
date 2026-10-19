/** Real-session Highlights regression, driven through the built application.
 * The runner copies the journal and MP3 into isolated storage; no live session
 * is attached, mutated, or sent a provider request. */
export async function sceneTurnHighlights({
	cdp,
	verb,
	capture,
	check,
	waitForCondition,
	factsOf,
}) {
	const facts = await factsOf(cdp);
	if (facts.windowMode !== "headless" || facts.visible || facts.focused)
		throw new Error("Highlights evidence requires headless mode");
	const waitFor = async (expression) => {
		const result = await waitForCondition(cdp, expression, 30000);
		if (!result.ok)
			throw new Error(`Highlights preflight failed: ${expression}`);
	};
	await verb(cdp, "navigate", "/chat");
	await waitFor(
		`Boolean(document.querySelector('[data-session-row="8d652185377c"]'))`,
	);
	await verb(cdp, "press", {
		selector: '[data-session-row="8d652185377c"] [data-chat-row]',
	});
	await waitFor('Boolean(document.querySelector("[data-turn-summary]"))');
	await new Promise((resolve) => setTimeout(resolve, 1200));
	const inspect = async (state) => {
		if (
			await cdp.evaluate(
				`Boolean(document.querySelector('[data-lo-scroll-to-bottom][aria-hidden="false"] button'))`,
			)
		) {
			await verb(cdp, "press", {
				selector: "[data-lo-scroll-to-bottom] button",
			});
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
		const result = await cdp.evaluate(`(() => {
			const strip = document.querySelector('[data-record-kind="supplement"]');
			const player = strip?.querySelector('[data-sound-player]');
			return { strip: Boolean(strip), sound: Boolean(player), nested: Boolean(strip?.closest('[data-turn-summary]')), waveform: player ? [...player.querySelectorAll("canvas")].map((canvas) => { const context = canvas.getContext("2d"); const data = context?.getImageData(0, 0, canvas.width, canvas.height).data; const rows = new Set(); if (data) for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) if (data[(y * canvas.width + x) * 4 + 3]) { rows.add(y); break; } return {width:canvas.width,height:canvas.height,paintedRows:rows.size}; }) : [], imageReady: Boolean(strip?.querySelector("[data-supplement-images] img")?.naturalWidth), images: Boolean(strip?.querySelector('[data-supplement-images]')), file: Boolean(strip?.querySelector('[data-supplement-file]')), text: document.body.innerText.slice(-2500) };
		})()`);
		console.log(`Highlights ${state}`, JSON.stringify(result));
		check(
			`Highlights ${state} is outside trace`,
			result.strip && result.sound && !result.nested,
			JSON.stringify(result),
		);
		if (result.images || result.file) {
			check(
				`Highlights ${state} keeps every artifact kind`,
				result.sound && result.images && result.imageReady && result.file,
				JSON.stringify(result),
			);
		}
		await capture(cdp, `highlights-${state}`);
		const box = await cdp.evaluate(
			'JSON.stringify(document.querySelector("[data-supplement-record]")?.getBoundingClientRect().toJSON())',
		);
		await new Promise((resolve) => setTimeout(resolve, 350));
		const settledBox = await cdp.evaluate(
			'JSON.stringify(document.querySelector("[data-supplement-record]")?.getBoundingClientRect().toJSON())',
		);
		check(
			`Highlights ${state} stays settled`,
			box === settledBox,
			JSON.stringify({ box, settledBox }),
		);
		await capture(cdp, `highlights-${state}-settled`);
	};
	await inspect("collapsed");
	await verb(cdp, "press", {
		selector: "[data-turn-summary] button[aria-expanded]",
	});
	await new Promise((resolve) => setTimeout(resolve, 800));
	await inspect("expanded");
}
