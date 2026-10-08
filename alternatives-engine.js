/**
 * CLEANER ALTERNATIVES ENGINE (Screen 8)
 */
(function (global) {
  const NUTRIENT_KEYS = ['kcal', 'protein', 'fat', 'satFat', 'sugars', 'salt', 'fiber'];
  const SCORING_FIELDS = ['sugars', 'salt', 'satFat', 'fiber', 'protein'];

  const LIMITS = {
    sugars: { high: 22.5, drinkHigh: 11.25 },
    salt:   { high: 1.5,  drinkHigh: 0.75 },
    satFat: { high: 5,    drinkHigh: 2.5 }
  };
  const NUTRIENT_LABELS = { sugars: 'sugar', salt: 'salt', satFat: 'saturated fat' };

  const CATEGORY_LABELS = {
    artificial_colour: 'Artificial colour',
    preservative: 'Preservative',
    flavour_enhancer: 'Flavour enhancer',
    artificial_flavour: 'Artificial flavour',
    natural_flavour: 'Flavouring',
    trans_fat: 'Trans-fat risk',
    sweetener: 'Artificial sweetener',
    added_sugar: 'Added sugar',
    refined_carb: 'Refined starch',
    refined_grain: 'Refined flour',
    oil_fat: 'Refined oil',
    sodium: 'Sodium',
    emulsifier: 'Emulsifier',
    thickener: 'Thickener',
    acidity_regulator: 'Acid',
    raising_agent: 'Raising agent',
    antioxidant: 'Antioxidant',
    processed_dairy: 'Processed dairy',
    fruit_juice: 'Juice sugars'
  };

  const REMOVAL_RULES = [
    ['artificial_colour', 'No artificial colours'],
    ['preservative', 'No preservatives'],
    ['flavour_enhancer', 'No flavour enhancers such as MSG'],
    ['artificial_flavour', 'No artificial flavours'],
    ['trans_fat', 'No hydrogenated fat or shortening'],
    ['sweetener', 'No artificial sweeteners'],
    ['refined_carb', 'No maltodextrin or modified starch']
  ];

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
    return isFinite(n) ? n : null;
  }

  function normalizeNutrition(n) {
    const out = {};
    NUTRIENT_KEYS.forEach(k => { out[k] = num(n && n[k]); });
    return out;
  }

  function fmt(v) {
    if (v !== 0 && Math.abs(v) < 1) return String(Math.round(v * 100) / 100);
    return String(Math.round(v * 10) / 10);
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function joinNatural(items) {
    if (items.length <= 1) return items.join('');
    return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
  }

  function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function getCategory(id) {
    return global.AlternativesDatabase.categories.find(c => c.id === id) || null;
  }

  function analyzeIngredients(text) {
    const parsed = global.IngredientParser.parse(text);
    const matchResults = global.IngredientMatcher.matchAll(parsed.list);
    const scoreResult = global.HealthScoreEngine.computeHealthScore(matchResults);
    return { cleaned: parsed.cleaned, list: parsed.list, matchResults, scoreResult };
  }

  function nutritionAdjustment(n, fields, drink) {
    let adj = 0;
    fields.forEach(k => {
      const v = n[k];
      if (v == null) return;
      if (k === 'sugars') {
        const hi = drink ? LIMITS.sugars.drinkHigh : LIMITS.sugars.high;
        adj += v > hi ? -14 : v > hi / 2 ? -8 : v > hi / 4.5 ? -3 : 2;
      } else if (k === 'salt') {
        const hi = drink ? LIMITS.salt.drinkHigh : LIMITS.salt.high;
        adj += v > hi ? -12 : v > hi * 0.6 ? -5 : v > 0.3 ? -2 : 2;
      } else if (k === 'satFat') {
        const hi = drink ? LIMITS.satFat.drinkHigh : LIMITS.satFat.high;
        adj += v > hi ? -8 : v > hi * 0.3 ? -3 : 1;
      } else if (k === 'fiber') {
        adj += v >= 6 ? 4 : v >= 3 ? 2 : 0;
      } else if (k === 'protein') {
        adj += v >= 10 ? 3 : v >= 5 ? 1 : 0;
      }
    });
    return clamp(adj, -20, 20);
  }

  function assess(product, opts) {
    const options = opts || {};
    const drink = !!options.drink;
    const nutrition = normalizeNutrition(product.nutrition);
    const text = (product.ingredientsText || '').trim();

    let analysis = null;
    if (text) {
      const a = analyzeIngredients(text);
      if (a.list.length > 0) analysis = a;
    }

    const records = [];
    const seen = new Set();
    if (analysis) {
      analysis.matchResults.forEach(r => {
        if (r.status === 'known' && !seen.has(r.record.name)) {
          seen.add(r.record.name);
          records.push(r.record);
        }
      });
    }

    const flaggedIngredients = records
      .filter(r => r.effect === 'negative')
      .map(r => ({ name: r.name, category: r.category, label: CATEGORY_LABELS[r.category] || 'Flagged', severity: r.severity, additive: !!r.is_additive, note: r.note }));

    const otherAdditives = records
      .filter(r => r.is_additive && r.effect !== 'negative')
      .map(r => ({ name: r.name, category: r.category, label: CATEGORY_LABELS[r.category] || 'Additive', note: r.note }));

    const flaggedCategories = new Map();
    records.forEach(r => {
      if (r.effect === 'negative' || r.is_additive) {
        if (!flaggedCategories.has(r.category)) flaggedCategories.set(r.category, []);
        flaggedCategories.get(r.category).push(r.name);
      }
    });

    const nutritionFlags = [];
    ['sugars', 'salt', 'satFat'].forEach(k => {
      const v = nutrition[k];
      if (v == null) return;
      const hi = drink ? LIMITS[k].drinkHigh : LIMITS[k].high;
      if (v > hi) {
        nutritionFlags.push({ key: k, label: `High ${NUTRIENT_LABELS[k]}`, value: v, text: `High ${NUTRIENT_LABELS[k]} (${fmt(v)} g per 100 ${drink ? 'ml' : 'g'})` });
      }
    });

    const requested = options.basis || SCORING_FIELDS;
    const fields = requested.filter(k => SCORING_FIELDS.indexOf(k) !== -1 && nutrition[k] != null);
    let score = null;
    if (analysis) {
      score = analysis.scoreResult.score + nutritionAdjustment(nutrition, fields, drink);
    } else if (fields.length > 0) {
      score = 70 + nutritionAdjustment(nutrition, fields, drink);
    }
    if (score != null) score = clamp(Math.round(score), 0, 100);

    return {
      hasIngredients: !!analysis,
      list: analysis ? analysis.list : [],
      ingredientCount: analysis ? analysis.list.length : 0,
      unknownCount: analysis ? analysis.scoreResult.unknownCount : 0,
      records,
      allCategories: new Set(records.map(r => r.category)),
      flaggedIngredients,
      otherAdditives,
      flaggedCategories,
      additiveCount: records.filter(r => r.is_additive).length,
      naturalSweeteners: records.filter(r => r.category === 'natural_sweetener').map(r => r.name),
      allergens: analysis ? analysis.scoreResult.allergens : [],
      nutrition,
      nutritionFlags,
      flagCount: flaggedIngredients.length + nutritionFlags.length,
      score,
      grade: score == null ? null : global.HealthScoreEngine.gradeFromScore(score)
    };
  }

  function hasWord(hay, phrase) {
    return new RegExp('(^|[^a-z0-9])' + escapeRegExp(phrase) + '([^a-z0-9]|$)').test(hay);
  }

  function detectCategory(product) {
    const tags = (product.categoryTags || []).join(' ').toLowerCase();
    const name = (product.name || '').toLowerCase();
    const text = (product.categoriesText || '').toLowerCase();
    let best = null;
    let bestScore = 0;

    global.AlternativesDatabase.categories.forEach(cat => {
      const vetoed = (cat.excludes || []).some(x => name.indexOf(x) !== -1 || text.indexOf(x) !== -1);
      let score = 0;
      if (cat.offTags && cat.offTags.some(t => tags.indexOf(t) !== -1)) score += 3;
      if (!vetoed) {
        if (cat.keywords.some(k => hasWord(name, k))) score += 3;
        if (cat.keywords.some(k => hasWord(text, k))) score += 1;
      }
      if (score > bestScore) { best = cat.id; bestScore = score; }
    });
    return best;
  }

  function keyOf(s) { return global.IngredientDatabase.normalizeKey(s); }

  function userAllergenHits(assessment, userAllergens) {
    const hits = [];
    (userAllergens || []).forEach(raw => {
      const k = keyOf(raw);
      if (!k) return;
      const matched = assessment.records.some(rec => {
        const candidates = [rec.allergen, rec.name].concat(rec.synonyms || []).filter(Boolean).map(keyOf);
        return candidates.some(c => c === k || (c.length >= 4 && k.length >= 4 && (c.indexOf(k) !== -1 || k.indexOf(c) !== -1)));
      });
      if (matched) hits.push(raw);
    });
    return hits;
  }

  function buildRows(cur, alt, drink) {
    const per = drink ? 'ml' : 'g';
    const rows = [];
    if (cur.hasIngredients && alt.hasIngredients) {
      rows.push({ label: 'Additives', cur: cur.additiveCount, alt: alt.additiveCount, unit: '', lowerBetter: true });
    }
    [['sugars', 'Sugar'], ['salt', 'Salt'], ['satFat', 'Sat. fat']].forEach(([k, label]) => {
      if (cur.nutrition[k] != null && alt.nutrition[k] != null) {
        rows.push({ label, cur: cur.nutrition[k], alt: alt.nutrition[k], unit: 'g', lowerBetter: true });
      }
    });
    if (rows.length < 3) {
      if (cur.nutrition.kcal != null && alt.nutrition.kcal != null) rows.push({ label: 'Calories', cur: cur.nutrition.kcal, alt: alt.nutrition.kcal, unit: '', lowerBetter: true });
      if (cur.nutrition.protein != null && alt.nutrition.protein != null) rows.push({ label: 'Protein', cur: cur.nutrition.protein, alt: alt.nutrition.protein, unit: 'g', lowerBetter: false });
    }
    return rows.filter(r => r.unit !== 'g' || Math.max(r.cur, r.alt) >= 0.1 || r.label === 'Protein').map(r => {
      const diff = r.alt - r.cur;
      let better = 'same';
      if (Math.abs(diff) > 0.05) better = (r.lowerBetter ? diff < 0 : diff > 0) ? 'alt' : 'cur';
      return Object.assign({ perUnit: per }, r, { better, curText: fmt(r.cur) + r.unit, altText: fmt(r.alt) + r.unit });
    });
  }

  function buildReasons(cur, alt, altRecord, drink) {
    const per = drink ? '100 ml' : '100 g';
    const primary = [];

    REMOVAL_RULES.forEach(([cat, text]) => {
      if (cur.flaggedCategories.has(cat) && !alt.flaggedCategories.has(cat)) {
        const names = cur.flaggedCategories.get(cat).slice(0, 2);
        primary.push(`${text} (yours has ${joinNatural(names)})`);
      }
    });

    if (cur.flaggedCategories.has('added_sugar') && !alt.flaggedCategories.has('added_sugar')) {
      primary.push(alt.naturalSweeteners.length
        ? `Sweetened with ${joinNatural(alt.naturalSweeteners.map(n => n.toLowerCase()))} instead of refined sugar`
        : 'No added refined sugar');
    }

    const palmNames = (cur.flaggedCategories.get('oil_fat') || []).filter(n => /palm/i.test(n));
    if (palmNames.length && !(alt.flaggedCategories.has('oil_fat'))) primary.push('No palm oil');

    if (cur.flaggedCategories.has('refined_grain') && !alt.flaggedCategories.has('refined_grain') && alt.allCategories.has('whole_grain')) {
      primary.push('Whole grain instead of refined flour');
    }

    let namedAdditives = 0;
    REMOVAL_RULES.forEach(([cat]) => {
      if (cur.flaggedCategories.has(cat) && !alt.flaggedCategories.has(cat)) namedAdditives += cur.flaggedCategories.get(cat).length;
    });
    if (cur.hasIngredients && alt.hasIngredients && alt.additiveCount < cur.additiveCount && cur.additiveCount > namedAdditives) {
      primary.push(alt.additiveCount === 0
        ? `No additives (yours has ${cur.additiveCount})`
        : `${alt.additiveCount} additive${alt.additiveCount === 1 ? '' : 's'} vs ${cur.additiveCount} in yours`);
    }

    const c = cur.nutrition, a = alt.nutrition;
    const nutrientReasons = [];
    if (c.sugars != null && a.sugars != null && c.sugars - a.sugars >= 3 && (c.sugars - a.sugars) / c.sugars >= 0.2) {
      nutrientReasons.push(`${fmt(c.sugars - a.sugars)} g less sugar per ${per} (${fmt(c.sugars)} to ${fmt(a.sugars)})`);
    }
    if (c.salt != null && a.salt != null && c.salt - a.salt >= 0.2 && (c.salt - a.salt) / c.salt >= 0.2) {
      nutrientReasons.push(`${fmt(c.salt - a.salt)} g less salt per ${per} (${fmt(c.salt)} to ${fmt(a.salt)})`);
    }
    if (c.satFat != null && a.satFat != null && c.satFat - a.satFat >= 1.5 && (c.satFat - a.satFat) / c.satFat >= 0.25) {
      nutrientReasons.push(`${fmt(c.satFat - a.satFat)} g less saturated fat per ${per}`);
    }
    if (c.fiber != null && a.fiber != null && a.fiber - c.fiber >= 3) {
      nutrientReasons.push(`${fmt(a.fiber - c.fiber)} g more fiber per ${per}`);
    }
    if (c.kcal != null && a.kcal != null && c.kcal - a.kcal >= 60 && (c.kcal - a.kcal) / c.kcal >= 0.25) {
      nutrientReasons.push(`${fmt(c.kcal - a.kcal)} fewer calories per ${per}`);
    }
    if (c.protein != null && a.protein != null && a.protein - c.protein >= 4) {
      nutrientReasons.push(`${fmt(a.protein - c.protein)} g more protein per ${per}`);
    }

    const extra = [];
    if (cur.ingredientCount >= alt.ingredientCount + 4 && alt.ingredientCount > 0) {
      extra.push(`Short ingredient list (${alt.ingredientCount} vs ${cur.ingredientCount})`);
    }

    const highlights = (altRecord.highlights || []).slice(0, 2);
    const evidence = primary.concat(nutrientReasons, extra);
    const body = evidence.slice(0, 5 - highlights.length);
    const totalReasons = body.concat(highlights);
    return {
      reasons: totalReasons.length > 0 ? totalReasons : (altRecord.highlights || ['Whole-food clean ingredients', 'Free from artificial additives']),
      evidence: evidence.length + (altRecord.highlights ? altRecord.highlights.length : 0)
    };
  }

  const altCache = new Map();

  function assessAlternative(alt, basis, drink) {
    const key = alt.id + '|' + basis.join(',') + '|' + drink;
    if (!altCache.has(key)) {
      altCache.set(key, assess({ ingredientsText: alt.ingredients, nutrition: alt.nutrition }, { basis, drink }));
    }
    return altCache.get(key);
  }

  function findAlternatives(product, options) {
    const opts = options || {};
    const categoryId = opts.categoryId || detectCategory(product);
    const category = categoryId ? getCategory(categoryId) : null;
    const drink = !!(category && category.drink);
    const current = assess(product, { drink });
    const currentAllergenHits = userAllergenHits(current, opts.userAllergens);

    if (!category) {
      return { status: 'no_category', category: null, current, alternatives: [], excludedCount: 0, currentAllergenHits };
    }

    const basis = SCORING_FIELDS.filter(k => current.nutrition[k] != null);
    const candidates = global.AlternativesDatabase.alternatives.filter(a => a.categories.indexOf(category.id) !== -1);

    let excludedCount = 0;
    const scored = [];
    const fallbackScored = [];

    candidates.forEach(alt => {
      const a = assessAlternative(alt, basis, drink);
      if (userAllergenHits(a, opts.userAllergens).length > 0) { excludedCount++; return; }

      const explained = buildReasons(current, a, alt, drink);
      const isHigherScore = current.score == null || a.score > current.score;
      const hasBetterAttributes = (explained.evidence > 0) || (current.additiveCount > a.additiveCount);
      const isBetter = isHigherScore || (hasBetterAttributes && (current.score == null || a.score >= current.score - 15));

      const entry = {
        id: alt.id,
        name: alt.name,
        ingredientsText: alt.ingredients,
        nutrition: a.nutrition,
        score: a.score,
        grade: a.grade,
        assessment: a,
        rows: buildRows(current, a, drink),
        reasons: explained.reasons,
        isBetter: !!isBetter
      };

      if (isBetter) {
        scored.push(entry);
      }
      fallbackScored.push(entry);
    });

    const listToRank = scored.length > 0 ? scored : fallbackScored;
    listToRank.sort((x, y) => (y.score - x.score) || (x.assessment.additiveCount - y.assessment.additiveCount));
    const alternatives = listToRank.slice(0, opts.limit || 3);

    let status = 'ok';
    if (alternatives.length === 0) status = (excludedCount > 0 && excludedCount === candidates.length) ? 'all_excluded' : 'none_better';
    return { status, category, current, alternatives, excludedCount, currentAllergenHits };
  }

  global.AlternativesEngine = {
    analyzeIngredients,
    assess,
    detectCategory,
    findAlternatives,
    userAllergenHits,
    categories: () => global.AlternativesDatabase.categories,
    CATEGORY_LABELS
  };
})(window);
