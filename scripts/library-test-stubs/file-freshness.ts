/** The freshness state the buffer owner asks about, reduced to a deterministic
 * in-memory flag for the Library buffer test. The real module's probes are the
 * caller's concern; this test drives the owner through `setBufferPorts`. */
let held = false;
let epoch = 0;
export const isAutosaveHeld = () => held;
export const setAutosaveHeld = (_id: string, next: boolean) => {
	held = next;
};
export const setDocumentDirty = () => {};
export const setDocumentFact = () => {};
export const currentWriteEpoch = () => epoch;
export const cancelPendingWrites = () => {
	epoch += 1;
};
export const probeLocalFile = async () => null;
