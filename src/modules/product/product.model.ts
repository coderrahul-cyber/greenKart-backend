// src/modules/product/product.model.ts
import mongoose, { Schema, type Document, type Model } from "mongoose";
import slugify from "slugify";

// ─── Interface ────────────────────────────────────────────────────────────────
export interface IProduct extends Document {
  _id:            mongoose.Types.ObjectId;
  name:           string;         // unique
  slug:           string;         // auto-generated from name e.g. "nike-air-max"
  description?:    string;
  images:         string[];       // array of URLs — first is the primary/thumbnail
  price:          number;         // stored as Number for sorting & math
  discountPrice?: number;         // optional sale price, must be < price
  quantity:       number;         // available stock
  isActive:       boolean;        // false = soft-deleted / draft
  createdAt: Date;
  updatedAt: Date;
}

// ─── Schema ───────────────────────────────────────────────────────────────────
const productSchema = new Schema<IProduct>(
  {
    name: {
      type:      String,
      required:  [true, "Product name is required"],
      unique:    true,
      trim:      true,
      maxlength: [200, "Name cannot exceed 200 characters"],
    },

    // Auto-generated from name — used in clean URLs: /products/nike-air-max
    slug: {
      type:   String,
      unique: true,
      index:  true,
    },

    description: {
      type:     String,
      trim:     true,
    },

    // Array of image URLs. First element is treated as the primary/thumbnail.
    images: {
      type:     [String],
      required: [true, "At least one image URL is required"],
      validate: {
        validator: (arr: string[]) => arr.length > 0,
        message:   "At least one image URL is required",
      },
    },

    // Always Number — never String.
    // String prices break: range queries, sorting, cart totals.
    price: {
      type:     Number,
      required: [true, "Price is required"],
      min:      [0, "Price cannot be negative"],
    },

    // Optional sale price — validated to be less than base price
    discountPrice: {
      type: Number,
      min:  [0, "Discount price cannot be negative"],
      validate: {
        validator(this: IProduct, val: number) {
          return val < this.price;
        },
        message: "Discount price must be less than the base price",
      },
    },

    quantity: {
      type:     Number,
      required: [true, "Quantity is required"],
      min:      [0, "Quantity cannot be negative"],
      default:  0,
    },

    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_, ret:Record<string,unknown>) => { delete ret.__v; return ret; },
    },
  }
);

// ─── Virtuals (computed, not stored in DB) ────────────────────────────────────
productSchema.virtual("isOnSale").get(function () {
  return !!this.discountPrice && this.discountPrice < this.price;
});

productSchema.virtual("discountPercent").get(function () {
  if (!this.discountPrice) return 0;
  return Math.round(((this.price - this.discountPrice) / this.price) * 100);
});

productSchema.virtual("inStock").get(function () {
  return this.quantity > 0;
});

// ─── Indexes ──────────────────────────────────────────────────────────────────
productSchema.index({ isActive: 1 });
productSchema.index({ price: 1 });
// Full-text search on name and description
productSchema.index(
  { name: "text", description: "text" },
  { name: "product_text_search" }
);

// ─── Pre-save: auto-generate slug from name ───────────────────────────────────
productSchema.pre("save", function () {
  if (this.isModified("name")) {
    this.slug = slugify(this.name, { lower: true, strict: true });
  }
});

// ─── Model ────────────────────────────────────────────────────────────────────
export const Product: Model<IProduct> = mongoose.model<IProduct>("Product", productSchema);