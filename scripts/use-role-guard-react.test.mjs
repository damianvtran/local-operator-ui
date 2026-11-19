#!/usr/bin/env node
/**
 * The press guard's CLOCK, driven through the shipped hook under React and jsdom.
 *
 * `composer-slots.test.mjs` proves the rules (`shouldIgnoreRolePress`,
 * `guardArmedBy`) as pure functions. What only a mounted hook can answer is the
 * wiring: that the arrival is stamped in the commit that flips the role, that a
 * first mount is not an arrival, that a Stop reached from Send (through the
 * connecting face) is armed and one reached any other way is not, that a pointer
 * click inside the window is ignored while a keyboard activation and a click
 * after the window are not, and that `arming` rises and falls with the window.
 * The review of #1638 (minor 1) asked for exactly this: the operator's hazard,
 * a pointer press landing on a role that just arrived, had no executed proof.
 *
 * Real timers, as `interrupt-slot-hold-react.test.mjs` (deleted with the held
 * box) used: React schedules through `setTimeout` too, so replacing the clock
 * would take React's flushing with it. The window is the shipped constant.
 */

import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const bootstrapDOM = new JSDOM("<!doctype html><div id=root></div>");
globalThis.window = bootstrapDOM.window;
globalThis.document = bootstrapDOM.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => {
	bootstrapDOM.window.close();
	globalThis.window = undefined;
	globalThis.document = undefined;
});

const bundle = await build({
	stdin: {
		contents: `
			export { useRoleGuard } from "./src/renderer/src/features/chat/hooks/use-role-guard";
			export { ROLE_GUARD_MS } from "./src/renderer/src/features/chat/composer-slots";
		`,
		loader: "ts",
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	write: false,
});
const bundlePath = new URL(
	`./_use-role-guard-react-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { useRoleGuard, ROLE_GUARD_MS } = await import(bundlePath.href);
await unlink(bundlePath);

const h = React.createElement;
// The guard's own timer ends `arming` with a state update; waiting inside `act`
// is what lets React account for it instead of warning that it ran outside one.
const sleep = (ms) =>
	act(async () => {
		await new Promise((resolve) => setTimeout(resolve, ms));
	});

/** The hook and one button: what the row does with it, reduced to the question. */
function Probe({ role, log }) {
	const { ignore, arming } = useRoleGuard(role);
	return h("button", {
		type: "button",
		"data-role": role,
		"data-arming": String(arming),
		onClick: (event) => {
			if (ignore(event.detail)) {
				log.push(`ignored:${role}`);
				return;
			}
			log.push(`fired:${role}`);
		},
	});
}

async function mount(initialRole) {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	const log = [];
	const render = (role) =>
		act(async () => {
			root.render(h(Probe, { role, log }));
		});
	await render(initialRole);
	const button = () => container.querySelector("button");
	/** A pointer click carries a click count; `click()` is detail 0, like a key. */
	const press = (detail) =>
		act(async () => {
			button().dispatchEvent(
				new window.MouseEvent("click", { bubbles: true, detail }),
			);
		});
	return {
		log,
		render,
		press,
		arming: () => button().getAttribute("data-arming"),
		unmount: () => act(async () => root.unmount()),
	};
}

test("the window is the shipped 500 ms", () => {
	assert.equal(ROLE_GUARD_MS, 500);
});

test("a role that arrives under the pointer ignores a pointer click inside the window, and fires after it", async () => {
	const rig = await mount("mic");
	await rig.render("cancel");
	await rig.press(1);
	assert.deepEqual(rig.log, ["ignored:cancel"]);
	assert.equal(
		rig.arming(),
		"true",
		"the control shows the press is not taken yet",
	);
	await sleep(ROLE_GUARD_MS + 80);
	assert.equal(rig.arming(), "false", "and the ramp ends with the window");
	await rig.press(1);
	assert.deepEqual(rig.log, ["ignored:cancel", "fired:cancel"]);
	await rig.unmount();
});

test("a keyboard activation (detail 0) fires inside the window", async () => {
	const rig = await mount("mic");
	await rig.render("confirm");
	await rig.press(0);
	assert.deepEqual(rig.log, ["fired:confirm"]);
	await rig.unmount();
});

test("a role that is on screen at mount is not an arrival", async () => {
	const rig = await mount("stop");
	await rig.press(1);
	assert.deepEqual(rig.log, ["fired:stop"]);
	assert.equal(rig.arming(), "false");
	await rig.unmount();
});

test("STOP: armed when a send flipped the slot (Send -> Connecting -> Stop), open when it was not", async () => {
	const afterSend = await mount("send");
	await afterSend.render("connecting");
	await afterSend.render("stop");
	await afterSend.press(1);
	assert.deepEqual(
		afterSend.log,
		["ignored:stop"],
		"the reflex re-press on the send position",
	);
	await afterSend.unmount();

	// The user cleared the box while a turn ran: Steer -> Stop, no press on this slot.
	const cleared = await mount("steer");
	await cleared.render("stop");
	await cleared.press(1);
	assert.deepEqual(
		cleared.log,
		["fired:stop"],
		"nothing was pressed here, so the first press must work",
	);
	assert.equal(cleared.arming(), "false");
	await cleared.unmount();

	// A turn started elsewhere: the idle Send position became Stop.
	const elsewhere = await mount("send");
	await elsewhere.render("stop");
	await elsewhere.press(1);
	assert.deepEqual(elsewhere.log, ["fired:stop"]);
	await elsewhere.unmount();
});

test("an unguarded role is never ignored, whatever it replaced", async () => {
	const rig = await mount("spinner");
	await rig.render("mic");
	await rig.press(1);
	assert.deepEqual(rig.log, ["fired:mic"]);
	await rig.unmount();
});

test("a flip back and forth restarts the window from the latest arrival", async () => {
	const rig = await mount("mic");
	await rig.render("cancel");
	await sleep(ROLE_GUARD_MS - 100);
	await rig.render("mic");
	await rig.render("cancel");
	await sleep(200);
	await rig.press(1);
	assert.deepEqual(
		rig.log,
		["ignored:cancel"],
		"200 ms after the SECOND arrival",
	);
	await rig.unmount();
});
