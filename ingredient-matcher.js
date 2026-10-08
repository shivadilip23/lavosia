/**
 * INGREDIENT MATCHER MODULE
 * -----------------------------------------------------------------------------
 * Maps parsed ingredient text tokens against the Ingredient Database using:
 * 1. Exact canonical normalized key matching.
 * 2. Parenthetical extraction (e.g. "Vegetable Oil (Palmolein)" -> Palmolein).
 * 3. Base name extraction (e.g. "Refined Wheat Flour (Maida)" -> Refined Wheat Flour).
 * 4. Additive code recognition (INS and E numbers, including nested & sub-codes).
 * 5. Synonym substring & token containment.
 * 6. Levenshtein fuzzy distance matching for minor OCR character noise.
 * -----------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  function normalizeKey(str) {
    return global.IngredientDatabase.normalizeKey(str);
  }

  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + cost
        );
      }
    }
    return dp[m][n];
  }

  function maxAllowedDistance(len) {
    if (len <= 4) return 0;
    if (len <= 7) return 1;
    if (len <= 12) return 2;
    return 3;
  }

  function extractParenthetical(str) {
    const match = str.match(/\(([^)]+)\)/);
    return match ? match[1].trim() : null;
  }

  function stripParenthetical(str) {
    return str.replace(/\([^)]*\)/g, '').trim();
  }

  function extractAdditiveNumbers(str) {
    const codes = [];
    // 1. Explicit INS or E code (e.g. INS 621, E322, INS-500ii)
    const explicitRegex = /\b(?:INS|E)[\s.-]{0,2}(\d{3,4}[A-Za-z(ii)]{0,4})\b/gi;
    let m;
    while ((m = explicitRegex.exec(str)) !== null) {
      codes.push(m[1].replace(/[^0-9a-z]/gi, ''));
    }

    // 2. Numbers inside parentheses (e.g. (621), (150d), (500ii))
    const parenRegex = /\(\s*(?:INS|E)?\s*(\d{3,4}[a-z]{0,2})\s*\)/gi;
    while ((m = parenRegex.exec(str)) !== null) {
      codes.push(m[1].toLowerCase());
    }

    // 3. Numbers following functional class terms (e.g. "Colour 150d", "Flavour Enhancer 621")
    const classRegex = /\b(?:colour|color|preservative|emulsifier|thickener|antioxidant|flavour enhancer|flavor enhancer|raising agent|acidity regulator)[\s:-]{1,3}(\d{3,4}[a-z]{0,2})\b/gi;
    while ((m = classRegex.exec(str)) !== null) {
      codes.push(m[1].toLowerCase());
    }

    return [...new Set(codes)];
  }

  function fuzzyLookup(normalizedTarget, synonymList) {
    if (!normalizedTarget || normalizedTarget.length < 3) return null;
    let best = null;
    let bestDistance = Infinity;

    for (const entry of synonymList) {
      if (Math.abs(entry.key.length - normalizedTarget.length) > 3) continue;
      const dist = levenshtein(normalizedTarget, entry.key);
      if (dist < bestDistance) {
        bestDistance = dist;
        best = entry;
      }
    }

    if (best && bestDistance <= maxAllowedDistance(normalizedTarget.length)) {
      return { record: best.record, distance: bestDistance };
    }
    return null;
  }

  function substringLookup(normalizedTarget, synonymList) {
    if (!normalizedTarget || normalizedTarget.length < 4) return null;
    let longestMatch = null;
    let maxLen = 0;

    for (const entry of synonymList) {
      // Must be at least 4 chars long to avoid false partials
      if (entry.key.length < 4) continue;

      if (normalizedTarget.includes(entry.key) && entry.key.length > maxLen) {
        maxLen = entry.key.length;
        longestMatch = entry.record;
      }
    }

    return longestMatch;
  }

  function match(ingredientText) {
    if (!ingredientText || !ingredientText.trim()) {
      return { status: 'unknown', original: '' };
    }

    const original = ingredientText.trim();
    const { exactIndex, synonymList } = global.IngredientDatabase.index;

    const wholeKey = normalizeKey(original);

    // 1. Exact match on whole string
    if (exactIndex.has(wholeKey)) {
      return { status: 'known', original, record: exactIndex.get(wholeKey), matchedVia: 'exact', confidence: 'high' };
    }

    // 2. Exact match on parenthetical content
    const parenthetical = extractParenthetical(original);
    if (parenthetical) {
      const parenKey = normalizeKey(parenthetical);
      if (exactIndex.has(parenKey)) {
        return { status: 'known', original, record: exactIndex.get(parenKey), matchedVia: 'parenthetical', confidence: 'high' };
      }
    }

    // 3. Exact match on base name
    const base = stripParenthetical(original);
    const baseKey = normalizeKey(base);
    if (baseKey && exactIndex.has(baseKey)) {
      return { status: 'known', original, record: exactIndex.get(baseKey), matchedVia: 'base_name', confidence: 'high' };
    }

    // 4. INS / E additive codes
    const additiveCodes = extractAdditiveNumbers(original);
    for (const code of additiveCodes) {
      const keysToTest = [
        normalizeKey('ins' + code),
        normalizeKey('e' + code),
        normalizeKey(code),
        // Without sub-letters e.g. 500ii -> 500
        normalizeKey('ins' + code.replace(/[^0-9]/g, '')),
        normalizeKey('e' + code.replace(/[^0-9]/g, ''))
      ];

      for (const k of keysToTest) {
        if (exactIndex.has(k)) {
          return { status: 'known', original, record: exactIndex.get(k), matchedVia: 'additive_code', confidence: 'high' };
        }
      }
    }

    // 5. Substring & Containment Matching (e.g. "Iodised Salt" -> "Salt", "Refined Sunflower Oil" -> "Sunflower Oil")
    const candidates = [wholeKey, baseKey, parenthetical ? normalizeKey(parenthetical) : null].filter(Boolean);
    for (const cand of candidates) {
      const subMatch = substringLookup(cand, synonymList);
      if (subMatch) {
        return { status: 'known', original, record: subMatch, matchedVia: 'substring', confidence: 'high' };
      }
    }

    // 6. Fuzzy Levenshtein match for slight OCR typos
    for (const cand of candidates) {
      const fuzzy = fuzzyLookup(cand, synonymList);
      if (fuzzy) {
        return { status: 'known', original, record: fuzzy.record, matchedVia: 'fuzzy', confidence: fuzzy.distance === 0 ? 'high' : 'medium' };
      }
    }

    return { status: 'unknown', original };
  }

  function matchAll(ingredientList) {
    return ingredientList.map(match);
  }

  global.IngredientMatcher = { match, matchAll, normalizeKey, levenshtein };
})(window);
