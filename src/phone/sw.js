// LANX 3.2: the phone page's service worker — shows an alert when the PC
// pushes one while the page is closed (needs the secure connection), and
// opens the chat when the alert is tapped. Nothing is cached: the page
// always comes from the PC.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let data = { title: "LANX", body: "New message", conversation_id: "" };
  try {
    data = { ...data, ...(e.data ? e.data.json() : {}) };
  } catch {
    /* a plain-text push: keep the defaults */
  }
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.conversation_id || "lanx",
      renotify: true,
      data,
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const conv = (e.notification.data && e.notification.data.conversation_id) || "";
  const url = conv ? `/#chat=${encodeURIComponent(conv)}` : "/";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const w = list[0];
      if (w) {
        if ("navigate" in w) w.navigate(url).catch(() => {});
        return w.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
