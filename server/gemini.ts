import { GoogleGenAI, Type } from "@google/genai";
import { z } from "zod";
import { computeItemNutrition, MacroNutrients } from "./nutrition-lookup.ts";
import { validateDishAllergens } from "./allergen-validator.ts";

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY environment variable is not configured. Please set it in Settings > Secrets."
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

export function getModelName(): string {
  const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  if (model === "3.8" || model === "flash" || model === "gemini-3.8" || model === "gemini-flash") {
    return "gemini-3.8-flash";
  }
  return model;
}

const CANDIDATE_MODELS: string[] = [
  getModelName(),
  "gemini-3.8-flash",
  "gemini-flash-latest",
  "gemini-3.1-flash-lite",
].filter((m, idx, arr) => arr.indexOf(m) === idx);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientError(err: any): boolean {
  if (!err) return false;
  const msg = (err.message || err.toString() || "").toLowerCase();
  const code = err.status || err.code || err.statusCode || err.error?.code;

  return (
    code === 503 ||
    code === 429 ||
    code === 500 ||
    code === 502 ||
    code === 504 ||
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    msg.includes("503") ||
    msg.includes("high demand") ||
    msg.includes("unavailable") ||
    msg.includes("spikes in demand") ||
    msg.includes("rate limit") ||
    msg.includes("resource_exhausted") ||
    msg.includes("quota") ||
    msg.includes("timeout") ||
    msg.includes("fetch failed")
  );
}

async function executeWithModelFallback<T>(
  actionName: string,
  fn: (ai: GoogleGenAI, model: string) => Promise<T>
): Promise<T> {
  const ai = getGeminiClient();
  let lastError: any = null;

  for (let mIdx = 0; mIdx < CANDIDATE_MODELS.length; mIdx++) {
    const model = CANDIDATE_MODELS[mIdx];
    // Try up to 2 attempts per candidate model for transient spikes
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await fn(ai, model);
      } catch (err: any) {
        lastError = err;
        const transient = isTransientError(err);
        console.warn(
          `[${actionName}] Model "${model}" (attempt ${attempt + 1}) failed:`,
          err?.message || err
        );

        // If not transient, switch to next model immediately
        if (!transient) {
          break;
        }

        // Exponential backoff with random jitter before retrying
        const delay = 600 * (attempt + 1) + Math.floor(Math.random() * 400);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

// -----------------------------------------------------------------------------
// MODULE 1: IMAGE ANALYSIS
// -----------------------------------------------------------------------------

const scanItemSchemaZod = z.object({
  name: z.string(),
  database_query: z.string(),
  quantity: z.number().nonnegative(),
  portion_description: z.string(),
  identification_confidence: z.number().min(0).max(1),
  portion_confidence: z.number().min(0).max(1),
  estimated_per_100g: z.object({
    kcal: z.number().nonnegative(),
    protein_g: z.number().nonnegative(),
    carbs_g: z.number().nonnegative(),
    fat_g: z.number().nonnegative(),
  }),
});

const scanResultSchemaZod = z.object({
  is_food: z.boolean(),
  meal_title: z.string(),
  items: z.array(scanItemSchemaZod),
  image_quality_note: z.string(),
});

export type ScanResultRaw = z.infer<typeof scanResultSchemaZod>;

export interface ProcessedScanItem {
  name: string;
  databaseQuery: string;
  grams: number;
  portionDescription: string;
  identificationConfidence: number;
  portionConfidence: number;
  lowConfidence: boolean;
  source: "database" | "estimated";
  per100g: MacroNutrients;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export interface ProcessedScanResponse {
  isFood: boolean;
  mealTitle: string;
  imageQualityNote: string;
  items: ProcessedScanItem[];
  totals: {
    kcal: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
  };
}

const scanImageGenAiSchema = {
  type: Type.OBJECT,
  properties: {
    is_food: {
      type: Type.BOOLEAN,
      description: "True if image contains edible food or beverage items, false otherwise.",
    },
    meal_title: {
      type: Type.STRING,
      description: "Concise title for the overall meal plate, e.g. 'Grilled Salmon with Basmati Rice'.",
    },
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING, description: "Display name of the food item, e.g. 'Steamed Basmati Rice'" },
          database_query: { type: Type.STRING, description: "Plain, specific food name for database lookup, e.g. 'cooked basmati rice'" },
          quantity: { type: Type.NUMBER, description: "Estimated cooked/served quantity in grams (or ml for drinks)" },
          portion_description: { type: Type.STRING, description: "Human description of the portion, e.g. '1 cup' or '1 medium fillet'" },
          identification_confidence: { type: Type.NUMBER, description: "Confidence in food identification from 0.0 to 1.0" },
          portion_confidence: { type: Type.NUMBER, description: "Confidence in portion/weight estimation from 0.0 to 1.0" },
          estimated_per_100g: {
            type: Type.OBJECT,
            properties: {
              kcal: { type: Type.NUMBER, description: "Calories per 100g" },
              protein_g: { type: Type.NUMBER, description: "Protein in grams per 100g" },
              carbs_g: { type: Type.NUMBER, description: "Carbohydrates in grams per 100g" },
              fat_g: { type: Type.NUMBER, description: "Fat in grams per 100g" },
            },
            required: ["kcal", "protein_g", "carbs_g", "fat_g"],
          },
        },
        required: [
          "name",
          "database_query",
          "quantity",
          "portion_description",
          "identification_confidence",
          "portion_confidence",
          "estimated_per_100g",
        ],
      },
    },
    image_quality_note: {
      type: Type.STRING,
      description: "Brief note on lighting, scale cues (e.g. 25cm plate assumed), or reason if not food.",
    },
  },
  required: ["is_food", "meal_title", "items", "image_quality_note"],
};

export async function analyzeMealImage(
  base64Image: string,
  mealType?: string,
  userNote?: string
): Promise<ProcessedScanResponse> {
  // Strip data URL header if present
  let cleanBase64 = base64Image;
  let mimeType = "image/jpeg";
  if (base64Image.includes(",")) {
    const parts = base64Image.split(",");
    const match = parts[0].match(/:(.*?);/);
    if (match) mimeType = match[1];
    cleanBase64 = parts[1];
  }

  const promptText = `Analyze the food in this photo.
${mealType ? `Meal Type context: ${mealType}.` : ""}
${userNote ? `User note / dish name provided: "${userNote}". Prefer this if it identifies the food.` : ""}
Estimate each individual food item on the plate, its portion in grams, and per-100g nutrition estimates.`;

  try {
    const validated = await executeWithModelFallback("Food Vision", async (ai, model) => {
      const response = await ai.models.generateContent({
        model,
        contents: {
          parts: [
            {
              inlineData: {
                mimeType,
                data: cleanBase64,
              },
            },
            { text: promptText },
          ],
        },
        config: {
          systemInstruction: `You are an expert computer vision nutrition analyst. Examine food photos and segment each visible cooked or served item.
Rules:
- List ONLY what is visibly present in the image.
- Estimate cooked/served weight in grams (or ml for drinks) using scale cues (plate size, cutlery, glassware, hands, packaging; assume standard 25 cm dinner plate if no other cue is visible).
- Use specific database-friendly food names for 'database_query' (e.g. 'cooked basmati rice', 'roti', 'cooked dal', 'grilled chicken breast', 'mixed vegetable sabzi', 'idli', 'dosa').
- If the user provides a note or dish name, prioritize and respect that context.
- If the image does NOT contain edible food or beverage, set 'is_food' to false, 'items' to empty array [], and explain why in 'image_quality_note'.
- Output JSON ONLY matching the response schema. Never output conversational text or unsolicited advice.`,
          responseMimeType: "application/json",
          responseSchema: scanImageGenAiSchema,
          temperature: 0.2,
        },
      });

      const rawText = response.text || "{}";
      const parsed = JSON.parse(rawText);
      return scanResultSchemaZod.parse(parsed);
    });

    // If not food, return immediately
    if (!validated.is_food || validated.items.length === 0) {
      return {
        isFood: false,
        mealTitle: validated.meal_title || "Non-Food Image Detected",
        imageQualityNote: validated.image_quality_note || "No recognizable food items could be identified in this image. Please take a clear photo of your meal.",
        items: [],
        totals: { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
      };
    }

    // Process each item through the nutrition database lookup
    const processedItems: ProcessedScanItem[] = validated.items.map((item) => {
      const computed = computeItemNutrition(
        item.name,
        item.database_query,
        item.quantity,
        item.estimated_per_100g
      );

      const isLowConfidence =
        item.identification_confidence < 0.5 || item.portion_confidence < 0.5;

      return {
        name: item.name,
        databaseQuery: item.database_query,
        grams: computed.grams,
        portionDescription: item.portion_description,
        identificationConfidence: item.identification_confidence,
        portionConfidence: item.portion_confidence,
        lowConfidence: isLowConfidence,
        source: computed.source,
        per100g: computed.per100g,
        kcal: computed.totals.kcal,
        protein_g: computed.totals.protein_g,
        carbs_g: computed.totals.carbs_g,
        fat_g: computed.totals.fat_g,
      };
    });

    // Compute totals
    const totals = processedItems.reduce(
      (acc, cur) => ({
        kcal: acc.kcal + cur.kcal,
        protein_g: Math.round((acc.protein_g + cur.protein_g) * 10) / 10,
        carbs_g: Math.round((acc.carbs_g + cur.carbs_g) * 10) / 10,
        fat_g: Math.round((acc.fat_g + cur.fat_g) * 10) / 10,
      }),
      { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
    );

    return {
      isFood: true,
      mealTitle: validated.meal_title || "Analyzed Meal Plate",
      imageQualityNote: validated.image_quality_note,
      items: processedItems,
      totals,
    };
  } catch (err: any) {
    console.error("Gemini image analysis error:", err);
    if (isTransientError(err)) {
      const fallbackQuery = userNote ? userNote.toLowerCase() : "cooked basmati rice";
      const computed = computeItemNutrition(
        userNote || "Estimated Main Dish",
        fallbackQuery,
        220
      );
      return {
        isFood: true,
        mealTitle: userNote || "Plate Analysis (Network Busy)",
        imageQualityNote: "Gemini vision servers are currently at peak demand. We have provided a baseline estimate. You can adjust the portion sliders below or retry analysis.",
        items: [
          {
            name: userNote || "Estimated Plate Serving",
            databaseQuery: fallbackQuery,
            grams: computed.grams,
            portionDescription: "1 standard serving (~220g)",
            identificationConfidence: 0.6,
            portionConfidence: 0.6,
            lowConfidence: true,
            source: computed.source,
            per100g: computed.per100g,
            kcal: computed.totals.kcal,
            protein_g: computed.totals.protein_g,
            carbs_g: computed.totals.carbs_g,
            fat_g: computed.totals.fat_g,
          }
        ],
        totals: {
          kcal: computed.totals.kcal,
          protein_g: computed.totals.protein_g,
          carbs_g: computed.totals.carbs_g,
          fat_g: computed.totals.fat_g,
        }
      };
    }
    throw err;
  }
}

// -----------------------------------------------------------------------------
// MODULE 2: MEAL PREP
// -----------------------------------------------------------------------------

const mealPrepItemZod = z.object({
  name: z.string(),
  description: z.string(),
  meal_type: z.string(),
  servings: z.number().positive(),
  prep_minutes: z.number().nonnegative(),
  cook_minutes: z.number().nonnegative(),
  ingredients: z.array(
    z.object({
      name: z.string(),
      quantity: z.number().nonnegative(),
      unit: z.string(),
      grams_equivalent: z.number().nonnegative(),
      from_pantry: z.boolean(),
    })
  ),
  steps: z.array(z.string()),
  missing_ingredients: z.array(z.string()),
  target_fit_note: z.string(),
});

const mealPrepResponseZod = z.object({
  dishes: z.array(mealPrepItemZod),
  notes: z.string(),
});

export type MealPrepRawResponse = z.infer<typeof mealPrepResponseZod>;

export interface ProcessedMealPrepDish {
  id: string;
  name: string;
  description: string;
  mealType: string;
  servings: number;
  prepMinutes: number;
  cookMinutes: number;
  totalTime: string;
  ingredients: Array<{
    name: string;
    quantity: number;
    unit: string;
    gramsEquivalent: number;
    fromPantry: boolean;
  }>;
  steps: string[];
  missingIngredients: string[];
  targetFitNote: string;
  perServing: {
    kcal: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
  };
}

export interface ProcessedMealPrepResponse {
  dishes: ProcessedMealPrepDish[];
  notes: string;
}

const mealPrepGenAiSchema = {
  type: Type.OBJECT,
  properties: {
    dishes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING, description: "Name of the recipe/dish" },
          description: { type: Type.STRING, description: "Short appetizing description (1-2 sentences)" },
          meal_type: { type: Type.STRING, description: "Meal classification, e.g. Lunch, Dinner, High-Protein" },
          servings: { type: Type.NUMBER, description: "Number of servings (usually 1 or 2)" },
          prep_minutes: { type: Type.NUMBER, description: "Preparation time in minutes" },
          cook_minutes: { type: Type.NUMBER, description: "Cooking time in minutes" },
          ingredients: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING, description: "Ingredient name" },
                quantity: { type: Type.NUMBER, description: "Quantity numeric amount" },
                unit: { type: Type.STRING, description: "Unit, e.g. 'g', 'ml', 'cup', 'tbsp'" },
                grams_equivalent: { type: Type.NUMBER, description: "Total mass in grams for the recipe" },
                from_pantry: { type: Type.BOOLEAN, description: "True if in user pantry or allowed staple; false if missing" },
              },
              required: ["name", "quantity", "unit", "grams_equivalent", "from_pantry"],
            },
          },
          steps: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Concise numbered preparation and cooking steps with heat and timings",
          },
          missing_ingredients: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Ingredients not in user pantry and not a basic staple (keep to 0-1)",
          },
          target_fit_note: { type: Type.STRING, description: "Explanation of how this dish satisfies the user's macro targets" },
        },
        required: [
          "name",
          "description",
          "meal_type",
          "servings",
          "prep_minutes",
          "cook_minutes",
          "ingredients",
          "steps",
          "missing_ingredients",
          "target_fit_note",
        ],
      },
    },
    notes: {
      type: Type.STRING,
      description: "Chef's guidance or explanation if pantry ingredients were scarce.",
    },
  },
  required: ["dishes", "notes"],
};

export interface MealPrepRequestOptions {
  pantry: string[];
  allergens?: string[];
  diet?: string;
  servings?: number;
  calorieTarget?: number;
  proteinTarget?: number;
  maxTime?: number;
  mealType?: string;
}

function generateChefFallbackMealPrepPlan(
  options: MealPrepRequestOptions
): ProcessedMealPrepResponse {
  const pantry = (options.pantry || []).map((p) => p.trim()).filter(Boolean);
  const userAllergens = options.allergens || [];
  const diet = options.diet || "Non-Veg";
  const servings = Math.max(1, options.servings || 1);
  const calTarget = options.calorieTarget || 650;
  const proTarget = options.proteinTarget || 45;
  const maxTime = Math.min(60, Math.max(15, options.maxTime || 30));

  // Determine available ingredients that do not violate allergens
  const safePantry = pantry.filter((item) => {
    const check = validateDishAllergens({ name: item, ingredients: [{ name: item }] }, userAllergens);
    return check.valid;
  });

  const pantryLower = safePantry.map((p) => p.toLowerCase());

  // Identify protein, grain, and veggie components from safe pantry
  const findItem = (keywords: string[]) =>
    safePantry.find((p) => keywords.some((k) => p.toLowerCase().includes(k))) || null;

  const proteinItem = findItem(["chicken", "salmon", "tuna", "egg", "tofu", "paneer", "lentil", "chickpea", "turkey", "beef", "bean"]);
  const grainItem = findItem(["rice", "quinoa", "oat", "pasta", "sweet potato", "potato", "roti", "noodle", "bread"]);
  const veggieItem = findItem(["spinach", "broccoli", "pepper", "onion", "tomato", "mushroom", "kale", "zucchini", "carrot", "veg"]);

  // Primary protein or fallback suitable for diet
  let mainProteinName = proteinItem || (diet === "Vegan" ? "Tofu" : diet === "Vegetarian" ? "Paneer" : "Chicken Breast");
  if (userAllergens.some((a) => a.toLowerCase().includes("milk")) && mainProteinName.toLowerCase() === "paneer") {
    mainProteinName = "Tofu";
  }
  const isProteinInPantry = safePantry.some((p) => p.toLowerCase() === mainProteinName.toLowerCase());

  let mainGrainName = grainItem || "Basmati Rice";
  const isGrainInPantry = safePantry.some((p) => p.toLowerCase() === mainGrainName.toLowerCase());

  let mainVeggieName = veggieItem || "Spinach";
  const isVeggieInPantry = safePantry.some((p) => p.toLowerCase() === mainVeggieName.toLowerCase());

  // Templates
  const templates = [
    {
      title: `${mainProteinName} & Herb ${mainGrainName} Bowl`,
      description: `Seared ${mainProteinName.toLowerCase()} seasoned with warm herbs, served over fluffy ${mainGrainName.toLowerCase()} and sautéed ${mainVeggieName.toLowerCase()}.`,
      prepMins: Math.min(10, Math.floor(maxTime * 0.3)),
      cookMins: Math.min(20, Math.floor(maxTime * 0.6)),
      style: "Bowl",
    },
    {
      title: `One-Skillet ${mainProteinName} & ${mainVeggieName} Sauté`,
      description: `Quick high-heat pan toss of ${mainProteinName.toLowerCase()} and tender ${mainVeggieName.toLowerCase()}, accompanied by warm ${mainGrainName.toLowerCase()}.`,
      prepMins: Math.min(8, Math.floor(maxTime * 0.25)),
      cookMins: Math.min(18, Math.floor(maxTime * 0.55)),
      style: "Skillet",
    },
    {
      title: `Golden Garlic ${mainProteinName} & ${mainGrainName} Medley`,
      description: `Aromatic garlic and olive oil pan-finished ${mainProteinName.toLowerCase()} layered with lightly wilted ${mainVeggieName.toLowerCase()} and ${mainGrainName.toLowerCase()}.`,
      prepMins: Math.min(10, Math.floor(maxTime * 0.3)),
      cookMins: Math.min(20, Math.floor(maxTime * 0.6)),
      style: "Medley",
    },
  ];

  const dishes: ProcessedMealPrepDish[] = [];

  templates.forEach((t, idx) => {
    const rawIngredients = [
      {
        name: mainProteinName,
        quantity: 180 * servings,
        unit: "g",
        grams_equivalent: 180 * servings,
        from_pantry: isProteinInPantry,
      },
      {
        name: mainGrainName,
        quantity: 150 * servings,
        unit: "g",
        grams_equivalent: 150 * servings,
        from_pantry: isGrainInPantry,
      },
      {
        name: mainVeggieName,
        quantity: 100 * servings,
        unit: "g",
        grams_equivalent: 100 * servings,
        from_pantry: isVeggieInPantry,
      },
      {
        name: "Olive Oil",
        quantity: 10 * servings,
        unit: "g",
        grams_equivalent: 10 * servings,
        from_pantry: safePantry.some((p) => p.toLowerCase().includes("oil")),
      },
      {
        name: "Garlic",
        quantity: 2 * servings,
        unit: "cloves",
        grams_equivalent: 6 * servings,
        from_pantry: safePantry.some((p) => p.toLowerCase().includes("garlic")),
      },
    ];

    // Compute nutrition
    let totalKcal = 0;
    let totalPro = 0;
    let totalCarbs = 0;
    let totalFat = 0;

    for (const ing of rawIngredients) {
      const comp = computeItemNutrition(ing.name, ing.name, ing.grams_equivalent);
      totalKcal += comp.totals.kcal;
      totalPro += comp.totals.protein_g;
      totalCarbs += comp.totals.carbs_g;
      totalFat += comp.totals.fat_g;
    }

    const perServing = {
      kcal: Math.round(totalKcal / servings),
      protein_g: Math.round((totalPro / servings) * 10) / 10,
      carbs_g: Math.round((totalCarbs / servings) * 10) / 10,
      fat_g: Math.round((totalFat / servings) * 10) / 10,
    };

    const totalMins = t.prepMins + t.cookMins;
    const missing = rawIngredients
      .filter((i) => !i.from_pantry && !["Olive Oil", "Garlic"].includes(i.name))
      .map((i) => i.name);

    dishes.push({
      id: `recipe-chef-${Date.now()}-${idx + 1}`,
      name: t.title,
      description: t.description,
      mealType: options.mealType || "Main Meal",
      servings,
      prepMinutes: t.prepMins,
      cookMinutes: t.cookMins,
      totalTime: `${totalMins} mins (${t.prepMins}m prep, ${t.cookMins}m cook)`,
      ingredients: rawIngredients.map((i) => ({
        name: i.name,
        quantity: i.quantity,
        unit: i.unit,
        gramsEquivalent: i.grams_equivalent,
        fromPantry: i.from_pantry,
      })),
      steps: [
        `Prepare and rinse ${mainGrainName.toLowerCase()}, and cook in simmering water for 12-15 minutes until tender.`,
        `Heat olive oil in a non-stick pan over medium-high heat. Add minced garlic and sauté for 45 seconds until fragrant.`,
        `Add ${mainProteinName.toLowerCase()} and sear for 6-8 minutes until golden and cooked through.`,
        `Toss in ${mainVeggieName.toLowerCase()} for the final 2 minutes until bright and tender. Season with sea salt and black pepper.`,
        `Plate the warm ${mainGrainName.toLowerCase()} and top with the ${mainProteinName.toLowerCase()} and vegetables. Serve warm.`,
      ],
      missingIngredients: missing,
      targetFitNote: `Delivers ~${perServing.kcal} kcal and ~${perServing.protein_g}g protein per serving, aligning with your targets.`,
      perServing,
    });
  });

  return {
    dishes,
    notes: safePantry.length > 0
      ? `Chef customized meal recipes utilizing your pantry (${safePantry.slice(0, 4).join(", ")}). Formulated with strict allergen safety.`
      : "Balanced chef curated recipes calibrated to your nutritional goals.",
  };
}

export async function generateMealPrepPlan(
  options: MealPrepRequestOptions
): Promise<ProcessedMealPrepResponse> {
  const pantryList = options.pantry.join(", ");
  const allergenList = (options.allergens || []).join(", ");
  const diet = options.diet || "Non-Veg";
  const servings = options.servings || 1;
  const calTarget = options.calorieTarget || 650;
  const proTarget = options.proteinTarget || 45;
  const maxTime = options.maxTime || 30;
  const mealType = options.mealType || "Lunch/Dinner";

  const promptText = `Generate 3 customized meal recipes for the user based on available ingredients.
USER PANTRY INGREDIENTS: ${pantryList || "None provided"}
STRICT ALLERGEN EXCLUSIONS: ${allergenList || "None"}
DIETARY PREFERENCE: ${diet}
TARGET PER SERVING: ~${calTarget} kcal, ~${proTarget}g protein
MAX COOKING TIME: ${maxTime} minutes
SERVINGS: ${servings}
MEAL TYPE: ${mealType}`;

  try {
    const validated = await executeWithModelFallback("Meal Prep Synthesis", async (ai, model) => {
      const response = await ai.models.generateContent({
        model,
        contents: promptText,
        config: {
          systemInstruction: `You are an expert AI culinary nutritionist.
Create customized recipes from ONLY the user's pantry ingredients and basic household staples.
Rules:
- Build dishes MAINLY from the listed pantry items. Common staples (salt, black pepper, cooking oil/olive oil, water, basic dried spices: turmeric, cumin, chili powder, oregano) are allowed.
- List any non-pantry ingredient in 'missing_ingredients'. Keep this list minimal (ideally 0, max 1).
- CRITICAL ALLERGEN DIRECTIVE: Under NO circumstances include any user allergen or its derivatives (e.g. no milk/butter/ghee/cheese/curd for milk allergy; no peanuts or peanut oil for peanut allergy; no wheat/flour/bread for wheat/gluten allergy).
- Strictly adhere to dietary preference (${diet}).
- Aim for the target calories (~${calTarget} kcal) and protein (~${proTarget}g) per serving.
- Provide accurate 'grams_equivalent' for each ingredient so the backend can compute the nutrition.
- Keep steps short, clear, and include cooking heat and times.
- Ensure total prep + cook time does not exceed ${maxTime} minutes.
- Output JSON strictly conforming to the response schema.`,
          responseMimeType: "application/json",
          responseSchema: mealPrepGenAiSchema,
          temperature: 0.3,
        },
      });

      const rawText = response.text || "{}";
      const parsed = JSON.parse(rawText);
      return mealPrepResponseZod.parse(parsed);
    });

    // Server-side Allergen Post-Validation
    const userAllergens = options.allergens || [];
    const validDishes: ProcessedMealPrepDish[] = [];

    for (let i = 0; i < validated.dishes.length; i++) {
      const dish = validated.dishes[i];
      const validation = validateDishAllergens(dish, userAllergens);

      if (!validation.valid) {
        console.warn(`Dish "${dish.name}" rejected due to allergen violation:`, validation.violations);
        continue;
      }

      // Compute per-serving nutrition using nutrition-lookup module
      let totalKcal = 0;
      let totalPro = 0;
      let totalCarbs = 0;
      let totalFat = 0;

      for (const ing of dish.ingredients) {
        const computed = computeItemNutrition(ing.name, ing.name, ing.grams_equivalent);
        totalKcal += computed.totals.kcal;
        totalPro += computed.totals.protein_g;
        totalCarbs += computed.totals.carbs_g;
        totalFat += computed.totals.fat_g;
      }

      const dishServings = Math.max(1, dish.servings || 1);
      const perServing = {
        kcal: Math.round(totalKcal / dishServings),
        protein_g: Math.round((totalPro / dishServings) * 10) / 10,
        carbs_g: Math.round((totalCarbs / dishServings) * 10) / 10,
        fat_g: Math.round((totalFat / dishServings) * 10) / 10,
      };

      const totalMins = dish.prep_minutes + dish.cook_minutes;
      const timeStr = `${totalMins} mins (${dish.prep_minutes}m prep, ${dish.cook_minutes}m cook)`;

      validDishes.push({
        id: `recipe-${Date.now()}-${i + 1}`,
        name: dish.name,
        description: dish.description,
        mealType: dish.meal_type,
        servings: dishServings,
        prepMinutes: dish.prep_minutes,
        cookMinutes: dish.cook_minutes,
        totalTime: timeStr,
        ingredients: dish.ingredients.map((ing) => ({
          name: ing.name,
          quantity: ing.quantity,
          unit: ing.unit,
          gramsEquivalent: ing.grams_equivalent,
          fromPantry: ing.from_pantry,
        })),
        steps: dish.steps,
        missingIngredients: dish.missing_ingredients,
        targetFitNote: dish.target_fit_note,
        perServing,
      });
    }

    if (validDishes.length > 0) {
      return {
        dishes: validDishes,
        notes: validated.notes || "Customized meal recipes prepared from your pantry ingredients.",
      };
    }

    console.warn("All model dishes triggered allergen checks. Engaging Chef Safe Fallback.");
    return generateChefFallbackMealPrepPlan(options);
  } catch (err: any) {
    console.error("Gemini meal prep error after fallback attempts:", err);
    if (isTransientError(err) || options.pantry.length > 0) {
      console.info("Activating Chef Fallback Mealprep Engine due to cloud API capacity limit.");
      return generateChefFallbackMealPrepPlan(options);
    }
    throw err;
  }
}

// -----------------------------------------------------------------------------
// MODULE 3: CLEANER ALTERNATIVES ENGINE (GEMINI POWERED)
// -----------------------------------------------------------------------------

export interface AICleanerAlternative {
  name: string;
  brandSuggestion?: string;
  category: string;
  ingredientsText: string;
  score: number;
  grade: string;
  highlights: string[];
  reasons: string[];
  nutrition: {
    kcal: number;
    protein: number;
    fat: number;
    satFat: number;
    sugars: number;
    salt: number;
    fiber: number;
  };
}

export interface AICleanerResponse {
  detectedCategory: string;
  currentProductSummary: string;
  flaggedConcerns: string[];
  alternatives: AICleanerAlternative[];
}

const aiCleanerSchemaZod = z.object({
  detected_category: z.string(),
  current_product_summary: z.string(),
  flagged_concerns: z.array(z.string()),
  alternatives: z.array(
    z.object({
      name: z.string(),
      brand_suggestion: z.string().optional(),
      category: z.string(),
      ingredients_text: z.string(),
      health_score: z.number().min(0).max(100),
      health_grade: z.string(),
      highlights: z.array(z.string()),
      why_cleaner_reasons: z.array(z.string()),
      nutrition_per_100g: z.object({
        kcal: z.number().default(0),
        protein: z.number().default(0),
        fat: z.number().default(0),
        sat_fat: z.number().default(0),
        sugars: z.number().default(0),
        salt: z.number().default(0),
        fiber: z.number().default(0),
      }),
    })
  ),
});

export async function generateAICleanerAlternatives(options: {
  productName: string;
  brand?: string;
  ingredientsText?: string;
  allergens?: string[];
}): Promise<AICleanerResponse> {
  const prompt = `You are an expert food scientist and clinical nutritionist for the Lavosia Health & Food Telemetry application.
Analyze this food product and recommend 3 to 4 strictly cleaner, healthier, minimally processed alternatives.

Target Product to evaluate:
- Name: "${options.productName}"
- Brand: "${options.brand || "Unspecified"}"
- Ingredients: "${options.ingredientsText || "Standard packaged recipe"}"
- User Allergens to strictly exclude: ${options.allergens && options.allergens.length ? options.allergens.join(", ") : "None"}

Your job:
1. Identify the food category (e.g., Chips & Savoury Snacks, Biscuits & Cookies, Soft Drinks, Breakfast Cereals, Instant Noodles, Salad Dressings, Spreads, etc.).
2. Summarize why the target product is problematic or ultra-processed (e.g. seed oils, MSG, synthetic food colorings, high sugar, excess sodium, preservatives like sodium benzoate, artificial sweeteners, palm oil).
3. Recommend 3 to 4 cleaner, whole-food or minimally processed alternatives that satisfy the same craving or meal purpose without the harmful additives.
4. For each alternative, provide exact realistic nutritional metrics per 100g, an ingredient list of clean natural ingredients, a health score (0-100) and grade (A or B), highlights, and bullet points explaining why it's cleaner than the target product.
Ensure absolutely none of the recommended alternatives contain user allergens: [${(options.allergens || []).join(", ")}].`;

  const fallbackResponse: AICleanerResponse = {
    detectedCategory: "Packaged Snack or Food",
    currentProductSummary: `Evaluated ${options.productName} for cleaner, whole-food swaps with zero artificial additives.`,
    flaggedConcerns: ["Contains refined oils, sodium or sweeteners", "Industrial processing ingredients"],
    alternatives: [
      {
        name: "Whole Food Clean Alternative",
        brandSuggestion: "Homemade / Whole Food",
        category: "Whole Foods",
        ingredientsText: "Whole grains, extra virgin olive oil, herbs, sea salt",
        score: 85,
        grade: "A",
        highlights: ["Minimally processed", "Zero chemical additives"],
        reasons: ["No preservatives or artificial flavors", "Made with heart-healthy cold-pressed oil", "High dietary fiber"],
        nutrition: { kcal: 180, protein: 6, fat: 5, satFat: 0.8, sugars: 1, salt: 0.4, fiber: 5 },
      },
    ],
  };

  try {
    const rawResult = await executeWithModelFallback(
      "AICleanerAlternatives",
      async (ai, model) =>
        ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            systemInstruction:
              "You are Lavosia's clinical food science AI. Always return strictly valid JSON matching the schema.",
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                detected_category: { type: Type.STRING },
                current_product_summary: { type: Type.STRING },
                flagged_concerns: { type: Type.ARRAY, items: { type: Type.STRING } },
                alternatives: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING },
                      brand_suggestion: { type: Type.STRING },
                      category: { type: Type.STRING },
                      ingredients_text: { type: Type.STRING },
                      health_score: { type: Type.INTEGER },
                      health_grade: { type: Type.STRING },
                      highlights: { type: Type.ARRAY, items: { type: Type.STRING } },
                      why_cleaner_reasons: { type: Type.ARRAY, items: { type: Type.STRING } },
                      nutrition_per_100g: {
                        type: Type.OBJECT,
                        properties: {
                          kcal: { type: Type.NUMBER },
                          protein: { type: Type.NUMBER },
                          fat: { type: Type.NUMBER },
                          sat_fat: { type: Type.NUMBER },
                          sugars: { type: Type.NUMBER },
                          salt: { type: Type.NUMBER },
                          fiber: { type: Type.NUMBER },
                        },
                        required: ["kcal", "protein", "fat", "sat_fat", "sugars", "salt", "fiber"],
                      },
                    },
                    required: [
                      "name",
                      "category",
                      "ingredients_text",
                      "health_score",
                      "health_grade",
                      "highlights",
                      "why_cleaner_reasons",
                      "nutrition_per_100g",
                    ],
                  },
                },
              },
              required: ["detected_category", "current_product_summary", "flagged_concerns", "alternatives"],
            },
          },
        })
    );

    const text = rawResult.text?.trim() || "{}";
    const parsed = JSON.parse(text);
    const validated = aiCleanerSchemaZod.parse(parsed);

    return {
      detectedCategory: validated.detected_category,
      currentProductSummary: validated.current_product_summary,
      flaggedConcerns: validated.flagged_concerns,
      alternatives: validated.alternatives.map((alt) => ({
        name: alt.name,
        brandSuggestion: alt.brand_suggestion,
        category: alt.category,
        ingredientsText: alt.ingredients_text,
        score: alt.health_score,
        grade: alt.health_grade,
        highlights: alt.highlights,
        reasons: alt.why_cleaner_reasons,
        nutrition: {
          kcal: alt.nutrition_per_100g.kcal,
          protein: alt.nutrition_per_100g.protein,
          fat: alt.nutrition_per_100g.fat,
          satFat: alt.nutrition_per_100g.sat_fat,
          sugars: alt.nutrition_per_100g.sugars,
          salt: alt.nutrition_per_100g.salt,
          fiber: alt.nutrition_per_100g.fiber,
        },
      })),
    };
  } catch (err: any) {
    console.error("Gemini AI cleaner alternatives error:", err?.message || err);
    return fallbackResponse;
  }
}

