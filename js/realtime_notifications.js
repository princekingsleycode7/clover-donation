/**
 * ==============================================================================
 * TURKANA WELLSPRING INITIATIVE — REAL-TIME DONATION NOTIFICATION ENGINE
 * (js/realtime_notifications.js)
 *
 * Real-time SSE (Server-Sent Events) listener that shows live celebration pop-ups
 * across all active users whenever anyone makes a donation.
 * ==============================================================================
 */

(function () {
  'use strict';

  const seenIds = new Set();
  let audioCtx = null;
  let eventSource = null;

  // Gentle audio chime using browser Web Audio API (no external MP3 asset needed)
  function playCelebrationChime() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;

      if (!audioCtx) {
        audioCtx = new AudioContextClass();
      }
      if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
      }

      const now = audioCtx.currentTime;

      // Note 1: High crisp pleasant chime (F#5: 739.99 Hz)
      const osc1 = audioCtx.createOscillator();
      const gain1 = audioCtx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(740, now);
      gain1.gain.setValueAtTime(0.08, now);
      gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
      osc1.connect(gain1);
      gain1.connect(audioCtx.destination);
      osc1.start(now);
      osc1.stop(now + 0.6);

      // Note 2: Warm harmonic chime (A5: 880 Hz, 0.1s later)
      const osc2 = audioCtx.createOscillator();
      const gain2 = audioCtx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(880, now + 0.08);
      gain2.gain.setValueAtTime(0.09, now + 0.08);
      gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);
      osc2.connect(gain2);
      gain2.connect(audioCtx.destination);
      osc2.start(now + 0.08);
      osc2.stop(now + 0.8);
    } catch (e) {
      // Audio autoplay policy or error — fail silently
    }
  }

  // Ensure floating notification container exists
  function getOrCreateContainer() {
    let container = document.getElementById('realtimeNotificationContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'realtimeNotificationContainer';
      container.className = 'realtime-toast-container';
      container.setAttribute('aria-live', 'polite');
      container.setAttribute('aria-atomic', 'true');
      document.body.appendChild(container);
    }
    return container;
  }

  // Format currency with proper symbol
  function formatAmount(amount, currency) {
    const num = Number(amount) || 0;
    const curr = (currency || 'USD').toUpperCase();
    if (curr === 'NGN') {
      return `₦${num.toLocaleString()}`;
    }
    if (curr === 'GBP') {
      return `£${num.toLocaleString()}`;
    }
    return `$${num.toLocaleString()}`;
  }

  // Display pop-up notification across the app
  function showDonationPopup(data) {
    if (!data) return;

    // Guard against duplicates
    const dedupeKey = data.id || `${data.donor_name}_${data.amount}_${data.currency}_${data.paystack_reference || ''}`;
    if (seenIds.has(dedupeKey)) return;
    seenIds.add(dedupeKey);

    // Keep set from growing unbounded
    if (seenIds.size > 200) {
      const first = seenIds.values().next().value;
      seenIds.delete(first);
    }

    const container = getOrCreateContainer();
    const donorName = data.donor_name || 'A generous supporter';
    const formattedAmount = formatAmount(data.amount, data.currency);
    const frequencyText = data.frequency === 'monthly' ? 'as a Monthly Sustainer' : '';

    const toast = document.createElement('div');
    toast.className = 'realtime-donation-toast';
    toast.setAttribute('role', 'status');

    toast.innerHTML = `
      <div class="toast-progress-bar"></div>
      <div class="toast-header-row">
        <div class="toast-badge">
          <span class="toast-icon-pulse">💧</span>
          <span class="toast-kicker">Live Contribution Alert</span>
        </div>
        <button type="button" class="toast-close-btn" aria-label="Dismiss notification">&times;</button>
      </div>
      <div class="toast-content-row">
        <div class="toast-avatar-ring">
          <span>${donorName.charAt(0).toUpperCase()}</span>
        </div>
        <div class="toast-body-text">
          <div class="toast-donor-headline">
            <strong class="toast-donor-name">${escapeHtml(donorName)}</strong>
            <span>just donated</span>
            <strong class="toast-amount-highlight">${formattedAmount}</strong>
            ${frequencyText ? `<span class="toast-freq-tag">${frequencyText}</span>` : ''}
          </div>
          <div class="toast-impact-sub">
            Solar clean water for families in Turkana County
          </div>
          <div class="toast-meta-footer">
            <span class="toast-time-label">Just now</span>
            <span class="toast-meta-dot">·</span>
            <span class="toast-verified-tag">✓ Verified Banking Settlement</span>
          </div>
        </div>
      </div>
    `;

    container.appendChild(toast);

    // Play subtle auditory celebration
    playCelebrationChime();

    // Trigger animation
    requestAnimationFrame(() => {
      toast.classList.add('toast-active');
    });

    // Auto-dismiss countdown (8 seconds)
    let dismissTimeout;
    const startDismissTimer = () => {
      dismissTimeout = setTimeout(() => {
        dismissToast(toast);
      }, 8000);
    };

    const clearDismissTimer = () => {
      if (dismissTimeout) clearTimeout(dismissTimeout);
    };

    startDismissTimer();

    // Pause on hover
    toast.addEventListener('mouseenter', () => {
      clearDismissTimer();
      const bar = toast.querySelector('.toast-progress-bar');
      if (bar) bar.style.animationPlayState = 'paused';
    });

    toast.addEventListener('mouseleave', () => {
      startDismissTimer();
      const bar = toast.querySelector('.toast-progress-bar');
      if (bar) bar.style.animationPlayState = 'running';
    });

    // Manual close button
    const closeBtn = toast.querySelector('.toast-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        clearDismissTimer();
        dismissToast(toast);
      });
    }

    // Optional click to view ledger
    toast.addEventListener('click', () => {
      const feedEl = document.getElementById('donations-feed') || document.getElementById('recentDonationsTableBody');
      if (feedEl) {
        feedEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });

    // Notify other components (app.js, history.js) to live update totals without refreshing!
    window.dispatchEvent(new CustomEvent('realtime:new_donation', { detail: data }));
  }

  function dismissToast(toast) {
    if (!toast || toast.classList.contains('toast-exit')) return;
    toast.classList.remove('toast-active');
    toast.classList.add('toast-exit');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 400);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  // ----------------------------------------------------------------------------
  // REAL-TIME SSE (Server-Sent Events) CONNECTION
  // ----------------------------------------------------------------------------
  function initSSEConnection() {
    if (typeof EventSource === 'undefined') return;

    let retryDelay = 2000;

    function connect() {
      try {
        if (eventSource) {
          eventSource.close();
        }

        eventSource = new EventSource('/api/donations/stream');

        eventSource.onopen = () => {
          retryDelay = 2000;
        };

        eventSource.onmessage = (event) => {
          if (!event.data) return;
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'donation' && data.payload) {
              showDonationPopup(data.payload);
            }
          } catch (e) {
            // Ignore non-json heartbeats
          }
        };

        eventSource.onerror = () => {
          eventSource.close();
          setTimeout(connect, retryDelay);
          retryDelay = Math.min(retryDelay * 1.5, 30000);
        };
      } catch (err) {
        setTimeout(connect, 5000);
      }
    }

    connect();
  }

  // ----------------------------------------------------------------------------
  // LOCAL CLIENT-SIDE PAYMENT COMPLETION LISTENER
  // ----------------------------------------------------------------------------
  function initLocalListeners() {
    window.addEventListener('donation:completed', (e) => {
      const detail = e.detail;
      if (!detail) return;

      showDonationPopup({
        id: detail.paystack_reference || `local_${Date.now()}`,
        donor_name: detail.is_anonymous ? 'A generous supporter' : (detail.donor_name || 'A generous supporter'),
        amount: detail.amount,
        currency: detail.currency || 'USD',
        frequency: detail.frequency || 'one_time',
        paystack_reference: detail.paystack_reference
      });
    });
  }

  // ----------------------------------------------------------------------------
  // SUPABASE REALTIME SUBSCRIPTION (Secondary redundancy layer)
  // ----------------------------------------------------------------------------
  function initSupabaseRealtime() {
    const env = window.__ENV__ || {};
    const url = localStorage.getItem('twp_supabase_url') || env.supabaseUrl;
    const key = localStorage.getItem('twp_supabase_anon_key') || env.supabaseAnonKey;

    if (window.supabase && url && key && !url.includes('mock-turkana')) {
      try {
        const client = window.supabase.createClient(url, key);
        client
          .channel('public:donations_realtime')
          .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'donations', filter: 'status=eq.success' },
            (payload) => {
              if (payload.new) {
                showDonationPopup({
                  id: payload.new.id,
                  donor_name: payload.new.is_anonymous ? 'A generous supporter' : (payload.new.donor_name || 'A generous supporter'),
                  amount: payload.new.amount,
                  currency: payload.new.currency,
                  frequency: payload.new.frequency,
                  paystack_reference: payload.new.paystack_reference
                });
              }
            }
          )
          .subscribe();
      } catch (e) {
        // Fallback to SSE
      }
    }
  }

  // ----------------------------------------------------------------------------
  // INITIALIZATION ON LOAD
  // ----------------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', () => {
    initSSEConnection();
    initLocalListeners();
    initSupabaseRealtime();
  });

  // Expose global manual trigger for testing
  window.TurkanaRealtime = {
    showPopup: showDonationPopup,
    playChime: playCelebrationChime
  };

})();
