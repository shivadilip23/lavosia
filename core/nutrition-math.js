/**
 * CORE NUTRITION MATH MODULE
 * -----------------------------------------------------------------------------
 * What this module does:
 *   Calculates Basal Metabolic Rate (BMR) and Total Daily Energy Expenditure (TDEE)
 *   using the clinical Mifflin-St Jeor equation. Generates recommended daily
 *   macronutrient targets (protein, carbs, fats).
 *
 * Screen(s) owned:
 *   Used across screen-signup, screen-dashboard, and screen-settings.
 *
 * Depends on:
 *   - core/state.js
 * -----------------------------------------------------------------------------
 */

import state from './state.js';

export const ACTIVITY_MULTIPLIERS = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
  extra_active: 2.0
};

export function computeTDEEAndMacros(user) {
  const { weight = 70, height = 175, age = 25, gender = 'male', activityLevel = 'active' } = user;

  let bmr = (10 * weight) + (6.25 * height) - (5 * age);
  bmr += (gender === 'male' ? 5 : -161);

  const multiplier = ACTIVITY_MULTIPLIERS[activityLevel] || 1.55;
  const tdee = Math.round(bmr * multiplier);
  const calories = Math.round(tdee * 0.9); // Moderate deficit / maintenance
  const protein = Math.round(weight * 2.1); // 2.1g per kg
  const fats = Math.round((calories * 0.25) / 9);
  const carbs = Math.max(0, Math.round((calories - (protein * 4) - (fats * 9)) / 4));

  return {
    bmr: Math.round(bmr),
    tdee,
    calories,
    protein,
    fats,
    carbs
  };
}

export function calculateTDEE(targetUser = state.user) {
  const result = computeTDEEAndMacros(targetUser);

  targetUser.tdee = result.tdee;
  if (!targetUser.goals) {
    targetUser.goals = {};
  }
  targetUser.goals.calories = result.calories;
  targetUser.goals.protein = result.protein;
  targetUser.goals.fats = result.fats;
  targetUser.goals.carbs = result.carbs;

  const preview = document.getElementById('signup-tdee-preview');
  if (preview) {
    preview.textContent = `Estimated TDEE: ${targetUser.tdee} kcal | Calorie Target: ${targetUser.goals.calories} kcal`;
  }

  return result;
}

export default {
  ACTIVITY_MULTIPLIERS,
  computeTDEEAndMacros,
  calculateTDEE
};
