import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/*
 * Source contracts only: these catch the notification call site's conflation of
 * painted size and pointer target without pretending a DOM emulator lays out CSS.
 * Drafted BEFORE the candidate implementation. Resource hold: initially UNRUN.
 * Real rendered geometry/interaction and normal affected gates remain mandatory.
 */
const root = new URL("../", import.meta.url);
const source = (path) => readFileSync(new URL(path, root), "utf8");
const checkbox = source("src/renderer/src/shared/components/ui/checkbox.tsx");
const row = source(
	"src/renderer/src/features/notifications/components/notification-row.tsx",
);
const page = source(
	"src/renderer/src/features/notifications/components/notifications-page.tsx",
);

const rowCheckbox = row.match(/<Checkbox\b[\s\S]*?\n\s*\/>/)?.[0];
const selectAll = page.match(/<Checkbox\b[\s\S]*?\n\s*\/>/)?.[0];

test("notification row separates painted checkbox size from its pointer target", () => {
	assert.ok(rowCheckbox, "real notification-row Checkbox must exist");
	assert.match(rowCheckbox, /hitArea="comfortable"/);
	assert.doesNotMatch(rowCheckbox, /className="size-6"/);
	assert.match(row, /relative flex w-4 shrink-0 justify-center/);
});

test("notification select-all opts into the same invisible target", () => {
	assert.ok(selectAll, "real select-all Checkbox must exist");
	assert.match(selectAll, /hitArea="comfortable"/);
	assert.doesNotMatch(selectAll, /className="size-6"/);
});

test("checkbox target opt-in preserves shared painted and semantic defaults", () => {
	assert.match(checkbox, /hitArea\?: "default" \| "comfortable"/);
	assert.match(checkbox, /hitArea = "default"/);
	assert.match(checkbox, /inline-flex size-4 shrink-0/);
	assert.match(checkbox, /inline-flex size-8 shrink-0/);
	assert.match(checkbox, /pointer-coarse:size-11/);
	assert.match(checkbox, /forceMount=\{comfortable \|\| undefined\}/);
	assert.match(checkbox, /data-checkbox-paint/);
	assert.match(
		checkbox,
		/aria-invalid=\{comfortable \? props\["aria-invalid"\]/,
	);
	assert.match(checkbox, /data-\[state=unchecked\]:\[&>svg\]:invisible/);
	assert.equal((checkbox.match(/<CheckboxPrimitive\.Root\b/g) ?? []).length, 1);
	assert.doesNotMatch(checkbox, /<button\b|role="checkbox"/);
	assert.match(checkbox, /checked === "indeterminate"/);
	assert.match(checkbox, /data-\[disabled\]:border-hairline/);
	assert.match(checkbox, /not-data-\[disabled\]:bg-accent/);
	assert.match(checkbox, /<Minus className="size-3\.5"/);
	assert.match(checkbox, /<Check className="size-3\.5"/);
});

test("row selection still stops opening and forwards the shift-selection chord", () => {
	assert.ok(rowCheckbox);
	assert.match(rowCheckbox, /tabIndex=\{-1\}/);
	assert.match(rowCheckbox, /event\.stopPropagation\(\)/);
	assert.match(rowCheckbox, /onToggleSelect\(item, event\.shiftKey\)/);
	assert.match(row, /event\.key === " " \|\| event\.key === "Enter"/);
});
