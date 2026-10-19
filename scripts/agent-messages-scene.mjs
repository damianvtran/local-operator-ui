/* ------------------------------------------------------------------------- *
 * `agent-messages`: Settings -> Agent messages, driven through its own
 * controls against a live daemon.
 *
 * WHY A SCENE. The section's shape is a SERVER decision (RFC §5.6): whether it
 * exists at all, which state letter it renders, and what the reach editor's
 * levels are all come from the status and settings reads. A Storybook fixture
 * can show each panel, but it cannot show that the daemon's answer produced
 * that panel, and the allowlist save is a replace-set whose result is only
 * observable after the server echoes it. This scene reads the DOM hooks the
 * section publishes, acts through the controls a reader uses, and asserts the
 * attribute each action leaves behind.
 *
 * WHY THIS MODULE. `scripts/renderer-driver.mjs` is at Biome's 2 MiB ceiling
 * for a single file, so this scene joins the sounds scene in its own module
 * rather than pushing the driver over. The driver passes its helpers in,
 * exactly as `sounds-scene.mjs` receives them, so the scene runs on the same
 * assertions, waits and captures as every inline scene.
 *
 * WHAT IT DRIVES:
 *
 *   1. `/settings?section=agent-messages`, settled; the section must render
 *      state C (an account this rig has already enabled);
 *   2. the same section in both palettes;
 *   3. Pause -> D, Resume -> C, then the local switch to on;
 *   4. the receive direction to listed-only with one added identifier, saved;
 *   5. the receive direction back to the class default, saved.
 *
 * The frames are the visual record; every `check` below is a DOM or daemon
 * fact. Needs `--backend` and `--backend-records` for a daemon this run owns,
 * plus `--allowlist-id` (and optionally `--allowlist-kind account`).
 *
 *   node scripts/renderer-driver.mjs --scene agent-messages \
 *     --backend http://127.0.0.1:8080 --backend-records <config>/run/serve \
 *     --allowlist-id <bep_…|acc_…> --allowlist-kind endpoint \
 *     --seed-onboarding-complete --out <dir>
 */

/** The section root, whichever panel it rendered (visible, dark or error). */
const AGENT_MESSAGES_SECTION = "[data-agent-messages-section]";

/** The section's own published facts, read in one pass. */
const AGENT_MESSAGES_FACTS = `(() => {
	const section = document.querySelector(${JSON.stringify(AGENT_MESSAGES_SECTION)});
	const state = document.querySelector("[data-agent-messages-state]");
	const allowlist = document.querySelector("[data-agent-messages-allowlist]");
	const levels = [...document.querySelectorAll("[data-agent-messages-direction]")].map(
		(node) => ({
			direction: node.getAttribute("data-agent-messages-direction"),
			level: node.getAttribute("data-agent-messages-level"),
		}),
	);
	return {
		section: Boolean(section),
		state: state ? state.getAttribute("data-agent-messages-state") : null,
		allowlist: Boolean(allowlist),
		levels,
	};
})()`;

/** Send the settings scroller to a node, leaving the page's 80px header room. */
function scrollSettingsNode(selector) {
	return `(() => {
		const node = document.querySelector(${JSON.stringify(selector)});
		const scroller = document.querySelector("[data-settings-content]");
		if (!node || !scroller) return false;
		const delta = node.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
		scroller.scrollTo({ top: Math.max(0, scroller.scrollTop + delta - 80) });
		return true;
	})()`;
}

/** The receive group, resolved once per expression (the editor re-renders). */
const RECEIVE_GROUP = `document.querySelector('[data-agent-messages-direction="receive"]')`;

export async function sceneAgentMessages({
	cdp,
	verb,
	capture,
	check,
	note,
	wait,
	waitForCondition,
	factsOf,
	argValue,
	backend,
	backendRecords,
	framesDir,
	electronUserAgent,
}) {
	const hello = await verb(cdp, "hello");
	const facts = await factsOf(cdp);
	check(
		"the renderer reports this run's frames directory",
		hello.outDir === framesDir,
		`${hello.outDir} (expected ${framesDir})`,
	);
	check(
		"the renderer sees the built app, not a bare Vite page",
		electronUserAgent.test(hello.userAgent),
		hello.userAgent,
	);
	check(
		"window mode is headless and the window is never shown",
		facts.windowMode === "headless" && facts.visible === false,
		`mode=${facts.windowMode} visible=${facts.visible} focused=${facts.focused}`,
	);
	check(
		"this scene is running against a live, isolated backend",
		Boolean(backend),
		"the section's existence, state and every write are the daemon's, so this needs --backend",
	);
	check(
		"--backend-records names the daemon's own serve record",
		Boolean(backendRecords),
		"discovery must admit the daemon this scene reads and writes",
	);
	if (!backend || !backendRecords) return [];

	const allowlistId = argValue("--allowlist-id", null);
	const allowlistKind = argValue("--allowlist-kind", "endpoint");
	const expectStart = argValue("--expect-start", "c");
	check(
		"--expect-start names b or c",
		["b", "c"].includes(expectStart),
		JSON.stringify(expectStart),
	);
	if (!["b", "c"].includes(expectStart)) return [];
	check(
		"--allowlist-id names the identifier the reach editor adds",
		typeof allowlistId === "string" && allowlistId.trim().length > 0,
		JSON.stringify(allowlistId),
	);
	check(
		"--allowlist-kind names endpoint or account",
		["endpoint", "account"].includes(allowlistKind),
		JSON.stringify(allowlistKind),
	);
	if (
		typeof allowlistId !== "string" ||
		allowlistId.trim().length === 0 ||
		!["endpoint", "account"].includes(allowlistKind)
	)
		return [];

	const frames = [];
	const shoot = async (label) => {
		const frame = await capture(cdp, label);
		frames.push(frame);
		return frame;
	};

	// -- a. the section exists, in a named state -------------------------------
	await verb(cdp, "navigate", "/settings?section=agent-messages");
	await verb(cdp, "setTheme", "localOperatorDark");
	const mounted = await waitForCondition(
		cdp,
		`Boolean(document.querySelector(${JSON.stringify(AGENT_MESSAGES_SECTION)}))`,
		30_000,
	);
	check(
		"the Agent messages section mounted at its deep link",
		mounted.ok === true,
		`waited ${mounted.waitedMs}ms; the section never appeared (absent for this account, or the page did not render)`,
		`present after ${mounted.waitedMs}ms`,
	);
	if (!mounted.ok) {
		const page = await cdp.evaluate(`(() => ({
			href: location.href,
			settingsContent: Boolean(document.querySelector("[data-settings-content]")),
			headings: [...document.querySelectorAll("h1, h2")].map((node) => (node.textContent ?? "").trim()).slice(0, 8),
			text: document.body.innerText.slice(0, 1200),
		}))()`);
		note("the page at the failed deep link", JSON.stringify(page));
		await capture(cdp, "agent-messages-missing");
		return [];
	}

	/*
	 * The one-time agent-messages dialog is a SECOND client of the same status:
	 * on a fresh scratch profile it mounts over Settings in state B. It is
	 * dismissed through its own "Not now" control rather than by seeding the
	 * persisted store, so the frame is the app's real presentation and a dialog
	 * regression cannot be hidden by the rig.
	 */
	const dialog = await waitForCondition(
		cdp,
		`[...document.querySelectorAll('[role="dialog"]')].some((node) => node.textContent.includes("Agent messages on Radient"))`,
		5_000,
	);
	if (dialog.ok) {
		const dismissed = await cdp.evaluate(`(() => {
			const node = [...document.querySelectorAll('[role="dialog"]')].find(
				(candidate) => candidate.textContent.includes("Agent messages on Radient"),
			);
			const button = node && [...node.querySelectorAll("button")].find(
				(candidate) => candidate.textContent.trim() === "Not now",
			);
			if (!button) return false;
			button.click();
			return true;
		})()`);
		check(
			"the one-time dialog was dismissed before any frame",
			dismissed === true,
			"the dialog had no 'Not now' control",
		);
		const closed = await waitForCondition(
			cdp,
			`![...document.querySelectorAll('[role="dialog"]')].some((node) => node.textContent.includes("Agent messages on Radient"))`,
			15_000,
		);
		check(
			"the dialog closed before the section was captured",
			closed.ok === true,
			`waited ${closed.waitedMs}ms; the dialog stayed open`,
			`closed after ${closed.waitedMs}ms`,
		);
	} else {
		note(
			"no one-time dialog was presented",
			"already seen, or the surface is not in state B",
		);
	}

	const wantedState = expectStart === "b" ? "B" : "C";
	const named = await waitForCondition(
		cdp,
		`document.querySelector("[data-agent-messages-state]")?.getAttribute("data-agent-messages-state") === ${JSON.stringify(wantedState)}`,
		30_000,
	);
	const namedFacts = await cdp.evaluate(AGENT_MESSAGES_FACTS);
	check(
		"the section starts in the state --expect-start names",
		named.ok === true && namedFacts.state === wantedState,
		`waited ${named.waitedMs}ms; data-agent-messages-state=${JSON.stringify(namedFacts.state)} (expected ${JSON.stringify(wantedState)})`,
		JSON.stringify(namedFacts),
	);
	if (named.ok !== true || namedFacts.state !== wantedState) return [];

	// -- B: the real consent on-ramp, then Enable -> C ------------------------
	if (expectStart === "b") {
		await cdp.evaluate(scrollSettingsNode(AGENT_MESSAGES_SECTION));
		await wait(400);
		const onRamp = await cdp.evaluate(`(() => {
			const section = document.querySelector(${JSON.stringify(AGENT_MESSAGES_SECTION)});
			return { text: section ? section.textContent : "", facts: ${AGENT_MESSAGES_FACTS} };
		})()`);
		note("the on-ramp at rest", JSON.stringify(onRamp.facts));
		check(
			"the on-ramp renders the served consent sentence",
			onRamp.text.includes("I understand that enabling agent messages"),
			"the served consent fragment was not in the section's textContent",
		);
		await shoot("agent-messages-on-ramp");

		const enabledPressed = await cdp.evaluate(`(() => {
			const button = document.querySelector('[data-agent-messages-action="enable"]');
			if (!button || button.disabled) return false;
			button.scrollIntoView({ block: "center" });
			button.click();
			return true;
		})()`);
		check(
			"the Enable action is present, enabled, and was pressed",
			enabledPressed === true,
			"no enabled [data-agent-messages-action=enable] control in state B",
		);
		if (enabledPressed !== true) return frames;
		const enabled = await waitForCondition(
			cdp,
			`(() => {
				const state = document.querySelector("[data-agent-messages-state]");
				const allowlist = document.querySelector("[data-agent-messages-allowlist]");
				return Boolean(state) && state.getAttribute("data-agent-messages-state") === "C" && Boolean(allowlist);
			})()`,
			30_000,
		);
		const enabledFacts = await cdp.evaluate(AGENT_MESSAGES_FACTS);
		note("the section after Enable", JSON.stringify(enabledFacts));
		check(
			"Enable moved the section to state C, with the reach editor mounted",
			enabled.ok === true &&
				enabledFacts.state === "C" &&
				enabledFacts.allowlist === true,
			`waited ${enabled.waitedMs}ms; state=${JSON.stringify(enabledFacts.state)} allowlist=${enabledFacts.allowlist}`,
			JSON.stringify(enabledFacts),
		);
		if (enabled.ok !== true) return frames;
		await wait(300);
		await shoot("agent-messages-enabled");
	}

	await cdp.evaluate(scrollSettingsNode(AGENT_MESSAGES_SECTION));
	await wait(400);
	const atRest = await cdp.evaluate(AGENT_MESSAGES_FACTS);
	note("the section's published hooks at rest", JSON.stringify(atRest));
	check(
		"the scene continues from the enabled state (C)",
		atRest.state === "C",
		`data-agent-messages-state=${JSON.stringify(atRest.state)}`,
		JSON.stringify(atRest),
	);
	if (atRest.state !== "C") return frames;
	await shoot("agent-messages-populated");

	// -- b. both palettes ------------------------------------------------------
	await verb(cdp, "setTheme", "localOperatorLight");
	await wait(350);
	await shoot("agent-messages-populated-light");
	await verb(cdp, "setTheme", "localOperatorDark");
	await wait(350);

	// -- c. Pause -> D ---------------------------------------------------------
	const pausedPressed = await cdp.evaluate(`(() => {
		const button = document.querySelector('[data-agent-messages-action="pause"]');
		if (!button) return false;
		button.scrollIntoView({ block: "center" });
		button.click();
		return true;
	})()`);
	check(
		"the Pause action is present and was pressed",
		pausedPressed === true,
		"no [data-agent-messages-action=pause] control exists in state C",
	);
	if (pausedPressed !== true) return frames;
	const paused = await waitForCondition(
		cdp,
		`document.querySelector("[data-agent-messages-state]")?.getAttribute("data-agent-messages-state") === "D"`,
		20_000,
	);
	const pausedFacts = await cdp.evaluate(AGENT_MESSAGES_FACTS);
	note("the section after Pause", JSON.stringify(pausedFacts));
	check(
		"Pause moved the section to state D",
		paused.ok === true && pausedFacts.state === "D",
		`waited ${paused.waitedMs}ms; state=${JSON.stringify(pausedFacts.state)}`,
		`D after ${paused.waitedMs}ms`,
	);
	await shoot("agent-messages-paused");

	// -- d. Resume -> C -------------------------------------------------------
	const resumePressed = await cdp.evaluate(`(() => {
		const button = document.querySelector('[data-agent-messages-action="resume"]');
		if (!button) return false;
		button.scrollIntoView({ block: "center" });
		button.click();
		return true;
	})()`);
	check(
		"the Resume action is present and was pressed",
		resumePressed === true,
		"no [data-agent-messages-action=resume] control exists in state D",
	);
	if (resumePressed !== true) return frames;
	const resumed = await waitForCondition(
		cdp,
		`document.querySelector("[data-agent-messages-state]")?.getAttribute("data-agent-messages-state") === "C"`,
		20_000,
	);
	check(
		"Resume moved the section back to state C",
		resumed.ok === true,
		`waited ${resumed.waitedMs}ms; state never returned to C`,
		`C after ${resumed.waitedMs}ms`,
	);

	// -- e. the machine-local switch -----------------------------------------
	// Scoped to the SECTION: the settings page has other switches, and the
	// first one on the page is not necessarily this section's local enable.
	const SWITCH = `document.querySelector('[data-agent-messages-section] [role="switch"]')`;
	const switchAtRest = await cdp.evaluate(`(() => {
		const control = ${SWITCH};
		if (!control) return null;
		const name = (control.getAttribute("aria-labelledby") ?? "")
			.split(/\\s+/)
			.filter(Boolean)
			.map((id) => document.getElementById(id)?.textContent?.trim())
			.filter(Boolean)
			.join(" ");
		return { name, checked: control.getAttribute("aria-checked") };
	})()`);
	note(
		"the machine-local switch before the press",
		JSON.stringify(switchAtRest),
	);
	check(
		"the switch is the 'Enabled on this machine' control",
		switchAtRest?.name === "Enabled on this machine",
		JSON.stringify(switchAtRest),
	);
	if (switchAtRest && switchAtRest.checked !== "true") {
		await cdp.evaluate(`${SWITCH}?.click()`);
	}
	const localOn = await waitForCondition(
		cdp,
		`${SWITCH}?.getAttribute("aria-checked") === "true"`,
		20_000,
	);
	check(
		"the machine-local switch reads on",
		localOn.ok === true,
		`waited ${localOn.waitedMs}ms; aria-checked never became true`,
		`on after ${localOn.waitedMs}ms`,
	);
	await shoot("agent-messages-local-on");

	/*
	 * QA round 1: the OFF direction is a real state change, not just the
	 * absence of the on path. Turn it off, prove the attribute, capture it,
	 * then restore on so the allowlist steps run from the enabled posture.
	 */
	await cdp.evaluate(`${SWITCH}?.click()`);
	const localOff = await waitForCondition(
		cdp,
		`${SWITCH}?.getAttribute("aria-checked") === "false"`,
		20_000,
	);
	check(
		"the machine-local switch turns off",
		localOff.ok === true,
		`waited ${localOff.waitedMs}ms; aria-checked never became false`,
		`off after ${localOff.waitedMs}ms`,
	);
	await wait(250);
	await shoot("agent-messages-local-off");
	await cdp.evaluate(`${SWITCH}?.click()`);
	const localRestored = await waitForCondition(
		cdp,
		`${SWITCH}?.getAttribute("aria-checked") === "true"`,
		20_000,
	);
	check(
		"the machine-local switch is restored on",
		localRestored.ok === true,
		`waited ${localRestored.waitedMs}ms; aria-checked never returned to true`,
		`on after ${localRestored.waitedMs}ms`,
	);

	// -- f. receive -> listed-only with one added identifier ------------------
	const allowlistScrolled = await cdp.evaluate(
		scrollSettingsNode("[data-agent-messages-allowlist]"),
	);
	await wait(400);
	const allowlistAtRest = await cdp.evaluate(AGENT_MESSAGES_FACTS);
	note("the reach editor at rest", JSON.stringify(allowlistAtRest));
	check(
		"the reach editor mounted beside state C",
		allowlistScrolled === true && allowlistAtRest.allowlist === true,
		JSON.stringify(allowlistAtRest),
	);

	const listedChosen = await cdp.evaluate(`(() => {
		const group = ${RECEIVE_GROUP};
		if (!group) return false;
		const button = [...group.querySelectorAll("button")].find(
			(node) => node.textContent.trim() === "Only agents I choose",
		);
		if (!button) return false;
		button.click();
		return true;
	})()`);
	check(
		"the receive direction offers the listed-only level",
		listedChosen === true,
		"no 'Only agents I choose' control in the receive group",
	);
	if (listedChosen !== true) return frames;
	const listed = await waitForCondition(
		cdp,
		`${RECEIVE_GROUP}?.getAttribute("data-agent-messages-level") === "listed_only"`,
		10_000,
	);
	check(
		"the receive level reads listed_only",
		listed.ok === true,
		`waited ${listed.waitedMs}ms; level never became listed_only`,
		`listed_only after ${listed.waitedMs}ms`,
	);

	if (allowlistKind === "account") {
		const opened = await cdp.evaluate(`(() => {
			const group = ${RECEIVE_GROUP};
			const label = group && [...group.querySelectorAll("label")].find(
				(node) => node.textContent.trim() === "Allow an agent or person",
			);
			const trigger = label?.parentElement?.querySelector('[role="combobox"]');
			if (!trigger) return false;
			trigger.click();
			return true;
		})()`);
		check(
			"the kind select opened for an account identifier",
			opened === true,
			"no combobox in the allow form",
		);
		await wait(300);
		const picked = await cdp.evaluate(`(() => {
			const option = [...document.querySelectorAll('[role="option"]')].find(
				(node) => node.textContent.trim() === "Person",
			);
			if (!option) return false;
			option.click();
			return true;
		})()`);
		check(
			"the kind select offers Person",
			picked === true,
			"no [role=option] reading Person after the select opened",
		);
		await wait(250);
	}

	const focused = await cdp.evaluate(`(() => {
		const group = ${RECEIVE_GROUP};
		const label = group && [...group.querySelectorAll("label")].find(
			(node) => node.textContent.trim() === "Allow an agent or person",
		);
		const input = label?.control ?? (label?.getAttribute("for") ? document.getElementById(label.getAttribute("for")) : null);
		if (!(input instanceof HTMLInputElement)) return false;
		input.focus();
		return document.activeElement === input;
	})()`);
	check(
		"the allow form's identifier input took focus",
		focused === true,
		"no identifier input in the receive allow form",
	);
	if (focused !== true) return frames;
	await cdp.send("Input.insertText", { text: allowlistId.trim() });
	await wait(150);

	const added = await cdp.evaluate(`(() => {
		const group = ${RECEIVE_GROUP};
		const label = group && [...group.querySelectorAll("label")].find(
			(node) => node.textContent.trim() === "Allow an agent or person",
		);
		const button = label?.parentElement && [...label.parentElement.querySelectorAll("button")].find(
			(node) => node.textContent.trim() === "Add",
		);
		if (!button) return false;
		button.click();
		return true;
	})()`);
	check(
		"the identifier was added to the receive draft",
		added === true,
		"no Add control in the receive allow form",
	);
	const rowAdded = await waitForCondition(
		cdp,
		`${RECEIVE_GROUP}?.textContent?.includes(${JSON.stringify(allowlistId.trim())}) === true`,
		10_000,
	);
	check(
		"the added identifier renders in the receive group",
		rowAdded.ok === true,
		`waited ${rowAdded.waitedMs}ms; the identifier never appeared in the group`,
		`visible after ${rowAdded.waitedMs}ms`,
	);

	const saved = await cdp.evaluate(`(() => {
		const button = [...document.querySelectorAll("button")].find(
			(node) => node.textContent.trim() === "Save reach settings",
		);
		if (!button || button.disabled) return false;
		button.click();
		return true;
	})()`);
	check(
		"Save reach settings was enabled and pressed",
		saved === true,
		"the Save control was missing or disabled after the draft changed",
	);
	if (saved !== true) return frames;
	// The server echoes the policy into `view`; the gate then reads unchanged and
	// the Save control returns to disabled. That is the write landing.
	const listedSaved = await waitForCondition(
		cdp,
		`(() => {
			const group = ${RECEIVE_GROUP};
			const save = [...document.querySelectorAll("button")].find(
				(node) => node.textContent.trim() === "Save reach settings",
			);
			return Boolean(group) && group.getAttribute("data-agent-messages-level") === "listed_only" && Boolean(save) && save.disabled === true;
		})()`,
		20_000,
	);
	await wait(300);
	const afterListed = await cdp.evaluate(AGENT_MESSAGES_FACTS);
	note(
		"the reach editor after the listed-only save",
		JSON.stringify(afterListed),
	);
	check(
		"the server kept the receive direction listed-only",
		listedSaved.ok === true,
		`waited ${listedSaved.waitedMs}ms; level=${JSON.stringify(afterListed.levels)} save still enabled (the write did not land)`,
		JSON.stringify(afterListed),
	);
	await shoot("agent-messages-allowlist-listed");

	// -- g. receive -> class default -----------------------------------------
	const anyoneChosen = await cdp.evaluate(`(() => {
		const group = ${RECEIVE_GROUP};
		if (!group) return false;
		const button = [...group.querySelectorAll("button")].find(
			(node) => node.textContent.trim() === "Anyone in my organization",
		);
		if (!button) return false;
		button.click();
		return true;
	})()`);
	check(
		"the receive direction offers the class default",
		anyoneChosen === true,
		"no 'Anyone in my organization' control in the receive group",
	);
	if (anyoneChosen !== true) return frames;
	const defaultSaved = await cdp.evaluate(`(() => {
		const button = [...document.querySelectorAll("button")].find(
			(node) => node.textContent.trim() === "Save reach settings",
		);
		if (!button || button.disabled) return false;
		button.click();
		return true;
	})()`);
	check(
		"Save reach settings was pressed for the class default",
		defaultSaved === true,
		"the Save control was missing or disabled after choosing the default",
	);
	if (defaultSaved !== true) return frames;
	const backToDefault = await waitForCondition(
		cdp,
		`(() => {
			const group = ${RECEIVE_GROUP};
			const save = [...document.querySelectorAll("button")].find(
				(node) => node.textContent.trim() === "Save reach settings",
			);
			return Boolean(group) && group.getAttribute("data-agent-messages-level") === "class_default" && Boolean(save) && save.disabled === true;
		})()`,
		20_000,
	);
	await wait(300);
	const afterDefault = await cdp.evaluate(AGENT_MESSAGES_FACTS);
	note(
		"the reach editor after the class-default save",
		JSON.stringify(afterDefault),
	);
	check(
		"the server returned the receive direction to the class default",
		backToDefault.ok === true,
		`waited ${backToDefault.waitedMs}ms; level=${JSON.stringify(afterDefault.levels)} (the write did not land)`,
		JSON.stringify(afterDefault),
	);
	await shoot("agent-messages-allowlist-default");

	// -- every frame is a settled PNG ---------------------------------------
	check(
		"every capture is a frame the app held still for, with no toast on it",
		frames.every((frame) => frame.stable === true && frame.toastFree === true),
		frames
			.map(
				(frame) =>
					`${frame.label}: ${frame.stable === true ? `held still after ${frame.attempts} capture(s)` : `never held still in ${frame.attempts} capture(s)`}, toast-free ${frame.toastFree === true}`,
			)
			.join(" | "),
	);
	check(
		"every capture wrote a PNG of the requested size",
		frames.every(
			(frame) =>
				frame.bytes > 1000 &&
				frame.pixels.width ===
					frame.viewport.width * frame.viewport.devicePixelRatio &&
				frame.pixels.height ===
					frame.viewport.height * frame.viewport.devicePixelRatio,
		),
		frames
			.map(
				(frame) =>
					`${frame.label}: ${frame.pixels.width}x${frame.pixels.height}, ${frame.bytes}B`,
			)
			.join(" | "),
	);
	return frames;
}
