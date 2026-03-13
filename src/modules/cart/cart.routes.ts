// src/modules/cart/cart.routes.ts
import { Router } from "express";
import { getCart, addItem, updateItem, removeItem, clearCart } from "./cart.controller";
import { authenticate }    from "../../middleware/auth";
// import { requireStoreOpen } from "../../middleware/storeOpen";

const router = Router();

// All cart routes require authentication
router.use(authenticate);

router.get   ("/",            getCart);
// Write routes — blocked when store is closed
router.post  ("/items",         addItem);
router.patch ("/items/:itemId",   updateItem);
router.delete("/items/:itemId",   removeItem);
router.delete("/",               clearCart);

export { router as cartRouter };