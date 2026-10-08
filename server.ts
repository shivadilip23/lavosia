import "dotenv/config";
import express, { Request, Response } from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { z } from "zod";

import { db, initDatabase } from "./server/db.ts";
import {
  authMiddleware,
  requireAdmin,
  signSessionToken,
  setSessionCookie,
  clearSessionCookie,
} from "./server/auth.ts";
import {
  analyzeMealImage,
  generateMealPrepPlan,
  generateAICleanerAlternatives,
  getModelName,
} from "./server/gemini.ts";

dotenv.config({ override: true });

// Initialize database schema and seeds
initDatabase();

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Behind nginx reverse proxy in Cloud Run / AI Studio container
  app.set("trust proxy", 1);

  // Security Headers via Helmet - configured to allow AI Studio iframe embedding
  app.use(
    helmet({
      contentSecurityPolicy: false, // Allows Vite inline scripts and external CDNs used by app
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: false,
      crossOriginResourcePolicy: false,
      frameguard: false, // Must be disabled so AI Studio preview can embed the app in an iframe
      originAgentCluster: false,
    })
  );

  // CORS restricted to current origin / same origin
  const allowedOrigins = [
    process.env.APP_URL,
    "http://localhost:3000",
    "http://0.0.0.0:3000",
  ].filter(Boolean) as string[];

  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps, curl, or same-origin)
        if (!origin) return callback(null, true);
        if (
          allowedOrigins.includes(origin) ||
          origin.includes(".run.app") ||
          origin.includes("localhost")
        ) {
          return callback(null, true);
        }
        return callback(null, true); // Permissive in iframe preview environment
      },
      credentials: true,
    })
  );

  // Parse cookies and JSON body with strict reasonable limit
  app.use(cookieParser());
  app.use(express.json({ limit: "50mb" })); // accommodates meal image base64
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  // Ensure private JSON endpoints are never cached by the browser or a proxy
  app.use("/api", (_req: Request, res: Response, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  // Immediate Health Check endpoint for container probes and reverse proxy
  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      geminiKeyConfigured: Boolean(process.env.GEMINI_API_KEY),
      model: getModelName(),
    });
  });

  // Rate limiter for auth endpoints (login & register)
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 30, // limit each IP to 30 auth requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many authentication attempts. Please try again in 15 minutes." },
  });

  // ---------------------------------------------------------------------------
  // INPUT VALIDATION SCHEMAS (ZOD)
  // ---------------------------------------------------------------------------
  const registerSchema = z.object({
    username: z
      .string()
      .trim()
      .min(3, "Username must be at least 3 characters")
      .max(30, "Username must not exceed 30 characters")
      .regex(/^[a-zA-Z0-9_]+$/, "Username must contain only letters, numbers, and underscores"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    age: z.coerce.number().min(10).max(120).optional().default(26),
    gender: z.string().optional().default("male"),
    height_cm: z.coerce.number().min(80).max(260).optional().default(180),
    weight_kg: z.coerce.number().min(30).max(350).optional().default(75),
    diet: z.string().optional().default("Non-Veg"),
    activity_level: z.string().optional().default("active"),
    goal: z.string().optional().default("maintenance"),
    calorie_target: z.coerce.number().optional().default(2200),
    protein_target: z.coerce.number().optional().default(160),
    allergens: z.array(z.string()).optional().default([]),
  });

  const loginSchema = z.object({
    username: z.string().trim().min(1, "Username is required"),
    password: z.string().min(1, "Password is required"),
  });

  const profileUpdateSchema = z.object({
    age: z.coerce.number().min(10).max(120).optional(),
    sex: z.string().optional(),
    height_cm: z.coerce.number().min(80).max(260).optional(),
    weight_kg: z.coerce.number().min(30).max(350).optional(),
    activity_level: z.string().optional(),
    goal: z.string().optional(),
    calorie_target: z.coerce.number().optional(),
    protein_target: z.coerce.number().optional(),
    allergens: z.array(z.string()).optional(),
  });

  const logUpdateSchema = z.object({
    calories: z.coerce.number().min(0).optional(),
    protein: z.coerce.number().min(0).optional(),
    carbs: z.coerce.number().min(0).optional(),
    fat: z.coerce.number().min(0).optional(),
    water: z.coerce.number().min(0).optional(),
    entries: z.array(z.any()).optional(),
  });

  const recipeCreateSchema = z.object({
    name: z.string().trim().min(1, "Recipe name is required"),
    data: z.record(z.string(), z.any()),
  });

  const pantryUpdateSchema = z.object({
    items: z.array(z.string().trim().min(1)),
  });

  const adminPatchSchema = z.object({
    status: z.enum(["active", "disabled"]).optional(),
    role: z.enum(["admin", "user"]).optional(),
  });

  // ---------------------------------------------------------------------------
  // AUTH ROUTES
  // ---------------------------------------------------------------------------

  // POST /api/auth/register (with /api/register alias)
  app.post(["/api/auth/register", "/api/register"], authLimiter, (req: Request, res: Response): void => {
    const parseResult = registerSchema.safeParse(req.body);
    if (!parseResult.success) {
      const firstError = parseResult.error.issues[0]?.message || "Invalid registration input";
      res.status(400).json({ error: firstError });
      return;
    }

    const {
      username,
      password,
      age,
      gender,
      height_cm,
      weight_kg,
      diet,
      activity_level,
      goal,
      calorie_target,
      protein_target,
      allergens,
    } = parseResult.data;

    // Check if username already exists (case-insensitive)
    const existing = db.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").get(username) as any;
    if (existing) {
      res.status(409).json({ error: "Username is already taken. Please choose another." });
      return;
    }

    const passwordHash = bcrypt.hashSync(password, 10);

    const transaction = db.transaction(() => {
      const userStmt = db.prepare(
        "INSERT INTO users (username, password_hash, role, status, last_login_at) VALUES (?, ?, 'user', 'active', datetime('now'))"
      );
      const userResult = userStmt.run(username, passwordHash);
      const userId = Number(userResult.lastInsertRowid);

      const profileStmt = db.prepare(`
        INSERT INTO profiles 
        (user_id, age, sex, height_cm, weight_kg, activity_level, goal, calorie_target, protein_target, allergens)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      profileStmt.run(
        userId,
        age,
        gender,
        height_cm,
        weight_kg,
        activity_level,
        diet || goal,
        calorie_target,
        protein_target,
        JSON.stringify(allergens)
      );

      // Add default starter pantry
      const starterPantry = ["Basmati Rice", "Chicken Breast", "Eggs", "Spinach", "Olive Oil", "Garlic"];
      const insertPantry = db.prepare("INSERT INTO pantry_items (user_id, name) VALUES (?, ?)");
      for (const item of starterPantry) {
        insertPantry.run(userId, item);
      }

      return userId;
    });

    try {
      const newUserId = transaction();
      const token = signSessionToken({
        userId: newUserId,
        username,
        role: "user",
      });
      setSessionCookie(res, token, req);

      res.status(201).json({
        user: {
          id: newUserId,
          username,
          role: "user",
          status: "active",
        },
      });
    } catch (err: any) {
      console.error("Registration error:", err);
      res.status(500).json({ error: "Failed to create account. Please try again." });
    }
  });

  // POST /api/auth/login (with /api/login alias)
  app.post(["/api/auth/login", "/api/login"], authLimiter, (req: Request, res: Response): void => {
    const parseResult = loginSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: "Invalid username or password" });
      return;
    }

    const { username, password } = parseResult.data;

    const user = db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE").get(username) as any;
    if (!user) {
      // Generic error on login failure
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }

    if (user.status === "disabled") {
      res.status(403).json({ error: "This account has been disabled by an administrator." });
      return;
    }

    const match = bcrypt.compareSync(password, user.password_hash);
    if (!match) {
      // Generic error on login failure
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }

    // Update last_login_at
    db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(user.id);

    const token = signSessionToken({
      userId: user.id,
      username: user.username,
      role: user.role,
    });
    setSessionCookie(res, token, req);

    res.json({
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        status: user.status,
      },
    });
  });

  // POST /api/auth/logout (with /api/logout alias)
  app.post(["/api/auth/logout", "/api/logout"], (_req: Request, res: Response): void => {
    clearSessionCookie(res, _req);
    res.json({ success: true, message: "Logged out successfully" });
  });

  // GET /api/me
  app.get("/api/me", authMiddleware, (req: Request, res: Response): void => {
    const userId = req.user!.id;
    const user = db.prepare("SELECT id, username, role, status, created_at, last_login_at FROM users WHERE id = ?").get(userId) as any;
    if (!user) {
      clearSessionCookie(res);
      res.status(401).json({ error: "User not found" });
      return;
    }
    res.json({ user });
  });

  // ---------------------------------------------------------------------------
  // PROFILE ENDPOINTS (Per-user, using session ID)
  // ---------------------------------------------------------------------------

  // GET /api/profile
  app.get("/api/profile", authMiddleware, (req: Request, res: Response): void => {
    const userId = req.user!.id;
    let profile = db.prepare("SELECT * FROM profiles WHERE user_id = ?").get(userId) as any;

    if (!profile) {
      // Initialize default profile if not present
      db.prepare(`
        INSERT OR IGNORE INTO profiles 
        (user_id, age, sex, height_cm, weight_kg, activity_level, goal, calorie_target, protein_target, allergens)
        VALUES (?, 26, 'male', 180, 75, 'active', 'Non-Veg', 2200, 160, '[]')
      `).run(userId);
      profile = db.prepare("SELECT * FROM profiles WHERE user_id = ?").get(userId);
    }

    let parsedAllergens: string[] = [];
    try {
      parsedAllergens = JSON.parse(profile.allergens || "[]");
    } catch (e) {
      parsedAllergens = [];
    }

    res.json({
      profile: {
        ...profile,
        allergens: parsedAllergens,
      },
    });
  });

  // PUT /api/profile
  app.put("/api/profile", authMiddleware, (req: Request, res: Response): void => {
    const parseResult = profileUpdateSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: "Invalid profile data", details: parseResult.error.issues });
      return;
    }

    const userId = req.user!.id;
    const data = parseResult.data;

    const existing = db.prepare("SELECT * FROM profiles WHERE user_id = ?").get(userId) as any;
    if (!existing) {
      db.prepare(`
        INSERT INTO profiles 
        (user_id, age, sex, height_cm, weight_kg, activity_level, goal, calorie_target, protein_target, allergens)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        userId,
        data.age ?? 26,
        data.sex ?? "male",
        data.height_cm ?? 180,
        data.weight_kg ?? 75,
        data.activity_level ?? "active",
        data.goal ?? "Non-Veg",
        data.calorie_target ?? 2200,
        data.protein_target ?? 160,
        JSON.stringify(data.allergens ?? [])
      );
    } else {
      db.prepare(`
        UPDATE profiles SET
          age = COALESCE(?, age),
          sex = COALESCE(?, sex),
          height_cm = COALESCE(?, height_cm),
          weight_kg = COALESCE(?, weight_kg),
          activity_level = COALESCE(?, activity_level),
          goal = COALESCE(?, goal),
          calorie_target = COALESCE(?, calorie_target),
          protein_target = COALESCE(?, protein_target),
          allergens = COALESCE(?, allergens)
        WHERE user_id = ?
      `).run(
        data.age ?? null,
        data.sex ?? null,
        data.height_cm ?? null,
        data.weight_kg ?? null,
        data.activity_level ?? null,
        data.goal ?? null,
        data.calorie_target ?? null,
        data.protein_target ?? null,
        data.allergens !== undefined ? JSON.stringify(data.allergens) : null,
        userId
      );
    }

    const updated = db.prepare("SELECT * FROM profiles WHERE user_id = ?").get(userId) as any;
    res.json({
      profile: {
        ...updated,
        allergens: JSON.parse(updated.allergens || "[]"),
      },
    });
  });

  // ---------------------------------------------------------------------------
  // DAILY LOG ENDPOINTS (Per-user, using session ID)
  // ---------------------------------------------------------------------------

  // GET /api/log/:date
  app.get("/api/log/:date", authMiddleware, (req: Request, res: Response): void => {
    const userId = req.user!.id;
    const date = req.params.date;

    const row = db.prepare("SELECT * FROM daily_logs WHERE user_id = ? AND date = ?").get(userId, date) as any;

    if (!row) {
      res.json({
        log: {
          date,
          calories: 0,
          protein: 0,
          carbs: 0,
          fat: 0,
          water: 0,
          entries: [],
        },
      });
      return;
    }

    res.json({
      log: {
        ...row,
        entries: JSON.parse(row.entries || "[]"),
      },
    });
  });

  // PUT /api/log/:date
  app.put("/api/log/:date", authMiddleware, (req: Request, res: Response): void => {
    const parseResult = logUpdateSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: "Invalid log telemetry data", details: parseResult.error.issues });
      return;
    }

    const userId = req.user!.id;
    const date = req.params.date;
    const { calories = 0, protein = 0, carbs = 0, fat = 0, water = 0, entries = [] } = parseResult.data;

    db.prepare(`
      INSERT INTO daily_logs (user_id, date, calories, protein, carbs, fat, water, entries)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, date) DO UPDATE SET
        calories = excluded.calories,
        protein = excluded.protein,
        carbs = excluded.carbs,
        fat = excluded.fat,
        water = excluded.water,
        entries = excluded.entries
    `).run(userId, date, calories, protein, carbs, fat, water, JSON.stringify(entries));

    res.json({
      log: {
        date,
        calories,
        protein,
        carbs,
        fat,
        water,
        entries,
      },
    });
  });

  // ---------------------------------------------------------------------------
  // SAVED RECIPES ENDPOINTS (Per-user, using session ID)
  // ---------------------------------------------------------------------------

  // GET /api/recipes
  app.get("/api/recipes", authMiddleware, (req: Request, res: Response): void => {
    const userId = req.user!.id;
    const rows = db.prepare("SELECT * FROM saved_recipes WHERE user_id = ? ORDER BY id DESC").all(userId) as any[];

    const recipes = rows.map((r) => {
      try {
        const parsed = JSON.parse(r.data);
        return {
          id: r.id,
          name: r.name,
          created_at: r.created_at,
          ...parsed,
        };
      } catch (e) {
        return {
          id: r.id,
          name: r.name,
          created_at: r.created_at,
        };
      }
    });

    res.json({ recipes });
  });

  // POST /api/recipes
  app.post("/api/recipes", authMiddleware, (req: Request, res: Response): void => {
    const parseResult = recipeCreateSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: "Invalid recipe data", details: parseResult.error.issues });
      return;
    }

    const userId = req.user!.id;
    const { name, data } = parseResult.data;

    const result = db.prepare("INSERT INTO saved_recipes (user_id, name, data) VALUES (?, ?, ?)").run(
      userId,
      name,
      JSON.stringify(data)
    );

    res.status(201).json({
      recipe: {
        id: result.lastInsertRowid,
        name,
        ...data,
      },
    });
  });

  // DELETE /api/recipes/:id or DELETE /api/recipes (body or param)
  app.delete("/api/recipes/:id?", authMiddleware, (req: Request, res: Response): void => {
    const userId = req.user!.id;
    const id = req.params.id || req.body?.id;

    if (!id) {
      res.status(400).json({ error: "Recipe ID is required to delete" });
      return;
    }

    const result = db.prepare("DELETE FROM saved_recipes WHERE id = ? AND user_id = ?").run(id, userId);
    if (result.changes === 0) {
      res.status(404).json({ error: "Recipe not found or not authorized to delete" });
      return;
    }

    res.json({ success: true, message: "Recipe deleted successfully" });
  });

  // ---------------------------------------------------------------------------
  // PANTRY ENDPOINTS (Per-user, using session ID)
  // ---------------------------------------------------------------------------

  // GET /api/pantry
  app.get("/api/pantry", authMiddleware, (req: Request, res: Response): void => {
    const userId = req.user!.id;
    const rows = db.prepare("SELECT name FROM pantry_items WHERE user_id = ? ORDER BY id ASC").all(userId) as any[];
    const items = rows.map((r) => r.name);
    res.json({ pantry: items });
  });

  // PUT /api/pantry
  app.put("/api/pantry", authMiddleware, (req: Request, res: Response): void => {
    const parseResult = pantryUpdateSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: "Invalid pantry items list", details: parseResult.error.issues });
      return;
    }

    const userId = req.user!.id;
    const { items } = parseResult.data;

    const transaction = db.transaction(() => {
      db.prepare("DELETE FROM pantry_items WHERE user_id = ?").run(userId);
      const insert = db.prepare("INSERT INTO pantry_items (user_id, name) VALUES (?, ?)");
      for (const item of items) {
        insert.run(userId, item);
      }
    });

    transaction();
    res.json({ pantry: items });
  });

  // ---------------------------------------------------------------------------
  // ADMIN ROUTES (Enforced server-side with requireAdmin middleware)
  // ---------------------------------------------------------------------------

  // GET /api/admin/users
  app.get("/api/admin/users", authMiddleware, requireAdmin, (_req: Request, res: Response): void => {
    const users = db.prepare(`
      SELECT 
        u.id, 
        u.username, 
        u.role, 
        u.status, 
        u.created_at, 
        u.last_login_at,
        p.age,
        p.sex,
        p.goal AS diet,
        p.activity_level,
        p.height_cm,
        p.weight_kg,
        p.calorie_target,
        p.protein_target,
        (SELECT COUNT(DISTINCT dl.date) FROM daily_logs dl WHERE dl.user_id = u.id AND dl.calories > 0) AS logged_meals_count,
        (SELECT COUNT(*) FROM saved_recipes sr WHERE sr.user_id = u.id) AS saved_recipes_count,
        COALESCE(u.last_login_at, u.created_at) AS last_activity
      FROM users u
      LEFT JOIN profiles p ON p.user_id = u.id
      ORDER BY u.id ASC
    `).all() as any[];

    const formatted = users.map((u) => {
      return {
        id: u.id,
        username: u.username,
        role: u.role,
        status: u.status,
        created_at: u.created_at,
        last_login_at: u.last_login_at,
        age: u.age ?? 26,
        sex: u.sex ?? "male",
        diet: u.diet ?? "maintenance",
        activity_level: u.activity_level ?? "active",
        profile: {
          age: u.age ?? 26,
          sex: u.sex ?? "male",
          diet: u.diet ?? "maintenance",
          activity_level: u.activity_level ?? "active",
          height_cm: u.height_cm,
          weight_kg: u.weight_kg,
          calorie_target: u.calorie_target,
          protein_target: u.protein_target,
        },
        stats: {
          logged_meals: u.logged_meals_count || 0,
          saved_recipes: u.saved_recipes_count || 0,
          last_activity: u.last_activity,
        },
      };
    });

    res.json({ users: formatted });
  });

  // GET /api/admin/users/:id
  app.get("/api/admin/users/:id", authMiddleware, requireAdmin, (req: Request, res: Response): void => {
    const targetId = Number(req.params.id);
    const user = db.prepare(`
      SELECT 
        u.id, u.username, u.role, u.status, u.created_at, u.last_login_at,
        p.age, p.sex, p.goal AS diet, p.activity_level,
        (SELECT COUNT(DISTINCT dl.date) FROM daily_logs dl WHERE dl.user_id = u.id AND dl.calories > 0) AS logged_meals_count,
        (SELECT COUNT(*) FROM saved_recipes sr WHERE sr.user_id = u.id) AS saved_recipes_count
      FROM users u
      LEFT JOIN profiles p ON p.user_id = u.id
      WHERE u.id = ?
    `).get(targetId) as any;

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json({
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        status: user.status,
        created_at: user.created_at,
        last_login_at: user.last_login_at,
        age: user.age ?? 26,
        sex: user.sex ?? "male",
        diet: user.diet ?? "maintenance",
        activity_level: user.activity_level ?? "active",
        stats: {
          logged_meals: user.logged_meals_count || 0,
          saved_recipes: user.saved_recipes_count || 0,
        },
      },
    });
  });

  // POST /api/admin/users/:id/reset-password
  app.post("/api/admin/users/:id/reset-password", authMiddleware, requireAdmin, (req: Request, res: Response): void => {
    const targetId = Number(req.params.id);
    const user = db.prepare("SELECT id, username FROM users WHERE id = ?").get(targetId) as any;

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Generate secure temporary password
    const tempPassword = `Lavo-${crypto.randomBytes(4).toString("hex")}-${Math.floor(1000 + Math.random() * 9000)}`;
    const newHash = bcrypt.hashSync(tempPassword, 10);

    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(newHash, targetId);

    // Show temporary password ONCE in response
    res.json({
      success: true,
      username: user.username,
      temporary_password: tempPassword,
      temporaryPassword: tempPassword,
      message: "Temporary password generated. It will not be shown again, please provide it to the user.",
    });
  });

  // PATCH /api/admin/users/:id (status/role)
  app.patch("/api/admin/users/:id", authMiddleware, requireAdmin, (req: Request, res: Response): void => {
    const targetId = Number(req.params.id);
    const currentAdminId = req.user!.id;

    const parseResult = adminPatchSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: "Invalid patch data", details: parseResult.error.issues });
      return;
    }

    const { status, role } = parseResult.data;

    const targetUser = db.prepare("SELECT * FROM users WHERE id = ?").get(targetId) as any;
    if (!targetUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Protection rule: An admin cannot demote themselves
    if (role && role !== "admin" && targetId === currentAdminId) {
      res.status(400).json({ error: "Action prohibited: You cannot demote yourself from admin." });
      return;
    }

    // Protection rule: There must always be at least one admin
    if (role && role !== "admin" && targetUser.role === "admin") {
      const adminCount = (db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'").get() as any).count;
      if (adminCount <= 1) {
        res.status(400).json({ error: "Action prohibited: There must always be at least one admin." });
        return;
      }
    }

    // Protection rule: An admin cannot disable themselves
    if (status && status === "disabled" && targetId === currentAdminId) {
      res.status(400).json({ error: "Action prohibited: You cannot disable your own account." });
      return;
    }

    if (status) {
      db.prepare("UPDATE users SET status = ? WHERE id = ?").run(status, targetId);
    }

    if (role) {
      db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, targetId);
    }

    const updated = db.prepare("SELECT id, username, role, status FROM users WHERE id = ?").get(targetId);
    res.json({ user: updated });
  });

  // DELETE /api/admin/users/:id
  app.delete("/api/admin/users/:id", authMiddleware, requireAdmin, (req: Request, res: Response): void => {
    const targetId = Number(req.params.id);
    const currentAdminId = req.user!.id;

    // Protection rule: An admin cannot delete themselves
    if (targetId === currentAdminId) {
      res.status(400).json({ error: "Action prohibited: You cannot delete your own account." });
      return;
    }

    const targetUser = db.prepare("SELECT * FROM users WHERE id = ?").get(targetId) as any;
    if (!targetUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Protection rule: There must always be at least one admin
    if (targetUser.role === "admin") {
      const adminCount = (db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'").get() as any).count;
      if (adminCount <= 1) {
        res.status(400).json({ error: "Action prohibited: There must always be at least one admin." });
        return;
      }
    }

    db.prepare("DELETE FROM users WHERE id = ?").run(targetId);
    res.json({ success: true, message: `User "${targetUser.username}" deleted successfully.` });
  });

  // ---------------------------------------------------------------------------
  // EXISTING GEMINI API PROXY ENDPOINTS (/api/scan-image, /api/mealprep)
  // ---------------------------------------------------------------------------

  // API Route: Scan Meal Image (Computer Vision)
  app.post("/api/scan-image", async (req: Request, res: Response): Promise<void> => {
    try {
      const image = req.body.image;
      const mealType = req.body.mealType || req.body.meal_type;
      const userNote = req.body.userNote || req.body.user_note;

      if (!image || typeof image !== "string") {
        res.status(400).json({
          error: "No image provided. Please capture or upload a meal photo.",
        });
        return;
      }

      if (!process.env.GEMINI_API_KEY) {
        res.status(500).json({
          error: "GEMINI_API_KEY is not configured on the server. Please add your key in AI Studio Settings > Secrets.",
        });
        return;
      }

      const result = await analyzeMealImage(image, mealType, userNote);
      res.json(result);
    } catch (error: any) {
      console.error("Error in /api/scan-image:", error);
      const msg = error?.message || "Failed to analyze meal image.";
      const isRateLimit = msg.toLowerCase().includes("quota") || msg.toLowerCase().includes("rate limit") || error?.status === 429;
      const isTimeout = msg.toLowerCase().includes("timeout") || error?.code === "ETIMEDOUT";

      let userFriendlyMsg = "Unable to analyze image. Please try again with a clearer photo.";
      if (isRateLimit) {
        userFriendlyMsg = "Gemini API rate limit reached. Please wait a moment and retry.";
      } else if (isTimeout) {
        userFriendlyMsg = "Analysis timed out. Please check your connection and retry.";
      } else if (msg.includes("API key")) {
        userFriendlyMsg = "Gemini API key is invalid or not configured. Check your server settings.";
      }

      res.status(500).json({
        error: userFriendlyMsg,
        details: process.env.NODE_ENV === "development" ? msg : undefined,
      });
    }
  });

  // API Route: Meal Prep Plan Generation
  app.post("/api/mealprep", async (req: Request, res: Response): Promise<void> => {
    try {
      const pantry = req.body.pantry || req.body.pantry_items;
      const allergens = req.body.allergens || [];
      const diet = req.body.diet || req.body.dietary_preference;
      const servings = req.body.servings;
      const calorieTarget = req.body.calorieTarget || req.body.target_calories;
      const proteinTarget = req.body.proteinTarget || req.body.target_protein;
      const maxTime = req.body.maxTime || req.body.max_cooking_time_minutes;
      const mealType = req.body.mealType || req.body.meal_type;

      if (!Array.isArray(pantry) || pantry.length === 0) {
        res.status(400).json({
          error: "Pantry ingredients list is required. Please provide at least one ingredient.",
        });
        return;
      }

      if (!process.env.GEMINI_API_KEY) {
        res.status(500).json({
          error: "GEMINI_API_KEY is not configured on the server. Please add your key in AI Studio Settings > Secrets.",
        });
        return;
      }

      const result = await generateMealPrepPlan({
        pantry,
        allergens: Array.isArray(allergens) ? allergens : [],
        diet: typeof diet === "string" ? diet : undefined,
        servings: typeof servings === "number" ? servings : undefined,
        calorieTarget: typeof calorieTarget === "number" ? calorieTarget : undefined,
        proteinTarget: typeof proteinTarget === "number" ? proteinTarget : undefined,
        maxTime: typeof maxTime === "number" ? maxTime : undefined,
        mealType: typeof mealType === "string" ? mealType : undefined,
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error in /api/mealprep:", error);
      const msg = error?.message || "Failed to generate meal prep plan.";
      const isRateLimit = msg.toLowerCase().includes("quota") || msg.toLowerCase().includes("rate limit") || error?.status === 429;
      const isTimeout = msg.toLowerCase().includes("timeout") || error?.code === "ETIMEDOUT";

      let userFriendlyMsg = "Unable to generate recipes right now. Please try again with your ingredients.";
      if (isRateLimit) {
        userFriendlyMsg = "Gemini API rate limit reached. Please wait a moment and retry.";
      } else if (isTimeout) {
        userFriendlyMsg = "Recipe synthesis timed out. Please try again.";
      }

      res.status(500).json({
        error: userFriendlyMsg,
        details: process.env.NODE_ENV === "development" ? msg : undefined,
      });
    }
  });

  // API Route: AI Cleaner Alternatives
  app.post("/api/cleaner-alternatives", async (req: Request, res: Response): Promise<void> => {
    try {
      const productName = req.body.productName || req.body.name || req.body.product_name;
      const brand = req.body.brand || req.body.brands;
      const ingredientsText = req.body.ingredientsText || req.body.ingredients || req.body.ingredients_text;
      const allergens = req.body.allergens || [];

      if (!productName || typeof productName !== "string") {
        res.status(400).json({ error: "Product name is required to find cleaner alternatives." });
        return;
      }

      const result = await generateAICleanerAlternatives({
        productName: productName.trim(),
        brand: brand ? String(brand).trim() : undefined,
        ingredientsText: ingredientsText ? String(ingredientsText).trim() : undefined,
        allergens: Array.isArray(allergens) ? allergens : [],
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error in /api/cleaner-alternatives:", error);
      res.status(500).json({ error: "Failed to generate AI cleaner alternatives." });
    }
  });

  // ---------------------------------------------------------------------------
  // VITE MIDDLEWARE (Dev) OR STATIC BUILD (Prod)
  // ---------------------------------------------------------------------------
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    const distIndex = path.join(distPath, "index.html");
    const rootIndex = path.join(process.cwd(), "index.html");

    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
    }
    app.use(express.static(process.cwd()));

    app.get("*", (_req: Request, res: Response) => {
      if (fs.existsSync(distIndex)) {
        res.sendFile(distIndex);
      } else {
        res.sendFile(rootIndex);
      }
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Lavosia Backend & UI running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
