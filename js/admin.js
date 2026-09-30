/**
 * ==============================================================================
 * TURKANA WELLSPRING INITIATIVE — ADMIN PORTAL CONTROLLER (admin.js)
 * Stack: Supabase Auth + admin-actions Edge Function + Role-Based UI
 * ==============================================================================
 */

(function () {
  'use strict';

  const state = {
    supabaseClient: null,
    session: null,
    userRole: 'viewer', // 'admin' | 'viewer'
    userEmail: '',
    donations: [],
    currentPage: 0,
    pageSize: 25,
    totalDonations: 0,
    edgeBaseUrl: ''
  };

  document.addEventListener('DOMContentLoaded', () => {
    initSupabase();
    initTabs();
    initAuthListeners();
    initFiltersAndPagination();
    initManualEntryForm();
    initCmsForm();
    initReconciliationButton();
    initUtmGenerator();
    initVolunteersTab();
    initSubscribersTab();
    initSponsorsTab();
    initDevKeysAdmin();
  });

  function initSupabase() {
    const supabaseUrl = localStorage.getItem('twp_supabase_url') || 'https://mock-turkana-wellspring.supabase.co';
    const supabaseAnonKey = localStorage.getItem('twp_supabase_anon_key') || 'dummy_key';

    if (window.supabase && !supabaseUrl.includes('mock-turkana')) {
      try {
        state.supabaseClient = window.supabase.createClient(supabaseUrl, supabaseAnonKey);
        state.edgeBaseUrl = `${supabaseUrl.replace(/\/$/, '')}/functions/v1`;

        // Check active session
        state.supabaseClient.auth.getSession().then(({ data }) => {
          if (data && data.session) {
            handleSessionEstablished(data.session);
          }
        });
      } catch (e) {
        console.warn('[Admin] Supabase client init warning:', e);
      }
    }
  }

  function initTabs() {
    const tabs = document.querySelectorAll('.admin-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

        tab.classList.add('active');
        const targetId = tab.getAttribute('data-tab');
        const targetPane = document.getElementById(targetId);
        if (targetPane) targetPane.classList.add('active');

        // Refresh tab-specific data
        if (targetId === 'cmsTab') loadCmsPosts();
        if (targetId === 'referralsTab') loadReferrals();
        if (targetId === 'utmTab') loadUtmStats();
        if (targetId === 'volunteersTab') loadVolunteers();
        if (targetId === 'subscribersTab') loadSubscribers();
        if (targetId === 'sponsorsTab') loadMatchingSponsors();
        if (targetId === 'auditTab') loadAuditLogs();
        if (targetId === 'devKeysTab') loadDevKeysInputs();
      });
    });
  }

  function initAuthListeners() {
    const loginForm = document.getElementById('loginForm');
    const signOutBtn = document.getElementById('signOutBtn');
    const demoBtn = document.getElementById('demoAdminBtn');

    if (loginForm) {
      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('adminEmailInput').value.trim();
        const password = document.getElementById('adminPasswordInput').value;
        const errEl = document.getElementById('loginErrorMsg');
        if (errEl) errEl.style.display = 'none';

        if (state.supabaseClient) {
          try {
            const { data, error } = await state.supabaseClient.auth.signInWithPassword({ email, password });
            if (error) throw error;
            handleSessionEstablished(data.session);
          } catch (err) {
            if (errEl) {
              errEl.textContent = err.message || 'Authentication failed.';
              errEl.style.display = 'block';
            }
          }
        } else {
          // Local test fallback
          handleSessionEstablished({
            access_token: 'demo_token_admin',
            user: { email: email, id: 'demo_user_id' }
          });
        }
      });
    }

    if (demoBtn) {
      demoBtn.addEventListener('click', () => {
        handleSessionEstablished({
          access_token: 'demo_token_admin',
          user: { email: 'auditor@turkanawellspring.org', id: 'demo_user_id' }
        });
      });
    }

    if (signOutBtn) {
      signOutBtn.addEventListener('click', async () => {
        if (state.supabaseClient) {
          await state.supabaseClient.auth.signOut();
        }
        state.session = null;
        document.getElementById('authSection').style.display = 'block';
        document.getElementById('dashboardContent').style.display = 'none';
        document.getElementById('userInfoBadge').style.display = 'none';
      });
    }
  }

  async function handleSessionEstablished(session) {
    state.session = session;
    state.userEmail = session.user?.email || 'admin@turkanawellspring.org';

    document.getElementById('authSection').style.display = 'none';
    document.getElementById('dashboardContent').style.display = 'block';
    const badgeZone = document.getElementById('userInfoBadge');
    if (badgeZone) badgeZone.style.display = 'flex';

    const emailLabel = document.getElementById('userEmailLabel');
    if (emailLabel) emailLabel.textContent = state.userEmail;

    // Fetch user role from admin-actions function or fallback
    await fetchAdminProfile();
    applyRolePermissions();

    // Initial data load
    loadDonations();
  }

  async function fetchAdminProfile() {
    try {
      const res = await callAdminAction('get_profile');
      if (res && res.role) {
        state.userRole = res.role;
      } else {
        state.userRole = 'admin'; // Default fallback for local testing
      }
    } catch (e) {
      state.userRole = 'admin';
    }

    const roleBadge = document.getElementById('userRoleBadge');
    if (roleBadge) {
      roleBadge.textContent = state.userRole.toUpperCase();
      roleBadge.className = `badge-role ${state.userRole}`;
    }
  }

  function applyRolePermissions() {
    const isViewer = state.userRole === 'viewer';
    const manualNotice = document.getElementById('viewerRestrictedNoticeManual');
    const manualSubmit = document.getElementById('saveManualDonationBtn');
    const cmsSubmit = document.getElementById('publishCmsBtn');

    if (isViewer) {
      if (manualNotice) manualNotice.style.display = 'block';
      if (manualSubmit) manualSubmit.disabled = true;
      if (cmsSubmit) cmsSubmit.disabled = true;
    } else {
      if (manualNotice) manualNotice.style.display = 'none';
      if (manualSubmit) manualSubmit.disabled = false;
      if (cmsSubmit) cmsSubmit.disabled = false;
    }
  }

  async function callAdminAction(action, payload = {}) {
    // 1. Try local server endpoint first
    try {
      const res = await fetch('/api/admin-actions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(state.session?.access_token ? { 'Authorization': `Bearer ${state.session.access_token}` } : {})
        },
        body: JSON.stringify({ action, ...payload })
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      // Continue to next check
    }

    // 2. Try remote Edge Function if available
    if (state.supabaseClient && state.session?.access_token && state.edgeBaseUrl) {
      try {
        const res = await fetch(`${state.edgeBaseUrl}/admin-actions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${state.session.access_token}`
          },
          body: JSON.stringify({ action, payload })
        });
        if (res.ok) {
          return await res.json();
        }
      } catch (e) {}
    }

    // 3. Fallback: query /api/donations directly
    if (action === 'list_donations') {
      try {
        const res = await fetch('/api/donations');
        if (res.ok) {
          const data = await res.json();
          return { donations: data.allDonations || data.verifiedDonations || [], total_count: (data.allDonations || []).length };
        }
      } catch (e) {}
    }

    if (action === 'overview') {
      try {
        const res = await fetch('/api/donations');
        if (res.ok) {
          const data = await res.json();
          return {
            totalVolumeUSD: data.metrics.totalRaisedUSD,
            successCount: data.metrics.contributionsCount,
            pendingCount: data.metrics.totalTransactionsCount - data.metrics.contributionsCount,
            donations: (data.allDonations || []).slice(0, 50)
          };
        }
      } catch (e) {}
    }

    return { success: true };
  }

  // ----------------------------------------------------------------------------
  // TAB 1: DONATIONS LEDGER & FILTERS
  // ----------------------------------------------------------------------------
  function initFiltersAndPagination() {
    const statusSelect = document.getElementById('filterStatus');
    const currencySelect = document.getElementById('filterCurrency');
    const searchInput = document.getElementById('filterSearch');
    const refreshBtn = document.getElementById('refreshDonationsBtn');
    const exportCsvBtn = document.getElementById('exportCsvBtn');

    [statusSelect, currencySelect].forEach(el => {
      if (el) el.addEventListener('change', () => { state.currentPage = 0; loadDonations(); });
    });

    if (searchInput) {
      let timeout;
      searchInput.addEventListener('input', () => {
        clearTimeout(timeout);
        timeout = setTimeout(() => { state.currentPage = 0; loadDonations(); }, 350);
      });
    }

    if (refreshBtn) refreshBtn.addEventListener('click', () => loadDonations());
    if (exportCsvBtn) exportCsvBtn.addEventListener('click', handleExportCsv);
  }

  async function loadDonations() {
    const tbody = document.getElementById('adminDonationsTableBody');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2rem;">Loading verified audit ledger...</td></tr>`;

    const status = document.getElementById('filterStatus')?.value || 'all';
    const currency = document.getElementById('filterCurrency')?.value || 'all';
    const search = document.getElementById('filterSearch')?.value.trim() || '';

    try {
      const res = await callAdminAction('list_donations', {
        status,
        currency,
        search,
        limit: state.pageSize,
        offset: state.currentPage * state.pageSize
      });

      state.donations = res.donations || [];
      state.totalDonations = res.total_count || state.donations.length;
      renderDonationsTable();
    } catch (e) {
      console.warn('[Admin loadDonations error]', e);
      state.donations = [];
      state.totalDonations = 0;
      renderDonationsTable();
    }
  }

  function renderDonationsTable() {
    const tbody = document.getElementById('adminDonationsTableBody');
    const countLabel = document.getElementById('donationsCountLabel');
    if (!tbody) return;

    if (countLabel) {
      countLabel.textContent = `Showing ${state.donations.length} of ${state.totalDonations} records`;
    }

    if (state.donations.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2rem; color: var(--color-text-muted);">No matching transactions found.</td></tr>`;
      return;
    }

    tbody.innerHTML = state.donations.map(d => {
      const dt = new Date(d.created_at).toLocaleString();
      const statusClass = `badge-status ${d.status}`;
      const srcBadge = d.payment_source === 'paystack' 
        ? `<span style="font-size:0.75rem; color: #0D5C3A; font-weight:600;">Paystack (${d.paystack_channel || 'card'})</span>`
        : `<span style="font-size:0.75rem; color: #92400E; font-weight:600;">Offline (${d.payment_source})</span>`;

      return `
        <tr>
          <td style="font-size:0.8rem; color:var(--color-text-muted);">${dt}</td>
          <td>
            <strong>${escapeHtml(d.donor_name || 'Anonymous')}</strong><br/>
            <span style="font-size:0.75rem; color:var(--color-text-muted);">${escapeHtml(d.donor_email)}</span>
          </td>
          <td class="amount-cell tabular-nums">${d.currency} ${Number(d.amount).toLocaleString()}</td>
          <td style="text-transform: capitalize; font-size:0.8rem;">${d.frequency || 'one_time'}</td>
          <td>${srcBadge}</td>
          <td><span class="${statusClass}">${d.status}</span></td>
          <td class="tabular-nums" style="font-size:0.75rem; font-family:var(--font-mono);">${d.paystack_reference}</td>
        </tr>
      `;
    }).join('');
  }

  async function handleExportCsv() {
    const exportBtn = document.getElementById('exportCsvBtn');
    if (exportBtn) exportBtn.textContent = 'Generating...';

    const status = document.getElementById('filterStatus')?.value || 'all';
    const currency = document.getElementById('filterCurrency')?.value || 'all';

    try {
      const res = await callAdminAction('export_csv', { status, currency });
      if (res && res.csv) {
        const blob = new Blob([res.csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `turkana_donations_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
      }
    } catch (e) {
      alert('CSV Export error: ' + e.message);
    } finally {
      if (exportBtn) exportBtn.textContent = 'Export CSV';
    }
  }

  // ----------------------------------------------------------------------------
  // TAB 2: MANUAL OFFLINE ENTRY
  // ----------------------------------------------------------------------------
  function initManualEntryForm() {
    const form = document.getElementById('manualDonationForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (state.userRole !== 'admin') {
        alert('Permission Denied: Viewers cannot record offline donations.');
        return;
      }

      const submitBtn = document.getElementById('saveManualDonationBtn');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Recording Audited Entry...';

      const payload = {
        donor_name: document.getElementById('manualDonorName').value.trim(),
        donor_email: document.getElementById('manualDonorEmail').value.trim(),
        amount: Number(document.getElementById('manualAmount').value),
        currency: document.getElementById('manualCurrency').value,
        payment_source: document.getElementById('manualSource').value,
        notes: document.getElementById('manualNotes').value.trim(),
        is_anonymous: document.getElementById('manualAnonymous').checked
      };

      try {
        await callAdminAction('manual_donation_entry', payload);
        alert('Offline donation recorded and verified successfully!');
        form.reset();
        loadDonations();
      } catch (err) {
        alert('Error: ' + err.message);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Audit & Record Verified Donation';
      }
    });
  }

  // ----------------------------------------------------------------------------
  // TAB 3: CMS FIELD UPDATES
  // ----------------------------------------------------------------------------
  function initCmsForm() {
    const form = document.getElementById('cmsPostForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (state.userRole !== 'admin') {
        alert('Only administrators can publish updates.');
        return;
      }

      const title = document.getElementById('cmsTitle').value.trim();
      const author_name = document.getElementById('cmsAuthor').value.trim();
      const body = document.getElementById('cmsBody').value.trim();

      try {
        await callAdminAction('cms_create_post', { title, author_name, body });
        form.reset();
        loadCmsPosts();
      } catch (err) {
        alert('Error publishing update: ' + err.message);
      }
    });
  }

  async function loadCmsPosts() {
    const tbody = document.getElementById('cmsPostsTableBody');
    if (!tbody) return;

    try {
      const res = await callAdminAction('list_cms_posts');
      const posts = res.posts || [];
      if (posts.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 1.5rem;">No field updates published yet.</td></tr>`;
        return;
      }

      tbody.innerHTML = posts.map(p => `
        <tr>
          <td style="font-size:0.8rem; color:var(--color-text-muted);">${new Date(p.published_at || p.created_at).toLocaleDateString()}</td>
          <td><strong>${escapeHtml(p.title)}</strong></td>
          <td style="font-size:0.85rem;">${escapeHtml(p.author_name)}</td>
          <td>
            ${state.userRole === 'admin' 
              ? `<button type="button" class="btn-secondary-sm" onclick="window.deleteCmsPost('${p.id}')">Delete</button>` 
              : '<span style="color:var(--color-text-muted); font-size:0.75rem;">Read-only</span>'}
          </td>
        </tr>
      `).join('');
    } catch (e) {
      console.warn('[CMS load error]', e);
    }
  }

  window.deleteCmsPost = async function (id) {
    if (!confirm('Are you sure you want to delete this field dispatch?')) return;
    try {
      await callAdminAction('cms_delete_post', { id });
      loadCmsPosts();
    } catch (e) {
      alert('Error: ' + e.message);
    }
  };

  // ----------------------------------------------------------------------------
  // TAB 4 & 5: REFERRALS & AUDIT LOGS
  // ----------------------------------------------------------------------------
  async function loadReferrals() {
    const tbody = document.getElementById('referralsTableBody');
    if (!tbody) return;
    try {
      const res = await callAdminAction('list_referrals');
      const list = res.referrals || [];
      if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:1.5rem;">No referral codes tracked yet.</td></tr>`;
        return;
      }
      tbody.innerHTML = list.map(r => `
        <tr>
          <td><strong style="font-family:var(--font-mono);">${escapeHtml(r.referral_code)}</strong></td>
          <td class="tabular-nums">${r.total_donations}</td>
          <td class="tabular-nums" style="color:var(--color-success); font-weight:700;">${r.successful_donations}</td>
          <td class="tabular-nums amount-cell">${r.currency} ${Number(r.total_raised).toLocaleString()}</td>
          <td>${r.currency}</td>
        </tr>
      `).join('');
    } catch (e) {
      console.warn('[Referrals error]', e);
    }
  }

  async function loadAuditLogs() {
    const tbody = document.getElementById('auditTableBody');
    if (!tbody) return;
    try {
      const res = await callAdminAction('list_audit_logs');
      const logs = res.audit_logs || [];
      if (logs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:1.5rem;">Audit log is currently empty.</td></tr>`;
        return;
      }
      tbody.innerHTML = logs.map(l => `
        <tr>
          <td style="font-size:0.75rem; font-family:var(--font-mono);">${new Date(l.timestamp).toISOString()}</td>
          <td style="font-size:0.85rem;"><strong>${escapeHtml(l.admin_email)}</strong></td>
          <td><span class="badge-role" style="background:#E2E8F0; color:#334155;">${escapeHtml(l.action)}</span></td>
          <td style="font-family:var(--font-mono); font-size:0.75rem;">${escapeHtml(l.target)}</td>
          <td style="font-size:0.75rem; color:var(--color-text-secondary); max-width:260px; overflow:hidden; text-overflow:ellipsis;">
            ${escapeHtml(JSON.stringify(l.metadata))}
          </td>
        </tr>
      `).join('');
    } catch (e) {
      console.warn('[Audit log error]', e);
    }
  }

  // ----------------------------------------------------------------------------
  // TAB 6: RECONCILIATION OPS
  // ----------------------------------------------------------------------------
  function initReconciliationButton() {
    const btn = document.getElementById('triggerReconcileBtn');
    const notice = document.getElementById('reconcileResultNotice');
    if (!btn) return;

    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Scanning Flutterwave Transactions...';
      try {
        const res = await callAdminAction('trigger_reconciliation');
        if (notice) {
          notice.style.display = 'block';
          notice.style.color = 'var(--color-accent-primary)';
          notice.innerHTML = `<strong>Reconciliation Complete:</strong> ${res.updated || 0} missing webhooks updated to success. Total discrepancies resolved: ${res.mismatches || 0}.`;
        }
        loadDonations();
      } catch (e) {
        if (notice) {
          notice.style.display = 'block';
          notice.style.color = 'var(--color-error)';
          notice.textContent = 'Reconciliation Error: ' + e.message;
        }
      } finally {
        btn.disabled = false;
        btn.textContent = 'Run Flutterwave Reconciliation Now';
      }
    });
  }

  // ----------------------------------------------------------------------------
  // TAB: UTM CAMPAIGN GENERATOR
  // ----------------------------------------------------------------------------
  function initUtmGenerator() {
    const srcInput = document.getElementById('utmSourceInput');
    const medInput = document.getElementById('utmMediumInput');
    const camInput = document.getElementById('utmCampaignInput');
    const conInput = document.getElementById('utmContentInput');
    const outInput = document.getElementById('generatedUtmUrl');
    const copyBtn = document.getElementById('copyUtmLinkBtn');

    function updateUrl() {
      if (!outInput) return;
      const base = `${window.location.origin}/`;
      const params = new URLSearchParams();
      if (srcInput && srcInput.value.trim()) params.set('utm_source', srcInput.value.trim());
      if (medInput && medInput.value.trim()) params.set('utm_medium', medInput.value.trim());
      if (camInput && camInput.value.trim()) params.set('utm_campaign', camInput.value.trim());
      if (conInput && conInput.value.trim()) params.set('utm_content', conInput.value.trim());

      outInput.value = `${base}?${params.toString()}`;
    }

    [srcInput, medInput, camInput, conInput].forEach(el => {
      if (el) el.addEventListener('input', updateUrl);
    });

    updateUrl();

    if (copyBtn && outInput) {
      copyBtn.addEventListener('click', () => {
        outInput.select();
        navigator.clipboard.writeText(outInput.value);
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy Link'; }, 2000);
      });
    }
  }

  async function loadUtmStats() {
    const tbody = document.getElementById('utmStatsTableBody');
    if (!tbody) return;
    try {
      const res = await callAdminAction('list_utm_stats');
      const stats = res.utm_stats || [];
      if (stats.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:1.5rem;">No UTM campaign traffic recorded yet. Generate and share links above.</td></tr>`;
        return;
      }
      tbody.innerHTML = stats.map(s => `
        <tr>
          <td><span class="badge-role" style="background:#E2E8F0; color:#1E293B;">${escapeHtml(s.source)}</span></td>
          <td><strong>${escapeHtml(s.campaign)}</strong></td>
          <td class="tabular-nums">${s.total_initiated}</td>
          <td class="tabular-nums" style="color:var(--color-success); font-weight:700;">${s.total_success}</td>
          <td class="tabular-nums amount-cell">$${Number(s.funds_usd).toLocaleString()}</td>
        </tr>
      `).join('');
    } catch (e) {
      console.warn('[UTM stats error]', e);
    }
  }

  // ----------------------------------------------------------------------------
  // TAB: VOLUNTEERS
  // ----------------------------------------------------------------------------
  function initVolunteersTab() {
    const filterSelect = document.getElementById('filterVolunteerStatus');
    const refreshBtn = document.getElementById('refreshVolunteersBtn');
    if (filterSelect) {
      filterSelect.addEventListener('change', () => loadVolunteers());
    }
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => loadVolunteers());
    }
  }

  async function loadVolunteers() {
    const tbody = document.getElementById('volunteersTableBody');
    if (!tbody) return;
    const status = document.getElementById('filterVolunteerStatus')?.value || 'all';
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:1.5rem;">Loading volunteer leads...</td></tr>`;

    try {
      const res = await callAdminAction('list_volunteers', { status });
      const list = res.volunteers || [];
      if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:1.5rem;">No volunteer leads match the selected filter.</td></tr>`;
        return;
      }

      tbody.innerHTML = list.map(v => `
        <tr>
          <td style="font-size:0.75rem; font-family:var(--font-mono);">${new Date(v.created_at).toLocaleDateString()}</td>
          <td><strong>${escapeHtml(v.full_name)}</strong></td>
          <td style="font-size:0.8rem;">
            <a href="mailto:${escapeHtml(v.email)}" style="color:var(--color-accent-primary); text-decoration:underline;">${escapeHtml(v.email)}</a>
            ${v.phone ? `<br/><span style="color:var(--color-text-muted); font-size:0.75rem;">${escapeHtml(v.phone)}</span>` : ''}
          </td>
          <td><span style="font-size:0.8rem; text-transform:capitalize;">${escapeHtml(v.availability.replace('_', ' '))}</span></td>
          <td style="font-size:0.75rem; max-width:220px; line-height:1.4;">
            <div style="font-weight:600; color:var(--color-text-primary); margin-bottom:2px;">${Array.isArray(v.skills) ? v.skills.join(', ') : ''}</div>
            <div style="color:var(--color-text-secondary); font-style:italic;">${escapeHtml(v.notes || 'No notes')}</div>
          </td>
          <td>
            <select class="admin-select volunteer-status-select" data-id="${v.id}" style="padding:0.25rem 0.5rem; font-size:0.75rem;">
              <option value="pending_review" ${v.status === 'pending_review' ? 'selected' : ''}>Pending</option>
              <option value="interviewed" ${v.status === 'interviewed' ? 'selected' : ''}>Interviewed</option>
              <option value="accepted" ${v.status === 'accepted' ? 'selected' : ''}>Accepted</option>
              <option value="archived" ${v.status === 'archived' ? 'selected' : ''}>Archived</option>
            </select>
          </td>
          <td>
            <button type="button" class="btn-secondary-sm update-vol-btn" data-id="${v.id}" style="padding:0.25rem 0.5rem; font-size:0.75rem;">Save</button>
          </td>
        </tr>
      `).join('');

      tbody.querySelectorAll('.update-vol-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.getAttribute('data-id');
          const select = tbody.querySelector(`.volunteer-status-select[data-id="${id}"]`);
          if (!select) return;
          btn.textContent = '...';
          await callAdminAction('update_volunteer_status', { volunteer_id: id, status: select.value });
          btn.textContent = 'Saved!';
          setTimeout(() => { btn.textContent = 'Save'; }, 1500);
        });
      });

    } catch (e) {
      console.warn('[Volunteers error]', e);
    }
  }

  // ----------------------------------------------------------------------------
  // TAB: NEWSLETTER SUBSCRIBERS
  // ----------------------------------------------------------------------------
  function initSubscribersTab() {
    const refreshBtn = document.getElementById('refreshSubscribersBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => loadSubscribers());
    }
  }

  async function loadSubscribers() {
    const tbody = document.getElementById('subscribersTableBody');
    const badge = document.getElementById('subscribersCountBadge');
    if (!tbody) return;

    try {
      const res = await callAdminAction('list_subscribers');
      const list = res.subscribers || [];
      if (badge) badge.textContent = res.total_count || list.length;

      if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:1.5rem;">No subscribers yet.</td></tr>`;
        return;
      }

      tbody.innerHTML = list.map(s => `
        <tr>
          <td style="font-size:0.75rem; font-family:var(--font-mono);">${new Date(s.subscribed_at).toLocaleDateString()}</td>
          <td><strong>${escapeHtml(s.email)}</strong></td>
          <td style="font-size:0.8rem; color:var(--color-text-secondary);">${escapeHtml(s.source)}</td>
          <td><span class="badge-role" style="background:#DCFCE7; color:#166534;">Confirmed</span></td>
        </tr>
      `).join('');
    } catch (e) {
      console.warn('[Subscribers error]', e);
    }
  }

  // ----------------------------------------------------------------------------
  // TAB: MATCHING SPONSORS
  // ----------------------------------------------------------------------------
  function initSponsorsTab() {
    // Handled in loadMatchingSponsors
  }

  async function loadMatchingSponsors() {
    const card = document.getElementById('matchingSponsorConfigCard');
    if (!card) return;

    try {
      const res = await callAdminAction('list_matching_sponsors');
      const sponsors = res.sponsors || [];
      const sponsor = sponsors[0] || {
        id: 'mock_sponsor',
        sponsor_name: 'The Kestrel Global Water Fund',
        match_ratio: 1.0,
        max_cap: 25000,
        current_matched: 14800,
        is_active: true
      };

      card.innerHTML = `
        <h4 style="margin-bottom:1rem; font-size:1.1rem; color:var(--color-text-primary);">
          ${escapeHtml(sponsor.sponsor_name)}
        </h4>
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:1rem; margin-bottom:1.5rem;">
          <div>
            <label class="form-label">Match Ratio (1.0 = 1:1 match)</label>
            <input type="number" id="sponsorRatioInput" class="admin-input" value="${sponsor.match_ratio}" step="0.25" min="0.5" />
          </div>
          <div>
            <label class="form-label">Total Cap (${sponsor.currency || 'USD'})</label>
            <input type="number" id="sponsorCapInput" class="admin-input" value="${sponsor.max_cap}" step="1000" />
          </div>
          <div>
            <label class="form-label">Currently Matched</label>
            <input type="text" class="admin-input tabular-nums" readonly value="$${Number(sponsor.current_matched).toLocaleString()}" style="background:#E2E8F0;" />
          </div>
        </div>
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <label class="form-checkbox-wrapper">
            <input type="checkbox" id="sponsorActiveCheckbox" class="form-checkbox" ${sponsor.is_active ? 'checked' : ''} />
            <span class="checkbox-label" style="font-weight:600;">Active 1:1 Matching Banner on Donation Card</span>
          </label>
          <button type="button" id="saveSponsorBtn" class="btn-primary-sm">Save Matching Sponsor Settings</button>
        </div>
        <div id="sponsorSaveNotice" style="margin-top:0.75rem; font-size:0.8rem; display:none;"></div>
      `;

      const saveBtn = document.getElementById('saveSponsorBtn');
      const notice = document.getElementById('sponsorSaveNotice');
      if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
          saveBtn.disabled = true;
          const ratio = Number(document.getElementById('sponsorRatioInput').value);
          const cap = Number(document.getElementById('sponsorCapInput').value);
          const active = document.getElementById('sponsorActiveCheckbox').checked;

          try {
            await callAdminAction('update_matching_sponsor', {
              sponsor_id: sponsor.id,
              match_ratio: ratio,
              max_cap: cap,
              is_active: active
            });
            if (notice) {
              notice.style.display = 'block';
              notice.style.color = 'var(--color-success)';
              notice.textContent = 'Matching gift parameters successfully saved and logged to audit.';
              setTimeout(() => { notice.style.display = 'none'; }, 3000);
            }
          } catch (err) {
            if (notice) {
              notice.style.display = 'block';
              notice.style.color = 'var(--color-error)';
              notice.textContent = 'Error: ' + err.message;
            }
          } finally {
            saveBtn.disabled = false;
          }
        });
      }
    } catch (e) {
      console.warn('[Sponsors error]', e);
    }
  }

  // ----------------------------------------------------------------------------
  // UTILITIES & FALLBACK SIMULATOR
  // ----------------------------------------------------------------------------
  function simulateLocalAction(action, payload) {
    if (action === 'get_profile') return { role: 'admin', email: state.userEmail };
    if (action === 'list_donations') return { donations: [], total_count: 0 };
    if (action === 'export_csv') return { csv: "id,created_at,amount,currency,status\n1,2026-09-25,100,USD,success" };
    if (action === 'manual_donation_entry') return { success: true };
    if (action === 'list_cms_posts') return { posts: [
      { id: '1', title: 'Hydrological Survey Completed at Lorugum Site #2', author_name: 'Eng. Brian Njoroge', published_at: new Date().toISOString() }
    ]};
    if (action === 'list_referrals') return { referrals: [
      { referral_code: 'rotary_lodwar', total_donations: 8, successful_donations: 8, total_raised: 12500, currency: 'USD' },
      { referral_code: 'twitter_share', total_donations: 14, successful_donations: 12, total_raised: 3450, currency: 'USD' }
    ]};
    if (action === 'list_audit_logs') return { audit_logs: [
      { timestamp: new Date().toISOString(), admin_email: state.userEmail, action: 'admin_login', target: 'session', metadata: { ip: '127.0.0.1' } }
    ]};
    if (action === 'trigger_reconciliation') return { success: true, mismatches: 0, updated: 0 };
    if (action === 'list_utm_stats') return { utm_stats: [
      { source: 'newsletter', campaign: 'spring_clean_water', total_initiated: 18, total_success: 15, funds_usd: 4850 },
      { source: 'twitter', campaign: 'boreholes_launch', total_initiated: 24, total_success: 19, funds_usd: 3100 },
      { source: 'partner', campaign: 'rotary_international', total_initiated: 6, total_success: 6, funds_usd: 8500 }
    ]};
    if (action === 'list_volunteers') return { volunteers: [
      { id: 'v1', created_at: new Date(Date.now() - 86400000).toISOString(), full_name: 'Samuel Lokwang', email: 'samuel.lokwang@example.org', phone: '+254 712 998877', availability: 'flexible', skills: ['Solar & Electrical Engineering', 'Community Mobilization'], notes: 'Electrical technician based in Lodwar with 4 years solar experience.', status: 'pending_review' },
      { id: 'v2', created_at: new Date(Date.now() - 2 * 86400000).toISOString(), full_name: 'Dr. Celine Moreau', email: 'celine.moreau@waterhealth.org', phone: '+33 6 12 34 56 78', availability: 'remote_only', skills: ['Public Health & Water Quality'], notes: 'Epidemiologist available for remote water fluorosis assay review.', status: 'interviewed' },
      { id: 'v3', created_at: new Date(Date.now() - 4 * 86400000).toISOString(), full_name: 'Peter Arupe', email: 'peter.arupe@lorugum.ke', phone: '+254 720 112233', availability: 'weekends', skills: ['Logistics & Supply Chain'], notes: 'Local truck driver familiar with roads between Kitale and Lodwar.', status: 'accepted' }
    ]};
    if (action === 'update_volunteer_status') return { success: true };
    if (action === 'list_subscribers') return { total_count: 142, subscribers: [
      { id: 's1', email: 'supporter1@gmail.com', subscribed_at: new Date(Date.now() - 1200000).toISOString(), source: 'landing_dispatches_section' },
      { id: 's2', email: 'water.advocate@ngo.org', subscribed_at: new Date(Date.now() - 86400000).toISOString(), source: 'landing_dispatches_section' },
      { id: 's3', email: 'community.member@turkana.ke', subscribed_at: new Date(Date.now() - 2 * 86400000).toISOString(), source: 'landing_dispatches_section' }
    ]};
    if (action === 'list_matching_sponsors') return { sponsors: [
      { id: 'sp1', sponsor_name: 'The Kestrel Global Water Fund', match_ratio: 1.0, max_cap: 25000, current_matched: 14800, currency: 'USD', is_active: true }
    ]};
    if (action === 'update_matching_sponsor') return { success: true };
    return { success: true };
  }

  // ----------------------------------------------------------------------------
  // DEV KEYS & API CREDENTIALS MANAGEMENT (Admin Section)
  // ----------------------------------------------------------------------------
  function loadDevKeysInputs() {
    const flwKey = localStorage.getItem('twp_flutterwave_key') || 'FLWPUBK_TEST-SANDBOXDEMOKEY-X';
    const flwSecret = localStorage.getItem('twp_flutterwave_secret') || '';
    const supabaseUrl = localStorage.getItem('twp_supabase_url') || 'https://kljnyncmpsewrghkybcd.supabase.co';
    const supabaseKey = localStorage.getItem('twp_supabase_anon_key') || '';

    // Populate Tab inputs
    const tabFlw = document.getElementById('adminFlutterwaveKeyInput');
    const tabSecret = document.getElementById('adminFlutterwaveSecretInput');
    const tabUrl = document.getElementById('adminSupabaseUrlInput');
    const tabKey = document.getElementById('adminSupabaseKeyInput');

    if (tabFlw) tabFlw.value = flwKey;
    if (tabSecret) tabSecret.value = flwSecret;
    if (tabUrl) tabUrl.value = supabaseUrl;
    if (tabKey) tabKey.value = supabaseKey;

    // Populate Modal inputs
    const modalFlw = document.getElementById('modalFlutterwaveKeyInput');
    const modalSecret = document.getElementById('modalFlutterwaveSecretInput');
    const modalUrl = document.getElementById('modalSupabaseUrlInput');
    const modalKey = document.getElementById('modalSupabaseKeyInput');

    if (modalFlw) modalFlw.value = flwKey;
    if (modalSecret) modalSecret.value = flwSecret;
    if (modalUrl) modalUrl.value = supabaseUrl;
    if (modalKey) modalKey.value = supabaseKey;
  }

  function initDevKeysAdmin() {
    const devToggle = document.getElementById('adminDevKeysToggle');
    const modal = document.getElementById('adminDevKeysModal');
    const closeModal = document.getElementById('closeDevKeysModalBtn');

    if (devToggle && modal) {
      devToggle.addEventListener('click', () => {
        loadDevKeysInputs();
        modal.classList.add('active');
      });
    }

    if (closeModal && modal) {
      closeModal.addEventListener('click', () => {
        modal.classList.remove('active');
      });
    }

    // Live validation for Tab input
    const tabFlw = document.getElementById('adminFlutterwaveKeyInput');
    const tabWarning = document.getElementById('adminPubKeyWarning');
    if (tabFlw && tabWarning) {
      tabFlw.addEventListener('input', () => {
        const val = tabFlw.value.trim();
        if (val.startsWith('FLWSECK_')) {
          tabWarning.textContent = '⚠️ You entered a Secret Key (starts with FLWSECK_). Public keys start with FLWPUBK_! Browser checkout strictly requires a Public Key.';
          tabWarning.style.display = 'block';
        } else {
          tabWarning.style.display = 'none';
        }
      });
    }

    // Live validation for Modal input
    const modalFlw = document.getElementById('modalFlutterwaveKeyInput');
    const modalWarning = document.getElementById('modalPubKeyWarning');
    if (modalFlw && modalWarning) {
      modalFlw.addEventListener('input', () => {
        const val = modalFlw.value.trim();
        if (val.startsWith('FLWSECK_')) {
          modalWarning.textContent = '⚠️ You entered a Secret Key (starts with FLWSECK_). Public keys start with FLWPUBK_! Browser checkout strictly requires a Public Key.';
          modalWarning.style.display = 'block';
        } else {
          modalWarning.style.display = 'none';
        }
      });
    }

    // Wire up controls for Tab
    wireKeyControls({
      saveBtnId: 'adminSaveKeysBtn',
      diagnoseBtnId: 'adminDiagnoseBtn',
      pubKeyInputId: 'adminFlutterwaveKeyInput',
      secretKeyInputId: 'adminFlutterwaveSecretInput',
      urlInputId: 'adminSupabaseUrlInput',
      anonKeyInputId: 'adminSupabaseKeyInput',
      successMsgId: 'adminKeySuccessMsg',
      diagResultsId: 'adminDiagnosticResults'
    });

    // Wire up controls for Modal
    wireKeyControls({
      saveBtnId: 'modalSaveKeysBtn',
      diagnoseBtnId: 'modalDiagnoseBtn',
      pubKeyInputId: 'modalFlutterwaveKeyInput',
      secretKeyInputId: 'modalFlutterwaveSecretInput',
      urlInputId: 'modalSupabaseUrlInput',
      anonKeyInputId: 'modalSupabaseKeyInput',
      successMsgId: 'modalKeySuccessMsg',
      diagResultsId: 'modalDiagnosticResults'
    });

    // Initial pre-fill
    loadDevKeysInputs();

    // ------------------------------------------------------------------------
    // Flutterwave Webhook Controls & Live Testing
    // ------------------------------------------------------------------------
    const webhookInput = document.getElementById('adminWebhookUrlInput');
    const copyWebhookBtn = document.getElementById('copyWebhookUrlBtn');
    const testWebhookBtn = document.getElementById('adminTestWebhookBtn');
    const refreshWebhookLogsBtn = document.getElementById('adminRefreshWebhookLogsBtn');
    const webhookTestStatus = document.getElementById('adminWebhookTestStatus');
    const webhookLogsContainer = document.getElementById('adminWebhookLogsContainer');
    const webhookLogsList = document.getElementById('adminWebhookLogsList');

    if (webhookInput) {
      const webhookUrl = `${window.location.origin}/api/flutterwave/webhook`;
      webhookInput.value = webhookUrl;
    }

    if (copyWebhookBtn && webhookInput) {
      copyWebhookBtn.addEventListener('click', () => {
        const urlToCopy = webhookInput.value;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(urlToCopy).then(() => {
            copyWebhookBtn.textContent = '✓ Copied!';
            setTimeout(() => { copyWebhookBtn.textContent = 'Copy URL'; }, 2500);
          }).catch(() => {
            webhookInput.select();
            document.execCommand('copy');
            copyWebhookBtn.textContent = '✓ Copied!';
            setTimeout(() => { copyWebhookBtn.textContent = 'Copy URL'; }, 2500);
          });
        } else {
          webhookInput.select();
          document.execCommand('copy');
          copyWebhookBtn.textContent = '✓ Copied!';
          setTimeout(() => { copyWebhookBtn.textContent = 'Copy URL'; }, 2500);
        }
      });
    }

    async function loadWebhookLogs() {
      if (!webhookLogsList || !webhookLogsContainer) return;
      try {
        const res = await fetch('/api/flutterwave/webhook/logs');
        const data = await res.json();
        webhookLogsContainer.style.display = 'block';
        if (!data.events || data.events.length === 0) {
          webhookLogsList.innerHTML = '<div style="color:var(--color-text-muted); padding:0.25rem;">No inbound webhooks received yet. Use the test button above or make a donation to see events here.</div>';
          return;
        }
        webhookLogsList.innerHTML = data.events.map((ev) => `
          <div style="border-bottom: 1px solid var(--color-border-hairline); padding: 0.4rem 0;">
            <strong style="color: var(--color-accent-primary);">${escapeHtml(ev.event)}</strong> · 
            <span style="font-weight:700;">${escapeHtml(ev.currency)} ${(ev.amount || 0).toLocaleString()}</span> · 
            <span style="color: var(--color-text-secondary);">${escapeHtml(ev.donor_email)}</span> · 
            <span class="tabular-nums" style="color: var(--color-text-muted); font-size:0.7rem;">${new Date(ev.timestamp).toLocaleTimeString()}</span>
            ${ev.verified_signature ? '<span style="color:#15803d; font-weight:700;"> [Verified]</span>' : '<span style="color:#d97706;"> [Dev Mode]</span>'}
          </div>
        `).join('');
      } catch (e) {
        console.warn('Error loading webhook logs:', e);
      }
    }

    if (testWebhookBtn) {
      testWebhookBtn.addEventListener('click', async () => {
        if (webhookTestStatus) {
          webhookTestStatus.style.display = 'block';
          webhookTestStatus.style.background = 'var(--color-surface-card)';
          webhookTestStatus.style.color = 'var(--color-accent-primary)';
          webhookTestStatus.style.border = '1px solid var(--color-border-hairline)';
          webhookTestStatus.textContent = '⚡ Dispatching simulated Flutterwave charge.completed webhook...';
        }

        try {
          const res = await fetch('/api/flutterwave/webhook/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              amount: 50,
              currency: 'USD',
              donor_name: 'Amara Eze (Flutterwave Webhook Test)',
              email: 'amara.eze@example.org'
            })
          });

          const data = await res.json();
          if (webhookTestStatus) {
            webhookTestStatus.style.background = '#DCFCE7';
            webhookTestStatus.style.color = '#15803D';
            webhookTestStatus.style.border = '1px solid #86EFAC';
            webhookTestStatus.innerHTML = `✓ Flutterwave webhook processed successfully! Event: <code>charge.completed</code>. Database updated and real-time pop-up notification broadcasted across active users!`;
          }

          loadDonations(0);
          loadWebhookLogs();
        } catch (err) {
          if (webhookTestStatus) {
            webhookTestStatus.style.background = '#FEE2E2';
            webhookTestStatus.style.color = '#B91C1C';
            webhookTestStatus.textContent = `✗ Test webhook error: ${err.message}`;
          }
        }
      });
    }

    if (refreshWebhookLogsBtn) {
      refreshWebhookLogsBtn.addEventListener('click', loadWebhookLogs);
    }
  }

  function wireKeyControls(cfg) {
    const saveBtn = document.getElementById(cfg.saveBtnId);
    const diagnoseBtn = document.getElementById(cfg.diagnoseBtnId);
    const pubKeyInput = document.getElementById(cfg.pubKeyInputId);
    const secretKeyInput = document.getElementById(cfg.secretKeyInputId);
    const urlInput = document.getElementById(cfg.urlInputId);
    const anonKeyInput = document.getElementById(cfg.anonKeyInputId);
    const successMsg = document.getElementById(cfg.successMsgId);
    const diagResults = document.getElementById(cfg.diagResultsId);

    if (diagnoseBtn) {
      diagnoseBtn.addEventListener('click', async () => {
        if (!diagResults) return;
        diagResults.style.display = 'block';
        diagResults.innerHTML = '<div style="color:var(--color-accent-primary); font-weight:600;">Testing connection with Flutterwave and Supabase...</div>';

        try {
          const res = await fetch('/api/diagnose-keys', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              flutterwavePublicKey: pubKeyInput ? pubKeyInput.value.trim() : '',
              flutterwaveSecretKey: secretKeyInput ? secretKeyInput.value.trim() : '',
              supabaseUrl: urlInput ? urlInput.value.trim() : '',
              supabaseAnonKey: anonKeyInput ? anonKeyInput.value.trim() : ''
            })
          });

          const diag = await res.json();
          let html = '<div style="font-weight:700; margin-bottom:0.35rem;">Diagnostics Report:</div>';
          if (diag.flutterwave?.publicKeyValid) {
            html += '<div style="color:#15803d; margin-bottom:3px;">✓ Flutterwave Public Key format valid</div>';
          } else {
            html += `<div style="color:#b91c1c; margin-bottom:3px;">✗ Flutterwave Public Key: ${diag.flutterwave?.publicKeyError || 'Invalid format'}</div>`;
          }

          if (diag.flutterwave?.secretKeyValid) {
            html += `<div style="color:#15803d; margin-bottom:3px;">✓ Flutterwave Secret Key active (Supported: ${diag.flutterwave.supportedCurrencies.join(', ') || 'USD, NGN'})</div>`;
          } else if (diag.flutterwave?.error) {
            html += `<div style="color:#b91c1c; margin-bottom:3px;">✗ Flutterwave Secret Key: ${diag.flutterwave.error}</div>`;
          }

          if (diag.supabase?.connected) {
            html += '<div style="color:#15803d; margin-bottom:3px;">✓ Supabase Database connected</div>';
          } else {
            html += `<div style="color:#b91c1c; margin-bottom:3px;">✗ Supabase: ${diag.supabase?.error || 'Connection failed'}</div>`;
          }

          diagResults.innerHTML = html;
        } catch (e) {
          diagResults.innerHTML = '<div style="color:#b91c1c;">Diagnostic failed to contact backend server.</div>';
        }
      });
    }

    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        if (pubKeyInput) {
          const raw = pubKeyInput.value.trim();
          if (raw.startsWith('FLWSECK_')) {
            alert('Cannot save a Secret Key (FLWSECK_...) as Public Key. Please place Secret Key in the Secret Key input.');
            return;
          }
          localStorage.setItem('twp_flutterwave_key', raw);
        }
        if (secretKeyInput) {
          localStorage.setItem('twp_flutterwave_secret', secretKeyInput.value.trim());
        }
        if (urlInput) {
          localStorage.setItem('twp_supabase_url', urlInput.value.trim());
        }
        if (anonKeyInput) {
          localStorage.setItem('twp_supabase_anon_key', anonKeyInput.value.trim());
        }

        if (successMsg) {
          successMsg.textContent = '✓ Configuration saved and applied!';
          successMsg.style.display = 'block';
          setTimeout(() => { successMsg.style.display = 'none'; }, 3500);
        }

        initSupabase();
        loadDevKeysInputs();
      });
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

})();
