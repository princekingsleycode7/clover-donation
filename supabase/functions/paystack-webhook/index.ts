// ==============================================================================
// SUPABASE EDGE FUNCTION: paystack-webhook
// Purpose: Secure, idempotent Paystack webhook handler. Verifies HMAC-SHA512
// signature, transitions donation status from 'pending' to 'success', dispatches
// Resend receipts, and audits milestone threshold crossings.
// ==============================================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "x-paystack-signature, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * Verify Paystack HMAC-SHA512 signature against raw request body
 */
async function verifyPaystackSignature(
  rawBody: string,
  signatureHeader: string | null,
  secretKey: string
): Promise<boolean> {
  if (!signatureHeader || !secretKey) return false;

  try {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secretKey);
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-512" },
      false,
      ["sign"]
    );

    const bodyData = encoder.encode(rawBody);
    const signatureBuffer = await crypto.subtle.sign("HMAC", cryptoKey, bodyData);
    const signatureArray = Array.from(new Uint8Array(signatureBuffer));
    const computedSignature = signatureArray
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    return computedSignature.toLowerCase() === signatureHeader.trim().toLowerCase();
  } catch (err) {
    console.error("[Webhook Signature] Crypto error:", err);
    return false;
  }
}

/**
 * Sends transaction receipt & thank you email via Resend API
 */
async function sendDonorReceiptEmail(
  resendApiKey: string,
  donorEmail: string,
  donorName: string,
  amount: number,
  currency: string,
  reference: string,
  frequency: string,
  appUrl: string
) {
  if (!resendApiKey) {
    console.warn("[Resend] Skipping email: RESEND_API_KEY is not configured");
    return;
  }

  const isMonthly = frequency === "monthly";
  const formattedAmount = `${currency} ${amount.toLocaleString()}`;
  const givingHistoryUrl = `${appUrl}/history.html`;

  const emailHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Thank You for Supporting Turkana</title>
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #FBF9F5; margin: 0; padding: 30px; color: #1C1917;">
      <div style="max-width: 580px; margin: 0 auto; background: #FFFFFF; border-radius: 8px; border: 1px solid #E7E2DA; padding: 32px; box-shadow: 0 4px 12px rgba(0,0,0,0.04);">
        <div style="border-bottom: 2px solid #0D5C3A; padding-bottom: 16px; margin-bottom: 24px;">
          <h2 style="margin: 0; color: #0D5C3A; font-size: 22px;">Turkana Wellspring Initiative</h2>
          <p style="margin: 4px 0 0; color: #78716C; font-size: 13px;">Official NGO Reg: NGO-KEN-2019/84920B</p>
        </div>

        <h3 style="color: #1C1917; font-size: 18px; margin-top: 0;">Official Donation Receipt & Impact Acknowledgement</h3>
        <p style="color: #57534E; font-size: 15px; line-height: 1.6;">
          Dear <strong>${donorName || "Supporter of Clean Water"}</strong>,
        </p>
        <p style="color: #57534E; font-size: 15px; line-height: 1.6;">
          Your verified ${isMonthly ? "monthly recurring" : "one-time"} contribution of <strong>${formattedAmount}</strong> has been received and allocated directly to our deep aquifer solar borehole construction in Turkana County, Kenya.
        </p>

        <div style="background-color: #F5F1E9; border-radius: 6px; padding: 18px; margin: 24px 0; border-left: 4px solid #0D5C3A;">
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr>
              <td style="padding: 6px 0; color: #78716C;">Transaction Reference:</td>
              <td style="padding: 6px 0; font-family: monospace; font-weight: bold; text-align: right;">${reference}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #78716C;">Amount:</td>
              <td style="padding: 6px 0; font-weight: bold; color: #0D5C3A; text-align: right;">${formattedAmount}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #78716C;">Frequency:</td>
              <td style="padding: 6px 0; text-align: right;">${isMonthly ? "Monthly Sustainer" : "One-Time"}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #78716C;">Date & Time:</td>
              <td style="padding: 6px 0; text-align: right;">${new Date().toUTCString()}</td>
            </tr>
          </table>
        </div>

        <p style="color: #57534E; font-size: 14px; line-height: 1.6;">
          You can track your lifetime contributions, download tax receipts, or manage your giving at any time without a password via our secure portal:
        </p>
        <div style="text-align: center; margin: 24px 0;">
          <a href="${givingHistoryUrl}" style="background-color: #0D5C3A; color: #FFFFFF; padding: 12px 24px; border-radius: 4px; text-decoration: none; font-weight: bold; font-size: 14px; display: inline-block;">
            View My Giving History
          </a>
        </div>

        <div style="border-top: 1px solid #E7E2DA; padding-top: 20px; font-size: 12px; color: #A8A29E; text-align: center;">
          WaterHarvest International Foundation · Turkana Clean Water Mission<br/>
          Payments processed securely via Paystack.
        </div>
      </div>
    </body>
    </html>
  `;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "Turkana Wellspring <donations@turkanawellspring.org>",
        to: [donorEmail],
        subject: `Receipt: Your ${formattedAmount} donation to Turkana Clean Water`,
        html: emailHtml
      })
    });
    if (!res.ok) {
      const errText = await res.text();
      console.warn("[Resend] Email dispatch warning:", errText);
    } else {
      console.log(`[Resend] Receipt sent to ${donorEmail}`);
    }
  } catch (err) {
    console.error("[Resend] Error sending receipt:", err);
  }
}

/**
 * Checks and broadcasts milestone alerts to all past unique donors when 25, 50, 75, or 100% is reached
 */
async function checkAndTriggerMilestones(supabase: any, resendApiKey: string, appUrl: string) {
  try {
    const { data: summary } = await supabase
      .from("campaign_progress_summary")
      .select("total_raised, goal_amount, percentage_funded")
      .limit(1)
      .single();

    if (!summary) return;

    const percentage = Number(summary.percentage_funded);
    const totalRaised = Number(summary.total_raised);
    const milestones = [25, 50, 75, 100];

    for (const m of milestones) {
      if (percentage >= m) {
        // Check if this milestone has already been sent
        const { data: existing } = await supabase
          .from("milestones_sent")
          .select("milestone_percentage")
          .eq("milestone_percentage", m)
          .maybeSingle();

        if (!existing) {
          // Log milestone sent first for deduplication
          await supabase.from("milestones_sent").insert({
            milestone_percentage: m,
            total_raised_at_time: totalRaised
          });

          console.log(`[Milestone Alert] Campaign crossed ${m}%! Sending celebration alert.`);

          // Gather unique verified donors to notify
          const { data: donors } = await supabase
            .from("donations")
            .select("donor_email")
            .eq("status", "success");

          if (donors && donors.length > 0 && resendApiKey) {
            const uniqueEmails = Array.from(new Set(donors.map((d: any) => d.donor_email)));
            for (const email of uniqueEmails.slice(0, 50)) { // Safe batch size
              await fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${resendApiKey}`,
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  from: "Turkana Wellspring <updates@turkanawellspring.org>",
                  to: [email],
                  subject: `Milestone Reached! We are ${m}% funded for Turkana`,
                  html: `
                    <div style="font-family: sans-serif; padding: 20px; color: #1C1917;">
                      <h2 style="color: #0D5C3A;">Incredible News: ${m}% Funded!</h2>
                      <p>Thanks to supporters like you, our Turkana Clean Water Campaign has reached <strong>${m}%</strong> of its $75,000 goal, raising $${totalRaised.toLocaleString()}.</p>
                      <p>Hydrological drilling crews are moving equipment to Lorugum. Track live progress on our site:</p>
                      <p><a href="${appUrl}" style="color: #0D5C3A; font-weight: bold;">View Campaign Progress</a></p>
                    </div>
                  `
                })
              }).catch(() => {});
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn("[Milestone Error]", err);
  }
}

// ----------------------------------------------------------------------------
// MAIN SERVER HANDLER
// ----------------------------------------------------------------------------
serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const rawBody = await req.text();
    const signatureHeader = req.headers.get("x-paystack-signature");
    const paystackSecretKey = Deno.env.get("PAYSTACK_SECRET_KEY") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const resendApiKey = Deno.env.get("RESEND_API_KEY") || "";
    const appUrl = Deno.env.get("APP_URL") || "https://ais-dev-nm2a5gjkuu3egwuujnnkry-104892317049.europe-west2.run.app";

    // 1. NON-NEGOTIABLE SECURITY: Signature Verification
    const isValid = await verifyPaystackSignature(rawBody, signatureHeader, paystackSecretKey);
    if (!isValid) {
      console.error("[Paystack Webhook] Signature verification failed!");
      return new Response(
        JSON.stringify({ error: "Invalid Paystack webhook signature" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const payload = JSON.parse(rawBody);
    const eventType = payload.event;
    const eventData = payload.data;

    console.log(`[Paystack Webhook] Received verified event: ${eventType} | Ref: ${eventData?.reference}`);

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 2. Handle 'charge.success'
    if (eventType === "charge.success") {
      const reference = eventData.reference;
      const channel = eventData.channel;
      const customer = eventData.customer || {};
      const plan = eventData.plan || {};

      if (!reference) {
        return new Response("Missing reference in charge.success", { status: 400 });
      }

      // IDEMPOTENCY CHECK: Lookup existing donation record
      const { data: existingDonation, error: lookupError } = await supabase
        .from("donations")
        .select("id, status, amount, currency, donor_email, donor_name, frequency, is_anonymous")
        .eq("paystack_reference", reference)
        .maybeSingle();

      if (lookupError) {
        console.error("[Webhook DB lookup error]", lookupError);
        return new Response("Database error", { status: 500 });
      }

      // If already 'success', terminate cleanly (Idempotent replay)
      if (existingDonation && existingDonation.status === "success") {
        console.log(`[Paystack Webhook] Reference ${reference} was already verified as success. Idempotent skip.`);
        return new Response(JSON.stringify({ message: "Already processed" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const chargeAmount = eventData.amount ? eventData.amount / 100 : (existingDonation?.amount || 0);
      const chargeCurrency = eventData.currency || existingDonation?.currency || "USD";
      const donorEmail = customer.email || existingDonation?.donor_email;
      const donorName = existingDonation?.donor_name || `${customer.first_name || ""} ${customer.last_name || ""}`.trim() || null;

      // Flip status to 'success' and record channel + customer metadata
      if (existingDonation) {
        await supabase
          .from("donations")
          .update({
            status: "success",
            paystack_channel: channel || "card",
            paystack_customer_code: customer.customer_code || null,
            paystack_plan_code: plan.plan_code || null
          })
          .eq("id", existingDonation.id);
      } else {
        // Fallback for direct Paystack links outside initiate-donation
        await supabase
          .from("donations")
          .insert({
            donor_name: donorName,
            donor_email: donorEmail,
            amount: chargeAmount,
            currency: chargeCurrency,
            frequency: plan.plan_code ? "monthly" : "one_time",
            paystack_reference: reference,
            status: "success",
            paystack_channel: channel || "card",
            paystack_customer_code: customer.customer_code || null,
            paystack_plan_code: plan.plan_code || null,
            payment_source: "paystack"
          });
      }

      // Send Resend Receipt
      await sendDonorReceiptEmail(
        resendApiKey,
        donorEmail,
        donorName,
        chargeAmount,
        chargeCurrency,
        reference,
        existingDonation?.frequency || (plan.plan_code ? "monthly" : "one_time"),
        appUrl
      );

      // Trigger Milestone check
      await checkAndTriggerMilestones(supabase, resendApiKey, appUrl);

      return new Response(JSON.stringify({ status: "success", processed: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 3. Handle 'charge.failed'
    if (eventType === "charge.failed") {
      const reference = eventData.reference;
      if (reference) {
        await supabase
          .from("donations")
          .update({ status: "failed" })
          .eq("paystack_reference", reference)
          .eq("status", "pending");
      }
      return new Response(JSON.stringify({ status: "failed_recorded" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 4. Handle 'subscription.create' / 'invoice.create'
    if (eventType === "subscription.create" || eventType === "invoice.create") {
      console.log(`[Paystack Webhook] Subscription event recorded: ${eventType}`);
      const subscriptionCode = eventData.subscription_code;
      const customerCode = eventData.customer?.customer_code;
      const email = eventData.customer?.email;

      if (subscriptionCode && email) {
        await supabase
          .from("donations")
          .update({
            paystack_subscription_code: subscriptionCode,
            paystack_customer_code: customerCode
          })
          .eq("donor_email", email)
          .order("created_at", { ascending: false })
          .limit(1);
      }

      return new Response(JSON.stringify({ status: "subscription_recorded" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Default acknowledgement for other events
    return new Response(JSON.stringify({ status: "ignored" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err: any) {
    console.error("[Paystack Webhook Error]", err);
    return new Response(
      JSON.stringify({ error: err.message || "Webhook processing failure" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
