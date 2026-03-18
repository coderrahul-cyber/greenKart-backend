// src/modules/user/user.model.ts
import mongoose, { Schema, type Document, type Model } from "mongoose";
import bcrypt from "bcryptjs";
import { env } from "../../config/env";

// ─── Address sub-document interface ──────────────────────────────────────────
// Fields: line1, line2 (optional), city, pincode
export interface IAddress {
  _id?:      mongoose.Types.ObjectId;
  line1:     string;
  line2?:    string;
  city:      string;
  pincode:   string;
  isDefault: boolean;
}

// ─── Main interface ───────────────────────────────────────────────────────────
export interface IUser extends Document {
  _id:         mongoose.Types.ObjectId;
  name:        string;
  // email:       string;

  phoneNumber: string;
  password:    string;
  addresses:   IAddress[];
  orders:      mongoose.Types.ObjectId[];
  payments:    mongoose.Types.ObjectId[];
  cart?:       mongoose.Types.ObjectId;
  isPhoneVerified:    boolean;
  isActive:           boolean;
  passwordChangedAt?: Date;
  refreshToken?:      string;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidate: string): Promise<boolean>;
  isPasswordChangedAfter(jwtIssuedAt: number): boolean;
}

// ─── Address sub-schema ───────────────────────────────────────────────────────
const addressSchema = new Schema<IAddress>(
  {
    line1:     { type: String, required: [true, "Line 1 is required"], trim: true },
    line2:     { type: String, trim: true },
    city:      { type: String, required: [true, "City is required"],   trim: true },
    pincode:   { type: String, required: [true, "Pincode is required"] },
    isDefault: { type: Boolean, default: false },
  },
  { _id: true }
);

// ─── User schema ──────────────────────────────────────────────────────────────
const userSchema = new Schema<IUser>(
  {
    name: {
      type:      String,
      required:  [true, "Name is required"],
      trim:      true,
      minlength: [2,  "Name must be at least 2 characters"],
      maxlength: [60, "Name cannot exceed 60 characters"],
    },
    password: {
      type:      String,
      required:  [true, "Password is required"],
      minlength: [8, "Password must be at least 8 characters"],
      select:    false,
    },
    phoneNumber: {
      type:     String,
      required: [true, "Phone number is required"],
      unique:   true,
      trim:     true,
      match:    [/^\+?[1-9]\d{7,14}$/, "Please enter a valid phone number"],
    },
    addresses:       { type: [addressSchema], default: [] },
    isPhoneVerified: { type: Boolean, default: false },
    isActive:        { type: Boolean, default: true },
    passwordChangedAt: { type: Date,   select: false },
    refreshToken:      { type: String, select: false },
    orders:   [{ type: Schema.Types.ObjectId, ref: "Order"   }],
    payments: [{ type: Schema.Types.ObjectId, ref: "Payment" }],
    cart:      { type: Schema.Types.ObjectId, ref: "Cart"    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_, ret:Record<string,unknown>) => {
        delete ret.password;
        delete ret.refreshToken;
        delete ret.passwordChangedAt;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
// email and phoneNumber already indexed via unique:true on the field definition
userSchema.index({ isActive: 1 });

// ─── Pre-save: hash password ──────────────────────────────────────────────────
userSchema.pre("save", async function () {
  if (!this.isModified("password")) return ;
  this.password = await bcrypt.hash(this.password, env.bcrypt.saltRounds);
  if (!this.isNew) this.passwordChangedAt = new Date();
});

// ─── Instance methods ─────────────────────────────────────────────────────────
userSchema.methods.comparePassword = async function (candidate: string): Promise<boolean> {
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.isPasswordChangedAfter = function (jwtIssuedAt: number): boolean {
  if (!this.passwordChangedAt) return false;
  return this.passwordChangedAt.getTime() / 1000 > jwtIssuedAt;
};

// ─── Model ────────────────────────────────────────────────────────────────────
export const User: Model<IUser> = mongoose.model<IUser>("User", userSchema);