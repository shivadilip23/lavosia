# Lavosia Project Architecture & Modules Registry

This document maps all features, screens, frontend folders, backend routes/modules, and external services across the Lavosia platform.

## Feature Mapping Matrix

| Feature | Screen ID in `index.html` | Frontend Folder | Backend Route / Module | External Services |
| :--- | :--- | :--- | :--- | :--- |
| **Core Architecture** | Shared across all screens | `core/` (`router.js`, `state.js`, `api.js`, `clock.js`, `nutrition-math.js`) | `server.ts`, `server/db.ts` | None |
| **Authentication & Session** | `screen-welcome`, `screen-login`, `screen-signup` | `features/auth/` | `/api/me`, `/api/login`, `/api/register`, `/api/logout`<br>(`server/routes/auth.routes.ts`) | None |
| **Telemetry Dashboard & Logging** | `screen-dashboard` | `features/dashboard/` | `/api/log/:date`, `/api/log/today/water`, `/api/log/today/entry`<br>(`server/routes/log.routes.ts`) | None |
| **Barcode Scanner** | `screen-scan-barcode` | `features/barcode/` | Client-side Open Food Facts API (`https://world.openfoodfacts.org/api/v0/product/{barcode}.json`) | QuaggaJS, Open Food Facts |
| **Ingredient OCR Scanner** | `screen-scan-ingredients` | `features/ingredients/` | Client-side OCR pipeline & database | Tesseract.js |
| **Cleaner Food Swaps** | `screen-recommendations` | `features/swaps/` | `/api/cleaner-alternatives`<br>(`server/routes/ai.routes.ts`) | Google Gemini (`gemini-3.8-flash`) |
| **Food Vision AI** | `screen-image-analysis` | `features/food-vision/` | `/api/scan-image`<br>(`server/modules/food-vision/`) | Google Gemini Multimodal |
| **Pantry Meal Prep AI** | `screen-mealprep` | `features/meal-prep/` | `/api/pantry`, `/api/mealprep`<br>(`server/modules/meal-prep/`) | Google Gemini (`gemini-3.8-flash`) |
| **Saved Recipes** | `screen-saved-recipes` | `features/saved-recipes/` | `/api/recipes`, `/api/recipes/:id`<br>(`server/routes/recipes.routes.ts`) | None |
| **Settings & Profile** | `screen-settings` | `features/settings/` | `/api/profile`<br>(`server/routes/profile.routes.ts`) | None |
| **Admin Console** | `screen-admin` | `features/admin/` | `/api/admin/users`, `/api/admin/users/:id/reset-password`, `/api/admin/users/:id/status`<br>(`server/routes/admin.routes.ts`) | None |

---

## Possibly Unused Files & Functions

As per project guidelines, no legacy files or methods are removed. The following files and routines are retained and monitored:
1. `src/App.tsx` & `src/main.tsx` — Starter template React scaffold (application runtime is delivered via modular vanilla JavaScript/ESM SPA mounted by Vite middleware).
2. `src/index.css` — Secondary styling entrypoint alongside root `styles.css`.
3. `checkLocalStorageMigration()` & `executeLocalStorageMigration()` — Client-side one-time migration modal for users transitioning from legacy browser `localStorage` to SQLite cloud accounts.
4. Demo account quick fill hooks in login/signup forms for rapid developer testing.
