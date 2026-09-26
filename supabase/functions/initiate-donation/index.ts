// ==============================================================================
// SUPABASE EDGE FUNCTION: initiate-donation
// Purpose: Server-side initiation of donations. Creates 'pending' row, throttles
// abuse via rate limiting, generates Paystack plan for monthly donors, and returns
// reference to client for Paystack Inline.
// ==============================================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Supported Currencies
const SUPPORTED_CURRENCIES = ["USD", "NGN", "GBP"];

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const paystackSecretKey = Deno.env.get("PAYSTACK_SECRET_KEY") || "";

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: "Server misconfiguration: missing Supabase service credentials" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Client IP & Rate Limiting Check
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || 
                     req.headers.get("cf-connecting-ip") || 
                     "127.0.0.1";

    const payload = await req.json().catch(() => null);
    if (!payload) {
      return new Response(
        JSON.stringify({ error: "Invalid JSON request payload" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const {
      amount,
      currency = "USD",
      donor_email,
      donor_name,
      frequency = "one_time",
      referred_by,
      is_anonymous = false,
      opt_in_leaderboard = true,
      notes,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_content
    } = payload;

    // 2. Validate Inputs
    const parsedAmount = Number(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return new Response(
        JSON.stringify({ error: "Amount must be a positive number greater than 0" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const normalizedCurrency = String(currency).toUpperCase();
    if (!SUPPORTED_CURRENCIES.includes(normalizedCurrency)) {
      return new Response(
        JSON.stringify({ error: `Currency ${normalizedCurrency} is not supported. Must be one of: ${SUPPORTED_CURRENCIES.join(", ")}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const cleanEmail = String(donor_email || "").trim().toLowerCase();
    if (!cleanEmail || !emailRegex.test(cleanEmail)) {
      return new Response(
        JSON.stringify({ error: "A valid donor email address is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const cleanFrequency = frequency === "monthly" ? "monthly" : "one_time";

    // 3. Rate Limiting Check: max 12 donations initiated per 10 minutes per IP or Email
    const rateLimitKey = `init_limit:${clientIp}:${cleanEmail}`;
    const now = new Date();
    const tenMinutesLater = new Date(now.getTime() + 10 * 60 * 1000);

    const { data: existingRate } = await supabase
      .from("rate_limits")
      .select("request_count, reset_at")
      .eq("key", rateLimitKey)
      .maybeSingle();

    if (existingRate) {
      const resetAt = new Date(existingRate.reset_at);
      if (now < resetAt) {
        if (existingRate.request_count >= 12) {
          return new Response(
            JSON.stringify({ error: "Too many donation requests initiated. Please wait 10 minutes." }),
            { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        await supabase
          .from("rate_limits")
          .update({ request_count: existingRate.request_count + 1 })
          .eq("key", rateLimitKey);
      } else {
        await supabase
          .from("rate_limits")
          .update({ request_count: 1, reset_at: tenMinutesLater.toISOString() })
          .eq("key", rateLimitKey);
      }
    } else {
      await supabase
        .from("rate_limits")
        .insert({ key: rateLimitKey, request_count: 1, reset_at: tenMinutesLater.toISOString() });
    }

    // 4. Monthly Recurring: Lookup or create Paystack Plan
    let planCode: string | null = null;
    if (cleanFrequency === "monthly" && paystackSecretKey) {
      try {
        const planName = `Turkana Wellspring Monthly ${normalizedCurrency} ${parsedAmount}`;
        const amountCents = Math.round(parsedAmount * 100);

        // Fetch existing plans to check if matching one exists
        const listPlansRes = await fetch("https://api.paystack.co/plan", {
          headers: {
            Authorization: `Bearer ${paystackSecretKey}`,
            "Content-Type": "application/json"
          }
        });

        if (listPlansRes.ok) {
          const listPlansJson = await listPlansRes.json();
          const match = listPlansJson.data?.find((p: any) => 
            p.amount === amountCents && 
            p.currency === normalizedCurrency && 
            p.interval === "monthly" &&
            p.is_deleted === false
          );
          if (match) {
            planCode = match.plan_code;
          }
        }

        // If not found, create plan via Paystack API
        if (!planCode) {
          const createPlanRes = await fetch("https://api.paystack.co/plan", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${paystackSecretKey}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              name: planName,
              interval: "monthly",
              amount: amountCents,
              currency: normalizedCurrency,
              description: "Monthly recurring contribution for Turkana clean water boreholes"
            })
          });

          if (createPlanRes.ok) {
            const createPlanJson = await createPlanRes.json();
            planCode = createPlanJson.data?.plan_code || null;
          }
        }
      } catch (planErr) {
        console.warn("[initiate-donation] Paystack Plan creation warning:", planErr);
      }
    }

    // 5. Check active Matching Gift Sponsor (e.g. 1:1 match)
    let matchedBySponsorId: string | null = null;
    let matchedAmount = 0;

    try {
      const { data: sponsor } = await supabase
        .from("matching_sponsors")
        .select("id, sponsor_name, match_ratio, max_cap, current_matched")
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      if (sponsor) {
        const remainingCap = Math.max(0, Number(sponsor.max_cap) - Number(sponsor.current_matched));
        if (remainingCap > 0) {
          matchedAmount = Math.min(parsedAmount * Number(sponsor.match_ratio || 1), remainingCap);
          matchedBySponsorId = sponsor.id;
        }
      }
    } catch (sponsorErr) {
      console.warn("[initiate-donation] Matching sponsor query warning:", sponsorErr);
    }

    // 6. Generate secure audit reference
    const timestampStr = Date.now().toString();
    const entropy = Math.random().toString(36).substring(2, 9).toUpperCase();
    const paystackReference = `TWP_${normalizedCurrency}_${timestampStr}_${entropy}`;

    // 7. Insert 'pending' record into Supabase
    const { data: newRow, error: insertError } = await supabase
      .from("donations")
      .insert({
        donor_name: is_anonymous ? null : (donor_name ? String(donor_name).trim() : null),
        donor_email: cleanEmail,
        amount: parsedAmount,
        currency: normalizedCurrency,
        frequency: cleanFrequency,
        referred_by: referred_by ? String(referred_by).trim() : null,
        paystack_reference: paystackReference,
        status: "pending",
        is_anonymous: Boolean(is_anonymous),
        opt_in_leaderboard: Boolean(opt_in_leaderboard),
        paystack_plan_code: planCode,
        payment_source: "paystack",
        notes: notes ? String(notes).trim() : null,
        utm_source: utm_source ? String(utm_source).trim() : null,
        utm_medium: utm_medium ? String(utm_medium).trim() : null,
        utm_campaign: utm_campaign ? String(utm_campaign).trim() : null,
        utm_content: utm_content ? String(utm_content).trim() : null,
        matched_by_sponsor_id: matchedBySponsorId,
        matched_amount: matchedAmount
      })
      .select("id, paystack_reference, amount, currency, created_at, matched_amount")
      .single();

    if (insertError) {
      console.error("[initiate-donation] DB insert failed:", insertError);
      return new Response(
        JSON.stringify({ error: "Failed to create donation record: " + insertError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 7. Return reference and metadata for Paystack Inline JS
    return new Response(
      JSON.stringify({
        success: true,
        donation_id: newRow.id,
        paystack_reference: newRow.paystack_reference,
        amount: parsedAmount,
        amount_cents: Math.round(parsedAmount * 100),
        currency: normalizedCurrency,
        frequency: cleanFrequency,
        plan_code: planCode,
        donor_email: cleanEmail,
        donor_name: is_anonymous ? null : donor_name,
        channels: ["card", "bank", "ussd", "qr"]
      }),
      { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    console.error("[initiate-donation] Unhandled error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
