// src/modules/cart/cart.controller.ts
import type { Response } from "express";
import { Cart } from "./cart.model";
import { Product } from "../product/product.model";
import { ApiError } from "../../utils/apiError";
import { asyncHandler } from "../../utils/asynchandler";
import { sendSuccess } from "../../utils/response";
import type { AuthRequest } from "../../middleware/auth";

// ─── Config ───────────────────────────────────────────────────────────────────
const CART_EXPIRY_DAYS = 7;  // carts inactive for longer than this are auto-cleared

// ─── Get Cart ─────────────────────────────────────────────────────────────────
// GET /api/v1/cart
// Auto-clears items if the cart has been inactive for more than CART_EXPIRY_DAYS.
// Why: prevents users from checking out with prices captured weeks ago.
export const getCart = asyncHandler(async (req: AuthRequest, res: Response) => {
  let cart = await Cart.findOne({ userId: req.user!.userId });

  if (!cart) {
    cart = await Cart.create({ userId: req.user!.userId });
    return sendSuccess(res, { cart }, "Cart fetched");
  }

  // Check if cart has expired (no item activity for CART_EXPIRY_DAYS)
  if (cart.items.length > 0) {
    const lastActivity  = cart.lastActivityAt ?? cart.updatedAt;
    const daysSinceActivity =
      (Date.now() - new Date(lastActivity).getTime()) / (1000 * 60 * 60 * 24);

    if (daysSinceActivity > CART_EXPIRY_DAYS) {
      cart.items          = [];
      cart.discount       = 0;
      cart.couponCode     = undefined;
      cart.lastActivityAt = new Date();
      await cart.save();

      return sendSuccess(res, {
        cart,
        warning: `Your cart was cleared because it was inactive for more than ${CART_EXPIRY_DAYS} days. Prices may have changed.`,
      }, "Cart fetched");
    }
  }

  sendSuccess(res, { cart }, "Cart fetched");
});

// ─── Add Item to Cart ─────────────────────────────────────────────────────────
// POST /api/v1/cart/items
// Body: { productId, quantity }
//
// NOTE on concurrency: the cart is NOT a stock reservation — adding to cart
// does not decrement product.quantity. Stock is only reserved atomically at
// checkout (placeOrder). Here we just check that stock *looks* sufficient
// so we can show the user a useful error immediately.
// The check uses a fresh .lean() read (no cache) for accuracy.
export const addItem = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { productId, quantity = 1 } = req.body;

  if (!productId) throw ApiError.badRequest("productId is required");
  if (quantity < 1) throw ApiError.badRequest("Quantity must be at least 1");

  // Fresh read with .lean() — bypasses Mongoose cache, always hits DB
  const product = await Product.findOne(
    { _id: productId, isActive: true },
    { _id: 1, name: 1, images: 1, price: 1, discountPrice: 1, quantity: 1 }
  ).lean();

  if (!product) throw ApiError.notFound("Product not found");
  if (product.quantity < quantity) {
    throw ApiError.badRequest(
      `Only ${product.quantity} unit(s) in stock — you requested ${quantity}`
    );
  }

  let cart = await Cart.findOne({ userId: req.user!.userId });
  if (!cart) cart = await Cart.create({ userId: req.user!.userId });

  // If product is already in cart, total cart qty must not exceed current stock
  const existingIndex = cart.items.findIndex(
    (item) => item.productId.toString() === productId.toString()
  );

  if (existingIndex > -1) {
    const newQty = cart.items[existingIndex].quantity + quantity;
    if (newQty > product.quantity) {
      throw ApiError.badRequest(
        `Cannot add ${quantity} more — only ${product.quantity} in stock ` +
        `and you already have ${cart.items[existingIndex].quantity} in your cart`
      );
    }
    cart.items[existingIndex].quantity = newQty;
  } else {
    cart.items.push({
      productId:    product._id,
      quantity,
      priceAtAdd:   product.discountPrice ?? product.price,
      productName:  product.name,
      productImage: product.images[0],
    });
  }

  cart.lastActivityAt = new Date();
  await cart.save();
  sendSuccess(res, { cart }, "Item added to cart");
});

// ─── Update Item Quantity ─────────────────────────────────────────────────────
// PATCH /api/v1/cart/items/:itemId
// Body: { quantity }
//
// Same concurrency note as addItem — we do a fresh .lean() stock check
// to give accurate feedback, but we do NOT reserve stock here.
// Real reservation happens atomically at checkout.
export const updateItem = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { itemId } = req.params;
  const { quantity } = req.body;

  if (!quantity || quantity < 1) throw ApiError.badRequest("Quantity must be at least 1");

  const cart = await Cart.findOne({ userId: req.user!.userId });
  if (!cart) throw ApiError.notFound("Cart not found");

  const item = cart.items.find((i) => i._id?.toString() === itemId);
  if (!item) throw ApiError.notFound("Item not found in cart");

  // Fresh .lean() read — always hits DB, no Mongoose document cache
  const product = await Product.findById(item.productId, { quantity: 1, isActive: 1 }).lean();

  if (!product) throw ApiError.notFound("Product no longer exists");
  if (!product.isActive) throw ApiError.badRequest("This product is no longer available");
  if (product.quantity < quantity) {
    throw ApiError.badRequest(
      `Only ${product.quantity} unit(s) in stock — you requested ${quantity}`
    );
  }

  item.quantity       = quantity;
  cart.lastActivityAt = new Date();
  await cart.save();

  sendSuccess(res, { cart }, "Cart item updated");
});

// ─── Remove Item from Cart ────────────────────────────────────────────────────
// DELETE /api/v1/cart/items/:itemId
export const removeItem = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { itemId } = req.params;

  const cart = await Cart.findOne({ userId: req.user!.userId });
  if (!cart) throw ApiError.notFound("Cart not found");

  const index = cart.items.findIndex((i) => i._id?.toString() === itemId);
  if (index === -1) throw ApiError.notFound("Item not found in cart");

  cart.items.splice(index, 1);
  await cart.save();

  sendSuccess(res, { cart }, "Item removed from cart");
});

// ─── Clear Cart ───────────────────────────────────────────────────────────────
// DELETE /api/v1/cart
export const clearCart = asyncHandler(async (req: AuthRequest, res: Response) => {
  const cart = await Cart.findOne({ userId: req.user!.userId });
  if (!cart) throw ApiError.notFound("Cart not found");

  cart.items    = [];
  cart.discount = 0;
  cart.couponCode = undefined;
  await cart.save();

  sendSuccess(res, { cart }, "Cart cleared");
});