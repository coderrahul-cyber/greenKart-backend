// src/modules/payment/payment.routes.ts
import { Router } from "express";
import {
  // COD
  confirmCodPayment,
  // Razorpay
  createRazorpayOrder,
  verifyRazorpayPayment,
  razorpayWebhook,
  // Shared
  getMyPayments,
  getPaymentById,
  requestRefund,
} from "./payment.controller";
import { authenticate, adminOnly } from "../../middleware/auth";

const router = Router();

// ── Razorpay webhook — NO auth, secured by signature header ──────────────────
// Must be registered BEFORE the authenticate middleware below.
// Razorpay sends raw JSON — this route should NOT use express.json() body
// re-parsing; it relies on the already-parsed req.body from server.ts.
router.post("/razorpay/webhook", razorpayWebhook);

// ── All routes below require a logged-in user ─────────────────────────────────
router.use(authenticate);

// ── COD ───────────────────────────────────────────────────────────────────────
// Admin confirms cash collected on delivery
router.patch("/:id/cod-confirm", adminOnly, confirmCodPayment);


// ── Razorpay ──────────────────────────────────────────────────────────────────
router.post("/razorpay/create-order", createRazorpayOrder);    // Step 1
router.post("/razorpay/verify",       verifyRazorpayPayment);  // Step 3

// ── Shared ────────────────────────────────────────────────────────────────────
router.get  ("/",           getMyPayments);
router.get  ("/:id",        getPaymentById);
router.patch("/:id/refund", requestRefund);

export { router as paymentRouter };