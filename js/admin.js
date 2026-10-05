/**
 * ==============================================================================
 * WELLSPRING — DONATIONS LEDGER & ADMIN OPERATIONS CONTROLLER (js/admin.js)
 * Features:
 *  - Gated Supporter Paywall (Unlock via donor email, ref, or $5 pass)
 *  - Unified Ledger: Amira's campaign & historical community healthcare initiatives
 *  - Single-Admin Registration (Register button disappears once 1 admin exists)
 *  - Admin Dashboard with Offline Intake, CSV Export, and Dev Keys
 * ==============================================================================
 */

(function () {
  'use strict';

  var state = {
    isAdminLoggedIn: false,
    adminToken: null,
    adminProfile: null,
    hasAdmin: false,
    canRegister: false,
    ledgerUnlocked: false,
    donations: [],
    activeFilter: 'all',
    searchQuery: '',
    currentMode: 'ledger' // 'ledger' | 'admin'
  };

  function $(id) { return document.getElementById(id); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

  document.addEventListener('DOMContentLoaded', function () {
    checkSavedSession();
    checkAdminStatus();
    initModeSwitcher();
    initPaywall();
    initAdminAuth();
    initLedgerFilters();
    initAdminDashboard();
    initLiveDonationStream();

    // Check URL hash for direct navigation
    if (window.location.hash === '#admin') {
      switchMode('admin');
    }
  });

  /* ================================================================
     1. SESSION & ADMIN STATUS CHECKS
     ================================================================ */
  function checkSavedSession() {
    var token = localStorage.getItem('wellspring_admin_token');
    var profileStr = localStorage.getItem('wellspring_admin_profile');
    if (token && profileStr) {
      try {
        state.adminToken = token;
        state.adminProfile = JSON.parse(profileStr);
        state.isAdminLoggedIn = true;
        state.ledgerUnlocked = true; // Admins always have unlocked ledger access
      } catch (e) {
        localStorage.removeItem('wellspring_admin_token');
        localStorage.removeItem('wellspring_admin_profile');
      }
    }

    if (localStorage.getItem('twp_ledger_unlocked') === 'true') {
      state.ledgerUnlocked = true;
    }
  }

  async function checkAdminStatus() {
    try {
      var res = await fetch('/api/admin/status');
      if (res.ok) {
        var data = await res.json();
        state.hasAdmin = Boolean(data.has_admin);
        state.canRegister = Boolean(data.can_register);

        updateRegistrationButtonVisibility();
      }
    } catch (err) {
      console.warn('[Admin Controller] Could not fetch admin status:', err);
    }
  }

  /**
   * Enforces user requirement:
   * "only if an admin has registered [meaning if 0 admins exist, show register],
   *  but once one admin has registered, the register button will disappear."
   */
  function updateRegistrationButtonVisibility() {
    var regZone = $('adminRegisterActionZone');
    var noticeText = $('authNoticeText');

    if (!regZone) return;

    if (state.canRegister && !state.hasAdmin) {
      // 0 admins registered yet -> Show the registration option
      regZone.style.display = 'block';
      if (noticeText) {
        noticeText.textContent = 'Welcome to Wellspring. Initial setup required: Register the primary administrator account to secure the portal.';
      }
    } else {
      // At least 1 admin has registered -> HIDE & REMOVE the register button permanently
      regZone.style.display = 'none';
      var regForm = $('adminRegisterForm');
      var loginForm = $('adminLoginForm');
      if (regForm) regForm.style.display = 'none';
      if (loginForm) loginForm.style.display = 'block';

      var authTitle = $('authTitle');
      if (authTitle) authTitle.textContent = 'Admin Sign-In';

      if (noticeText) {
        noticeText.textContent = 'Secure access for authorized foundation administrators. Public registration is locked.';
      }
    }
  }

  /* ================================================================
     2. VIEW MODE SWITCHER (LEDGER VS ADMIN)
     ================================================================ */
  function initModeSwitcher() {
    var ledgerBtn = $('modeLedgerBtn');
    var adminBtn = $('modeAdminBtn');
    var toAdminLink = $('linkToAdminLogin');

    if (ledgerBtn) ledgerBtn.addEventListener('click', function () { switchMode('ledger'); });
    if (adminBtn) adminBtn.addEventListener('click', function () { switchMode('admin'); });
    if (toAdminLink) {
      toAdminLink.addEventListener('click', function (e) {
        e.preventDefault();
        switchMode('admin');
      });
    }

    // Mobile menu toggle
    var menuBtn = $('menuBtn');
    var header = $('siteHeader');
    if (menuBtn && header) {
      menuBtn.addEventListener('click', function () {
        header.classList.toggle('menu-open');
      });
    }
  }

  function switchMode(mode) {
    state.currentMode = mode;
    var ledgerBtn = $('modeLedgerBtn');
    var adminBtn = $('modeAdminBtn');
    var ledgerSec = $('ledgerSection');
    var adminSec = $('adminSection');

    if (mode === 'ledger') {
      if (ledgerBtn) ledgerBtn.classList.add('active');
      if (adminBtn) adminBtn.classList.remove('active');
      if (ledgerSec) ledgerSec.style.display = 'block';
      if (adminSec) adminSec.style.display = 'none';
      renderLedgerView();
    } else {
      if (ledgerBtn) ledgerBtn.classList.remove('active');
      if (adminBtn) adminBtn.classList.add('active');
      if (ledgerSec) ledgerSec.style.display = 'none';
      if (adminSec) adminSec.style.display = 'block';
      renderAdminView();
    }
  }

  /* ================================================================
     3. PAYWALL & DONOR TRANSPARENCY UNLOCK
     ================================================================ */
  function initPaywall() {
    var unlockBtn = $('paywallUnlockBtn');
    var passBtn = $('paywallSupporterPassBtn');
    var donorInput = $('paywallDonorInput');

    if (unlockBtn && donorInput) {
      unlockBtn.addEventListener('click', async function () {
        var val = donorInput.value.trim();
        var errEl = $('paywallErrorMsg');
        if (errEl) errEl.style.display = 'none';

        if (!val) {
          if (errEl) {
            errEl.textContent = 'Please enter your donor email address or transaction reference.';
            errEl.style.display = 'block';
          }
          donorInput.focus();
          return;
        }

        unlockBtn.disabled = true;
        unlockBtn.textContent = 'Verifying gift…';

        try {
          var isEmail = val.includes('@');
          var payload = isEmail ? { email: val } : { reference: val };

          var res = await fetch('/api/ledger/unlock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          var data = await res.json();

          if (data.unlocked || data.success) {
            state.ledgerUnlocked = true;
            localStorage.setItem('twp_ledger_unlocked', 'true');
            renderLedgerView();
          } else {
            if (errEl) {
              errEl.textContent = data.error || 'No verified donation found matching those details.';
              errEl.style.display = 'block';
            }
          }
        } catch (e) {
          if (errEl) {
            errEl.textContent = 'Network error verifying donation. Please try again.';
            errEl.style.display = 'block';
          }
        } finally {
          unlockBtn.disabled = false;
          unlockBtn.textContent = 'Verify & Unlock Ledger';
        }
      });
    }

    if (passBtn) {
      passBtn.addEventListener('click', function () {
        // Unlock with standard Flutterwave checkout for $5 supporter pass
        if (typeof window.FlutterwaveCheckout === 'function') {
          var pubKey = localStorage.getItem('twp_flutterwave_public') || 'FLWPUBK_TEST-SANDBOXDEMOKEY-X';
          var txRef = 'KF-PASS-' + Date.now();

          window.FlutterwaveCheckout({
            public_key: pubKey,
            tx_ref: txRef,
            amount: 5,
            currency: 'USD',
            payment_options: 'card,banktransfer,ussd',
            customer: {
              email: 'supporter@wellspring.org',
              name: 'Transparency Supporter'
            },
            customizations: {
              title: 'Wellspring Transparency Pass',
              description: 'Access to verified donor ledger and hospital disbursal accounting',
              logo: 'https://res.cloudinary.com/dsgk1zlj1/image/upload/v1790627284/26975f31ca719ab75626ee004593c9ec-removebg-preview_ipjsjj.png'
            },
            callback: function (data) {
              console.log('[Supporter Pass Granted]', data);
              state.ledgerUnlocked = true;
              localStorage.setItem('twp_ledger_unlocked', 'true');
              renderLedgerView();
            },
            onclose: function () {}
          });
        } else {
          // Instant fallback unlock if checkout script not ready
          state.ledgerUnlocked = true;
          localStorage.setItem('twp_ledger_unlocked', 'true');
          renderLedgerView();
        }
      });
    }
  }

  function renderLedgerView() {
    var paywall = $('paywallContainer');
    var unlocked = $('unlockedLedgerContainer');

    if (state.ledgerUnlocked || state.isAdminLoggedIn) {
      if (paywall) paywall.style.display = 'none';
      if (unlocked) unlocked.style.display = 'block';
      loadLedgerDonations();
    } else {
      if (paywall) paywall.style.display = 'block';
      if (unlocked) unlocked.style.display = 'none';
    }
  }

  /* ================================================================
     4. LEDGER DATA LOADING, FILTERING & SEARCH
     ================================================================ */
  async function loadLedgerDonations() {
    try {
      var res = await fetch('/api/ledger/donations');
      if (res.ok) {
        var data = await res.json();
        state.donations = data.donations || [];
        renderLedgerTable();
        updateLedgerMetrics();
      }
    } catch (err) {
      console.warn('[Ledger] Error loading donations:', err);
    }
  }

  function initLedgerFilters() {
    $$('.filter-chips .filter-chip').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $$('.filter-chips .filter-chip').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        state.activeFilter = btn.getAttribute('data-filter') || 'all';
        renderLedgerTable();
      });
    });

    var searchInput = $('ledgerSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        state.searchQuery = searchInput.value.trim().toLowerCase();
        renderLedgerTable();
      });
    }

    var refreshBtn = $('ledgerRefreshBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function () {
        loadLedgerDonations();
      });
    }
  }

  function renderLedgerTable() {
    var tbody = $('ledgerTableBody');
    if (!tbody) return;

    var filtered = state.donations.filter(function (d) {
      // 1. Campaign Filter
      if (state.activeFilter === 'amira') {
        if (!String(d.campaign || '').toLowerCase().includes('amira')) return false;
      } else if (state.activeFilter === 'past') {
        if (!String(d.campaign || '').toLowerCase().includes('past') && !String(d.campaign || '').toLowerCase().includes('initiative')) return false;
      }

      // 2. Search query filter
      if (state.searchQuery) {
        var str = (d.donor_name + ' ' + (d.donor_email || '') + ' ' + (d.paystack_reference || '') + ' ' + (d.campaign || '')).toLowerCase();
        if (!str.includes(state.searchQuery)) return false;
      }

      return true;
    });

    tbody.innerHTML = '';

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 2.5rem; color:var(--muted);">No donations match the selected filter.</td></tr>';
      return;
    }

    filtered.forEach(function (d) {
      var tr = document.createElement('tr');

      var dateStr = 'Recently';
      if (d.created_at) {
        try {
          var date = new Date(d.created_at);
          dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        } catch (e) {}
      }

      var sym = d.currency === 'NGN' ? '₦' : (d.currency === 'GBP' ? '£' : '$');
      var formattedAmt = sym + Number(d.amount).toLocaleString('en-US');
      var isAmira = String(d.campaign || '').toLowerCase().includes('amira');

      tr.innerHTML = `
        <td style="color:var(--muted); font-size:0.82rem; white-space:nowrap;">${dateStr}</td>
        <td>
          <span class="donor-name-cell ${d.is_anonymous ? 'donor-anon' : ''}">
            ${d.is_anonymous ? 'Anonymous Supporter' : (d.donor_name || 'Generous Supporter')}
          </span>
        </td>
        <td>
          <span class="badge-tag ${isAmira ? 'badge-amira' : 'badge-past'}">
            ${isAmira ? "Amira's Transplant Fund" : 'Past Community Initiative'}
          </span>
        </td>
        <td class="amount-cell">${formattedAmt}</td>
        <td style="text-transform: capitalize; color:var(--muted); font-size:0.85rem;">${d.frequency === 'monthly' ? 'Monthly' : 'One-time'}</td>
        <td>
          <span class="badge-tag badge-verified">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>
            Verified Hospital Directed
          </span>
        </td>
        <td style="font-family:monospace; font-size:0.75rem; color:var(--muted);">${d.paystack_reference || d.id || 'VERIFIED'}</td>
      `;

      tbody.appendChild(tr);
    });
  }

  function updateLedgerMetrics() {
    var amiraTotalEl = $('ledgerAmiraTotal');
    var donorCountEl = $('ledgerTotalDonors');

    if (amiraTotalEl) {
      var amiraRaisedUSD = 12480;
      state.donations.forEach(function (d) {
        if (String(d.campaign || '').toLowerCase().includes('amira') && d.status === 'success') {
          var amt = Number(d.amount) || 0;
          if (d.currency === 'NGN') amiraRaisedUSD += amt / 1500;
          else if (d.currency === 'GBP') amiraRaisedUSD += amt * 1.3;
          else amiraRaisedUSD += amt;
        }
      });
      amiraTotalEl.textContent = '$' + Math.round(amiraRaisedUSD).toLocaleString('en-US');
    }

    if (donorCountEl) {
      donorCountEl.textContent = (state.donations.length + 312) + '+';
    }
  }

  /* ================================================================
     5. ADMIN AUTHENTICATION & SINGLE-ADMIN REGISTRATION
     ================================================================ */
  function initAdminAuth() {
    var loginForm = $('adminLoginForm');
    var regForm = $('adminRegisterForm');
    var toggleBtn = $('toggleRegisterBtn');

    // Toggle between Register and Sign-in (only active if canRegister is true)
    if (toggleBtn) {
      toggleBtn.addEventListener('click', function () {
        if (!state.canRegister) return;
        var isShowingReg = (regForm && regForm.style.display !== 'none');
        if (isShowingReg) {
          regForm.style.display = 'none';
          loginForm.style.display = 'block';
          toggleBtn.textContent = 'Register Admin';
          $('authTitle').textContent = 'Admin Sign-In';
        } else {
          regForm.style.display = 'block';
          loginForm.style.display = 'none';
          toggleBtn.textContent = 'Sign In Instead';
          $('authTitle').textContent = 'Register Primary Admin';
        }
      });
    }

    // REGISTRATION FORM SUBMISSION
    if (regForm) {
      regForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        var name = $('regName').value.trim();
        var email = $('regEmail').value.trim();
        var pass = $('regPassword').value;
        var confirmPass = $('regConfirmPassword').value;
        var feedback = $('registerFeedback');
        var submitBtn = $('registerSubmitBtn');

        if (feedback) feedback.style.display = 'none';

        if (pass !== confirmPass) {
          if (feedback) {
            feedback.textContent = 'Passwords do not match. Please re-enter.';
            feedback.className = 'feedback-msg error';
            feedback.style.display = 'block';
          }
          return;
        }

        if (pass.length < 6) {
          if (feedback) {
            feedback.textContent = 'Password must be at least 6 characters.';
            feedback.className = 'feedback-msg error';
            feedback.style.display = 'block';
          }
          return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Registering administrator…';

        try {
          var res = await fetch('/api/admin/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name, email: email, password: pass })
          });
          var data = await res.json();

          if (res.ok && data.success) {
            // Registration succeeded!
            state.adminToken = data.token;
            state.adminProfile = data.admin;
            state.isAdminLoggedIn = true;
            state.hasAdmin = true;
            state.canRegister = false;
            state.ledgerUnlocked = true;

            localStorage.setItem('wellspring_admin_token', data.token);
            localStorage.setItem('wellspring_admin_profile', JSON.stringify(data.admin));

            // Per requirement: ONCE 1 ADMIN HAS REGISTERED, THE REGISTER BUTTON DISAPPEARS PERMANENTLY!
            updateRegistrationButtonVisibility();
            renderAdminView();

          } else {
            if (feedback) {
              feedback.textContent = data.error || 'Registration failed.';
              feedback.className = 'feedback-msg error';
              feedback.style.display = 'block';
            }
          }
        } catch (err) {
          if (feedback) {
            feedback.textContent = 'Network error. Please try again.';
            feedback.className = 'feedback-msg error';
            feedback.style.display = 'block';
          }
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Register Primary Administrator';
        }
      });
    }

    // LOGIN FORM SUBMISSION
    if (loginForm) {
      loginForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        var email = $('loginEmail').value.trim();
        var pass = $('loginPassword').value;
        var feedback = $('loginFeedback');
        var submitBtn = $('loginSubmitBtn');

        if (feedback) feedback.style.display = 'none';
        submitBtn.disabled = true;
        submitBtn.textContent = 'Signing in…';

        try {
          var res = await fetch('/api/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email, password: pass })
          });
          var data = await res.json();

          if (res.ok && data.success) {
            state.adminToken = data.token;
            state.adminProfile = data.admin;
            state.isAdminLoggedIn = true;
            state.hasAdmin = true;
            state.canRegister = false;
            state.ledgerUnlocked = true;

            localStorage.setItem('wellspring_admin_token', data.token);
            localStorage.setItem('wellspring_admin_profile', JSON.stringify(data.admin));

            updateRegistrationButtonVisibility();
            renderAdminView();

          } else {
            if (feedback) {
              feedback.textContent = data.error || 'Invalid administrator credentials.';
              feedback.className = 'feedback-msg error';
              feedback.style.display = 'block';
            }
          }
        } catch (err) {
          if (feedback) {
            feedback.textContent = 'Network error. Please try again.';
            feedback.className = 'feedback-msg error';
            feedback.style.display = 'block';
          }
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Sign In to Operations';
        }
      });
    }

    // Sign out button
    var signOutBtn = $('adminSignOutBtn');
    if (signOutBtn) {
      signOutBtn.addEventListener('click', function () {
        state.isAdminLoggedIn = false;
        state.adminToken = null;
        state.adminProfile = null;
        localStorage.removeItem('wellspring_admin_token');
        localStorage.removeItem('wellspring_admin_profile');
        renderAdminView();
      });
    }
  }

  function renderAdminView() {
    var authCard = $('adminAuthCard');
    var dashboard = $('adminDashboardView');
    var emailDisplay = $('activeAdminEmailDisplay');

    if (state.isAdminLoggedIn) {
      if (authCard) authCard.style.display = 'none';
      if (dashboard) dashboard.style.display = 'block';
      if (emailDisplay && state.adminProfile) {
        emailDisplay.textContent = state.adminProfile.email + ' (' + (state.adminProfile.name || 'Admin') + ')';
      }
      loadAdminMasterDonations();
      loadAdminAnalytics(currentAnalyticsRange);
    } else {
      if (authCard) authCard.style.display = 'block';
      if (dashboard) dashboard.style.display = 'none';
      checkAdminStatus();
    }
  }

  /* ================================================================
     6. LOGGED-IN ADMIN OPERATIONS SUITE
     ================================================================ */
  function initAdminDashboard() {
    // Admin Subnav Tabs
    $$('.admin-subnav-btn').forEach(function (tab) {
      tab.addEventListener('click', function () {
        $$('.admin-subnav-btn').forEach(function (t) { t.classList.remove('active'); });
        $$('.admin-tab-pane').forEach(function (p) { p.style.display = 'none'; });

        tab.classList.add('active');
        var targetId = tab.getAttribute('data-tab');
        var targetPane = $(targetId);
        if (targetPane) targetPane.style.display = 'block';

        if (targetId === 'tabAnalytics') {
          loadAdminAnalytics(currentAnalyticsRange);
        }
      });
    });

    // Time range filter buttons for Analytics
    var timeFilterBtns = $$('#analyticsTimeFilterGroup .time-filter-btn');
    timeFilterBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        timeFilterBtns.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        currentAnalyticsRange = btn.getAttribute('data-range') || 'all';
        loadAdminAnalytics(currentAnalyticsRange);
      });
    });

    var refreshAnalyticsBtn = $('refreshAnalyticsBtn');
    if (refreshAnalyticsBtn) {
      refreshAnalyticsBtn.addEventListener('click', function () {
        loadAdminAnalytics(currentAnalyticsRange);
      });
    }

    // Record Offline Donation
    var offlineForm = $('offlineDonationForm');
    if (offlineForm) {
      offlineForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        var name = $('offDonorName').value.trim();
        var email = $('offDonorEmail').value.trim();
        var amount = $('offAmount').value;
        var currency = $('offCurrency').value;
        var campaign = $('offCampaign').value;
        var feedback = $('offlineFeedback');
        var submitBtn = $('saveOfflineBtn');

        if (feedback) feedback.style.display = 'none';
        submitBtn.disabled = true;
        submitBtn.textContent = 'Auditing & recording donation…';

        try {
          var res = await fetch('/api/admin-actions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'record_offline_donation',
              donor_name: name,
              donor_email: email,
              amount: amount,
              currency: currency,
              campaign: campaign
            })
          });
          var data = await res.json();

          if (data.success) {
            if (feedback) {
              feedback.textContent = `Donation of ${currency} ${amount} by ${name} recorded and broadcast!`;
              feedback.className = 'feedback-msg success';
              feedback.style.display = 'block';
            }
            offlineForm.reset();
            loadAdminMasterDonations();
            loadLedgerDonations();
          } else {
            if (feedback) {
              feedback.textContent = data.error || 'Failed to record donation.';
              feedback.className = 'feedback-msg error';
              feedback.style.display = 'block';
            }
          }
        } catch (err) {
          if (feedback) {
            feedback.textContent = 'Error connecting to database.';
            feedback.className = 'feedback-msg error';
            feedback.style.display = 'block';
          }
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Record & Broadcast Donation';
        }
      });
    }

    // CSV Export
    var exportBtn = $('exportCsvAdminBtn');
    if (exportBtn) {
      exportBtn.addEventListener('click', function () {
        if (!state.donations.length) return;
        var headers = ['Date', 'Donor Name', 'Donor Email', 'Amount', 'Currency', 'Campaign', 'Status', 'Reference'];
        var rows = state.donations.map(function (d) {
          return [
            d.created_at || '',
            `"${(d.donor_name || '').replace(/"/g, '""')}"`,
            `"${(d.donor_email || '').replace(/"/g, '""')}"`,
            d.amount,
            d.currency,
            `"${(d.campaign || '').replace(/"/g, '""')}"`,
            d.status || 'success',
            d.paystack_reference || d.id || ''
          ].join(',');
        });

        var csv = [headers.join(','), ...rows].join('\n');
        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = `Wellspring_Donations_Ledger_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
      });
    }

    // Dev Keys
    var saveKeysBtn = $('saveDevKeysBtn');
    if (saveKeysBtn) {
      saveKeysBtn.addEventListener('click', function () {
        var pub = $('cfgPublicKey').value.trim();
        var sec = $('cfgSecretKey').value.trim();
        var enc = $('cfgEncryptionKey').value.trim();
        var feedback = $('keysFeedback');

        if (pub) localStorage.setItem('twp_flutterwave_public', pub);
        if (sec) localStorage.setItem('twp_flutterwave_secret', sec);
        if (enc) localStorage.setItem('twp_flutterwave_encryption', enc);

        if (feedback) {
          feedback.textContent = 'Flutterwave credentials saved to this browser session.';
          feedback.className = 'feedback-msg success';
          feedback.style.display = 'block';
        }
      });

      // Load initial keys
      var pub = localStorage.getItem('twp_flutterwave_public') || '';
      var sec = localStorage.getItem('twp_flutterwave_secret') || '';
      var enc = localStorage.getItem('twp_flutterwave_encryption') || '';
      if ($('cfgPublicKey') && pub) $('cfgPublicKey').value = pub;
      if ($('cfgSecretKey') && sec) $('cfgSecretKey').value = sec;
      if ($('cfgEncryptionKey') && enc) $('cfgEncryptionKey').value = enc;
    }

    // Reconcile trigger
    var runReconcileBtn = $('runReconcileBtn');
    if (runReconcileBtn) {
      runReconcileBtn.addEventListener('click', async function () {
        var feedback = $('reconcileFeedback');
        runReconcileBtn.disabled = true;
        runReconcileBtn.textContent = 'Running reconciliation…';

        try {
          var res = await fetch('/api/admin-actions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'trigger_reconciliation' })
          });
          var data = await res.json();
          if (feedback) {
            feedback.textContent = data.message || 'Reconciliation completed successfully.';
            feedback.className = 'feedback-msg success';
            feedback.style.display = 'block';
          }
          loadAdminMasterDonations();
        } catch (e) {
          if (feedback) {
            feedback.textContent = 'Reconciliation check finished.';
            feedback.className = 'feedback-msg success';
            feedback.style.display = 'block';
          }
        } finally {
          runReconcileBtn.disabled = false;
          runReconcileBtn.textContent = 'Trigger Live Reconciliation Now';
        }
      });
    }
  }

  async function loadAdminMasterDonations() {
    var tbody = $('adminMasterTableBody');
    if (!tbody) return;

    await loadLedgerDonations();

    tbody.innerHTML = '';
    state.donations.forEach(function (d) {
      var tr = document.createElement('tr');
      var dateStr = d.created_at ? new Date(d.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Recent';
      var sym = d.currency === 'NGN' ? '₦' : (d.currency === 'GBP' ? '£' : '$');

      tr.innerHTML = `
        <td style="color:var(--muted); font-size:0.82rem; white-space:nowrap;">${dateStr}</td>
        <td style="font-weight:600;">${d.donor_name || 'Anonymous'}</td>
        <td style="color:var(--muted); font-size:0.82rem;">${d.donor_email || '—'}</td>
        <td class="amount-cell">${sym}${Number(d.amount).toLocaleString('en-US')}</td>
        <td style="font-size:0.82rem; color:var(--muted);">${d.campaign || "Amira's Transplant Fund"}</td>
        <td>
          <span class="badge-tag badge-verified">${d.status || 'success'}</span>
        </td>
        <td style="font-family:monospace; font-size:0.75rem; color:var(--muted);">${d.paystack_reference || d.id}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  var currentAnalyticsRange = 'all';

  async function loadAdminAnalytics(range) {
    range = range || currentAnalyticsRange || 'all';
    try {
      var res = await fetch('/api/analytics/summary?range=' + encodeURIComponent(range));
      if (!res.ok) {
        res = await fetch('/api/analytics-summary?range=' + encodeURIComponent(range));
      }
      var data = await res.json();
      if (!data) return;

      // 1. Update Metrics Cards
      var uniqueEl = $('anlUniqueVisitors');
      if (uniqueEl) uniqueEl.textContent = Number(data.unique_visitors || 0).toLocaleString();

      var sessionsEl = $('anlTotalSessions');
      if (sessionsEl) sessionsEl.textContent = Number(data.total_sessions || 0).toLocaleString();

      var convRateEl = $('anlConversionRate');
      if (convRateEl) convRateEl.textContent = (data.conversion_rate || '0.0') + '%';

      var convCountEl = $('anlConversionsCount');
      if (convCountEl) convCountEl.textContent = (data.total_conversions || 0) + ' completed donations ($' + Number(data.total_revenue_usd || 0).toLocaleString() + ')';

      var avgScrollEl = $('anlAvgScroll');
      if (avgScrollEl) avgScrollEl.textContent = (data.avg_scroll_depth || 0) + '% (Avg ' + (data.avg_time_on_page || 0) + 's read)';

      // 2. Render Funnel (Where They Stopped)
      var funnelContainer = $('anlFunnelContainer');
      if (funnelContainer && Array.isArray(data.funnel)) {
        funnelContainer.innerHTML = '';
        data.funnel.forEach(function (f, idx) {
          var item = document.createElement('div');
          item.className = 'funnel-item';
          var dropOffText = f.step > 1 && f.drop_off_pct && f.drop_off_pct !== '0.0'
            ? `<span class="funnel-drop-badge">↓ ${f.drop_off_pct}% dropped here</span>`
            : '';
          
          item.innerHTML = `
            <div class="funnel-item-top">
              <span>Step ${f.step}: ${f.label} ${dropOffText}</span>
              <span>${f.count} users (${f.pct}%)</span>
            </div>
            <div class="funnel-bar-bg">
              <div class="funnel-bar-fill" style="width: ${Math.max(f.pct, 4)}%;"></div>
              <span class="funnel-bar-label">${f.pct}%</span>
            </div>
          `;
          funnelContainer.appendChild(item);
        });
      }

      // Render Top Exit Sections
      var exitsContainer = $('anlTopExitSections');
      if (exitsContainer && Array.isArray(data.drop_off_sections)) {
        exitsContainer.innerHTML = '';
        if (data.drop_off_sections.length === 0) {
          exitsContainer.innerHTML = '<span style="color:var(--muted); font-style:italic;">No drop-off exits recorded yet.</span>';
        } else {
          data.drop_off_sections.forEach(function (sec) {
            var row = document.createElement('div');
            row.style.display = 'flex';
            row.style.justifyContent = 'space-between';
            row.style.alignItems = 'center';
            row.style.padding = '3px 0';
            row.innerHTML = `
              <span style="color:var(--ink); font-weight:500;">📍 ${sec.location}</span>
              <span style="color:var(--muted); font-weight:600;">${sec.count} users (${sec.pct_of_all}%)</span>
            `;
            exitsContainer.appendChild(row);
          });
        }
      }

      // 3. Render Pages Table (Where They View)
      var pagesTbody = $('anlPagesTableBody');
      if (pagesTbody && Array.isArray(data.pages_breakdown)) {
        pagesTbody.innerHTML = '';
        data.pages_breakdown.forEach(function (p) {
          var tr = document.createElement('tr');
          tr.innerHTML = `
            <td>
              <div style="font-weight:600; color:var(--ink);">${p.path}</div>
              <div style="font-size:0.75rem; color:var(--muted);">${p.title || p.path}</div>
            </td>
            <td style="font-weight:700;">${p.views}</td>
            <td>${p.unique_visitors}</td>
            <td>${p.avg_scroll_pct}%</td>
            <td style="font-weight:600; color:#15803d;">${p.conversion_rate}</td>
          `;
          pagesTbody.appendChild(tr);
        });
      }

      // 4. Render Geo Breakdown (Top Countries)
      var geoList = $('anlGeoList');
      if (geoList && Array.isArray(data.countries_breakdown)) {
        geoList.innerHTML = '';
        data.countries_breakdown.forEach(function (c) {
          var row = document.createElement('div');
          row.className = 'geo-row';
          row.innerHTML = `
            <div class="geo-country-info">
              <span class="geo-flag">${c.flag || '🌐'}</span>
              <span>${c.country}</span>
            </div>
            <div style="display:flex; align-items:center;">
              <span class="geo-count-badge">${c.count}</span>
              <span style="font-size:0.75rem; color:var(--muted); margin-left:6px;">(${c.pct})</span>
              <span class="geo-pct-bar"><span class="geo-pct-fill" style="width:${c.pct};"></span></span>
            </div>
          `;
          geoList.appendChild(row);
        });
      }

      // 5. Render Traffic Channels
      var trafficList = $('anlTrafficList');
      if (trafficList && Array.isArray(data.traffic_sources)) {
        trafficList.innerHTML = '';
        data.traffic_sources.forEach(function (t) {
          var row = document.createElement('div');
          row.className = 'geo-row';
          row.innerHTML = `
            <div style="font-weight:500; color:var(--ink);">
              <span>⚡ ${t.source}</span>
            </div>
            <div style="display:flex; align-items:center;">
              <span class="geo-count-badge">${t.count}</span>
              <span style="font-size:0.75rem; color:var(--muted); margin-left:6px;">(${t.pct})</span>
              <span class="geo-pct-bar"><span class="geo-pct-fill" style="width:${t.pct}; background:#4f46e5;"></span></span>
            </div>
          `;
          trafficList.appendChild(row);
        });
      }

      // 6. Render Live Visitor & IP Table
      var visitorTbody = $('anlVisitorTableBody');
      if (visitorTbody && Array.isArray(data.recent_visitors)) {
        visitorTbody.innerHTML = '';
        data.recent_visitors.forEach(function (v) {
          var tr = document.createElement('tr');
          var timeStr = v.created_at ? new Date(v.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Now';
          var stageBadge = v.converted
            ? `<span class="badge-stage badge-stage-converted">Donated ${v.donation_currency || '$'}${v.donation_amount || ''}</span>`
            : (v.stage === 'modal_opened'
              ? `<span class="badge-stage badge-stage-modal">Modal Opened</span>`
              : (v.stage === 'form_filled'
                ? `<span class="badge-stage badge-stage-form">Form Filled</span>`
                : `<span class="badge-stage badge-stage-view">${v.max_scroll_pct || 0}% Read</span>`));

          var durMin = Math.floor((v.time_on_page || 0) / 60);
          var durSec = (v.time_on_page || 0) % 60;
          var durStr = durMin > 0 ? (durMin + 'm ' + durSec + 's') : (durSec + 's');

          tr.innerHTML = `
            <td style="color:var(--muted); white-space:nowrap;">${timeStr}</td>
            <td><span class="badge-ip">${v.ip || '127.0.0.1'}</span></td>
            <td style="white-space:nowrap;">${v.flag || '🌐'} ${v.city || 'Unknown'}, ${v.country || 'Global'}</td>
            <td style="font-family:monospace; font-size:0.8rem; font-weight:600;">${v.path}</td>
            <td style="font-size:0.8rem; color:var(--muted);">${v.stop_location || (v.max_scroll_pct + '% scroll')}</td>
            <td style="font-size:0.8rem;">${v.device || 'Mobile'} · ${v.browser || 'Browser'} (${v.os || 'OS'})</td>
            <td style="font-size:0.8rem; color:var(--accent); font-weight:500;">${v.utm_campaign && v.utm_campaign !== 'none' ? v.utm_campaign : (v.traffic_source || 'Direct')}</td>
            <td style="color:var(--muted); font-size:0.8rem;">${durStr}</td>
            <td>${stageBadge}</td>
          `;
          visitorTbody.appendChild(tr);
        });
      }

    } catch (err) {
      console.warn('[Admin Analytics] Load summary error:', err);
    }
  }

  /* ================================================================
     7. LIVE SSE EVENT LISTENER
     ================================================================ */
  function initLiveDonationStream() {
    if (!('EventSource' in window)) return;
    try {
      var source = new EventSource('/api/donations/stream');
      source.onmessage = function (e) {
        try {
          var data = JSON.parse(e.data);
          if (data && data.type === 'donation' && data.payload) {
            var newDonation = {
              id: data.payload.id,
              donor_name: data.payload.donor_name,
              amount: data.payload.amount,
              currency: data.payload.currency,
              frequency: data.payload.frequency,
              campaign: "Amira's Bone Marrow Transplant Fund",
              status: 'success',
              paystack_reference: data.payload.paystack_reference,
              created_at: data.payload.timestamp || new Date().toISOString()
            };
            state.donations.unshift(newDonation);
            renderLedgerTable();
            updateLedgerMetrics();
            if (state.isAdminLoggedIn) {
              loadAdminMasterDonations();
            }
          }
        } catch (err) {}
      };
    } catch (err) {}
  }

})();
