// ╔══════════════════════════════════════════════════════╗
// ║  50-50 Chinese Fast Food — Service Worker v3.0       ║
// ║  Polls in background, notifies on every new order    ║
// ╚══════════════════════════════════════════════════════╝

const API = "https://five0-50-chinese-fast-food-6.onrender.com";
const SW_POLL_MS  = 7000;
const PAGE_PING_MS = 7000;

let pollTimer = null;
let pingTimer = null;
let knownOrderIds = null;
let adminToken = null;
let consecutiveErrors = 0;
const MAX_ERRORS = 5;

// ── Message handler ──
self.addEventListener("message", (event) => {
  const { type, token, knownIds } = event.data || {};

  if (type === "INIT") {
    adminToken = token;
    knownOrderIds = knownIds ? new Set(knownIds.map(String)) : null;
    consecutiveErrors = 0;
    startAll();
  }
  if (type === "UPDATE_IDS" && event.data.knownIds) {
    knownOrderIds = new Set(event.data.knownIds.map(String));
  }
  if (type === "STOP") stopAll();
  if (type === "HEARTBEAT") consecutiveErrors = 0;
});

function startAll() {
  stopAll();
  poll();
  pollTimer = setInterval(poll, SW_POLL_MS);
  pingTimer = setInterval(pingAllClients, PAGE_PING_MS);
}

function stopAll() {
  clearInterval(pollTimer);
  clearInterval(pingTimer);
  pollTimer = null;
  pingTimer = null;
}

async function pingAllClients() {
  const clients = await self.clients.matchAll({ type: "window" });
  clients.forEach((c) => c.postMessage({ type: "PING" }));
}

async function poll() {
  if (!adminToken) return;
  try {
    const res = await fetch(`${API}/orders`, {
      headers: { Authorization: "Bearer " + adminToken },
      cache: "no-store",
    });

    if (res.status === 401) { stopAll(); pingAllClients(); return; }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const orders = await res.json();
    consecutiveErrors = 0;

    const currentPendingIds = new Set(
      orders.filter((o) => o.status !== "paid").map((o) => String(o.id))
    );

    if (knownOrderIds === null) {
      knownOrderIds = currentPendingIds;
      pingAllClients();
      return;
    }

    const newOrders = orders.filter(
      (o) => o.status !== "paid" && !knownOrderIds.has(String(o.id))
    );

    knownOrderIds = currentPendingIds;

    const clients = await self.clients.matchAll({ type: "window" });
    clients.forEach((c) => c.postMessage({ type: "PING" }));

    if (newOrders.length === 0) return;

    for (const order of newOrders) {
      const itemSummary = (order.items || [])
        .slice(0, 3).map((i) => `${i.quantity}x ${i.name}`).join(", ");
      const more = (order.items || []).length > 3
        ? ` +${order.items.length - 3} more` : "";

      await self.registration.showNotification("🔥 New Order Received!", {
        body: `Table ${order.table_id}  ·  ₹${order.total}\n${itemSummary}${more}`,
        icon: "/logo.png",
        badge: "/logo.png",
        tag: `order-${order.id}`,
        renotify: true,
        requireInteraction: true,
        vibrate: [200, 80, 200, 80, 400],
        actions: [
          { action: "open", title: "👁 View Order" },
          { action: "dismiss", title: "Dismiss" },
        ],
        data: { orderId: order.id, url: self.location.origin + "/admin" },
      });
    }

    clients.forEach((c) =>
      c.postMessage({ type: "NEW_ORDER", count: newOrders.length })
    );

  } catch (err) {
    consecutiveErrors++;
    console.error(`[SW] poll error #${consecutiveErrors}:`, err.message);
    if (consecutiveErrors >= MAX_ERRORS) {
      clearInterval(pollTimer);
      setTimeout(() => {
        consecutiveErrors = 0;
        pollTimer = setInterval(poll, SW_POLL_MS);
        poll();
      }, 30000);
    }
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "dismiss") return;
  const targetUrl = event.notification.data?.url || self.location.origin + "/admin";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes("/admin")) {
          client.focus();
          client.postMessage({ type: "NOTIFICATION_CLICKED", orderId: event.notification.data?.orderId });
          return;
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});

self.addEventListener("install", (e) => e.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
