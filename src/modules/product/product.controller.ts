// src/modules/product/product.controller.ts
import type { Request, Response } from "express";
import { Product } from "./product.model";
import { ApiError } from "../../utils/apiError";
import { asyncHandler } from "../../utils/asynchandler";
import { sendSuccess, sendCreated } from "../../utils/response";

// ─── Get All Products ─────────────────────────────────────────────────────────
// GET /api/v1/products
// Query params: page, limit, sort, order, search, minPrice, maxPrice, inStock
export const getAllProducts = asyncHandler(async (req: Request, res: Response) => {
  const page     = Math.max(1, parseInt(req.query.page     as string) || 1);
  const limit    = Math.min(50, parseInt(req.query.limit   as string) || 10);
  const skip     = (page - 1) * limit;
  const sortBy   = (req.query.sort  as string) || "createdAt";
  const order    = req.query.order === "asc" ? 1 : -1;
  const search   = req.query.search as string;
  const minPrice = parseFloat(req.query.minPrice as string);
  const maxPrice = parseFloat(req.query.maxPrice as string);
  const inStock  = req.query.inStock === "true";

  // Build filter dynamically
  const filter: Record<string, unknown> = { isActive: true };

  if (search) {
    filter.$text = { $search: search };
  }
  if (!isNaN(minPrice) || !isNaN(maxPrice)) {
    filter.price = {
      ...(!isNaN(minPrice) ? { $gte: minPrice } : {}),
      ...(!isNaN(maxPrice) ? { $lte: maxPrice } : {}),
    };
  }
  if (inStock) {
    filter.quantity = { $gt: 0 };
  }

  const [products, total] = await Promise.all([
    Product.find(filter)
      .sort({ [sortBy]: order })
      .skip(skip)
      .limit(limit)
      .lean(),
    Product.countDocuments(filter),
  ]);

  sendSuccess(res, {
    products,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasNext: page < Math.ceil(total / limit),
      hasPrev: page > 1,
    },
  }, "Products fetched");
});

// ─── Get Single Product ───────────────────────────────────────────────────────
// GET /api/v1/products/:id
export const getProductById = asyncHandler(async (req: Request, res: Response) => {
  const product = await Product.findOne({
    _id: req.params.id,
    isActive: true,
  });
  if (!product) throw ApiError.notFound("Product not found");

  sendSuccess(res, { product }, "Product fetched");
});

// ─── Get Product by Slug ──────────────────────────────────────────────────────
// GET /api/v1/products/slug/:slug
export const getProductBySlug = asyncHandler(async (req: Request, res: Response) => {
  const product = await Product.findOne({
    slug: req.params.slug,
    isActive: true,
  });
  if (!product) throw ApiError.notFound("Product not found");

  sendSuccess(res, { product }, "Product fetched");
});

// ─── Create Product ───────────────────────────────────────────────────────────
// POST /api/v1/products
export const createProduct = asyncHandler(async (req: Request, res: Response) => {
  const { name, description, images, price, discountPrice, quantity } = req.body;

  const product = await Product.create({
    name,
    description,
    images,
    price,
    discountPrice,
    quantity,
  });

  sendCreated(res, { product }, "Product created");
});

// ─── Update Product ───────────────────────────────────────────────────────────
// PATCH /api/v1/products/:id
export const updateProduct = asyncHandler(async (req: Request, res: Response) => {
  const allowed = ["name", "description", "images", "price", "discountPrice", "quantity", "isActive"];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }

  if (Object.keys(updates).length === 0) {
    throw ApiError.badRequest("No valid fields to update");
  }

  const product = await Product.findByIdAndUpdate(
    req.params.id,
    { $set: updates },
    { new: true, runValidators: true }
  );

  if (!product) throw ApiError.notFound("Product not found");

  sendSuccess(res, { product }, "Product updated");
});

// ─── Delete Product (soft delete) ────────────────────────────────────────────
// DELETE /api/v1/products/:id
export const deleteProduct = asyncHandler(async (req: Request, res: Response) => {
  const product = await Product.findByIdAndUpdate(
    req.params.id,
    { $set: { isActive: false } },
    { new: true }
  );
  if (!product) throw ApiError.notFound("Product not found");

  sendSuccess(res, null, "Product deleted");
});

// ─── Stock Snapshot (for frontend polling) ────────────────────────────────────
// GET /api/v1/products/stock?ids=id1,id2,id3
//
// The frontend calls this every 30 seconds with a comma-separated list of
// product IDs it currently cares about (product listing page, cart page).
// Returns only { _id, quantity, isActive } — minimal payload, fast query.
//
// Frontend usage:
//   const res  = await fetch(`/api/v1/products/stock?ids=${ids.join(',')}`);
//   const data = await res.json();
//   data.data.stock.forEach(({ _id, quantity }) => updateStockInUI(_id, quantity));
export const getStockSnapshot = asyncHandler(async (req: Request, res: Response) => {
  const raw = req.query.ids as string;
  if (!raw) throw ApiError.badRequest("ids query param is required (comma-separated product IDs)");

  const ids = raw.split(",").map(id => id.trim()).filter(Boolean);
  if (ids.length === 0) throw ApiError.badRequest("At least one product ID is required");
  if (ids.length > 100) throw ApiError.badRequest("Cannot query more than 100 products at once");

  const products = await Product.find(
    { _id: { $in: ids } },
    { _id: 1, quantity: 1, isActive: 1, name: 1 }  // only fetch what frontend needs
  ).lean();

  sendSuccess(res, { stock: products }, "Stock snapshot fetched");
});