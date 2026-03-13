// src/modules/admin/admin.controller.ts
import type { Request, Response } from "express";
import { env } from "../../config/env";
import { User } from "../user/user.model";
import { Product } from "../product/product.model";
import { Order, OrderStatus } from "../order/order.model";
import { Payment } from "../payment/payment.model";
import { ApiError } from "../../utils/apiError";
import { asyncHandler } from "../../utils/asynchandler";
import { sendSuccess, sendCreated } from "../../utils/response";
import { signAccessToken, signRefreshToken } from "../../utils/jwt";
import type { AuthRequest } from "../../middleware/auth";
import {
  addAdminConnection,
  removeAdminConnection,
  notifyOrderUpdated,
} from "../../utils/adminNotifier";
// import {
//   isStoreOpen,
//   setStoreOpen,
//   getStoreStatus,
//   recordStoreStateChange,
// } from "../../utils/storeState";
import {
  saveSubscription,
  type PushPayload,
} from "../../utils/webPush";
import type { PushSubscription } from "web-push";

// ─── Notification Stream (SSE) ───────────────────────────────────────────────
// GET /api/v1/admin/notifications/stream
// Admin dashboard opens this endpoint once and keeps it open.
// Server pushes events (new_order, order_updated, low_stock) in real time.
// Protected by adminOnly middleware in the router.
export const adminNotificationStream = (req: AuthRequest, res: Response): void => {
  // ── SSE response headers ──────────────────────────────────────────────────
  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection",    "keep-alive");
  // Required when frontend is on a different origin
  res.setHeader("X-Accel-Buffering", "no"); // disables Nginx buffering in production
  res.flushHeaders(); // send headers immediately so the browser knows it's SSE

  // ── Register this connection ──────────────────────────────────────────────
  const connectionId = `admin-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  addAdminConnection(connectionId, res);

  // ── Send a welcome event so frontend knows the stream is live ────────────
  res.write(`event: connected
data: ${JSON.stringify({
    message:   "Admin notification stream connected",
    timestamp: new Date().toISOString(),
  })}

`);

  // ── Clean up when admin closes the tab / connection drops ─────────────────
  req.on("close", () => {
    removeAdminConnection(connectionId);
  });
};

// ─── Admin Login ──────────────────────────────────────────────────────────────
// POST /api/v1/admin/login
// Credentials are validated against ADMIN_USERNAME + ADMIN_PASSWORD in .env
// On success returns a JWT with role:"admin" embedded — this token unlocks all admin routes
export const adminLogin = asyncHandler(async (req: Request, res: Response) => {
  const { username, password } = req.body;

  if (!username || !password) {
    throw ApiError.badRequest("username and password are required");
  }

  // Compare against hardcoded .env credentials (no DB lookup needed)
  if (username !== env.admin.username || password !== env.admin.password) {
    throw ApiError.unauthorized("Invalid admin credentials");
  }

  // Sign a token with role:"admin" — this is what adminOnly guard checks
  const payload       = { userId: "admin", role: "admin" };
  const accessToken   = signAccessToken(payload);
  const refreshToken  = signRefreshToken(payload);

  sendSuccess(res, { accessToken, refreshToken }, "Admin login successful");
});

// ─── Admin Refresh Token ──────────────────────────────────────────────────────
// POST /api/v1/admin/refresh-token
import { verifyRefreshToken } from "../../utils/jwt";

export const adminRefreshToken = asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken: token } = req.body;
  if (!token) throw ApiError.badRequest("refreshToken is required");

  const decoded = verifyRefreshToken(token);

  // Make sure the refresh token actually belongs to an admin
  if (decoded.role !== "admin") throw ApiError.forbidden("Not an admin token");

  const payload      = { userId: "admin", role: "admin" };
  const accessToken  = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  sendSuccess(res, { accessToken, refreshToken }, "Token refreshed");
});

// ══════════════════════════════════════════════════════════════════════════════
// PRODUCT MANAGEMENT
// ══════════════════════════════════════════════════════════════════════════════

// ─── Get All Products (including inactive/drafts) ─────────────────────────────
// GET /api/v1/admin/products
export const adminGetAllProducts = asyncHandler(async (req: AuthRequest, res: Response) => {
  const page   = Math.max(1, parseInt(req.query.page  as string) || 1);
  const limit  = Math.min(50, parseInt(req.query.limit as string) || 20);
  const skip   = (page - 1) * limit;
  const search = req.query.search as string;

  const filter: Record<string, unknown> = {};  // no isActive filter — admin sees all
  if (search) filter.$text = { $search: search };

  const [products, total] = await Promise.all([
    Product.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Product.countDocuments(filter),
  ]);

  sendSuccess(res, {
    products,
    pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
  }, "Products fetched");
});

// ─── Create Product ───────────────────────────────────────────────────────────
// POST /api/v1/admin/products
export const adminCreateProduct = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { name, description, images, price, discountPrice, quantity } = req.body;

  if (!name || !description || !images || price === undefined || quantity === undefined) {
    throw ApiError.badRequest("name, description, images, price and quantity are required");
  }

  const product = await Product.create({ name, description, images, price, discountPrice, quantity });
  sendCreated(res, { product }, "Product created");
});

// ─── Update Product ───────────────────────────────────────────────────────────
// PATCH /api/v1/admin/products/:id
export const adminUpdateProduct = asyncHandler(async (req: AuthRequest, res: Response) => {
  const allowed = ["name", "description", "images", "price", "discountPrice", "quantity", "isActive"];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }

  if (Object.keys(updates).length === 0) throw ApiError.badRequest("No valid fields to update");

  const product = await Product.findByIdAndUpdate(
    req.params.id,
    { $set: updates },
    { new: true, runValidators: true }
  );
  if (!product) throw ApiError.notFound("Product not found");

  sendSuccess(res, { product }, "Product updated");
});

// ─── Delete Product (hard delete for admin) ───────────────────────────────────
// DELETE /api/v1/admin/products/:id
export const adminDeleteProduct = asyncHandler(async (req: AuthRequest, res: Response) => {
  const product = await Product.findByIdAndDelete(req.params.id);
  if (!product) throw ApiError.notFound("Product not found");

  sendSuccess(res, null, "Product permanently deleted");
});

// ─── Toggle Product Active Status ─────────────────────────────────────────────
// PATCH /api/v1/admin/products/:id/toggle
export const adminToggleProduct = asyncHandler(async (req: AuthRequest, res: Response) => {
  const product = await Product.findById(req.params.id);
  if (!product) throw ApiError.notFound("Product not found");

  product.isActive = !product.isActive;
  await product.save();

  sendSuccess(res, { product }, `Product ${product.isActive ? "activated" : "deactivated"}`);
});

// ══════════════════════════════════════════════════════════════════════════════
// ORDER MANAGEMENT
// ══════════════════════════════════════════════════════════════════════════════

// ─── Get All Orders ───────────────────────────────────────────────────────────
// GET /api/v1/admin/orders?page&limit&status
export const adminGetAllOrders = asyncHandler(async (req: AuthRequest, res: Response) => {
  const page   = Math.max(1, parseInt(req.query.page  as string) || 1);
  const limit  = Math.min(50, parseInt(req.query.limit as string) || 20);
  const skip   = (page - 1) * limit;
  const status = req.query.status as string;

  const filter: Record<string, unknown> = {};
  if (status && Object.values(OrderStatus).includes(status as OrderStatus)) {
    filter.status = status;
  }

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("userId", "name email phoneNumber")
      .populate("payment", "method status amount paidAt"),
    Order.countDocuments(filter),
  ]);

  sendSuccess(res, {
    orders,
    pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
  }, "Orders fetched");
});

// ─── Get Single Order ─────────────────────────────────────────────────────────
// GET /api/v1/admin/orders/:id
export const adminGetOrderById = asyncHandler(async (req: AuthRequest, res: Response) => {
  const order = await Order.findById(req.params.id)
    .populate("userId", "name email phoneNumber addresses")
    .populate("payment");

  if (!order) throw ApiError.notFound("Order not found");

  sendSuccess(res, { order }, "Order fetched");
});

// ─── Update Order Status ──────────────────────────────────────────────────────
// PATCH /api/v1/admin/orders/:id/status
// Body: { status, note? }
export const adminUpdateOrderStatus = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { status, note } = req.body;

  const validStatuses = Object.values(OrderStatus);
  if (!status || !validStatuses.includes(status)) {
    throw ApiError.badRequest(`status must be one of: ${validStatuses.join(", ")}`);
  }

  const order = await Order.findById(req.params.id);
  if (!order) throw ApiError.notFound("Order not found");

  // Prevent updating already terminal statuses
  const terminal = [OrderStatus.DELIVERED, OrderStatus.CANCELLED, OrderStatus.REFUNDED];
  if (terminal.includes(order.status)) {
    throw ApiError.badRequest(`Cannot update an order with status "${order.status}"`);
  }

  order.status = status;
  if (status === OrderStatus.DELIVERED) order.deliveredAt = new Date();
  if (note) order.statusHistory[order.statusHistory.length - 1].note = note;

  await order.save();

  // Broadcast status change to all connected admin tabs
  notifyOrderUpdated({
    orderId:   order.orderId,
    status:    order.status,
    timestamp: new Date().toISOString(),
  });

  sendSuccess(res, { order }, "Order status updated");
});

// ─── Order Stats ──────────────────────────────────────────────────────────────
// GET /api/v1/admin/orders/stats
export const adminOrderStats = asyncHandler(async (_req: AuthRequest, res: Response) => {
  const [statusCounts, revenueData, recentOrders] = await Promise.all([
    // Count per status
    Order.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } }
    ]),
    // Total revenue from delivered orders
    Order.aggregate([
      { $match: { status: OrderStatus.DELIVERED } },
      { $group: { _id: null, totalRevenue: { $sum: "$totalAmount" }, totalOrders: { $sum: 1 } } }
    ]),
    // Last 5 orders
    Order.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .populate("userId", "name email"),
  ]);

  const stats = Object.fromEntries(
    Object.values(OrderStatus).map(s => [s, 0])
  );
  statusCounts.forEach(({ _id, count }) => { stats[_id] = count; });

  sendSuccess(res, {
    byStatus:    stats,
    totalOrders: statusCounts.reduce((sum, s) => sum + s.count, 0),
    revenue:     revenueData[0] ?? { totalRevenue: 0, totalOrders: 0 },
    recentOrders,
  }, "Order stats fetched");
});

// ══════════════════════════════════════════════════════════════════════════════
// USER MANAGEMENT
// ══════════════════════════════════════════════════════════════════════════════

// ─── Get All Users ────────────────────────────────────────────────────────────
// GET /api/v1/admin/users?page&limit&search
export const adminGetAllUsers = asyncHandler(async (req: AuthRequest, res: Response) => {
  const page   = Math.max(1, parseInt(req.query.page  as string) || 1);
  const limit  = Math.min(50, parseInt(req.query.limit as string) || 20);
  const skip   = (page - 1) * limit;
  const search = req.query.search as string;

  const filter: Record<string, unknown> = {};
  if (search) {
    filter.$or = [
      { name:        { $regex: search, $options: "i" } },
      { email:       { $regex: search, $options: "i" } },
      { phoneNumber: { $regex: search, $options: "i" } },
    ];
  }

  const [users, total] = await Promise.all([
    User.find(filter)
      .select("-password -refreshToken -passwordChangedAt")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    User.countDocuments(filter),
  ]);

  sendSuccess(res, {
    users,
    pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
  }, "Users fetched");
});

// ─── Get Single User with their Orders ───────────────────────────────────────
// GET /api/v1/admin/users/:id
export const adminGetUserById = asyncHandler(async (req: AuthRequest, res: Response) => {
  const user = await User.findById(req.params.id)
    .select("-password -refreshToken -passwordChangedAt")
    .populate({ path: "orders", options: { sort: { createdAt: -1 }, limit: 10 } })
    .populate({ path: "payments", options: { sort: { createdAt: -1 }, limit: 10 } });

  if (!user) throw ApiError.notFound("User not found");

  sendSuccess(res, { user }, "User fetched");
});

// ─── Toggle User Active (ban/unban) ──────────────────────────────────────────
// PATCH /api/v1/admin/users/:id/toggle
export const adminToggleUser = asyncHandler(async (req: AuthRequest, res: Response) => {
  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound("User not found");

  user.isActive = !user.isActive;
  await user.save({ validateBeforeSave: false });

  sendSuccess(res, {
    userId:   user._id,
    isActive: user.isActive,
  }, `User ${user.isActive ? "activated" : "banned"}`);
});

// ── User Stats ────────────────────────────────────────────────────────────────
// GET /api/v1/admin/users/stats
export const adminUserStats = asyncHandler(async (_req: AuthRequest, res: Response) => {
  const [total, active, newThisMonth] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ isActive: true }),
    User.countDocuments({
      createdAt: { $gte: new Date(new Date().setDate(1)) }, // since 1st of this month
    }),
  ]);

  sendSuccess(res, {
    total,
    active,
    banned: total - active,
    newThisMonth,
  }, "User stats fetched");
});

// ══════════════════════════════════════════════════════════════════════════════
// PAYMENT MANAGEMENT
// ══════════════════════════════════════════════════════════════════════════════

// ─── Get All Payments ─────────────────────────────────────────────────────────
// GET /api/v1/admin/payments?page&limit&status&method
export const adminGetAllPayments = asyncHandler(async (req: AuthRequest, res: Response) => {
  const page   = Math.max(1, parseInt(req.query.page  as string) || 1);
  const limit  = Math.min(50, parseInt(req.query.limit as string) || 20);
  const skip   = (page - 1) * limit;
  const status = req.query.status as string;
  const method = req.query.method as string;

  const filter: Record<string, unknown> = {};
  if (status) filter.status = status;
  if (method) filter.method = method;

  const [payments, total] = await Promise.all([
    Payment.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("userId",  "name email")
      .populate("orderId", "orderId totalAmount status"),
    Payment.countDocuments(filter),
  ]);

  sendSuccess(res, {
    payments,
    pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
  }, "Payments fetched");
});

// ─── Get Single Payment ───────────────────────────────────────────────────────
// GET /api/v1/admin/payments/:id
export const adminGetPaymentById = asyncHandler(async (req: AuthRequest, res: Response) => {
  const payment = await Payment.findById(req.params.id)
    .populate("userId",  "name email phoneNumber")
    .populate("orderId");

  if (!payment) throw ApiError.notFound("Payment not found");

  sendSuccess(res, { payment }, "Payment fetched");
});

// ─── Payment Stats ────────────────────────────────────────────────────────────
// GET /api/v1/admin/payments/stats
export const adminPaymentStats = asyncHandler(async (_req: AuthRequest, res: Response) => {
  const [byStatus, byMethod, totalCollected] = await Promise.all([
    Payment.aggregate([{ $group: { _id: "$status", count: { $sum: 1 }, amount: { $sum: "$amount" } } }]),
    Payment.aggregate([{ $group: { _id: "$method", count: { $sum: 1 } } }]),
    Payment.aggregate([
      { $match: { status: "paid" } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]),
  ]);

  sendSuccess(res, {
    byStatus,
    byMethod,
    totalCollected: totalCollected[0]?.total ?? 0,
  }, "Payment stats fetched");
});

// ══════════════════════════════════════════════════════════════════════════════
// WEB PUSH — background notifications even when browser is closed
// ══════════════════════════════════════════════════════════════════════════════

// ─── Get VAPID public key ─────────────────────────────────────────────────────
// GET /api/v1/admin/push/vapid-key
// Frontend fetches this once to initialise the browser push subscription.
// Public key is safe to expose — it is not a secret.
export const adminGetVapidKey = asyncHandler(async (_req: AuthRequest, res: Response) => {
  sendSuccess(res, { publicKey: env.vapid.publicKey }, "VAPID public key");
});

// ─── Save push subscription ───────────────────────────────────────────────────
// POST /api/v1/admin/push/subscribe
// Body: the PushSubscription object from browser's pushManager.subscribe()
// Called automatically after admin grants notification permission.
export const adminSavePushSubscription = asyncHandler(async (req: AuthRequest, res: Response) => {
  const sub = req.body as PushSubscription;

  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    throw ApiError.badRequest(
      "Invalid subscription object. Must contain endpoint, keys.p256dh and keys.auth."
    );
  }

  saveSubscription(sub);

  sendSuccess(res, {
    subscribed:        true,
    totalSubscriptions: getSubscriptionCount(),
  }, "Push subscription saved. You will receive notifications for new orders.");
});

// ══════════════════════════════════════════════════════════════════════════════
// STORE MANAGEMENT
// ══════════════════════════════════════════════════════════════════════════════

// ─── Get Store Status ─────────────────────────────────────────────────────────
// GET /api/v1/admin/store/status
// Also publicly accessible at GET /api/v1/store/status (mounted in server.ts)
// so the frontend can check store state without an admin token.
// export const getAdminStoreStatus = asyncHandler(async (_req: AuthRequest, res: Response) => {
//   const status = getStoreStatus();
//   sendSuccess(res, status, "Store status fetched");
// });

// // ─── Open Store ───────────────────────────────────────────────────────────────
// // PATCH /api/v1/admin/store/open
// export const openStore = asyncHandler(async (req: AuthRequest, res: Response) => {
//   const already = isStoreOpen();
//   if (await already) {
//     return sendSuccess(res, { isOpen: true }, "Store is already open");
//   }

//   setStoreOpen(true);
//   recordStoreStateChange(true, req.user!.userId);

//   console.log(`[store] Store OPENED by admin (${req.user!.userId})`);

//   sendSuccess(res, { isOpen: true }, "Store is now open. Customers can add to cart and place orders.");
// });

// // ─── Close Store ──────────────────────────────────────────────────────────────
// // PATCH /api/v1/admin/store/close
// // Body: { reason? }  — optional reason logged for audit
// export const closeStore = asyncHandler(async (req: AuthRequest, res: Response) => {
//   const { reason } = req.body;

//   const already = !isStoreOpen();
//   if (already) {
//     return sendSuccess(res, { isOpen: false }, "Store is already closed");
//   }

//   setStoreOpen(false);
//   recordStoreStateChange(false, req.user!.userId);

//   console.log(
//     `[store] Store CLOSED by admin (${req.user!.userId})` +
//     (reason ? ` — reason: ${reason}` : "")
//   );

//   sendSuccess(res, {
//     isOpen: false,
//     reason: reason ?? null,
//   }, "Store is now closed. Customers can browse but cannot add to cart or place orders.");
// });

// // ─── Toggle Store (convenience) ───────────────────────────────────────────────
// // PATCH /api/v1/admin/store/toggle
// export const toggleStore = asyncHandler(async (req: AuthRequest, res: Response) => {
//   const currentlyOpen = isStoreOpen();
//   const newState      = !currentlyOpen;

//   setStoreOpen(newState);
//   recordStoreStateChange(newState, req.user!.userId);

//   console.log(`[store] Store toggled to ${newState ? "OPEN" : "CLOSED"} by admin (${req.user!.userId})`);

//   sendSuccess(res, {
//     isOpen:  newState,
//     message: newState
//       ? "Store opened — customers can now shop"
//       : "Store closed — customers can browse but not purchase",
//   }, `Store is now ${newState ? "open" : "closed"}`);
// });

// ─── Dashboard Summary ────────────────────────────────────────────────────────
// GET /api/v1/admin/dashboard
export const adminDashboard = asyncHandler(async (_req: AuthRequest, res: Response) => {
  const [
    totalUsers,
    totalProducts,
    totalOrders,
    pendingOrders,
    totalRevenue,
    recentOrders,
  ] = await Promise.all([
    User.countDocuments({ isActive: true }),
    Product.countDocuments({ isActive: true }),
    Order.countDocuments(),
    Order.countDocuments({ status: OrderStatus.PENDING }),
    Payment.aggregate([
      { $match: { status: "paid" } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]),
    Order.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .populate("userId", "name email"),
  ]);

  sendSuccess(res, {
    stats: {
      totalUsers,
      totalProducts,
      totalOrders,
      pendingOrders,
      totalRevenue: totalRevenue[0]?.total ?? 0,
    },
    recentOrders,
  }, "Dashboard data fetched");
});

// Add this to admin.controller.ts
// Add route: router.post("/push/test", authenticate, adminOnly, adminTestPush);

import { notifyAdminPush, getSubscriptionCount } from "../../utils/webPush";

export const adminTestPush = asyncHandler(async (_req: AuthRequest, res: Response) => {
  const count = getSubscriptionCount();

  if (count === 0) {
    throw ApiError.notFound(
      "No push subscriptions stored. Open the admin dashboard and click 'Enable Notifications' first."
    );
  }

  await notifyAdminPush({
    title: "🧪 Test Notification",
    body:  "Web Push is working! You'll receive order alerts even with the browser closed.",
    url:   "/admin/orders",
    tag:   "test-push",
  });

  sendSuccess(res, { sent: true, subscriptions: count }, `Test push sent to ${count} device(s)`);
});