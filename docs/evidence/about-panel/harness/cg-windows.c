/*
 * Window census for one pid, from CoreGraphics.
 *
 * Why this exists beside `screencapture`: the About panel is AppKit's, not a
 * `BrowserWindow`, so nothing inside the app can photograph it and the app
 * cannot say whether it is on screen. `System Events` is the obvious reader and
 * the wrong one - it needs Accessibility permission and reports no windows for
 * a background process, which is exactly what an agent-driven run is. The
 * window server, by contrast, describes every window in the session to anyone
 * who asks, keyed by the OWNING PID, which is the fact that keeps this rig from
 * measuring a peer session's Electron.
 *
 * Usage: cg-windows <pid> [--onscreen-only]
 * Output: one JSON object per line, one per window owned by that pid.
 *
 * `onscreen` is the window server's own answer to "is this on screen". It is
 * the half of the census that makes "no panel appeared" a fact rather than an
 * absence of evidence: a headless run's window exists and is listed here with
 * `onscreen` false, so a rig that saw nothing would be a rig that was not
 * looking.
 */
#include <CoreGraphics/CoreGraphics.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void print_string(FILE *out, CFStringRef value) {
	char buffer[1024];
	if (value != NULL && CFStringGetCString(value, buffer, sizeof(buffer), kCFStringEncodingUTF8)) {
		fputc('"', out);
		for (const char *at = buffer; *at; at++) {
			if (*at == '"' || *at == '\\') fputc('\\', out);
			fputc(*at, out);
		}
		fputc('"', out);
	} else {
		fputs("\"\"", out);
	}
}

int main(int argc, char **argv) {
	if (argc < 2) {
		fprintf(stderr, "usage: cg-windows <pid> [--onscreen-only]\n");
		return 2;
	}
	pid_t wanted = (pid_t)strtol(argv[1], NULL, 10);
	int onscreen_only = argc > 2 && strcmp(argv[2], "--onscreen-only") == 0;

	CGWindowListOption options =
		onscreen_only ? kCGWindowListOptionOnScreenOnly : kCGWindowListOptionAll;
	CFArrayRef windows = CGWindowListCopyWindowInfo(options, kCGNullWindowID);
	if (windows == NULL) {
		fprintf(stderr, "cg-windows: the window server returned no list\n");
		return 1;
	}

	for (CFIndex i = 0; i < CFArrayGetCount(windows); i++) {
		CFDictionaryRef window = CFArrayGetValueAtIndex(windows, i);
		CFNumberRef pidNumber = CFDictionaryGetValue(window, kCGWindowOwnerPID);
		if (pidNumber == NULL) continue;
		int pid = 0;
		if (!CFNumberGetValue(pidNumber, kCFNumberIntType, &pid)) continue;
		if (pid != wanted) continue;

		int number = 0, layer = 0, onscreen = 0, alpha = 0;
		CFNumberRef numberRef = CFDictionaryGetValue(window, kCGWindowNumber);
		if (numberRef) CFNumberGetValue(numberRef, kCFNumberIntType, &number);
		CFNumberRef layerRef = CFDictionaryGetValue(window, kCGWindowLayer);
		if (layerRef) CFNumberGetValue(layerRef, kCFNumberIntType, &layer);
		CFNumberRef onscreenRef = CFDictionaryGetValue(window, kCGWindowIsOnscreen);
		if (onscreenRef) CFNumberGetValue(onscreenRef, kCFNumberIntType, &onscreen);
		CFNumberRef alphaRef = CFDictionaryGetValue(window, kCGWindowAlpha);
		if (alphaRef) CFNumberGetValue(alphaRef, kCFNumberFloatType, &alpha);

		CGRect bounds = CGRectZero;
		CFDictionaryRef boundsRef = CFDictionaryGetValue(window, kCGWindowBounds);
		if (boundsRef) CGRectMakeWithDictionaryRepresentation(boundsRef, &bounds);

		printf("{\"id\": %d, \"pid\": %d, \"owner\": ", number, pid);
		print_string(stdout, CFDictionaryGetValue(window, kCGWindowOwnerName));
		printf(", \"name\": ");
		print_string(stdout, CFDictionaryGetValue(window, kCGWindowName));
		printf(", \"layer\": %d, \"onscreen\": %s, \"alpha\": %d, "
			   "\"bounds\": {\"x\": %.0f, \"y\": %.0f, \"w\": %.0f, \"h\": %.0f}}\n",
			   layer, onscreen ? "true" : "false", alpha, bounds.origin.x,
			   bounds.origin.y, bounds.size.width, bounds.size.height);
	}

	CFRelease(windows);
	return 0;
}
