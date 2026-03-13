// src/modules/cart/cart.model.ts
import mongoose, { Schema, type Document, type Model } from "mongoose";

// ─── Cart item interface ──────────────────────────────────────────────────────
// Exactly what you asked: { id (productId), quantity }
// + 3 snapshot fields explained below
export interface ICartItem {
  _id?:         mongoose.Types.ObjectId;
  productId:    mongoose.Types.ObjectId;  // ref → Product  ("id" from your spec)
  quantity:     number;

  // --- Snapshot fields (added for correctness) ---
  // priceAtAdd: stores the price when the item was added to cart.
  // Why? If the product price changes later, the cart total stays accurate.
  // Without this, a price drop or hike silently changes what the user sees.
  priceAtAdd:   number;

  // productName + productImage: stored so we can display the cart
  // without always joining the Product collection on every request.
  productName:  string;
  productImage: string;
}

// ─── Cart interface ───────────────────────────────────────────────────────────
export interface ICart extends Document {
  _id:        mongoose.Types.ObjectId;
  userId:     mongoose.Types.ObjectId;  // ref → User (one cart per user)
  items:      ICartItem[];
  couponCode?: string;                  // applied promo code
  discount:   number;                  // flat discount from coupon
  lastActivityAt: Date;   // updated on every add/update — used for 7-day expiry
  createdAt:  Date;
  updatedAt:  Date;
}

// ─── Cart item sub-schema ─────────────────────────────────────────────────────
const cartItemSchema = new Schema<ICartItem>(
  {
    productId: {
      type:     Schema.Types.ObjectId,
      ref:      "Product",
      required: [true, "Product ID is required"],
    },
    quantity: {
      type:     Number,
      required: [true, "Quantity is required"],
      min:      [1, "Quantity must be at least 1"],
      default:  1,
    },
    priceAtAdd: {
      type:     Number,
      required: [true, "Price snapshot is required"],
      min:      [0, "Price cannot be negative"],
    },
    productName: {
      type:     String,
      required: [true, "Product name snapshot is required"],
      trim:     true,
    },
    productImage: {
      type:     String,
      required: [true, "Product image snapshot is required"],
    },
  },
  { _id: true }
);

// ─── Cart schema ──────────────────────────────────────────────────────────────
const cartSchema = new Schema<ICart>(
  {
    userId: {
      type:     Schema.Types.ObjectId,
      ref:      "User",
      required: [true, "User ID is required"],
      unique:   true,  // one cart per user
      index:    true,
    },

    items: {
      type:    [cartItemSchema],
      default: [],
    },

    couponCode: {
      type:      String,
      uppercase: true,
      trim:      true,
    },

    discount: {
      type:    Number,
      default: 0,
      min:     [0, "Discount cannot be negative"],
    },

    // Tracks when the user last touched the cart (add/update).
    // If this is > 7 days ago, getCart() auto-clears stale items.
    // Using updatedAt alone would also trigger on coupon changes, so
    // we track this explicitly to only reset on real item activity.
    lastActivityAt: {
      type:    Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
  }
);

// ─── Virtuals ─────────────────────────────────────────────────────────────────
// subtotal: sum of (price × qty) for all items — before discount
cartSchema.virtual("subtotal").get(function () {
  return this.items.reduce(
    (sum, item) => sum + item.priceAtAdd * item.quantity,
    0
  );
});

// total: what the user actually pays after discount
cartSchema.virtual("total").get(function () {
  const subtotal = this.items.reduce(
    (sum, item) => sum + item.priceAtAdd * item.quantity,
    0
  );
  return Math.max(0, subtotal - this.discount);
});

// itemCount: total units in the cart (e.g. 3 items = qty 2 + qty 1)
cartSchema.virtual("itemCount").get(function () {
  return this.items.reduce((sum, item) => sum + item.quantity, 0);
});

// ─── Model ────────────────────────────────────────────────────────────────────
export const Cart: Model<ICart> = mongoose.model<ICart>("Cart", cartSchema);