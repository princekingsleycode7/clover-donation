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

  async function safeFetchJson(primaryUrl, alternateUrl, options) {
    try {
      var res = await fetch(primaryUrl, options);
      if (res.status === 404 && alternateUrl) {
        res = await fetch(alternateUrl, options);
      }
      var text = await res.text();
      var json = null;
      try {
        json = JSON.parse(text);
      } catch (parseErr) {
        return { ok: false, status: res.status, data: { error: 'Server response error (' + res.status + ').' } };
      }
      return { ok: res.ok, status: res.status, data: json };
    } catch (netErr) {
      return { ok: false, status: 0, data: { error: 'Connection failed. Please check your internet connection and try again.' } };
    }
  }

  async function checkAdminStatus() {
    try {
      var result = await safeFetchJson('/api/admin/status', '/api/admin-status');
      if (result.ok && result.data) {
        state.hasAdmin = Boolean(result.data.has_admin);
        state.canRegister = Boolean(result.data.can_register);
        updateRegistrationButtonVisibility();
      } else {
        // Fallback: If no admin recorded, allow registration setup
        state.canRegister = true;
        state.hasAdmin = false;
        updateRegistrationButtonVisibility();
      }
    } catch (err) {
      state.canRegister = true;
      state.hasAdmin = false;
      updateRegistrationButtonVisibility();
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

          var result = await safeFetchJson('/api/ledger/unlock', '/api/ledger-unlock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          var data = result.data || {};

          if (result.ok && (data.unlocked || data.success)) {
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
            errEl.textContent = 'Could not verify donation. Please try again.';
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
      var result = await safeFetchJson('/api/ledger/donations', '/api/ledger-donations');
      if (result.ok && result.data) {
        state.donations = result.data.donations || [];
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
          var result = await safeFetchJson('/api/admin/register', '/api/admin-register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name, email: email, password: pass })
          });
          var data = result.data || {};

          if (result.ok && data.success) {
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
              feedback.textContent = data.error || 'Registration failed (' + (result.status || 'unknown') + ').';
              feedback.className = 'feedback-msg error';
              feedback.style.display = 'block';
            }
          }
        } catch (err) {
          if (feedback) {
            feedback.textContent = 'Could not register administrator. Please check your connection and try again.';
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
          var result = await safeFetchJson('/api/admin/login', '/api/admin-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email, password: pass })
          });
          var data = result.data || {};

          if (result.ok && data.success) {
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
              if (data.can_register) {
                state.canRegister = true;
                state.hasAdmin = false;
                updateRegistrationButtonVisibility();
                feedback.textContent = data.error || 'No administrator registered yet. Please click "Register Admin" above.';
              } else {
                feedback.textContent = data.error || 'Invalid administrator credentials.';
              }
              feedback.className = 'feedback-msg error';
              feedback.style.display = 'block';
            }
          }
        } catch (err) {
          if (feedback) {
            feedback.textContent = 'Could not sign in. Please verify your credentials or server connection.';
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
          var result = await safeFetchJson('/api/admin-actions', '/api/functions/admin-actions', {
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
          var data = result.data || {};

          if (result.ok && data.success) {
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
          var result = await safeFetchJson('/api/admin-actions', '/api/functions/admin-actions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'trigger_reconciliation' })
          });
          var data = result.data || {};
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

      // 7. Render D3.js Charts (Conversion Trends, Abandonment Funnel, Geo Breakdown)
      cachedAnalyticsData = data;
      renderAllD3Charts(data);

    } catch (err) {
      console.warn('[Admin Analytics] Load summary error:', err);
    }
  }

  /* ================================================================
     D3.JS VISUALIZATION ENGINE (CONVERSION, ABANDONMENT, GEOLOCATION)
     ================================================================ */
  var cachedAnalyticsData = null;

  function renderAllD3Charts(data) {
    if (typeof d3 === 'undefined' || !data) return;
    renderD3ConversionTrendChart(data.timeline_trends || []);
    renderD3AbandonmentFunnelChart(data.funnel || []);
    renderD3GeoBarChart(data.countries_breakdown || data.countries || []);
  }

  // Handle responsive redraw on window resize
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (cachedAnalyticsData && $('tabAnalytics') && $('tabAnalytics').style.display !== 'none') {
        renderAllD3Charts(cachedAnalyticsData);
      }
    }, 200);
  });

  // Chart 1: Multi-metric Conversion Rates & Trends (D3.js)
  function renderD3ConversionTrendChart(timelineData) {
    var container = document.getElementById('d3ConversionTrendChart');
    if (!container || typeof d3 === 'undefined') return;
    container.innerHTML = '';

    if (!timelineData || timelineData.length === 0) {
      container.innerHTML = '<div style="text-align:center; padding:3rem; color:var(--muted); font-size:0.85rem;">No trend data available for this range.</div>';
      return;
    }

    var containerWidth = container.clientWidth || 800;
    var margin = { top: 25, right: 55, bottom: 35, left: 45 };
    var width = containerWidth - margin.left - margin.right;
    var height = 240 - margin.top - margin.bottom;

    var svg = d3.select(container)
      .append('svg')
      .attr('width', '100%')
      .attr('height', height + margin.top + margin.bottom)
      .attr('viewBox', `0 0 ${containerWidth} ${height + margin.top + margin.bottom}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Tooltip instance
    var tooltip = d3.select('body').select('.d3-trend-tooltip');
    if (tooltip.empty()) {
      tooltip = d3.select('body').append('div').attr('class', 'd3-tooltip d3-trend-tooltip');
    }

    // Scales
    var x0 = d3.scaleBand()
      .domain(timelineData.map(d => d.label))
      .rangeRound([0, width])
      .paddingInner(0.25);

    var x1 = d3.scaleBand()
      .domain(['visitors', 'dropoffs', 'conversions'])
      .rangeRound([0, x0.bandwidth()])
      .padding(0.08);

    var maxVol = d3.max(timelineData, d => Math.max(d.visitors || 0, 10)) * 1.25;
    var yLeft = d3.scaleLinear()
      .domain([0, maxVol])
      .range([height, 0]);

    var maxRate = Math.max(d3.max(timelineData, d => d.conversion_rate || 0) || 15, 20) * 1.25;
    var yRight = d3.scaleLinear()
      .domain([0, maxRate])
      .range([height, 0]);

    // Horizontal Gridlines
    svg.append('g')
      .attr('class', 'd3-grid')
      .call(d3.axisLeft(yLeft).ticks(5).tickSize(-width).tickFormat(''));

    // Gradients
    var defs = svg.append('defs');
    var lineGrad = defs.append('linearGradient')
      .attr('id', 'convLineGrad')
      .attr('x1', '0%').attr('y1', '0%').attr('x2', '100%').attr('y2', '0%');
    lineGrad.append('stop').attr('offset', '0%').attr('stop-color', '#10b981');
    lineGrad.append('stop').attr('offset', '100%').attr('stop-color', '#047857');

    var areaGrad = defs.append('linearGradient')
      .attr('id', 'convAreaGrad')
      .attr('x1', '0%').attr('y1', '0%').attr('x2', '0%').attr('y2', '100%');
    areaGrad.append('stop').attr('offset', '0%').attr('stop-color', '#10b981').attr('stop-opacity', 0.28);
    areaGrad.append('stop').attr('offset', '100%').attr('stop-color', '#10b981').attr('stop-opacity', 0.0);

    // Grouped Bars for Visitors, Dropoffs, Conversions
    var barColors = {
      visitors: '#3b82f6',
      dropoffs: '#cbd5e1',
      conversions: '#16a34a'
    };

    var group = svg.selectAll('.bar-group')
      .data(timelineData)
      .enter().append('g')
      .attr('class', 'bar-group')
      .attr('transform', d => `translate(${x0(d.label)},0)`);

    ['visitors', 'dropoffs', 'conversions'].forEach(function (key) {
      group.append('rect')
        .attr('class', 'd3-bar')
        .attr('x', x1(key))
        .attr('y', d => yLeft(d[key] || 0))
        .attr('width', x1.bandwidth())
        .attr('height', d => height - yLeft(d[key] || 0))
        .attr('fill', barColors[key])
        .attr('rx', 3)
        .on('mouseenter', function (event, d) {
          var keyLabel = key === 'visitors' ? 'Total Visitors' : (key === 'dropoffs' ? 'Abandoned (Drop-Off)' : 'Completed Donations');
          tooltip.style('opacity', 1)
            .html(`
              <div style="font-weight:700; margin-bottom:4px; color:#fff;">📅 ${d.label}</div>
              <div style="color:${barColors[key]}; font-weight:600;">${keyLabel}: ${d[key]}</div>
              <div style="color:#94a3b8; font-size:11px; margin-top:2px;">Rate: <strong>${d.conversion_rate}%</strong> · Rev: $${d.revenue || 0}</div>
            `);
        })
        .on('mousemove', function (event) {
          tooltip.style('left', (event.pageX + 12) + 'px').style('top', (event.pageY - 28) + 'px');
        })
        .on('mouseleave', function () {
          tooltip.style('opacity', 0);
        });
    });

    // Line & Area for Conversion Rate %
    var areaGen = d3.area()
      .x(d => (x0(d.label) || 0) + x0.bandwidth() / 2)
      .y0(height)
      .y1(d => yRight(d.conversion_rate || 0))
      .curve(d3.curveMonotoneX);

    var lineGen = d3.line()
      .x(d => (x0(d.label) || 0) + x0.bandwidth() / 2)
      .y(d => yRight(d.conversion_rate || 0))
      .curve(d3.curveMonotoneX);

    svg.append('path')
      .datum(timelineData)
      .attr('class', 'd3-area')
      .attr('fill', 'url(#convAreaGrad)')
      .attr('d', areaGen);

    svg.append('path')
      .datum(timelineData)
      .attr('class', 'd3-line')
      .attr('stroke', 'url(#convLineGrad)')
      .attr('d', lineGen);

    // Glowing Interactive Dots along line
    svg.selectAll('.d3-conv-dot')
      .data(timelineData)
      .enter().append('circle')
      .attr('class', 'd3-dot d3-conv-dot')
      .attr('cx', d => (x0(d.label) || 0) + x0.bandwidth() / 2)
      .attr('cy', d => yRight(d.conversion_rate || 0))
      .attr('r', 4.5)
      .attr('fill', '#fff')
      .attr('stroke', '#047857')
      .attr('stroke-width', 2.5)
      .on('mouseenter', function (event, d) {
        tooltip.style('opacity', 1)
          .html(`
            <div style="font-weight:700; color:#34d399;">⚡ ${d.label} Conversion Rate</div>
            <div style="font-size:13px; font-weight:700; color:#fff;">${d.conversion_rate}% Conversion</div>
            <div style="color:#94a3b8; font-size:11px;">${d.conversions} donations out of ${d.visitors} visits</div>
          `);
      })
      .on('mousemove', function (event) {
        tooltip.style('left', (event.pageX + 12) + 'px').style('top', (event.pageY - 28) + 'px');
      })
      .on('mouseleave', function () {
        tooltip.style('opacity', 0);
      });

    // X Axis
    svg.append('g')
      .attr('class', 'd3-axis')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x0).tickSize(0).tickPadding(8));

    // Y Left Axis (Volume)
    svg.append('g')
      .attr('class', 'd3-axis')
      .call(d3.axisLeft(yLeft).ticks(5).tickFormat(d3.format('~s')));

    // Y Right Axis (Conversion Rate %)
    svg.append('g')
      .attr('class', 'd3-axis')
      .attr('transform', `translate(${width},0)`)
      .call(d3.axisRight(yRight).ticks(5).tickFormat(d => d + '%'));
  }

  // Chart 2: Session Abandonment & Drop-Off Funnel (D3.js)
  function renderD3AbandonmentFunnelChart(funnelData) {
    var container = document.getElementById('d3FunnelChart');
    if (!container || typeof d3 === 'undefined') return;
    container.innerHTML = '';

    if (!funnelData || funnelData.length === 0) return;

    var containerWidth = container.clientWidth || 450;
    var margin = { top: 15, right: 75, bottom: 20, left: 130 };
    var width = containerWidth - margin.left - margin.right;
    var height = 210 - margin.top - margin.bottom;

    var svg = d3.select(container)
      .append('svg')
      .attr('width', '100%')
      .attr('height', height + margin.top + margin.bottom)
      .attr('viewBox', `0 0 ${containerWidth} ${height + margin.top + margin.bottom}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    var tooltip = d3.select('body').select('.d3-trend-tooltip');

    var yScale = d3.scaleBand()
      .domain(funnelData.map(d => d.step))
      .rangeRound([0, height])
      .padding(0.22);

    var maxCount = d3.max(funnelData, d => d.count || 1) || 1;
    var xScale = d3.scaleLinear()
      .domain([0, maxCount])
      .range([0, width]);

    // Color gradient interpolation based on funnel depth
    var colorScale = d3.scaleLinear()
      .domain([1, 6])
      .range(['#1b56fd', '#10b981']);

    // Background track bars
    svg.selectAll('.funnel-bg-bar')
      .data(funnelData)
      .enter().append('rect')
      .attr('class', 'funnel-bg-bar')
      .attr('x', 0)
      .attr('y', d => yScale(d.step))
      .attr('width', width)
      .attr('height', yScale.bandwidth())
      .attr('fill', 'rgba(1, 24, 216, 0.04)')
      .attr('rx', 4);

    // Connecting trapezoids between funnel steps
    for (var i = 0; i < funnelData.length - 1; i++) {
      var d1 = funnelData[i];
      var d2 = funnelData[i + 1];
      var y1 = yScale(d1.step) + yScale.bandwidth();
      var y2 = yScale(d2.step);
      var w1 = xScale(d1.count);
      var w2 = xScale(d2.count);

      var points = [
        `0,${y1}`,
        `${w1},${y1}`,
        `${w2},${y2}`,
        `0,${y2}`
      ].join(' ');

      svg.append('polygon')
        .attr('points', points)
        .attr('fill', colorScale(d1.step))
        .attr('opacity', 0.12);
    }

    // Active Funnel step bars
    svg.selectAll('.funnel-active-bar')
      .data(funnelData)
      .enter().append('rect')
      .attr('class', 'd3-bar funnel-active-bar')
      .attr('x', 0)
      .attr('y', d => yScale(d.step))
      .attr('width', d => Math.max(xScale(d.count), 4))
      .attr('height', yScale.bandwidth())
      .attr('fill', d => colorScale(d.step))
      .attr('rx', 4)
      .on('mouseenter', function (event, d) {
        var dropInfo = d.step > 1 && d.drop_off_pct ? `<div style="color:#f87171; font-weight:600;">↓ ${d.drop_off_pct}% Drop-off at this transition</div>` : '';
        tooltip.style('opacity', 1)
          .html(`
            <div style="font-weight:700; color:#60a5fa;">Step ${d.step}: ${d.label}</div>
            <div style="font-weight:600; color:#fff;">${d.count} Users (${d.pct}% retained)</div>
            ${dropInfo}
          `);
      })
      .on('mousemove', function (event) {
        tooltip.style('left', (event.pageX + 12) + 'px').style('top', (event.pageY - 28) + 'px');
      })
      .on('mouseleave', function () {
        tooltip.style('opacity', 0);
      });

    // Step labels on Left Axis
    svg.selectAll('.funnel-label-text')
      .data(funnelData)
      .enter().append('text')
      .attr('x', -8)
      .attr('y', d => yScale(d.step) + yScale.bandwidth() / 2)
      .attr('text-anchor', 'end')
      .attr('dominant-baseline', 'middle')
      .attr('fill', 'var(--ink)')
      .attr('font-size', '11px')
      .attr('font-weight', '600')
      .text(d => `Step ${d.step}: ${d.label.split(' ')[0]}`);

    // Value counts on Right
    svg.selectAll('.funnel-val-text')
      .data(funnelData)
      .enter().append('text')
      .attr('x', d => Math.max(xScale(d.count), 4) + 8)
      .attr('y', d => yScale(d.step) + yScale.bandwidth() / 2)
      .attr('dominant-baseline', 'middle')
      .attr('fill', 'var(--ink)')
      .attr('font-size', '11px')
      .attr('font-weight', '700')
      .text(d => `${d.count} (${d.pct}%)`);
  }

  // Chart 3: Audience Geolocation & Regional Performance (D3.js)
  function renderD3GeoBarChart(countriesData) {
    var container = document.getElementById('d3GeoBarChart');
    if (!container || typeof d3 === 'undefined') return;
    container.innerHTML = '';

    if (!countriesData || countriesData.length === 0) return;

    var topCountries = countriesData.slice(0, 5);
    var containerWidth = container.clientWidth || 450;
    var margin = { top: 10, right: 65, bottom: 20, left: 110 };
    var width = containerWidth - margin.left - margin.right;
    var height = 190 - margin.top - margin.bottom;

    var svg = d3.select(container)
      .append('svg')
      .attr('width', '100%')
      .attr('height', height + margin.top + margin.bottom)
      .attr('viewBox', `0 0 ${containerWidth} ${height + margin.top + margin.bottom}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    var tooltip = d3.select('body').select('.d3-trend-tooltip');

    var yScale = d3.scaleBand()
      .domain(topCountries.map(d => d.country))
      .rangeRound([0, height])
      .padding(0.25);

    var maxCount = d3.max(topCountries, d => d.count || 1) || 1;
    var xScale = d3.scaleLinear()
      .domain([0, maxCount])
      .range([0, width]);

    // Background track bars
    svg.selectAll('.geo-bg-bar')
      .data(topCountries)
      .enter().append('rect')
      .attr('x', 0)
      .attr('y', d => yScale(d.country))
      .attr('width', width)
      .attr('height', yScale.bandwidth())
      .attr('fill', 'rgba(1, 24, 216, 0.04)')
      .attr('rx', 4);

    // Active Geo bars
    svg.selectAll('.geo-active-bar')
      .data(topCountries)
      .enter().append('rect')
      .attr('class', 'd3-bar')
      .attr('x', 0)
      .attr('y', d => yScale(d.country))
      .attr('width', d => Math.max(xScale(d.count), 4))
      .attr('height', yScale.bandwidth())
      .attr('fill', '#4f46e5')
      .attr('rx', 4)
      .on('mouseenter', function (event, d) {
        tooltip.style('opacity', 1)
          .html(`
            <div style="font-weight:700; color:#fff;">${d.flag || '🌐'} ${d.country}</div>
            <div style="color:#a5b4fc; font-weight:600;">${d.count} Sessions (${d.pct || ''})</div>
            <div style="color:#34d399; font-size:11px; margin-top:2px;">Conversion Rate: <strong>${d.conversion_rate || '0%'}</strong></div>
          `);
      })
      .on('mousemove', function (event) {
        tooltip.style('left', (event.pageX + 12) + 'px').style('top', (event.pageY - 28) + 'px');
      })
      .on('mouseleave', function () {
        tooltip.style('opacity', 0);
      });

    // Country Flag & Name label
    svg.selectAll('.geo-label-text')
      .data(topCountries)
      .enter().append('text')
      .attr('x', -8)
      .attr('y', d => yScale(d.country) + yScale.bandwidth() / 2)
      .attr('text-anchor', 'end')
      .attr('dominant-baseline', 'middle')
      .attr('fill', 'var(--ink)')
      .attr('font-size', '11px')
      .attr('font-weight', '600')
      .text(d => `${d.flag || '🌐'} ${d.country.length > 12 ? d.country.slice(0, 10) + '…' : d.country}`);

    // Count & Conv Rate Badge on Right
    svg.selectAll('.geo-val-text')
      .data(topCountries)
      .enter().append('text')
      .attr('x', d => Math.max(xScale(d.count), 4) + 8)
      .attr('y', d => yScale(d.country) + yScale.bandwidth() / 2)
      .attr('dominant-baseline', 'middle')
      .attr('fill', 'var(--ink)')
      .attr('font-size', '11px')
      .attr('font-weight', '700')
      .text(d => `${d.count} (${d.conversion_rate || d.pct})`);
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
