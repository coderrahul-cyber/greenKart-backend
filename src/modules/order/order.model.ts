// src/modules/order/order.model.ts
import mongoose, { Schema, type Document, type Model } from "mongoose";

// ─── Enums ────────────────────────────────────────────────────────────────────
export enum OrderStatus {
  PENDING    = "pending",
  CONFIRMED  = "confirmed",
  PROCESSING = "processing",
  SHIPPED    = "shipped",
  DELIVERED  = "delivered",
  CANCELLED  = "cancelled",
  REFUNDED   = "refunded",
}

// ─── Order item — price/name/image snapshot at time of purchase ───────────────
export interface IOrderItem {
  productId:  mongoose.Types.ObjectId;
  name:       string;
  image:      string;
  priceAtBuy: number;
  quantity:   number;
  lineTotal:  number;
}

// ─── Shipping address snapshot — matches user address fields exactly ──────────
export interface IShippingAddress {
  line1:   string;
  line2?:  string;
  city:    string;
  pincode: string;
}

// ─── Main interface ───────────────────────────────────────────────────────────
export interface IOrder extends Document {
  _id:             mongoose.Types.ObjectId;
  orderId:         string;
  userId:          mongoose.Types.ObjectId;
  items:           IOrderItem[];
  shippingAddress: IShippingAddress;
  itemsTotal:      number;
  shippingCharge:  number;
  discount:        number;
  taxAmount:       number;
  totalAmount:     number;
  couponCode?:     string;
  status:          OrderStatus;
  statusHistory:   { status: OrderStatus; note?: string; timestamp: Date }[];
  payment?:        mongoose.Types.ObjectId;
  notes?:          string;
  deliveredAt?:    Date;
  cancelledAt?:    Date;
  cancelReason?:   string;
  createdAt:       Date;
  updatedAt:       Date;
}

// ─── Sub-schemas ──────────────────────────────────────────────────────────────
const orderItemSchema = new Schema<IOrderItem>(
  {
    productId:  { type: Schema.Types.ObjectId, ref: "Product", required: true },
    name:       { type: String, required: true },
    image:      { type: String, required: true },
    priceAtBuy: { type: Number, required: true, min: 0 },
    quantity:   { type: Number, required: true, min: 1 },
    lineTotal:  { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const shippingAddressSchema = new Schema<IShippingAddress>(
  {
    line1:   { type: String, required: true },
    line2:   { type: String },
    city:    { type: String, required: true },
    pincode: { type: String, required: true },
  },
  { _id: false }
);

// ─── Order schema ─────────────────────────────────────────────────────────────
const orderSchema = new Schema<IOrder>(
  {
    orderId: { type: String, unique: true, index: true },

    userId: {
      type:     Schema.Types.ObjectId,
      ref:      "User",
      required: [true, "User ID is required"],
      index:    true,
    },

    items: {
      type:     [orderItemSchema],
      required: true,
      validate: {
        validator: (arr: IOrderItem[]) => arr.length > 0,
        message:   "Order must have at least one item",
      },
    },

    shippingAddress: {
      type:     shippingAddressSchema,
      required: [true, "Shipping address is required"],
    },

    itemsTotal:     { type: Number, required: true, min: 0 },
    shippingCharge: { type: Number, default: 0,     min: 0 },
    discount:       { type: Number, default: 0,     min: 0 },
    taxAmount:      { type: Number, default: 0,     min: 0 },
    totalAmount:    { type: Number, required: true, min: 0 },

    couponCode: { type: String, uppercase: true, trim: true },

    status: {
      type:    String,
      enum:    Object.values(OrderStatus),
      default: OrderStatus.PENDING,
      index:   true,
    },

    statusHistory: [
      {
        status:    { type: String, enum: Object.values(OrderStatus), required: true },
        note:      { type: String },
        timestamp: { type: Date, default: () => new Date() },
      },
    ],

    payment:      { type: Schema.Types.ObjectId, ref: "Payment" },
    notes:        { type: String, maxlength: 500 },
    deliveredAt:  { type: Date },
    cancelledAt:  { type: Date },
    cancelReason: { type: String },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_, ret : Record<string, unknown>) => { delete ret.__v; return ret; },
    },
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });

// ─── Pre-save: auto-generate orderId + seed statusHistory ─────────────────────
orderSchema.pre("save", async function () {
  if (!this.isNew) return;
  const count        = await mongoose.model("Order").countDocuments();
  const year         = new Date().getFullYear();
  this.orderId       = `ORD-${year}-${String(count + 1).padStart(5, "0")}`;
  this.statusHistory = [{ status: this.status, timestamp: new Date() }];
});

// ─── Pre-save: append status change to history ────────────────────────────────
orderSchema.pre("save", function (next) {
  if (this.isModified("status") && !this.isNew) {
    this.statusHistory.push({ status: this.status, timestamp: new Date() });
  }
});

export const Order: Model<IOrder> = mongoose.model<IOrder>("Order", orderSchema);