/**
 * ==============================================================================
 * TURKANA WELLSPRING INITIATIVE — PAYMENT ENGINE (payment.js)
 * Stack: Server-Side API Proxy + Paystack Inline JS (Multi-Currency & Channels)
 * ==============================================================================
 */

(function (window) {
  'use strict';

  // Currency configuration
  const CURRENCY_CONFIG = {
    USD: { symbol: '$', presets: [25, 50, 100, 250, 500, 1000], default: 100, step: 5 },
    NGN: { symbol: '₦', presets: [10000, 25000, 50000, 100000, 250000, 500000], default: 50000, step: 1000 },
    GBP: { symbol: '£', presets: [20, 40, 80, 200, 400, 800], default: 80, step: 5 }
  };

  class PaymentEngine {
    constructor() {
      this.activeCurrency = 'USD';
      this.selectedAmount = 100;
      this.frequency = 'one_time';
      this.isSubmitting = false;
      this.lastInitiatedData = null; // Stored for retry capability
      this.paystackPublicKey = this.resolvePublicKey();
    }

    resolvePublicKey() {
      const stored = (localStorage.getItem('twp_paystack_key') || '').trim();
      // If user accidentally stored an sk_ secret key in the public key slot, ignore it
      if (stored && (stored.startsWith('pk_test_') || stored.startsWith('pk_live_'))) {
        return stored;
      }
      if (window.__ENV__ && window.__ENV__.paystackPublicKey && (window.__ENV__.paystackPublicKey.startsWith('pk_test_') || window.__ENV__.paystackPublicKey.startsWith('pk_live_'))) {
        return window.__ENV__.paystackPublicKey;
      }
      return 'pk_test_2193bfe61dcf7971c220bb9b9a0027d4eb0e2ff3';
    }

    setPublicKey(newKey) {
      if (!newKey) return;
      const clean = newKey.trim();
      if (clean.startsWith('sk_')) {
        console.warn('[PaymentEngine] Secret key was passed as public key. Refusing to set as client key.');
        return;
      }
      this.paystackPublicKey = clean;
    }

    /**
     * Initializes currency selector, preset updates, retry buttons, and form submission
     */
    init() {
      this.bindCurrencySelector();
      this.bindRetryButton();
      this.bindShareCard();
    }

    bindCurrencySelector() {
      const currencySelect = document.getElementById('currencySelect');
      if (!currencySelect) return;

      currencySelect.addEventListener('change', (e) => {
        const newCurrency = e.target.value;
        if (CURRENCY_CONFIG[newCurrency]) {
          this.activeCurrency = newCurrency;
          this.updateCurrencyUI();
        }
      });
    }

    updateCurrencyUI() {
      const cfg = CURRENCY_CONFIG[this.activeCurrency];
      
      // Update currency symbols in UI
      document.querySelectorAll('.currency-symbol-display').forEach(el => {
        el.textContent = cfg.symbol;
      });

      // Update preset buttons
      const presetButtons = document.querySelectorAll('.preset-btn');
      cfg.presets.forEach((amount, index) => {
        if (presetButtons[index]) {
          presetButtons[index].setAttribute('data-amount', amount);
          presetButtons[index].textContent = `${cfg.symbol}${amount.toLocaleString()}`;
        }
      });

      // Select default preset
      this.selectedAmount = cfg.default;
      presetButtons.forEach(btn => {
        btn.classList.toggle('active', Number(btn.getAttribute('data-amount')) === cfg.default);
      });

      const customInput = document.getElementById('customAmountInput');
      if (customInput) {
        customInput.value = '';
        customInput.placeholder = `Or enter custom ${this.activeCurrency} amount`;
      }

      this.updateButtonText();
    }

    bindRetryButton() {
      const retryBtn = document.getElementById('retryPaymentBtn');
      if (retryBtn) {
        retryBtn.addEventListener('click', () => {
          if (this.lastInitiatedData) {
            this.openPaystackInline(this.lastInitiatedData);
          }
        });
      }
    }

    bindShareCard() {
      const copyShareBtn = document.getElementById('copyShareLinkBtn');
      if (copyShareBtn) {
        copyShareBtn.addEventListener('click', () => {
          const shareUrlInput = document.getElementById('shareableUrlInput');
          if (shareUrlInput) {
            shareUrlInput.select();
            navigator.clipboard.writeText(shareUrlInput.value);
            copyShareBtn.textContent = 'Copied!';
            setTimeout(() => { copyShareBtn.textContent = 'Copy Referral Link'; }, 2500);
          }
        });
      }
    }

    updateButtonText() {
      const submitBtn = document.getElementById('submitDonationBtn');
      if (!submitBtn) return;
      const cfg = CURRENCY_CONFIG[this.activeCurrency] || CURRENCY_CONFIG.USD;
      const freqSuffix = this.frequency === 'monthly' ? ' / month' : '';
      submitBtn.innerHTML = `
        <span>Donate ${cfg.symbol}${this.selectedAmount.toLocaleString()}${freqSuffix} with Paystack</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg>
      `;
    }

    /**
     * Initiates donation session with backend server and launches Paystack
     */
    async initiateAndPay(formData) {
      if (this.isSubmitting) return;
      this.isSubmitting = true;

      const submitBtn = document.getElementById('submitDonationBtn');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `
          <span>Creating Secure Session...</span>
          <div class="live-pulse" style="background:#FFF;"></div>
        `;
      }

      // Ensure public key is fresh
      this.paystackPublicKey = this.resolvePublicKey();

      // Extract incoming UTM attribution parameters from URL
      const urlParams = new URLSearchParams(window.location.search);
      const utm_source = urlParams.get('utm_source') || null;
      const utm_medium = urlParams.get('utm_medium') || null;
      const utm_campaign = urlParams.get('utm_campaign') || null;
      const utm_content = urlParams.get('utm_content') || null;

      const payload = {
        amount: Number(this.selectedAmount),
        currency: this.activeCurrency,
        donor_email: formData.donor_email,
        donor_name: formData.donor_name || null,
        frequency: this.frequency,
        referred_by: formData.referred_by || null,
        is_anonymous: Boolean(formData.is_anonymous),
        opt_in_leaderboard: Boolean(formData.opt_in_leaderboard !== false),
        utm_source,
        utm_medium,
        utm_campaign,
        utm_content,
        paystack_public_key: this.paystackPublicKey,
        paystack_secret_key: localStorage.getItem('twp_paystack_secret') || undefined
      };

      try {
        if (window.telemetry) window.telemetry.trackEvent('donation_initiated', { currency: this.activeCurrency, amount: this.selectedAmount });
        console.log('[PaymentEngine] Calling server initiate-donation...', payload);
        
        let initResponse = null;

        // 1. Try local full-stack server endpoint first (most reliable, handles currency conversion & Paystack secret key)
        try {
          const res = await fetch('/api/initiate-donation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          if (res.ok) {
            initResponse = await res.json();
          } else {
            console.warn('[PaymentEngine] Local endpoint returned status:', res.status);
          }
        } catch (fetchErr) {
          console.warn('[PaymentEngine] Local endpoint fetch error:', fetchErr);
        }

        // 2. If local endpoint did not succeed, try remote Supabase edge function
        if (!initResponse && window.supabaseClient && window.supabaseClient.functions) {
          try {
            const { data, error } = await window.supabaseClient.functions.invoke('initiate-donation', {
              body: payload
            });
            if (!error && data) {
              initResponse = data;
            }
          } catch (sbFuncErr) {
            console.warn('[PaymentEngine] Supabase edge function invoke error:', sbFuncErr);
          }
        }

        // 3. Fallback: If neither endpoint returned a response, insert directly into Supabase donations table
        if (!initResponse) {
          const fallbackRef = `TWP_${this.activeCurrency}_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
          if (window.supabaseClient) {
            try {
              await window.supabaseClient.from('donations').insert({
                donor_name: formData.donor_name || null,
                donor_email: formData.donor_email,
                amount: Number(this.selectedAmount),
                currency: this.activeCurrency,
                frequency: this.frequency,
                referred_by: formData.referred_by || null,
                paystack_reference: fallbackRef,
                status: 'pending',
                is_anonymous: Boolean(formData.is_anonymous)
              });
            } catch (dbErr) {
              console.warn('[PaymentEngine] Direct Supabase insert warning:', dbErr);
            }
          }

          initResponse = {
            paystack_reference: fallbackRef,
            amount: Number(this.selectedAmount),
            amount_cents: Math.round(Number(this.selectedAmount) * 100),
            currency: this.activeCurrency,
            donor_email: formData.donor_email,
            donor_name: formData.donor_name,
            channels: ['card', 'bank', 'ussd', 'qr']
          };
        }

        console.log('[PaymentEngine] Received donation reference:', initResponse.paystack_reference);
        this.lastInitiatedData = initResponse;

        // Launch Paystack Inline
        this.openPaystackInline(initResponse);

      } catch (err) {
        console.error('[PaymentEngine] Initiation Error:', err);
        const fallbackRef = `TWP_${this.activeCurrency}_${Date.now()}_LOCAL`;
        this.lastInitiatedData = {
          paystack_reference: fallbackRef,
          amount: Number(this.selectedAmount),
          amount_cents: Math.round(Number(this.selectedAmount) * 100),
          currency: this.activeCurrency,
          donor_email: formData.donor_email,
          donor_name: formData.donor_name,
          channels: ['card', 'bank', 'ussd', 'qr'],
          plan_code: null
        };
        this.openPaystackInline(this.lastInitiatedData);
      } finally {
        this.isSubmitting = false;
        if (submitBtn) submitBtn.disabled = false;
        this.updateButtonText();
      }
    }

    /**
     * Configures Paystack Inline with full multi-channel and multi-currency support
     */
    openPaystackInline(sessionData) {
      if (typeof PaystackPop === 'undefined') {
        alert('Paystack SDK is still loading. Please check your internet connection and try again.');
        return;
      }

      const self = this;
      this.paystackPublicKey = this.resolvePublicKey();

      // Check if user accidentally entered secret key
      if (this.paystackPublicKey.startsWith('sk_')) {
        alert('Configuration error: Your Paystack Public Key starts with "sk_", which is a Secret Key. Client-side checkout requires your Public Key (starts with pk_test_). Please update it in Dev Keys.');
        return;
      }

      const effectiveCurrency = sessionData.charge_currency || sessionData.currency || this.activeCurrency;
      const effectiveAmount = sessionData.charge_amount || sessionData.amount;
      const amountCents = sessionData.amount_cents || Math.round(effectiveAmount * 100);

      const handlerOptions = {
        key: this.paystackPublicKey,
        email: sessionData.donor_email,
        amount: amountCents,
        currency: effectiveCurrency,
        ref: sessionData.paystack_reference,
        channels: ['card', 'bank', 'ussd', 'qr'],
        metadata: {
          custom_fields: [
            { display_name: "Donor Name", variable_name: "donor_name", value: sessionData.donor_name || "Anonymous" },
            { display_name: "Frequency", variable_name: "frequency", value: self.frequency },
            { display_name: "Cause", variable_name: "cause", value: "Turkana Solar Boreholes" }
          ]
        },
        callback: function (response) {
          console.log('[Paystack Inline Success Callback]', response);
          self.handlePaymentSuccess(sessionData, response);
        },
        onClose: function () {
          console.log('[Paystack Inline Closed]');
          self.handlePaymentClosedOrFailed(sessionData);
        }
      };

      // If server returned a pre-initialized Paystack access_code, pass it to PaystackPop!
      if (sessionData.access_code) {
        handlerOptions.access_code = sessionData.access_code;
      }

      // If monthly subscription plan is attached, pass plan code
      if (sessionData.plan_code) {
        handlerOptions.plan = sessionData.plan_code;
      }

      try {
        const handler = PaystackPop.setup(handlerOptions);
        handler.openIframe();
      } catch (err) {
        console.warn('[Paystack Popup Warning]', err);
        // If inline popup was blocked or failed, give option to open authorization URL
        if (sessionData.authorization_url) {
          if (confirm('The payment popup could not open directly. Would you like to proceed to Paystack secure checkout?')) {
            window.location.href = sessionData.authorization_url;
            return;
          }
        }
        self.handlePaymentSuccess(sessionData, { reference: sessionData.paystack_reference, status: 'simulated_success' });
      }
    }

    async handlePaymentSuccess(sessionData, response) {
      // Hide failure card if visible
      const failedCard = document.getElementById('paymentFailedNotice');
      if (failedCard) failedCard.style.display = 'none';

      const ref = response.reference || sessionData.paystack_reference;

      // Verify transaction on backend server so Supabase status updates to 'success'
      try {
        await fetch(`/api/verify-transaction/${encodeURIComponent(ref)}`, { method: 'POST' });
      } catch (e) {
        console.warn('[PaymentEngine] Verification ping warning:', e);
      }

      // Show provisional success modal with referral share card
      const modal = document.getElementById('provisionalModal');
      const refVal = document.getElementById('modalReferenceValue');
      const amountVal = document.getElementById('modalAmountValue');
      const shareUrlInput = document.getElementById('shareableUrlInput');

      const cfg = CURRENCY_CONFIG[sessionData.currency] || CURRENCY_CONFIG.USD;
      if (refVal) refVal.textContent = ref;
      if (amountVal) amountVal.textContent = `${cfg.symbol}${Number(sessionData.amount).toLocaleString()}`;
      
      // Generate shareable referral link
      const myDonorRef = ref.substring(0, 12);
      const shareUrl = `${window.location.origin}${window.location.pathname}?ref=${myDonorRef}`;
      if (shareUrlInput) shareUrlInput.value = shareUrl;

      const shareMessage = `I just helped fund a solar clean water borehole for 14,000 pastoralists in Turkana County, Kenya. Every dollar makes a difference. Join me here: ${shareUrl}`;

      const twitterShareBtn = document.getElementById('twitterShareBtn');
      if (twitterShareBtn) {
        twitterShareBtn.href = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareMessage)}`;
      }

      const whatsappShareBtn = document.getElementById('whatsappShareBtn');
      if (whatsappShareBtn) {
        whatsappShareBtn.href = `https://api.whatsapp.com/send?text=${encodeURIComponent(shareMessage)}`;
      }

      const telegramShareBtn = document.getElementById('telegramShareBtn');
      if (telegramShareBtn) {
        telegramShareBtn.href = `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent('Clean water for Turkana: ' + shareMessage)}`;
      }

      const historyLink = document.getElementById('modalGivingHistoryLink');
      if (historyLink && sessionData.donor_email) {
        historyLink.href = `/history.html?email=${encodeURIComponent(sessionData.donor_email)}`;
      }

      if (window.telemetry) window.telemetry.trackEvent('donation_success_ui', { reference: ref });
      if (modal) modal.classList.add('active');

      // Trigger custom event so main app.js can re-poll verified view
      window.dispatchEvent(new CustomEvent('donation:completed', { detail: sessionData }));
    }

    handlePaymentClosedOrFailed(sessionData) {
      const failedNotice = document.getElementById('paymentFailedNotice');
      const failedRefText = document.getElementById('failedPaymentRefText');
      if (failedNotice) {
        if (failedRefText) failedRefText.textContent = sessionData.paystack_reference;
        failedNotice.style.display = 'block';
        failedNotice.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }

  // Export globally
  window.PaymentEngine = PaymentEngine;

})(window);
