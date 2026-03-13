// src/modules/product/product.routes.ts
import { Router } from "express";
import {
  getAllProducts,
  getProductById,
  getProductBySlug,
  getStockSnapshot,
  createProduct,
  updateProduct,
  deleteProduct,
} from "./product.controller";
import { authenticate, adminOnly } from "../../middleware/auth";

const router = Router();

// ── Public — anyone can browse products ──────────────────────────────────────
router.get("/", getAllProducts);
router.get("/stock", getStockSnapshot); // must be before /:id — polling endpoint
router.get("/slug/:slug", getProductBySlug);
router.get("/:id", getProductById);

// ── Admin only — must be logged in as admin ───────────────────────────────────
router.post("/", authenticate, adminOnly, createProduct);
router.patch("/:id", authenticate, adminOnly, updateProduct);
router.delete("/:id", authenticate, adminOnly, deleteProduct);

export { router as productRouter };
