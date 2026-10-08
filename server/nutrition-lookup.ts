import fs from "fs";
import path from "path";

export interface MacroNutrients {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export interface NutritionEntry {
  name: string;
  aliases: string[];
  per100g: MacroNutrients;
}

export interface ComputedItemNutrition {
  name: string;
  matchedName: string;
  grams: number;
  source: "database" | "estimated";
  per100g: MacroNutrients;
  totals: {
    kcal: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
  };
}

let nutritionDatabase: NutritionEntry[] = [];

function loadDatabase(): NutritionEntry[] {
  if (nutritionDatabase.length > 0) return nutritionDatabase;
  try {
    const filePath = path.join(process.cwd(), "server", "nutrition-table.json");
    const raw = fs.readFileSync(filePath, "utf-8");
    nutritionDatabase = JSON.parse(raw) as NutritionEntry[];
  } catch (err) {
    console.error("Failed to load nutrition table:", err);
    nutritionDatabase = [];
  }
  return nutritionDatabase;
}

function cleanString(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Levenshtein distance
function levenshteinDistance(s1: string, s2: string): number {
  const m = s1.length;
  const n = s2.length;
  const d: number[][] = [];
  for (let i = 0; i <= m; i++) d[i] = [i];
  for (let j = 0; j <= n; j++) d[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost
      );
    }
  }
  return d[m][n];
}

// Similarity score 0 to 1
function similarityScore(s1: string, s2: string): number {
  if (s1 === s2) return 1;
  if (!s1 || !s2) return 0;
  if (s1.includes(s2) || s2.includes(s1)) {
    const minLen = Math.min(s1.length, s2.length);
    const maxLen = Math.max(s1.length, s2.length);
    return minLen / maxLen;
  }
  const dist = levenshteinDistance(s1, s2);
  const maxLen = Math.max(s1.length, s2.length);
  return Math.max(0, (maxLen - dist) / maxLen);
}

export function findNutritionMatch(query: string): NutritionEntry | null {
  const db = loadDatabase();
  const cleanedQuery = cleanString(query);
  if (!cleanedQuery) return null;

  const queryWords = cleanedQuery.split(" ").filter((w) => w.length > 2);

  let bestEntry: NutritionEntry | null = null;
  let bestScore = 0;

  for (const entry of db) {
    const candidates = [entry.name, ...entry.aliases];
    for (const rawCandidate of candidates) {
      const candidate = cleanString(rawCandidate);
      // Exact match
      if (candidate === cleanedQuery) {
        return entry;
      }

      // Word intersection
      const candWords = candidate.split(" ").filter((w) => w.length > 2);
      const commonWords = queryWords.filter((w) => candWords.includes(w));
      const wordScore = candWords.length > 0 ? (commonWords.length / Math.max(queryWords.length, candWords.length)) : 0;

      const sim = similarityScore(cleanedQuery, candidate);
      const compositeScore = Math.max(sim, wordScore);

      if (compositeScore > bestScore) {
        bestScore = compositeScore;
        bestEntry = entry;
      }
    }
  }

  // Threshold: if score >= 0.55 we consider it a confident match
  if (bestScore >= 0.55) {
    return bestEntry;
  }

  return null;
}

export function computeItemNutrition(
  name: string,
  databaseQuery: string,
  grams: number,
  fallbackPer100g?: MacroNutrients
): ComputedItemNutrition {
  const safeGrams = Math.max(0, grams || 0);
  const match = findNutritionMatch(databaseQuery || name);

  if (match) {
    const p = match.per100g;
    const factor = safeGrams / 100;
    return {
      name,
      matchedName: match.name,
      grams: safeGrams,
      source: "database",
      per100g: { ...p },
      totals: {
        kcal: Math.round(p.kcal * factor),
        protein_g: Math.round(p.protein_g * factor * 10) / 10,
        carbs_g: Math.round(p.carbs_g * factor * 10) / 10,
        fat_g: Math.round(p.fat_g * factor * 10) / 10,
      },
    };
  }

  // Fallback to estimated
  const p: MacroNutrients = fallbackPer100g && fallbackPer100g.kcal > 0
    ? fallbackPer100g
    : { kcal: 150, protein_g: 5, carbs_g: 15, fat_g: 5 };

  const factor = safeGrams / 100;
  return {
    name,
    matchedName: name,
    grams: safeGrams,
    source: "estimated",
    per100g: { ...p },
    totals: {
      kcal: Math.round(p.kcal * factor),
      protein_g: Math.round(p.protein_g * factor * 10) / 10,
      carbs_g: Math.round(p.carbs_g * factor * 10) / 10,
      fat_g: Math.round(p.fat_g * factor * 10) / 10,
    },
  };
}
