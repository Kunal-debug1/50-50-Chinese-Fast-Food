// sw.js — place this in your /public folder

const API = "https://five0-50-chinese-fast-food-6.onrender.com";
const POLL_INTERVAL = 8000; // 8 seconds
const PING_INTERVAL = 8000; // ping page every 8s so it re-fetches even if its own timer died

let pollTimer = null;
let pingTimer = null;
let knownOrderIds = null;
let adminToken = null;

// ── Receive messages from the page ──
self.addEventListener("message", (event) => {
  if (event.data?.type === "INIT") {
    adminToken = event.data.token;
    knownOrderIds = event.data.knownIds ? new Set(event.data.knownIds) : null;
    startPolling();
    startPinging();
  }
  if (event.data?.type === "STOP") {
    stopAll();
  }
  if (event.data?.type === "UPDATE_IDS") {
    knownOrderIds = new Set(event.data.knownIds);
  }
});

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  poll();
  pollTimer = setInterval(poll, POLL_INTERVAL);
}

// Ping the page on a timer so it re-fetches data even if its own setInterval died
function startPinging() {
  if (pingTimer) clearInterval(pingTimer);
  pingTimer = setInterval(async () => {
    const clients = await self.clients.matchAll({ type: "window" });
    for (const client of clients) {
      client.postMessage({ type: "PING" });
    }
  }, PING_INTERVAL);
}

function stopAll() {
  clearInterval(pollTimer);
  clearInterval(pingTimer);
  pollTimer = null;
  pingTimer = null;
}

async function poll() {
  if (!adminToken) return;
  try {
    const res = await fetch(`${API}/orders`, {
      headers: { Authorization: "Bearer " + adminToken },
      cache: "no-store",
    });
    if (!res.ok) return;
    const orders = await res.json();

    const currentPendingIds = new Set(
      orders.filter((o) => o.status !== "paid").map((o) => String(o.id))
    );

    if (knownOrderIds === null) {
      knownOrderIds = currentPendingIds;
      // Still ping page to refresh on first load
      const clients = await self.clients.matchAll({ type: "window" });
      for (const client of clients) {
        client.postMessage({ type: "PING" });
      }
      return;
    }

    const newOrders = orders.filter(
      (o) => o.status !== "paid" && !knownOrderIds.has(String(o.id))
    );

    knownOrderIds = currentPendingIds;

    // Always ping the page so it stays in sync
    const clients = await self.clients.matchAll({ type: "window" });
    for (const client of clients) {
      client.postMessage({ type: "PING" });
    }

    if (newOrders.length > 0) {
      // Send notification for each new order
      for (const order of newOrders) {
        await self.registration.showNotification("🚨 New Order Received!", {
          body: `Table ${order.table_id} — ${order.customer_name} — ₹${order.total}`,
          icon: "/logo.png",
          badge: "/logo.png",
          tag: `order-${order.id}`,
          requireInteraction: true,
          vibrate: [300, 100, 300, 100, 300],
          data: { url: self.location.origin + "/admin" },
        });
      }

      // Tell page specifically a new order arrived
      for (const client of clients) {
        client.postMessage({ type: "NEW_ORDER" });
      }
    }
  } catch (e) {
    console.error("[SW] poll error:", e);
  }
}

// ── Open the app when notification is tapped ──
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
