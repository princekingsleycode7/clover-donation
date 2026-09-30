/**
 * ==============================================================================
 * TURKANA WELLSPRING INITIATIVE — DONOR HISTORY & LEADERBOARD CONTROLLER
 * Real-Time Database Connection (Zero Mock Data)
 * ==============================================================================
 */

(function () {
  'use strict';

  const state = {
    verifiedDonations: [],
    allDonations: [],
    leaderboard: [],
    metrics: null,
    activeTab: 'verified', // 'verified' | 'all'
    searchQuery: ''
  };

  document.addEventListener('DOMContentLoaded', () => {
    loadLiveLedgerAndMetrics();
    initDonorLookup();
    initFilterTabsAndSearch();
    initCsvExport();

    const refreshBtn = document.getElementById('refreshLedgerBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        refreshBtn.textContent = '↻ Syncing...';
        loadLiveLedgerAndMetrics().finally(() => {
          setTimeout(() => { refreshBtn.textContent = '↻ Refresh Data'; }, 800);
        });
      });
    }

    // Auto-refresh every 15 seconds to ensure live updates
    setInterval(loadLiveLedgerAndMetrics, 15000);

    // Instant refresh when a real-time donation arrives
    window.addEventListener('realtime:new_donation', () => {
      loadLiveLedgerAndMetrics();
    });
  });

  async function loadLiveLedgerAndMetrics() {
    const statusText = document.getElementById('syncStatusText');
    try {
      const res = await fetch('/api/donations');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      state.metrics = data.metrics;
      state.verifiedDonations = data.verifiedDonations || [];
      state.allDonations = data.allDonations || data.verifiedDonations || [];
      state.leaderboard = data.leaderboard || [];

      renderMetrics(state.metrics);
      renderLedgerTable();
      renderLeaderboard(state.leaderboard);

      const countVerifiedTab = document.getElementById('countVerifiedTab');
      const countAllTab = document.getElementById('countAllTab');
      if (countVerifiedTab) countVerifiedTab.textContent = state.verifiedDonations.length;
      if (countAllTab) countAllTab.textContent = state.allDonations.length;

      if (statusText) statusText.textContent = 'Live Database Synchronized';
    } catch (err) {
      console.warn('[History] Error loading live donations from API:', err);
      if (statusText) statusText.textContent = 'Direct Supabase Connected';
      await loadFromSupabaseDirectly();
    }
  }

  function renderMetrics(metrics) {
    if (!metrics) return;

    // Card Progress Bar
    const cardTotal = document.getElementById('cardTotalRaised');
    const cardGoal = document.getElementById('cardGoalAmount');
    const cardPct = document.getElementById('cardProgressPercentage');
    const cardFill = document.getElementById('cardProgressBarFill');
    const cardDonors = document.getElementById('cardDonorCount');
    const cardRem = document.getElementById('cardRemainingAmount');

    // Metrics grid boxes
    const totalRaisedEl = document.getElementById('metricTotalRaised');
    const subTotalUSDEl = document.getElementById('metricSubTotalUSD');
    const donorCountEl = document.getElementById('metricDonorCount');
    const contribsCountEl = document.getElementById('metricContributionsCount');
    const progressPctEl = document.getElementById('metricProgressPct');
    const remLabelEl = document.getElementById('metricRemainingLabel');

    const totalNGN = Number(metrics.totalRaisedNGN) || 0;
    const totalUSD = Number(metrics.totalRaisedUSD) || 0;
    const goalUSD = Number(metrics.goalUSD) || 75000;
    const goalNGN = Number(metrics.goalNGN) || (75000 * 1500);

    const isNGN = metrics.primaryCurrency === 'NGN' || totalNGN > 0;
    const pct = metrics.percentageUSD || Math.min(100, Math.round((totalUSD / goalUSD) * 1000) / 10);

    if (totalRaisedEl) {
      if (isNGN) {
        totalRaisedEl.textContent = `₦${totalNGN.toLocaleString()}`;
        if (subTotalUSDEl) subTotalUSDEl.textContent = `≈ $${totalUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD eq.`;
        if (cardTotal) cardTotal.textContent = `₦${totalNGN.toLocaleString()}`;
        if (cardGoal) cardGoal.textContent = `₦${goalNGN.toLocaleString()} ($75,000)`;
        if (cardRem) {
          const remNGN = Math.max(0, goalNGN - totalNGN);
          cardRem.textContent = `₦${remNGN.toLocaleString()} ($${Math.max(0, goalUSD - totalUSD).toLocaleString(undefined, { maximumFractionDigits: 0 })} eq.)`;
        }
      } else {
        totalRaisedEl.textContent = `$${totalUSD.toLocaleString()}`;
        if (subTotalUSDEl) subTotalUSDEl.textContent = 'Direct public contributions';
        if (cardTotal) cardTotal.textContent = `$${totalUSD.toLocaleString()}`;
        if (cardGoal) cardGoal.textContent = `$${goalUSD.toLocaleString()}`;
        if (cardRem) cardRem.textContent = `$${Math.max(0, goalUSD - totalUSD).toLocaleString()}`;
      }
    }

    if (donorCountEl) donorCountEl.textContent = metrics.donorCount.toLocaleString();
    if (contribsCountEl) contribsCountEl.textContent = metrics.contributionsCount.toLocaleString();
    if (cardDonors) cardDonors.textContent = metrics.donorCount.toLocaleString();

    if (cardPct) cardPct.textContent = `${pct}%`;
    if (cardFill) cardFill.style.width = `${pct}%`;
    if (progressPctEl) progressPctEl.textContent = `${pct}%`;
    if (remLabelEl) {
      if (isNGN) {
        const remNGN = Math.max(0, goalNGN - totalNGN);
        remLabelEl.textContent = `Remaining: ₦${remNGN.toLocaleString()}`;
      } else {
        remLabelEl.textContent = `Remaining: $${Math.max(0, goalUSD - totalUSD).toLocaleString()}`;
      }
    }
  }

  function renderLedgerTable() {
    const tbody = document.getElementById('publicLedgerTableBody');
    if (!tbody) return;

    let items = state.activeTab === 'all' ? state.allDonations : state.verifiedDonations;

    // Filter by search query if typed
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      items = items.filter(d => {
        return (d.donor_display_name && d.donor_display_name.toLowerCase().includes(q)) ||
               (d.donor_email && d.donor_email.toLowerCase().includes(q)) ||
               (d.donor_email_masked && d.donor_email_masked.toLowerCase().includes(q)) ||
               (d.paystack_reference && d.paystack_reference.toLowerCase().includes(q)) ||
               (d.currency && d.currency.toLowerCase().includes(q));
      });
    }

    if (items.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align:center; padding: 2.5rem; color: var(--color-text-muted);">
            ${state.searchQuery ? `No records found matching "${escapeHtml(state.searchQuery)}".` : 'No donations recorded yet in the database.'}
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = items.map(d => {
      const dateStr = d.created_at ? new Date(d.created_at).toLocaleString() : 'Just now';
      const currencySymbol = d.currency === 'NGN' ? '₦' : (d.currency === 'GBP' ? '£' : '$');
      const formattedAmount = `${currencySymbol}${Number(d.amount).toLocaleString()}`;

      let statusBadge = '';
      if (d.status === 'success') {
        statusBadge = `<span class="badge-success">Verified</span>`;
      } else if (d.status === 'pending') {
        statusBadge = `<span class="badge-pending">Pending</span>`;
      } else {
        statusBadge = `<span class="badge-failed">Failed</span>`;
      }

      const emailDisplay = d.is_anonymous ? '<em>Hidden</em>' : escapeHtml(d.donor_email_masked || d.donor_email || '—');

      return `
        <tr>
          <td style="font-weight: 600; color: var(--color-text-primary);">
            ${escapeHtml(d.donor_display_name || 'Generous Supporter')}
          </td>
          <td style="font-size: 0.8rem; color: var(--color-text-secondary); font-family: var(--font-mono);">
            ${emailDisplay}
          </td>
          <td class="amount-cell tabular-nums" style="font-weight: 700; color: var(--color-accent-primary);">
            ${formattedAmount}
          </td>
          <td style="text-transform: capitalize; font-size: 0.825rem;">
            ${escapeHtml(d.frequency || 'one_time').replace('_', ' ')}
          </td>
          <td style="font-size: 0.8rem; color: var(--color-text-muted);">
            ${dateStr}
          </td>
          <td>
            ${statusBadge}
          </td>
          <td class="tabular-nums" style="font-size: 0.725rem; font-family: var(--font-mono); color: var(--color-text-muted);">
            ${escapeHtml(d.paystack_reference || 'N/A')}
          </td>
        </tr>
      `;
    }).join('');
  }

  function renderLeaderboard(leaderboard) {
    const tbody = document.getElementById('leaderboardTableBody');
    if (!tbody) return;

    if (leaderboard.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align:center; padding: 2.5rem; color: var(--color-text-muted);">
            No verified supporters on the honor roll yet.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = leaderboard.map(item => {
      const currencySymbol = item.currency === 'NGN' ? '₦' : (item.currency === 'GBP' ? '£' : '$');
      const formattedTotal = `${currencySymbol}${Number(item.total_contributed).toLocaleString()}`;
      const lastDate = item.last_donation ? new Date(item.last_donation).toLocaleDateString() : 'Recent';

      return `
        <tr class="rank-${item.rank}">
          <td>
            <span class="rank-num">${item.rank}</span>
          </td>
          <td style="font-weight: 600; color: var(--color-text-primary);">
            ${escapeHtml(item.donor_display_name)}
          </td>
          <td class="amount-cell tabular-nums" style="font-weight: 700; color: var(--color-accent-primary);">
            ${formattedTotal}
          </td>
          <td class="tabular-nums" style="font-size: 0.85rem;">
            ${item.donations_count} ${item.donations_count === 1 ? 'gift' : 'gifts'}
          </td>
          <td style="font-size: 0.8rem; color: var(--color-text-muted);">
            ${lastDate}
          </td>
        </tr>
      `;
    }).join('');
  }

  function initFilterTabsAndSearch() {
    const tabVerified = document.getElementById('tabVerified');
    const tabAll = document.getElementById('tabAll');
    const searchInput = document.getElementById('ledgerSearchInput');

    if (tabVerified && tabAll) {
      tabVerified.addEventListener('click', () => {
        state.activeTab = 'verified';
        tabVerified.classList.add('active');
        tabAll.classList.remove('active');
        renderLedgerTable();
      });

      tabAll.addEventListener('click', () => {
        state.activeTab = 'all';
        tabAll.classList.add('active');
        tabVerified.classList.remove('active');
        renderLedgerTable();
      });
    }

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        state.searchQuery = e.target.value.trim();
        renderLedgerTable();
      });
    }
  }

  function initCsvExport() {
    const exportBtn = document.getElementById('downloadCsvBtn');
    if (!exportBtn) return;

    exportBtn.addEventListener('click', () => {
      const dataToExport = state.activeTab === 'all' ? state.allDonations : state.verifiedDonations;
      if (dataToExport.length === 0) {
        alert('No donation records available to export.');
        return;
      }

      const headers = ['Supporter', 'Identifier', 'Amount', 'Currency', 'Frequency', 'Status', 'Date', 'Transaction Reference'];
      const rows = dataToExport.map(d => [
        `"${(d.donor_display_name || '').replace(/"/g, '""')}"`,
        `"${(d.donor_email_masked || d.donor_email || '').replace(/"/g, '""')}"`,
        d.amount,
        d.currency,
        d.frequency,
        d.status,
        `"${d.created_at || ''}"`,
        `"${d.paystack_reference || ''}"`
      ]);

      const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', `turkana_wellspring_donations_${state.activeTab}_${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });
  }

  function initDonorLookup() {
    const form = document.getElementById('donorLookupForm');
    const input = document.getElementById('lookupEmailInput');
    const notice = document.getElementById('lookupNotice');
    const resultBox = document.getElementById('personalHistoryResult');
    const emailLabel = document.getElementById('donorResultEmail');
    const totalLabel = document.getElementById('donorResultTotal');
    const tbody = document.getElementById('personalHistoryTableBody');
    const submitBtn = document.getElementById('lookupSubmitBtn');

    if (!form || !input) return;

    // Check if ?email= is in URL (e.g. from checkout redirect)
    const urlParams = new URLSearchParams(window.location.search);
    const prefillEmail = urlParams.get('email');
    if (prefillEmail) {
      input.value = prefillEmail;
      performLookup(prefillEmail);
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = input.value.trim().toLowerCase();
      if (!email || !email.includes('@')) return;
      await performLookup(email);
    });

    async function performLookup(email) {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Searching...';
      }
      if (notice) {
        notice.style.display = 'none';
      }

      try {
        const res = await fetch('/api/donor-history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Failed to query records');
        }

        const donations = data.donations || [];
        if (donations.length === 0) {
          if (notice) {
            notice.style.color = 'var(--color-text-secondary)';
            notice.textContent = `No donation records found under "${email}".`;
            notice.style.display = 'block';
          }
          if (resultBox) resultBox.style.display = 'none';
          return;
        }

        if (emailLabel) emailLabel.textContent = data.donor_email;
        if (totalLabel) {
          const currSymbol = data.currency === 'NGN' ? '₦' : (data.currency === 'GBP' ? '£' : '$');
          totalLabel.textContent = `Lifetime Verified Contributions: ${currSymbol}${Number(data.total_contributed).toLocaleString()} (${data.donations_count} completed)`;
        }

        if (tbody) {
          tbody.innerHTML = donations.map(d => {
            const dateStr = d.created_at ? new Date(d.created_at).toLocaleString() : 'N/A';
            const currSymbol = d.currency === 'NGN' ? '₦' : (d.currency === 'GBP' ? '£' : '$');
            const statusClass = d.status === 'success' ? 'badge-success' : (d.status === 'failed' ? 'badge-failed' : 'badge-pending');

            return `
              <tr>
                <td style="font-size:0.8rem; color:var(--color-text-muted);">${dateStr}</td>
                <td class="amount-cell tabular-nums" style="font-weight:700;">${currSymbol}${Number(d.amount).toLocaleString()}</td>
                <td style="text-transform:capitalize; font-size:0.825rem;">${(d.frequency || 'one_time').replace('_', ' ')}</td>
                <td><span class="${statusClass}">${d.status}</span></td>
                <td class="tabular-nums" style="font-size:0.725rem; font-family:var(--font-mono); color:var(--color-text-muted);">${escapeHtml(d.paystack_reference || 'N/A')}</td>
              </tr>
            `;
          }).join('');
        }

        if (resultBox) resultBox.style.display = 'block';
        if (notice) {
          notice.style.color = '#15803d';
          notice.textContent = `Found ${donations.length} transaction record(s) for ${email}.`;
          notice.style.display = 'block';
        }

      } catch (err) {
        if (notice) {
          notice.style.color = 'var(--color-error)';
          notice.textContent = 'Could not load records. Please try again.';
          notice.style.display = 'block';
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Search Records';
        }
      }
    }
  }

  async function loadFromSupabaseDirectly() {
    const supabaseUrl = localStorage.getItem('twp_supabase_url') || (window.__ENV__ && window.__ENV__.supabaseUrl);
    const supabaseKey = localStorage.getItem('twp_supabase_anon_key') || (window.__ENV__ && window.__ENV__.supabaseAnonKey);

    if (window.supabase && supabaseUrl && !supabaseUrl.includes('mock-turkana')) {
      try {
        const client = window.supabase.createClient(supabaseUrl, supabaseKey);
        // Use the safe public_donations view
        const { data, error } = await client.from('public_donations').select('*').order('created_at', { ascending: false });
        if (!error && data) {
          state.verifiedDonations = data.map(d => ({
            id: d.id,
            donor_display_name: d.display_name || 'Generous Supporter',
            donor_email_masked: '',
            amount: Number(d.amount),
            currency: d.currency || 'USD',
            frequency: d.frequency || 'one_time',
            status: 'success',
            paystack_reference: 'VERIFIED_DB',
            created_at: d.created_at,
            is_anonymous: Boolean(d.is_anonymous)
          }));
          state.allDonations = state.verifiedDonations;

          // Compute basic metrics
          let totalNGN = 0;
          let totalUSD = 0;
          state.verifiedDonations.forEach(d => {
            if (d.currency === 'NGN') {
              totalNGN += d.amount;
              totalUSD += d.amount / 1500;
            } else {
              totalUSD += d.amount;
              totalNGN += d.amount * 1500;
            }
          });

          state.metrics = {
            totalRaisedUSD: Math.round(totalUSD * 100) / 100,
            totalRaisedNGN: Math.round(totalNGN),
            goalUSD: 75000,
            goalNGN: 112500000,
            donorCount: state.verifiedDonations.length,
            contributionsCount: state.verifiedDonations.length,
            primaryCurrency: totalNGN > 0 ? 'NGN' : 'USD'
          };

          renderMetrics(state.metrics);
          renderLedgerTable();
        }
      } catch (e) {
        console.warn('[Direct Supabase fallback failed]', e);
      }
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

})();
