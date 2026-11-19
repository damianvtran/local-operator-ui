import assert from "node:assert/strict";
import { test } from "node:test";
import { selectTrustedRenderer } from "./focus-proof-main-identity.mjs";

const expected = "file:///owned/app/out/renderer/index.html";
test("exact built file wins over earlier arbitrary index documents and query spoofs", () => {
	const main = { id: 7, url: `${expected}#/chat` };
	assert.equal(
		selectTrustedRenderer(
			[
				{ id: 1, url: "https://untrusted.example/index.html" },
				{ id: 2, url: `https://untrusted.example/?next=${expected}` },
				{ id: 3, url: "file:///owned/app/out/renderer/mini.html" },
				{ id: 4, url: "file:///other/app/out/renderer/index.html" },
				{ id: 5, url: `${expected}?next=/index.html` },
				main,
			],
			expected,
		),
		main,
	);
});
test("no exact match stays unready, duplicate exact matches fail closed", () => {
	assert.equal(
		selectTrustedRenderer(
			[{ id: 1, url: "https://example.com/index.html" }],
			expected,
		),
		null,
	);
	assert.throws(
		() =>
			selectTrustedRenderer(
				[
					{ id: 1, url: expected },
					{ id: 2, url: `${expected}#/settings` },
				],
				expected,
			),
		/ambiguous/,
	);
});
test("invalid candidates cannot widen trust, expected identity must itself be a bare file URL", () => {
	assert.equal(
		selectTrustedRenderer([{ url: "not a URL" }, { url: null }], expected),
		null,
	);
	for (const value of [
		"https://example.com/index.html",
		`${expected}?x=1`,
		`${expected}#route`,
	])
		assert.throws(() => selectTrustedRenderer([], value), /built file/);
});
