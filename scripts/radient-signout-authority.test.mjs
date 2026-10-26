/**
 * The SIGN-OUT PRESS, through the shipped hook.
 *
 * WHY THIS SUITE EXISTS. Main withdraws a departing account's banners when the
 * renderer publishes a deliberate sign-out as settled absence. That publication
 * lives in one `onMutate` in `use-radient-user-query.ts`; a rewire to the
 * refresh transition beside it compiles, type-checks and leaves every model
 * test green while the banners linger through the whole removal. So this suite
 * mounts the REAL hook against the REAL authority journal and only fakes the
 * preload bridge it would call, which is the hook's own edge.
 *
 * THE ERROR PATH IS PART OF THE CONTRACT. A removal that fails part-way must
 * not leave the journal claiming settled absence forever: the press publishes
 * absence immediately (that is what withdraws the previews), and a failure
 * commissions the real account read so delivery stays held until an owner is
 * established again.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

after(() => {
	try {
		unlinkSync(bundlePath);
	} catch {}
});

const scratch = mkdtempSync(join(tmpdir(), "radient-signout-authority-"));

const toastFixturePath = join(scratch, "toast-fixture.mjs");
writeFileSync(
	toastFixturePath,
	"export const shown = []; export const showErrorToast = (m) => { shown.push(['error', m]); }; export const showSuccessToast = (m) => { shown.push(['success', m]); }; export const showInfoToast = () => {}; export const dismissToast = () => {}; export const resetToastDedup = () => {};",
);

const storeFixturePath = join(scratch, "user-store-fixture.mjs");
writeFileSync(
	storeFixturePath,
	"export const signingOut = []; export const useUserStore = () => ({ setIsSigningOut: (value) => { signingOut.push(value); }, isSigningOut: false });",
);

const proxyFixturePath = join(scratch, "radient-proxy-fixture.mjs");
writeFileSync(
	proxyFixturePath,
	"export const radientProxy = async () => { throw new Error('no radient credential'); };",
);

const bundled = await build({
	stdin: {
		contents: `
			export { useRadientUserQuery } from "./src/renderer/src/shared/hooks/use-radient-user-query";
			export {
				beginRadientAuthorityTransition,
				observedRadientAuthority,
				radientAuthorityEpoch,
				radientAuthorityPending,
				settleRadientAuthority,
			} from "./src/renderer/src/shared/hooks/radient-account-authority";
			export { shown } from "@shared/utils/toast-manager";
			export { signingOut } from "@shared/store/user-store";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	write: false,
	alias: {
		"@shared/utils/toast-manager": toastFixturePath,
		"@shared/store/user-store": storeFixturePath,
		"@shared/api/radient/proxy": proxyFixturePath,
		"@features": `${process.cwd()}/src/renderer/src/features`,
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
	},
});

// Written under `node_modules/.cache/`, not beside this script: the bundle keeps
// bare package imports (`intl-messageformat` reaches the hook through the message
// catalogue) which a data: module cannot resolve, but a file under `scripts/` is
// a file the harness scan walks - and reading one while it is being removed is
// the ENOENT that reddened shard 0. Same convention as `chat-sidebar-pins`.
const bundleDir = join(
	process.cwd(),
	"node_modules/.cache/radient-signout-authority",
);
mkdirSync(bundleDir, { recursive: true });
const bundlePath = join(bundleDir, `signout-authority-${process.pid}.mjs`);
writeFileSync(bundlePath, bundled.outputFiles[0].text);

/** A jsdom page whose only preload capability is the accounts bridge. */
const mountIn = async (request) => {
	const dom = new JSDOM(
		"<!doctype html><html><body><div id='root'></div></body></html>",
		{
			url: "http://localhost/",
			pretendToBeVisual: true,
		},
	);
	const previous = {
		window: globalThis.window,
		document: globalThis.document,
		navigator: globalThis.navigator,
		IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT,
	};
	globalThis.window = dom.window;
	globalThis.document = dom.window.document;
	// Node 24 defines `navigator` as a getter-only global, so the jsdom page has
	// to be installed by descriptor rather than by assignment.
	Object.defineProperty(globalThis, "navigator", {
		value: dom.window.navigator,
		configurable: true,
		writable: true,
	});
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;
	dom.window.api = { desktop: { request } };

	// One instance for both cases: the authority journal is keyed by QueryClient,
	// so a shared module is the shipped arrangement, not a shortcut.
	const module = await import(pathToFileURL(bundlePath).href);
	const client = new QueryClient({
		defaultOptions: {
			queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
			mutations: { retry: false },
		},
	});
	const { createRoot } = await import("react-dom/client");
	const container = dom.window.document.getElementById("root");
	const root = createRoot(container);
	let hook;
	const Probe = () => {
		hook = module.useRadientUserQuery();
		return null;
	};
	await act(async () => {
		root.render(
			React.createElement(
				QueryClientProvider,
				{ client },
				React.createElement(Probe),
			),
		);
	});
	const restore = () => {
		act(() => root.unmount());
		globalThis.window = previous.window;
		globalThis.document = previous.document;
		Object.defineProperty(globalThis, "navigator", {
			value: previous.navigator,
			configurable: true,
			writable: true,
		});
		globalThis.IS_REACT_ACT_ENVIRONMENT = previous.IS_REACT_ACT_ENVIRONMENT;
		dom.window.close();
	};
	return { module, client, hook: () => hook, restore };
};

test("the Sign-out press publishes settled absence before the removal runs", async () => {
	const during = [];
	const mounted = await mountIn(async (request) => {
		// Inside the removal call: this is the window between onMutate and the
		// bridge answering, which is the moment main must have withdrawn on.
		during.push({
			pending: mounted.module.radientAuthorityPending(mounted.client),
			accountId: mounted.module.observedRadientAuthority(mounted.client)
				.accountId,
		});
		assert.equal(request.op, "accounts.list");
		return { accounts: [] };
	});
	try {
		// The query's shape is the proxy's: the id lives at `account.id`.
		mounted.client.setQueryData(["radient-user", "user"], {
			account: { id: "acct_a" },
		});
		mounted.module.settleRadientAuthority(
			mounted.client,
			mounted.module.radientAuthorityEpoch(mounted.client),
			"acct_a",
		);
		assert.equal(
			mounted.module.radientAuthorityPending(mounted.client),
			false,
			"precondition: a settled owner",
		);
		await act(async () => {
			mounted.hook().signOut();
		});
		assert.deepEqual(
			during[0],
			{ pending: false, accountId: undefined },
			"the press publishes settled ABSENCE before the removal, not a refresh hold",
		);
		assert.ok(
			mounted.module.signingOut.includes(true),
			"the press still reports the removal to the shell",
		);
	} finally {
		mounted.restore();
	}
});

test("a failed removal publishes absence first, then holds delivery for a real re-read", async () => {
	const observations = [];
	const mounted = await mountIn(async () => {
		// Read the journal from inside the failing call: this is the only moment
		// the onMutate publication is observable before onError commissions a read.
		observations.push({
			pending: mounted.module.radientAuthorityPending(mounted.client),
			accountId: mounted.module.observedRadientAuthority(mounted.client)
				.accountId,
		});
		throw new Error("accounts bridge unavailable");
	});
	try {
		// The query's shape is the proxy's: the id lives at `account.id`.
		mounted.client.setQueryData(["radient-user", "user"], {
			account: { id: "acct_a" },
		});
		mounted.module.settleRadientAuthority(
			mounted.client,
			mounted.module.radientAuthorityEpoch(mounted.client),
			"acct_a",
		);
		await act(async () => {
			mounted.hook().signOut();
		});
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
		assert.equal(observations.length, 1, "the removal was attempted once");
		assert.deepEqual(
			observations[0],
			{ pending: false, accountId: undefined },
			"the previews are withdrawn on the press even though removal fails",
		);
		assert.equal(
			mounted.module.radientAuthorityPending(mounted.client),
			true,
			"the failure leaves delivery HELD for the real account read, never restored by assumption",
		);
	} finally {
		mounted.restore();
	}
});
