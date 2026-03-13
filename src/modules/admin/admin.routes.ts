// src/modules/admin/admin.routes.ts
import { Router } from "express";
import {
  // Auth
  adminLogin,
  adminRefreshToken,
  // Push notifications
  adminGetVapidKey,
  adminSavePushSubscription,
  // Store management
  // getAdminStoreStatus,
  // openStore,
  // closeStore,
  // toggleStore,
  // Notifications
  adminNotificationStream,
  // Dashboard
  adminDashboard,
  // Products
  adminGetAllProducts,
  adminCreateProduct,
  adminUpdateProduct,
  adminDeleteProduct,
  adminToggleProduct,
  // Orders
  adminGetAllOrders,
  adminGetOrderById,
  adminUpdateOrderStatus,
  adminOrderStats,
  // Users
  adminGetAllUsers,
  adminGetUserById,
  adminToggleUser,
  adminUserStats,
  // Payments
  adminGetAllPayments,
  adminGetPaymentById,
  adminPaymentStats,
} from "./admin.controller";
import { authenticate, adminOnly } from "../../middleware/auth";
import { adminLoginLimiter }       from "../../middleware/rateLimiter";

const router = Router();

// ── Public — no auth required ────────────────────────────────────────────────
router.post("/login",          adminLoginLimiter, adminLogin);
router.post("/refresh-token",  adminLoginLimiter, adminRefreshToken);
router.get ("/push/vapid-key", adminGetVapidKey);  // ← public: browser fetches before subscribing

// ── All routes below require a valid admin token ─────────────────────────────
router.use(authenticate, adminOnly);

// Web push (subscribe needs auth — token identifies the admin device)
router.post("/push/subscribe", adminSavePushSubscription);

// // Store management
// router.get  ("/store/status", getAdminStoreStatus);
// router.patch("/store/open",   openStore);
// router.patch("/store/close",  closeStore);
// router.patch("/store/toggle", toggleStore);

// Notifications — SSE stream
router.get("/notifications/stream", adminNotificationStream);

// Dashboard
router.get("/dashboard", adminDashboard);

// Products
router.get   ("/products",            adminGetAllProducts);
router.post  ("/products",            adminCreateProduct);
router.patch ("/products/:id",        adminUpdateProduct);
router.delete("/products/:id",        adminDeleteProduct);
router.patch ("/products/:id/toggle", adminToggleProduct);

// Orders
router.get   ("/orders/stats",        adminOrderStats);      // must be BEFORE /:id
router.get   ("/orders",              adminGetAllOrders);
router.get   ("/orders/:id",          adminGetOrderById);
router.patch ("/orders/:id/status",   adminUpdateOrderStatus);

// Users
router.get   ("/users/stats",         adminUserStats);       // must be BEFORE /:id
router.get   ("/users",               adminGetAllUsers);
router.get   ("/users/:id",           adminGetUserById);
router.patch ("/users/:id/toggle",    adminToggleUser);

// Payments
router.get   ("/payments/stats",      adminPaymentStats);    // must be BEFORE /:id
router.get   ("/payments",            adminGetAllPayments);
router.get   ("/payments/:id",        adminGetPaymentById);

export { router as adminRouter };