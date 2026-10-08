/**
 * CORE ROUTER MODULE
 * -----------------------------------------------------------------------------
 * What this module does:
 *   Handles screen navigation, history stack, active screen classes, tab bar
 *   visibility, and week bar display. Supports lifecycle hooks for features
 *   to execute code when entering or leaving screens.
 *
 * Screen(s) owned:
 *   Manages switching between all screens (screen-welcome to screen-admin)
 *   and tab navigation controls (.ios-tab-bar, #week-bar).
 *
 * Depends on:
 *   - core/state.js
 * -----------------------------------------------------------------------------
 */

import state from './state.js';

const routeListeners = [];

export function addRouteListener(listener) {
  if (typeof listener === 'function') {
    routeListeners.push(listener);
  }
}

export function updateActiveTab(screenId) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  if (screenId === 'screen-dashboard') {
    document.getElementById('tab-summary')?.classList.add('active');
  } else if (screenId === 'screen-recommendations') {
    document.getElementById('tab-recommendations')?.classList.add('active');
  } else if (screenId === 'screen-saved-recipes') {
    document.getElementById('tab-recipes')?.classList.add('active');
  } else if (screenId === 'screen-settings') {
    document.getElementById('tab-settings')?.classList.add('active');
  }
}

export function navigate(screenId, addToHistory = true) {
  const target = document.getElementById(screenId);
  if (!target) return;

  const previousScreen = state.currentScreen;

  if (addToHistory && state.currentScreen && state.currentScreen !== screenId) {
    state.navigationHistory.push(state.currentScreen);
  }

  // Hide all screens and activate target
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  target.classList.add('active');
  state.currentScreen = screenId;

  // Reset scroll position
  const viewport = document.querySelector('.screen-viewport');
  if (viewport) viewport.scrollTop = 0;

  // Handle tab bar visibility
  const tabBar = document.querySelector('.ios-tab-bar');
  const weekBar = document.getElementById('week-bar');
  const authScreens = ['screen-welcome', 'screen-login', 'screen-signup', 'screen-scan-barcode'];

  if (tabBar) {
    if (authScreens.includes(screenId)) {
      tabBar.style.display = 'none';
    } else {
      tabBar.style.display = 'flex';
      updateActiveTab(screenId);
    }
  }

  if (weekBar) {
    weekBar.classList.toggle('visible', screenId === 'screen-dashboard');
  }

  // Notify registered route listeners (for lifecycle hooks)
  for (const listener of routeListeners) {
    try {
      listener(screenId, previousScreen);
    } catch (err) {
      console.error('Route listener error:', err);
    }
  }
}

export function goBack(fallback = 'screen-dashboard') {
  if (!state.user.isLoggedIn) {
    navigate('screen-welcome', false);
    return;
  }
  const prev = state.navigationHistory.pop() || fallback;
  navigate(prev, false);
}

export default {
  navigate,
  goBack,
  updateActiveTab,
  addRouteListener
};
