// src/modules/order/order.routes.ts
import { Router } from "express";
import { placeOrder, getMyOrders, getOrderById, cancelOrder } from "./order.controller";
import { authenticate }    from "../../middleware/auth";
// import { requireStoreOpen } from "../../middleware/storeOpen";

const router = Router();

// All order routes require authentication
router.use(authenticate);

router.post  ("/", placeOrder);  // blocked when store is closed
router.get   ("/",           getMyOrders);
router.get   ("/:id",        getOrderById);
router.patch ("/:id/cancel", cancelOrder);

export { router as orderRouter };