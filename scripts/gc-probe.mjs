/**
 * Force a full garbage collection from inside a test-file process, so a
 * LIFETIME assertion can actually observe an object leave.
 *
 * WHY THIS INSTRUMENT EXISTS AT ALL. The defect it exists for is a lifetime
 * one, and no honest test of the fix can avoid the collector: Electron's
 * main-process `Notification` is a V8 wrapper whose C++ side holds only a raw
 * delegate pointer (`presenter_->CreateNotification(this, id)`), so when V8
 * collects the wrapper, gin's weak callbacks destroy the `api::Notification`
 * object and its destructor nulls the native delegate
 * (`shell/browser/api/electron_api_notification.cc`, `~Notification`, at the
 * pinned v44.3.0). The delivered banner therefore stays in Notification Center
 * while its click emits nothing — upstream electron/electron#16922, whose own
 * reproduction says "the event listener will execute only if click/close/reply
 * happens shortly after the notification is created", and #12690, "click event
 * is not triggered from notification center if the user waits ~1 minute or
 * more". A test that only asserts bookkeeping would pass on the broken tree;
 * a test that drops the last reference, runs the collector, and checks what is
 * still reachable is the one that discriminates.
 *
 * HOW IT REACHES THE COLLECTOR. `node --test` spawns the files itself and the
 * runner does not pass `--expose-gc`, so the flag is set at runtime through
 * `v8.setFlagsFromString`, the documented way to flip an isolate flag from
 * inside the process; the `vm.runInNewContext("gc")` read is the standard
 * consequence of it (the function is per-isolate, and `runInNewContext` is a
 * supported way to re-enter and pick it up). Measured working on this repo's
 * node (v26.5.0).
 *
 * The loop is the standard recipe rather than ceremony: one `gc()` schedules
 * the sweep, the `await` lets the second-pass callbacks (the ones that
 * actually tear a wrapper down and notify `WeakRef` targets) run, and the
 * repetition covers an object that needs more than one pass. Four passes is
 * what the probes in this repository measured consistently; a caller that
 * wants to re-assert can simply await it again.
 */

import v8 from "node:v8";
import vm from "node:vm";

v8.setFlagsFromString("--expose-gc");

/** The collector, read once now that the flag is on. */
const gc = vm.runInNewContext("gc");

/** One full collection: synchronous sweeps separated by macrotask turns. */
export async function collectGarbage() {
	for (let pass = 0; pass < 4; pass += 1) {
		gc();
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
}
