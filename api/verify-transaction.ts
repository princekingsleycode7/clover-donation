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
    let body = req.body || {};
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) {}
    }

    const transactionId = req.query?.transaction_id || body?.transaction_id;
    const txRef = req.query?.tx_ref || req.query?.reference || body?.tx_ref || body?.reference;

    let secretKey = cleanEnvString(
      process.env.FLUTTERWAVE_SECRET_KEY ||
      process.env.FLW_SECRET_KEY ||
      process.env.FLUTTERWAVE_SEC_KEY
    );

    let verified = false;
    let paymentData: any = null;

    if (transactionId && secretKey && secretKey.startsWith('FLWSECK_')) {
      try {
        const flwRes = await fetch(`https://api.flutterwave.com/v3/transactions/${encodeURIComponent(transactionId)}/verify`, {
          headers: { Authorization: `Bearer ${secretKey}` }
        });
        if (flwRes.ok) {
          const flwJson = await flwRes.json();
          if (flwJson.status === 'success' && flwJson.data && flwJson.data.status === 'successful') {
            verified = true;
            paymentData = flwJson.data;
          }
        }
      } catch (err) {
        console.warn('[api/verify-transaction] Flutterwave verify error:', err);
      }
    }

    // Update Supabase if available
    const supabaseUrl = cleanEnvString(process.env.SUPABASE_URL);
    const supabaseKey = cleanEnvString(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);
    if (supabaseUrl && supabaseKey && txRef) {
      try {
        const supabase = createClient(supabaseUrl, supabaseKey);
        await supabase.from('donations').update({
          status: verified ? 'successful' : 'pending',
          verified_at: verified ? new Date().toISOString() : null
        }).eq('paystack_reference', txRef);
      } catch (dbErr) {
        console.warn('[api/verify-transaction] DB update notice:', dbErr);
      }
    }

    return res.status(200).json({
      success: true,
      verified,
      message: verified ? 'Transaction verified successfully' : 'Transaction acknowledged',
      data: paymentData || { tx_ref: txRef, status: verified ? 'successful' : 'pending' }
    });
  } catch (err: any) {
    console.error('[api/verify-transaction] Exception:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
