// src/modules/payment/payment.model.ts
import mongoose, { Schema, type Document, type Model } from "mongoose";

// ─── Enums ────────────────────────────────────────────────────────────────────
export enum PaymentStatus {
  PENDING  = "pending",
  PAID     = "paid",
  FAILED   = "failed",
  REFUNDED = "refunded",
}

export enum PaymentMethod {
  COD      = "cod",      // Cash on Delivery — confirmed on delivery
  RAZORPAY = "razorpay", // Online payment via Razorpay
}

// ─── Interface ────────────────────────────────────────────────────────────────
export interface IPayment extends Document {
  _id:    mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;  // ref → User
  orderId: mongoose.Types.ObjectId; // ref → Order (one-to-one)
  amount: number;
  method: PaymentMethod;
  status: PaymentStatus;

  // ── Razorpay specific fields ──────────────────────────────────────────────
  // razorpayOrderId:   ID created by Razorpay when we call orders.create()
  //                    Sent to the frontend to initialise the Razorpay SDK
  // razorpayPaymentId: ID returned by Razorpay after the user pays
  //                    Used to verify + capture the payment on the backend
  // razorpaySignature: HMAC signature sent by Razorpay after payment
  //                    We verify this to confirm the payment is genuine
  razorpayOrderId?:   string;
  razorpayPaymentId?: string;
  razorpaySignature?: string;

  transactionId?:   string;                   // final confirmed transaction ref
  gatewayResponse?: Record<string, unknown>;  // raw Razorpay payload for debugging
  paidAt?:          Date;
  refundedAt?:      Date;
  refundAmount?:    number;
  refundReason?:    string;
  failureReason?:   string;
  attempts:         number;
  createdAt:        Date;
  updatedAt:        Date;
}

// ─── Schema ───────────────────────────────────────────────────────────────────
const paymentSchema = new Schema<IPayment>(
  {
    userId: {
      type:     Schema.Types.ObjectId,
      ref:      "User",
      required: [true, "User ID is required"],
    },
    orderId: {
      type:     Schema.Types.ObjectId,
      ref:      "Order",
      required: [true, "Order ID is required"],
      unique:   true,  // one payment record per order
    },
    amount: {
      type:     Number,
      required: [true, "Amount is required"],
      min:      [0, "Amount cannot be negative"],
    },
    method: {
      type:     String,
      enum:     Object.values(PaymentMethod),
      required: [true, "Payment method is required"],
    },
    status: {
      type:    String,
      enum:    Object.values(PaymentStatus),
      default: PaymentStatus.PENDING,
    },

    // Razorpay fields
    razorpayOrderId:   { type: String },
    razorpayPaymentId: { type: String },
    razorpaySignature: { type: String },

    transactionId:   { type: String },
    gatewayResponse: { type: Schema.Types.Mixed },

    paidAt:        { type: Date },
    refundedAt:    { type: Date },
    refundAmount:  { type: Number, min: 0 },
    refundReason:  { type: String },
    failureReason: { type: String },

    attempts: {
      type:    Number,
      default: 1,
      min:     1,
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_: unknown, ret: Record<string, unknown>) => {
        delete ret.__v;
        return ret;
      },
    },
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
paymentSchema.index({ userId: 1, createdAt: -1 });
paymentSchema.index({ status: 1 });
paymentSchema.index({ transactionId: 1 },        { sparse: true });
paymentSchema.index({ razorpayOrderId: 1 },       { sparse: true });
paymentSchema.index({ razorpayPaymentId: 1 },     { sparse: true });

// ─── Model ────────────────────────────────────────────────────────────────────
export const Payment: Model<IPayment> = mongoose.model<IPayment>("Payment", paymentSchema);