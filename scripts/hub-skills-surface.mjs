/**
 * The Hub Skills SURFACE scene: the frames this QA pass needs, and nothing else.
 *
 * WHY A SEPARATE SCENE. `--scene hub-skills` proves the surface's shape against
 * a backend FIXTURE and asserts a signed-in pull succeeds; this pass drives the
 * REAL core, where the app is signed out, so that scene stops at its gated pull
 * and never photographs the states this matrix is about. What is reused here is
 * the driver's own launch/attach/capture plumbing (imported, not copied), so the
 * app is still the real built Electron in headless window mode, and the frames
 * are still its own `capturePage`.
 *
 * USAGE (the app must be pointed at a real core; the hub stub is what the
 * BUILD's VITE_RADIENT_SERVER_BASE_URL names):
 *   QA_BACKEND=http://127.0.0.1:8131 QA_FRAMES=/abs/frames \
 *     LOCAL_OPERATOR_DESKTOP_TOKEN=rig node scripts/hub-skills-surface.mjs
 *
 * It asserts nothing about the product's correctness: it observes, records the
 * exact text it found, and leaves the verdicts to the matrix. A missing element
 * is reported as `null`, never thrown — an absent control is a finding, not a
 * harness crash.
 */

process.argv.push(
	"--backend",
	process.env.QA_BACKEND ?? "",
	"--out",
	process.env.QA_FRAMES ?? "",
);

const { rendererDriverApi } = await import("./renderer-driver.mjs");
const {
	CdpClient,
	launchApp,
	prepareDriverContext,
	waitForDevtools,
	waitForPage,
	waitForBridge,
	verb,
	capture,
	reapLiveBoots,
} = rendererDriverApi;

const BACKEND = process.env.QA_BACKEND;
prepareDriverContext({ apiUrl: BACKEND });

const observations = {};
const handle = await launchApp({ armed: true, tag: "surface" });
let cdp;
try {
	await waitForDevtools(handle);
	cdp = await CdpClient.attach(handle.port, "out/renderer/index.html");
	await waitForPage(cdp);
	await waitForBridge(cdp);

	const text = async (selector) =>
		cdp.evaluate(
			`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? el.textContent.trim() : null; })()`,
		);
	const present = async (selector) =>
		cdp.evaluate(
			`(() => Boolean(document.querySelector(${JSON.stringify(selector)})))()`,
		);
	const attr = async (selector, name) =>
		cdp.evaluate(
			`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? el.getAttribute(${JSON.stringify(name)}) : null; })()`,
		);
	const waitFor = async (expr, timeoutMs) => {
		const started = Date.now();
		for (;;) {
			const value = await cdp.evaluate(expr);
			if (value) return { ok: true, value, waitedMs: Date.now() - started };
			if (Date.now() - started > timeoutMs)
				return { ok: false, value, waitedMs: Date.now() - started };
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
	};

	await verb(cdp, "navigate", "/agent-hub");

	/*
	 * THE APP IS SIGNED OUT. Its "Connect an AI account" dialog is a real state,
	 * not noise — but it OCCLUDES the surface, so the frames would photograph a
	 * modal instead of the thing under test. Dismissing it is the same click a
	 * person makes ("Skip for now"); the signed-out gating it leaves behind is
	 * exactly what the matrix then records.
	 *
	 * RETRIED, because the dialog mounts AFTER the route does: a single attempt
	 * fired on the first frame found no button and left the dialog covering every
	 * capture (measured — the first run's `connectDialogDismissedBy` was null and
	 * the frames showed the modal).
	 */
	const dismissConnect = async () => {
		const started = Date.now();
		for (;;) {
			const result = await cdp.evaluate(`(() => {
				const button = Array.from(document.querySelectorAll('button')).find(
					(el) => /skip for now/i.test(el.textContent || ''),
				);
				if (button) { button.click(); return { clicked: button.textContent.trim() }; }
				const dialog = document.querySelector('[role="dialog"]');
				return { clicked: null, dialog: Boolean(dialog) };
			})()`);
			if (result?.clicked) return result.clicked;
			if (Date.now() - started > 8_000) return null;
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
	};
	observations.connectDialogDismissedBy = await dismissConnect();
	const dialogGone = await waitFor(
		`(() => (!document.querySelector('[role="dialog"]') ? true : null))()`,
		6_000,
	);
	observations.connectDialogGone = dialogGone.ok;

	/*
	 * DISMISSING THE ONBOARDING DIALOG LEAVES THE ROUTE. Measured: after the
	 * click the tab list was empty and no library existed — the app had moved
	 * off `/agent-hub`. Navigating again is what a person does next, and it also
	 * proves the surface is reachable WITHOUT the dialog on the second mount.
	 */
	await verb(cdp, "navigate", "/agent-hub");
	await waitFor(
		`(() => (document.querySelector('[role="tab"]') ? true : null))()`,
		10_000,
	);

	observations.tabs = await cdp.evaluate(`(() =>
		Array.from(document.querySelectorAll('[role="tab"]')).map((el) => el.textContent.trim())
	)()`);
	observations.skillsTabPresent = await present(
		'[data-testid="agent-hub-view-skills"]',
	);
	await capture(cdp, "surface-tabs");

	if (observations.skillsTabPresent) {
		await verb(cdp, "press", '[data-testid="agent-hub-view-skills"]');
		const rows = await waitFor(
			`(() => {
				const cards = document.querySelectorAll('[data-testid="hub-skill-open"]');
				return cards.length > 0 ? cards.length : null;
			})()`,
			20_000,
		);
		observations.cards = rows.value ?? 0;
		await capture(cdp, "surface-cards");

		observations.libraryText =
			(await text("[data-hub-skills-library]"))?.slice(0, 1200) ?? null;
		observations.sourceLine = await text('[data-testid="hub-skill-source"]');
		observations.cardTexts = await cdp.evaluate(`(() =>
			Array.from(document.querySelectorAll('[data-testid="hub-skill-open"]')).map(
				(el) => el.textContent.trim(),
			)
		)()`);

		if (rows.ok) {
			const pressed = await verb(
				cdp,
				"press",
				'[data-testid="hub-skill-open"]',
			);
			observations.cardHitTest = pressed.hitTest ?? null;
			const detail = await waitFor(
				`(() => Boolean(document.querySelector('[data-testid="hub-skill-description"]')) || null)()`,
				15_000,
			);
			observations.detailOpened = detail.ok;
			await new Promise((resolve) => setTimeout(resolve, 700));
			await capture(cdp, "surface-detail");

			observations.detail = {
				description: await text('[data-testid="hub-skill-description"]'),
				localPath: await text('[data-testid="hub-skill-local-path"]'),
				/*
				 * The alias is the skill's own name now: the separate alias field
				 * belonged to the three-acts form that the design round removed.
				 */
				alias: await text('[data-testid="hub-skill-detail-name"]'),
				fileSummaries: await cdp.evaluate(`(() =>
					Array.from(document.querySelectorAll('[data-hub-skill-detail] details summary')).map(
						(el) => el.textContent.trim(),
					)
				)()`),
				panelText:
					(await text("[data-hub-skills-library]"))?.slice(0, 1600) ?? null,
			};

			/*
			 * THE DOWNLOAD CONTROL'S STATE, read rather than assumed: the matrix's
			 * claim is about whether a signed-out person can pull a PUBLIC skill,
			 * and the answer is the control's own disabled flag plus the sentence
			 * the panel prints beside it.
			 */
			observations.download = {
				present: await present('[data-testid="hub-skill-download"]'),
				disabled: await cdp.evaluate(
					`(() => { const el = document.querySelector('[data-testid="hub-skill-download"]'); return el ? el.disabled === true : null; })()`,
				),
				label: await text('[data-testid="hub-skill-download"]'),
			};
			observations.subscribeButton = {
				present: await present('[data-testid="hub-skill-subscribe"]'),
				disabled: await cdp.evaluate(
					`(() => { const el = document.querySelector('[data-testid="hub-skill-subscribe"]'); return el ? el.disabled === true : null; })()`,
				),
			};
			observations.noCredentialSentence = await cdp.evaluate(`(() => {
				const nodes = Array.from(document.querySelectorAll('[data-hub-skills-library] p'));
				const hit = nodes.find((p) => /credential|sign in|signed in/i.test(p.textContent || ''));
				return hit ? hit.textContent.trim() : null;
			})()`);
			/*
			 * The download control sits BELOW the fold on a 1380x900 viewport, so a
			 * capture without scrolling photographed the detail's top half twice
			 * (measured: frames 03 and 04 were byte-identical). Bring the control
			 * into view first — the frame's job is to show the gated button and the
			 * sentence beside it.
			 */
			await cdp.evaluate(`(() => {
				const el = document.querySelector('[data-testid="hub-skill-download"]');
				if (el) el.scrollIntoView({ block: 'center' });
				return true;
			})()`);
			await new Promise((resolve) => setTimeout(resolve, 500));
			observations.downloadInView = await cdp.evaluate(`(() => {
				const el = document.querySelector('[data-testid="hub-skill-download"]');
				if (!el) return null;
				const r = el.getBoundingClientRect();
				return { top: Math.round(r.top), bottom: Math.round(r.bottom), viewport: window.innerHeight };
			})()`);
			await capture(cdp, "surface-download-state");
		}
	}

	console.log(JSON.stringify({ backend: BACKEND, observations }, null, 2));
	console.log(`frames: ${process.env.QA_FRAMES}`);
} catch (error) {
	console.log(
		JSON.stringify(
			{ backend: BACKEND, error: error?.stack ?? String(error), observations },
			null,
			2,
		),
	);
}

cdp?.close();
await reapLiveBoots({ code: 0, why: "surface scene done" });
