// src/utils/adminNotifier.ts
// Server-Sent Events (SSE) broadcaster for real-time admin notifications.
//
// How SSE works:
//   1. Admin dashboard opens GET /api/v1/admin/notifications/stream
//   2. Server keeps the connection open and pushes events as text/event-stream
//   3. When an order is confirmed, we call notifyAdmin() which writes to all
//      open admin connections immediately — no polling needed
//
// Why SSE over WebSockets?
//   - One-directional (server → client) which is all we need for notifications
//   - Works over plain HTTP/1.1, no upgrade handshake
//   - Native browser EventSource API, no extra frontend library needed
//   - Much simpler than WebSockets for this use case

import type { Response } from "express";

// ─── Connection store ─────────────────────────────────────────────────────────
// Holds all currently open admin SSE connections.
// Map key = unique connection ID, value = Express Response object kept open.
const connections = new Map<string, Response>();

// ─── Register a new admin SSE connection ─────────────────────────────────────
export const addAdminConnection = (id: string, res: Response): void => {
  connections.set(id, res);
  console.log(`[SSE] Admin connected (id: ${id}) — total connections: ${connections.size}`);
};

// ─── Remove a closed connection ───────────────────────────────────────────────
export const removeAdminConnection = (id: string): void => {
  connections.delete(id);
  console.log(`[SSE] Admin disconnected (id: ${id}) — total connections: ${connections.size}`);
};

// ─── SSE event types ──────────────────────────────────────────────────────────
export type AdminEventType =
  | "new_order"       // fired when a new order is placed
  | "order_updated"   // fired when order status changes
  | "low_stock"       // fired when product stock drops below threshold
  | "ping";           // keepalive — sent every 30s to prevent connection timeout

export interface NewOrderPayload {
  orderId:     string;
  customerName: string;
   mongoId?: string;
  totalAmount: number;
  itemCount:   number;
  paymentMethod: string;
  city:        string;
  timestamp:   string;
}

export interface OrderUpdatedPayload {
  orderId: string;
  status:  string;
  timestamp: string;
}

export interface LowStockPayload {
  productName: string;
  remaining:   number;
  timestamp:   string;
}

type EventPayload = NewOrderPayload | OrderUpdatedPayload | LowStockPayload | Record<string, never>;

// ─── Format an SSE message ────────────────────────────────────────────────────
// SSE wire format (each field ends with \n, message ends with \n\n):
//   event: new_order
//   data: {"orderId":"ORD-2024-00001","totalAmount":599}
//
const formatEvent = (type: AdminEventType, payload: EventPayload): string => {
  return `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
};

// ─── Broadcast to all connected admins ───────────────────────────────────────
const broadcast = (type: AdminEventType, payload: EventPayload): void => {
  if (connections.size === 0) return; // no admins connected — skip

  const message = formatEvent(type, payload);

  for (const [id, res] of connections) {
    try {
      res.write(message);
    } catch {
      // Connection was closed without cleanup — remove it
      removeAdminConnection(id);
    }
  }
};

// ─── Public notification helpers — called from controllers ───────────────────

export const notifyNewOrder = (payload: NewOrderPayload): void => {
  broadcast("new_order", payload);
};

export const notifyOrderUpdated = (payload: OrderUpdatedPayload): void => {
  broadcast("order_updated", payload);
};

export const notifyLowStock = (payload: LowStockPayload): void => {
  broadcast("low_stock", payload);
};

// ─── Keepalive ping ───────────────────────────────────────────────────────────
// Browsers and proxies close SSE connections that are idle for ~60s.
// We send a ping comment every 30s to keep all connections alive.
setInterval(() => {
  if (connections.size === 0) return;
  broadcast("ping", {});
}, 30_000);