// sw.js — place this in your /public folder

const API = "https://five0-50-chinese-fast-food-6.onrender.com";
const POLL_INTERVAL = 10000; // 10 seconds
let pollTimer = null;
let knownOrderIds = null;
let adminToken = null;

// ── Receive token from the page ──
self.addEventListener("message", (event) => {
  if (event.data?.type === "INIT") {
    adminToken = event.data.token;
    knownOrderIds = event.data.knownIds ? new Set(event.data.knownIds) : null;
    startPolling();
  }
  if (event.data?.type === "STOP") {
    stopPolling();
  }
  if (event.data?.type === "UPDATE_IDS") {
    knownOrderIds = new Set(event.data.knownIds);
  }
});

function startPolling() {
  stopPolling(); // clear any existing timer
  poll(); // run immediately
  pollTimer = setInterval(poll, POLL_INTERVAL);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function poll() {
  if (!adminToken) return;
  try {
    const res = await fetch(`${API}/orders`, {
      headers: { Authorization: "Bearer " + adminToken },
    });
    if (!res.ok) return;
    const orders = await res.json();

    const currentPendingIds = new Set(
      orders.filter((o) => o.status !== "paid").map((o) => String(o.id))
    );

    if (knownOrderIds === null) {
      // First poll — just set baseline, don't notify
      knownOrderIds = currentPendingIds;
      return;
    }

    const newOrders = orders.filter(
      (o) => o.status !== "paid" && !knownOrderIds.has(String(o.id))
    );

    if (newOrders.length > 0) {
      knownOrderIds = currentPendingIds;

      // Notify for each new order
      for (const order of newOrders) {
        await self.registration.showNotification("🚨 New Order Received!", {
          body: `Table ${order.table_id} — ${order.customer_name} — ₹${order.total}`,
          icon: "/logo.png",
          badge: "/logo.png",
          tag: `order-${order.id}`,
          requireInteraction: true,
          vibrate: [200, 100, 200, 100, 200],
          data: { url: self.location.origin + "/admin" },
        });
      }

      // Tell the page to refresh if it's open
      const clients = await self.clients.matchAll({ type: "window" });
      for (const client of clients) {
        client.postMessage({ type: "NEW_ORDER" });
      }
    } else {
      knownOrderIds = currentPendingIds;
    }
  } catch (e) {
    console.error("[SW] poll error:", e);
  }
}

// ── Open the app when notification is clicked ──
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || self.location.origin;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if (client.url.includes("/admin")) {
            client.focus();
            return;
          }
        }
        return self.clients.openWindow(url);
      })
  );
});

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
