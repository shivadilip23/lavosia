/**
 * CORE CLOCK MODULE
 * -----------------------------------------------------------------------------
 * What this module does:
 *   Updates the real-time live clock and uppercase formatted date display
 *   in the app header every second.
 *
 * Screen(s) owned:
 *   Header clock display (#live-date, #live-time-hm, #live-time-sec, #live-time-period).
 *
 * Depends on:
 *   None (DOM only).
 * -----------------------------------------------------------------------------
 */

let clockInterval = null;

export function startLiveClock() {
  const updateTime = () => {
    const now = new Date();
    const dateEl = document.getElementById('live-date');
    const hmEl = document.getElementById('live-time-hm');
    const secEl = document.getElementById('live-time-sec');
    const periodEl = document.getElementById('live-time-period');

    if (dateEl) {
      dateEl.textContent = now.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric'
      }).toUpperCase();
    }

    let hours = now.getHours();
    const mins = String(now.getMinutes()).padStart(2, '0');
    const secs = String(now.getSeconds()).padStart(2, '0');
    const period = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;

    if (hmEl) hmEl.textContent = `${hours}:${mins}`;
    if (secEl) secEl.textContent = `:${secs}`;
    if (periodEl) periodEl.textContent = period;
  };

  updateTime();
  if (clockInterval) clearInterval(clockInterval);
  clockInterval = setInterval(updateTime, 1000);
}

export function stopLiveClock() {
  if (clockInterval) {
    clearInterval(clockInterval);
    clockInterval = null;
  }
}

export default {
  startLiveClock,
  stopLiveClock
};
