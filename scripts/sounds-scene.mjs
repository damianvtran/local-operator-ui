import { SOUNDS_COUNT, SOUNDS_SESSION } from "./sounds-fixture.mjs";

/** Integrated seats, not a gallery. A synthetic journal is the input; the app's
 * reducer, attachment relay, shared element, decoder and graph are production. */
export async function sceneSounds({
	cdp,
	verb,
	capture,
	check,
	waitForCondition,
	factsOf,
}) {
	const facts = await factsOf(cdp);
	if (facts.windowMode !== "headless" || facts.visible || facts.focused)
		throw new Error("sounds requires an invisible headless app");
	const demand = (label, value) => {
		if (!check(label, Boolean(value), JSON.stringify(value)))
			throw new Error(label);
	};
	const waitFor = async (expression) => {
		const result = await waitForCondition(cdp, expression, 30000);
		if (!result.ok) {
			console.log(
				"sounds DOM on failure",
				await cdp.evaluate("document.body.innerText.slice(-6000)"),
			);
			await capture(cdp, "sounds-failed-preflight");
		}
		demand(expression, result.ok);
	};
	await verb(cdp, "soundsArm");
	let refused = false;
	try {
		await verb(cdp, "soundsArm");
	} catch {
		refused = true;
	}
	demand("graph re-arm negative control refuses", refused);
	await verb(cdp, "navigate", "/chat");
	await waitFor(
		`Boolean(document.querySelector('[data-session-row="${SOUNDS_SESSION}"]'))`,
	);
	await verb(cdp, "press", {
		selector: `[data-session-row="${SOUNDS_SESSION}"] [data-chat-row]`,
	});
	await waitFor('Boolean(document.querySelector("[data-turn-summary]"))');
	/*
	 * THE REPORTED STATE, MEASURED BEFORE ANY PRESS: the run is condensed (its
	 * bar is the only visible row of the run) and the tool group under it is
	 * closed. The block must still paint ALL fourteen sounds there - the row's
	 * rule is that collapsing changes frame mounting, never media - and the
	 * collage is the fix for the wall the operator saw in exactly this shape.
	 */
	await waitFor(
		`document.querySelectorAll("[data-supplement-sound]").length === ${SOUNDS_COUNT}`,
	);
	/*
	 * A player exists only once its digest resolves to bytes (the reserved
	 * placeholder is what a static render draws), so the collage's readiness is
	 * fourteen PLAYERS, not fourteen item boxes.
	 */
	await waitFor(
		`document.querySelectorAll("[data-supplement-sound] [data-sound-player]").length === ${SOUNDS_COUNT}`,
	);
	const collage = await cdp.evaluate(`(() => {
		const items = [...document.querySelectorAll("[data-supplement-sound]")];
		const strip = document.querySelector("[data-supplement-sounds]");
		const lefts = new Set(items.map((item) => Math.round(item.getBoundingClientRect().left)));
		return {
			count: items.length,
			columns: lefts.size,
			players: items.filter((item) => item.querySelector("[data-sound-player]")).length,
			gridTemplateColumns: strip ? getComputedStyle(strip).gridTemplateColumns : null,
			scrollWidth: strip ? strip.scrollWidth : 0,
			clientWidth: strip ? strip.clientWidth : 0,
			// THE COLLAPSE ANCESTRY, as the DOM actually is: the tool call's
			// card (the artifact's generating/done surface) lives inside the
			// collapsed group, so it is not mounted; the durable highlights
			// strip is its sibling OUTSIDE the group and keeps the audio.
			cardMounted: Boolean(document.querySelector('[data-record-id="tool:sounds-call-1"]')),
			cardInsideSummary: Boolean(
				document
					.querySelector('[data-record-id="tool:sounds-call-1"]')
					?.closest("[data-turn-summary]"),
			),
			cardVisibleHeight:
				document
					.querySelector('[data-record-id="tool:sounds-call-1"]')
					?.getBoundingClientRect().height ?? 0,
			stripOutsideGroup: strip ? !strip.closest("[data-turn-summary]") : false,
		};
	})()`);
	console.log("sounds collage collapsed", JSON.stringify(collage));
	demand(
		"all fourteen sounds render, each with its own player, in the condensed run",
		collage.count === SOUNDS_COUNT && collage.players === SOUNDS_COUNT,
	);
	demand(
		"the collage is a multi-column grid that fits the block's width",
		collage.columns >= 2 && collage.scrollWidth <= collage.clientWidth + 1,
	);
	await capture(cdp, "sounds-collage-condensed-idle");
	/*
	 * THE FOURTEENTH, not the first: the retired three-sound cap made everything
	 * past the third unreachable, so a press on the last cell is the proof that
	 * the uncapped list is actionable rather than merely present in the DOM.
	 */
	await verb(cdp, "press", {
		selector:
			"[data-supplement-sounds] > [data-supplement-sound]:last-child [data-sound-player] button",
	});
	await waitFor(
		`document.querySelectorAll("[data-supplement-sound]")[${SOUNDS_COUNT - 1}]?.querySelector('[data-sound-status="playing"]') !== null`,
	);
	await new Promise((resolve) => setTimeout(resolve, 800));
	console.log(
		"sounds collage playing facts",
		JSON.stringify(await verb(cdp, "soundsFacts")),
	);
	await capture(cdp, "sounds-collage-condensed-playing");
	await verb(cdp, "press", {
		selector:
			'[data-turn-summary][data-run-ids~="tool:sounds-call-1"] button[aria-expanded]',
	});
	await waitFor(
		"Boolean(document.querySelector('[data-record-id=\"tool:sounds-call-1\"] [data-sound-player] button'))",
	);
	await capture(cdp, "sounds-transcript-idle");
	/*
	 * SCOPED TO THE TRANSCRIPT'S OWN CARD. The highlights collage renders
	 * fourteen players BELOW it once the run's bar is expanded, so an unscoped
	 * `[data-sound-player]` is ambiguous - and the scrub verbs address the first
	 * match, which must be the playing row.
	 */
	/*
	 * OUTSIDE THE TURN SUMMARY. While the run is condensed the fold keeps a
	 * compact media slot inside the bar whose record id is the SAME record;
	 * after the bar is expanded both exist, and the slot's slider has no box
	 * (a 0px drag cannot cross the player's 4px click slop). The card's own
	 * player is the one not inside the summary, so every press and scrub below
	 * addresses that one.
	 */
	const cardPlayer =
		'[data-record-id="tool:sounds-call-1"]:not([data-turn-summary] *) [data-sound-player]';
	await verb(cdp, "press", { selector: `${cardPlayer} > button` });
	await waitFor(
		`document.querySelector('${cardPlayer}[data-sound-status="playing"]') !== null`,
	);
	await new Promise((resolve) => setTimeout(resolve, 1500));
	const playing = await verb(cdp, "soundsFacts");
	console.log("sounds playing facts", JSON.stringify(playing));
	demand(
		"real decoder advances; zero-gain analyser stays silent",
		playing.time > 0.2 &&
			!playing.paused &&
			playing.gain === 0 &&
			playing.rms === 0 &&
			playing.inputRms > 0,
	);
	demand(
		"generated bytes use a digest blob, not the dead signed URL",
		playing.src.startsWith("blob:"),
	);
	await capture(cdp, "sounds-transcript-playing");
	console.log(
		"sounds scrub targets",
		JSON.stringify(
			await cdp.evaluate(`(() => {
				const sliders = [...document.querySelectorAll('${cardPlayer} [data-sound-slider]')];
				return sliders.map((slider) => {
					const rect = slider.getBoundingClientRect();
					return {
						width: rect.width,
						height: rect.height,
						status: slider.closest("[data-sound-player]")?.getAttribute("data-sound-status"),
					};
				});
			})()`),
		),
	);
	const scrub = await verb(cdp, "soundsScrub", {
		selector: `${cardPlayer} [data-sound-slider]`,
		fraction: 0.65,
	});
	console.log("sounds scrub result", JSON.stringify(scrub));
	demand(
		"pointer handlers enter scrubbing and commit position",
		scrub.during === "scrubbing",
	);
	await capture(cdp, "sounds-transcript-scrubbing");
	await verb(cdp, "soundsScrubFinish");
	await capture(cdp, "sounds-transcript-scrubbed");
	await verb(cdp, "soundsEnd");
	await waitFor(
		`document.querySelector('${cardPlayer}[data-sound-status="ended"]') !== null`,
	);
	await capture(cdp, "sounds-transcript-ended");

	await verb(cdp, "press", { selector: '[data-panel-rail-item="canvas"]' });
	await verb(cdp, "press", {
		selector: '[data-tour-tag="canvas-files-view-button"]',
	});
	await waitFor(
		"Boolean(document.querySelector('[data-tour-tag=\"file-row\"] [data-sound-player]'))",
	);
	await capture(cdp, "sounds-canvas-files");
	// Filename opens the indexed document; no path is injected by the rig.
	await verb(cdp, "press", {
		selector: '[data-tour-tag="file-row"] button.flex-1',
	});
	await waitFor(
		'Boolean(document.querySelector(".bg-sunken [data-sound-player]"))',
	);
	await capture(cdp, "sounds-canvas-preview");
	console.log(
		"sounds preview facts",
		JSON.stringify(await verb(cdp, "soundsFacts")),
	);
	await verb(cdp, "press", {
		selector: ".bg-sunken [data-sound-player] button",
	});
	const speech = await verb(cdp, "soundsSpeech");
	demand(
		"speech store supersedes preview/row on the same element",
		speech.ownerId === "speech:sounds-driver",
	);
	demand(
		"preview mounts no independent native audio",
		(await verb(cdp, "soundsFacts")).nativeElements === 0,
	);
	await capture(cdp, "sounds-speech-exclusive");
	await verb(cdp, "press", { selector: '[aria-label="Close canvas"]' });
	await waitFor(
		`document.querySelectorAll("[data-supplement-sound]").length === ${SOUNDS_COUNT}`,
	);
	/*
	 * THE EXPANDED FORM OF THE SAME BLOCK, after the run's bar was expanded and
	 * the canvas pane closed: the same fourteen cells, in the same grid. The
	 * pair of frames is the brief's before/after - both forms identical media.
	 */
	const expanded = await cdp.evaluate(`(() => {
		const items = [...document.querySelectorAll("[data-supplement-sound]")];
		const lefts = new Set(items.map((item) => Math.round(item.getBoundingClientRect().left)));
		return { count: items.length, columns: lefts.size, players: items.filter((item) => item.querySelector("[data-sound-player]")).length };
	})()`);
	console.log("sounds collage expanded", JSON.stringify(expanded));
	demand(
		"the expanded run paints the same fourteen sounds and cells",
		expanded.count === SOUNDS_COUNT &&
			expanded.players === SOUNDS_COUNT &&
			expanded.columns === collage.columns,
	);
	demand(
		"expanding the run mounts the tool call's own card again",
		Boolean(
			await cdp.evaluate(
				"document.querySelector('[data-record-id=\"tool:sounds-call-1\"]') !== null",
			),
		),
	);
	await cdp.evaluate(
		'document.querySelector("[data-supplement-sound-title]").scrollIntoView({block:"center"})',
	);
	await capture(cdp, "sounds-highlights-collage");
	await verb(cdp, "press", {
		selector:
			"[data-supplement-sound-title] + div button, [data-supplement-sound-title] ~ [data-sound-player] button",
	});
}
