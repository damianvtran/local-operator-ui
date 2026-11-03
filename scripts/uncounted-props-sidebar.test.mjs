// CI PLACEMENT CONTROL - not a real test. This file exists only on the throwaway
// branch ci-control/robustness-shard3 (draft PR "ci(control): shard placement control
// for #1603"), which must never be merged and is to be closed once read. It adds the
// same three registered paths as PR #1603 so the sorted-modulo shard assignment moves
// scripts/update-robustness.test.mjs into shard 3, to learn whether that file aborts
// there independent of #1603's content.
import test from "node:test";

test("control placeholder", () => {});
