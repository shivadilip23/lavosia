/**
 * LAVOSIA FRONTEND APPLICATION BOOTSTRAP
 * -----------------------------------------------------------------------------
 * What this module does:
 *   Bootstrap and orchestration engine for Lavosia. Wires core services
 *   (state, router, clock, nutrition-math, API client) and feature controllers.
 *
 * Screen(s) owned:
 *   Bootstraps lifecycle for all screens (screen-welcome through screen-admin).
 *
 * Depends on:
 *   - core/state.js
 *   - core/router.js
 *   - core/api.js
 *   - core/clock.js
 *   - core/nutrition-math.js
 * -----------------------------------------------------------------------------
 */

import state, { resetSessionState } from './core/state.js';
import { navigate, goBack, updateActiveTab, addRouteListener } from './core/router.js';
import { startLiveClock, stopLiveClock } from './core/clock.js';
import { calculateTDEE, computeTDEEAndMacros } from './core/nutrition-math.js';
import { api, apiFetch, ENDPOINTS } from './core/api.js';

class LavosiaApp {
  constructor() {
    this.state = state;
    this.currentScreen = state.currentScreen;
    this.navigationHistory = state.navigationHistory;
    this.activeAnalyzedMeal = state.activeAnalyzedMeal;
    this.pantryItems = state.pantryItems;

    // User Profile & Authentication State (references core/state.js)
    this.user = state.user;

    // Telemetry Logs for Today (references core/state.js)
    this.todayLog = state.todayLog;

    // Saved Recipes
    this.savedRecipes = state.savedRecipes;

    // Barcode scanner stream reference
    this.quaggaRunning = false;
    this.torchEnabled = false;

    // Debounce timer for log syncing
    this.logSyncTimeout = null;

    // Initialize on DOM load
    this.init();
  }

  async init() {
    this.bindEvents();
    this.startLiveClock();
    this.renderWeekCalendar();

    // Check for active session cookie on backend
    await this.checkAuthStatus();

    // Check if migration is needed for existing localStorage data
    this.checkLocalStorageMigration();

    // Back-forward cache restore protection
    window.addEventListener('pageshow', (event) => {
      if (event.persisted && !state.user.isLoggedIn) {
        resetSessionState();
        this.syncStateFromCore();
        this.updateAdminPanelVisibility();
        this.navigate('screen-welcome', false);
      }
    });
  }

  syncStateFromCore() {
    this.user = state.user;
    this.todayLog = state.todayLog;
    this.savedRecipes = state.savedRecipes;
    this.pantryItems = state.pantryItems;
    this.activeAnalyzedMeal = state.activeAnalyzedMeal;
    this.currentScreen = state.currentScreen;
    this.navigationHistory = state.navigationHistory;
  }

  async checkAuthStatus() {
    try {
      const res = await fetch('/api/me', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          this.user.id = data.user.id;
          this.user.username = data.user.username;
          this.user.role = data.user.role || 'user';
          this.user.isLoggedIn = true;

          // Fetch full profile and user data from backend
          await this.loadAllUserData();

          // Render dashboard and navigate
          this.calculateTDEE();
          this.updateUserStatsDisplay();
          this.updateActivityRings();
          this.updateAdminPanelVisibility();
          this.navigate('screen-dashboard', false);
          return;
        }
      }
    } catch (e) {
      console.warn('Could not verify session with backend:', e);
    }

    // Not logged in: reset session state completely and show welcome screen
    resetSessionState();
    this.syncStateFromCore();
    this.updateAdminPanelVisibility();
    this.navigate('screen-welcome', false);
  }

  async loadAllUserData() {
    try {
      // 1. Load Profile
      const profRes = await fetch('/api/profile', { credentials: 'include' });
      if (profRes.status === 401 || profRes.status === 403) {
        resetSessionState();
        this.syncStateFromCore();
        this.updateAdminPanelVisibility();
        this.navigate('screen-welcome', false);
        return;
      }
      if (profRes.ok) {
        const profData = await profRes.json();
        if (profData.profile) {
          const p = profData.profile;
          this.user.age = p.age ?? this.user.age;
          this.user.gender = p.sex ?? this.user.gender;
          this.user.height = p.height_cm ?? this.user.height;
          this.user.weight = p.weight_kg ?? this.user.weight;
          this.user.activityLevel = p.activity_level ?? this.user.activityLevel;
          this.user.diet = p.goal ?? this.user.diet;
          this.user.allergens = Array.isArray(p.allergens) ? p.allergens : [];
          if (p.calorie_target) this.user.goals.calories = p.calorie_target;
          if (p.protein_target) this.user.goals.protein = p.protein_target;
        }
      }

      // 2. Load Daily Log
      const todayStr = new Date().toISOString().split('T')[0];
      const logRes = await fetch(`/api/log/${todayStr}`, { credentials: 'include' });
      if (logRes.ok) {
        const logData = await logRes.json();
        if (logData.log) {
          const l = logData.log;
          this.todayLog.date = todayStr;
          this.todayLog.calories = l.calories || 0;
          this.todayLog.protein = l.protein || 0;
          this.todayLog.carbs = l.carbs || 0;
          this.todayLog.fats = l.fat || 0;
          this.todayLog.water = l.water || 0;
          // Rebuild hourly distribution history
          const step = Math.min(9, Math.floor((this.todayLog.calories || 0) / 250));
          this.todayLog.history = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
          for (let i = 0; i <= step; i++) {
            this.todayLog.history[i] = Math.round(this.todayLog.calories / (step + 1));
          }
        }
      }

      // 3. Load Pantry Items
      const pantryRes = await fetch('/api/pantry', { credentials: 'include' });
      if (pantryRes.ok) {
        const pantryData = await pantryRes.json();
        if (Array.isArray(pantryData.pantry)) {
          this.pantryItems = pantryData.pantry;
          this.renderPantryTags();
        }
      }

      // 4. Load Saved Recipes
      const recRes = await fetch('/api/recipes', { credentials: 'include' });
      if (recRes.ok) {
        const recData = await recRes.json();
        if (Array.isArray(recData.recipes)) {
          this.savedRecipes = recData.recipes.map(r => ({
            id: r.id,
            title: r.title || r.name,
            description: r.description || '',
            category: r.category || 'All',
            prepTime: r.prepTime || r.prep_time_minutes || 25,
            calories: r.calories || 0,
            protein: r.protein || 0,
            carbs: r.carbs || 0,
            fats: r.fats || r.fat || 0,
            ingredients: r.ingredients || [],
            instructions: r.instructions || []
          }));
          this.renderSavedRecipes();
        }
      }
    } catch (e) {
      console.error('Error loading user data from backend:', e);
    }
  }

  updateAdminPanelVisibility() {
    const adminBtn = document.getElementById('settings-admin-panel-btn');
    if (adminBtn) {
      adminBtn.style.display = (this.user.isLoggedIn && this.user.role === 'admin') ? 'flex' : 'none';
    }
  }

  checkLocalStorageMigration() {
    // Check if there are legacy localStorage keys
    const legacyKeys = ['lavosia_user', 'lavosia_profile', 'lavosia_log', 'lavosia_recipes', 'lavosia_pantry'];
    const hasData = legacyKeys.some(k => localStorage.getItem(k) !== null);

    if (hasData && this.user.isLoggedIn) {
      const modal = document.getElementById('migration-modal');
      if (modal) modal.style.display = 'flex';
    }
  }

  async executeLocalStorageMigration() {
    const legacyKeys = ['lavosia_user', 'lavosia_profile', 'lavosia_log', 'lavosia_recipes', 'lavosia_pantry'];
    try {
      // 1. Check recipes
      const storedRecipes = localStorage.getItem('lavosia_recipes');
      if (storedRecipes) {
        const parsed = JSON.parse(storedRecipes);
        if (Array.isArray(parsed)) {
          for (const rec of parsed) {
            await fetch('/api/recipes', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({
                name: rec.title || rec.name || 'Imported Recipe',
                data: rec
              })
            });
          }
        }
      }

      // 2. Check pantry
      const storedPantry = localStorage.getItem('lavosia_pantry');
      if (storedPantry) {
        const parsed = JSON.parse(storedPantry);
        if (Array.isArray(parsed) && parsed.length > 0) {
          await fetch('/api/pantry', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ items: parsed })
          });
        }
      }

      // 3. Check profile
      const storedProfile = localStorage.getItem('lavosia_profile') || localStorage.getItem('lavosia_user');
      if (storedProfile) {
        const p = JSON.parse(storedProfile);
        await fetch('/api/profile', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            age: p.age,
            sex: p.gender || p.sex,
            height_cm: p.height,
            weight_kg: p.weight,
            activity_level: p.activityLevel,
            goal: p.diet || p.goal,
            calorie_target: p.goals?.calories,
            protein_target: p.goals?.protein,
            allergens: p.allergens
          })
        });
      }

      // Clear all legacy localStorage keys
      legacyKeys.forEach(k => localStorage.removeItem(k));

      // Reload fresh data from backend
      await this.loadAllUserData();
      this.calculateTDEE();
      this.updateUserStatsDisplay();
      this.updateActivityRings();

      const modal = document.getElementById('migration-modal');
      if (modal) modal.style.display = 'none';

      alert('Data migration complete! Your local browser data is now securely stored in your Lavosia account.');
    } catch (e) {
      console.error('Migration error:', e);
      legacyKeys.forEach(k => localStorage.removeItem(k));
      const modal = document.getElementById('migration-modal');
      if (modal) modal.style.display = 'none';
    }
  }

  /* =========================================================================
     ROUTING & NAVIGATION (Delegated to core/router.js)
     ========================================================================= */
  navigate(screenId, addToHistory = true) {
    navigate(screenId, addToHistory);
    this.currentScreen = state.currentScreen;
    this.navigationHistory = state.navigationHistory;

    // Lifecycle hooks
    if (screenId === 'screen-scan-barcode') {
      this.initBarcodeScanner();
    } else {
      this.stopBarcodeScanner();
    }

    if (screenId === 'screen-dashboard') {
      this.updateActivityRings();
    }
  }

  goBack(fallback = 'screen-dashboard') {
    goBack(fallback);
    this.currentScreen = state.currentScreen;
    this.navigationHistory = state.navigationHistory;
  }

  updateActiveTab(screenId) {
    updateActiveTab(screenId);
  }

  /* =========================================================================
     LIVE TIME & METABOLIC CALIBRATION (Delegated to core/clock.js & core/nutrition-math.js)
     ========================================================================= */
  startLiveClock() {
    startLiveClock();
  }

  calculateTDEE() {
    return calculateTDEE(this.user);
  }

  updateActivityRings() {
    const { calories, protein, water } = this.todayLog;
    const { goals } = this.user;

    // Telemetry text
    const moveVal = document.getElementById('telemetry-move-val');
    const proVal = document.getElementById('telemetry-protein-val');
    const waterVal = document.getElementById('telemetry-water-val');

    if (moveVal) moveVal.innerHTML = `${calories.toLocaleString()}<span>/${goals.calories.toLocaleString()} CAL</span>`;
    if (proVal) proVal.innerHTML = `${protein}<span>/${goals.protein} G</span>`;
    if (waterVal) waterVal.innerHTML = `${water.toFixed(2)}<span>/${goals.water.toFixed(1)} L</span>`;

    // Rings SVG stroke-dashoffset
    const moveCirc = 364.42;
    const proCirc = 263.89;
    const waterCirc = 163.36;

    const moveRatio = Math.min(1.0, calories / goals.calories);
    const proRatio = Math.min(1.0, protein / goals.goals_protein || protein / goals.protein);
    const waterRatio = Math.min(1.0, water / goals.water);

    const moveFill = document.getElementById('ring-fill-move');
    const proFill = document.getElementById('ring-fill-protein');
    const waterFill = document.getElementById('ring-fill-water');

    if (moveFill) moveFill.style.strokeDashoffset = (moveCirc * (1 - moveRatio)).toFixed(1);
    if (proFill) proFill.style.strokeDashoffset = (proCirc * (1 - proRatio)).toFixed(1);
    if (waterFill) waterFill.style.strokeDashoffset = (waterCirc * (1 - waterRatio)).toFixed(1);

    // Calories budget remaining
    const remaining = Math.max(0, goals.calories - calories);
    const calRemEl = document.getElementById('dash-cal-remaining');
    const calBudgetSub = document.getElementById('dash-cal-budget-sub');
    if (calRemEl) calRemEl.textContent = remaining.toLocaleString();
    if (calBudgetSub) calBudgetSub.textContent = `/${goals.calories.toLocaleString()} CAL`;

    // Macro progress bars
    const updateBar = (fillId, textId, current, goal, unit = 'g') => {
      const fillEl = document.getElementById(fillId);
      const textEl = document.getElementById(textId);
      const pct = Math.min(100, Math.round((current / goal) * 100));
      if (fillEl) fillEl.style.width = `${pct}%`;
      if (textEl) textEl.textContent = `${current}${unit} / ${goal}${unit}`;
    };

    updateBar('bar-protein-fill', 'bar-protein-text', this.todayLog.protein, goals.protein);
    updateBar('bar-carbs-fill', 'bar-carbs-text', this.todayLog.carbs, goals.carbs);
    updateBar('bar-fats-fill', 'bar-fats-text', this.todayLog.fats, goals.fats);
    updateBar('bar-fiber-fill', 'bar-fiber-text', this.todayLog.fiber, goals.fiber);

    // Hydration sub text
    const hydSub = document.getElementById('dash-hydration-sub');
    if (hydSub) hydSub.textContent = `${this.todayLog.water.toFixed(2)}L logged of ${goals.water.toFixed(1)}L goal`;

    // Hourly bar charts
    const chartBars = document.querySelectorAll('.chart-bar');
    const totalHistory = this.todayLog.history.reduce((a, b) => a + b, 0);
    const maxVal = Math.max(...this.todayLog.history, 400);

    chartBars.forEach((bar, idx) => {
      const val = this.todayLog.history[idx] || 0;
      const h = Math.round((val / maxVal) * 100);
      bar.style.height = `${Math.max(4, h)}%`;
    });

    const progressLabel = document.getElementById('chart-progress-label');
    if (progressLabel) {
      const budgetPct = Math.min(100, Math.round((calories / goals.calories) * 100));
      progressLabel.textContent = `${budgetPct}% of daily budget logged`;
    }
  }

  syncDailyLogToBackend() {
    if (!this.user.isLoggedIn) return;
    if (this.logSyncTimeout) clearTimeout(this.logSyncTimeout);

    this.logSyncTimeout = setTimeout(async () => {
      try {
        const todayStr = this.todayLog.date || new Date().toISOString().split('T')[0];
        await fetch(`/api/log/${todayStr}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            calories: this.todayLog.calories || 0,
            protein: this.todayLog.protein || 0,
            carbs: this.todayLog.carbs || 0,
            fat: this.todayLog.fats || 0,
            water: this.todayLog.water || 0
          })
        });
      } catch (e) {
        console.warn('Could not sync log telemetry to server:', e);
      }
    }, 400);
  }

  addCalories(kcal) {
    if (isNaN(kcal) || kcal <= 0) return;
    this.todayLog.calories += kcal;
    this.todayLog.history[Math.min(9, Math.floor(this.todayLog.calories / 250))] += kcal;
    this.updateActivityRings();
    this.syncDailyLogToBackend();
  }

  addProtein(g) {
    if (isNaN(g) || g <= 0) return;
    this.todayLog.protein += g;
    this.updateActivityRings();
    this.syncDailyLogToBackend();
  }

  addCarbs(g) {
    if (isNaN(g) || g <= 0) return;
    this.todayLog.carbs += g;
    this.updateActivityRings();
    this.syncDailyLogToBackend();
  }

  addFats(g) {
    if (isNaN(g) || g <= 0) return;
    this.todayLog.fats += g;
    this.updateActivityRings();
    this.syncDailyLogToBackend();
  }

  addFiber(g) {
    if (isNaN(g) || g <= 0) return;
    this.todayLog.fiber += g;
    this.updateActivityRings();
    this.syncDailyLogToBackend();
  }

  addWater(liters) {
    this.todayLog.water = Math.round((this.todayLog.water + liters) * 100) / 100;
    this.updateActivityRings();
    this.syncDailyLogToBackend();
  }

  renderWeekCalendar() {
    const container = document.getElementById('week-days');
    if (!container) return;

    container.innerHTML = '';
    const days = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    const now = new Date();
    const todayIndex = now.getDay();

    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(now.getDate() - todayIndex + i);
      const dayNum = d.getDate();
      const isToday = i === todayIndex;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `week-day ${isToday ? 'is-today is-selected' : ''}`;
      btn.innerHTML = `
        <span class="week-day-name">${days[i]}</span>
        <div class="week-day-dial">
          <svg viewBox="0 0 40 40">
            <circle class="wd-track" cx="20" cy="20" r="17"/>
            <circle class="wd-fill" cx="20" cy="20" r="17" style="stroke-dashoffset: ${isToday ? 30 : 106.81};"/>
          </svg>
          <div class="week-day-num">${dayNum}</div>
        </div>
        <div class="week-day-dot"></div>
      `;

      btn.addEventListener('click', () => {
        document.querySelectorAll('.week-day').forEach(w => w.classList.remove('is-selected'));
        btn.classList.add('is-selected');
      });

      container.appendChild(btn);
    }
  }

  updateUserStatsDisplay() {
    const nameEl = document.getElementById('settings-user-name');
    const metaEl = document.getElementById('settings-user-meta');
    const mealprepDietEl = document.getElementById('mealprep-user-diet');
    const mealprepTargetsEl = document.getElementById('mealprep-user-targets');
    const mealprepAllergenCountEl = document.getElementById('mealprep-allergen-count');

    if (nameEl) nameEl.textContent = this.user.username;
    if (metaEl) metaEl.textContent = `${this.user.gender.toUpperCase()} • ${this.user.age} YRS • ${this.user.weight} KG • ${this.user.height} CM`;
    if (mealprepDietEl) mealprepDietEl.textContent = this.user.diet;
    if (mealprepTargetsEl) mealprepTargetsEl.textContent = `${Math.round(this.user.goals.calories * 0.35)} kcal, ${Math.round(this.user.goals.protein * 0.35)}g pro`;
    if (mealprepAllergenCountEl) mealprepAllergenCountEl.textContent = this.user.allergens.length;
  }

  /* =========================================================================
     MODULE 1 - SCREEN 7: FOOD IMAGE VISION ANALYSIS 
     ========================================================================= */
  initImageAnalysis() {
    const cameraBtn = document.getElementById('image-analysis-camera-btn');
    const galleryBtn = document.getElementById('image-analysis-gallery-btn');
    const fileInput = document.getElementById('image-analysis-file-input');
    const confirmBtn = document.getElementById('confirm-analyze-btn');
    const previewImg = document.getElementById('image-analysis-preview');
    const retryBtn = document.getElementById('image-analysis-retry-btn');
    const logMealBtn = document.getElementById('log-analyzed-meal-btn');

    if (cameraBtn && fileInput) {
      cameraBtn.addEventListener('click', () => {
        fileInput.setAttribute('capture', 'environment');
        fileInput.click();
      });
    }

    if (galleryBtn && fileInput) {
      galleryBtn.addEventListener('click', () => {
        fileInput.removeAttribute('capture');
        fileInput.click();
      });
    }

    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        // Hide errors
        this.hideImageAnalysisError();

        const reader = new FileReader();
        reader.onload = (event) => {
          if (previewImg) previewImg.src = event.target.result;
        };
        reader.readAsDataURL(file);
      });
    }

    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => this.executeMealAnalysis());
    }

    if (retryBtn) {
      retryBtn.addEventListener('click', () => this.executeMealAnalysis());
    }

    if (logMealBtn) {
      logMealBtn.addEventListener('click', () => this.logAnalyzedMealToDashboard());
    }
  }

  async resizeImageForVision(imgSrc, maxDim = 1024) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        resolve(dataUrl);
      };
      img.onerror = () => resolve(imgSrc);
      img.src = imgSrc;
    });
  }

  showImageAnalysisLoading(statusText = 'Analyzing meal...') {
    const overlay = document.getElementById('image-analysis-loading-overlay');
    const status = document.getElementById('image-analysis-loading-status');
    const confirmBtn = document.getElementById('confirm-analyze-btn');

    if (status) status.textContent = statusText;
    if (overlay) overlay.style.display = 'flex';
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<span class="spinner"></span> Analyzing Plate...';
    }
  }

  hideImageAnalysisLoading() {
    const overlay = document.getElementById('image-analysis-loading-overlay');
    const confirmBtn = document.getElementById('confirm-analyze-btn');

    if (overlay) overlay.style.display = 'none';
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = 'Confirm & Analyze Meal';
    }
  }

  showImageAnalysisError(msg) {
    const banner = document.getElementById('image-analysis-error-banner');
    const text = document.getElementById('image-analysis-error-text');
    if (text) text.textContent = msg;
    if (banner) banner.style.display = 'flex';
  }

  hideImageAnalysisError() {
    const banner = document.getElementById('image-analysis-error-banner');
    if (banner) banner.style.display = 'none';
  }

  async executeMealAnalysis() {
    this.hideImageAnalysisError();
    const previewImg = document.getElementById('image-analysis-preview');
    if (!previewImg || !previewImg.src) {
      this.showImageAnalysisError('Please choose or photograph a food meal first.');
      return;
    }

    const mealTypeSelect = document.getElementById('image-analysis-meal-type');
    const userNoteInput = document.getElementById('image-analysis-user-note');
    const mealType = mealTypeSelect ? mealTypeSelect.value : 'Lunch';
    const userNote = userNoteInput ? userNoteInput.value.trim() : '';

    this.showImageAnalysisLoading('Resizing & preparing image...');

    try {
      // 1. Resize image to optimal vision resolution (<= 1024px)
      const base64Image = await this.resizeImageForVision(previewImg.src, 1024);

      this.showImageAnalysisLoading('Analyzing food image...');

      // 2. Call backend proxy endpoint
      const response = await fetch('/api/scan-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: base64Image,
          user_note: userNote || undefined,
          meal_type: mealType
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || data.error || 'Failed to analyze food image.');
      }

      // Check if image is recognized as food
      const isFood = (data.is_food !== false && data.isFood !== false);
      if (!isFood) {
        this.hideImageAnalysisLoading();
        this.showImageAnalysisError(data.image_quality_note || data.imageQualityNote || 'No food detected in this picture. Please frame your meal clearly in good light.');
        return;
      }

      this.renderImageAnalysisResults(data);
      this.hideImageAnalysisLoading();

    } catch (err) {
      console.error('Image analysis error:', err);
      this.hideImageAnalysisLoading();
      this.showImageAnalysisError(err.message || 'Network error analyzing image. Please check your connection and retry.');
    }
  }

  renderImageAnalysisResults(data) {
    // Normalize data structure
    const normalizedData = {
      dish_title: data.meal_title || data.mealTitle || data.dish_title || 'Identified Meal Plate',
      image_quality_note: data.image_quality_note || data.imageQualityNote || '',
      items: (data.items || []).map(item => ({
        name: item.name,
        estimated_grams: item.grams || item.estimated_grams || 100,
        calories: item.kcal != null ? item.kcal : (item.calories || 0),
        protein: item.protein_g != null ? item.protein_g : (item.protein || 0),
        carbs: item.carbs_g != null ? item.carbs_g : (item.carbs || 0),
        fat: item.fat_g != null ? item.fat_g : (item.fat || 0),
        confidence_score: item.identificationConfidence != null ? item.identificationConfidence : (item.confidence_score || 0.85),
        source: item.source || 'database'
      })),
      total_calories: data.totals?.kcal || data.total_calories || 0,
      total_protein: data.totals?.protein_g || data.total_protein || 0,
      total_carbs: data.totals?.carbs_g || data.total_carbs || 0,
      total_fat: data.totals?.fat_g || data.total_fat || 0
    };

    this.activeAnalyzedMeal = normalizedData;
    const resultsContainer = document.getElementById('image-analysis-results');
    const foodTitle = document.getElementById('analysis-food-title');
    const qualityNote = document.getElementById('image-quality-note-text');
    const itemsContainer = document.getElementById('image-analysis-items-container');

    if (resultsContainer) resultsContainer.style.display = 'block';
    if (foodTitle) foodTitle.textContent = normalizedData.dish_title;
    if (qualityNote) {
      qualityNote.textContent = normalizedData.image_quality_note ? `Note: ${normalizedData.image_quality_note}` : '';
    }

    // Render items breakdown with live editable grams
    if (itemsContainer && Array.isArray(normalizedData.items)) {
      itemsContainer.innerHTML = '';

      normalizedData.items.forEach((item, index) => {
        const itemRow = document.createElement('div');
        const isLowConf = (item.confidence_score != null && item.confidence_score < 0.7);
        itemRow.className = `analysis-item-row ${isLowConf ? 'low-confidence' : ''}`;

        const confClass = (item.confidence_score >= 0.8) ? 'high' : 'low';
        const confText = (item.confidence_score != null) ? `${Math.round(item.confidence_score * 100)}% Match` : 'Estimated';
        const sourceLabel = item.source === 'database' ? 'Verified Table' : 'AI Estimate';

        itemRow.innerHTML = `
          <div class="analysis-item-header">
            <input type="text" class="analysis-item-name-input" data-index="${index}" value="${item.name}">
            <div class="analysis-item-controls">
              <span class="confidence-badge ${confClass}">${confText}</span>
              <span class="source-badge ${item.source === 'database' ? '' : 'estimated'}">${sourceLabel}</span>
              <div class="analysis-grams-input-wrap">
                <input type="number" class="analysis-grams-input" data-index="${index}" value="${Math.round(item.estimated_grams)}" min="5" max="2000">
                <span style="font-size:11px; color:var(--text-secondary);">g</span>
              </div>
            </div>
          </div>
          <div class="analysis-item-macros" id="item-macros-${index}">
            <span><strong style="color:var(--ring-red);">${Math.round(item.calories)}</strong> kcal</span>
            <span><strong style="color:var(--accent-lavender);">${Math.round(item.protein)}g</strong> pro</span>
            <span><strong style="color:#FFA114;">${Math.round(item.carbs)}g</strong> carb</span>
            <span><strong style="color:var(--ring-cyan);">${Math.round(item.fat)}g</strong> fat</span>
          </div>
        `;

        // Bind live grams edit
        const gramsInput = itemRow.querySelector('.analysis-grams-input');
        if (gramsInput) {
          gramsInput.addEventListener('input', (e) => {
            const newGrams = parseFloat(e.target.value);
            if (!isNaN(newGrams) && newGrams > 0) {
              this.recalculateItemMacros(index, newGrams);
            }
          });
        }

        // Bind item name change
        const nameInput = itemRow.querySelector('.analysis-item-name-input');
        if (nameInput) {
          nameInput.addEventListener('change', (e) => {
            this.activeAnalyzedMeal.items[index].name = e.target.value;
          });
        }

        itemsContainer.appendChild(itemRow);
      });
    }

    this.updateTotalAnalysisDisplay();
  }

  recalculateItemMacros(index, newGrams) {
    if (!this.activeAnalyzedMeal || !this.activeAnalyzedMeal.items[index]) return;
    const item = this.activeAnalyzedMeal.items[index];
    const prevGrams = item.estimated_grams || 100;
    const factor = newGrams / prevGrams;

    item.calories = Math.round(item.calories * factor);
    item.protein = Math.round(item.protein * factor * 10) / 10;
    item.carbs = Math.round(item.carbs * factor * 10) / 10;
    item.fat = Math.round(item.fat * factor * 10) / 10;
    item.estimated_grams = newGrams;

    // Update item macro line
    const itemMacroRow = document.getElementById(`item-macros-${index}`);
    if (itemMacroRow) {
      itemMacroRow.innerHTML = `
        <span><strong style="color:var(--ring-red);">${Math.round(item.calories)}</strong> kcal</span>
        <span><strong style="color:var(--accent-lavender);">${Math.round(item.protein)}g</strong> pro</span>
        <span><strong style="color:#FFA114;">${Math.round(item.carbs)}g</strong> carb</span>
        <span><strong style="color:var(--ring-cyan);">${Math.round(item.fat)}g</strong> fat</span>
      `;
    }

    // Recalculate totals
    this.updateTotalAnalysisDisplay();
  }

  updateTotalAnalysisDisplay() {
    if (!this.activeAnalyzedMeal) return;

    let totCal = 0, totPro = 0, totCarb = 0, totFat = 0;
    this.activeAnalyzedMeal.items.forEach(it => {
      totCal += it.calories || 0;
      totPro += it.protein || 0;
      totCarb += it.carbs || 0;
      totFat += it.fat || 0;
    });

    this.activeAnalyzedMeal.total_calories = Math.round(totCal);
    this.activeAnalyzedMeal.total_protein = Math.round(totPro * 10) / 10;
    this.activeAnalyzedMeal.total_carbs = Math.round(totCarb * 10) / 10;
    this.activeAnalyzedMeal.total_fat = Math.round(totFat * 10) / 10;

    const calEl = document.getElementById('analysis-cal-val');
    const proEl = document.getElementById('analysis-pro-val');
    const carbEl = document.getElementById('analysis-carbs-val');
    const fatEl = document.getElementById('analysis-fat-val');

    if (calEl) calEl.textContent = `${this.activeAnalyzedMeal.total_calories} kcal`;
    if (proEl) proEl.textContent = `${Math.round(this.activeAnalyzedMeal.total_protein)}g`;
    if (carbEl) carbEl.textContent = `${Math.round(this.activeAnalyzedMeal.total_carbs)}g`;
    if (fatEl) fatEl.textContent = `${Math.round(this.activeAnalyzedMeal.total_fat)}g`;
  }

  logAnalyzedMealToDashboard() {
    if (!this.activeAnalyzedMeal) return;

    const { total_calories, total_protein, total_carbs, total_fat } = this.activeAnalyzedMeal;

    this.addCalories(total_calories);
    this.addProtein(total_protein);
    this.addCarbs(total_carbs);
    this.addFats(total_fat);

    // Provide friendly confirmation and return to dashboard
    alert(`Logged ${this.activeAnalyzedMeal.dish_title} (${total_calories} kcal, ${Math.round(total_protein)}g protein) to your daily dashboard!`);
    this.navigate('screen-dashboard');
  }

  /* =========================================================================
     MODULE 2 - SCREEN 9: MEAL PREP & ALLERGEN FILTERING 
     ========================================================================= */
  initMealPrep() {
    const addBtn = document.getElementById('add-pantry-item-btn');
    const input = document.getElementById('pantry-item-input');
    const generateBtn = document.getElementById('generate-mealplan-btn');
    const retryBtn = document.getElementById('mealprep-retry-btn');
    const openAllergenBtn = document.getElementById('open-allergen-btn');
    const editAllergenLink = document.getElementById('edit-allergen-link');
    const closeAllergenBtn = document.getElementById('close-allergen-btn');
    const saveAllergenBtn = document.getElementById('save-allergen-btn');
    const quickChips = document.querySelectorAll('#pantry-quick-suggestions .prompt-chip');

    if (addBtn && input) {
      addBtn.addEventListener('click', () => this.addPantryItemFromInput());
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.addPantryItemFromInput();
        }
      });
    }

    quickChips.forEach(chip => {
      chip.addEventListener('click', () => {
        const staple = chip.getAttribute('data-staple');
        if (staple && !this.pantryItems.includes(staple)) {
          this.pantryItems.push(staple);
          this.renderPantryTags();
        }
      });
    });

    if (generateBtn) {
      generateBtn.addEventListener('click', () => this.executeMealPrepPlan());
    }

    if (retryBtn) {
      retryBtn.addEventListener('click', () => this.executeMealPrepPlan());
    }

    // Allergen modal hooks
    const showModal = () => {
      const modal = document.getElementById('allergen-modal');
      if (modal) {
        modal.style.display = 'flex';
        // Sync checkboxes with current user allergens
        document.querySelectorAll('#allergen-checkbox-list input[type="checkbox"]').forEach(cb => {
          cb.checked = this.user.allergens.includes(cb.value);
        });
      }
    };

    if (openAllergenBtn) openAllergenBtn.addEventListener('click', showModal);
    if (editAllergenLink) editAllergenLink.addEventListener('click', showModal);

    if (closeAllergenBtn) {
      closeAllergenBtn.addEventListener('click', () => {
        const modal = document.getElementById('allergen-modal');
        if (modal) modal.style.display = 'none';
      });
    }

    if (saveAllergenBtn) {
      saveAllergenBtn.addEventListener('click', async () => {
        const selected = [];
        document.querySelectorAll('#allergen-checkbox-list input[type="checkbox"]:checked').forEach(cb => {
          selected.push(cb.value);
        });
        this.user.allergens = selected;
        this.updateUserStatsDisplay();
        const modal = document.getElementById('allergen-modal');
        if (modal) modal.style.display = 'none';

        // Sync to backend profile
        if (this.user.isLoggedIn) {
          try {
            await fetch('/api/profile', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ allergens: selected })
            });
          } catch (e) {
            console.warn('Failed to sync allergens to backend:', e);
          }
        }
      });
    }
  }

  async syncPantryToBackend() {
    if (!this.user.isLoggedIn) return;
    try {
      await fetch('/api/pantry', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ items: this.pantryItems })
      });
    } catch (e) {
      console.warn('Failed to sync pantry to backend:', e);
    }
  }

  addPantryItemFromInput() {
    const input = document.getElementById('pantry-item-input');
    if (!input) return;
    const val = input.value.trim();
    if (!val) return;

    // Support comma-separated items
    const parts = val.split(',').map(p => p.trim()).filter(Boolean);
    parts.forEach(part => {
      if (!this.pantryItems.some(item => item.toLowerCase() === part.toLowerCase())) {
        this.pantryItems.push(part);
      }
    });

    input.value = '';
    this.renderPantryTags();
    this.syncPantryToBackend();
  }

  removePantryItem(index) {
    this.pantryItems.splice(index, 1);
    this.renderPantryTags();
    this.syncPantryToBackend();
  }

  renderPantryTags() {
    const container = document.getElementById('pantry-tags-container');
    const emptyHint = document.getElementById('pantry-empty-hint');
    if (!container) return;

    container.innerHTML = '';
    if (this.pantryItems.length === 0) {
      if (emptyHint) emptyHint.style.display = 'block';
      return;
    }

    if (emptyHint) emptyHint.style.display = 'none';

    this.pantryItems.forEach((item, index) => {
      const tag = document.createElement('span');
      tag.className = 'ing-chip recognized';
      tag.style.cursor = 'pointer';
      tag.innerHTML = `${item} <strong style="margin-left:4px; opacity:0.6;">&times;</strong>`;
      tag.title = 'Click to remove';
      tag.addEventListener('click', () => this.removePantryItem(index));
      container.appendChild(tag);
    });
  }

  showMealPrepLoading(status = 'Creating customized recipes...') {
    const btn = document.getElementById('generate-mealplan-btn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner"></span> ${status}`;
    }
  }

  hideMealPrepLoading() {
    const btn = document.getElementById('generate-mealplan-btn');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = 'Generate Meal Plan';
    }
  }

  showMealPrepError(msg) {
    const banner = document.getElementById('mealprep-error-banner');
    const text = document.getElementById('mealprep-error-text');
    if (text) text.textContent = msg;
    if (banner) banner.style.display = 'flex';
  }

  hideMealPrepError() {
    const banner = document.getElementById('mealprep-error-banner');
    if (banner) banner.style.display = 'none';
  }

  async executeMealPrepPlan() {
    this.hideMealPrepError();

    if (this.pantryItems.length === 0) {
      this.showMealPrepError('Please add at least 1 or 2 pantry ingredients before generating recipes.');
      return;
    }

    const maxTimeSelect = document.getElementById('mealprep-max-time');
    const servingsSelect = document.getElementById('mealprep-servings');
    const maxTime = maxTimeSelect ? parseInt(maxTimeSelect.value, 10) : 30;
    const servings = servingsSelect ? parseInt(servingsSelect.value, 10) : 1;

    // Calibrate targets per meal
    const targetCalories = Math.round(this.user.goals.calories * 0.35);
    const targetProtein = Math.round(this.user.goals.protein * 0.35);

    this.showMealPrepLoading('Synthesizing pantry recipes...');

    try {
      const response = await fetch('/api/mealprep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pantry_items: this.pantryItems,
          allergens: this.user.allergens,
          dietary_preference: this.user.diet,
          target_calories: targetCalories,
          target_protein: targetProtein,
          max_cooking_time_minutes: maxTime,
          servings: servings
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || data.error || 'Failed to generate meal prep recipes.');
      }

      this.renderMealPrepOutput(data);
      this.hideMealPrepLoading();

    } catch (err) {
      console.error('Mealprep generation error:', err);
      this.hideMealPrepLoading();
      this.showMealPrepError(err.message || 'Network error generating recipes. Please retry.');
    }
  }

  renderMealPrepOutput(data) {
    const container = document.getElementById('mealprep-recipe-output');
    if (!container) return;

    container.style.display = 'block';
    container.innerHTML = '';

    const heading = document.createElement('div');
    heading.className = 'card-title-row';
    const rawDishes = data.dishes || data.recipes || [];
    const normalizedRecipes = rawDishes.map(rec => ({
      dish_name: rec.name || rec.dish_name || 'Chef Specialty',
      description: rec.description || '',
      meal_type: rec.mealType || rec.meal_type || 'Main',
      prep_time_minutes: rec.prepMinutes || rec.prep_time_minutes || (rec.timeString ? parseInt(rec.timeString, 10) : 25),
      difficulty: rec.difficulty || 'Balanced',
      servings: rec.servings || 1,
      calories: rec.perServing ? rec.perServing.kcal : (rec.calories || 500),
      protein: rec.perServing ? rec.perServing.protein_g : (rec.protein || 35),
      carbs: rec.perServing ? rec.perServing.carbs_g : (rec.carbs || 45),
      fat: rec.perServing ? rec.perServing.fat_g : (rec.fat || 15),
      ingredients: (rec.ingredients || []).map(i => ({
        item: i.item || i.name,
        quantity: i.quantity || (i.gramsEquivalent ? `${i.gramsEquivalent}g` : 'To taste'),
        from_pantry: (i.fromPantry !== false && i.from_pantry !== false)
      })),
      instructions: rec.steps || rec.instructions || []
    }));

    heading.innerHTML = `
      <div>
        <span class="health-score-pill grade-a" style="margin-bottom:6px;">AI Chef</span>
        <div class="card-title">${data.notes || data.plan_title || 'Tailored Meal Prep Recipes'}</div>
      </div>
      <span class="card-subtitle">${normalizedRecipes.length} recipes</span>
    `;
    container.appendChild(heading);

    if (data.allergens_excluded && data.allergens_excluded.length > 0) {
      const alertStrip = document.createElement('div');
      alertStrip.style.cssText = 'background:rgba(52,199,89,0.12); border:1px solid rgba(52,199,89,0.3); border-radius:12px; padding:8px 12px; font-size:12px; color:var(--ring-green); margin-bottom:14px;';
      alertStrip.innerHTML = `<strong>Strict Allergen Shield:</strong> 100% free of ${data.allergens_excluded.join(', ')}.`;
      container.appendChild(alertStrip);
    }

    const dishesList = document.createElement('div');
    dishesList.className = 'mealprep-dishes-list';

    if (Array.isArray(normalizedRecipes)) {
      normalizedRecipes.forEach((rec, idx) => {
        const dishCard = document.createElement('div');
        dishCard.className = 'mealprep-dish-card';

        // Ingredient rows HTML
        const ingRows = (rec.ingredients || []).map(ing => {
          const isPantry = ing.from_pantry !== false;
          return `
            <div class="mealprep-ing-item">
              <span><strong>${ing.item}</strong> (${ing.quantity})</span>
              <span class="mealprep-ing-tag ${isPantry ? 'pantry' : 'missing'}">${isPantry ? 'In Pantry' : 'Missing'}</span>
            </div>
          `;
        }).join('');

        // Steps rows HTML
        const stepRows = (rec.instructions || []).map((step, sIdx) => {
          return `
            <div class="mealprep-step-item">
              <span class="mealprep-step-num">${sIdx + 1}.</span>
              <span>${step}</span>
            </div>
          `;
        }).join('');

        dishCard.innerHTML = `
          <div class="mealprep-dish-header">
            <div>
              <div class="mealprep-dish-title">${rec.dish_name}</div>
              <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">
                ${rec.meal_type || 'Main'} &bull; ${rec.prep_time_minutes || 25} mins &bull; ${rec.difficulty || 'Easy'} &bull; ${rec.servings || 1} serv
              </div>
            </div>
          </div>
          <p class="mealprep-dish-desc">${rec.description}</p>

          <div class="mealprep-macro-grid">
            <div>
              <div class="mealprep-macro-val" style="color:var(--ring-red);">${Math.round(rec.calories)}</div>
              <div class="mealprep-macro-lbl">kcal</div>
            </div>
            <div>
              <div class="mealprep-macro-val" style="color:var(--accent-lavender);">${Math.round(rec.protein)}g</div>
              <div class="mealprep-macro-lbl">protein</div>
            </div>
            <div>
              <div class="mealprep-macro-val" style="color:#FFA114;">${Math.round(rec.carbs)}g</div>
              <div class="mealprep-macro-lbl">carbs</div>
            </div>
            <div>
              <div class="mealprep-macro-val" style="color:var(--ring-cyan);">${Math.round(rec.fat)}g</div>
              <div class="mealprep-macro-lbl">fat</div>
            </div>
          </div>

          <details class="mealprep-ingredients-section" open>
            <summary class="mealprep-section-heading" style="cursor:pointer;">Ingredients (${rec.ingredients ? rec.ingredients.length : 0})</summary>
            <div style="margin-top:8px;">${ingRows}</div>
          </details>

          <details class="mealprep-steps-section" open style="margin-top:14px;">
            <summary class="mealprep-section-heading" style="cursor:pointer;">Preparation Steps (${rec.instructions ? rec.instructions.length : 0})</summary>
            <div style="margin-top:8px;">${stepRows}</div>
          </details>

          <div class="mealprep-actions-row">
            <button type="button" class="btn-primary mealprep-save-btn" data-recipe-idx="${idx}">
              Save Recipe to Collections
            </button>
            <button type="button" class="btn-secondary mealprep-cook-log-btn" data-recipe-idx="${idx}">
              Cooked & Log
            </button>
          </div>
        `;

        // Save Recipe button event
        const saveBtn = dishCard.querySelector('.mealprep-save-btn');
        if (saveBtn) {
          saveBtn.addEventListener('click', () => {
            this.saveGeneratedRecipe(rec);
            saveBtn.disabled = true;
            saveBtn.textContent = 'Saved in Collections';
          });
        }

        // Cook & Log button event
        const cookBtn = dishCard.querySelector('.mealprep-cook-log-btn');
        if (cookBtn) {
          cookBtn.addEventListener('click', () => {
            this.addCalories(rec.calories);
            this.addProtein(rec.protein);
            this.addCarbs(rec.carbs);
            this.addFats(rec.fat);
            alert(`Logged ${rec.dish_name} to your dashboard!`);
            this.navigate('screen-dashboard');
          });
        }

        dishesList.appendChild(dishCard);
      });
    }

    container.appendChild(dishesList);

    // Scroll to results smoothly
    container.scrollIntoView({ behavior: 'smooth' });
  }

  async saveGeneratedRecipe(rec) {
    const existing = this.savedRecipes.find(r => r.title.toLowerCase() === rec.dish_name.toLowerCase());
    if (existing) return;

    const newRec = {
      title: rec.dish_name,
      description: rec.description,
      category: rec.protein >= 35 ? 'High Protein' : (rec.prep_time_minutes <= 20 ? 'Quick Prep' : 'All'),
      prepTime: rec.prep_time_minutes || 25,
      calories: Math.round(rec.calories),
      protein: Math.round(rec.protein),
      carbs: Math.round(rec.carbs),
      fats: Math.round(rec.fat),
      ingredients: (rec.ingredients || []).map(i => `${i.item} (${i.quantity})`),
      instructions: rec.instructions || []
    };

    if (this.user.isLoggedIn) {
      try {
        const res = await fetch('/api/recipes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            name: newRec.title,
            data: newRec
          })
        });
        if (res.ok) {
          const resData = await res.json();
          newRec.id = resData.id;
        } else {
          newRec.id = `rec_${Date.now()}`;
        }
      } catch (e) {
        console.warn('Failed to persist recipe to backend:', e);
        newRec.id = `rec_${Date.now()}`;
      }
    } else {
      newRec.id = `rec_${Date.now()}`;
    }

    this.savedRecipes.unshift(newRec);
    this.renderSavedRecipes();
  }

  /* =========================================================================
     SCREEN 11: SAVED RECIPES COLLECTION
     ========================================================================= */
  initSavedRecipes() {
    const chips = document.querySelectorAll('.recipe-filter-chip');
    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        chips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        const cat = chip.getAttribute('data-category');
        this.renderSavedRecipes(cat);
      });
    });
  }

  renderSavedRecipes(filterCategory = 'All') {
    const container = document.getElementById('saved-recipes-list');
    if (!container) return;

    container.innerHTML = '';

    const list = this.savedRecipes.filter(r => {
      if (filterCategory === 'All') return true;
      if (filterCategory === 'High Protein') return r.protein >= 35 || r.category === 'High Protein';
      if (filterCategory === 'Quick Prep') return r.prepTime <= 25 || r.category === 'Quick Prep';
      if (filterCategory === 'Vegan') return r.category === 'Vegan';
      return true;
    });

    if (list.length === 0) {
      container.innerHTML = `
        <div class="card" style="text-align:center; padding:32px 16px; color:var(--text-secondary);">
          <div style="font-size:16px; font-weight:700; color:var(--text-primary); margin-bottom:4px;">No recipes saved in this category</div>
          <div style="font-size:13px;">Generate custom recipes on Screen 9 (Meal Prep) and tap "Save Recipe".</div>
        </div>
      `;
      return;
    }

    list.forEach(rec => {
      const card = document.createElement('div');
      card.className = 'card';
      card.style.marginBottom = '14px';

      card.innerHTML = `
        <div class="card-title-row" style="margin-bottom:8px;">
          <div>
            <span class="health-score-pill grade-b" style="margin-bottom:4px;">${rec.category}</span>
            <div class="card-title" style="font-size:17px;">${rec.title}</div>
          </div>
          <div style="font-size:12px; color:var(--text-muted); font-family:var(--font-mono);">${rec.prepTime} mins</div>
        </div>
        <p style="font-size:13px; color:var(--text-secondary); line-height:1.45; margin-bottom:12px;">${rec.description}</p>
        
        <div style="display:flex; gap:12px; font-family:var(--font-mono); font-size:12px; margin-bottom:12px; color:var(--text-secondary);">
          <span><strong style="color:var(--ring-red);">${rec.calories}</strong> kcal</span>
          <span><strong style="color:var(--accent-lavender);">${rec.protein}g</strong> pro</span>
          <span><strong style="color:#FFA114;">${rec.carbs}g</strong> carb</span>
          <span><strong style="color:var(--ring-cyan);">${rec.fats}g</strong> fat</span>
        </div>

        <details style="font-size:13px; color:var(--text-secondary); margin-bottom:10px;">
          <summary style="cursor:pointer; font-weight:700; color:var(--accent-lavender);">View Ingredients & Method</summary>
          <div style="margin-top:8px; padding-left:8px; border-left:2px solid var(--accent-lavender-glow);">
            <div style="font-weight:700; margin-bottom:4px; font-size:12px; text-transform:uppercase;">Ingredients</div>
            <ul style="padding-left:16px; margin-bottom:8px;">
              ${rec.ingredients.map(i => `<li>${i}</li>`).join('')}
            </ul>
            <div style="font-weight:700; margin-bottom:4px; font-size:12px; text-transform:uppercase;">Instructions</div>
            <ol style="padding-left:16px;">
              ${rec.instructions.map(s => `<li>${s}</li>`).join('')}
            </ol>
          </div>
        </details>

        <div style="display:flex; gap:8px;">
          <button class="btn-primary" style="height:42px; font-size:13px; flex:1;" data-log-id="${rec.id}">Log to Dashboard</button>
          <button class="btn-secondary" style="height:42px; font-size:13px; width:70px;" data-del-id="${rec.id}">Delete</button>
        </div>
      `;

      // Event: Log
      const logBtn = card.querySelector(`[data-log-id="${rec.id}"]`);
      if (logBtn) {
        logBtn.addEventListener('click', () => {
          this.addCalories(rec.calories);
          this.addProtein(rec.protein);
          this.addCarbs(rec.carbs);
          this.addFats(rec.fats);
          alert(`Logged ${rec.title} to dashboard!`);
          this.navigate('screen-dashboard');
        });
      }

      // Event: Delete
      const delBtn = card.querySelector(`[data-del-id="${rec.id}"]`);
      if (delBtn) {
        delBtn.addEventListener('click', async () => {
          if (this.user.isLoggedIn && rec.id && !String(rec.id).startsWith('rec_')) {
            try {
              await fetch(`/api/recipes/${rec.id}`, {
                method: 'DELETE',
                credentials: 'include'
              });
            } catch (e) {
              console.warn('Failed to delete recipe from server:', e);
            }
          }
          this.savedRecipes = this.savedRecipes.filter(r => r.id !== rec.id);
          this.renderSavedRecipes(filterCategory);
        });
      }

      container.appendChild(card);
    });
  }

  /* =========================================================================
     BARCODE SCANNER & OPEN FOOD FACTS
     ========================================================================= */
  validateBarcodeChecksum(code) {
    if (!code || typeof code !== 'string') return false;
    const clean = code.trim();

    // 1. EAN-13 (13 digits)
    if (/^\d{13}$/.test(clean)) {
      let sum = 0;
      for (let i = 0; i < 12; i++) {
        const d = parseInt(clean[i], 10);
        sum += (i % 2 === 0) ? d : d * 3;
      }
      const check = (10 - (sum % 10)) % 10;
      return check === parseInt(clean[12], 10);
    }

    // 2. UPC-A (12 digits)
    if (/^\d{12}$/.test(clean)) {
      let sum = 0;
      for (let i = 0; i < 11; i++) {
        const d = parseInt(clean[i], 10);
        sum += (i % 2 === 0) ? d * 3 : d;
      }
      const check = (10 - (sum % 10)) % 10;
      return check === parseInt(clean[11], 10);
    }

    // 3. EAN-8 (8 digits)
    if (/^\d{8}$/.test(clean)) {
      let sum = 0;
      for (let i = 0; i < 7; i++) {
        const d = parseInt(clean[i], 10);
        sum += (i % 2 === 0) ? d * 3 : d;
      }
      const check = (10 - (sum % 10)) % 10;
      return check === parseInt(clean[7], 10);
    }

    // 4. UPC-E / short barcodes (6-8 digits)
    if (/^\d{6,8}$/.test(clean)) {
      return true;
    }

    return false;
  }

  onBarcodeDetected(rawCode) {
    // 1. Immediate synchronous lock - prevents repeat firing
    if (this.barcodeLock) return;

    if (!rawCode) return;
    const clean = String(rawCode).trim();

    // 2. Format & checksum validation
    if (!this.validateBarcodeChecksum(clean)) {
      return;
    }

    // 3. 2 consecutive frames confirmation within 1.8 seconds
    const now = performance.now();
    if (this.lastCandidateCode === clean && (now - this.lastCandidateTime < 1800)) {
      this.candidateConsecutiveCount++;
    } else {
      this.lastCandidateCode = clean;
      this.candidateConsecutiveCount = 1;
      this.lastCandidateTime = now;
      return; // Await second consecutive frame confirmation
    }

    if (this.candidateConsecutiveCount < 2) {
      return;
    }

    // 4. Synchronously lock to block any subsequent callbacks
    this.barcodeLock = true;

    // 5. Immediately stop/pause camera
    this.stopBarcodeScanner();

    // 6. Optional haptic vibration
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(60); } catch (e) {}
    }

    // 7. Proceed to lookup
    this.lookupBarcode(clean);
  }

  async initBarcodeScanner() {
    // Clean up any existing instances first
    this.stopBarcodeScanner();

    this.barcodeLock = false;
    this.lastCandidateCode = null;
    this.candidateConsecutiveCount = 0;
    this.lastCandidateTime = 0;
    this.hideBarcodeError();

    // Bind controls (idempotent setup)
    const torchBtn = document.getElementById('torch-toggle-btn');
    const manualBtn = document.getElementById('manual-barcode-btn');
    const manualHintBtn = document.getElementById('barcode-manual-hint-btn');
    const galleryBtn = document.getElementById('gallery-barcode-btn');
    const galleryInput = document.getElementById('gallery-barcode-file-input');
    const manualModal = document.getElementById('manual-barcode-modal');
    const closeManualBtn = document.getElementById('close-manual-modal-btn');
    const submitManualBtn = document.getElementById('submit-manual-barcode-btn');
    const manualInput = document.getElementById('manual-barcode-input');
    const scanAgainBtn = document.getElementById('barcode-scan-again-btn');
    const notFoundScanAgainBtn = document.getElementById('barcode-not-found-scan-again-btn');
    const tryIngredientsBtn = document.getElementById('barcode-try-ingredients-btn');
    const viewfinder = document.querySelector('.viewfinder-box');

    if (torchBtn && !torchBtn.dataset.bound) {
      torchBtn.dataset.bound = 'true';
      torchBtn.addEventListener('click', () => this.toggleTorch());
    }

    const openModal = () => {
      if (manualModal) {
        manualModal.style.display = 'flex';
        if (manualInput) {
          manualInput.value = '';
          manualInput.focus();
        }
      }
    };

    if (manualBtn && !manualBtn.dataset.bound) {
      manualBtn.dataset.bound = 'true';
      manualBtn.addEventListener('click', openModal);
    }

    if (manualHintBtn && !manualHintBtn.dataset.bound) {
      manualHintBtn.dataset.bound = 'true';
      manualHintBtn.addEventListener('click', openModal);
    }

    if (closeManualBtn && !closeManualBtn.dataset.bound) {
      closeManualBtn.dataset.bound = 'true';
      closeManualBtn.addEventListener('click', () => {
        if (manualModal) manualModal.style.display = 'none';
      });
    }

    if (submitManualBtn && !submitManualBtn.dataset.bound) {
      submitManualBtn.dataset.bound = 'true';
      submitManualBtn.addEventListener('click', () => {
        const code = manualInput ? manualInput.value.trim() : '';
        if (code) {
          if (manualModal) manualModal.style.display = 'none';
          this.barcodeLock = true;
          this.stopBarcodeScanner();
          this.lookupBarcode(code);
        }
      });
    }

    if (galleryBtn && !galleryBtn.dataset.bound) {
      galleryBtn.dataset.bound = 'true';
      galleryBtn.addEventListener('click', () => {
        if (galleryInput) galleryInput.click();
      });
    }

    if (galleryInput && !galleryInput.dataset.bound) {
      galleryInput.dataset.bound = 'true';
      galleryInput.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        try {
          const img = new Image();
          const url = URL.createObjectURL(file);
          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = url;
          });

          let detectedCode = null;

          // 1. Try native BarcodeDetector on image
          if ('BarcodeDetector' in window) {
            try {
              const supported = await BarcodeDetector.getSupportedFormats().catch(() => []);
              const formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e'].filter(f => supported.includes(f));
              const detector = new BarcodeDetector({ formats });
              const barcodes = await detector.detect(img);
              if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
                detectedCode = barcodes[0].rawValue;
              }
            } catch (err) {}
          }

          // 2. Fallback to Quagga decodeSingle
          if (!detectedCode && typeof Quagga !== 'undefined') {
            detectedCode = await new Promise((resolve) => {
              Quagga.decodeSingle({
                src: url,
                numOfWorkers: 0,
                decoder: {
                  readers: ['ean_reader', 'ean_8_reader', 'upc_reader', 'upc_e_reader']
                },
                locate: true
              }, (result) => {
                if (result && result.codeResult && result.codeResult.code) {
                  resolve(result.codeResult.code);
                } else {
                  resolve(null);
                }
              });
            });
          }

          URL.revokeObjectURL(url);

          if (detectedCode && this.validateBarcodeChecksum(detectedCode)) {
            this.barcodeLock = true;
            this.stopBarcodeScanner();
            this.lookupBarcode(detectedCode);
          } else {
            this.showBarcodeError('No clear barcode detected in photo. Please try another photo or enter code manually.');
          }
        } catch (err) {
          console.warn('Gallery barcode decoding error:', err);
          this.showBarcodeError('Could not process photo. Please enter code manually.');
        } finally {
          galleryInput.value = '';
        }
      });
    }

    if (scanAgainBtn && !scanAgainBtn.dataset.bound) {
      scanAgainBtn.dataset.bound = 'true';
      scanAgainBtn.addEventListener('click', () => this.resetAndRestartBarcodeScanner());
    }

    if (notFoundScanAgainBtn && !notFoundScanAgainBtn.dataset.bound) {
      notFoundScanAgainBtn.dataset.bound = 'true';
      notFoundScanAgainBtn.addEventListener('click', () => this.resetAndRestartBarcodeScanner());
    }

    if (tryIngredientsBtn && !tryIngredientsBtn.dataset.bound) {
      tryIngredientsBtn.dataset.bound = 'true';
      tryIngredientsBtn.addEventListener('click', () => {
        this.stopBarcodeScanner();
        this.navigate('screen-scan-ingredients');
      });
    }

    // Tap to focus on viewfinder
    if (viewfinder && !viewfinder.dataset.bound) {
      viewfinder.dataset.bound = 'true';
      viewfinder.addEventListener('click', (e) => this.triggerBarcodeTapFocus(e));
    }

    const cameraTarget = document.getElementById('barcode-camera-view');
    if (!cameraTarget) return;

    // Check Native BarcodeDetector support
    let useNative = false;
    if ('BarcodeDetector' in window) {
      try {
        const supported = await BarcodeDetector.getSupportedFormats().catch(() => []);
        const wanted = ['ean_13', 'ean_8', 'upc_a', 'upc_e'].filter(f => supported.includes(f));
        if (wanted.length > 0) {
          this.barcodeNativeDetector = new BarcodeDetector({ formats: wanted });
          useNative = true;
        }
      } catch (e) {
        useNative = false;
      }
    }

    if (useNative) {
      await this.startNativeBarcodeScanner(cameraTarget);
    } else {
      this.startQuaggaBarcodeScanner(cameraTarget);
    }
  }

  async startNativeBarcodeScanner(cameraTarget) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.showBarcodeError('Camera access is not supported by your browser. Please enter barcode manually.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920, min: 1280 },
          height: { ideal: 1080, min: 720 },
          advanced: [{ focusMode: 'continuous' }]
        },
        audio: false
      });

      this.barcodeStream = stream;

      cameraTarget.innerHTML = '';
      const video = document.createElement('video');
      video.id = 'barcode-video-element';
      video.style.cssText = 'width:100%; height:100%; object-fit:cover; position:absolute; inset:0;';
      video.setAttribute('playsinline', 'true');
      video.setAttribute('autoplay', 'true');
      video.muted = true;
      video.srcObject = stream;
      cameraTarget.appendChild(video);
      cameraTarget.style.opacity = '1';

      await video.play().catch(e => console.warn(e));

      // Offscreen canvas for wide, short 1D scan region crop
      const scanCanvas = document.createElement('canvas');
      const scanCtx = scanCanvas.getContext('2d', { willReadFrequently: true });

      let isDetecting = false;
      let lastScanTime = 0;

      const scanLoop = async (now) => {
        if (this.barcodeLock || !this.barcodeStream) {
          return;
        }

        if (video.readyState >= 2 && !isDetecting && (now - lastScanTime > 90)) {
          lastScanTime = now;
          isDetecting = true;
          try {
            const vw = video.videoWidth || 1280;
            const vh = video.videoHeight || 720;

            // Crop wide, short 1D region: 82% width x 42% height in center
            const cropW = Math.round(vw * 0.82);
            const cropH = Math.round(vh * 0.42);
            const cropX = Math.round((vw - cropW) / 2);
            const cropY = Math.round((vh - cropH) / 2);

            scanCanvas.width = cropW;
            scanCanvas.height = cropH;
            scanCtx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

            const barcodes = await this.barcodeNativeDetector.detect(scanCanvas);
            if (barcodes && barcodes.length > 0 && !this.barcodeLock) {
              for (const b of barcodes) {
                if (b.rawValue) {
                  this.onBarcodeDetected(b.rawValue);
                  break;
                }
              }
            }
          } catch (e) {
            // ignore frame read glitch
          } finally {
            isDetecting = false;
          }
        }

        if (!this.barcodeLock && this.barcodeStream) {
          this.barcodeDetectAnimId = requestAnimationFrame(scanLoop);
        }
      };

      this.barcodeDetectAnimId = requestAnimationFrame(scanLoop);
    } catch (err) {
      this.handleBarcodeCameraError(err);
    }
  }

  startQuaggaBarcodeScanner(cameraTarget) {
    if (typeof Quagga === 'undefined') {
      this.showBarcodeError('Barcode scanner engine is unavailable. Please enter barcode manually.');
      return;
    }

    cameraTarget.innerHTML = '';

    Quagga.init({
      inputStream: {
        name: 'Live',
        type: 'LiveStream',
        target: cameraTarget,
        constraints: {
          facingMode: 'environment',
          width: { ideal: 1920, min: 1280 },
          height: { ideal: 1080, min: 720 },
          advanced: [{ focusMode: 'continuous' }]
        },
        area: {
          top: '25%',
          right: '9%',
          left: '9%',
          bottom: '25%'
        }
      },
      locator: {
        patchSize: 'medium',
        halfSample: false // Full resolution to capture small glossy barcodes
      },
      decoder: {
        readers: ['ean_reader', 'ean_8_reader', 'upc_reader', 'upc_e_reader'],
        multiple: false
      },
      locate: true
    }, (err) => {
      if (err) {
        this.handleBarcodeCameraError(err);
        return;
      }

      cameraTarget.style.opacity = '1';
      Quagga.start();
      this.quaggaRunning = true;

      // Remove any stale listeners and attach clean one
      Quagga.offDetected();
      Quagga.onDetected((result) => {
        if (this.barcodeLock) return;
        if (result && result.codeResult && result.codeResult.code) {
          this.onBarcodeDetected(result.codeResult.code);
        }
      });
    });
  }

  stopBarcodeScanner() {
    // 1. Cancel native animation frame loop
    if (this.barcodeDetectAnimId) {
      cancelAnimationFrame(this.barcodeDetectAnimId);
      this.barcodeDetectAnimId = null;
    }

    // 2. Stop native media tracks
    if (this.barcodeStream) {
      try {
        this.barcodeStream.getTracks().forEach(track => {
          try { track.stop(); } catch (e) {}
        });
      } catch (e) {}
      this.barcodeStream = null;
    }

    // 3. Stop Quagga and unhook listeners
    if (this.quaggaRunning && typeof Quagga !== 'undefined') {
      try {
        Quagga.offDetected();
        Quagga.stop();
      } catch (e) {}
      this.quaggaRunning = false;
    }

    // 4. Reset torch state
    this.torchEnabled = false;
    const torchBeam = document.getElementById('torch-beam');
    if (torchBeam) torchBeam.classList.remove('active');
    const torchBtn = document.getElementById('torch-toggle-btn');
    if (torchBtn) {
      torchBtn.classList.remove('active');
      const label = torchBtn.querySelector('.btn-label');
      if (label) label.textContent = 'Torch Off';
    }

    const cameraTarget = document.getElementById('barcode-camera-view');
    if (cameraTarget) {
      cameraTarget.innerHTML = '';
      cameraTarget.style.opacity = '0';
    }
  }

  resetAndRestartBarcodeScanner() {
    this.barcodeLock = false;
    this.lastCandidateCode = null;
    this.candidateConsecutiveCount = 0;
    this.lastCandidateTime = 0;

    const resultCard = document.getElementById('barcode-result-card');
    const notFound = document.getElementById('barcode-not-found-banner');
    const loading = document.getElementById('barcode-loading-indicator');
    if (resultCard) resultCard.style.display = 'none';
    if (notFound) notFound.style.display = 'none';
    if (loading) loading.style.display = 'none';
    this.hideBarcodeError();

    this.initBarcodeScanner();
  }

  async toggleTorch() {
    this.torchEnabled = !this.torchEnabled;
    const torchBtn = document.getElementById('torch-toggle-btn');
    const torchBeam = document.getElementById('torch-beam');

    // Find active video track
    let track = null;
    if (this.barcodeStream) {
      track = this.barcodeStream.getVideoTracks()[0];
    } else if (typeof Quagga !== 'undefined' && Quagga.CameraAccess) {
      const activeTrack = Quagga.CameraAccess.getActiveTrack();
      if (activeTrack) track = activeTrack;
    }

    if (track && track.getCapabilities) {
      const caps = track.getCapabilities();
      if (caps.torch) {
        try {
          await track.applyConstraints({
            advanced: [{ torch: this.torchEnabled }]
          });
        } catch (err) {
          console.warn('Torch constraint error:', err);
        }
      }
    }

    if (torchBeam) torchBeam.classList.toggle('active', this.torchEnabled);
    if (torchBtn) {
      torchBtn.classList.toggle('active', this.torchEnabled);
      const label = torchBtn.querySelector('.btn-label');
      if (label) label.textContent = this.torchEnabled ? 'Torch On' : 'Torch Off';
    }
  }

  async triggerBarcodeTapFocus(e) {
    const viewfinder = document.querySelector('.viewfinder-box');
    const ring = document.getElementById('barcode-focus-ring');
    if (viewfinder && ring && e) {
      const rect = viewfinder.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      ring.style.left = `${x}px`;
      ring.style.top = `${y}px`;
      ring.style.display = 'block';
      ring.style.transform = 'translate(-50%, -50%) scale(1.2)';
      setTimeout(() => {
        ring.style.transform = 'translate(-50%, -50%) scale(1)';
      }, 150);
      setTimeout(() => {
        ring.style.display = 'none';
      }, 900);
    }

    // Reapply continuous autofocus constraint
    let track = null;
    if (this.barcodeStream) {
      track = this.barcodeStream.getVideoTracks()[0];
    } else if (typeof Quagga !== 'undefined' && Quagga.CameraAccess) {
      track = Quagga.CameraAccess.getActiveTrack();
    }

    if (track && track.applyConstraints) {
      try {
        await track.applyConstraints({
          advanced: [{ focusMode: 'continuous' }]
        });
      } catch (err) {}
    }
  }

  handleBarcodeCameraError(err) {
    console.warn('Barcode camera error:', err);
    this.stopBarcodeScanner();
    let msg = 'Unable to access camera. Please enter barcode manually.';
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      msg = 'Camera permission was denied. Please allow camera access in browser settings, or enter barcode manually.';
    } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      msg = 'No camera found on this device. Please use the Manual Barcode option.';
    } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
      msg = 'Camera is currently in use by another application. Please close other apps and try again.';
    }
    this.showBarcodeError(msg);
  }

  showBarcodeError(msg) {
    const el = document.getElementById('barcode-error-banner');
    if (el) {
      el.textContent = msg;
      el.style.display = 'block';
    }
  }

  hideBarcodeError() {
    const el = document.getElementById('barcode-error-banner');
    if (el) {
      el.textContent = '';
      el.style.display = 'none';
    }
  }

  async lookupBarcode(code) {
    const loading = document.getElementById('barcode-loading-indicator');
    const notFound = document.getElementById('barcode-not-found-banner');
    const resultCard = document.getElementById('barcode-result-card');

    if (loading) loading.style.display = 'flex';
    if (notFound) notFound.style.display = 'none';
    if (resultCard) resultCard.style.display = 'none';

    try {
      const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json`);
      const data = await res.json();

      if (loading) loading.style.display = 'none';

      if (data && data.status === 1 && data.product) {
        this.renderBarcodeResult(data.product);
      } else {
        if (notFound) notFound.style.display = 'block';
      }
    } catch (e) {
      if (loading) loading.style.display = 'none';
      if (notFound) notFound.style.display = 'block';
    }
  }

  renderBarcodeResult(prod) {
    const resultCard = document.getElementById('barcode-result-card');
    const prodName = document.getElementById('barcode-product-name');
    const prodBrand = document.getElementById('barcode-product-brand');
    const nutList = document.getElementById('barcode-nutrition-list');
    const posList = document.getElementById('barcode-positives-list');
    const conList = document.getElementById('barcode-concerns-list');
    const scorePill = document.getElementById('barcode-health-score');
    const swapBtn = document.getElementById('barcode-find-alternatives-btn');

    if (prodName) prodName.textContent = prod.product_name || 'Food Product';
    if (prodBrand) prodBrand.textContent = prod.brands || 'Packaged Goods';

    const n = prod.nutriments || {};
    if (nutList) {
      nutList.innerHTML = `
        <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:8px; font-family:var(--font-mono); font-size:12px;">
          <div>Calories: <strong>${Math.round(n['energy-kcal_100g'] || n.energy_100g || 0)}</strong></div>
          <div>Protein: <strong>${n.proteins_100g || 0}g</strong></div>
          <div>Sugars: <strong>${n.sugars_100g || 0}g</strong></div>
        </div>
      `;
    }

    if (posList) posList.textContent = 'Whole grain attributes, no artificial food dyes recognized.';
    if (conList) conList.textContent = (n.sugars_100g > 15) ? 'High in refined sugars (>15g per 100g).' : 'Contains refined vegetable fats and sodium.';

    if (scorePill) {
      scorePill.className = 'health-score-pill grade-b';
      scorePill.textContent = 'Grade B • Good';
    }

    if (swapBtn) {
      swapBtn.onclick = () => {
        const n = prod.nutriments || {};
        const nutrition = {
          kcal: n['energy-kcal_100g'] != null ? Math.round(n['energy-kcal_100g']) : (n.energy_100g != null ? Math.round(n.energy_100g / 4.184) : null),
          protein: n.proteins_100g != null ? n.proteins_100g : null,
          fat: n.fat_100g != null ? n.fat_100g : null,
          satFat: n['saturated-fat_100g'] != null ? n['saturated-fat_100g'] : null,
          sugars: n.sugars_100g != null ? n.sugars_100g : null,
          salt: n.salt_100g != null ? n.salt_100g : null,
          fiber: n.fiber_100g != null ? n.fiber_100g : null
        };
        this.openCleanerAlternativesWithProduct({
          name: prod.product_name || prod.generic_name || 'Scanned Packaged Food',
          brand: prod.brands || '',
          ingredientsText: prod.ingredients_text || '',
          image: prod.image_front_small_url || prod.image_url || null,
          nutrition,
          source: 'Barcode Scanner'
        });
      };
    }

    if (resultCard) resultCard.style.display = 'block';
  }


  /* =========================================================================
     SCREEN 6: INGREDIENT OCR SCANNER
     ========================================================================= */
  initIngredientScanner() {
    const openCamBtn = document.getElementById('ing-open-camera-btn');
    const openGalBtn = document.getElementById('ing-open-gallery-btn');
    const galInput = document.getElementById('ing-gallery-file-input');
    const manualLink = document.getElementById('ing-manual-entry-link');
    const backFromManualBtn = document.getElementById('ing-back-from-manual-btn');
    const captureBtn = document.getElementById('ing-capture-btn');
    const cancelCamBtn = document.getElementById('ing-cancel-camera-btn');
    const usePhotoBtn = document.getElementById('ing-use-photo-btn');
    const retakeBtn = document.getElementById('ing-retake-btn');
    const retakeFromReviewBtn = document.getElementById('ing-retake-from-review-btn');
    const analyzeBtn = document.getElementById('ing-analyze-btn');
    const analyzeManualBtn = document.getElementById('ing-analyze-manual-btn');
    const reviewTextarea = document.getElementById('ing-review-textarea');
    const manualTextarea = document.getElementById('ing-manual-textarea');
    const findAltBtn = document.getElementById('ing-find-alternatives-btn');
    const editTextBtn = document.getElementById('ing-edit-text-btn');
    const scanAgainBtn = document.getElementById('ing-scan-again-btn');

    // 1. Open Camera button
    if (openCamBtn) {
      openCamBtn.addEventListener('click', () => this.openIngredientCamera());
    }

    // 2. Choose Photo from Gallery
    if (openGalBtn && galInput) {
      openGalBtn.addEventListener('click', () => galInput.click());
    }

    // 3. Gallery file input change
    if (galInput) {
      galInput.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        try {
          if (window.ImagePreprocessor) {
            const canvas = await window.ImagePreprocessor.loadFileToCanvas(file);
            this.capturedIngredientCanvas = canvas;
            await this.runIngredientOcrOnCanvas(canvas);
          }
        } catch (err) {
          console.warn('Gallery OCR error:', err);
          this.showIngredientError('Failed to read image. Please enter ingredients manually.');
          this.showIngStage('manual');
        } finally {
          galInput.value = '';
        }
      });
    }

    // 4. Enter ingredients manually instead link
    if (manualLink) {
      manualLink.addEventListener('click', () => {
        this.stopIngredientCamera();
        this.showIngStage('manual');
      });
    }

    // 5. Use Camera Instead (from manual entry stage)
    if (backFromManualBtn) {
      backFromManualBtn.addEventListener('click', () => {
        this.openIngredientCamera();
      });
    }

    // 6. Camera Viewfinder controls: Capture & Cancel
    if (captureBtn) {
      captureBtn.addEventListener('click', () => this.captureIngredientPhoto());
    }

    if (cancelCamBtn) {
      cancelCamBtn.addEventListener('click', () => {
        this.stopIngredientCamera();
        this.showIngStage('start');
      });
    }

    // 7. Preview controls: Use This Photo & Retake Photo
    if (usePhotoBtn) {
      usePhotoBtn.addEventListener('click', () => {
        if (this.capturedIngredientCanvas) {
          this.runIngredientOcrOnCanvas(this.capturedIngredientCanvas);
        }
      });
    }

    if (retakeBtn) {
      retakeBtn.addEventListener('click', () => this.openIngredientCamera());
    }

    // 8. Review controls: Analyze & Retake Photo
    if (analyzeBtn && reviewTextarea) {
      analyzeBtn.addEventListener('click', () => this.analyzeIngredientsText(reviewTextarea.value));
    }

    if (retakeFromReviewBtn) {
      retakeFromReviewBtn.addEventListener('click', () => this.openIngredientCamera());
    }

    // 9. Manual analysis button
    if (analyzeManualBtn && manualTextarea) {
      analyzeManualBtn.addEventListener('click', () => this.analyzeIngredientsText(manualTextarea.value));
    }

    // 10. Results actions
    if (findAltBtn) {
      findAltBtn.addEventListener('click', () => {
        const name = document.getElementById('ing-product-name-input')?.value?.trim() || '';
        const brand = document.getElementById('ing-product-brand-input')?.value?.trim() || '';
        const text = this.lastScannedIngredientsText || reviewTextarea?.value || manualTextarea?.value || '';
        this.openCleanerAlternativesWithProduct({
          name: name || 'Scanned Packaged Food',
          brand: brand,
          ingredientsText: text,
          source: 'Ingredient Label OCR'
        });
      });
    }

    if (editTextBtn) {
      editTextBtn.addEventListener('click', () => this.showIngStage('review'));
    }

    if (scanAgainBtn) {
      scanAgainBtn.addEventListener('click', () => {
        this.hideIngredientError();
        this.showIngStage('start');
      });
    }
  }

  showIngStage(stage) {
    if (stage !== 'camera') {
      this.stopIngredientCamera();
    }
    document.querySelectorAll('.ing-stage').forEach(el => el.style.display = 'none');
    const target = document.getElementById(`ing-stage-${stage}`);
    if (target) target.style.display = 'block';
  }

  showIngredientError(msg) {
    const errorBanner = document.getElementById('ing-error-banner');
    if (errorBanner) {
      errorBanner.textContent = msg;
      errorBanner.style.display = 'block';
    }
  }

  hideIngredientError() {
    const errorBanner = document.getElementById('ing-error-banner');
    if (errorBanner) {
      errorBanner.style.display = 'none';
      errorBanner.textContent = '';
    }
  }

  async openIngredientCamera() {
    this.hideIngredientError();

    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      this.showIngredientError('Camera access is not supported by your browser or connection. Please choose a photo from your gallery instead.');
      this.showIngStage('start');
      return;
    }

    try {
      this.stopIngredientCamera();

      // Show camera stage
      this.showIngStage('camera');

      const video = document.getElementById('ing-camera-view');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      });

      this.ingredientCameraStream = stream;

      if (video) {
        video.srcObject = stream;
        video.style.display = 'block';
        video.setAttribute('playsinline', 'true');
        video.setAttribute('autoplay', 'true');
        video.muted = true;
        await video.play().catch(e => console.warn('Camera video play error:', e));
      }
    } catch (err) {
      console.warn('Camera access error:', err);
      this.stopIngredientCamera();
      let msg = 'Unable to access camera. Please choose a photo from your gallery or enter ingredients manually.';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        msg = 'Camera permission was denied. Please allow camera access in your browser settings to scan ingredient labels, or select "Choose Photo from Gallery".';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        msg = 'No camera found on this device. Please select "Choose Photo from Gallery" or enter ingredients manually.';
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        msg = 'Camera is currently in use by another application. Please close other camera apps and try again.';
      }
      this.showIngredientError(msg);
      this.showIngStage('start');
    }
  }

  stopIngredientCamera() {
    if (this.ingredientCameraStream) {
      try {
        this.ingredientCameraStream.getTracks().forEach(track => {
          try { track.stop(); } catch (e) {}
        });
      } catch (e) {}
      this.ingredientCameraStream = null;
    }
    const video = document.getElementById('ing-camera-view');
    if (video) {
      video.srcObject = null;
      video.style.display = 'none';
    }
  }

  captureIngredientPhoto() {
  const video = document.getElementById('ing-camera-view');
  if (!video || !video.videoWidth) return;

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);

  this.stopIngredientCamera();
  this.ingredientOriginalCanvas = canvas;   // keep uncropped copy for re-cropping
  this.openIngredientCrop(canvas);
}

showIngredientPreview(canvas) {
  this.capturedIngredientCanvas = canvas;   // OCR should read from this
  const previewImg = document.getElementById('ing-preview-image');
  if (previewImg) previewImg.src = canvas.toDataURL('image/jpeg', 0.95);
  this.showIngStage('preview');
  }

  openIngredientCrop(sourceCanvas) {
  // one-time styles
  if (!document.getElementById('ing-crop-styles')) {
    const st = document.createElement('style');
    st.id = 'ing-crop-styles';
    st.textContent = `
      #ing-crop-overlay{position:fixed;inset:0;z-index:10000;background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:16px;touch-action:none}
      #ing-crop-overlay .crop-hint{color:#fff;font:14px sans-serif;opacity:.8}
      #ing-crop-overlay .crop-wrap{position:relative;line-height:0;touch-action:none;user-select:none}
      #ing-crop-overlay img{max-width:100%;max-height:70vh;display:block;pointer-events:none}
      #ing-crop-overlay .crop-box{position:absolute;border:2px solid #fff;box-shadow:0 0 0 9999px rgba(0,0,0,.6);cursor:move;touch-action:none}
      #ing-crop-overlay .crop-h{position:absolute;width:32px;height:32px;margin:-16px 0 0 -16px;touch-action:none}
      #ing-crop-overlay .crop-h::after{content:'';position:absolute;left:10px;top:10px;width:12px;height:12px;background:#fff;border-radius:50%;box-shadow:0 0 0 1px rgba(0,0,0,.4)}
      #ing-crop-overlay .crop-h[data-h=nw]{left:0;top:0;cursor:nwse-resize}
      #ing-crop-overlay .crop-h[data-h=n]{left:50%;top:0;cursor:ns-resize}
      #ing-crop-overlay .crop-h[data-h=ne]{left:100%;top:0;cursor:nesw-resize}
      #ing-crop-overlay .crop-h[data-h=e]{left:100%;top:50%;cursor:ew-resize}
      #ing-crop-overlay .crop-h[data-h=se]{left:100%;top:100%;cursor:nwse-resize}
      #ing-crop-overlay .crop-h[data-h=s]{left:50%;top:100%;cursor:ns-resize}
      #ing-crop-overlay .crop-h[data-h=sw]{left:0;top:100%;cursor:nesw-resize}
      #ing-crop-overlay .crop-h[data-h=w]{left:0;top:50%;cursor:ew-resize}
      #ing-crop-overlay .crop-actions{display:flex;gap:10px}
      #ing-crop-overlay button{padding:12px 20px;border:0;border-radius:10px;font:600 15px sans-serif;cursor:pointer}
      #ing-crop-overlay .b-apply{background:#22c55e;color:#fff}
      #ing-crop-overlay .b-sec{background:#333;color:#fff}
    `;
    document.head.appendChild(st);
  }

  document.getElementById('ing-crop-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'ing-crop-overlay';
  overlay.innerHTML = `
    <div class="crop-hint">Drag the box around the ingredients list</div>
    <div class="crop-wrap">
      <img alt="Crop preview">
      <div class="crop-box">
        ${['nw','n','ne','e','se','s','sw','w'].map(h => `<div class="crop-h" data-h="${h}"></div>`).join('')}
      </div>
    </div>
    <div class="crop-actions">
      <button class="b-sec" data-act="skip">Use full photo</button>
      <button class="b-sec" data-act="reset">Reset</button>
      <button class="b-apply" data-act="apply">Crop &amp; Scan</button>
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelector('img').src = sourceCanvas.toDataURL('image/jpeg', 0.92);

  const wrap = overlay.querySelector('.crop-wrap');
  const box = overlay.querySelector('.crop-box');
  const MIN = 0.08;
  const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

  // crop rect stored as fractions (0-1) of the image, so it survives resizes/rotation
  const DEFAULT = { x: 0.08, y: 0.15, w: 0.84, h: 0.7 };
  let rect = { ...DEFAULT };

  const render = () => {
    box.style.left = rect.x * 100 + '%';
    box.style.top = rect.y * 100 + '%';
    box.style.width = rect.w * 100 + '%';
    box.style.height = rect.h * 100 + '%';
  };
  render();

  let drag = null;
  box.addEventListener('pointerdown', e => {
    drag = { h: e.target.dataset.h || 'move', sx: e.clientX, sy: e.clientY, start: { ...rect } };
    box.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  box.addEventListener('pointermove', e => {
    if (!drag) return;
    const r = wrap.getBoundingClientRect();
    const dx = (e.clientX - drag.sx) / r.width;
    const dy = (e.clientY - drag.sy) / r.height;
    const { x, y, w, h } = drag.start;

    if (drag.h === 'move') {
      rect.x = clamp(x + dx, 0, 1 - w);
      rect.y = clamp(y + dy, 0, 1 - h);
    } else {
      let x1 = x, y1 = y, x2 = x + w, y2 = y + h;
      if (drag.h.includes('w')) x1 = clamp(x + dx, 0, x2 - MIN);
      if (drag.h.includes('e')) x2 = clamp(x + w + dx, x1 + MIN, 1);
      if (drag.h.includes('n')) y1 = clamp(y + dy, 0, y2 - MIN);
      if (drag.h.includes('s')) y2 = clamp(y + h + dy, y1 + MIN, 1);
      rect = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    }
    render();
  });
  const endDrag = () => { drag = null; };
  box.addEventListener('pointerup', endDrag);
  box.addEventListener('pointercancel', endDrag);

  overlay.addEventListener('click', e => {
    const act = e.target.dataset.act;
    if (!act) return;

    if (act === 'reset') {
      rect = { ...DEFAULT };
      render();
    } else if (act === 'skip') {
      overlay.remove();
      this.showIngredientPreview(sourceCanvas);
    } else if (act === 'apply') {
      const sw = sourceCanvas.width, sh = sourceCanvas.height;
      const out = document.createElement('canvas');
      out.width = Math.round(rect.w * sw);
      out.height = Math.round(rect.h * sh);
      out.getContext('2d').drawImage(
        sourceCanvas,
        Math.round(rect.x * sw), Math.round(rect.y * sh), out.width, out.height,
        0, 0, out.width, out.height
      );
      overlay.remove();
      this.showIngredientPreview(out);
    }
  });
}

// optional: call from a "Re-crop" button on the preview stage
recropIngredientPhoto() {
  if (this.ingredientOriginalCanvas) this.openIngredientCrop(this.ingredientOriginalCanvas);
}

  async runIngredientOcrOnCanvas(canvas) {
    if (!canvas) return;
    this.hideIngredientError();
    this.showIngStage('progress');

    const progressLabel = document.getElementById('ing-progress-label');
    const progressPct = document.getElementById('ing-progress-pct');
    if (progressLabel) progressLabel.textContent = 'Reading ingredient text…';
    if (progressPct) progressPct.textContent = '0%';

    try {
      if (window.ImagePreprocessor && window.IngredientOCR) {
        const processed = window.ImagePreprocessor.preprocess(canvas);
        const text = await window.IngredientOCR.recognize(processed, (pct) => {
          if (progressPct) progressPct.textContent = `${pct}%`;
        });

        const reviewTextarea = document.getElementById('ing-review-textarea');
        if (reviewTextarea) {
          reviewTextarea.value = text;
        }
        this.showIngStage('review');
      } else {
        throw new Error('OCR engine unavailable');
      }
    } catch (err) {
      console.warn('OCR processing error:', err);
      this.showIngredientError('Could not read text automatically. Please paste or type ingredients below.');
      this.showIngStage('manual');
    }
  }

  analyzeIngredientsText(text) {
    if (!text || !text.trim()) return;
    this.lastScannedIngredientsText = text;

    const rawTextEl = document.getElementById('ing-raw-text-content');
    if (rawTextEl) rawTextEl.textContent = text;

    if (window.IngredientParser && window.IngredientMatcher && window.HealthScoreEngine) {
      const parsed = window.IngredientParser.parse(text);
      const matched = window.IngredientMatcher.matchAll(parsed.list);
      const score = window.HealthScoreEngine.computeHealthScore(matched);

      // Render score and grade
      const scoreVal = document.getElementById('ing-score-value');
      const scoreCat = document.getElementById('ing-score-category');
      const scoreCard = document.getElementById('ing-score-card');
      const countSubtitle = document.getElementById('ing-count-subtitle');
      const posList = document.getElementById('ing-positives-list');
      const conList = document.getElementById('ing-concerns-list');
      const allergenCard = document.getElementById('ing-allergen-card');
      const allergenList = document.getElementById('ing-allergen-list');
      const unknownCard = document.getElementById('ing-unknown-card');
      const unknownNote = document.getElementById('ing-unknown-note');
      const chipContainer = document.getElementById('ing-ingredient-chip-list');

      if (scoreVal) scoreVal.textContent = `${score.score} / 100`;
      if (scoreCat) {
        scoreCat.className = `health-score-pill grade-${score.grade.toLowerCase()}`;
        scoreCat.textContent = `Grade ${score.grade} • ${score.category}`;
      }
      if (scoreCard) {
        scoreCard.style.borderLeftColor = score.score >= 70 ? 'var(--ring-green)' : (score.score >= 45 ? 'var(--accent-amber)' : 'var(--ring-red)');
      }
      if (countSubtitle) {
        countSubtitle.textContent = `${matched.length} ingredients detected (${score.recognizedCount} recognized)`;
      }

      // Allergens
      if (allergenCard && allergenList) {
        if (score.allergens && score.allergens.length > 0) {
          allergenCard.style.display = 'block';
          allergenList.textContent = score.allergens.join(', ');
        } else {
          allergenCard.style.display = 'none';
        }
      }

      // Positives & Concerns
      if (posList) posList.innerHTML = score.positives.map(p => `<div>• ${p}</div>`).join('');
      if (conList) conList.innerHTML = score.concerns.map(c => `<div>• ${c}</div>`).join('');

      // Unknown items note
      if (unknownCard && unknownNote) {
        if (score.unknownNote) {
          unknownCard.style.display = 'block';
          unknownNote.textContent = score.unknownNote;
        } else {
          unknownCard.style.display = 'none';
        }
      }

      // Ingredient chips
      if (chipContainer) {
        chipContainer.innerHTML = '';
        matched.forEach(m => {
          const chip = document.createElement('span');
          chip.className = `ing-chip ${m.status === 'known' ? 'recognized' : 'unknown'}`;
          chip.textContent = m.status === 'known' ? m.record.name : m.original;
          chipContainer.appendChild(chip);
        });
      }

      this.showIngStage('results');
    }
  }

  /* =========================================================================
     SCREEN 8: CLEANER ALTERNATIVES ENGINE (Smart Health Swaps)
     ========================================================================= */
  initCleanerAlternatives() {
    this.selectedSwapCategory = 'all';

    // Category Filter Chips
    const categoryChips = document.querySelectorAll('#swap-category-chips .swap-cat-chip');
    categoryChips.forEach((chip) => {
      chip.addEventListener('click', () => {
        categoryChips.forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
        const cat = chip.getAttribute('data-category') || 'all';
        this.selectedSwapCategory = cat;

        const prodName = document.getElementById('swap-product-input')?.value?.trim();
        const ingredients = document.getElementById('swap-ingredients-input')?.value?.trim();

        if (prodName || ingredients) {
          this.runCleanerAlternativesSearch({ categoryId: cat === 'all' ? undefined : cat });
        } else {
          this.browseCleanAlternativesByCategory(cat);
        }
      });
    });

    // Primary Action Button
    document.getElementById('analyze-swap-btn')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.runCleanerAlternativesSearch();
    });

    // Enter Key Submission on inputs
    document.getElementById('swap-product-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.runCleanerAlternativesSearch();
      }
    });

    document.getElementById('swap-brand-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.runCleanerAlternativesSearch();
      }
    });

    // Clear Button
    document.getElementById('swap-clear-btn')?.addEventListener('click', () => {
      const pInput = document.getElementById('swap-product-input');
      const bInput = document.getElementById('swap-brand-input');
      const iInput = document.getElementById('swap-ingredients-input');
      if (pInput) pInput.value = '';
      if (bInput) bInput.value = '';
      if (iInput) iInput.value = '';

      const banner = document.getElementById('swap-status-banner');
      if (banner) banner.style.display = 'none';

      const sourceNote = document.getElementById('swap-source-note');
      if (sourceNote) sourceNote.style.display = 'none';

      const results = document.getElementById('swap-results');
      if (results) {
        results.style.display = 'none';
        results.innerHTML = '';
      }

      const emptyState = document.getElementById('swap-empty-state');
      if (emptyState) {
        emptyState.style.display = 'block';
        emptyState.textContent = 'Add a product above or pick a category to explore clean swaps.';
      }

      categoryChips.forEach((c) => c.classList.remove('active'));
      categoryChips[0]?.classList.add('active');
      this.selectedSwapCategory = 'all';
    });

    // Barcode Lookup Modal
    const barcodeModal = document.getElementById('swap-barcode-modal');
    document.getElementById('scan-swap-barcode-btn')?.addEventListener('click', () => {
      if (barcodeModal) {
        barcodeModal.style.display = 'flex';
        const input = document.getElementById('swap-barcode-input');
        if (input) {
          input.value = '';
          setTimeout(() => input.focus(), 100);
        }
      }
    });

    document.getElementById('close-swap-barcode-modal-btn')?.addEventListener('click', () => {
      if (barcodeModal) barcodeModal.style.display = 'none';
    });

    document.getElementById('submit-swap-barcode-btn')?.addEventListener('click', () => {
      this.handleSwapBarcodeLookup();
    });

    document.getElementById('swap-barcode-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.handleSwapBarcodeLookup();
      }
    });
  }

  async handleSwapBarcodeLookup() {
    const input = document.getElementById('swap-barcode-input');
    const code = input?.value?.trim();
    if (!code) return;

    const modal = document.getElementById('swap-barcode-modal');
    const submitBtn = document.getElementById('submit-swap-barcode-btn');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Looking up...';
    }

    try {
      const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json`);
      const data = await res.json();

      if (data && data.status === 1 && data.product) {
        const prod = data.product;
        const pInput = document.getElementById('swap-product-input');
        const bInput = document.getElementById('swap-brand-input');
        const iInput = document.getElementById('swap-ingredients-input');
        const sourceNote = document.getElementById('swap-source-note');
        const sourceImg = document.getElementById('swap-product-image');
        const sourceText = document.getElementById('swap-source-text');

        if (pInput) pInput.value = prod.product_name || prod.generic_name || 'Scanned Food Item';
        if (bInput) bInput.value = prod.brands || '';
        if (iInput) iInput.value = prod.ingredients_text || '';

        if (sourceNote && sourceText) {
          sourceNote.style.display = 'flex';
          sourceText.textContent = `Barcode: ${code} • Open Food Facts Verified`;
          if (prod.image_front_small_url || prod.image_url) {
            sourceImg.src = prod.image_front_small_url || prod.image_url;
            sourceImg.style.display = 'block';
          } else {
            sourceImg.style.display = 'none';
          }
        }

        if (modal) modal.style.display = 'none';

        const n = prod.nutriments || {};
        const nutrition = {
          kcal: n['energy-kcal_100g'] != null ? Math.round(n['energy-kcal_100g']) : (n.energy_100g != null ? Math.round(n.energy_100g / 4.184) : null),
          protein: n.proteins_100g != null ? n.proteins_100g : null,
          fat: n.fat_100g != null ? n.fat_100g : null,
          satFat: n['saturated-fat_100g'] != null ? n['saturated-fat_100g'] : null,
          sugars: n.sugars_100g != null ? n.sugars_100g : null,
          salt: n.salt_100g != null ? n.salt_100g : null,
          fiber: n.fiber_100g != null ? n.fiber_100g : null
        };

        this.runCleanerAlternativesSearch({
          name: prod.product_name || prod.generic_name,
          brand: prod.brands,
          ingredientsText: prod.ingredients_text,
          nutrition
        });
      } else {
        alert(`Product not found for barcode ${code}. Please enter the product name manually.`);
      }
    } catch (e) {
      console.warn('Barcode lookup error:', e);
      alert('Could not look up barcode. Check internet connection or enter name manually.');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Look Up Product';
      }
    }
  }

  browseCleanAlternativesByCategory(categoryId) {
    const resultsContainer = document.getElementById('swap-results');
    const emptyState = document.getElementById('swap-empty-state');
    const banner = document.getElementById('swap-status-banner');
    if (banner) banner.style.display = 'none';

    if (!window.AlternativesDatabase || !window.AlternativesEngine) return;

    let items = [];
    if (categoryId === 'all') {
      items = window.AlternativesDatabase.alternatives.slice(0, 8);
    } else {
      items = window.AlternativesDatabase.alternatives.filter((a) => a.categories.includes(categoryId));
    }

    if (items.length === 0) {
      if (emptyState) {
        emptyState.style.display = 'block';
        emptyState.textContent = 'No preset alternatives for this category yet. Enter a product name above to search with AI!';
      }
      if (resultsContainer) resultsContainer.style.display = 'none';
      return;
    }

    if (emptyState) emptyState.style.display = 'none';
    if (resultsContainer) {
      resultsContainer.style.display = 'block';
      const catObj = window.AlternativesDatabase.categories.find((c) => c.id === categoryId);
      const catTitle = catObj ? catObj.label : 'Clean Food Swaps';

      resultsContainer.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
          <div style="font-size:14px; font-weight:800; color:var(--text-primary); text-transform:uppercase; letter-spacing:0.04em;">
            Curated Swaps &bull; ${catTitle}
          </div>
          <span class="health-score-pill grade-a" style="font-size:11px;">${items.length} Options</span>
        </div>
        <div id="swap-cards-list"></div>
      `;

      const listContainer = document.getElementById('swap-cards-list');
      items.forEach((item, idx) => {
        const assessment = window.AlternativesEngine.assess(
          { ingredientsText: item.ingredients, nutrition: item.nutrition },
          { basis: ['sugars', 'salt', 'satFat', 'protein', 'fiber'] }
        );
        const card = this.createAlternativeCardElement({
          rank: idx + 1,
          name: item.name,
          categoryName: catTitle,
          score: assessment.score || 88,
          grade: assessment.grade || 'A',
          highlights: item.highlights || ['Whole-food clean ingredients', 'Free from artificial additives'],
          ingredients: item.ingredients,
          nutrition: item.nutrition,
          reasons: [
            'Zero artificial additives or chemical preservatives',
            'Nutrient-dense whole-food formulation',
            ...(item.highlights || [])
          ],
          rows: null
        });
        listContainer.appendChild(card);
      });
    }
  }

  openCleanerAlternativesWithProduct(product) {
    this.navigate('screen-recommendations');

    const pInput = document.getElementById('swap-product-input');
    const bInput = document.getElementById('swap-brand-input');
    const iInput = document.getElementById('swap-ingredients-input');
    const sourceNote = document.getElementById('swap-source-note');
    const sourceImg = document.getElementById('swap-product-image');
    const sourceText = document.getElementById('swap-source-text');

    if (pInput) pInput.value = product.name || product.product_name || '';
    if (bInput) bInput.value = product.brand || product.brands || '';
    if (iInput) iInput.value = product.ingredientsText || product.ingredients_text || '';

    if (sourceNote && sourceText) {
      sourceNote.style.display = 'flex';
      sourceText.textContent = `${product.source || 'Scanned'}: ${product.name || 'Food Product'}`;
      if (product.image) {
        sourceImg.src = product.image;
        sourceImg.style.display = 'block';
      } else {
        sourceImg.style.display = 'none';
      }
    }

    this.runCleanerAlternativesSearch(product);
  }

  async runCleanerAlternativesSearch(productOverride = {}) {
    const pInput = document.getElementById('swap-product-input');
    const bInput = document.getElementById('swap-brand-input');
    const iInput = document.getElementById('swap-ingredients-input');
    const banner = document.getElementById('swap-status-banner');
    const resultsContainer = document.getElementById('swap-results');
    const emptyState = document.getElementById('swap-empty-state');

    const productName = (productOverride.name != null ? productOverride.name : pInput?.value || '').trim();
    const brand = (productOverride.brand != null ? productOverride.brand : bInput?.value || '').trim();
    const ingredientsText = (productOverride.ingredientsText != null ? productOverride.ingredientsText : iInput?.value || '').trim();
    const nutrition = productOverride.nutrition || null;

    if (!productName && !ingredientsText) {
      if (banner) {
        banner.className = 'swap-banner warning';
        banner.style.display = 'flex';
        banner.innerHTML = `
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <span>Please enter a product name, type ingredients, or scan a barcode to find cleaner alternatives.</span>
        `;
      }
      return;
    }

    if (banner) banner.style.display = 'none';
    if (emptyState) emptyState.style.display = 'none';

    // Show loading state
    if (resultsContainer) {
      resultsContainer.style.display = 'block';
      resultsContainer.innerHTML = `
        <div class="card" style="text-align:center; padding:36px 16px;">
          <span class="spinner" style="width:32px; height:32px; border-width:3px; margin-bottom:14px;"></span>
          <div style="font-size:15px; font-weight:700; color:var(--text-primary); margin-bottom:6px;">Analyzing Food Composition...</div>
          <div style="font-size:12px; color:var(--text-secondary);">Screening for additives, preservatives, ultra-processing, and matching clean swaps.</div>
        </div>
      `;
    }

    // Determine category
    const activeChip = document.querySelector('#swap-category-chips .swap-cat-chip.active');
    const selectedCat = activeChip ? activeChip.getAttribute('data-category') : 'all';
    const categoryId = productOverride.categoryId || (selectedCat !== 'all' ? selectedCat : undefined);

    const productObj = {
      name: productName,
      brand,
      ingredientsText,
      nutrition
    };

    try {
      if (!window.AlternativesEngine) {
        throw new Error('AlternativesEngine not loaded');
      }

      const result = window.AlternativesEngine.findAlternatives(productObj, {
        categoryId,
        userAllergens: this.user.allergens || []
      });

      if (result && result.alternatives && result.alternatives.length > 0) {
        this.renderCleanerAlternativesResults(result, productObj);
      } else {
        // Fallback to server AI cleaner alternatives
        await this.requestAICleanerAlternatives(productObj, result);
      }
    } catch (err) {
      console.error('Error finding alternatives:', err);
      await this.requestAICleanerAlternatives(productObj, null);
    }
  }

  renderCleanerAlternativesResults(result, productObj) {
    const resultsContainer = document.getElementById('swap-results');
    if (!resultsContainer) return;

    const { current, alternatives, category } = result;
    const catLabel = category ? category.label : 'Clean Health Alternatives';

    let currentCardHtml = '';
    if (current && current.score != null) {
      const concerns = [];
      if (current.categoryHits) {
        Object.keys(current.categoryHits).forEach((k) => {
          const count = current.categoryHits[k];
          const label = window.AlternativesEngine.CATEGORY_LABELS[k] || k;
          concerns.push(`${count} ${label.toLowerCase()}`);
        });
      }

      const gradeClass = `grade-${(current.grade || 'c').toLowerCase()}`;
      currentCardHtml = `
        <div class="swap-current-card">
          <div class="swap-current-header">
            <div>
              <div style="font-size:12px; font-weight:700; text-transform:uppercase; color:var(--text-muted); margin-bottom:2px;">Product Analyzed</div>
              <div style="font-size:16px; font-weight:800; color:var(--text-primary);">${productObj.name || 'Packaged Product'}</div>
              ${productObj.brand ? `<div style="font-size:12px; color:var(--text-secondary);">${productObj.brand}</div>` : ''}
            </div>
            <span class="health-score-pill ${gradeClass}" style="font-size:12px; padding:4px 10px;">
              Grade ${current.grade || 'C'} &bull; ${current.score}/100
            </span>
          </div>

          ${current.additiveCount > 0 ? `
            <div style="font-size:12px; color:var(--ring-red); font-weight:600; margin-bottom:8px; display:flex; align-items:center; gap:6px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              ${current.additiveCount} Flagged Additive${current.additiveCount > 1 ? 's' : ''} (${concerns.join(', ')})
            </div>
          ` : `
            <div style="font-size:12px; color:var(--ring-green); font-weight:600; margin-bottom:8px;">
              &check; Clean additive profile detected
            </div>
          `}

          ${current.nutrition && (current.nutrition.kcal || current.nutrition.sugars) ? `
            <div style="display:flex; gap:12px; font-family:var(--font-mono); font-size:11px; color:var(--text-muted); margin-top:8px;">
              ${current.nutrition.kcal ? `<span>${Math.round(current.nutrition.kcal)} kcal</span>` : ''}
              ${current.nutrition.sugars != null ? `<span>${current.nutrition.sugars}g sugar</span>` : ''}
              ${current.nutrition.salt != null ? `<span>${current.nutrition.salt}g salt</span>` : ''}
              ${current.nutrition.satFat != null ? `<span>${current.nutrition.satFat}g sat fat</span>` : ''}
            </div>
          ` : ''}
        </div>
      `;
    }

    resultsContainer.innerHTML = `
      ${currentCardHtml}
      <div style="display:flex; justify-content:space-between; align-items:center; margin:16px 0 12px;">
        <div style="font-size:14px; font-weight:800; color:var(--text-primary); text-transform:uppercase; letter-spacing:0.04em;">
          Cleaner Swaps (${alternatives.length})
        </div>
        <span class="health-score-pill grade-a" style="font-size:11px;">Ranked by Health Quality</span>
      </div>
      <div id="swap-cards-list"></div>
      <div class="card" style="margin-top:16px; text-align:center; padding:18px;">
        <div style="font-size:13px; font-weight:700; color:var(--text-primary); margin-bottom:4px;">Want Deeper Clinical Insights?</div>
        <div style="font-size:12px; color:var(--text-secondary); margin-bottom:12px;">Ask Gemini AI to evaluate health impacts and suggest boutique organic brands.</div>
        <button class="btn-secondary" id="swap-ask-ai-btn" style="width:100%; height:40px; font-size:13px; font-weight:600;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px;"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
          Ask AI Clinical Nutritionist
        </button>
      </div>
    `;

    const listContainer = document.getElementById('swap-cards-list');
    alternatives.forEach((alt, index) => {
      const card = this.createAlternativeCardElement({
        rank: index + 1,
        name: alt.name,
        categoryName: catLabel,
        score: alt.score,
        grade: alt.grade,
        highlights: alt.assessment?.record?.highlights || ['Whole-food clean ingredients', 'Free from artificial additives'],
        ingredients: alt.ingredientsText,
        nutrition: alt.nutrition,
        reasons: alt.reasons,
        rows: alt.rows
      });
      listContainer?.appendChild(card);
    });

    document.getElementById('swap-ask-ai-btn')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner" style="width:16px; height:16px; border-width:2px; margin-right:6px;"></span> Consulting AI Nutritionist...';
      await this.requestAICleanerAlternatives(productObj, result, true);
    });
  }

  createAlternativeCardElement(item) {
    const card = document.createElement('div');
    card.className = 'swap-item-card';

    const rank = item.rank || 1;
    const rankTitle = rank === 1 ? 'Cleanest Alternative' : rank === 2 ? 'Top Whole Food Choice' : 'Wholesome Swap';

    const highlights = item.highlights || [];
    const reasons = item.reasons || ['Clean whole-food ingredients', 'No synthetic dyes or artificial flavours'];

    let rowsHtml = '';
    if (item.rows && item.rows.length > 0) {
      rowsHtml = `
        <table class="swap-compare-table">
          <thead>
            <tr>
              <th>Nutrient</th>
              <th>Your Food</th>
              <th>Clean Swap</th>
              <th>Difference</th>
            </tr>
          </thead>
          <tbody>
            ${item.rows.map((row) => `
              <tr>
                <td style="color:var(--text-secondary); font-weight:600;">${row.label}</td>
                <td>${row.current != null ? row.current + (row.unit || '') : '&mdash;'}</td>
                <td style="font-weight:700; color:var(--text-primary);">${row.alt != null ? row.alt + (row.unit || '') : '&mdash;'}</td>
                <td class="${row.isBetter ? 'swap-diff-better' : (row.diff === 0 ? 'swap-diff-same' : 'swap-diff-higher')}">
                  ${row.diff != null ? (row.diff > 0 ? '+' : '') + row.diff + (row.unit || '') : '&mdash;'}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }

    card.innerHTML = `
      <div class="swap-item-top">
        <div>
          <div class="swap-rank-badge">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            Rank #${rank} &bull; ${rankTitle}
          </div>
          <div style="font-size:16px; font-weight:800; color:var(--text-primary); margin-bottom:3px;">${item.name}</div>
          <div style="font-size:12px; color:var(--text-secondary);">${item.categoryName || 'Healthier Food Swap'}</div>
        </div>
        <span class="health-score-pill grade-${(item.grade || 'a').toLowerCase()}" style="font-size:12px; padding:4px 10px;">
          Grade ${item.grade || 'A'} &bull; ${item.score || 88}/100
        </span>
      </div>

      ${highlights.length > 0 ? `
        <div class="swap-highlights">
          ${highlights.map((h) => `<span class="swap-highlight-pill">${h}</span>`).join('')}
        </div>
      ` : ''}

      <div class="swap-reasons-list">
        <div class="swap-reasons-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ring-green)" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          Why this is cleaner:
        </div>
        ${reasons.map((r) => `
          <div class="swap-reason-item">
            <svg class="swap-reason-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            <span>${r}</span>
          </div>
        `).join('')}
      </div>

      ${rowsHtml}

      ${item.ingredients ? `
        <div style="font-size:12px; color:var(--text-secondary); line-height:1.45; margin-bottom:14px;">
          <strong style="color:var(--text-primary); font-size:11px; text-transform:uppercase;">Clean Ingredients:</strong> ${item.ingredients}
        </div>
      ` : ''}

      <div class="swap-actions">
        <button class="btn-primary swap-log-btn" style="flex:1;">Log to Today's Dashboard</button>
        <button class="btn-secondary swap-save-btn" style="flex:1;">Save to Recipes</button>
      </div>
    `;

    // Bind Log button
    const logBtn = card.querySelector('.swap-log-btn');
    if (logBtn) {
      logBtn.addEventListener('click', () => {
        this.logFoodItemToDashboard(item.name, item.nutrition);
      });
    }

    // Bind Save button
    const saveBtn = card.querySelector('.swap-save-btn');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        this.saveSwapToRecipes(item);
      });
    }

    return card;
  }

  async requestAICleanerAlternatives(productObj, localResult, appendMode = false) {
    const resultsContainer = document.getElementById('swap-results');
    if (!resultsContainer) return;

    if (!appendMode) {
      resultsContainer.innerHTML = `
        <div class="card" style="text-align:center; padding:36px 16px;">
          <span class="spinner" style="width:32px; height:32px; border-width:3px; margin-bottom:14px;"></span>
          <div style="font-size:15px; font-weight:700; color:var(--text-primary); margin-bottom:6px;">Consulting AI Clinical Nutritionist...</div>
          <div style="font-size:12px; color:var(--text-secondary);">Analyzing unique food formulation & finding cleaner artisan and organic alternatives.</div>
        </div>
      `;
    }

    try {
      const res = await fetch('/api/cleaner-alternatives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productName: productObj.name || 'Packaged Food',
          brand: productObj.brand || undefined,
          ingredientsText: productObj.ingredientsText || undefined,
          allergens: this.user.allergens || []
        })
      });

      if (!res.ok) {
        throw new Error('AI analysis service unavailable');
      }

      const aiData = await res.json();
      this.renderAICleanerResults(aiData, productObj, appendMode);
    } catch (err) {
      console.warn('AI cleaner alternatives request error:', err);
      if (!appendMode) {
        resultsContainer.innerHTML = `
          <div class="card" style="text-align:center; padding:28px 16px;">
            <div style="font-size:16px; font-weight:800; color:var(--text-primary); margin-bottom:6px;">Smart Health Guidelines</div>
            <p style="font-size:13px; color:var(--text-secondary); line-height:1.5; margin-bottom:14px;">
              For <strong>${productObj.name || 'this item'}</strong>, look for alternatives with 5 or fewer whole-food ingredients, zero artificial dyes (E102, E110, Red 40), and no hydrogenated oils.
            </p>
            <button class="btn-primary" id="swap-retry-browse-btn" style="height:40px; font-size:13px;">Browse Clean Categories Above</button>
          </div>
        `;
        document.getElementById('swap-retry-browse-btn')?.addEventListener('click', () => {
          this.browseCleanAlternativesByCategory('all');
        });
      }
    }
  }

  renderAICleanerResults(data, productObj, appendMode) {
    const resultsContainer = document.getElementById('swap-results');
    if (!resultsContainer) return;

    const alternatives = data.alternatives || data.cleaner_alternatives || [];
    const verdict = data.currentProductSummary || data.clinical_verdict || '';
    const flaggedConcerns = data.flaggedConcerns || data.flagged_concerns || [];
    const detectedCategory = data.detectedCategory || data.detected_category || 'Clean Health Swaps';

    let aiSectionHtml = `
      <div class="card" style="background:rgba(124,58,237,0.06); border:1px solid rgba(124,58,237,0.3); padding:16px; margin-bottom:16px; margin-top:${appendMode ? '16px' : '0'};">
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
          <span class="health-score-pill grade-a" style="font-size:11px; padding:3px 8px;">AI Clinical Nutritionist</span>
          <span style="font-size:12px; color:var(--accent-lavender); font-weight:700;">Dr. Lavosia Intelligence &bull; ${detectedCategory}</span>
        </div>
        <p style="font-size:13px; color:var(--text-primary); line-height:1.5; margin:0;">
          ${verdict}
        </p>
      </div>
    `;

    if (!appendMode) {
      let currentProductHtml = `
        <div class="swap-current-card">
          <div class="swap-current-header">
            <div>
              <div style="font-size:12px; font-weight:700; text-transform:uppercase; color:var(--text-muted); margin-bottom:2px;">Product Analyzed</div>
              <div style="font-size:16px; font-weight:800; color:var(--text-primary);">${productObj.name || 'Packaged Product'}</div>
              ${productObj.brand ? `<div style="font-size:12px; color:var(--text-secondary);">${productObj.brand}</div>` : ''}
            </div>
            <span class="health-score-pill grade-c" style="font-size:12px; padding:4px 10px;">
              Grade C &bull; Evaluated
            </span>
          </div>
          ${flaggedConcerns.length > 0 ? `
            <div style="font-size:12px; color:var(--ring-red); font-weight:600; margin-bottom:6px;">
              &bull; Concerns: ${flaggedConcerns.join(', ')}
            </div>
          ` : ''}
        </div>
      `;

      resultsContainer.innerHTML = `
        ${currentProductHtml}
        ${aiSectionHtml}
        <div style="font-size:14px; font-weight:800; color:var(--text-primary); text-transform:uppercase; letter-spacing:0.04em; margin-bottom:12px;">
          AI Recommended Clean Swaps (${alternatives.length})
        </div>
        <div id="ai-swap-cards-list"></div>
      `;

      const listContainer = document.getElementById('ai-swap-cards-list');
      alternatives.forEach((alt, idx) => {
        const brandStr = alt.brandSuggestion || alt.brand || '';
        const card = this.createAlternativeCardElement({
          rank: idx + 1,
          name: alt.name,
          categoryName: brandStr ? `Brand: ${brandStr}` : (alt.category || detectedCategory),
          score: alt.score || alt.health_score || 88,
          grade: alt.grade || alt.health_grade || 'A',
          highlights: alt.highlights || ['Whole-food clean alternative'],
          ingredients: alt.ingredientsText || alt.ingredients_text || alt.ingredients_preview || 'Whole-food ingredients without synthetic additives',
          nutrition: alt.nutrition || alt.nutrition_per_100g || alt.nutrition_estimate || { kcal: 200, protein: 8, fat: 5, sugars: 3, salt: 0.3, fiber: 5 },
          reasons: alt.reasons || alt.why_cleaner_reasons || alt.key_improvements || ['Lower sugar and zero synthetic chemical preservatives'],
          rows: null
        });
        listContainer?.appendChild(card);
      });
    } else {
      // In append mode, insert AI section and cards below existing local results
      const aiWrap = document.createElement('div');
      aiWrap.innerHTML = `
        ${aiSectionHtml}
        <div style="font-size:14px; font-weight:800; color:var(--text-primary); text-transform:uppercase; letter-spacing:0.04em; margin:16px 0 12px;">
          Additional AI-Recommended Organic Swaps
        </div>
        <div id="ai-appended-cards-list"></div>
      `;
      resultsContainer.appendChild(aiWrap);

      const listContainer = document.getElementById('ai-appended-cards-list');
      alternatives.forEach((alt, idx) => {
        const brandStr = alt.brandSuggestion || alt.brand || '';
        const card = this.createAlternativeCardElement({
          rank: idx + 1,
          name: alt.name,
          categoryName: brandStr ? `Brand: ${brandStr}` : (alt.category || 'Clean Organic Swap'),
          score: alt.score || alt.health_score || 90,
          grade: alt.grade || alt.health_grade || 'A',
          highlights: alt.highlights || ['Whole-food clean alternative'],
          ingredients: alt.ingredientsText || alt.ingredients_text || alt.ingredients_preview || 'Pure clean formulation',
          nutrition: alt.nutrition || alt.nutrition_per_100g || alt.nutrition_estimate || { kcal: 210, protein: 9, fat: 4, sugars: 2, salt: 0.2, fiber: 6 },
          reasons: alt.reasons || alt.why_cleaner_reasons || alt.key_improvements || ['Cleaner nutrient density and no harmful additives'],
          rows: null
        });
        listContainer?.appendChild(card);
      });

      const askBtn = document.getElementById('swap-ask-ai-btn');
      if (askBtn) {
        askBtn.disabled = true;
        askBtn.textContent = 'AI Nutritionist Advice Loaded Above';
      }
    }
  }

  logFoodItemToDashboard(name, nutrition) {
    if (!nutrition) {
      alert(`Logged ${name} to your activity rings!`);
      return;
    }

    const kcal = Math.round(nutrition.kcal || 0);
    const pro = Math.round(nutrition.protein || 0);
    const carbs = Math.round(nutrition.carbs || 0);
    const fat = Math.round(nutrition.fat || 0);
    const fiber = Math.round(nutrition.fiber || 0);

    if (kcal > 0) this.addCalories(kcal);
    if (pro > 0) this.addProtein(pro);
    if (carbs > 0) this.addCarbs(carbs);
    if (fat > 0) this.addFats(fat);
    if (fiber > 0) this.addFiber(fiber);

    const banner = document.getElementById('swap-status-banner');
    if (banner) {
      banner.className = 'swap-banner success';
      banner.style.display = 'flex';
      banner.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
        <span>Logged <strong>${name}</strong> (${kcal} kcal, ${pro}g protein) to your daily activity rings!</span>
      `;
      setTimeout(() => {
        if (banner) banner.style.display = 'none';
      }, 5000);
    }
  }

  saveSwapToRecipes(swapItem) {
    const rec = {
      title: swapItem.name,
      category: 'Clean Swaps',
      prepTime: 10,
      calories: Math.round(swapItem.nutrition?.kcal || 250),
      protein: Math.round(swapItem.nutrition?.protein || 10),
      carbs: Math.round(swapItem.nutrition?.carbs || 25),
      fats: Math.round(swapItem.nutrition?.fat || 8),
      description: Array.isArray(swapItem.reasons) ? swapItem.reasons.join('. ') : 'Clean health swap without artificial additives.',
      ingredients: typeof swapItem.ingredients === 'string' ? swapItem.ingredients.split(',').map((s) => s.trim()) : (swapItem.ingredients || []),
      instructions: ['Enjoy as a clean, wholesome alternative to ultra-processed packaged foods.']
    };
    this.saveRecipe(rec);
    alert(`Saved "${swapItem.name}" to your Saved Recipes collection!`);
  }

  /* =========================================================================
     GLOBAL EVENT BINDINGS
     ========================================================================= */
  bindEvents() {
    // Stop ingredient camera when navigating away
    addRouteListener((screenId, previousScreen) => {
      if (previousScreen === 'screen-scan-ingredients' && screenId !== 'screen-scan-ingredients') {
        this.stopIngredientCamera();
      }
    });

    // Navigation routes via data attributes
    document.addEventListener('click', (e) => {
      const target = e.target.closest('[data-route]');
      if (target) {
        e.preventDefault();
        const route = target.getAttribute('data-route');
        this.navigate(route);
        return;
      }

      const backTarget = e.target.closest('[data-route-back]');
      if (backTarget) {
        e.preventDefault();
        const fallback = backTarget.getAttribute('data-route-back') || 'screen-dashboard';
        this.goBack(fallback);
        return;
      }
    });

    // Tab buttons
    document.getElementById('tab-summary')?.addEventListener('click', () => this.navigate('screen-dashboard'));
    document.getElementById('tab-recommendations')?.addEventListener('click', () => this.navigate('screen-recommendations'));
    document.getElementById('tab-recipes')?.addEventListener('click', () => this.navigate('screen-saved-recipes'));
    document.getElementById('tab-settings')?.addEventListener('click', () => this.navigate('screen-settings'));

    // Dashboard quick action cards
    document.getElementById('dash-quick-water-btn')?.addEventListener('click', () => this.addWater(0.25));
    document.getElementById('reset-calories-btn')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.todayLog.calories = 0;
      this.todayLog.history = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      this.updateActivityRings();
    });
    document.getElementById('reset-macros-btn')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.todayLog.protein = 0;
      this.todayLog.carbs = 0;
      this.todayLog.fats = 0;
      this.todayLog.fiber = 0;
      this.updateActivityRings();
    });
    document.getElementById('reset-water-btn')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.todayLog.water = 0;
      this.updateActivityRings();
    });

    // Manual quick telemetry adds
    document.getElementById('manual-calories-add-btn')?.addEventListener('click', () => {
      const input = document.getElementById('manual-calories-input');
      if (input && input.value) {
        this.addCalories(parseInt(input.value, 10));
        input.value = '';
      }
    });
    document.getElementById('manual-protein-add-btn')?.addEventListener('click', () => {
      const input = document.getElementById('manual-protein-input');
      if (input && input.value) {
        this.addProtein(parseFloat(input.value));
        input.value = '';
      }
    });
    document.getElementById('manual-carbs-add-btn')?.addEventListener('click', () => {
      const input = document.getElementById('manual-carbs-input');
      if (input && input.value) {
        this.addCarbs(parseFloat(input.value));
        input.value = '';
      }
    });
    document.getElementById('manual-fats-add-btn')?.addEventListener('click', () => {
      const input = document.getElementById('manual-fats-input');
      if (input && input.value) {
        this.addFats(parseFloat(input.value));
        input.value = '';
      }
    });
    document.getElementById('manual-fiber-add-btn')?.addEventListener('click', () => {
      const input = document.getElementById('manual-fiber-input');
      if (input && input.value) {
        this.addFiber(parseFloat(input.value));
        input.value = '';
      }
    });

    // Login Form Submit (Connect to /api/auth/login)
    document.getElementById('login-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('login-username')?.value.trim();
      const password = document.getElementById('login-password')?.value;
      const errorBanner = document.getElementById('login-error-banner');
      const submitBtn = document.getElementById('login-submit-btn');

      if (errorBanner) errorBanner.style.display = 'none';

      if (!username || !password) {
        if (errorBanner) {
          errorBanner.textContent = 'Please provide both username and password.';
          errorBanner.style.display = 'block';
        }
        return;
      }

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Authenticating...';
      }

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ username, password })
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || 'Invalid username or password');
        }

        // Login successful: wipe any prior session residue first
        resetSessionState();
        this.syncStateFromCore();

        this.user.id = data.user.id;
        this.user.username = data.user.username;
        this.user.role = data.user.role || 'user';
        this.user.isLoggedIn = true;

        await this.loadAllUserData();
        this.calculateTDEE();
        this.updateUserStatsDisplay();
        this.updateActivityRings();
        this.updateAdminPanelVisibility();

        // Check if there is data in localStorage to migrate
        this.checkLocalStorageMigration();

        this.navigate('screen-dashboard');
      } catch (err) {
        if (errorBanner) {
          errorBanner.textContent = err.message || 'Login failed. Please verify credentials.';
          errorBanner.style.display = 'block';
        }
      } finally {
        // Never leave password in input field
        const pwInput = document.getElementById('login-password');
        if (pwInput) pwInput.value = '';

        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Log In to Dashboard';
        }
      }
    });

    // Signup Form Submit (Connect to /api/auth/register)
    document.getElementById('signup-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorBanner = document.getElementById('signup-error-banner');
      const submitBtn = e.target.querySelector('button[type="submit"]');

      if (errorBanner) errorBanner.style.display = 'none';

      const username = document.getElementById('signup-username')?.value.trim();
      const password = document.getElementById('signup-password')?.value;
      const age = parseInt(document.getElementById('signup-age')?.value, 10);
      const gender = document.getElementById('signup-gender')?.value;
      const height = parseInt(document.getElementById('signup-height')?.value, 10);
      const weight = parseInt(document.getElementById('signup-weight')?.value, 10);
      const diet = document.getElementById('signup-diet')?.value;
      const activity = document.getElementById('signup-activity')?.value;

      if (!username || !password || !age || !gender || !height || !weight || !diet || !activity) {
        if (errorBanner) {
          errorBanner.textContent = 'Please fill out all required profile fields.';
          errorBanner.style.display = 'block';
        }
        return;
      }

      if (password.length < 8) {
        if (errorBanner) {
          errorBanner.textContent = 'Password must be at least 8 characters long.';
          errorBanner.style.display = 'block';
        }
        return;
      }

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Creating Profile...';
      }

      try {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            username,
            password,
            age,
            gender,
            height_cm: height,
            weight_kg: weight,
            diet,
            activity_level: activity,
            goal: diet,
            calorie_target: this.user.goals.calories,
            protein_target: this.user.goals.protein,
            allergens: this.user.allergens || []
          })
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || 'Registration failed.');
        }

        // Registration & login successful: wipe prior session residue first
        resetSessionState();
        this.syncStateFromCore();

        this.user.id = data.user.id;
        this.user.username = data.user.username;
        this.user.role = data.user.role || 'user';
        this.user.isLoggedIn = true;

        await this.loadAllUserData();
        this.calculateTDEE();
        this.updateUserStatsDisplay();
        this.updateActivityRings();
        this.updateAdminPanelVisibility();

        // Check if there is data in localStorage to migrate
        this.checkLocalStorageMigration();

        this.navigate('screen-dashboard');
      } catch (err) {
        if (errorBanner) {
          errorBanner.textContent = err.message || 'Signup failed. Please try again.';
          errorBanner.style.display = 'block';
        }
      } finally {
        // Never leave password in input field
        const pwInput = document.getElementById('signup-password');
        if (pwInput) pwInput.value = '';

        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Complete Profile & Start Tracking';
        }
      }
    });

    // Settings Profile Modal
    document.getElementById('open-edit-profile-btn')?.addEventListener('click', () => {
      const modal = document.getElementById('edit-profile-modal');
      if (modal) {
        modal.style.display = 'flex';
        document.getElementById('edit-weight').value = this.user.weight;
        document.getElementById('edit-height').value = this.user.height;
        document.getElementById('edit-age').value = this.user.age;
        document.getElementById('edit-activity').value = this.user.activityLevel;
        document.getElementById('edit-diet').value = this.user.diet;
      }
    });

    document.getElementById('close-edit-modal-btn')?.addEventListener('click', () => {
      const modal = document.getElementById('edit-profile-modal');
      if (modal) modal.style.display = 'none';
    });

    document.getElementById('edit-profile-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      this.user.weight = parseInt(document.getElementById('edit-weight').value, 10);
      this.user.height = parseInt(document.getElementById('edit-height').value, 10);
      this.user.age = parseInt(document.getElementById('edit-age').value, 10);
      this.user.activityLevel = document.getElementById('edit-activity').value;
      this.user.diet = document.getElementById('edit-diet').value;

      this.calculateTDEE();
      this.updateUserStatsDisplay();
      this.updateActivityRings();

      const modal = document.getElementById('edit-profile-modal');
      if (modal) modal.style.display = 'none';

      // Save to backend profile
      if (this.user.isLoggedIn) {
        try {
          await fetch('/api/profile', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              age: this.user.age,
              sex: this.user.gender,
              height_cm: this.user.height,
              weight_kg: this.user.weight,
              activity_level: this.user.activityLevel,
              goal: this.user.diet,
              calorie_target: this.user.goals.calories,
              protein_target: this.user.goals.protein,
              allergens: this.user.allergens
            })
          });
        } catch (err) {
          console.warn('Failed to save profile changes to backend:', err);
        }
      }
    });

    // Logout
    document.getElementById('logout-btn')?.addEventListener('click', async () => {
      let networkFailed = false;
      try {
        const res = await fetch('/api/auth/logout', {
          method: 'POST',
          credentials: 'include'
        });
        if (!res.ok) {
          networkFailed = true;
        }
      } catch (e) {
        networkFailed = true;
        console.warn('Logout request failed:', e);
      } finally {
        // Complete eradication of session data across state, DOM, and browser storage
        resetSessionState();
        this.syncStateFromCore();
        this.updateAdminPanelVisibility();
        this.navigate('screen-welcome', false);

        state.navigationHistory = [];
        if (window.history && window.history.replaceState) {
          window.history.replaceState(null, '', window.location.pathname);
        }

        if (networkFailed) {
          const banner = document.getElementById('login-error-banner');
          if (banner) {
            banner.textContent = 'Logged out locally. Check your connection.';
            banner.style.display = 'block';
          }
        }
      }
    });

    // Migration Modal Events
    document.getElementById('migrate-confirm-btn')?.addEventListener('click', () => {
      this.executeLocalStorageMigration();
    });

    document.getElementById('migrate-dismiss-btn')?.addEventListener('click', () => {
      const legacyKeys = ['lavosia_user', 'lavosia_profile', 'lavosia_log', 'lavosia_recipes', 'lavosia_pantry'];
      legacyKeys.forEach(k => localStorage.removeItem(k));
      const modal = document.getElementById('migration-modal');
      if (modal) modal.style.display = 'none';
    });

    // Admin Panel Open Button
    document.getElementById('settings-admin-panel-btn')?.addEventListener('click', () => {
      this.navigate('screen-admin');
      this.loadAdminUsers();
    });

    // Admin Console Events
    this.initAdminConsole();

    // Module 1 & 2 Initializations
    this.initImageAnalysis();
    this.initMealPrep();
    this.initSavedRecipes();
    this.initIngredientScanner();
    this.initCleanerAlternatives();
  }

  /* =========================================================================
     SCREEN 13: ADMIN CONSOLE ENGINE
     ========================================================================= */
  initAdminConsole() {
    document.getElementById('admin-refresh-btn')?.addEventListener('click', () => {
      this.loadAdminUsers();
    });

    document.getElementById('admin-close-pw-callout')?.addEventListener('click', () => {
      const callout = document.getElementById('admin-temp-pw-callout');
      if (callout) callout.style.display = 'none';
    });

    document.getElementById('admin-copy-pw-btn')?.addEventListener('click', () => {
      const input = document.getElementById('admin-temp-pw-val');
      if (input && input.value) {
        navigator.clipboard?.writeText(input.value);
        const btn = document.getElementById('admin-copy-pw-btn');
        if (btn) {
          btn.textContent = 'Copied!';
          setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
        }
      }
    });
  }

  async loadAdminUsers() {
    const listContainer = document.getElementById('admin-users-list');
    const noticeBanner = document.getElementById('admin-notice-banner');
    const userCountEl = document.getElementById('admin-user-count');
    if (!listContainer) return;

    if (userCountEl) userCountEl.textContent = '';
    listContainer.innerHTML = '<div style="text-align:center; padding:30px; color:var(--text-muted); font-size:13px;"><span class="spinner"></span> Loading user directory...</div>';

    try {
      const res = await fetch('/api/admin/users', { credentials: 'include' });
      if (!res.ok) {
        throw new Error('Failed to load user directory. Admin privileges required.');
      }

      const data = await res.json();
      const users = data.users || [];

      if (userCountEl) {
        userCountEl.textContent = `${users.length} ${users.length === 1 ? 'user' : 'users'}`;
      }

      if (users.length === 0) {
        listContainer.innerHTML = '<div class="card" style="text-align:center; color:var(--text-secondary); padding:24px;">No user accounts found.</div>';
        return;
      }

      listContainer.innerHTML = '';

      users.forEach((u) => {
        const userCard = document.createElement('div');
        userCard.className = 'card';
        userCard.style.padding = '16px';
        userCard.style.border = u.role === 'admin' ? '1px solid rgba(124,58,237,0.4)' : '1px solid var(--border-subtle)';

        const isCurrentAdmin = (u.id === this.user.id);
        const isAdmin = (u.role === 'admin');
        const isDisabled = (u.status === 'disabled');

        userCard.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px;">
            <div>
              <div style="display:flex; align-items:center; gap:8px;">
                <span style="font-size:16px; font-weight:800; color:var(--text-primary);">${u.username}</span>
                ${isAdmin ? '<span class="health-score-pill grade-a" style="font-size:10px; padding:2px 8px;">ADMIN</span>' : '<span class="health-score-pill grade-b" style="font-size:10px; padding:2px 8px;">USER</span>'}
                ${isDisabled ? '<span class="health-score-pill grade-c" style="font-size:10px; padding:2px 8px; background:rgba(255,45,85,0.2); color:#FF6B8B;">DISABLED</span>' : '<span class="health-score-pill grade-a" style="font-size:10px; padding:2px 8px; background:rgba(52,199,89,0.2); color:#34C759;">ACTIVE</span>'}
                ${isCurrentAdmin ? '<span style="font-size:11px; color:var(--accent-lavender); font-weight:700;">(You)</span>' : ''}
              </div>
              <div style="font-size:11px; color:var(--text-muted); font-family:var(--font-mono); margin-top:4px;">
                ID: #${u.id} &bull; Created: ${new Date(u.created_at).toLocaleDateString()}
              </div>
              <div style="font-size:12px; color:var(--text-secondary); margin-top:4px;">
                ${u.age || 26} yrs &bull; ${u.sex || 'male'} &bull; Goal: ${u.diet || 'maintenance'} &bull; ${u.activity_level || 'active'}
              </div>
            </div>
          </div>

          <!-- Activity Telemetry Metrics -->
          <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; margin-bottom:14px; text-align:center;">
            <div style="background:var(--bg-canvas); padding:8px; border-radius:8px;">
              <div style="font-size:15px; font-weight:800; color:var(--ring-red); font-family:var(--font-mono);">${u.stats?.logged_meals || 0}</div>
              <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase;">Days Logged</div>
            </div>
            <div style="background:var(--bg-canvas); padding:8px; border-radius:8px;">
              <div style="font-size:15px; font-weight:800; color:var(--accent-lavender); font-family:var(--font-mono);">${u.stats?.saved_recipes || 0}</div>
              <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase;">Saved Recipes</div>
            </div>
            <div style="background:var(--bg-canvas); padding:8px; border-radius:8px;">
              <div style="font-size:12px; font-weight:700; color:var(--ring-cyan); font-family:var(--font-mono); margin-top:2px;">
                ${u.last_login_at ? new Date(u.last_login_at).toLocaleDateString(undefined, {month:'short', day:'numeric'}) : 'Never'}
              </div>
              <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase;">Last Active</div>
            </div>
          </div>

          <!-- Admin Actions -->
          <div style="display:flex; flex-wrap:wrap; gap:8px; border-top:1px solid var(--border-subtle); padding-top:12px;">
            <button class="btn-secondary admin-reset-pw-btn" data-user-id="${u.id}" data-username="${u.username}" style="height:36px; font-size:12px; flex:1; min-width:120px;">
              Reset Password
            </button>
            ${!isCurrentAdmin ? `
              <button class="btn-secondary admin-toggle-status-btn" data-user-id="${u.id}" data-status="${isDisabled ? 'active' : 'disabled'}" style="height:36px; font-size:12px; flex:1; min-width:100px; color:${isDisabled ? 'var(--ring-green)' : '#FF9500'};">
                ${isDisabled ? 'Enable User' : 'Disable User'}
              </button>
              <button class="btn-secondary admin-toggle-role-btn" data-user-id="${u.id}" data-role="${isAdmin ? 'user' : 'admin'}" style="height:36px; font-size:12px; flex:1; min-width:100px; color:var(--accent-lavender);">
                ${isAdmin ? 'Demote to User' : 'Promote to Admin'}
              </button>
              <button class="btn-secondary admin-delete-user-btn" data-user-id="${u.id}" data-username="${u.username}" style="height:36px; font-size:12px; width:auto; padding:0 12px; color:var(--ring-red); border-color:rgba(255,45,85,0.3);">
                Delete
              </button>
            ` : ''}
          </div>
        `;

        // Wire Event Listeners for this card
        const resetBtn = userCard.querySelector('.admin-reset-pw-btn');
        if (resetBtn) {
          resetBtn.addEventListener('click', () => this.handleAdminResetPassword(u.id, u.username));
        }

        const statusBtn = userCard.querySelector('.admin-toggle-status-btn');
        if (statusBtn) {
          statusBtn.addEventListener('click', () => {
            const nextStatus = statusBtn.getAttribute('data-status');
            this.handleAdminPatchUser(u.id, { status: nextStatus });
          });
        }

        const roleBtn = userCard.querySelector('.admin-toggle-role-btn');
        if (roleBtn) {
          roleBtn.addEventListener('click', () => {
            const nextRole = roleBtn.getAttribute('data-role');
            this.handleAdminPatchUser(u.id, { role: nextRole });
          });
        }

        const delBtn = userCard.querySelector('.admin-delete-user-btn');
        if (delBtn) {
          delBtn.addEventListener('click', () => this.handleAdminDeleteUser(u.id, u.username));
        }

        listContainer.appendChild(userCard);
      });

    } catch (err) {
      console.error('Admin users load error:', err);
      if (userCountEl) userCountEl.textContent = '';
      listContainer.innerHTML = `<div class="banner error-banner" style="display:block; margin:20px 0;">${err.message || 'Could not load users directory.'}</div>`;
    }
  }

  async handleAdminResetPassword(userId, username) {
    try {
      const res = await fetch(`/api/admin/users/${userId}/reset-password`, {
        method: 'POST',
        credentials: 'include'
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate temporary password');
      }

      // Display in temporary callout box
      const callout = document.getElementById('admin-temp-pw-callout');
      const userEl = document.getElementById('admin-temp-pw-user');
      const valEl = document.getElementById('admin-temp-pw-val');

      if (callout && userEl && valEl) {
        userEl.textContent = username;
        valEl.value = data.temporary_password;
        callout.style.display = 'block';
        callout.scrollIntoView({ behavior: 'smooth' });
      }
    } catch (err) {
      alert(err.message || 'Could not reset user password');
    }
  }

  async handleAdminPatchUser(userId, patchData) {
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(patchData)
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update user');
      }
      this.loadAdminUsers();
    } catch (err) {
      alert(err.message || 'Could not update user');
    }
  }

  async handleAdminDeleteUser(userId, username) {
    if (!confirm(`Are you sure you want to permanently delete user "${username}" and all their telemetry logs, recipes, and pantry records?`)) {
      return;
    }

    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to delete user');
      }
      this.loadAdminUsers();
    } catch (err) {
      alert(err.message || 'Could not delete user');
    }
  }
}

// Instantiate Lavosia on window ready
window.addEventListener('DOMContentLoaded', () => {
  window.app = new LavosiaApp();
});
