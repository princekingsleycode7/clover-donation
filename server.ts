import express, { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = 3000;

// Body parsing with raw buffer preservation for webhook signature verification
app.use(express.json({
  verify: (req: any, _res, buf) => {
    req.rawBody = buf;
  }
}));

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.status(200).send('ok');
  }
  next();
});

// Environment config
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kljnyncmpsewrghkybcd.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
const PAYSTACK_PUBLIC_KEY = process.env.PAYSTACK_PUBLIC_KEY || 'pk_test_2193bfe61dcf7971c220bb9b9a0027d4eb0e2ff3';
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || 'sk_test_571bb21d760f6c483545a21f8e19195d7ecff57b';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY);

// Fixed exchange rates for merchant accounts that only process NGN
const CONVERSION_RATES: Record<string, number> = {
  USD: 1500, // 1 USD = 1500 NGN
  GBP: 1950, // 1 GBP = 1950 NGN
  NGN: 1
};

// ----------------------------------------------------------------------------
// REAL-TIME SERVER-SENT EVENTS (SSE) BROADCAST ENGINE
// ----------------------------------------------------------------------------
const sseClients = new Set<Response>();

export function broadcastDonationEvent(donation: {
  id?: string;
  donor_name?: string | null;
  amount: number;
  currency?: string;
  frequency?: string;
  timestamp?: string;
  paystack_reference?: string;
}) {
  const displayName = (!donation.donor_name || donation.donor_name.trim() === '' || donation.donor_name.toLowerCase() === 'null')
    ? 'A generous supporter'
    : donation.donor_name.trim();

  const payload = {
    id: donation.id || `dn_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    donor_name: displayName,
    amount: Number(donation.amount),
    currency: (donation.currency || 'USD').toUpperCase(),
    frequency: donation.frequency || 'one_time',
    timestamp: donation.timestamp || new Date().toISOString(),
    paystack_reference: donation.paystack_reference || ''
  };

  const message = `data: ${JSON.stringify({ type: 'donation', payload })}\n\n`;
  console.log(`[SSE Broadcast] Broadcasting donation of ${payload.currency} ${payload.amount} by ${payload.donor_name} to ${sseClients.size} active client(s)`);

  for (const client of sseClients) {
    try {
      client.write(message);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

// SSE Connection Endpoint for Live Donation Alerts across all active users
app.get('/api/donations/stream', (req: Request, res: Response) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  res.write(':connected\n\n');
  sseClients.add(res);

  // Periodic heartbeat comment to keep connection alive
  const heartbeat = setInterval(() => {
    try {
      res.write(':heartbeat\n\n');
    } catch (e) {
      clearInterval(heartbeat);
      sseClients.delete(res);
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

// Also expose /api/realtime-donations as an alias
app.get('/api/realtime-donations', (req: Request, res: Response) => {
  res.redirect('/api/donations/stream');
});

// Broadcast trigger endpoint (for testing or external webhook bridge)
app.post('/api/donations/broadcast', (req: Request, res: Response) => {
  const { donor_name, amount, currency, frequency } = req.body || {};
  if (!amount) {
    return res.status(400).json({ error: 'Amount is required to broadcast donation' });
  }

  broadcastDonationEvent({
    donor_name: donor_name || 'A generous supporter',
    amount: Number(amount),
    currency: currency || 'USD',
    frequency: frequency || 'one_time'
  });

  return res.json({ success: true, message: 'Donation broadcast sent', connected_clients: sseClients.size });
});

// ----------------------------------------------------------------------------
// API: PUBLIC CONFIG
// ----------------------------------------------------------------------------
app.get('/api/config', (_req: Request, res: Response) => {
  res.json({
    paystackPublicKey: PAYSTACK_PUBLIC_KEY,
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
    hasSecretKey: Boolean(PAYSTACK_SECRET_KEY),
    defaultCurrency: 'USD'
  });
});

// ----------------------------------------------------------------------------
// API: KEY DIAGNOSTICS & VERIFICATION
// ----------------------------------------------------------------------------
app.post('/api/diagnose-keys', async (req: Request, res: Response) => {
  const customSecretKey = req.body?.paystackSecretKey?.trim() || PAYSTACK_SECRET_KEY;
  const customPublicKey = req.body?.paystackPublicKey?.trim() || PAYSTACK_PUBLIC_KEY;
  const customSupabaseUrl = req.body?.supabaseUrl?.trim() || SUPABASE_URL;
  const customAnonKey = req.body?.supabaseAnonKey?.trim() || SUPABASE_ANON_KEY;

  const diagnostics: Record<string, any> = {
    paystack: {
      publicKeyValid: false,
      secretKeyValid: false,
      supportedCurrencies: [],
      error: null
    },
    supabase: {
      connected: false,
      tables: {},
      error: null
    }
  };

  // 1. Check Public Key format
  if (customPublicKey.startsWith('pk_test_') || customPublicKey.startsWith('pk_live_')) {
    diagnostics.paystack.publicKeyValid = true;
  } else if (customPublicKey.startsWith('sk_')) {
    diagnostics.paystack.publicKeyError = 'A Secret Key (sk_...) was entered in the Public Key field! Public keys must start with pk_...';
  } else {
    diagnostics.paystack.publicKeyError = 'Public key must start with pk_test_ or pk_live_';
  }

  // 2. Check Secret Key with Paystack API
  if (customSecretKey) {
    try {
      // Test initialize with NGN
      const pRes = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${customSecretKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: 'diagnostics@turkanawellspring.org',
          amount: 5000,
          currency: 'NGN'
        })
      });
      const pData = await pRes.json();
      if (pRes.ok && pData.status) {
        diagnostics.paystack.secretKeyValid = true;
        diagnostics.paystack.supportedCurrencies.push('NGN');
      } else {
        diagnostics.paystack.error = pData.message || 'Invalid secret key';
      }

      // Check USD support
      const pResUSD = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${customSecretKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: 'diagnostics@turkanawellspring.org',
          amount: 500,
          currency: 'USD'
        })
      });
      const pDataUSD = await pResUSD.json();
      if (pResUSD.ok && pDataUSD.status) {
        diagnostics.paystack.supportedCurrencies.push('USD');
      }
    } catch (e: any) {
      diagnostics.paystack.error = e.message;
    }
  }

  // 3. Test Supabase connection
  try {
    const testSb = createClient(customSupabaseUrl, customAnonKey);
    const { error: errD } = await testSb.from('donations').select('id').limit(1);
    if (!errD) {
      diagnostics.supabase.connected = true;
      diagnostics.supabase.tables.donations = true;
    } else {
      diagnostics.supabase.error = errD.message;
    }
  } catch (e: any) {
    diagnostics.supabase.error = e.message;
  }

  res.json(diagnostics);
});

// ----------------------------------------------------------------------------
// API: INITIATE DONATION (Handles both /api/functions/initiate-donation & /api/initiate-donation)
// ----------------------------------------------------------------------------
async function handleInitiateDonation(req: Request, res: Response) {
  try {
    const payload = req.body || {};
    const {
      amount,
      currency = 'USD',
      donor_email,
      donor_name,
      frequency = 'one_time',
      referred_by,
      is_anonymous = false,
      opt_in_leaderboard = true,
      notes,
      paystack_public_key,
      paystack_secret_key
    } = payload;

    const parsedAmount = Number(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: 'Amount must be greater than 0' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const cleanEmail = String(donor_email || '').trim().toLowerCase();
    if (!cleanEmail || !emailRegex.test(cleanEmail)) {
      return res.status(400).json({ error: 'A valid donor email address is required' });
    }

    const normalizedCurrency = String(currency).toUpperCase();
    const effectiveSecretKey = (paystack_secret_key || PAYSTACK_SECRET_KEY).trim();
    const effectivePublicKey = (paystack_public_key || PAYSTACK_PUBLIC_KEY).trim();

    // Generate unique audit reference
    const timestamp = Date.now().toString();
    const entropy = Math.random().toString(36).substring(2, 8).toUpperCase();
    const paystackReference = `TWP_${normalizedCurrency}_${timestamp}_${entropy}`;

    let paystackAccessCode: string | null = null;
    let paystackAuthUrl: string | null = null;
    let chargeCurrency = normalizedCurrency;
    let chargeAmount = parsedAmount;
    let conversionApplied = false;

    // Initialize session with Paystack if secret key is available
    if (effectiveSecretKey) {
      try {
        let amountCents = Math.round(parsedAmount * 100);

        // First attempt with requested currency
        let pRes = await fetch('https://api.paystack.co/transaction/initialize', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${effectiveSecretKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            email: cleanEmail,
            amount: amountCents,
            currency: normalizedCurrency,
            reference: paystackReference,
            metadata: {
              donor_name: donor_name || 'Anonymous',
              frequency,
              original_currency: normalizedCurrency,
              original_amount: parsedAmount,
              custom_fields: [
                { display_name: 'Donor Name', variable_name: 'donor_name', value: donor_name || 'Anonymous' },
                { display_name: 'Frequency', variable_name: 'frequency', value: frequency }
              ]
            }
          })
        });

        let pData = await pRes.json();

        // If Paystack returns unsupported currency for this merchant (e.g. Nigerian merchant with USD requested)
        if (!pRes.ok && (pData.code === 'unsupported_currency' || (pData.message && pData.message.includes('not supported')))) {
          console.warn(`[initiate-donation] Currency ${normalizedCurrency} not supported by merchant. Converting to NGN...`);
          const rate = CONVERSION_RATES[normalizedCurrency] || 1500;
          chargeAmount = Math.round(parsedAmount * rate);
          chargeCurrency = 'NGN';
          conversionApplied = true;
          amountCents = chargeAmount * 100; // in kobo

          pRes = await fetch('https://api.paystack.co/transaction/initialize', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${effectiveSecretKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              email: cleanEmail,
              amount: amountCents,
              currency: 'NGN',
              reference: paystackReference,
              metadata: {
                donor_name: donor_name || 'Anonymous',
                frequency,
                converted_from: normalizedCurrency,
                original_amount: parsedAmount,
                custom_fields: [
                  { display_name: 'Donor Name', variable_name: 'donor_name', value: donor_name || 'Anonymous' },
                  { display_name: 'Original Donation', variable_name: 'orig_donation', value: `${normalizedCurrency} ${parsedAmount}` }
                ]
              }
            })
          });
          pData = await pRes.json();
        }

        if (pRes.ok && pData.status && pData.data) {
          paystackAccessCode = pData.data.access_code;
          paystackAuthUrl = pData.data.authorization_url;
        } else {
          console.warn('[initiate-donation] Paystack initialize returned:', pData);
        }
      } catch (paystackErr) {
        console.warn('[initiate-donation] Paystack API call failed:', paystackErr);
      }
    }

    // Insert pending row into Supabase donations table
    let donationId = `loc_${Date.now()}`;
    try {
      const { data: inserted, error: insertError } = await supabase
        .from('donations')
        .insert({
          donor_name: is_anonymous ? null : (donor_name ? String(donor_name).trim() : null),
          donor_email: cleanEmail,
          amount: parsedAmount,
          currency: normalizedCurrency,
          frequency: frequency === 'monthly' ? 'monthly' : 'one_time',
          referred_by: referred_by ? String(referred_by).trim() : null,
          paystack_reference: paystackReference,
          status: 'pending',
          is_anonymous: Boolean(is_anonymous)
        })
        .select('id')
        .maybeSingle();

      if (!insertError && inserted) {
        donationId = inserted.id;
      } else if (insertError) {
        console.warn('[initiate-donation] Supabase insert warning:', insertError.message);
      }
    } catch (dbErr) {
      console.warn('[initiate-donation] DB error:', dbErr);
    }

    return res.status(201).json({
      success: true,
      donation_id: donationId,
      paystack_reference: paystackReference,
      access_code: paystackAccessCode,
      authorization_url: paystackAuthUrl,
      paystack_public_key: effectivePublicKey,
      amount: parsedAmount,
      amount_cents: Math.round(parsedAmount * 100),
      currency: normalizedCurrency,
      charge_currency: chargeCurrency,
      charge_amount: chargeAmount,
      conversion_applied: conversionApplied,
      frequency,
      donor_email: cleanEmail,
      donor_name: is_anonymous ? null : donor_name,
      channels: ['card', 'bank', 'ussd', 'qr']
    });

  } catch (err: any) {
    console.error('[initiate-donation] Server exception:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}

app.post('/api/initiate-donation', handleInitiateDonation);
app.post('/api/functions/initiate-donation', handleInitiateDonation);

// ----------------------------------------------------------------------------
// API: VERIFY TRANSACTION (Client-side completion trigger)
// ----------------------------------------------------------------------------
async function handleVerifyTransaction(req: Request, res: Response) {
  const reference = req.params.reference || req.query.reference || req.body?.reference;
  if (!reference) {
    return res.status(400).json({ error: 'Transaction reference is required' });
  }

  try {
    let verified = false;
    let paystackData: any = null;

    if (PAYSTACK_SECRET_KEY) {
      const pRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`
        }
      });
      const pJson = await pRes.json();
      if (pRes.ok && pJson.status && pJson.data?.status === 'success') {
        verified = true;
        paystackData = pJson.data;
      }
    } else {
      // In local mode without secret key, accept reference as completed
      verified = true;
    }

    if (verified) {
      // Update donation status to success in Supabase
      try {
        const { data: updatedDonations } = await supabase
          .from('donations')
          .update({
            status: 'success'
          })
          .eq('paystack_reference', reference)
          .select();

        const don = updatedDonations?.[0];
        if (don) {
          broadcastDonationEvent({
            id: don.id,
            donor_name: don.is_anonymous ? 'A generous supporter' : (don.donor_name || 'A generous supporter'),
            amount: Number(don.amount),
            currency: don.currency,
            frequency: don.frequency,
            paystack_reference: reference
          });
        } else if (paystackData) {
          broadcastDonationEvent({
            id: `ref_${reference}`,
            donor_name: paystackData.metadata?.donor_name || 'A generous supporter',
            amount: Number(paystackData.amount) / 100,
            currency: paystackData.currency || 'USD',
            frequency: 'one_time',
            paystack_reference: reference
          });
        }
      } catch (e) {
        console.warn('[verify-transaction] DB update error:', e);
      }
    }

    return res.json({
      success: true,
      verified,
      reference,
      data: paystackData
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Verification error' });
  }
}

app.all('/api/verify-transaction/:reference', handleVerifyTransaction);
app.all('/api/verify-transaction', handleVerifyTransaction);
app.all('/api/functions/verify-transaction/:reference', handleVerifyTransaction);
app.all('/api/functions/verify-transaction', handleVerifyTransaction);

// ----------------------------------------------------------------------------
// AUTOMATIC TRANSACTION RECONCILIATION
// ----------------------------------------------------------------------------
async function reconcilePendingDonations() {
  if (!PAYSTACK_SECRET_KEY) return;
  try {
    const { data: pendingDonations } = await supabase
      .from('donations')
      .select('*')
      .eq('status', 'pending')
      .limit(20);

    if (pendingDonations && pendingDonations.length > 0) {
      for (const d of pendingDonations) {
        if (!d.paystack_reference) continue;
        try {
          const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(d.paystack_reference)}`, {
            headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` }
          });
          const json = await res.json();
          if (json.status && json.data?.status === 'success') {
            await supabase.from('donations').update({ status: 'success' }).eq('id', d.id);
            broadcastDonationEvent({
              id: d.id,
              donor_name: d.is_anonymous ? 'A generous supporter' : (d.donor_name || 'A generous supporter'),
              amount: Number(d.amount),
              currency: d.currency,
              frequency: d.frequency,
              paystack_reference: d.paystack_reference
            });
            console.log(`[Reconciled] Donation ${d.paystack_reference} marked as success`);
          } else if (json.status && json.data?.status === 'failed') {
            await supabase.from('donations').update({ status: 'failed' }).eq('id', d.id);
          }
        } catch (e) {
          // Ignore transient error
        }
      }
    }
  } catch (err) {
    console.warn('[Reconciliation Warning]', err);
  }
}

// ----------------------------------------------------------------------------
// API: REAL DONATIONS LEDGER & COMMUNITY LEADERBOARD (Zero Mock Data)
// ----------------------------------------------------------------------------
async function handleGetDonations(_req: Request, res: Response) {
  try {
    // Run real-time reconciliation first
    await reconcilePendingDonations();

    const { data: donations, error } = await supabase
      .from('donations')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const all = donations || [];
    const successful = all.filter(d => d.status === 'success');

    // Calculate real totals
    let totalNGN = 0;
    let totalUSD = 0;
    const uniqueDonorEmails = new Set<string>();

    // Leaderboard aggregation map
    const donorAgg: Record<string, {
      donor_display_name: string;
      donor_email: string;
      total_contributed: number;
      currency: string;
      donations_count: number;
      is_anonymous: boolean;
      last_donation: string;
    }> = {};

    successful.forEach(d => {
      const amt = Number(d.amount) || 0;
      const curr = (d.currency || 'USD').toUpperCase();

      if (curr === 'NGN') {
        totalNGN += amt;
        totalUSD += amt / 1500;
      } else if (curr === 'GBP') {
        totalUSD += amt * 1.3;
        totalNGN += amt * 1950;
      } else {
        totalUSD += amt;
        totalNGN += amt * 1500;
      }

      if (d.donor_email) {
        uniqueDonorEmails.add(d.donor_email.toLowerCase());
      }

      const key = (d.donor_email || d.donor_name || d.id).toLowerCase();
      if (!donorAgg[key]) {
        donorAgg[key] = {
          donor_display_name: d.is_anonymous ? 'Anonymous Supporter' : (d.donor_name || 'Generous Supporter'),
          donor_email: d.donor_email,
          total_contributed: 0,
          currency: curr,
          donations_count: 0,
          is_anonymous: Boolean(d.is_anonymous),
          last_donation: d.created_at
        };
      }
      donorAgg[key].total_contributed += amt;
      donorAgg[key].donations_count += 1;
    });

    const maskEmail = (email?: string | null) => {
      if (!email || !email.includes('@')) return '';
      const [local, domain] = email.split('@');
      if (local.length <= 2) return `${local[0]}*@${domain}`;
      return `${local.substring(0, 2)}***${local.slice(-1)}@${domain}`;
    };

    const leaderboard = Object.values(donorAgg)
      .sort((a, b) => b.total_contributed - a.total_contributed)
      .map((entry, idx) => ({
        rank: idx + 1,
        ...entry,
        donor_email_masked: maskEmail(entry.donor_email)
      }));

    const mapDonationItem = (d: any) => {
      const isAnon = Boolean(d.is_anonymous);
      const name = isAnon
        ? 'Anonymous Supporter'
        : (d.donor_name || (d.donor_email ? d.donor_email.split('@')[0] : 'Generous Donor'));
      return {
        id: d.id,
        donor_display_name: name,
        donor_email_masked: isAnon ? '' : maskEmail(d.donor_email),
        amount: Number(d.amount),
        currency: d.currency || 'USD',
        frequency: d.frequency || 'one_time',
        status: d.status,
        paystack_reference: d.paystack_reference,
        created_at: d.created_at,
        is_anonymous: isAnon
      };
    };

    const verifiedDonations = successful.map(mapDonationItem);
    const allDonationsList = all.map(mapDonationItem);

    const goalUSD = 75000;
    const goalNGN = 75000 * 1500; // 112,500,000 NGN
    const remainingUSD = Math.max(0, Math.round((goalUSD - totalUSD) * 100) / 100);
    const remainingNGN = Math.max(0, Math.round(goalNGN - totalNGN));
    const percentageUSD = Math.min(100, Math.round((totalUSD / goalUSD) * 1000) / 10);
    const percentageNGN = Math.min(100, Math.round((totalNGN / goalNGN) * 1000) / 10);

    return res.json({
      success: true,
      metrics: {
        totalRaisedUSD: Math.round(totalUSD * 100) / 100,
        totalRaisedNGN: Math.round(totalNGN),
        goalUSD,
        goalNGN,
        remainingUSD,
        remainingNGN,
        percentageUSD,
        percentageNGN,
        donorCount: uniqueDonorEmails.size,
        contributionsCount: successful.length,
        totalTransactionsCount: all.length,
        primaryCurrency: totalNGN > 0 && totalUSD < totalNGN / 1500 * 2 ? 'NGN' : 'USD'
      },
      verifiedDonations,
      allDonations: allDonationsList,
      leaderboard
    });

  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Error fetching donations' });
  }
}

app.get('/api/donations', handleGetDonations);
app.get('/api/public-ledger', handleGetDonations);

// ----------------------------------------------------------------------------
// API: REAL DONOR HISTORY (Look up personal giving records by email)
// ----------------------------------------------------------------------------
async function handleDonorHistory(req: Request, res: Response) {
  const email = (req.body?.email || req.query.email || '').toString().trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email address is required' });
  }

  try {
    // Reconcile any pending donations first
    await reconcilePendingDonations();

    const { data: donations, error } = await supabase
      .from('donations')
      .select('*')
      .ilike('donor_email', email)
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const records = donations || [];
    const successfulRecords = records.filter(d => d.status === 'success');
    const totalContributed = successfulRecords.reduce((sum, d) => sum + (Number(d.amount) || 0), 0);

    return res.json({
      success: true,
      donor_email: email,
      donor_name: records[0]?.donor_name || null,
      total_contributed: totalContributed,
      currency: records[0]?.currency || 'NGN',
      donations_count: successfulRecords.length,
      all_attempts_count: records.length,
      donations: records.map(d => ({
        id: d.id,
        amount: Number(d.amount),
        currency: d.currency,
        frequency: d.frequency,
        status: d.status,
        paystack_reference: d.paystack_reference,
        created_at: d.created_at,
        is_anonymous: d.is_anonymous
      }))
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Error querying donor history' });
  }
}

app.post('/api/donor-history', handleDonorHistory);
app.get('/api/donor-history', handleDonorHistory);
app.post('/api/functions/donor-history', handleDonorHistory);

// ----------------------------------------------------------------------------
// API: PAYSTACK WEBHOOK RECEIVER & TRANSACTION RECOVERY ENGINE
// ----------------------------------------------------------------------------
const recentWebhooks: Array<{
  timestamp: string;
  event: string;
  reference: string;
  amount: number;
  currency: string;
  donor_email: string;
  verified_signature: boolean;
  status: string;
}> = [];

async function handleWebhook(req: any, res: Response) {
  const signature = req.headers['x-paystack-signature'];
  const secretKey = PAYSTACK_SECRET_KEY;
  let signatureVerified = false;

  // Validate HMAC SHA512 signature if secret key is present
  if (secretKey && signature) {
    try {
      const rawBody = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body);
      const hash = crypto.createHmac('sha512', secretKey).update(rawBody).digest('hex');
      if (hash === signature) {
        signatureVerified = true;
      } else {
        console.warn('[Paystack Webhook] Signature mismatch! Expected:', hash, 'Received:', signature);
        // If strict mode, reject unverified signature
        if (process.env.NODE_ENV === 'production') {
          return res.status(400).json({ error: 'Invalid HMAC signature' });
        }
      }
    } catch (sigErr) {
      console.warn('[Paystack Webhook] Error verifying signature:', sigErr);
    }
  } else if (!secretKey) {
    console.warn('[Paystack Webhook] Warning: PAYSTACK_SECRET_KEY not set. Processing in permissive local mode.');
    signatureVerified = true;
  }

  const event = req.body;
  if (!event || !event.event) {
    return res.status(400).json({ error: 'Invalid webhook payload: event type missing' });
  }

  const eventType = event.event;
  const tx = event.data || {};
  const ref = tx.reference || `WH_${Date.now()}`;

  console.log(`[Paystack Webhook] Received event "${eventType}" for reference: ${ref}`);

  // Track in recent webhooks buffer (last 20)
  recentWebhooks.unshift({
    timestamp: new Date().toISOString(),
    event: eventType,
    reference: ref,
    amount: tx.amount ? tx.amount / 100 : 0,
    currency: tx.currency || 'NGN',
    donor_email: tx.customer?.email || 'unknown',
    verified_signature: signatureVerified,
    status: tx.status || 'received'
  });
  if (recentWebhooks.length > 20) recentWebhooks.pop();

  // --------------------------------------------------------------------------
  // EVENT: charge.success (Payment Successful)
  // --------------------------------------------------------------------------
  if (eventType === 'charge.success') {
    try {
      // Determine real amount and currency
      const rawAmount = tx.amount ? tx.amount / 100 : 0;
      const originalAmount = tx.metadata?.original_amount ? Number(tx.metadata.original_amount) : rawAmount;
      const currency = (tx.metadata?.original_currency || tx.currency || 'NGN').toUpperCase();
      const donorEmail = (tx.customer?.email || tx.metadata?.donor_email || 'anonymous@turkanawellspring.org').toLowerCase().trim();
      const donorName = tx.metadata?.donor_name || (tx.customer?.first_name ? `${tx.customer.first_name} ${tx.customer.last_name || ''}`.trim() : null);
      const isAnonymous = Boolean(tx.metadata?.is_anonymous);
      const frequency = tx.metadata?.frequency || 'one_time';
      const channel = tx.channel || 'card';
      const paidAt = tx.paid_at || new Date().toISOString();
      const referredBy = tx.metadata?.referred_by || null;

      // 1. Check if donation record already exists in database
      const { data: existingDonation } = await supabase
        .from('donations')
        .select('*')
        .eq('paystack_reference', ref)
        .maybeSingle();

      let activeDonationRecord: any = null;

      if (existingDonation) {
        // Promote existing pending/failed record to 'success'
        const { data: updated, error: updateErr } = await supabase
          .from('donations')
          .update({
            status: 'success',
            donor_name: existingDonation.donor_name || (isAnonymous ? null : donorName),
            donor_email: existingDonation.donor_email || donorEmail,
            amount: existingDonation.amount || originalAmount,
            currency: existingDonation.currency || currency
          })
          .eq('paystack_reference', ref)
          .select();

        if (updateErr) {
          console.warn('[Paystack Webhook] Update DB error:', updateErr.message);
        } else {
          activeDonationRecord = updated?.[0] || existingDonation;
          console.log(`[Paystack Webhook] Promoted existing donation ${ref} to success`);
        }
      } else {
        // RECOVERY PATH: Insert new donation record directly from webhook payload
        const { data: inserted, error: insertErr } = await supabase
          .from('donations')
          .insert({
            paystack_reference: ref,
            amount: originalAmount,
            currency: currency,
            donor_email: donorEmail,
            donor_name: isAnonymous ? null : donorName,
            frequency: frequency,
            referred_by: referredBy,
            status: 'success',
            is_anonymous: isAnonymous,
            created_at: paidAt
          })
          .select();

        if (insertErr) {
          console.warn('[Paystack Webhook] Recovery insert DB error:', insertErr.message);
        } else {
          activeDonationRecord = inserted?.[0];
          console.log(`[Paystack Webhook] Recovered & stored new donation ${ref} from webhook`);
        }
      }

      // 2. Record in immutable audit log
      try {
        await supabase.from('audit_log').insert({
          admin_email: 'paystack_webhook@turkanawellspring.org',
          action: 'webhook_charge_success',
          target: ref,
          metadata: {
            amount: originalAmount,
            currency,
            donor_name: isAnonymous ? 'Anonymous' : (donorName || 'Supporter'),
            donor_email: donorEmail,
            channel,
            paystack_id: tx.id,
            recovered: !existingDonation
          }
        });
      } catch (auditErr) {
        // Non-blocking
      }

      // 3. Broadcast real-time donation pop-up notification across all active users
      broadcastDonationEvent({
        id: activeDonationRecord?.id || ref,
        donor_name: isAnonymous ? 'A generous supporter' : (donorName || 'A generous supporter'),
        amount: originalAmount,
        currency: currency,
        frequency: frequency,
        paystack_reference: ref,
        timestamp: paidAt
      });

    } catch (e: any) {
      console.error('[Paystack Webhook] Processing error:', e);
    }
  }

  // --------------------------------------------------------------------------
  // EVENT: subscription.create / subscription.disable (Recurring sustainers)
  // --------------------------------------------------------------------------
  if (eventType === 'subscription.create' || eventType === 'subscription.disable') {
    try {
      await supabase.from('audit_log').insert({
        admin_email: 'paystack_webhook@turkanawellspring.org',
        action: `webhook_${eventType}`,
        target: tx.subscription_code || ref,
        metadata: {
          customer: tx.customer?.email,
          status: tx.status,
          plan: tx.plan?.name
        }
      });
    } catch (e) {
      // Non-blocking
    }
  }

  // Always acknowledge webhook with HTTP 200 within 5 seconds to satisfy Paystack
  return res.status(200).json({
    status: 'success',
    message: 'Webhook processed',
    event: eventType,
    reference: ref
  });
}

// Webhook Endpoints
app.post('/api/paystack-webhook', handleWebhook);
app.post('/api/functions/paystack-webhook', handleWebhook);

// GET handler to inspect webhook status and give setup instructions
app.get('/api/paystack-webhook', (_req: Request, res: Response) => {
  const host = _req.get('host') || 'localhost:3000';
  const protocol = _req.protocol || 'https';
  const fullUrl = `${protocol}://${host}/api/paystack-webhook`;

  res.json({
    service: 'Turkana Wellspring Paystack Webhook Handler',
    status: 'active',
    listening_on: fullUrl,
    method_required: 'POST',
    hmac_header: 'x-paystack-signature',
    has_secret_key: Boolean(PAYSTACK_SECRET_KEY),
    supported_events: [
      'charge.success',
      'subscription.create',
      'subscription.disable',
      'invoice.create'
    ],
    instructions: {
      step_1: 'Log into Paystack Dashboard (https://dashboard.paystack.com)',
      step_2: 'Navigate to Settings > API Keys & Webhooks',
      step_3: `Paste this Webhook URL into the "Webhook URL" field: ${fullUrl}`,
      step_4: 'Click Save Changes'
    },
    recent_events_count: recentWebhooks.length
  });
});

// Logs endpoint for admin review
app.get('/api/paystack-webhook/logs', (_req: Request, res: Response) => {
  res.json({
    total_received: recentWebhooks.length,
    events: recentWebhooks
  });
});

// Test webhook endpoint for developers & admins to simulate a charge.success event
app.post('/api/paystack-webhook/test', async (req: Request, res: Response) => {
  const testRef = `TEST_PAYSTACK_${Date.now()}`;
  const simulatedEvent = {
    event: 'charge.success',
    data: {
      id: Math.floor(Math.random() * 1000000),
      reference: req.body?.reference || testRef,
      amount: (req.body?.amount || 10000) * 100, // in kobo
      currency: req.body?.currency || 'NGN',
      status: 'success',
      channel: req.body?.channel || 'card',
      paid_at: new Date().toISOString(),
      customer: {
        email: req.body?.email || 'donor.test@example.org',
        first_name: req.body?.first_name || 'Amara',
        last_name: req.body?.last_name || 'Eze'
      },
      metadata: {
        donor_name: req.body?.donor_name || 'Amara Eze',
        frequency: req.body?.frequency || 'one_time',
        original_amount: req.body?.amount || 10000,
        original_currency: req.body?.currency || 'NGN',
        is_anonymous: false
      }
    }
  };

  // Process simulated payload
  req.body = simulatedEvent;
  return handleWebhook(req, res);
});

// ----------------------------------------------------------------------------
// API: ADMIN ACTIONS & DONOR HISTORY PROXIES
// ----------------------------------------------------------------------------
async function handleAdminActions(req: Request, res: Response) {
  const action = req.body?.action;
  try {
    if (action === 'record_offline_donation') {
      const { donor_name, donor_email, amount, currency, frequency, payment_channel, notes, is_anonymous } = req.body;
      const ref = `OFFLINE_${Date.now()}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
      const { data: inserted, error: insErr } = await supabase
        .from('donations')
        .insert({
          donor_name: is_anonymous ? null : donor_name,
          donor_email: donor_email || 'offline@turkanawellspring.org',
          amount: Number(amount),
          currency: currency || 'USD',
          frequency: frequency || 'one_time',
          payment_channel: payment_channel || 'bank_transfer',
          status: 'success',
          is_anonymous: Boolean(is_anonymous),
          paystack_reference: ref
        })
        .select();

      if (insErr) {
        return res.status(400).json({ error: insErr.message });
      }

      broadcastDonationEvent({
        id: inserted?.[0]?.id || ref,
        donor_name: is_anonymous ? 'A generous supporter' : (donor_name || 'A generous supporter'),
        amount: Number(amount),
        currency: currency || 'USD',
        frequency: frequency || 'one_time',
        paystack_reference: ref
      });

      return res.json({ success: true, donation: inserted?.[0], reference: ref });
    }

    if (action === 'overview') {
      const { data: donations } = await supabase
        .from('donations')
        .select('*')
        .order('created_at', { ascending: false });

      const totalDonations = donations || [];
      const successful = totalDonations.filter(d => d.status === 'success');
      const totalVolume = successful.reduce((sum, d) => sum + (Number(d.amount) || 0), 0);

      return res.json({
        totalVolumeUSD: totalVolume,
        successCount: successful.length,
        pendingCount: totalDonations.length - successful.length,
        donations: totalDonations.slice(0, 50)
      });
    }

    if (action === 'list_donations') {
      let query = supabase
        .from('donations')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (req.body?.status && req.body.status !== 'all') {
        query = query.eq('status', req.body.status);
      }
      if (req.body?.currency && req.body.currency !== 'all') {
        query = query.eq('currency', req.body.currency);
      }

      const { data: donations } = await query;
      return res.json({ donations: donations || [], total_count: (donations || []).length });
    }

    if (action === 'trigger_reconciliation') {
      await reconcilePendingDonations();
      return res.json({ success: true, message: 'Reconciliation complete' });
    }

    if (action === 'list_volunteers') {
      const { data: volunteers } = await supabase.from('volunteers').select('*').order('created_at', { ascending: false });
      return res.json({ volunteers: volunteers || [] });
    }

    if (action === 'list_subscribers') {
      const { data: subs } = await supabase.from('newsletter_subscribers').select('*').order('created_at', { ascending: false });
      return res.json({ subscribers: subs || [], total_count: (subs || []).length });
    }

    if (action === 'get_profile') {
      return res.json({ role: 'admin', email: 'director@turkanawellspring.org' });
    }

    return res.json({ success: true, message: 'Action processed' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

app.post('/api/admin-actions', handleAdminActions);
app.post('/api/functions/admin-actions', handleAdminActions);

// Convenience routes for version 2
app.get('/version2', (_req: Request, res: Response) => {
  res.redirect('/version2.html');
});
app.get('/v2', (_req: Request, res: Response) => {
  res.redirect('/version2.html');
});

// ----------------------------------------------------------------------------
// VITE INTEGRATION & SERVER STARTUP
// ----------------------------------------------------------------------------
async function startServer() {
  const isDev = process.env.NODE_ENV !== 'production' && !process.env.VERCEL;

  if (isDev) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
  }

  if (!process.env.VERCEL) {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`[Turkana Wellspring Server] Running on http://0.0.0.0:${PORT}`);
    });
  }
}

if (!process.env.VERCEL) {
  startServer().catch(err => {
    console.error('Failed to start server:', err);
  });
}

export default app;
export { app };
