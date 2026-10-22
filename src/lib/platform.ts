/** LANX for Linux: which desktop this copy runs on. The window's own user
 *  agent says so (WebView2 on Windows, WebKitGTK on Linux); the browser
 *  preview (npm run dev) counts as whatever desktop the browser runs on. */
const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
export const IS_WINDOWS = /Windows/i.test(ua);
export const IS_LINUX = !IS_WINDOWS && /Linux|X11/i.test(ua);
export const IS_MAC = !IS_WINDOWS && !IS_LINUX && /Mac/i.test(ua);
/** A short name for messages ("Windows", "Linux"). */
export const OS_NAME = IS_WINDOWS ? "Windows" : IS_LINUX ? "Linux" : IS_MAC ? "macOS" : "this computer";
