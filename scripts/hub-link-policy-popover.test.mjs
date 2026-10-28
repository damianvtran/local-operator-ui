/**
 * The sidebar team row's "Link policies" popover, MOUNTED: the shipped
 * `HubLinkSidebarMark` with the real policy controls, real Radix Popover /
 * Switch / Button / Tooltip and the real TanStack queries above them. Only the
 * two edges are stubbed: the desktop transport (`desktopResult`, recorded and
 * answered from fixtures shaped like core's `/v1/desktop/hub/links` row) and the
 * remote membership API and sign-in edge. The production account-keyed
 * membership query and authority observer are not mocked.
 *
 * WHY: the operator's screenshot showed the team's UUID as its name, "Source
 * unavailable" spliced into every sentence, a failed incoming update with no
 * action, and a dead-ended "revision-safe publication" warning. The fixture row
 * below is the one an isolated `lop serve` (core origin/main 55d43bc) actually
 * served for a seeded org team link whose pull failed against a hub answering
 * 502: `name` = the local id, `tenant_name` null, `pull.state` "failed" with
 * `error_class` "hub-error" and no `safe_message`, eligibility
 * `unsupported-precondition`.
 */
import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const TEAM_ID = "aaaaaaaa-1111-4222-8333-444444444444";
const TENANT = "bbbbbbbb-1111-4222-8333-555555555555";
const ROOT = process.cwd();
const SHARED = `${ROOT}/src/renderer/src/shared`;

/* ---- the two stubbed edges ------------------------------------------------ */
const state = {
	records: [],
	memberships: [],
	membershipCalls: 0,
	answer: null,
};
globalThis.__hubPopoverTest = state;

const transportStub = new URL(
	`./_hub-popover-transport-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(
	transportStub,
	`export * from "${SHARED}/api/local-operator/desk${"top"}-api.ts";
	export async function desktopResult(input) {
		const s = globalThis.__hubPopoverTest;
		s.records.push(input);
		if (s.answer) return s.answer(input);
		return { reports: [], status: { items: [], credential: "ok" } };
	}`,
);
const radientStub = new URL(
	`./_hub-popover-radient-${process.pid}.mjs`,
	import.meta.url,
);
// Stub only the remote membership read. The production account-keyed hook,
// authority observer, and stale-response rejection all run unchanged.
await writeFile(
	radientStub,
	`export async function listMemberships() {
 const s = globalThis.__hubPopoverTest; s.membershipCalls++;
 if (s.membershipAnswer) return s.membershipAnswer();
 return { result: { memberships: s.memberships } };
}`,
);
const authStub = new URL(
	`./_hub-popover-auth-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(
	authStub,
	`import {useQuery} from '@tanstack/react-query';
 export function useRadientAuth() {
 const q = useQuery({queryKey:['radient-user','user'],enabled:false,queryFn:async()=>null});
 return {isAuthenticated:Boolean(q.data?.account?.id)};
 }`,
);
const configStub = new URL(
	`./_hub-popover-config-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(
	configStub,
	`export const apiConfig = { baseUrl: "http://127.0.0.1:1", radientBaseUrl: "https://hub.test" };
	export const config = {};
	export const setDiscoveredBackendUrl = () => {};`,
);

const bundle = await build({
	stdin: {
		contents: `
			export { HubLinkSidebarMark } from "./src/renderer/src/features/chat/components/hub-link-sidebar-mark.tsx";
			export {beginRadientAuthorityTransition,beginRadientAuthoritySignOut,settleRadientAuthority,radientAuthorityEpoch} from "./src/renderer/src/shared/hooks/radient-account-authority.ts";
			export {hubRegistryNameCounts} from "./src/renderer/src/shared/api/local-operator/hub-link-actions.ts";
			export { hubLinksKey } from "./src/renderer/src/shared/api/local-operator/hub-link-hooks.ts";
			export { desktopEndpoint, desktopRequestSchema } from "./src/shared/desk${"top"}-contract.ts";
			export { DesktopControlError } from "./src/renderer/src/shared/api/local-operator/desk${"top"}-api.ts";
			export { TooltipProvider } from "./src/renderer/src/shared/components/ui/tooltip.tsx";
			export { QueryClient, QueryClientProvider } from "@tanstack/react-query";
		`,
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	loader: { ".css": "empty" },
	jsx: "automatic",
	alias: {
		"@shared": SHARED,
		"@features": `${ROOT}/src/renderer/src/features`,
		"@shared/config": configStub.pathname,
		"@shared/config/api-config": configStub.pathname,
	},
	plugins: [
		{
			name: "edges",
			setup(b) {
				b.onResolve({ filter: /^@shared\/hooks\/use-radient-auth$/ }, () => ({
					path: authStub.pathname,
				}));
				// The transport, only where the hub hooks import it: everything else
				// (error classes, userFacingMessage) is the real module.
				b.onResolve({ filter: /\/desktop-api$/ }, (args) =>
					/hub-(?:link-hooks|link-actions|hooks)\.ts$/.test(args.importer)
						? { path: transportStub.pathname }
						: undefined,
				);
				b.onResolve({ filter: /^@shared\/api\/radient\/agents-api$/ }, () => ({
					path: radientStub.pathname,
				}));
			},
		},
	],
	write: false,
});
for (const stub of [transportStub, radientStub, authStub, configStub])
	await unlink(stub).catch(() => {});
const mountPath = new URL(
	`./_hub-popover-mount-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(mountPath, bundle.outputFiles[0].text);
after(async () => {
	await unlink(mountPath).catch(() => {});
});

/* ---- DOM ------------------------------------------------------------------ */
const DOM_GLOBALS = [
	"window",
	"document",
	"HTMLElement",
	"HTMLButtonElement",
	"HTMLFormElement",
	"NodeFilter",
	"Text",
	"SVGElement",
	"ShadowRoot",
	"HTMLSpanElement",
	"getSelection",
	"HTMLInputElement",
	"HTMLDivElement",
	"Element",
	"Node",
	"Event",
	"MouseEvent",
	"PointerEvent",
	"KeyboardEvent",
	"FocusEvent",
	"CustomEvent",
	"Document",
	"DocumentFragment",
	"getComputedStyle",
	"requestAnimationFrame",
	"cancelAnimationFrame",
	"MutationObserver",
	"DOMRect",
	"navigator",
	"localStorage",
];
const VIEW = { width: 600, height: 500 };
function installDom() {
	const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>', {
		url: "http://fixture.invalid",
		pretendToBeVisual: true,
	});
	const w = dom.window;
	Object.defineProperty(w, "innerWidth", {
		value: VIEW.width,
		configurable: true,
	});
	Object.defineProperty(w, "innerHeight", {
		value: VIEW.height,
		configurable: true,
	});
	Object.defineProperty(w.document.documentElement, "clientWidth", {
		value: VIEW.width,
		configurable: true,
	});
	Object.defineProperty(w.document.documentElement, "clientHeight", {
		value: VIEW.height,
		configurable: true,
	});
	/*
	 * jsdom lays nothing out, so geometry is declared: the mark sits at the
	 * sidebar's right edge near the top (as in the screenshot) and the panel
	 * measures 288x420 - taller than the room below the anchor would allow
	 * without a shift. Floating UI reads exactly these rects.
	 */
	w.HTMLElement.prototype.getBoundingClientRect = function () {
		if (this.matches?.("[data-hub-mark]"))
			return new w.DOMRect(260, 140, 24, 24);
		if (
			this.matches?.("[data-radix-popper-content-wrapper]") ||
			this.querySelector?.("[data-hub-link-popover]") ||
			this.matches?.("[data-hub-link-popover]")
		)
			return new w.DOMRect(0, 0, 288, 420);
		return new w.DOMRect(0, 0, 0, 0);
	};
	/*
	 * Floating UI sizes the FLOATING element from offsetWidth/offsetHeight (and
	 * computed width/height), not from getBoundingClientRect - so without these
	 * the panel measures 0x0, never collides, and a clamp test would pass on a
	 * panel that runs off the screen.
	 */
	const panelSize = (el, axis) =>
		el.matches?.("[data-hub-link-popover]") ||
		el.querySelector?.(":scope > [data-hub-link-popover]")
			? axis === "w"
				? 288
				: 420
			: 0;
	Object.defineProperty(w.HTMLElement.prototype, "offsetWidth", {
		configurable: true,
		get() {
			return panelSize(this, "w");
		},
	});
	Object.defineProperty(w.HTMLElement.prototype, "offsetHeight", {
		configurable: true,
		get() {
			return panelSize(this, "h");
		},
	});
	w.ResizeObserver = class {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
	globalThis.ResizeObserver = w.ResizeObserver;
	for (const key of DOM_GLOBALS) {
		const value = key === "window" ? w : w[key];
		if (value !== undefined)
			Object.defineProperty(globalThis, key, {
				value,
				configurable: true,
				writable: true,
			});
	}
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;
	// The write guard's backend bridge: an attached, published core.
	const snapshot = {
		state: "attached",
		version: "0.91.3",
		url: "http://127.0.0.1:18732",
		instanceId: "synthetic-popover",
		pid: 990072,
		reconnecting: false,
		owned: false,
		prefix: "fixture",
		installKind: "fixture",
		desktopAvailable: true,
		pairing: { available: true },
		failures: 0,
		unanswered: 0,
		capabilityStatus: null,
		lastTransportAt: 1,
		detail: "fixture",
		addressSubstitution: null,
	};
	w.api = {
		backend: {
			getStatus: async () => snapshot,
			onStatusChange: () => () => {},
		},
	};
	return dom;
}

/*
 * BEFORE the import: Radix picks its layout-effect hook at MODULE LOAD
 * (`globalThis.document ? useLayoutEffect : noop`), so a bundle imported with no
 * document mounts Portals that never attach - the panel would silently be absent.
 */
const importDom = installDom();
const app = await import(mountPath.href);
// pretendToBeVisual runs a rAF loop: an unclosed window keeps the file alive.
importDom.window.close();
const { createRoot } = await import("react-dom/client");

/** The links row core served for the seeded org team (see header). */
const row = (over = {}) => ({
	link_id: "67dbb532f21998465a5d50471a604b558137e1afafaf4a992bc90887895d24a0",
	kind: "team",
	local_id: TEAM_ID,
	name: TEAM_ID,
	hub_id: "cccccccc-1111-4222-8333-666666666666",
	hub_source: "http://127.0.0.1:18731/v1",
	visibility: "org",
	tenant_id: TENANT,
	tenant_name: null,
	policy: { subscribe: true, auto_push: false, revision: "rev-1" },
	eligibility: { can_auto_push: false, reason: "unsupported-precondition" },
	baseline_state: "publish",
	remote_revision: null,
	auto_will_apply: true,
	auto_will_push: false,
	pull: dir({ state: "failed", error_class: "hub-error", attempts: 1 }),
	push: dir(),
	...over,
});
function dir(over = {}) {
	return {
		state: "idle",
		classification: null,
		enabled: true,
		last_checked_at: "2026-10-28T16:12:31Z",
		last_success_at: null,
		attempts: 0,
		next_retry_at: null,
		error_class: null,
		error_subclass: null,
		safe_message: null,
		operation_id: null,
		model_used: null,
		summary: {},
		backup_receipt: null,
		...over,
	};
}
const healthy = (over = {}) =>
	row({
		tenant_name: "Acme",
		eligibility: { can_auto_push: true, reason: null },
		remote_revision: '"rev-remote"',
		pull: dir(),
		...over,
	});

const pause = (ms = 10) => new Promise((r) => setTimeout(r, ms));

/** Mount one mark, open its policy popover, and return handles. */
async function mountOpen(
	link,
	{
		itemsById = true,
		memberships = [],
		account = "account-A",
		nameAmbiguous = false,
		membershipAnswer = null,
	} = {},
) {
	const dom = installDom();
	state.records = [];
	state.memberships = memberships;
	state.membershipAnswer = membershipAnswer;
	state.membershipCalls = 0;
	state.answer = null;
	const client = new app.QueryClient({
		/*
		 * `gcTime: Infinity` schedules no garbage-collection timer (TanStack skips
		 * a non-finite one); the 5-minute default outlives `client.clear()` for
		 * mutations and kept this file running long after its last test.
		 */
		defaultOptions: {
			queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
			mutations: { retry: false, gcTime: Number.POSITIVE_INFINITY },
		},
	});
	client.setQueryData(
		["radient-user", "user"],
		account ? { account: { id: account } } : null,
	);
	client.setQueryData(app.hubLinksKey, { links: [link], unresolved: [] });
	const root = createRoot(document.getElementById("root"));
	const render = (l) =>
		act(async () => {
			root.render(
				React.createElement(
					app.QueryClientProvider,
					{ client },
					React.createElement(
						app.TooltipProvider,
						null,
						React.createElement(app.HubLinkSidebarMark, {
							link: l,
							staged: false,
							onDetail: () => {},
							itemName: "synthdev",
							displayName: "Synthetic Development",
							itemsById,
							nameAmbiguous,
						}),
					),
				),
			);
			await pause();
		});
	await render(link);
	const mark = document.querySelector("[data-hub-mark]");
	await act(async () => {
		mark.dispatchEvent(
			new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
		);
		await pause(30);
	});
	const panel = () => document.querySelector("[data-hub-link-popover]");
	if (!panel()) {
		// Never leak a mounted root or a live window into the next test.
		await act(async () => root.unmount());
		client.clear();
		dom.window.close();
		assert.fail("the policy popover opened");
	}
	return {
		dom,
		client,
		render,
		panel,
		text: () => panel().textContent,
		buttons: () => [...panel().querySelectorAll("button")],
		close: async () => {
			// Cancel the production membership query before disposing its
			// observers; otherwise an in-flight read schedules GC after clear.
			await act(async () => {
				await client.cancelQueries();
				root.unmount();
				await pause();
			});
			client.clear();
			dom.window.close();
		},
	};
}

const UUID = new RegExp(TEAM_ID);
const SPLICED = /Source unavailable/;

test("healthy org link: display name, organization source, no UUID, auto-push enabled", async () => {
	const ui = await mountOpen(healthy(), {
		memberships: [{ tenant_id: TENANT, tenant_name: "Acme", status: "active" }],
	});
	try {
		const title = ui.panel().querySelector("h4").textContent;
		assert.equal(title, "Link policies for Synthetic Development");
		assert.equal(
			ui.panel().querySelector("[data-hub-link-source]").textContent,
			"Acme private hub",
		);
		assert.doesNotMatch(ui.text(), UUID);
		assert.doesNotMatch(ui.text(), SPLICED);
		assert.match(ui.text(), /Receive updates from Acme private hub\./);
		assert.equal(
			ui.panel().querySelector("[data-hub-link-incoming-failed]"),
			null,
		);
		const push = ui
			.panel()
			.querySelector('[role="switch"][aria-label^="Auto-push"]');
		assert.equal(push.disabled, false, "an eligible link's auto-push is live");
		// The mark's own accessible name carries the display name too.
		assert.match(
			document.querySelector("[data-hub-mark]").getAttribute("aria-label"),
			/Synthetic Development/,
		);
	} finally {
		await ui.close();
	}
});

test("org name missing from the row resolves from the account's memberships", async () => {
	const ui = await mountOpen(healthy({ tenant_name: null }), {
		memberships: [
			{
				tenant_id: TENANT,
				tenant_name: "Radient",
				role: "admin",
				status: "active",
				is_home: true,
				plan: { status: "active" },
			},
		],
	});
	try {
		await act(async () => pause(30));
		assert.equal(state.membershipCalls >= 1, true, "memberships were read");
		assert.equal(
			ui.panel().querySelector("[data-hub-link-source]")?.textContent,
			"Radient private hub",
		);
		assert.doesNotMatch(ui.text(), SPLICED);
	} finally {
		await ui.close();
	}
});

test("unresolved source: one plain sentence with Retry, sentences read without a source", async () => {
	const ui = await mountOpen(healthy({ tenant_name: null }), {
		memberships: [],
	});
	try {
		await act(async () => pause(30));
		const unresolved = ui
			.panel()
			.querySelector("[data-hub-link-source-unresolved]");
		assert(unresolved, "the unresolved line renders");
		assert.match(
			unresolved.textContent,
			/organization could not be identified/,
		);
		assert.doesNotMatch(ui.text(), SPLICED);
		assert.doesNotMatch(ui.text(), UUID);
		// Exactly one mention of the unknown source, not one per sentence.
		assert.equal((ui.text().match(/could not be identified/g) ?? []).length, 1);
		assert.match(ui.text(), /Receive updates from the hub\./);
		assert.match(ui.text(), /Publish local changes to the hub automatically/);
		// Retry refetches memberships (and invalidates the links inventory).
		const before = state.membershipCalls;
		const retry = [...unresolved.querySelectorAll("button")].find(
			(b) => b.textContent === "Retry",
		);
		assert(retry, "Retry is offered");
		state.memberships = [
			{
				tenant_id: TENANT,
				tenant_name: "Radient",
				role: "admin",
				status: "active",
				is_home: true,
				plan: { status: "active" },
			},
		];
		await act(async () => {
			retry.click();
			await pause(40);
		});
		assert(state.membershipCalls > before, "Retry refetched memberships");
		assert.equal(
			ui.panel().querySelector("[data-hub-link-source]")?.textContent,
			"Radient private hub",
			"a resolved source replaces the unresolved line",
		);
		// An org link with no recorded org name cannot open the consent dialog:
		// auto-push stays gated on the row's own tenant_name (core's rule).
		const push = ui
			.panel()
			.querySelector('[role="switch"][aria-label^="Auto-push"]');
		assert.equal(push.disabled, true);
	} finally {
		await ui.close();
	}
});

test("failed incoming update: reason, Retry posts {kind, local_id}, clears on success", async () => {
	const failing = row();
	const ui = await mountOpen(failing, { memberships: [] });
	try {
		const box = ui.panel().querySelector("[data-hub-link-incoming-failed]");
		assert(box, "the failed-update block renders");
		assert.match(box.textContent, /The last incoming update didn’t complete\./);
		// hub-error with no stated reason -> the transport sentence.
		assert.match(box.textContent, /Couldn't reach the hub\./);
		assert.doesNotMatch(box.textContent, UUID);
		const retry = [...box.querySelectorAll("button")].find(
			(b) => b.textContent === "Retry",
		);
		assert(retry, "Retry is offered beside the failure");
		const succeeded = {
			...failing,
			pull: dir({ last_success_at: "2026-10-28T16:20:00Z" }),
		};
		state.answer = (input) => {
			if (input.op === "hub.retry")
				return { reports: [], status: { items: [], credential: "ok" } };
			if (input.op === "hub.links")
				return { links: [succeeded], unresolved: [] };
			return {};
		};
		await act(async () => {
			retry.click();
			await pause(40);
		});
		const sent = state.records.find((r) => r.op === "hub.retry");
		assert.deepEqual(
			{
				kind: sent.kind,
				localId: sent.localId,
				name: sent.name,
				linkId: sent.linkId,
			},
			{ kind: "team", localId: TEAM_ID, name: undefined, linkId: undefined },
		);
		// The renderer request is admitted by the contract and maps to core's body.
		assert.equal(app.desktopRequestSchema.safeParse(sent).success, true);
		assert.deepEqual(app.desktopEndpoint(sent).body, {
			request_id: sent.requestId,
			kind: "team",
			local_id: TEAM_ID,
		});
		// The settled refetch brings the healthy row; the block clears.
		ui.client.setQueryData(app.hubLinksKey, {
			links: [succeeded],
			unresolved: [],
		});
		await ui.render(succeeded);
		assert.equal(
			ui.panel().querySelector("[data-hub-link-incoming-failed]"),
			null,
		);
		assert.equal(ui.panel().querySelector('[role="alert"]'), null);
	} finally {
		await ui.close();
	}
});

test("failed incoming update on an older core retries by registry name; a stated reason is shown", async () => {
	const ui = await mountOpen(
		row({
			pull: dir({
				state: "failed",
				error_class: "hub-error",
				safe_message: "The hub answered 502 Bad Gateway.",
			}),
		}),
		{ itemsById: false },
	);
	try {
		const box = ui.panel().querySelector("[data-hub-link-incoming-failed]");
		assert.match(box.textContent, /The hub answered 502 Bad Gateway\./);
		const retry = [...box.querySelectorAll("button")].find(
			(b) => b.textContent === "Retry",
		);
		await act(async () => {
			retry.click();
			await pause(30);
		});
		const sent = state.records.find((r) => r.op === "hub.retry");
		assert.equal(sent.name, "synthdev", "the registry name, never the label");
		assert.equal(sent.localId, undefined);
		assert.deepEqual(app.desktopEndpoint(sent).body, {
			request_id: sent.requestId,
			kind: "team",
			name: "synthdev",
		});
	} finally {
		await ui.close();
	}
});

test("a refused retry says so in the failure block, and only there", async () => {
	const ui = await mountOpen(row());
	try {
		state.answer = (input) => {
			if (input.op === "hub.retry") throw new Error("synthetic refusal");
			return { links: [row()], unresolved: [] };
		};
		const box = ui.panel().querySelector("[data-hub-link-incoming-failed]");
		const retry = [...box.querySelectorAll("button")].find(
			(b) => b.textContent === "Retry",
		);
		await act(async () => {
			retry.click();
			await pause(30);
		});
		const alerts = [...ui.panel().querySelectorAll('[role="alert"]')];
		assert.equal(alerts.length, 1);
		assert(box.contains(alerts[0]));
		assert.match(
			alerts[0].textContent,
			/The retry didn’t complete\. Try again\./,
		);
		assert.doesNotMatch(ui.text(), /did not complete\. Review its status/);
	} finally {
		await ui.close();
	}
});

test("auto-push gated by unverified revision-safe publication: switch disabled with the reason", async () => {
	const ui = await mountOpen(row({ tenant_name: "Acme", pull: dir() }), {
		memberships: [{ tenant_id: TENANT, tenant_name: "Acme", status: "active" }],
	});
	try {
		const push = ui
			.panel()
			.querySelector('[role="switch"][aria-label^="Auto-push"]');
		assert.equal(push.disabled, true, "auto-push is disabled while ineligible");
		const reasonId = push.getAttribute("aria-describedby");
		assert(reasonId, "the switch is described by its reason");
		const reason = document.getElementById(reasonId).textContent;
		assert.match(reason, /Auto-push is unavailable/);
		assert.match(reason, /Publish changes manually instead\./);
		assert.doesNotMatch(
			ui.text(),
			/has not verified revision-safe publication/,
		);
		// The reason also rides the disabled control's hover tooltip.
		assert.equal(push.parentElement.getAttribute("title"), reason);
	} finally {
		await ui.close();
	}
});

test("the popover is clamped inside the viewport (collision padding, flip, available-size cap)", async () => {
	const ui = await mountOpen(healthy());
	try {
		const content = ui.panel();
		const wrapper = content.closest("[data-radix-popper-content-wrapper]");
		assert(wrapper, "Radix positions the panel through its popper wrapper");
		const x = Number.parseFloat(
			wrapper.style.transform.match(/translate\(([-\d.]+)px/)?.[1],
		);
		const y = Number.parseFloat(
			wrapper.style.transform.match(/,\s*([-\d.]+)px\)/)?.[1],
		);
		assert(
			Number.isFinite(x) && Number.isFinite(y),
			`transform: ${wrapper.style.transform}`,
		);
		// 288x420 panel, 600x500 view, 8px padding: wholly inside.
		assert(x >= 8 && x + 288 <= VIEW.width - 8, `x=${x}`);
		assert(y >= 8 && y + 420 <= VIEW.height - 8, `y=${y}`);
		assert.match(
			content.className,
			/max-h-\[var\(--radix-popover-content-available-height\)\]/,
		);
		assert.match(content.className, /overflow-y-auto/);
	} finally {
		await ui.close();
	}
});

test("an org sign-in refusal (core's 401) says where to sign in, names no id, splices no source", async () => {
	const ui = await mountOpen(row());
	try {
		/*
		 * The exact answer core gave the isolated rig's retry for this org team:
		 * HTTP 401 {"detail":"organization operations need a signed-in Radient
		 * account. Run `lop login radient`."} - no code, so the transport reads it
		 * as the plane's own refusal unless the popover recognises the remedy.
		 */
		state.answer = (input) => {
			if (input.op === "hub.retry")
				throw new app.DesktopControlError(
					401,
					"organization operations need a signed-in Radient account. Run `lop login radient`.",
					undefined,
					"pairing.refused",
				);
			return { links: [row()], unresolved: [] };
		};
		const box = ui.panel().querySelector("[data-hub-link-incoming-failed]");
		const retry = [...box.querySelectorAll("button")].find(
			(b) => b.textContent === "Retry",
		);
		await act(async () => {
			retry.click();
			await pause(30);
		});
		const alerts = [...ui.panel().querySelectorAll('[role="alert"]')];
		assert.equal(alerts.length, 1);
		assert.equal(
			alerts[0].textContent,
			"Sign in to Radient in Settings, then try again.",
		);
		assert.doesNotMatch(ui.text(), UUID);
		assert.doesNotMatch(ui.text(), SPLICED);
		assert.doesNotMatch(
			ui.text(),
			/credential for the running Local Operator server/,
		);
	} finally {
		await ui.close();
	}
});

test("a mark-press failure names the item by its display name, never its id", async () => {
	// The mark's primary press on a failed row is the retry; force the generic
	// (non-sign-in) failure and read the sentence the popover opens with.
	const ui = await mountOpen(row({ tenant_name: "Acme" }));
	try {
		state.answer = (input) => {
			if (input.op === "hub.retry") throw new Error("synthetic");
			return { links: [row()], unresolved: [] };
		};
		const box = ui.panel().querySelector("[data-hub-link-incoming-failed]");
		const retry = [...box.querySelectorAll("button")].find(
			(b) => b.textContent === "Retry",
		);
		await act(async () => {
			retry.click();
			await pause(30);
		});
		assert.doesNotMatch(ui.text(), UUID);
		assert.match(
			ui.panel().querySelector("h4").textContent,
			/Synthetic Development/,
		);
	} finally {
		await ui.close();
	}
});

test("core's stored human-readable reason (core #3095) is rendered, framed", async () => {
	const ui = await mountOpen(
		row({
			pull: dir({
				state: "failed",
				error_class: "hub-error",
				safe_message:
					"could not reach the hub: the connection timed out (Could not pull the team from the Radient Agent Hub)",
			}),
		}),
	);
	try {
		const box = ui.panel().querySelector("[data-hub-link-incoming-failed]");
		assert.match(
			box.textContent,
			/Reason: could not reach the hub: the connection timed out/,
		);
	} finally {
		await ui.close();
	}
});

// Persisted metadata is not permission: exercise the REAL account-keyed query,
// including disabled cached reads and a response arriving after its owner left.
test("R1 persisted org label is hidden for nonmember, pending member, signed-out and loading account", async () => {
	for (const options of [
		{ memberships: [] },
		{
			memberships: [
				{
					tenant_id: "other-tenant",
					tenant_name: "Elsewhere",
					status: "active",
				},
			],
		},
		{
			memberships: [
				{ tenant_id: TENANT, tenant_name: "Acme", status: "pending" },
			],
		},
		{
			memberships: [
				{ tenant_id: TENANT, tenant_name: "Acme", status: "disabled" },
			],
		},
		{
			account: null,
			memberships: [
				{ tenant_id: TENANT, tenant_name: "Acme", status: "active" },
			],
		},
		{ membershipAnswer: () => new Promise(() => {}) },
	]) {
		const ui = await mountOpen(healthy(), options);
		try {
			assert.equal(
				ui.panel().querySelector("[data-hub-link-source]") === null,
				true,
			);
			assert.doesNotMatch(ui.text(), /Acme/);
			assert.doesNotMatch(
				document.querySelector("[data-hub-mark]").getAttribute("aria-label"),
				/Acme/,
			);
			if (options.account === null) assert.equal(state.membershipCalls, 0);
			else
				assert(
					state.membershipCalls > 0,
					"persisted name must not disable membership lookup",
				);
		} finally {
			await ui.close();
		}
	}
});

test("R1 account switch/sign-out drops prior cached membership; late response cannot restore it", async () => {
	const member = {
		tenant_id: TENANT,
		tenant_name: "Current Acme",
		status: "active",
	};
	const ui = await mountOpen(healthy(), { memberships: [member] });
	try {
		assert.match(ui.text(), /Current Acme private hub/);
		assert(
			ui.client.getQueryData(["memberships", "account", "account-A"]),
			"production account-keyed cache",
		);
		let finishB;
		state.membershipAnswer = () =>
			new Promise((resolve) => {
				finishB = resolve;
			});
		await act(async () => {
			ui.client.setQueryData(["radient-user", "user"], {
				account: { id: "account-B" },
			});
			await pause(30);
		});
		await act(async () => pause(30));
		assert.equal(
			ui.panel().querySelector("[data-hub-link-source]") === null,
			true,
			"B loading never shows A",
		);
		await act(async () => {
			ui.client.setQueryData(["radient-user", "user"], null);
			await pause(30);
		});
		await act(async () => {
			finishB({ result: { memberships: [member] } });
			await pause(30);
		});
		assert.equal(
			ui.panel().querySelector("[data-hub-link-source]") === null,
			true,
			"late B response after sign-out is discarded",
		);
		assert.doesNotMatch(ui.text(), /Acme/);
		assert(
			ui.client.getQueryData(["memberships", "account", "account-A"]),
			"negative control retains A cache",
		);
	} finally {
		await ui.close();
	}
});

test("R2 legacy ambiguity blocks BOTH primary mark press and in-popover Retry", async () => {
	for (const itemsById of [false, true]) {
		const registry = [{ name: " SynthDev " }, { name: "synthdev" }];
		const counts = app.hubRegistryNameCounts(registry);
		assert.equal(
			counts.get("synthdev"),
			2,
			"core trim/lower name normalization",
		);
		const ui = await mountOpen(row(), {
			itemsById,
			nameAmbiguous: (counts.get("synthdev") ?? 0) !== 1,
		});
		try {
			const retry = ui
				.panel()
				.querySelector("[data-hub-link-incoming-failed] button");
			if (!itemsById) {
				assert.equal(retry.disabled, true);
				assert.match(
					ui.panel().querySelector("[data-hub-legacy-blocked]").textContent,
					/Update Local Operator/,
				);
			} else
				assert.equal(
					retry.disabled,
					false,
					"exact id unaffected by duplicate names",
				);
			await act(async () => {
				retry.click();
				await pause(30);
			});
			await act(async () => {
				document.querySelector("[data-hub-mark]").click();
				await pause(30);
			});
			const writes = state.records.filter((r) => r.op === "hub.retry");
			if (!itemsById)
				assert.equal(
					writes.length,
					0,
					"neither entry point writes multiple items",
				);
			else {
				assert(writes.length > 0);
				for (const write of writes) {
					assert.equal(write.localId, TEAM_ID);
					assert.equal(write.name, undefined);
				}
			}
		} finally {
			await ui.close();
		}
	}
});

test("R1 pending authority/sign-out hides private label even with old user and membership caches retained", async () => {
	const ui = await mountOpen(healthy(), {
		memberships: [{ tenant_id: TENANT, tenant_name: "Acme", status: "active" }],
	});
	try {
		assert.match(ui.text(), /Acme private hub/);
		await act(async () => {
			app.beginRadientAuthorityTransition(ui.client);
			await pause(30);
		});
		assert.equal(
			ui.panel().querySelector("[data-hub-link-source]") === null,
			true,
		);
		assert(
			ui.client.getQueryData(["radient-user", "user"]).account.id ===
				"account-A",
		);
		await act(async () => {
			app.settleRadientAuthority(
				ui.client,
				app.radientAuthorityEpoch(ui.client),
				"account-A",
			);
			await pause(30);
		});
		assert.match(ui.text(), /Acme private hub/);
		await act(async () => {
			app.beginRadientAuthoritySignOut(ui.client);
			await pause(30);
		});
		assert.equal(
			ui.panel().querySelector("[data-hub-link-source]") === null,
			true,
		);
		assert(ui.client.getQueryData(["memberships", "account", "account-A"]));
	} finally {
		await ui.close();
	}
});
