// src/modules/payment/payment.controller.ts
import type { Request, Response } from "express";
import crypto    from "crypto";
import Razorpay  from "razorpay";
import { Payment, PaymentMethod, PaymentStatus } from "./payment.model";
import { Order, OrderStatus } from "../order/order.model";
import { ApiError }      from "../../utils/apiError";
import { asyncHandler }  from "../../utils/asynchandler";
import { sendSuccess, sendCreated } from "../../utils/response";
import { env }           from "../../config/env";
import type { AuthRequest } from "../../middleware/auth";

// ─── Razorpay client ──────────────────────────────────────────────────────────
const getRazorpay = () => {
  if (!env.razorpay.keyId || !env.razorpay.keySecret) {
    throw ApiError.internal(
      "Razorpay keys are not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to .env"
    );
  }
  return new Razorpay({ key_id: env.razorpay.keyId, key_secret: env.razorpay.keySecret });
};

// ══════════════════════════════════════════════════════════════════════════════
// COD FLOW
// ══════════════════════════════════════════════════════════════════════════════
// 1. User places order with paymentMethod:"cod"  → payment.status = "pending"
// 2. Admin confirms delivery                     → PATCH /payments/:id/cod-confirm
//    → payment.status = "paid", order.status = "confirmed"

// ─── Confirm COD on delivery ──────────────────────────────────────────────────
// PATCH /api/v1/payments/:id/cod-confirm   (admin only — wired in routes)
export const confirmCodPayment = asyncHandler(async (req: AuthRequest, res: Response) => {
  const payment = await Payment.findById(req.params.id);
  if (!payment)                                      throw ApiError.notFound("Payment not found");
  if (payment.method !== PaymentMethod.COD)          throw ApiError.badRequest("This route is only for COD payments");
  if (payment.status === PaymentStatus.PAID)         throw ApiError.badRequest("COD payment already confirmed");
  if (payment.status === PaymentStatus.REFUNDED)     throw ApiError.badRequest("Cannot confirm a refunded payment");

  payment.status        = PaymentStatus.PAID;
  payment.paidAt        = new Date();
  payment.transactionId = `COD-${payment._id}`;
  await payment.save();

  await Order.findByIdAndUpdate(payment.orderId, { $set: { status: OrderStatus.CONFIRMED } });

  sendSuccess(res, { payment }, "COD payment confirmed");
});

// ══════════════════════════════════════════════════════════════════════════════
// RAZORPAY ONLINE FLOW
// ══════════════════════════════════════════════════════════════════════════════
//
// Step 1  POST /payments/razorpay/create-order
//         Backend creates Razorpay order → returns { razorpayOrderId, amount, keyId }
//
// Step 2  Frontend opens Razorpay checkout modal using those details
//         User pays → Razorpay returns { razorpayPaymentId, razorpayOrderId, razorpaySignature }
//
// Step 3  POST /payments/razorpay/verify
//         Backend verifies HMAC signature → marks payment PAID, order CONFIRMED
//
// Step 4  POST /payments/razorpay/webhook  (Razorpay → backend, no user token)
//         Safety net for users who close browser after paying but before Step 3

// ─── Step 1: Create Razorpay Order ───────────────────────────────────────────
// POST /api/v1/payments/razorpay/create-order
// Body: { paymentId }
export const createRazorpayOrder = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { paymentId } = req.body;
  if (!paymentId) throw ApiError.badRequest("paymentId is required");

  const payment = await Payment.findOne({ _id: paymentId, userId: req.user!.userId });
  if (!payment)                                         throw ApiError.notFound("Payment not found");
  if (payment.method !== PaymentMethod.RAZORPAY)        throw ApiError.badRequest("This payment is not a Razorpay payment");
  if (payment.status === PaymentStatus.PAID)            throw ApiError.badRequest("Payment already completed");

  // Retry case — reuse existing razorpayOrderId instead of creating a duplicate
  if (payment.razorpayOrderId) {
    return sendSuccess(res, {
      razorpayOrderId: payment.razorpayOrderId,
      amount:          payment.amount * 100,
      currency:        "INR",
      keyId:           env.razorpay.keyId,
    }, "Razorpay order already exists — reusing");
  }

  // ── Call Razorpay API ─────────────────────────────────────────────────────
  // Wrapped in try/catch — if Razorpay is down, under verification, or the
  // keys are wrong we return a user-friendly fallback instead of a 500.
  let rzpOrder;
  try {
    rzpOrder = await getRazorpay().orders.create({
      amount:   Math.round(payment.amount * 100), // Razorpay works in paise
      currency: "INR",
      receipt:  payment._id.toString(),
      notes: {
        paymentId: payment._id.toString(),
        orderId:   payment.orderId.toString(),
        userId:    req.user!.userId,
      },
    });
  } catch (rzpError: unknown) {
    // Log the real error for debugging but never expose it to the user
    console.error("[Razorpay] orders.create failed:", rzpError);

    // Return a structured response the frontend can detect and act on
    return res.status(503).json({
      success: false,
      code:    "RAZORPAY_UNAVAILABLE",
      message:
        "Currently the Razorpay service is down. Please use the COD method to place your order.",
    });
  }

  payment.razorpayOrderId = rzpOrder.id;
  await payment.save();

  sendCreated(res, {
    razorpayOrderId: rzpOrder.id,
    amount:          rzpOrder.amount,   // paise — Razorpay SDK expects this
    currency:        rzpOrder.currency,
    keyId:           env.razorpay.keyId, // frontend passes this to Razorpay SDK
  }, "Razorpay order created");
});

// ─── Step 3: Verify Payment ───────────────────────────────────────────────────
// POST /api/v1/payments/razorpay/verify
// Body: { paymentId, razorpayOrderId, razorpayPaymentId, razorpaySignature }
export const verifyRazorpayPayment = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { paymentId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

  if (!paymentId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    throw ApiError.badRequest(
      "paymentId, razorpayOrderId, razorpayPaymentId and razorpaySignature are all required"
    );
  }

  const payment = await Payment.findOne({
    _id:             paymentId,
    userId:          req.user!.userId,
    razorpayOrderId,
  });
  if (!payment) throw ApiError.notFound("Payment not found or order ID mismatch");

  // Already verified (webhook may have fired first) — idempotent
  if (payment.status === PaymentStatus.PAID) {
    return sendSuccess(res, { payment }, "Payment already verified");
  }

  // ── HMAC signature check ──────────────────────────────────────────────────
  // Razorpay signs: HMAC_SHA256("<razorpayOrderId>|<razorpayPaymentId>", keySecret)
  const expectedSig = crypto
    .createHmac("sha256", env.razorpay.keySecret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest("hex");

  if (expectedSig !== razorpaySignature) {
    payment.status        = PaymentStatus.FAILED;
    payment.failureReason = "Signature verification failed";
    await payment.save();
    throw ApiError.badRequest("Payment verification failed — invalid signature");
  }

  payment.status            = PaymentStatus.PAID;
  payment.razorpayPaymentId = razorpayPaymentId;
  payment.razorpaySignature = razorpaySignature;
  payment.transactionId     = razorpayPaymentId;
  payment.paidAt            = new Date();
  await payment.save();

  await Order.findByIdAndUpdate(payment.orderId, { $set: { status: OrderStatus.CONFIRMED } });

  sendSuccess(res, { payment }, "Payment verified successfully");
});

// ─── Step 4: Razorpay Webhook ─────────────────────────────────────────────────
// POST /api/v1/payments/razorpay/webhook
// No authenticate middleware — secured by X-Razorpay-Signature header instead.
// Handles: payment.captured (success) and payment.failed (failure)
export const razorpayWebhook = asyncHandler(async (req: Request, res: Response) => {
  const signature = req.headers["x-razorpay-signature"] as string;

  if (!signature) throw ApiError.forbidden("Missing webhook signature");

  // Verify Razorpay signed this request
  const expectedSig = crypto
    .createHmac("sha256", env.razorpay.webhookSecret)
    .update(JSON.stringify(req.body))
    .digest("hex");

  if (signature !== expectedSig) throw ApiError.forbidden("Invalid webhook signature");

  const event   = req.body?.event;
  const payload = req.body?.payload?.payment?.entity;

  if (!event || !payload) return res.status(200).json({ received: true });

  // Find our payment by the Razorpay order ID in the webhook
  const payment = await Payment.findOne({ razorpayOrderId: payload.order_id });
  if (!payment)  return res.status(200).json({ received: true }); // not our payment

  if (event === "payment.captured" && payment.status !== PaymentStatus.PAID) {
    payment.status            = PaymentStatus.PAID;
    payment.razorpayPaymentId = payload.id;
    payment.transactionId     = payload.id;
    payment.paidAt            = new Date();
    payment.gatewayResponse   = payload;
    await payment.save();
    await Order.findByIdAndUpdate(payment.orderId, { $set: { status: OrderStatus.CONFIRMED } });
  }

  if (event === "payment.failed" && payment.status === PaymentStatus.PENDING) {
    payment.status          = PaymentStatus.FAILED;
    payment.failureReason   = payload.error_description ?? "Payment failed";
    payment.gatewayResponse = payload;
    await payment.save();
    await Order.findByIdAndUpdate(payment.orderId, {
      $set: { status: OrderStatus.CANCELLED, cancelReason: "Payment failed" },
    });
  }

  // Always 200 — Razorpay retries on any other status
  res.status(200).json({ received: true });
});

// ══════════════════════════════════════════════════════════════════════════════
// SHARED ROUTES (both COD + Razorpay)
// ══════════════════════════════════════════════════════════════════════════════

// ─── Get My Payments ──────────────────────────────────────────────────────────
// GET /api/v1/payments
export const getMyPayments = asyncHandler(async (req: AuthRequest, res: Response) => {
  const page  = Math.max(1, parseInt(req.query.page  as string) || 1);
  const limit = Math.min(20, parseInt(req.query.limit as string) || 10);
  const skip  = (page - 1) * limit;

  const [payments, total] = await Promise.all([
    Payment.find({ userId: req.user!.userId })
      .sort({ createdAt: -1 }).skip(skip).limit(limit)
      .populate("orderId", "orderId totalAmount status createdAt"),
    Payment.countDocuments({ userId: req.user!.userId }),
  ]);

  sendSuccess(res, {
    payments,
    pagination: {
      total, page, limit,
      totalPages: Math.ceil(total / limit),
      hasNext: page < Math.ceil(total / limit),
      hasPrev: page > 1,
    },
  }, "Payments fetched");
});

// ─── Get Payment by ID ────────────────────────────────────────────────────────
// GET /api/v1/payments/:id
export const getPaymentById = asyncHandler(async (req: AuthRequest, res: Response) => {
  const payment = await Payment.findOne({
    _id: req.params.id, userId: req.user!.userId,
  }).populate("orderId");
  if (!payment) throw ApiError.notFound("Payment not found");
  sendSuccess(res, { payment }, "Payment fetched");
});

// ─── Request Refund ───────────────────────────────────────────────────────────
// PATCH /api/v1/payments/:id/refund
export const requestRefund = asyncHandler(async (req: AuthRequest, res: Response) => {
  const payment = await Payment.findOne({ _id: req.params.id, userId: req.user!.userId });
  if (!payment)                                    throw ApiError.notFound("Payment not found");
  if (payment.status !== PaymentStatus.PAID)       throw ApiError.badRequest("Only paid payments can be refunded");

  payment.status       = PaymentStatus.REFUNDED;
  payment.refundedAt   = new Date();
  payment.refundAmount = payment.amount;
  payment.refundReason = req.body.refundReason ?? "Requested by customer";
  await payment.save();

  await Order.findByIdAndUpdate(payment.orderId, { $set: { status: OrderStatus.REFUNDED } });

  sendSuccess(res, { payment }, "Refund initiated");
});



