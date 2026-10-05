import { createClient } from '@supabase/supabase-js';

function cleanEnvString(val?: any): string {
  if (!val) return '';
  let str = String(val).trim();
  if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
    str = str.slice(1, -1).trim();
  }
  return str.replace(/\\r/g, '').replace(/\\n/g, '').trim();
}

export default async function handler(req: any, res: any) {
  // CORS configuration
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    let pub = cleanEnvString(
      process.env.FLUTTERWAVE_PUBLIC_KEY ||
      process.env.VITE_FLUTTERWAVE_PUBLIC_KEY ||
      process.env.NEXT_PUBLIC_FLUTTERWAVE_PUBLIC_KEY ||
      process.env.FLW_PUBLIC_KEY ||
      process.env.FLUTTERWAVE_PUB_KEY ||
      process.env.FLW_PUB_KEY ||
      process.env.PUBLIC_KEY
    );

    let sec = cleanEnvString(
      process.env.FLUTTERWAVE_SECRET_KEY ||
      process.env.FLW_SECRET_KEY ||
      process.env.FLUTTERWAVE_SEC_KEY ||
      process.env.FLW_SEC_KEY ||
      process.env.SECRET_KEY
    );

    // Auto-repair if public and secret keys were swapped in Vercel settings
    if ((pub.startsWith('FLWSECK_') || pub.startsWith('FLWSECK-')) &&
        (!sec || sec.startsWith('FLWPUBK_') || sec.startsWith('FLWPUBK-'))) {
      console.warn('[api/initiate-donation] Swapped keys detected; auto-swapping.');
      const temp = pub;
      pub = sec;
      sec = temp;
    } else if ((sec.startsWith('FLWPUBK_') || sec.startsWith('FLWPUBK-')) &&
               (!pub || pub.startsWith('FLWSECK_') || pub.startsWith('FLWSECK-'))) {
      console.warn('[api/initiate-donation] Swapped keys detected; auto-swapping.');
      const temp = pub;
      pub = sec;
      sec = temp;
    }

    const isRealPubKey = Boolean(pub && !pub.includes('SANDBOXDEMOKEY') && (pub.startsWith('FLWPUBK_') || pub.startsWith('FLWPUBK-')));
    const finalPubKey = pub || 'FLWPUBK_TEST-SANDBOXDEMOKEY-X';

    // Parse payload (handles JSON body or stringified body)
    let body = req.body || {};
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) {}
    }

    const amount = Number(body.amount) || 25;
    const currency = String(body.currency || 'USD').toUpperCase();
    const frequency = String(body.frequency || 'one_time');
    const donor_email = String(body.donor_email || body.email || '').trim().toLowerCase();
    const donor_name = body.donor_name ? String(body.donor_name).trim() : null;
    const tx_ref = body.tx_ref || `KF-WELLSPRING-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    let donationId = `pending_${Date.now()}`;

    // Optionally save initial pending record to Supabase if configured
    const supabaseUrl = cleanEnvString(process.env.SUPABASE_URL);
    const supabaseKey = cleanEnvString(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);
    if (supabaseUrl && supabaseKey) {
      try {
        const supabase = createClient(supabaseUrl, supabaseKey);
        const { data: inserted } = await supabase.from('donations').insert({
          amount,
          currency,
          frequency,
          status: 'pending',
          donor_email: donor_email || null,
          donor_name: donor_name || null,
          paystack_reference: tx_ref,
          campaign_id: 'amira-bone-marrow',
          is_anonymous: !donor_name
        }).select('id').maybeSingle();

        if (inserted && inserted.id) {
          donationId = inserted.id;
        }
      } catch (dbErr) {
        console.warn('[api/initiate-donation] DB insert notice:', dbErr);
      }
    }

    return res.status(200).json({
      success: true,
      donation_id: donationId,
      tx_ref,
      amount,
      currency,
      frequency,
      donor_email,
      donor_name,
      flutterwave_public_key: finalPubKey,
      has_valid_key: isRealPubKey
    });
  } catch (err: any) {
    console.error('[api/initiate-donation] Exception:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
