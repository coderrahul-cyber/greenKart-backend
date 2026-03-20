// src/server.ts
import express, { type Request, type Response } from "express";
import cors    from "cors";
import helmet  from "helmet";
import { mongoSanitize } from "./middleware/mongoSanitize";
import { publicApiLimiter } from "./middleware/rateLimiter";
import { env, connectDB } from "./config";
import { initWebPush }   from "./utils/webPush";
import { notFound, errorHandler } from "./middleware/errorHandler";
import cookieParser from "cookie-parser";


// ── Module routers ────────────────────────────────────────────────────────────
import { userRouter }    from "./modules/user/user.routes";
import { productRouter } from "./modules/product/product.routes";
import { cartRouter }    from "./modules/cart/cart.routes";
import { orderRouter }   from "./modules/order/order.routes";
import { paymentRouter } from "./modules/payment/payments.routes";
import { adminRouter }   from "./modules/admin/admin.routes";

async function bootstrap() {
  await connectDB();
  initWebPush();
  
  const app = express();
  
  // ── CORS ─────────────────────────────────────────────────────────────────────
  // Allow requests from your frontend origin.
  // In dev: http://localhost:5173 (Vite) or http://localhost:3000 (CRA)
  // In prod: set FRONTEND_URL in .env to your deployed frontend URL
const frontend_url = process.env.FRONTEND_URL;

const allowedOrigins = [
  "http://localhost:3000",
  "https://www.greenkartt.shop",
  "https://greenkartt.shop",
  ...(frontend_url ? [frontend_url] : [])
];
  
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // allow server-to-server / curl

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`CORS not allowed: ${origin}`));
  },
  credentials:    true,
  methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
  
  app.use(cookieParser());

  // ── Security headers (Helmet) ────────────────────────────────────────────────
  // Sets 11 HTTP headers in one line:
  // X-XSS-Protection, X-Frame-Options, X-Content-Type-Options,
  // Strict-Transport-Security, Content-Security-Policy, and more.
  app.use(helmet());

  // ── NoSQL injection sanitizer ─────────────────────────────────────────────
  // Strips $ and . from req.body, req.params, req.query in-place.
  // Prevents attacks like: { "email": { "$gt": "" } } bypassing login.
  // Custom implementation — express-mongo-sanitize reassigns req properties
  // which throws TypeError in Bun (readonly properties).
  app.use(mongoSanitize);

  // ── Global rate limit ─────────────────────────────────────────────────────
  // Baseline 120 req/min per IP across all routes.
  // Sensitive routes (login, register) have tighter limits applied directly.
  app.use(publicApiLimiter);

  // ── Core middleware ──────────────────────────────────────────────────────────
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true }));

  // ── Dev request logger ───────────────────────────────────────────────────────
  if (env.isDev) {
    app.use((req: Request, _res: Response, next) => {
      // Strip ?token= from logged URL so JWT never appears in terminal output
      const safeUrl = req.originalUrl.replace(/([?&])token=[^&]*/g, "$1token=[redacted]");
      console.log(`  [${req.method}]  ${safeUrl}`);
      next();
    });
  }

  // ── Health check ─────────────────────────────────────────────────────────────
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", env: env.NODE_ENV, ts: new Date().toISOString() });
  });

  // ── API routes ────────────────────────────────────────────────────────────────
  const API = "/api/v1";
  app.use(`${API}/users`,    userRouter);
  app.use(`${API}/products`, productRouter);
  app.use(`${API}/cart`,     cartRouter);
  app.use(`${API}/orders`,   orderRouter);
  app.use(`${API}/payments`, paymentRouter);
  app.use(`${API}/admin`,    adminRouter);

  // ── 404 + global error handler (must be last) ─────────────────────────────────
  app.use(notFound);
  app.use(errorHandler);

  app.listen(env.PORT, () => {
    console.log(`🚀  Server ready → http://localhost:${env.PORT}  [${env.NODE_ENV}]`);
    console.log(`\n📋  Routes:`);
    console.log(`    ${API}/users`);
    console.log(`    ${API}/products`);
    console.log(`    ${API}/cart`);
    console.log(`    ${API}/orders`);
    console.log(`    ${API}/payments`);
  });
}

bootstrap().catch((err) => {
  console.error("❌  Failed to start:", err.message);
  process.exit(1);
});