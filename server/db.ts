import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import bcrypt from "bcrypt";

const dbPath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(process.cwd(), "data", "lavosia.db");

// Ensure directory exists
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Copy legacy root lavosia.db if it exists and target does not exist yet
const legacyDbPath = path.join(process.cwd(), "lavosia.db");
if (!fs.existsSync(dbPath) && fs.existsSync(legacyDbPath)) {
  try {
    fs.copyFileSync(legacyDbPath, dbPath);
    console.log(`[DB] Migrated database from ${legacyDbPath} to ${dbPath}`);
  } catch (err) {
    console.warn("[DB] Could not copy legacy database:", err);
  }
}

export const db = new Database(dbPath);

// Enable foreign keys with ON DELETE CASCADE and WAL mode for reliability
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS profiles (
      user_id INTEGER PRIMARY KEY,
      age INTEGER DEFAULT 26,
      sex TEXT DEFAULT 'male',
      height_cm REAL DEFAULT 180,
      weight_kg REAL DEFAULT 75,
      activity_level TEXT DEFAULT 'active',
      goal TEXT DEFAULT 'maintenance',
      calorie_target INTEGER DEFAULT 2200,
      protein_target REAL DEFAULT 160,
      allergens TEXT DEFAULT '[]',
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS daily_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      calories REAL DEFAULT 0,
      protein REAL DEFAULT 0,
      carbs REAL DEFAULT 0,
      fat REAL DEFAULT 0,
      water REAL DEFAULT 0,
      entries TEXT DEFAULT '[]',
      UNIQUE(user_id, date),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS saved_recipes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS pantry_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // Seed default admin if no admin exists
  const existingAdmin = db.prepare("SELECT * FROM users WHERE role = 'admin' LIMIT 1").get() as any;

  const adminUsername = process.env.ADMIN_USERNAME || "admin321";
  let adminPassword = process.env.ADMIN_PASSWORD;

  if (!existingAdmin) {
    let generatedPassword = false;
    if (!adminPassword) {
      adminPassword = crypto.randomBytes(8).toString("hex");
      generatedPassword = true;
    }

    console.log(`[DB] No admin found. Seeding initial admin account "${adminUsername}"...`);
    if (generatedPassword) {
      console.log(`====================================================================`);
      console.log(`🔑 INITIAL ADMIN GENERATED CREDENTIALS:`);
      console.log(`   Username: ${adminUsername}`);
      console.log(`   Password: ${adminPassword}`);
      console.log(`   Please record these credentials securely.`);
      console.log(`====================================================================`);
    }

    const saltRounds = 10;
    const passwordHash = bcrypt.hashSync(adminPassword, saltRounds);

    const info = db.prepare(
      "INSERT INTO users (username, password_hash, role, status) VALUES (?, ?, 'admin', 'active')"
    ).run(adminUsername, passwordHash);

    const adminUserId = info.lastInsertRowid;

    // Default admin profile
    db.prepare(`
      INSERT OR REPLACE INTO profiles 
      (user_id, age, sex, height_cm, weight_kg, activity_level, goal, calorie_target, protein_target, allergens)
      VALUES (?, 28, 'male', 182, 78, 'active', 'recomposition', 2400, 175, ?)
    `).run(adminUserId, JSON.stringify(["Peanuts", "Milk"]));

    // Default admin pantry staples
    const defaultPantry = ["Basmati Rice", "Chicken Breast", "Eggs", "Spinach", "Olive Oil", "Garlic"];
    const insertPantry = db.prepare("INSERT INTO pantry_items (user_id, name) VALUES (?, ?)");
    for (const item of defaultPantry) {
      insertPantry.run(adminUserId, item);
    }

    // Default admin initial recipe
    const defaultRecipe = {
      id: "rec_admin_1",
      title: "High Protein Lemon Garlic Chicken Rice Bowl",
      description: "Tender pan-seared chicken breast tossed in lemon zest and garlic over fragrant basmati rice.",
      category: "High Protein",
      prepTime: 25,
      calories: 520,
      protein: 48,
      carbs: 52,
      fats: 12,
      ingredients: ["Chicken Breast 200g", "Basmati Rice 150g", "Garlic 2 cloves", "Olive Oil 10ml", "Lemon juice"],
      instructions: [
        "Season chicken cubes with salt, pepper, and minced garlic.",
        "Heat olive oil in a skillet over medium-high heat and sear chicken for 6-8 mins.",
        "Fluff pre-cooked warm basmati rice and place in a wide bowl.",
        "Top with chicken, drizzle lemon juice and garnish with fresh parsley."
      ]
    };
    db.prepare("INSERT INTO saved_recipes (user_id, name, data) VALUES (?, ?, ?)").run(
      adminUserId,
      defaultRecipe.title,
      JSON.stringify(defaultRecipe)
    );

    console.log(`[DB] Admin account "${adminUsername}" seeded successfully with ID ${adminUserId}.`);
  }

  // Print startup warning if the admin password is still the default
  if (adminPassword === "pass") {
    console.warn("\n====================================================================");
    console.warn("⚠️  SECURITY WARNING: Lavosia admin password is using dev default 'pass'!");
    console.warn("   Must be changed before any real production deployment!");
    console.warn("   Change ADMIN_PASSWORD in your environment or via the Admin Panel.");
    console.warn("====================================================================\n");
  }
}
