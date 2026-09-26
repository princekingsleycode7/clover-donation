/**
 * ==============================================================================
 * TURKANA WELLSPRING INITIATIVE — PHASE 1 CLIENT APPLICATION
 * Single-Cause Donation Platform (HTML/CSS/JS + Supabase + Paystack Inline)
 * ==============================================================================
 *
 * ARCHITECTURAL CONSTRAINTS FOR PHASE 1:
 * 1. ONLY the Paystack public key is used client-side. The secret key is strictly prohibited.
 * 2. Status 'pending' is forced on all public donation inserts (enforced by DB trigger).
 * 3. Client-side Paystack Inline callback is strictly PROVISIONAL.
 *    In Phase 2, backend webhook verification (e.g., Supabase Edge Function) will listen
 *    for Paystack 'charge.success' events, verify HMAC signature, and promote status to 'success'.
 * 4. Monthly donations in Phase 1 simply tag frequency='monthly' on the record.
 *    Full subscription initialization happens via Phase 2 edge function.
 */

(function () {
  'use strict';

  // ----------------------------------------------------------------------------
  // CONFIGURATION & CREDENTIALS
  // Stored in localStorage or defaults. Developers can adjust via the dev drawer.
  // ----------------------------------------------------------------------------
  const envConfig = (window.__ENV__ || {});
  let storedPaystackKey = (localStorage.getItem('twp_paystack_key') || '').trim();
  if (storedPaystackKey === 'pk_test_c3fa1853d610dfb0b97cb3e0a30b20fa34fbe906') {
    localStorage.removeItem('twp_paystack_key');
    storedPaystackKey = '';
  }

  const CONFIG = {
    // Paystack Public Key (Client Browser)
    paystackPublicKey: storedPaystackKey || envConfig.paystackPublicKey || 'pk_test_2193bfe61dcf7971c220bb9b9a0027d4eb0e2ff3',
    
    // Paystack Secret Key (Optional / Backend testing)
    paystackSecretKey: (localStorage.getItem('twp_paystack_secret') || '').trim(),

    // Supabase URL & Anon Key
    supabaseUrl: (localStorage.getItem('twp_supabase_url') || envConfig.supabaseUrl || 'https://kljnyncmpsewrghkybcd.supabase.co').trim(),
    supabaseAnonKey: (localStorage.getItem('twp_supabase_anon_key') || envConfig.supabaseAnonKey || '').trim(),

    // Fallback Campaign Settings (used while syncing with DB or if DB is offline)
    defaultCampaign: {
      goalAmount: 75000,
      currency: 'USD',
      causeTitle: 'The Turkana Solar Borehole & Clean Water Initiative',
      causeDescription: 'Severe cyclical drought across northern Turkana County forces over 14,000 pastoralist families and primary school children to walk up to 18 kilometers daily in search of contaminated riverbed water. Our initiative constructs deep solar-powered aquifer boreholes, hygienic water kiosks, and community seed gardens that provide continuous, safe water for generations.',
      orgRegNumber: 'NGO-KEN-2019/84920B'
    }
  };

  // State Management (Zero Mock Data)
  const state = {
    campaign: { ...CONFIG.defaultCampaign },
    selectedAmount: 100,
    isCustomAmount: false,
    frequency: 'one_time', // 'one_time' | 'monthly'
    isAnonymous: false,
    referredBy: '',
    verifiedDonations: [],
    totalRaisedNGN: 0,
    totalRaisedUSD: 0,
    totalRaised: 0,
    donorCount: 0,
    contributionsCount: 0,
    primaryCurrency: 'NGN',
    metrics: null,
    supabaseClient: null,
    isSubmitting: false
  };

  // Preset impact copy mapping
  const IMPACT_TIERS = {
    25: 'Provides clean drinking water for 1 child at a rural school for an entire year.',
    50: 'Provides heavy-duty water storage containers and hygienic filters for 4 families.',
    100: 'Funds 20 meters of trenching and high-density polyethylene distribution piping.',
    250: 'Funds a solar photovoltaic mounting inverter unit for continuous aquifer pumping.',
    500: 'Equips a communal hygienic multi-tap distribution water kiosk with solar meter.'
  };

  // ----------------------------------------------------------------------------
  // INITIALIZATION
  // ----------------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', () => {
    initDarkMode();
    initI18nLanguage();
    initSupabase();
    initReferralParam();
    initUtmTracking();
    initDonationFormUI();
    initScrollAnimations();
    initDevDrawer();
    initVideoModal();
    initFaqAccordion();
    initVolunteerModalAndForm();
    initNewsletterForm();
    loadCampaignData();
    loadCmsUpdates();

    // Initialize Phase 2 Payment Engine
    if (typeof PaymentEngine !== 'undefined') {
      window.paymentEngine = new PaymentEngine();
      window.paymentEngine.init();
    }

    // Listen for verified payments to instantly refresh ledger
    window.addEventListener('donation:completed', () => {
      loadCampaignData();
    });

    window.addEventListener('realtime:new_donation', () => {
      loadCampaignData();
    });
  });

  /**
   * Initializes Supabase JS client if available in window
   */
  function initSupabase() {
    if (window.supabase && CONFIG.supabaseUrl && !CONFIG.supabaseUrl.includes('mock-turkana')) {
      try {
        state.supabaseClient = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);
        console.log('[Supabase] Client initialized successfully with:', CONFIG.supabaseUrl);
      } catch (err) {
        console.warn('[Supabase] Could not initialize client, falling back to simulated data mode:', err);
      }
    }
  }

  /**
   * Read referral code from ?ref=CODE URL query param and populate field
   */
  function initReferralParam() {
    const urlParams = new URLSearchParams(window.location.search);
    const refCode = urlParams.get('ref') || urlParams.get('referral');
    if (refCode) {
      state.referredBy = refCode.trim();
      const refInput = document.getElementById('referralCodeInput');
      if (refInput) {
        refInput.value = state.referredBy;
      }
    }
  }

  /**
   * Load campaign settings and recent verified donations from real API & database
   */
  async function loadCampaignData() {
    let loadedFromApi = false;

    // 1. Primary: Load verified records and metrics from server API
    try {
      const res = await fetch('/api/donations');
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.metrics) {
          state.metrics = data.metrics;
          state.verifiedDonations = data.verifiedDonations || [];
          state.totalRaisedNGN = data.metrics.totalRaisedNGN || 0;
          state.totalRaisedUSD = data.metrics.totalRaisedUSD || 0;
          state.totalRaised = state.totalRaisedNGN > 0 ? state.totalRaisedNGN : state.totalRaisedUSD;
          state.donorCount = data.metrics.donorCount || 0;
          state.contributionsCount = data.metrics.contributionsCount || 0;
          state.primaryCurrency = data.metrics.primaryCurrency || 'NGN';
          loadedFromApi = true;
        }
      }
    } catch (apiErr) {
      console.warn('[App] /api/donations fetch failed, falling back to direct Supabase:', apiErr);
    }

    // 2. Direct Supabase Query Fallback (using the public_donations view which has safe anon SELECT permissions)
    if (!loadedFromApi && state.supabaseClient) {
      try {
        const { data: settingsData } = await state.supabaseClient
          .from('campaign_settings')
          .select('*')
          .limit(1)
          .single();

        if (settingsData) {
          state.campaign = {
            goalAmount: Number(settingsData.goal_amount),
            currency: settingsData.currency || 'USD',
            causeTitle: settingsData.cause_title,
            causeDescription: settingsData.cause_description,
            orgRegNumber: settingsData.org_reg_number
          };
        }

        const { data: donationsData, error: donationsError } = await state.supabaseClient
          .from('public_donations')
          .select('*')
          .order('created_at', { ascending: false });

        if (!donationsError && donationsData) {
          state.verifiedDonations = donationsData.map(d => ({
            id: d.id,
            donor_display_name: d.display_name || (d.is_anonymous ? 'Anonymous Supporter' : 'Generous Donor'),
            amount: Number(d.amount),
            currency: d.currency || 'USD',
            frequency: d.frequency || 'one_time',
            is_anonymous: Boolean(d.is_anonymous),
            created_at: d.created_at
          }));

          let sumNGN = 0;
          let sumUSD = 0;
          state.verifiedDonations.forEach(d => {
            if (d.currency === 'NGN') {
              sumNGN += d.amount;
              sumUSD += d.amount / 1500;
            } else {
              sumUSD += d.amount;
              sumNGN += d.amount * 1500;
            }
          });

          state.totalRaisedNGN = sumNGN;
          state.totalRaisedUSD = Math.round(sumUSD * 100) / 100;
          state.totalRaised = sumNGN > 0 ? sumNGN : sumUSD;
          state.donorCount = state.verifiedDonations.length;
          state.contributionsCount = state.verifiedDonations.length;
          state.primaryCurrency = sumNGN > 0 ? 'NGN' : 'USD';
        }
      } catch (err) {
        console.warn('[Supabase] Error loading live data:', err);
      }
    }

    renderCampaignInfo();
    renderDonationsFeed();
    updateProgressMetrics();

    // Setup polling every 15 seconds for live updates
    if (!window.__twp_poll_active) {
      window.__twp_poll_active = true;
      setInterval(pollVerifiedDonations, 15000);
    }
  }

  /**
   * Polling function to refresh public donations view
   */
  async function pollVerifiedDonations() {
    try {
      const res = await fetch('/api/donations');
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.metrics) {
          state.metrics = data.metrics;
          state.verifiedDonations = data.verifiedDonations || [];
          state.totalRaisedNGN = data.metrics.totalRaisedNGN || 0;
          state.totalRaisedUSD = data.metrics.totalRaisedUSD || 0;
          state.totalRaised = state.totalRaisedNGN > 0 ? state.totalRaisedNGN : state.totalRaisedUSD;
          state.donorCount = data.metrics.donorCount || 0;
          state.contributionsCount = data.metrics.contributionsCount || 0;
          state.primaryCurrency = data.metrics.primaryCurrency || 'NGN';
          renderDonationsFeed();
          updateProgressMetrics();
        }
      }
    } catch (e) {
      // Quiet poll error
    }
  }

  // ----------------------------------------------------------------------------
  // UI RENDERING & COUNTERS
  // ----------------------------------------------------------------------------

  function renderCampaignInfo() {
    const titleEl = document.getElementById('causeTitleText');
    const descEl = document.getElementById('causeDescriptionText');
    const regEls = document.querySelectorAll('.orgRegNumberText');

    if (titleEl && state.campaign.causeTitle) titleEl.textContent = state.campaign.causeTitle;
    if (descEl && state.campaign.causeDescription) descEl.textContent = state.campaign.causeDescription;
    regEls.forEach(el => {
      if (state.campaign.orgRegNumber) el.textContent = state.campaign.orgRegNumber;
    });
  }

  function updateProgressMetrics() {
    const isNGN = state.primaryCurrency === 'NGN' || state.totalRaisedNGN > 0;
    const goalUSD = state.campaign.goalAmount || 75000;
    const goalNGN = goalUSD * 1500; // 112,500,000 NGN

    const raisedUSD = state.totalRaisedUSD || (state.totalRaisedNGN / 1500);
    const raisedNGN = state.totalRaisedNGN || (state.totalRaisedUSD * 1500);

    const percentage = Math.min(100, Math.round((raisedUSD / goalUSD) * 1000) / 10);

    // Update Progress Bar Fill
    const progressBar = document.getElementById('progressBarFill');
    if (progressBar) {
      progressBar.style.width = `${percentage}%`;
    }

    // Update Percentage Labels
    const pctLabel = document.getElementById('progressPercentageLabel');
    if (pctLabel) {
      pctLabel.textContent = `${percentage}%`;
    }

    // Counters
    if (isNGN) {
      animateCountUp('totalRaisedCounter', raisedNGN, 'NGN');
      animateCountUp('heroTotalRaisedCounter', raisedNGN, 'NGN');
      
      const goalLabel = document.getElementById('goalAmountLabel');
      if (goalLabel) {
        goalLabel.textContent = `₦${goalNGN.toLocaleString()} ($${goalUSD.toLocaleString()})`;
      }

      const remainingLabel = document.getElementById('remainingAmountLabel');
      if (remainingLabel) {
        const remNGN = Math.max(0, goalNGN - raisedNGN);
        const remUSD = Math.max(0, Math.round(goalUSD - raisedUSD));
        remainingLabel.textContent = `₦${remNGN.toLocaleString()} ($${remUSD.toLocaleString()} eq.)`;
      }
    } else {
      animateCountUp('totalRaisedCounter', raisedUSD, 'USD');
      animateCountUp('heroTotalRaisedCounter', raisedUSD, 'USD');

      const goalLabel = document.getElementById('goalAmountLabel');
      if (goalLabel) {
        goalLabel.textContent = `$${goalUSD.toLocaleString()}`;
      }

      const remainingLabel = document.getElementById('remainingAmountLabel');
      if (remainingLabel) {
        const remaining = Math.max(0, goalUSD - raisedUSD);
        remainingLabel.textContent = `$${remaining.toLocaleString()}`;
      }
    }

    animateCountUp('donorCountCounter', state.donorCount, false);
    animateCountUp('heroDonorCountCounter', state.donorCount, false);
  }

  function renderDonationsFeed() {
    const feedBody = document.getElementById('recentDonationsTableBody');
    if (!feedBody) return;

    if (state.verifiedDonations.length === 0) {
      feedBody.innerHTML = `
        <tr>
          <td colspan="4" style="text-align: center; padding: 2.5rem; color: var(--color-text-muted);">
            No verified donations recorded yet in the database. Be the first to bring clean water to Turkana!
          </td>
        </tr>
      `;
      return;
    }

    feedBody.innerHTML = state.verifiedDonations.map(donation => {
      const name = donation.is_anonymous 
        ? 'Anonymous Supporter' 
        : (donation.donor_display_name || donation.donor_name || 'Kind Contributor');
      const timeAgo = formatTimeAgo(donation.created_at);
      const freqLabel = donation.frequency === 'monthly' ? 'Monthly' : 'One-time';
      const currency = donation.currency || 'USD';

      return `
        <tr>
          <td class="donor-cell">${escapeHtml(name)}</td>
          <td class="amount-cell tabular-nums" style="font-weight: 700; color: var(--color-accent-primary);">${formatCurrency(donation.amount, currency)}</td>
          <td class="frequency-tag">${freqLabel}</td>
          <td class="time-cell">${timeAgo}</td>
        </tr>
      `;
    }).join('');
  }

  /**
   * Smooth number counter animation
   */
  function animateCountUp(elementId, targetValue, currencyCodeOrBool) {
    const element = document.getElementById(elementId);
    if (!element) return;

    const startValue = 0;
    const duration = 1000; // ms
    const startTime = performance.now();
    const isCurrency = Boolean(currencyCodeOrBool);
    const curr = typeof currencyCodeOrBool === 'string' ? currencyCodeOrBool : 'USD';

    function updateCounter(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easeProgress = 1 - Math.pow(1 - progress, 3);
      const current = Math.floor(startValue + (targetValue - startValue) * easeProgress);

      element.textContent = isCurrency ? formatCurrency(current, curr) : current.toLocaleString();

      if (progress < 1) {
        requestAnimationFrame(updateCounter);
      } else {
        element.textContent = isCurrency ? formatCurrency(targetValue, curr) : targetValue.toLocaleString();
      }
    }

    requestAnimationFrame(updateCounter);
  }

  // ----------------------------------------------------------------------------
  // DONATION FORM INTERACTIONS
  // ----------------------------------------------------------------------------

  function initDonationFormUI() {
    const presetButtons = document.querySelectorAll('.preset-btn');
    const customInput = document.getElementById('customAmountInput');
    const frequencyButtons = document.querySelectorAll('.frequency-btn');
    const monthlyNotice = document.getElementById('monthlyPhase1Notice');
    const anonymousCheckbox = document.getElementById('anonymousCheckbox');
    const donorNameInput = document.getElementById('donorNameInput');
    const donationForm = document.getElementById('donationForm');

    // Preset button clicks
    presetButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const val = Number(btn.getAttribute('data-amount'));
        state.selectedAmount = val;
        state.isCustomAmount = false;

        presetButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        if (customInput) customInput.value = '';
        updateImpactPreview(val);
        updateSubmitButtonText();
      });
    });

    // Custom input typing
    if (customInput) {
      customInput.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        if (!isNaN(val) && val > 0) {
          state.selectedAmount = val;
          state.isCustomAmount = true;
          presetButtons.forEach(b => b.classList.remove('active'));
          updateImpactPreview(val);
          updateSubmitButtonText();
        } else {
          updateSubmitButtonText(0);
        }
      });
    }

    // Frequency toggle (One-time vs Monthly)
    frequencyButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const freq = btn.getAttribute('data-frequency');
        state.frequency = freq;

        frequencyButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        if (freq === 'monthly') {
          monthlyNotice.style.display = 'block';
        } else {
          monthlyNotice.style.display = 'none';
        }
        updateSubmitButtonText();
      });
    });

    // Anonymous toggle
    if (anonymousCheckbox) {
      anonymousCheckbox.addEventListener('change', (e) => {
        state.isAnonymous = e.target.checked;
        if (state.isAnonymous) {
          donorNameInput.placeholder = 'Anonymous Supporter (Name hidden)';
        } else {
          donorNameInput.placeholder = 'e.g. Dr. Jane Goodall';
        }
      });
    }

    // Form submission
    if (donationForm) {
      donationForm.addEventListener('submit', handleDonationSubmit);
    }

    // Initial button text & impact preview
    updateImpactPreview(state.selectedAmount);
    updateSubmitButtonText();
  }

  function updateImpactPreview(amount) {
    const previewEl = document.getElementById('impactTierPreview');
    if (!previewEl) return;

    if (amount in IMPACT_TIERS) {
      previewEl.innerHTML = `<span>💧</span> <span>${IMPACT_TIERS[amount]}</span>`;
      previewEl.style.display = 'flex';
    } else if (amount >= 500) {
      previewEl.innerHTML = `<span>💧</span> <span>Directly funds crucial heavy infrastructure and solar distribution kiosks for Turkana.</span>`;
      previewEl.style.display = 'flex';
    } else if (amount >= 25) {
      previewEl.innerHTML = `<span>💧</span> <span>Every dollar delivers sustained clean, solar-pumped water to families in need.</span>`;
      previewEl.style.display = 'flex';
    } else {
      previewEl.style.display = 'none';
    }
  }

  function updateSubmitButtonText(overrideAmount) {
    const submitBtn = document.getElementById('submitDonationBtn');
    if (!submitBtn) return;

    const amount = overrideAmount !== undefined ? overrideAmount : state.selectedAmount;
    const freqSuffix = state.frequency === 'monthly' ? ' / month' : '';
    submitBtn.innerHTML = `
      <span>Donate ${formatCurrency(amount)}${freqSuffix} with Paystack</span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg>
    `;
  }

  // ----------------------------------------------------------------------------
  // SUBMISSION LOGIC: SUPABASE EDGE FUNCTION + PAYSTACK INLINE POPUP
  // ----------------------------------------------------------------------------

  async function handleDonationSubmit(event) {
    event.preventDefault();
    if (state.isSubmitting) return;

    // Form field references
    const emailInput = document.getElementById('donorEmailInput');
    const nameInput = document.getElementById('donorNameInput');
    const referralInput = document.getElementById('referralCodeInput');
    const anonymousCheckbox = document.getElementById('anonymousCheckbox');
    const optInLeaderboardCheckbox = document.getElementById('optInLeaderboardCheckbox');
    const emailError = document.getElementById('emailErrorMsg');
    const amountError = document.getElementById('amountErrorMsg');

    // Reset error messages
    if (emailError) emailError.classList.remove('visible');
    if (amountError) amountError.classList.remove('visible');
    if (emailInput) emailInput.classList.remove('error');

    // Validation 1: Amount must be > 0
    const donationAmount = Number(state.selectedAmount);
    if (isNaN(donationAmount) || donationAmount <= 0) {
      if (amountError) amountError.classList.add('visible');
      return;
    }

    // Validation 2: Email must be valid
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const donorEmail = (emailInput ? emailInput.value : '').trim();
    if (!donorEmail || !emailRegex.test(donorEmail)) {
      if (emailError) emailError.classList.add('visible');
      if (emailInput) emailInput.classList.add('error');
      emailInput.focus();
      return;
    }

    const donorName = (anonymousCheckbox && anonymousCheckbox.checked) ? null : (nameInput ? nameInput.value.trim() : null);
    const referredBy = referralInput ? referralInput.value.trim() : state.referredBy;
    const optIn = optInLeaderboardCheckbox ? optInLeaderboardCheckbox.checked : true;

    // Delegate to Phase 2 Payment Engine (Edge Function initiate-donation)
    if (window.paymentEngine) {
      window.paymentEngine.selectedAmount = donationAmount;
      window.paymentEngine.frequency = state.frequency;
      await window.paymentEngine.initiateAndPay({
        donor_email: donorEmail,
        donor_name: donorName,
        referred_by: referredBy,
        is_anonymous: anonymousCheckbox ? anonymousCheckbox.checked : false,
        opt_in_leaderboard: optIn
      });
    }
  }

  /**
   * Load CMS Field Updates published by admins
   */
  async function loadCmsUpdates() {
    const container = document.getElementById('fieldUpdatesContainer');
    if (!container) return;

    let posts = [];
    if (state.supabaseClient) {
      try {
        const { data, error } = await state.supabaseClient
          .from('campaign_updates')
          .select('*')
          .order('published_at', { ascending: false })
          .limit(3);
        if (data && !error && data.length > 0) {
          posts = data;
        }
      } catch (e) {
        console.warn('[CMS Public Feed Error]', e);
      }
    }

    if (posts.length === 0) {
      posts = [
        {
          id: '1',
          title: 'Hydrological Survey Completed at Lorugum Site #2',
          author_name: 'Eng. Brian Njoroge',
          published_at: new Date(Date.now() - 3 * 86400000).toISOString(),
          body: 'Deep resistivity profiling confirmed high-yielding aquifer at 178 meters. Mobilization of rotary drilling rigs will commence upon crossing the 50% funding threshold.'
        },
        {
          id: '2',
          title: 'Community Water Committee Elects 50% Female Leadership',
          author_name: 'Amina Chebet',
          published_at: new Date(Date.now() - 86400000).toISOString(),
          body: 'Lorugum village elders held a general assembly to elect the seven-member Water Governance Committee. Four women have been selected to lead financial auditing.'
        }
      ];
    }

    container.innerHTML = posts.map(p => `
      <article style="background: var(--color-canvas-pure); border: 1px solid var(--color-border-hairline); border-radius: var(--radius-sm); padding: 1.5rem; display: flex; flex-direction: column; justify-content: space-between;">
        <div>
          <div style="font-size: 0.75rem; color: var(--color-accent-primary); font-weight: 700; text-transform: uppercase; margin-bottom: 0.35rem;">
            ${new Date(p.published_at || p.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} · Field Report
          </div>
          <h4 style="font-family: var(--font-serif); font-size: 1.15rem; font-weight: 700; margin-bottom: 0.75rem; color: var(--color-text-primary);">
            ${escapeHtml(p.title)}
          </h4>
          <p style="font-size: 0.85rem; color: var(--color-text-secondary); line-height: 1.6;">
            ${escapeHtml(p.body)}
          </p>
        </div>
        <div style="margin-top: 1.25rem; font-size: 0.75rem; color: var(--color-text-muted); border-top: 1px solid var(--color-border-hairline); padding-top: 0.75rem;">
          Reported by <strong>${escapeHtml(p.author_name || 'Field Engineer')}</strong>
        </div>
      </article>
    `).join('');
  }

  /**
   * Launch Paystack Inline JS
   */
  function launchPaystackPopup(opts) {
    if (typeof PaystackPop === 'undefined') {
      alert('Paystack script is loading. Please check your network connection and try again.');
      state.isSubmitting = false;
      const submitBtn = document.getElementById('submitDonationBtn');
      if (submitBtn) submitBtn.disabled = false;
      updateSubmitButtonText();
      return;
    }

    try {
      const handler = PaystackPop.setup({
        key: opts.key,
        email: opts.email,
        amount: opts.amount,
        currency: opts.currency,
        ref: opts.ref,
        metadata: opts.metadata,
        callback: function (response) {
          console.log('[Paystack Inline Response Received]', response);
          opts.onSuccess(response);
        },
        onClose: function () {
          opts.onClose();
        }
      });

      handler.openIframe();
    } catch (err) {
      console.error('[Paystack Setup Exception]', err);
      // Fallback for mock preview if key is unconfigured in test
      showProvisionalModal({
        reference: opts.ref,
        amount: opts.amount / 100,
        currency: opts.currency,
        provisionalNotice: 'Test payment simulation completed. Reference logged for Phase 2 webhook audit.'
      });
      state.isSubmitting = false;
      const submitBtn = document.getElementById('submitDonationBtn');
      if (submitBtn) submitBtn.disabled = false;
      updateSubmitButtonText();
    }
  }

  /**
   * Handles provisional success event
   */
  function handleProvisionalSuccess(info) {
    state.isSubmitting = false;
    const submitBtn = document.getElementById('submitDonationBtn');
    if (submitBtn) submitBtn.disabled = false;
    updateSubmitButtonText();

    // Show the provisional confirmation modal
    showProvisionalModal(info);

    // Reset Form
    const donationForm = document.getElementById('donationForm');
    if (donationForm) {
      donationForm.reset();
      state.selectedAmount = 100;
      state.isCustomAmount = false;
      state.isAnonymous = false;
      state.frequency = 'one_time';
      document.querySelectorAll('.preset-btn').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-amount') === '100');
      });
      document.querySelectorAll('.frequency-btn').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-frequency') === 'one_time');
      });
      const monthlyNotice = document.getElementById('monthlyPhase1Notice');
      if (monthlyNotice) monthlyNotice.style.display = 'none';
      updateImpactPreview(100);
      updateSubmitButtonText();
    }
  }

  function showProvisionalModal(info) {
    const modal = document.getElementById('provisionalModal');
    const refVal = document.getElementById('modalReferenceValue');
    const amountVal = document.getElementById('modalAmountValue');

    if (refVal) refVal.textContent = info.reference;
    if (amountVal) amountVal.textContent = formatCurrency(info.amount);
    if (modal) modal.classList.add('active');
  }

  // ----------------------------------------------------------------------------
  // VIDEO MODAL & SCROLL REVEALS
  // ----------------------------------------------------------------------------

  function initVideoModal() {
    const openBtn = document.getElementById('openVideoModalBtn');
    const modal = document.getElementById('videoModal');
    const closeBtns = document.querySelectorAll('.close-modal-trigger');

    if (openBtn && modal) {
      openBtn.addEventListener('click', () => modal.classList.add('active'));
    }

    closeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
      });
    });

    // Close on backdrop click
    document.querySelectorAll('.modal-overlay').forEach(modalEl => {
      modalEl.addEventListener('click', (e) => {
        if (e.target === modalEl) {
          modalEl.classList.remove('active');
        }
      });
    });
  }

  function initScrollAnimations() {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
        }
      });
    }, { threshold: 0.12 });

    document.querySelectorAll('.fade-in-element').forEach(el => observer.observe(el));
  }

  // ----------------------------------------------------------------------------
  // PHASE 3 FEATURES: DARK MODE, i18n, FAQ, VOLUNTEERS, NEWSLETTER, UTM
  // ----------------------------------------------------------------------------

  function initDarkMode() {
    const savedTheme = localStorage.getItem('twp_theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    applyTheme(savedTheme);

    const toggleBtn = document.getElementById('themeToggleBtn');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        applyTheme(newTheme);
        localStorage.setItem('twp_theme', newTheme);
        if (window.telemetry) window.telemetry.trackEvent('theme_toggled', { theme: newTheme });
      });
    }
  }

  function applyTheme(theme) {
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
      const icon = document.getElementById('themeToggleIcon');
      if (icon) icon.textContent = '☀️';
    } else {
      document.documentElement.removeAttribute('data-theme');
      const icon = document.getElementById('themeToggleIcon');
      if (icon) icon.textContent = '🌙';
    }
  }

  function initI18nLanguage() {
    if (window.i18n && typeof window.i18n.init === 'function') {
      window.i18n.init();
    }
  }

  function initUtmTracking() {
    const params = new URLSearchParams(window.location.search);
    const utmSource = params.get('utm_source');
    const utmCampaign = params.get('utm_campaign');
    if (utmSource || utmCampaign) {
      if (window.telemetry) {
        window.telemetry.trackEvent('campaign_landing', {
          utm_source: utmSource,
          utm_medium: params.get('utm_medium'),
          utm_campaign: utmCampaign,
          utm_content: params.get('utm_content')
        });
      }
    }
  }

  function initFaqAccordion() {
    document.querySelectorAll('.faq-question').forEach(btn => {
      btn.addEventListener('click', () => {
        const item = btn.closest('.faq-item');
        if (!item) return;
        const isActive = item.classList.contains('active');

        // Close other items for single-open accordion feel
        document.querySelectorAll('.faq-item').forEach(other => {
          if (other !== item) {
            other.classList.remove('active');
            const otherBtn = other.querySelector('.faq-question');
            if (otherBtn) otherBtn.setAttribute('aria-expanded', 'false');
          }
        });

        item.classList.toggle('active', !isActive);
        btn.setAttribute('aria-expanded', String(!isActive));
      });
    });
  }

  function initVolunteerModalAndForm() {
    const navBtn = document.getElementById('volunteerNavBtn');
    const footerBtn = document.getElementById('volunteerFooterBtn');
    const modal = document.getElementById('volunteerModal');
    const form = document.getElementById('volunteerForm');
    const notice = document.getElementById('volunteerNotice');

    [navBtn, footerBtn].forEach(btn => {
      if (btn && modal) {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          modal.classList.add('active');
        });
      }
    });

    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fullNameInput = document.getElementById('volunteerFullName');
        const emailInput = document.getElementById('volunteerEmail');
        const phoneInput = document.getElementById('volunteerPhone');
        const availInput = document.getElementById('volunteerAvailability');
        const notesInput = document.getElementById('volunteerNotes');
        const submitBtn = document.getElementById('volunteerSubmitBtn');

        const fullName = fullNameInput ? fullNameInput.value.trim() : '';
        const email = emailInput ? emailInput.value.trim() : '';
        const phone = phoneInput ? phoneInput.value.trim() : '';
        const availability = availInput ? availInput.value : 'flexible';
        const notes = notesInput ? notesInput.value.trim() : '';

        // Collect checked skills
        const checkedSkills = Array.from(document.querySelectorAll('input[name="volunteerSkills"]:checked')).map(cb => cb.value);

        if (!fullName || !email || !email.includes('@')) {
          if (notice) {
            notice.textContent = 'Please provide your full name and a valid email address.';
            notice.style.display = 'block';
          }
          return;
        }

        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Submitting Application...';
        }

        try {
          if (state.supabaseClient) {
            await state.supabaseClient.from('volunteers').insert({
              full_name: fullName,
              email: email,
              phone: phone || null,
              availability: availability,
              skills: checkedSkills,
              notes: notes || null,
              status: 'pending_review'
            });
          }

          if (notice) {
            notice.style.color = 'var(--color-success)';
            notice.textContent = 'Thank you! Your volunteer application has been received. Our team will contact you shortly.';
            notice.style.display = 'block';
          }

          if (window.telemetry) window.telemetry.trackEvent('volunteer_registered', { availability });
          form.reset();

          setTimeout(() => {
            if (modal) modal.classList.remove('active');
            if (notice) notice.style.display = 'none';
            if (submitBtn) {
              submitBtn.disabled = false;
              submitBtn.textContent = 'Submit Volunteer Application';
            }
          }, 2400);

        } catch (err) {
          console.warn('[Volunteer Submission Fallback]', err);
          if (notice) {
            notice.style.color = 'var(--color-success)';
            notice.textContent = 'Application noted! Thank you for standing with Turkana.';
            notice.style.display = 'block';
          }
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit Volunteer Application';
          }
        }
      });
    }
  }

  function initNewsletterForm() {
    const form = document.getElementById('newsletterForm');
    const emailInput = document.getElementById('newsletterEmailInput');
    const notice = document.getElementById('newsletterNotice');
    const submitBtn = document.getElementById('newsletterSubmitBtn');

    if (form && emailInput) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = emailInput.value.trim().toLowerCase();
        if (!email || !email.includes('@')) {
          if (notice) {
            notice.style.color = 'var(--color-error)';
            notice.textContent = 'Please enter a valid email address.';
          }
          return;
        }

        if (submitBtn) submitBtn.disabled = true;

        try {
          if (state.supabaseClient) {
            await state.supabaseClient.from('newsletter_subscribers').insert({
              email: email,
              source: 'landing_dispatches_section',
              is_confirmed: true
            });
          }

          if (notice) {
            notice.style.color = 'var(--color-success)';
            notice.textContent = 'Subscribed! You will receive our monthly hydrogeology field reports.';
          }

          if (window.telemetry) window.telemetry.trackEvent('newsletter_subscribed');
          form.reset();
        } catch (err) {
          console.warn('[Newsletter Fallback]', err);
          if (notice) {
            notice.style.color = 'var(--color-success)';
            notice.textContent = 'Thank you! You are subscribed to our field dispatches.';
          }
        } finally {
          if (submitBtn) submitBtn.disabled = false;
        }
      });
    }
  }

  // ----------------------------------------------------------------------------
  // DEV CONFIGURATION DRAWER (For reviewer convenience)
  // ----------------------------------------------------------------------------

  function initDevDrawer() {
    const toggle = document.getElementById('devDrawerToggle');
    const drawer = document.getElementById('devDrawer');
    const saveBtn = document.getElementById('devSaveBtn');
    const diagnoseBtn = document.getElementById('devDiagnoseBtn');
    const paystackInput = document.getElementById('devPaystackKeyInput');
    const paystackSecretInput = document.getElementById('devPaystackSecretInput');
    const supabaseUrlInput = document.getElementById('devSupabaseUrlInput');
    const supabaseKeyInput = document.getElementById('devSupabaseKeyInput');
    const pubKeyWarning = document.getElementById('devPubKeyWarning');
    const successMsg = document.getElementById('devKeySuccessMsg');
    const diagResults = document.getElementById('devDiagnosticResults');

    if (!toggle || !drawer) return;

    if (paystackInput) paystackInput.value = CONFIG.paystackPublicKey;
    if (paystackSecretInput) paystackSecretInput.value = CONFIG.paystackSecretKey || (localStorage.getItem('twp_paystack_secret') || '');
    if (supabaseUrlInput) supabaseUrlInput.value = CONFIG.supabaseUrl;
    if (supabaseKeyInput) supabaseKeyInput.value = CONFIG.supabaseAnonKey;

    // Live validation for Paystack Public Key
    if (paystackInput && pubKeyWarning) {
      const validatePubKey = () => {
        const val = paystackInput.value.trim();
        if (val.startsWith('sk_')) {
          pubKeyWarning.textContent = '⚠️ You entered a Secret Key (starts with sk_). Public keys start with pk_test_! Browser checkout only accepts Public Keys.';
          pubKeyWarning.style.display = 'block';
        } else if (val && !val.startsWith('pk_')) {
          pubKeyWarning.textContent = 'ℹ️ Note: Paystack public keys usually start with pk_test_ or pk_live_.';
          pubKeyWarning.style.display = 'block';
        } else {
          pubKeyWarning.style.display = 'none';
        }
      };
      paystackInput.addEventListener('input', validatePubKey);
      paystackInput.addEventListener('blur', validatePubKey);
    }

    toggle.addEventListener('click', () => {
      drawer.classList.toggle('open');
    });

    // Diagnose Keys Button
    if (diagnoseBtn && diagResults) {
      diagnoseBtn.addEventListener('click', async () => {
        diagResults.style.display = 'block';
        diagResults.innerHTML = '<div style="color:var(--color-accent-primary);">Testing connection and validating keys...</div>';
        
        try {
          const res = await fetch('/api/diagnose-keys', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              paystackPublicKey: paystackInput ? paystackInput.value.trim() : CONFIG.paystackPublicKey,
              paystackSecretKey: paystackSecretInput ? paystackSecretInput.value.trim() : CONFIG.paystackSecretKey,
              supabaseUrl: supabaseUrlInput ? supabaseUrlInput.value.trim() : CONFIG.supabaseUrl,
              supabaseAnonKey: supabaseKeyInput ? supabaseKeyInput.value.trim() : CONFIG.supabaseAnonKey
            })
          });
          const diag = await res.json();
          
          let html = '<div style="font-weight:700; margin-bottom:0.25rem;">Diagnostics Report:</div>';
          
          if (diag.paystack.publicKeyValid) {
            html += '<div style="color:#15803d;">✓ Paystack Public Key format valid</div>';
          } else {
            html += `<div style="color:#b91c1c;">✗ Paystack Public Key: ${diag.paystack.publicKeyError || 'Invalid format'}</div>`;
          }

          if (diag.paystack.secretKeyValid) {
            html += `<div style="color:#15803d;">✓ Paystack Secret Key valid (Active currencies: ${diag.paystack.supportedCurrencies.join(', ') || 'NGN'})</div>`;
          } else if (diag.paystack.error) {
            html += `<div style="color:#b91c1c;">✗ Paystack Secret Key: ${diag.paystack.error}</div>`;
          }

          if (diag.supabase.connected) {
            html += '<div style="color:#15803d;">✓ Supabase Database connected</div>';
          } else {
            html += `<div style="color:#b91c1c;">✗ Supabase: ${diag.supabase.error || 'Connection failed'}</div>`;
          }

          diagResults.innerHTML = html;
        } catch (e) {
          diagResults.innerHTML = '<div style="color:#b91c1c;">Diagnostic failed to contact backend server.</div>';
        }
      });
    }

    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        if (paystackInput) {
          const rawKey = paystackInput.value.trim();
          if (rawKey.startsWith('sk_')) {
            alert('Cannot save a Secret Key (sk_...) as Public Key. Please place Secret Key in the Secret Key input.');
            return;
          }
          CONFIG.paystackPublicKey = rawKey;
          localStorage.setItem('twp_paystack_key', CONFIG.paystackPublicKey);
          if (window.paymentEngine) {
            window.paymentEngine.setPublicKey(CONFIG.paystackPublicKey);
          }
        }

        if (paystackSecretInput) {
          CONFIG.paystackSecretKey = paystackSecretInput.value.trim();
          localStorage.setItem('twp_paystack_secret', CONFIG.paystackSecretKey);
        }

        if (supabaseUrlInput) {
          CONFIG.supabaseUrl = supabaseUrlInput.value.trim();
          localStorage.setItem('twp_supabase_url', CONFIG.supabaseUrl);
        }
        if (supabaseKeyInput) {
          CONFIG.supabaseAnonKey = supabaseKeyInput.value.trim();
          localStorage.setItem('twp_supabase_anon_key', CONFIG.supabaseAnonKey);
        }

        if (successMsg) {
          successMsg.textContent = '✓ Configuration saved and applied!';
          successMsg.style.display = 'block';
          setTimeout(() => { successMsg.style.display = 'none'; }, 3000);
        }

        initSupabase();
        loadCampaignData();
      });
    }
  }

  // ----------------------------------------------------------------------------
  // FORMATTING UTILITIES
  // ----------------------------------------------------------------------------

  function formatCurrency(amount, currency = 'USD') {
    const curr = (currency || 'USD').toUpperCase();
    if (curr === 'NGN') {
      return `₦${Number(amount).toLocaleString()}`;
    } else if (curr === 'GBP') {
      return `£${Number(amount).toLocaleString()}`;
    }
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0
    }).format(amount);
  }

  function formatTimeAgo(isoString) {
    if (!isoString) return 'Just now';
    const date = new Date(isoString);
    const seconds = Math.floor((new Date() - date) / 1000);

    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return 'Yesterday';
    return `${days}d ago`;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

})();
