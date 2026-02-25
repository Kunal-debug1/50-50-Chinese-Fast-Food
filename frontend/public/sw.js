// ╔══════════════════════════════════════════════════════╗
// ║  50-50 Chinese Fast Food — Service Worker v4.0       ║
// ║  Fixed: CORS mode, Render.com cold start, retries    ║
// ╚══════════════════════════════════════════════════════╝

const API = "https://five0-50-chinese-fast-food-6.onrender.com";
const SW_POLL_MS  = 8000;   // poll every 8s
const PAGE_PING_MS = 8000;  // wake the page every 8s

let pollTimer = null;
let pingTimer = null;
let knownOrderIds = null;
let adminToken = null;
let consecutiveErrors = 0;
let isSleeping = false;     // true when backing off after errors

// ──────────────────────────────────────────────
// Message handler — page → SW
// ──────────────────────────────────────────────
self.addEventListener("message", (event) => {
  const data = event.data || {};

  if (data.type === "INIT") {
    adminToken = data.token;
    knownOrderIds = data.knownIds ? new Set(data.knownIds.map(String)) : null;
    consecutiveErrors = 0;
    isSleeping = false;
    startAll();
  }

  if (data.type === "UPDATE_IDS" && data.knownIds) {
    knownOrderIds = new Set(data.knownIds.map(String));
  }

  if (data.type === "STOP") {
    stopAll();
  }

  if (data.type === "HEARTBEAT") {
    // Page is alive — if we were sleeping due to errors, wake up
    if (isSleeping && consecutiveErrors < 10) {
      isSleeping = false;
      consecutiveErrors = 0;
      startAll();
    }
  }
});

// ──────────────────────────────────────────────
// Start / Stop
// ──────────────────────────────────────────────
function startAll() {
  stopAll();
  poll();                                           // immediate first poll
  pollTimer = setInterval(poll, SW_POLL_MS);
  pingTimer = setInterval(pingAllClients, PAGE_PING_MS);
}

function stopAll() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
}

async function pingAllClients(extra) {
  try {
    const clients = await self.clients.matchAll({ type: "window" });
    clients.forEach((c) => c.postMessage({ type: "PING", ...extra }));
  } catch (_) {}
}

// ──────────────────────────────────────────────
// Core poll — THE CRITICAL FIX IS HERE
// mode: "cors" tells the browser to send a proper
// cross-origin request with the Authorization header.
// Without this, fetch() in a SW to an external URL fails.
// ──────────────────────────────────────────────
async function poll() {
  if (!adminToken) return;

  let res;
  try {
    res = await fetch(`${API}/orders`, {
      method: "GET",
      mode: "cors",                   // ← CRITICAL: explicitly allow cross-origin
      credentials: "omit",            // ← don't send cookies (not needed, avoids preflight issues)
      headers: {
        "Authorization": "Bearer " + adminToken,
        "Accept": "application/json",
      },
      cache: "no-store",
    });
  } catch (networkErr) {
    // Network failure — Render.com free tier might be sleeping (cold start ~30s)
    consecutiveErrors++;
    const isColdStart = networkErr.message?.includes("Failed to fetch")
      || networkErr.message?.includes("NetworkError")
      || networkErr.message?.includes("network");

    if (isColdStart && consecutiveErrors <= 3) {
      // Render.com cold start — wait longer and retry silently
      console.warn(`[SW] Server cold start? Retrying in 15s (attempt ${consecutiveErrors})`);
      stopAll();
      isSleeping = true;
      setTimeout(() => {
        isSleeping = false;
        startAll();
      }, 15000);
    } else if (consecutiveErrors > 5) {
      // Too many failures — back off for 60s
      console.error(`[SW] Too many errors (${consecutiveErrors}), backing off 60s`);
      stopAll();
      isSleeping = true;
      setTimeout(() => {
        isSleeping = false;
        consecutiveErrors = 0;
        startAll();
      }, 60000);
    }
    return;
  }

  // ── HTTP error handling ──
  if (res.status === 401) {
    console.warn("[SW] 401 Unauthorized — stopping poll");
    stopAll();
    await pingAllClients({ logout: true });
    return;
  }

  if (res.status === 503 || res.status === 502 || res.status === 504) {
    // Server temporarily down (Render.com waking up)
    consecutiveErrors++;
    console.warn(`[SW] Server ${res.status} — server may be waking up, retrying soon`);
    return;
  }

  if (!res.ok) {
    consecutiveErrors++;
    console.error(`[SW] HTTP ${res.status}`);
    return;
  }

  // ── Success ──
  consecutiveErrors = 0;
  isSleeping = false;

  let orders;
  try {
    orders = await res.json();
  } catch (jsonErr) {
    console.error("[SW] JSON parse error:", jsonErr.message);
    return;
  }

  const currentPendingIds = new Set(
    orders.filter((o) => o.status !== "paid").map((o) => String(o.id))
  );

  // First run — set baseline, don't notify
  if (knownOrderIds === null) {
    knownOrderIds = currentPendingIds;
    await pingAllClients();
    return;
  }

  // Find orders that are new since last poll
  const newOrders = orders.filter(
    (o) => o.status !== "paid" && !knownOrderIds.has(String(o.id))
  );

  knownOrderIds = currentPendingIds;

  // Always ping page so it stays in sync
  await pingAllClients();

  if (newOrders.length === 0) return;

  // ── Fire a notification for each new order ──
  for (const order of newOrders) {
    const items = order.items || [];
    const itemSummary = items
      .slice(0, 3)
      .map((i) => `${i.quantity}x ${i.name}`)
      .join(", ");
    const moreText = items.length > 3 ? ` +${items.length - 3} more` : "";

    try {
      await self.registration.showNotification("🔥 New Order Received!", {
        body: `Table ${order.table_id}  ·  ₹${order.total}\n${itemSummary}${moreText}`,
        icon: "/logo.png",
        badge: "/logo.png",
        tag: `order-${order.id}`,       // one notification per order
        renotify: true,                  // ring again even if tag exists
        requireInteraction: true,        // stays until dismissed
        vibrate: [200, 80, 200, 80, 400],
        actions: [
          { action: "open",    title: "👁 View Order" },
          { action: "dismiss", title: "Dismiss" },
        ],
        data: {
          orderId: order.id,
          url: self.location.origin + "/admin",
        },
      });
    } catch (notifErr) {
      console.error("[SW] showNotification failed:", notifErr.message);
    }
  }

  // Tell page specifically that new orders arrived
  const clients = await self.clients.matchAll({ type: "window" });
  clients.forEach((c) =>
    c.postMessage({ type: "NEW_ORDER", count: newOrders.length })
  );
}

// ──────────────────────────────────────────────
// Notification tap → open/focus admin page
// ──────────────────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "dismiss") return;

  const targetUrl = event.notification.data?.url
    || self.location.origin + "/admin";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        // Focus existing admin tab if one is open
        for (const client of clients) {
          if (client.url.includes("/admin")) {
            client.focus();
            client.postMessage({
              type: "NOTIFICATION_CLICKED",
              orderId: event.notification.data?.orderId,
            });
            return;
          }
        }
        // No admin tab open — open a new one
        return self.clients.openWindow(targetUrl);
      })
  );
});

// ──────────────────────────────────────────────
// Lifecycle — take control immediately
// ──────────────────────────────────────────────
self.addEventListener("install",  (e) => e.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));v
