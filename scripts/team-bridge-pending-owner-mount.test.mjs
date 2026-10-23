/**
 * These regressions mount the production TeamBridgePage, not PageView. The
 * private optimistic body and the create-before-post binding are container
 * state: a view-only harness cannot detect them crossing an identity boundary.
 * Transport gates keep the original write alive while the real status query
 * changes owner. No production hooks or view components are replaced.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { mountPendingOwnerPage } from "./fixtures/team-bridge-pending-owner-page.mjs";

for (const boundary of ["account", "tenant", "unresolved"]) {
	test(`failed private body cannot survive ${boundary} ownership change`, async () => {
		const page = await mountPendingOwnerPage();
		try {
			await page.sendPrivateGroup("A private failed body", "failed");
			assert.ok(page.text().includes("A private failed body"));
			await page.changeOwner(boundary);
			assert.equal(page.text().includes("A private failed body"), false);
			assert.equal(page.foreignFrames("A private failed body").length, 0);
			if (boundary !== "unresolved") {
				await page.sendPrivateGroup("B private body", "success");
				assert.equal(page.posts().at(-1).id, "created-B");
			}
		} finally {
			await page.close();
		}
	});
}

for (const phase of ["create", "post"]) {
	for (const boundary of ["account", "tenant"]) {
		test(`late A ${phase} cannot post, select or reconcile in B after ${boundary} switch`, async () => {
			const page = await mountPendingOwnerPage();
			try {
				await page.sendPrivateGroup("A private pending body", phase);
				await page.changeOwner(boundary);
				const readsBefore = page.readCount();
				await page.release(phase);
				assert.equal(page.text().includes("A private pending body"), false);
				assert.equal(page.foreignFrames("A private pending body").length, 0);
				assert.equal(page.readCount(), readsBefore);
				assert.equal(page.selectedCreatedA(), false);
				if (phase === "create") assert.equal(page.posts().length, 0);
				await page.sendPrivateGroup("B private body", "success");
				assert.equal(page.posts().at(-1).id, "created-B");
			} finally {
				await page.close();
			}
		});
	}
}

for (const boundary of ["account", "tenant"]) {
	test(`same conversation id cannot project another ${boundary}'s failed body`, async () => {
		const page = await mountPendingOwnerPage({ existing: true });
		try {
			await page.sendPrivateGroup("A existing private body", "failed");
			await page.changeOwner(boundary);
			assert.equal(page.text().includes("A existing private body"), false);
			assert.equal(page.foreignFrames("A existing private body").length, 0);
		} finally { await page.close(); }
	});
}

for (const permission of ["off", "readonly"]) {
	for (const action of ["create", "retry", "dialog"]) {
		test(`${permission} revocation fences pending ${action}`, async () => {
			const page = await mountPendingOwnerPage();
			try {
				if (action === "dialog") await page.openChannel();
				else await page.sendPrivateGroup("A private authority body", action === "create" ? "create" : "failed");
				await page.setPermission(permission);
				const postsBefore = page.posts().length;
				const createsBefore = page.creates().length;
				const readsBefore = page.readCount();
				if (action === "create") await page.release("create");
				if (action === "retry") await page.retryIfVisible();
				if (action === "dialog") await page.submitChannelIfVisible();
				assert.equal(page.posts().length, postsBefore);
				assert.equal(page.creates().length, createsBefore);
				assert.equal(page.readCount(), readsBefore);
			} finally { await page.close(); }
		});
	}
}

test("active owner can still create a channel", async () => {
	const page = await mountPendingOwnerPage();
	try {
		await page.openChannel();
		await page.submitChannelIfVisible();
		assert.equal(page.creates().length, 1);
	} finally { await page.close(); }
});

test("same-owner rerender and retry reuse the created group and client reference", async () => {
	const page = await mountPendingOwnerPage();
	try {
		await page.sendPrivateGroup("A private retry body", "failed");
		const first = page.posts()[0];
		await page.rerender();
		await page.retry();
		assert.equal(page.creates().length, 1);
		assert.equal(page.posts().length, 2);
		assert.equal(page.posts()[1].id, first.id);
		assert.equal(page.posts()[1].input.client_ref, first.input.client_ref);
	} finally {
		await page.close();
	}
});
