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
		} finally {
			await page.close();
		}
	});
}

for (const boundary of ["account", "tenant"]) {
	test(`unsent text stays private and restores only for its original ${boundary}`, async () => {
		const page = await mountPendingOwnerPage({ existing: true });
		try {
			await page.typeDraft("A private unsent text");
			await page.changeOwner(boundary);
			await page.selectExisting();
			assert.equal(page.draft(), "");
			assert.equal(page.foreignFrames("A private unsent text").length, 0);
			await page.typeDraft("B private unsent text");
			await page.changeOwner("return");
			await page.selectExisting();
			assert.equal(page.draft(), "A private unsent text");
			assert.equal(page.posts().length, 0);
		} finally {
			await page.close();
		}
	});
}

for (const boundary of ["account", "tenant"]) {
	for (const phase of ["create", "post", "failed"]) {
		test(`original ${boundary} retains ${phase} body after switch and late completion`, async () => {
			const page = await mountPendingOwnerPage();
			try {
				await page.sendPrivateGroup("A retained private body", phase);
				const postsBefore = page.posts().length;
				await page.changeOwner(boundary);
				if (phase !== "failed") await page.release(phase);
				assert.equal(page.text().includes("A retained private body"), false);
				assert.equal(page.foreignFrames("A retained private body").length, 0);
				assert.equal(page.posts().length, postsBefore);
				await page.changeOwner("return");
				await page.openAddressedGroup();
				assert.equal(page.text().includes("A retained private body"), true);
				assert.equal(page.posts().length, postsBefore);
			} finally {
				await page.close();
			}
		});
	}
}

test("cached confirmed history requires the current account's own admission", async () => {
	const page = await mountPendingOwnerPage({ existing: true });
	try {
		await page.seedConfirmed("A admitted confirmed private body");
		await page.changeOwner("account");
		await page.selectExisting();
		assert.equal(
			page.text().includes("A admitted confirmed private body"),
			false,
		);
		assert.equal(
			page.foreignFrames("A admitted confirmed private body").length,
			0,
		);
	} finally {
		await page.close();
	}
});

for (const permission of ["off", "readonly"]) {
	for (const action of ["create", "retry", "dialog"]) {
		test(`${permission} revocation fences pending ${action}`, async () => {
			const page = await mountPendingOwnerPage();
			try {
				if (action === "dialog") await page.openChannel();
				else
					await page.sendPrivateGroup(
						"A private authority body",
						action === "create" ? "create" : "failed",
					);
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
			} finally {
				await page.close();
			}
		});
	}
}

test("SEC-1 retained thread cache never admits A replies during held or refused B read", async () => {
	const page = await mountPendingOwnerPage({ existing: true });
	try {
		await page.seedThread();
		await page.openThread();
		assert.ok(page.text().includes("A PRIVATE CACHED REPLY"));
		await page.changeOwner("account");
		page.holdReplies();
		await page.openThread();
		assert.equal(page.text().includes("A PRIVATE CACHED REPLY"), false);
		await page.refuseHeldReplies();
		assert.equal(page.text().includes("A PRIVATE CACHED REPLY"), false);
		assert.equal(page.foreignFrames("A PRIVATE CACHED REPLY").length, 0);
	} finally {
		await page.close();
	}
});

test("SEC-2 inherited thread mutation retry cannot resolve B credentials for A body", async () => {
	const page = await mountPendingOwnerPage({ existing: true });
	try {
		await page.seedThread();
		await page.openThread();
		await page.sendThreadHeld("A private retry body");
		await page.changeOwner("account");
		await page.failHeldPost();
		assert.deepEqual(
			page.posts().map((row) => [row.owner, row.body]),
			[["acct_a", "A private retry body"]],
		);
	} finally {
		await page.close();
	}
});

test("SEC-3 unsent thread reply survives only for its original owner", async () => {
	const page = await mountPendingOwnerPage({ existing: true });
	try {
		await page.seedThread();
		await page.openThread();
		await page.typeThread("A private unsent reply");
		await page.changeOwner("account");
		await page.openThread();
		assert.equal(page.threadDraft(), "");
		await page.changeOwner("return");
		await page.openThread();
		assert.equal(page.threadDraft(), "A private unsent reply");
	} finally {
		await page.close();
	}
});

test("SEC-4 late original-owner create receipt is reused without a second group", async () => {
	const page = await mountPendingOwnerPage();
	try {
		await page.sendPrivateGroup("A group recovery body", "create");
		await page.changeOwner("account");
		await page.release("create");
		assert.equal(page.posts().length, 0);
		await page.changeOwner("return");
		await page.openAddressedGroup();
		await page.retry();
		assert.equal(page.creates().length, 1);
		assert.equal(page.posts()[0].id, "created-A");
	} finally {
		await page.close();
	}
});

test("active owner can still create a channel", async () => {
	const page = await mountPendingOwnerPage();
	try {
		await page.openChannel();
		await page.submitChannelIfVisible();
		assert.equal(page.creates().length, 1);
	} finally {
		await page.close();
	}
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

test("covered writes require runtime owner capability before dispatch", async () => {
	const page = await mountPendingOwnerPage({ existing: true });
	try {
		page.setOwnerGuard(0);
		await page.typeDraft("private text for old runtime");
		await page.submitDraft();
		assert.equal(page.posts().length, 0);
		assert.equal(page.creates().length, 0);
		assert.ok(page.text().includes("private text for old runtime"));
	} finally {
		await page.close();
	}
});

test("covered create and send carry the captured account and target tenant", async () => {
	const page = await mountPendingOwnerPage();
	try {
		await page.sendPrivateGroup("captured author body", "success");
		for (const call of [...page.creates(), ...page.posts()]) {
			assert.equal(call.expected_account_id, "acct_a");
			assert.equal(call.tenant_id, "org_shared");
		}
	} finally {
		await page.close();
	}
});

test("returning owner sees unknown delivery rather than a definite failure", async () => {
	const page = await mountPendingOwnerPage();
	try {
		await page.sendPrivateGroup("unknown delivery body", "post");
		await page.changeOwner("account");
		await page.changeOwner("return");
		await page.openAddressedGroup();
		assert.ok(page.text().includes("unknown delivery body"));
		assert.ok(page.text().includes("Retry"));
		assert.equal(page.text().includes("Sending…"), false);
		assert.equal(page.text().includes("Not sent"), false);
		await page.release("post");
	} finally {
		await page.close();
	}
});
