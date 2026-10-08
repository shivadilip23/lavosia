/**
 * HEALTH SCORE ENGINE
 */
(function (global) {
  const SCORE_CONFIG = {
    baseline: 78,
    positiveWeight: 5,
    negativeWeightBySeverity: { 0: 0, 1: 6, 2: 10, 3: 16 },
    minPositionWeight: 0.4,
    manyAdditivesThreshold: 4,
    manyAdditivesPenalty: 6
  };

  function gradeFromScore(score) {
    if (score >= 85) return 'A';
    if (score >= 70) return 'B';
    if (score >= 50) return 'C';
    return 'D';
  }

  function categoryFromScore(score) {
    if (score >= 85) return 'EXCELLENT';
    if (score >= 70) return 'GOOD';
    if (score >= 50) return 'MODERATE';
    return 'POOR';
  }

  function positionWeight(index, total) {
    if (total <= 1) return 1;
    const span = 1 - SCORE_CONFIG.minPositionWeight;
    return 1 - (index / (total - 1)) * span;
  }

  function computeHealthScore(matchResults) {
    const total = matchResults.length;
    let score = SCORE_CONFIG.baseline;

    const positives = [];
    const concerns = [];
    const allergens = [];
    const seenPositiveCategories = new Set();
    const seenConcernCategories = new Set();
    const seenAllergens = new Set();

    let unknownCount = 0;
    let additiveCount = 0;

    matchResults.forEach((result, i) => {
      if (result.status !== 'known') {
        unknownCount++;
        return;
      }

      const record = result.record;
      const weight = positionWeight(i, total);
      if (record.is_additive) additiveCount++;

      if (record.effect === 'negative') {
        const severityWeight = SCORE_CONFIG.negativeWeightBySeverity[record.severity] || 0;
        score -= severityWeight * weight;
        if (!seenConcernCategories.has(record.category)) {
          concerns.push(record.note);
          seenConcernCategories.add(record.category);
        }
      } else if (record.effect === 'positive') {
        score += SCORE_CONFIG.positiveWeight * weight;
        if (!seenPositiveCategories.has(record.category)) {
          positives.push(record.note);
          seenPositiveCategories.add(record.category);
        }
      }

      if (record.allergen && !seenAllergens.has(record.allergen)) {
        allergens.push(record.allergen);
        seenAllergens.add(record.allergen);
      }
    });

    if (additiveCount >= SCORE_CONFIG.manyAdditivesThreshold) {
      score -= SCORE_CONFIG.manyAdditivesPenalty;
      concerns.push(`Contains a high number of processed additives (${additiveCount} recognized).`);
    }

    score = Math.max(0, Math.min(100, Math.round(score)));

    if (positives.length === 0) positives.push('No standout positive ingredients were identified from the recognized items.');
    if (concerns.length === 0) concerns.push('No significant concerns were identified from the recognized ingredients.');

    const unknownNote = unknownCount > 0
      ? `${unknownCount} ingredient${unknownCount === 1 ? '' : 's'} could not be confidently identified.`
      : null;

    return {
      score,
      grade: gradeFromScore(score),
      category: categoryFromScore(score),
      positives,
      concerns,
      allergens,
      unknownCount,
      unknownNote,
      recognizedCount: total - unknownCount,
      totalCount: total
    };
  }

  global.HealthScoreEngine = { computeHealthScore, SCORE_CONFIG, gradeFromScore, categoryFromScore };
})(window);
