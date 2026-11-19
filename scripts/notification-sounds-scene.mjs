/**
 * Settings -> Notifications -> Sound, driven in the BUILT app against a live,
 * isolated daemon (local-operator #3403). A renderer-driver scene:
 *
 *     LOCAL_OPERATOR_DESKTOP_TOKEN=... node scripts/renderer-driver.mjs \
 *       --scene notification-sounds --backend http://127.0.0.1:<port> \
 *       --backend-records <config>/run/serve --sound-ok <file> --sound-long <file> \
 *       --out <dir> --clean
 *
 * WHY A SCENE AND NOT ONLY STORIES. Stories show every state with preset data;
 * this shows the daemon's own answers reaching the section: the listing, the
 * gain-baked preview render, the write funnel, a real upload accepted and one
 * refused `too_long`, a rename and the remove of the SELECTED sound whose
 * `selection_reset` moves the radio back to Soft pulse. Each step reads the
 * daemon back over HTTP, so a frame never stands in for a side effect.
 *
 * NOTHING REACHES THE SPEAKERS. Before the first press the scene mutes every
 * media element the page creates (`HTMLMediaElement.prototype.play` sets
 * `muted` first). The engine still runs its whole path - the fetch, the blob,
 * `play()` resolving - so "preview started" is a real reading.
 *
 * Upload uses CDP `DOM.setFileInputFiles` on the section's own hidden input:
 * the same `change` event a picked file raises, without the native dialog
 * (which a headless window cannot show).
 */

const LIST = "[data-notification-sound-group]";

export async function sceneNotificationSounds({
	cdp,
	verb,
	capture,
	check,
	note,
	wait,
	waitForCondition,
	clickAt,
	backend,
	token,
	soundOk,
	soundLong,
}) {
	check(
		"this scene runs against a live, isolated backend",
		Boolean(backend && token),
		"needs --backend and LOCAL_OPERATOR_DESKTOP_TOKEN",
	);
	if (!backend || !token) return [];
	const api = async (path, init = {}) => {
		const response = await fetch(`${backend}${path}`, {
			...init,
			headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
		});
		const text = await response.text();
		let body = null;
		try {
			body = JSON.parse(text);
		} catch {}
		return { status: response.status, body };
	};
	const listing = async () =>
		(await api("/v1/notification-sounds")).body?.result ?? null;
	const radioState = (id) =>
		cdp.evaluate(
			`(document.querySelector('[data-sound-row=${JSON.stringify(id)}] [role="radio"]') || {}).getAttribute?.('data-state') ?? null`,
		);
	const frames = [];
	/* CDP replies carry the payload under `result` (`CdpClient.send`). */
	const setFiles = async (path) => {
		const doc = (await cdp.send("DOM.getDocument", { depth: -1, pierce: true }))
			.result;
		const input = (
			await cdp.send("DOM.querySelector", {
				nodeId: doc.root.nodeId,
				selector: `${LIST} input[type="file"]`,
			})
		).result;
		await cdp.send("DOM.setFileInputFiles", {
			nodeId: input.nodeId,
			files: [path],
		});
	};

	/* Mute before anything can play (see the module comment). */
	await cdp.evaluate(`(() => {
		const play = HTMLMediaElement.prototype.play;
		window.__nsPlayed = [];
		HTMLMediaElement.prototype.play = function () {
			this.muted = true;
			this.volume = 0;
			window.__nsPlayed.push(String(this.src || ''));
			return play.call(this);
		};
		return true;
	})()`);

	await verb(cdp, "navigate", "/settings");
	await verb(cdp, "setTheme", "localOperatorDark");
	const { ok: ready } = await waitForCondition(
		cdp,
		`Boolean(document.querySelector('${LIST} [data-sound-row="soft-pulse"] [role="radio"]'))`,
		20_000,
	);
	check(
		"the Sound group rendered from the daemon's listing",
		ready === true,
		"no soft-pulse radio",
	);
	if (ready !== true) {
		note(
			"what the page shows instead",
			await cdp.evaluate(
				`JSON.stringify({ hash: location.hash, section: (document.querySelector('[data-search-section="notifications"]') || {}).textContent?.slice(0, 400) ?? null, body: document.body.innerText.slice(0, 600) })`,
			),
		);
		frames.push(await capture(cdp, "live-00-not-ready"));
		return frames;
	}
	await cdp.evaluate(
		`document.querySelector('${LIST}').scrollIntoView({ block: 'start' }); true`,
	);
	await wait(400);
	const before = await listing();
	note(
		"daemon listing at rest",
		JSON.stringify({
			selected: before?.selected,
			volume: before?.volume,
			enabled: before?.enabled,
			count: before?.sounds?.length,
		}),
	);
	check(
		"first load selects the daemon's default at 70",
		before?.selected === "soft-pulse" && before?.volume === 70,
		JSON.stringify(before && { s: before.selected, v: before.volume }),
	);
	frames.push(await capture(cdp, "live-01-rest"));

	/*
	 * VOLUME BURSTS (review/QA round 3, M4 / Q9), with the reviewer's timing:
	 * each key is held 80 ms and released, then the next follows after `gap`.
	 * A step still held when the previous save lands used to be undone. Run
	 * only when NS_BURSTS=1, so the standard scene stays as it was.
	 */
	if (process.env.NS_BURSTS === "1") {
		const RANGE = `${LIST} input[type="range"]`;
		const press = async (key, code, vk) => {
			await cdp.send("Input.dispatchKeyEvent", {
				type: "keyDown",
				key,
				code,
				windowsVirtualKeyCode: vk,
			});
			await wait(80);
			await cdp.send("Input.dispatchKeyEvent", {
				type: "keyUp",
				key,
				code,
				windowsVirtualKeyCode: vk,
			});
		};
		const LEFT = ["ArrowLeft", "ArrowLeft", 37];
		const RIGHT = ["ArrowRight", "ArrowRight", 39];
		const settleTo = async () => {
			await wait(1500);
			return {
				daemon: (await listing())?.volume,
				thumb: Number(
					await cdp.evaluate(`document.querySelector('${RANGE}').value`),
				),
			};
		};
		const setDaemon = async (v) => {
			await api("/v1/settings/notifications.sound.volume", {
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ value: v }),
			});
			await wait(1500);
		};
		const results = [];
		for (let run = 1; run <= 5; run += 1) {
			await setDaemon(70);
			await cdp.evaluate(`document.querySelector('${RANGE}').focus(); true`);
			await press(...LEFT);
			await wait(50);
			await press(...RIGHT);
			const end = await settleTo();
			results.push({
				run,
				pattern: "<- then -> (50 ms gap)",
				want: 70,
				...end,
			});
		}
		for (let run = 1; run <= 3; run += 1) {
			await setDaemon(10);
			await cdp.evaluate(`document.querySelector('${RANGE}').focus(); true`);
			for (let i = 0; i < 4; i += 1) {
				await press(...RIGHT);
				if (i < 3) await wait(70);
			}
			const end = await settleTo();
			results.push({ run, pattern: "-> x4 (70 ms gap)", want: 30, ...end });
		}
		for (const r of results)
			note(`burst ${r.pattern} run ${r.run}`, JSON.stringify(r));
		check(
			"every burst ends at the value the user left (daemon and thumb)",
			results.every((r) => r.daemon === r.want && r.thumb === r.want),
			JSON.stringify(results.map((r) => [r.daemon, r.thumb, r.want])),
		);
		return frames;
	}

	/* 1. SELECT: plays once, writes once after the debounce. */
	await clickAt(cdp, '[data-sound-row="felt-marimba"]');
	await wait(1200);
	const played1 = await cdp.evaluate("window.__nsPlayed.length");
	const afterSelect = await listing();
	check(
		"selecting Felt marimba played a preview (muted)",
		played1 >= 1,
		`played=${played1}`,
	);
	check(
		"the daemon stored notifications.sound.id = felt-marimba",
		afterSelect?.selected === "felt-marimba",
		afterSelect?.selected,
	);
	check(
		"the radio is checked",
		(await radioState("felt-marimba")) === "checked",
		"",
	);
	frames.push(await capture(cdp, "live-02-selected"));

	/* 2. PREVIEW: the row's own button, as the audio route answers it. */
	const previewAudio = await api(
		"/v1/notification-sounds/two-note-chime/audio?volume=70",
	);
	note("audio route", `status=${previewAudio.status}`);
	const beforePreview = await cdp.evaluate("window.__nsPlayed.length");
	const selectedBeforePreview = (await listing())?.selected;
	await clickAt(cdp, '[data-preview="two-note-chime"]');
	await wait(300);
	const pressed = await cdp.evaluate(
		`(document.querySelector('[data-preview="two-note-chime"]') || {}).getAttribute?.('aria-pressed') ?? null`,
	);
	frames.push(await capture(cdp, "live-03-preview"));
	const afterPreview = await cdp.evaluate("window.__nsPlayed.length");
	check(
		"the preview button started playback",
		afterPreview > beforePreview,
		`${beforePreview} -> ${afterPreview}`,
	);
	note("preview button aria-pressed while playing", String(pressed));
	await wait(700);
	const radioAfterPreview = await radioState("two-note-chime");
	const selectedAfterPreview = (await listing())?.selected;
	check(
		"preview did not change the selection",
		selectedAfterPreview === selectedBeforePreview &&
			radioAfterPreview !== "checked",
		`${selectedBeforePreview} -> ${selectedAfterPreview}; two-note-chime radio=${radioAfterPreview}`,
	);
	await wait(1600);

	/* 3. VOLUME: keyboard on the slider. Each step commits, and focus STAYS
	 *    on the range across all of them (QA Q1 / UX U1: it used to fall to
	 *    <body> after the first, so the second press did nothing). */
	const RANGE = `${LIST} input[type="range"]`;
	await cdp.evaluate(`document.querySelector('${RANGE}').focus(); true`);
	const focusTrail = [];
	for (let i = 0; i < 4; i += 1) {
		await cdp.send("Input.dispatchKeyEvent", {
			type: "keyDown",
			key: "ArrowLeft",
			code: "ArrowLeft",
			windowsVirtualKeyCode: 37,
		});
		await cdp.send("Input.dispatchKeyEvent", {
			type: "keyUp",
			key: "ArrowLeft",
			code: "ArrowLeft",
			windowsVirtualKeyCode: 37,
		});
		await wait(250);
		focusTrail.push(
			await cdp.evaluate(
				`document.activeElement === document.querySelector('${RANGE}')`,
			),
		);
	}
	await wait(1500);
	const vol = (await listing())?.volume;
	note(
		"focus on the range after each ArrowLeft; daemon volume",
		JSON.stringify({ focusTrail, vol }),
	);
	check(
		"focus stayed on the volume slider across four key steps",
		focusTrail.every(Boolean),
		JSON.stringify(focusTrail),
	);
	check("all four steps of 5 were written: 70 -> 50", vol === 50, String(vol));
	frames.push(await capture(cdp, "live-04-volume"));

	/* 3b. SWITCH: Space twice on Play a sound keeps focus; both writes land. */
	const SWITCH = `[data-search-row="notifications.sound.enabled"] [role="switch"]`;
	await cdp.evaluate(`document.querySelector('${SWITCH}').focus(); true`);
	const switchTrail = [];
	for (let i = 0; i < 2; i += 1) {
		await cdp.send("Input.dispatchKeyEvent", {
			type: "keyDown",
			key: " ",
			code: "Space",
			windowsVirtualKeyCode: 32,
			text: " ",
		});
		await cdp.send("Input.dispatchKeyEvent", {
			type: "keyUp",
			key: " ",
			code: "Space",
			windowsVirtualKeyCode: 32,
		});
		await wait(400);
		switchTrail.push(
			await cdp.evaluate(
				`document.activeElement === document.querySelector('${SWITCH}')`,
			),
		);
	}
	await wait(800);
	const enabledAfter = (await listing())?.enabled;
	note(
		"focus on the switch after each Space; daemon enabled",
		JSON.stringify({ switchTrail, enabledAfter }),
	);
	check(
		"focus stayed on Play a sound across two Space presses",
		switchTrail.every(Boolean),
		JSON.stringify(switchTrail),
	);
	check(
		"two toggles land back on enabled",
		enabledAfter === true,
		String(enabledAfter),
	);

	/* 3c. LIVE CONFIG (UX U2): an outside write reaches the open page. */
	const outsideWrite = await api("/v1/settings/notifications.sound.id", {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ value: "airy-whistle" }),
	});
	note(
		"outside write",
		JSON.stringify({
			status: outsideWrite.status,
			daemonSelected: (await listing())?.selected,
		}),
	);
	const { ok: followed } = await waitForCondition(
		cdp,
		`(document.querySelector('[data-sound-row="airy-whistle"] [role="radio"]') || {}).getAttribute?.('data-state') === 'checked'`,
		5000,
	);
	check(
		"an outside selection moved the radio without leaving the page",
		followed === true,
		"",
	);
	if (followed !== true)
		note(
			"radio states after the outside write",
			await cdp.evaluate(
				`JSON.stringify([...document.querySelectorAll('${LIST} [role="radio"][data-state="checked"]')].map((n) => n.id))`,
			),
		);
	const outsidePlays = await cdp.evaluate("window.__nsPlayed.length");
	await wait(300);
	check(
		"and it did not play",
		(await cdp.evaluate("window.__nsPlayed.length")) === outsidePlays,
		"",
	);

	/* 4. UPLOAD OK: one file -> added, selected, played. */
	await setFiles(soundOk);
	await waitForCondition(
		cdp,
		`!document.querySelector('[data-pending-phase]')`,
		20_000,
	);
	await wait(1500);
	const afterOk = await listing();
	const added = afterOk?.sounds?.find((s) => !s.builtin);
	note(
		"daemon after the accepted upload",
		JSON.stringify({
			selected: afterOk?.selected,
			custom: afterOk?.sounds
				?.filter((s) => !s.builtin)
				.map((s) => [s.id, s.label, s.duration_s]),
		}),
	);
	check("the accepted file is a custom sound", Boolean(added), "");
	check(
		"and it is the selection now",
		added && afterOk.selected === added.id,
		afterOk?.selected,
	);
	frames.push(await capture(cdp, "live-05-upload-ok"));

	/* 5. UPLOAD too_long: refused with its own sentence, nothing added. */
	await setFiles(soundLong);
	const { ok: refused } = await waitForCondition(
		cdp,
		`Boolean(document.querySelector('[data-pending-phase="error"]'))`,
		30_000,
	);
	const refusalText = await cdp.evaluate(
		`(document.querySelector('[data-pending-phase="error"]') || {}).textContent ?? ''`,
	);
	note("the refusal row", refusalText);
	check("the over-length file became an error row", refused === true, "");
	check(
		"its sentence names the length and the 10 s limit (too_long, never trimmed)",
		/seconds long\. Sounds can be up to 10 seconds\./.test(refusalText),
		refusalText,
	);
	const afterLong = await listing();
	check(
		"the daemon holds still one custom sound",
		afterLong?.sounds?.filter((s) => !s.builtin).length === 1,
		"",
	);
	frames.push(await capture(cdp, "live-06-upload-too-long"));
	await clickAt(cdp, '[data-pending-phase="error"] button[aria-label]');
	await wait(300);

	/* 6. RENAME through the row's menu. */
	const id = added.id;
	await clickAt(cdp, `[data-sound-row="${id}"] button[aria-haspopup="menu"]`);
	await wait(300);
	await cdp.evaluate(
		`(() => { const item = [...document.querySelectorAll('[role="menuitem"]')].find((n) => n.textContent.trim() === 'Rename'); item.click(); return true; })()`,
	);
	await waitForCondition(
		cdp,
		`Boolean(document.querySelector('[data-row-mode="renaming"] input'))`,
		3000,
	);
	await wait(200);
	await cdp.evaluate(
		`(() => { const f = document.querySelector('[data-row-mode="renaming"] input'); f.focus(); f.select(); return true; })()`,
	);
	await cdp.send("Input.insertText", { text: "Desk bell" });
	frames.push(await capture(cdp, "live-07-renaming"));
	await cdp.send("Input.dispatchKeyEvent", {
		type: "keyDown",
		key: "Enter",
		code: "Enter",
		windowsVirtualKeyCode: 13,
		text: "\r",
	});
	await cdp.send("Input.dispatchKeyEvent", {
		type: "keyUp",
		key: "Enter",
		code: "Enter",
		windowsVirtualKeyCode: 13,
	});
	await waitForCondition(
		cdp,
		`!document.querySelector('[data-row-mode="renaming"]')`,
		5000,
	);
	await wait(600);
	const renamed = (await listing())?.sounds?.find((s) => s.id === id);
	check(
		"the daemon stored the new name",
		renamed?.label === "Desk bell",
		renamed?.label,
	);
	frames.push(await capture(cdp, "live-08-renamed"));

	/* 7. REMOVE the SELECTED sound: the confirm names Soft pulse first. */
	await clickAt(cdp, `[data-sound-row="${id}"] button[aria-haspopup="menu"]`);
	await wait(300);
	await cdp.evaluate(
		`(() => { const item = [...document.querySelectorAll('[role="menuitem"]')].find((n) => n.textContent.trim().startsWith('Remove')); item.click(); return true; })()`,
	);
	await waitForCondition(
		cdp,
		`Boolean(document.querySelector('[data-row-mode="confirm-remove"]'))`,
		3000,
	);
	await wait(200);
	const confirmText = await cdp.evaluate(
		`document.querySelector('[data-row-mode="confirm-remove"]').textContent`,
	);
	check(
		"the confirm names the fallback before the act",
		/current sound, so Soft pulse plays instead/.test(confirmText),
		confirmText,
	);
	frames.push(await capture(cdp, "live-09-remove-confirm"));
	const playedBeforeRemove = await cdp.evaluate("window.__nsPlayed.length");
	await cdp.evaluate(
		`(() => { const b = [...document.querySelectorAll('[data-row-mode="confirm-remove"] button')].find((n) => n.textContent.trim() === 'Remove'); b.click(); return true; })()`,
	);
	await waitForCondition(
		cdp,
		`!document.querySelector('[data-sound-row="${id}"]')`,
		5000,
	);
	await wait(800);
	const afterRemove = await listing();
	check(
		"the daemon reset the selection to soft-pulse",
		afterRemove?.selected === "soft-pulse",
		afterRemove?.selected,
	);
	check(
		"the radio moved to Soft pulse",
		(await radioState("soft-pulse")) === "checked",
		"",
	);
	check(
		"the reset did not play",
		(await cdp.evaluate("window.__nsPlayed.length")) === playedBeforeRemove,
		"",
	);
	const announced = await cdp.evaluate(
		`[...document.querySelectorAll('${LIST} output')].map((n) => n.textContent).join(' | ')`,
	);
	note("live region after remove", announced);
	frames.push(await capture(cdp, "live-10-removed"));
	return frames;
}
