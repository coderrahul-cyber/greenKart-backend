// src/modules/order/order.controller.ts
import type { Response } from "express";
import { Order, OrderStatus } from "./order.model";
import { Cart } from "../cart/cart.model";
import { Product } from "../product/product.model";
import { Payment, PaymentMethod, PaymentStatus } from "../payment/payment.model";
import { User } from "../user/user.model";
import { ApiError } from "../../utils/apiError";
import { asyncHandler } from "../../utils/asynchandler";
import { sendSuccess, sendCreated } from "../../utils/response";
import type { AuthRequest } from "../../middleware/auth";
import { notifyNewOrder, notifyLowStock } from "../../utils/adminNotifier";
import { notifyAdminPush } from "../../utils/webPush";

// ─── Structured stock error helper ───────────────────────────────────────────
// Returns a 409 with code:"INSUFFICIENT_STOCK" + a structured array so the
// frontend can show a specific modal per failed item instead of a generic toast.
const sendInsufficientStockError = (
  res: Response,
  failedItems: Array<{
    productId: string;
    name:      string;
    available: number;   // current stock in DB
    requested: number;   // what the user tried to buy
  }>
) => {
  return res.status(409).json({
    success: false,
    code:    "INSUFFICIENT_STOCK",          // frontend checks this exact string
    message: failedItems
      .map(i =>
        i.available === 0
          ? `"${i.name}" is out of stock`
          : `"${i.name}" — only ${i.available} unit(s) available`
      )
      .join("; "),
    data: failedItems,                      // structured array for the modal
  });
};

// ─── Place Order ──────────────────────────────────────────────────────────────
// POST /api/v1/orders
// Body: { addressId|shippingAddress, paymentMethod: "cod"|"razorpay", notes? }
//
// Concurrency strategy — TWO-PHASE:
//
// Phase 1 (validate): Read every product and confirm stock looks sufficient.
//   This is an optimistic read — another user could race us here, that's fine.
//   We catch it in Phase 2.
//
// Phase 2 (atomic reserve): For each item we call findOneAndUpdate with a
//   $gte condition + $inc in ONE atomic MongoDB operation.
//   If another user bought the last unit between Phase 1 and Phase 2,
//   MongoDB returns null and we immediately stop and roll back anything
//   already decremented in this loop.
//
// This means: no session, no replica-set required, no window for overselling.
export const placeOrder = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { addressId, shippingAddress: rawAddress, paymentMethod, notes } = req.body;

  if (!paymentMethod) {
    throw ApiError.badRequest("paymentMethod is required");
  }
  const validMethods = Object.values(PaymentMethod);
  if (!validMethods.includes(paymentMethod)) {
    throw ApiError.badRequest(`paymentMethod must be one of: ${validMethods.join(", ")}`);
  }

  // ── Resolve shipping address ───────────────────────────────────────────────
  // Frontend can send EITHER:
  //   Option A — { addressId: "64abc..." }         ← ID of a saved address
  //   Option B — { shippingAddress: { line1, city, pincode } } ← raw address
  let shippingAddress: { line1: string; line2?: string; city: string; pincode: string } | null = null;

  if (addressId) {
    // Option A: look up the saved address from the user's profile
    const user = await User.findById(req.user!.userId).select("addresses");
    if (!user) throw ApiError.notFound("User not found");

    const saved = user.addresses.find(
      (a) => a._id?.toString() === addressId.toString()
    );
    if (!saved) {
      throw ApiError.notFound(
        "Address not found. Please select a valid saved address or enter a new one."
      );
    }
    shippingAddress = {
      line1:   saved.line1,
      line2:   saved.line2,
      city:    saved.city,
      pincode: saved.pincode,
    };
  } else if (rawAddress?.line1 && rawAddress?.city && rawAddress?.pincode) {
    // Option B: raw address object sent directly
    shippingAddress = {
      line1:   rawAddress.line1,
      line2:   rawAddress.line2,
      city:    rawAddress.city,
      pincode: rawAddress.pincode,
    };
  } else {
    throw ApiError.badRequest(
      "Provide either an addressId (saved address) or a shippingAddress object with line1, city, and pincode"
    );
  }

  const cart = await Cart.findOne({ userId: req.user!.userId });
  if (!cart || cart.items.length === 0) {
    throw ApiError.badRequest("Your cart is empty");
  }

  // ── Phase 1: Optimistic read — confirm products exist and look available ────
  // We still do this first pass to give friendly errors for obviously missing
  // or inactive products before touching any stock numbers.
  for (const cartItem of cart.items) {
    const product = await Product.findById(cartItem.productId);
    if (!product || !product.isActive) {
      throw ApiError.badRequest(`"${cartItem.productName}" is no longer available`);
    }
    if (product.quantity < cartItem.quantity) {
      throw ApiError.badRequest(
        `"${product.name}" only has ${product.quantity} unit(s) left — you have ${cartItem.quantity} in your cart`
      );
    }
  }

  // ── Phase 2: Atomic stock reservation ────────────────────────────────────────
  // For each cart item we do ONE atomic MongoDB operation:
  //   find the product WHERE quantity >= requested AND decrement by requested
  // If another user bought the last unit between Phase 1 and here,
  // MongoDB returns null → we roll back everything already decremented.
  const reserved: Array<{ productId: string; quantity: number }> = [];

  for (const cartItem of cart.items) {
    const updated = await Product.findOneAndUpdate(
      {
        _id:      cartItem.productId,
        isActive: true,
        quantity: { $gte: cartItem.quantity }, // ← atomic check — both happen together
      },
      { $inc: { quantity: -cartItem.quantity } }, // ← atomic decrement
      { returnDocument: "after" }
    );

    if (!updated) {
      // Race condition hit — roll back every item we already reserved
      for (const done of reserved) {
        await Product.findByIdAndUpdate(done.productId, {
          $inc: { quantity: done.quantity }, // restore
        });
      }
      // Fetch current stock to populate the structured error response
      const current = await Product.findById(cartItem.productId, { quantity: 1, name: 1 }).lean();
      return sendInsufficientStockError(res, [
        {
          productId: cartItem.productId.toString(),
          name:      cartItem.productName,
          available: current?.quantity ?? 0,
          requested: cartItem.quantity,
        },
      ]);
    }

    reserved.push({
      productId: cartItem.productId.toString(),
      quantity:  cartItem.quantity,
    });
  }

  // ── Build order totals ────────────────────────────────────────────────────────
  let itemsTotal = 0;
  const orderItems = cart.items.map((cartItem) => {
    const lineTotal  = cartItem.priceAtAdd * cartItem.quantity;
    itemsTotal      += lineTotal;
    return {
      productId:  cartItem.productId,
      name:       cartItem.productName,
      image:      cartItem.productImage,
      priceAtBuy: cartItem.priceAtAdd,
      quantity:   cartItem.quantity,
      lineTotal,
    };
  });

  const shippingCharge = itemsTotal >= 500 ? 0 : 50;
  const discount       = cart.discount ?? 0;
  const taxAmount      = Math.round(itemsTotal * 0.18);
  const totalAmount    = itemsTotal + shippingCharge - discount + taxAmount;

  // ── Create order, payment, update user, clear cart ────────────────────────────
  // Stock is already safely reserved above. If anything here fails we roll back stock.
  let order;
  let payment;

  try {
    order = await Order.create({
      userId: req.user!.userId,
      items:  orderItems,
      shippingAddress,
      itemsTotal,
      shippingCharge,
      discount,
      taxAmount,
      totalAmount,
      couponCode: cart.couponCode,
      notes,
    });

    payment = await Payment.create({
      userId:  req.user!.userId,
      orderId: order._id,
      amount:  totalAmount,
      method:  paymentMethod,
      status:  PaymentStatus.PENDING,
    });

    order.payment = payment._id;
    await order.save();

    await User.findByIdAndUpdate(req.user!.userId, {
      $push: { orders: order._id, payments: payment._id },
    });

    cart.items      = [];
    cart.discount   = 0;
    cart.couponCode = undefined;
    await cart.save();

  } catch (err) {
    // Roll back reserved stock
    for (const done of reserved) {
      await Product.findByIdAndUpdate(done.productId, {
        $inc: { quantity: done.quantity },
      });
    }
    if (order)   await Order.findByIdAndDelete(order._id);
    if (payment) await Payment.findByIdAndDelete(payment._id);
    throw err;
  }

  // ── Notify admin in real time ───────────────────────────────────────────────
  // Pushes a new_order event to all open admin SSE connections immediately.
  // Non-blocking — runs after the order is fully committed to DB.
  const customerUser = await User.findById(req.user!.userId).select("name").lean();
  notifyNewOrder({
    orderId:       order.orderId,
    mongoId:        order._id.toString(),
    customerName:  customerUser?.name ?? "Unknown",
    totalAmount:   order.totalAmount,
    itemCount:     order.items.length,
    paymentMethod: paymentMethod,
    city:          shippingAddress!.city,
    timestamp:     new Date().toISOString(),
  });

  // Web push — wakes admin browser even if Chrome is closed
  notifyAdminPush({
    title: `New Order — ${order.orderId}`,
    body:  `${customerUser?.name ?? "Customer"} ordered ₹${order.totalAmount} from ${shippingAddress!.city}`,
    icon:  "/icons/logo-192.png",
    badge: "/icons/badge-72.png",
    url:   `/admin/orders/${order._id}`,
    tag:   order.orderId,   // replaces previous notification for same order
    data:  { orderId: order.orderId, type: "new_order" },
  }).catch(err => console.error("[push] Failed to send order push:", err.message));

  // ── Low stock warnings ───────────────────────────────────────────────────────
  // After a successful order, check if any ordered product is now running low.
  // We return this as a warnings[] array in the success response so the frontend
  // can show a toast: "Hurry! Only 2 units of Nike Air Max left"
  const LOW_STOCK_THRESHOLD = 5;
  const warnings: string[] = [];

  for (const item of orderItems) {
    const current = await Product.findById(item.productId, { quantity: 1, name: 1 }).lean();
    if (current && current.quantity > 0 && current.quantity <= LOW_STOCK_THRESHOLD) {
      warnings.push(
        `Only ${current.quantity} unit(s) of "${current.name}" left — grab it before it's gone!`
      );
      // Push low_stock event to admin dashboard simultaneously
      notifyLowStock({
        productName: current.name,
        remaining:   current.quantity,
        timestamp:   new Date().toISOString(),
      });
    }
  }

  sendCreated(
    res,
    { order, payment, ...(warnings.length > 0 && { warnings }) },
    "Order placed successfully"
  );
});

// ─── Get My Orders ────────────────────────────────────────────────────────────
// GET /api/v1/orders?page=1&limit=10&status=pending
export const getMyOrders = asyncHandler(async (req: AuthRequest, res: Response) => {
  const page   = Math.max(1, parseInt(req.query.page  as string) || 1);
  const limit  = Math.min(20, parseInt(req.query.limit as string) || 10);
  const skip   = (page - 1) * limit;
  const status = req.query.status as string;

  const filter: Record<string, unknown> = { userId: req.user!.userId };
  if (status && Object.values(OrderStatus).includes(status as OrderStatus)) {
    filter.status = status;
  }

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("payment", "method status paidAt amount"),
    Order.countDocuments(filter),
  ]);

  sendSuccess(res, {
    orders,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasNext: page < Math.ceil(total / limit),
      hasPrev: page > 1,
    },
  }, "Orders fetched");
});

// ─── Get Single Order ─────────────────────────────────────────────────────────
// GET /api/v1/orders/:id
export const getOrderById = asyncHandler(async (req: AuthRequest, res: Response) => {
  const order = await Order.findOne({
    _id:    req.params.id,
    userId: req.user!.userId,
  }).populate("payment");

  if (!order) throw ApiError.notFound("Order not found");

  sendSuccess(res, { order }, "Order fetched");
});

// ─── Cancel Order ─────────────────────────────────────────────────────────────
// PATCH /api/v1/orders/:id/cancel
export const cancelOrder = asyncHandler(async (req: AuthRequest, res: Response) => {
  const order = await Order.findOne({
    _id:    req.params.id,
    userId: req.user!.userId,
  });
  if (!order) throw ApiError.notFound("Order not found");

  const nonCancellable = [
    OrderStatus.SHIPPED,
    OrderStatus.DELIVERED,
    OrderStatus.CANCELLED,
    OrderStatus.REFUNDED,
  ];
  if (nonCancellable.includes(order.status)) {
    throw ApiError.badRequest(`Cannot cancel an order with status "${order.status}"`);
  }

  // Restore stock atomically using $inc (safe — no race condition on restore)
  for (const item of order.items) {
    await Product.findByIdAndUpdate(item.productId, {
      $inc: { quantity: item.quantity },
    });
  }

  order.status       = OrderStatus.CANCELLED;
  order.cancelledAt  = new Date();
  order.cancelReason = req.body.reason ?? "Cancelled by customer";
  await order.save();

  sendSuccess(res, { order }, "Order cancelled");
});