/**
 * CORE STATE MODULE
 * -----------------------------------------------------------------------------
 * What this module does:
 *   Centralized reactive/shared state for Lavosia client-side application.
 *   Provides access to current user profile, daily nutrition logs, pantry items,
 *   active analyzed meal, saved recipes, and scanner flags.
 *   Implements resetSessionState() to completely eradicate all session traces,
 *   cached inputs, forms, and rendered DOM upon logout or session termination.
 *
 * Screen(s) owned:
 *   Shared across all screens (screen-welcome through screen-admin).
 *
 * Depends on:
 *   None (root state store).
 * -----------------------------------------------------------------------------
 */

export function getDefaultUser() {
  return {
    id: null,
    username: 'Guest',
    role: 'user',
    isLoggedIn: false,
    age: 26,
    gender: 'male',
    height: 182,
    weight: 78,
    activityLevel: 'active',
    diet: 'Non-Veg',
    allergens: [],
    tdee: 2450,
    goals: {
      calories: 2200,
      protein: 165,
      carbs: 220,
      fats: 65,
      fiber: 35,
      water: 2.8
    }
  };
}

export function getDefaultTodayLog() {
  return {
    date: new Date().toISOString().split('T')[0],
    calories: 0,
    protein: 0,
    carbs: 0,
    fats: 0,
    fiber: 0,
    water: 0,
    history: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  };
}

export const state = {
  currentScreen: 'screen-welcome',
  navigationHistory: [],
  activeAnalyzedMeal: null,
  pantryItems: [], // Initial empty pantry, NOT demo staples
  user: getDefaultUser(),
  todayLog: getDefaultTodayLog(),
  savedRecipes: [],
  quaggaRunning: false,
  torchEnabled: false,
  logSyncTimeout: null
};

/**
 * Resets all in-memory state, stops camera streams, clears all forms/inputs,
 * wipes rendered private DOM, closes modals, and clears browser storage.
 */
export function resetSessionState() {
  // 1. Reset in-memory state
  state.user = getDefaultUser();
  state.todayLog = getDefaultTodayLog();
  state.savedRecipes = [];
  state.pantryItems = [];
  state.activeAnalyzedMeal = null;
  state.navigationHistory = [];
  state.currentScreen = 'screen-welcome';

  if (state.logSyncTimeout) {
    clearTimeout(state.logSyncTimeout);
    state.logSyncTimeout = null;
  }

  // Stop barcode scanner and media tracks
  state.quaggaRunning = false;
  state.torchEnabled = false;

  if (typeof window !== 'undefined') {
    if (typeof window.Quagga !== 'undefined' && window.Quagga.stop) {
      try {
        window.Quagga.stop();
      } catch (e) {}
    }

    if (window.app && typeof window.app.stopIngredientCamera === 'function') {
      try {
        window.app.stopIngredientCamera();
      } catch (e) {}
    }

    // Stop all active MediaStream tracks on any video element
    try {
      document.querySelectorAll('video').forEach((video) => {
        if (video.srcObject && typeof video.srcObject.getTracks === 'function') {
          video.srcObject.getTracks().forEach((track) => {
            try {
              track.stop();
            } catch (e) {}
          });
        }
        video.srcObject = null;
      });
    } catch (e) {}

    // 2. Clear every form and input in the app
    try {
      document.getElementById('login-form')?.reset();
      document.getElementById('signup-form')?.reset();
      document.getElementById('edit-profile-form')?.reset();

      // Clear all inputs and textareas (except submit/button)
      document.querySelectorAll('input:not([type="button"]):not([type="submit"]):not([type="reset"]), textarea').forEach((el) => {
        if (el.type === 'checkbox' || el.type === 'radio') {
          el.checked = false;
        } else {
          el.value = '';
        }
      });

      // Explicitly clean critical inputs
      const criticalInputIds = [
        'login-username', 'login-password',
        'signup-username', 'signup-password', 'signup-age', 'signup-height', 'signup-weight',
        'manual-log-cal', 'manual-log-protein', 'manual-log-carbs', 'manual-log-fats', 'manual-log-water',
        'pantry-input', 'swap-search-input', 'swap-barcode-input', 'swap-prod-name', 'swap-brand',
        'manual-barcode-input', 'ing-manual-text', 'ing-prod-name', 'ing-brand',
        'meal-user-note', 'meal-image-input', 'ing-file-input',
        'admin-temp-pw-val'
      ];
      criticalInputIds.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });

      // Uncheck all allergen checkboxes in signup form and allergen modal
      document.querySelectorAll('.allergen-checkbox, .signup-allergen-check, input[name="allergen"], input[type="checkbox"]').forEach((cb) => {
        cb.checked = false;
      });
    } catch (e) {}

    // 3. Clear rendered private DOM
    try {
      // Admin elements
      const adminList = document.getElementById('admin-users-list');
      if (adminList) adminList.innerHTML = '';

      const adminCallout = document.getElementById('admin-temp-pw-callout');
      if (adminCallout) adminCallout.style.display = 'none';

      const adminUser = document.getElementById('admin-temp-pw-user');
      if (adminUser) adminUser.textContent = '';

      const adminCount = document.getElementById('admin-user-count');
      if (adminCount) adminCount.textContent = '';

      // Saved recipes & meal prep
      const savedList = document.getElementById('saved-recipes-list');
      if (savedList) savedList.innerHTML = '';

      const mealprepOutput = document.getElementById('mealprep-recipe-output');
      if (mealprepOutput) {
        mealprepOutput.innerHTML = '';
        mealprepOutput.style.display = 'none';
      }

      const pantryContainer = document.getElementById('pantry-tags-container');
      if (pantryContainer) pantryContainer.innerHTML = '';

      // Food vision
      const visionResults = document.getElementById('image-analysis-results');
      if (visionResults) {
        visionResults.innerHTML = '';
        visionResults.style.display = 'none';
      }

      const visionItems = document.getElementById('image-analysis-items-container');
      if (visionItems) visionItems.innerHTML = '';

      const visionPreview = document.getElementById('image-analysis-preview');
      if (visionPreview) {
        visionPreview.src = '';
        visionPreview.style.display = 'none';
      }

      const dropzonePlaceholder = document.getElementById('image-dropzone-placeholder');
      if (dropzonePlaceholder) dropzonePlaceholder.style.display = 'flex';

      // Barcode, swaps, ingredients
      const barcodeCard = document.getElementById('barcode-result-card');
      if (barcodeCard) {
        barcodeCard.innerHTML = '';
        barcodeCard.style.display = 'none';
      }

      const swapResults = document.getElementById('swap-results');
      if (swapResults) swapResults.innerHTML = '';

      const ingResults = document.getElementById('ing-stage-results');
      if (ingResults) {
        ingResults.innerHTML = '';
        ingResults.style.display = 'none';
      }

      const ingChips = document.getElementById('ing-chips-container');
      if (ingChips) ingChips.innerHTML = '';

      // User profile displays
      const nameEl = document.getElementById('settings-user-name');
      if (nameEl) nameEl.textContent = 'Guest';

      const metaEl = document.getElementById('settings-user-meta');
      if (metaEl) metaEl.textContent = 'GUEST ACCOUNT';

      // Telemetry & rings display reset
      const moveVal = document.getElementById('telemetry-move-val');
      const proVal = document.getElementById('telemetry-protein-val');
      const waterVal = document.getElementById('telemetry-water-val');
      if (moveVal) moveVal.innerHTML = '0<span>/2,200 CAL</span>';
      if (proVal) proVal.innerHTML = '0<span>/165 G</span>';
      if (waterVal) waterVal.innerHTML = '0.00<span>/2.8 L</span>';

      const moveFill = document.getElementById('ring-fill-move');
      const proFill = document.getElementById('ring-fill-protein');
      const waterFill = document.getElementById('ring-fill-water');
      if (moveFill) moveFill.style.strokeDashoffset = '364.4';
      if (proFill) proFill.style.strokeDashoffset = '263.9';
      if (waterFill) waterFill.style.strokeDashoffset = '163.4';

      const calRemEl = document.getElementById('dash-cal-remaining');
      const calBudgetSub = document.getElementById('dash-cal-budget-sub');
      if (calRemEl) calRemEl.textContent = '2,200';
      if (calBudgetSub) calBudgetSub.textContent = '/2,200 CAL';

      const resetBar = (fillId, textId, label) => {
        const fill = document.getElementById(fillId);
        const txt = document.getElementById(textId);
        if (fill) fill.style.width = '0%';
        if (txt) txt.textContent = label;
      };
      resetBar('bar-protein-fill', 'bar-protein-text', '0g / 165g');
      resetBar('bar-carbs-fill', 'bar-carbs-text', '0g / 220g');
      resetBar('bar-fats-fill', 'bar-fats-text', '0g / 65g');
      resetBar('bar-fiber-fill', 'bar-fiber-text', '0g / 35g');

      const hydSub = document.getElementById('dash-hydration-sub');
      if (hydSub) hydSub.textContent = '0.00L logged of 2.8L goal';

      document.querySelectorAll('.chart-bar').forEach((bar) => {
        bar.style.height = '4%';
      });

      const chartLabel = document.getElementById('chart-progress-label');
      if (chartLabel) chartLabel.textContent = '0% of daily budget logged';

      // Error and notice banners
      document.querySelectorAll('.banner, .error-banner').forEach((b) => {
        b.style.display = 'none';
        b.textContent = '';
      });

      // Close all open modals
      const modalIds = [
        'allergen-modal',
        'edit-profile-modal',
        'manual-barcode-modal',
        'swap-barcode-modal',
        'migration-modal'
      ];
      modalIds.forEach((mId) => {
        const modal = document.getElementById(mId);
        if (modal) modal.style.display = 'none';
      });
      document.querySelectorAll('.modal, [id$="-modal"]').forEach((m) => {
        m.style.display = 'none';
      });

      // 4. Hide admin button
      const adminBtn = document.getElementById('settings-admin-panel-btn');
      if (adminBtn) adminBtn.style.display = 'none';
    } catch (e) {}

    // 5. Clear browser storage (localStorage and sessionStorage)
    try {
      const localKeys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('lavosia_') || k.includes('lavosia') || k.includes('auth') || k.includes('session') || k.includes('user'))) {
          localKeys.push(k);
        }
      }
      localKeys.forEach((k) => localStorage.removeItem(k));

      const sessionKeys = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && (k.startsWith('lavosia_') || k.includes('lavosia') || k.includes('auth') || k.includes('session') || k.includes('user'))) {
          sessionKeys.push(k);
        }
      }
      sessionKeys.forEach((k) => sessionStorage.removeItem(k));
    } catch (e) {}
  }
}

export default state;
