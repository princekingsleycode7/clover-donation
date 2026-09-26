// ==============================================================================
// SUPABASE EDGE FUNCTION: donor-history
// Purpose: Privacy-preserving Giving History access.
// Implements one-time signed magic links (15-minute validity) dispatched via Resend.
// Prevents email enumeration and unauthorized access to donor records.
// ==============================================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const resendApiKey = Deno.env.get("RESEND_API_KEY") || "";
    const appUrl = Deno.env.get("APP_URL") || "https://ais-dev-nm2a5gjkuu3egwuujnnkry-104892317049.europe-west2.run.app";

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body = await req.json().catch(() => ({}));
    const { action } = body;

    // --------------------------------------------------------------------------
    // ACTION: request_magic_link
    // --------------------------------------------------------------------------
    if (action === "request_magic_link") {
      const email = String(body.email || "").trim().toLowerCase();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!email || !emailRegex.test(email)) {
        return new Response(JSON.stringify({ error: "Please provide a valid email address." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // Check if donor has any recorded donations
      const { data: records } = await supabase
        .from("donations")
        .select("id")
        .eq("donor_email", email)
        .limit(1);

      // Generate 32-byte secure random token
      const randomBytes = new Uint8Array(32);
      crypto.getRandomValues(randomBytes);
      const rawToken = Array.from(randomBytes).map(b => b.toString(16).padStart(2, "0")).join("");
      const tokenHash = await hashToken(rawToken);

      // Expires in 15 minutes
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

      await supabase.from("donor_magic_links").insert({
        email: email,
        token_hash: tokenHash,
        expires_at: expiresAt,
        used: false
      });

      const magicLinkUrl = `${appUrl}/history.html?token=${rawToken}`;

      // Only dispatch email if donations exist, but always return uniform generic message
      if (records && records.length > 0 && resendApiKey) {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendApiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            from: "Turkana Wellspring <donations@turkanawellspring.org>",
            to: [email],
            subject: "Your Private Giving History Access Link",
            html: `
              <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; color: #1C1917; background: #FFF; border: 1px solid #E7E2DA; border-radius: 8px;">
                <h3 style="color: #0D5C3A; margin-top: 0;">Access Your Giving History</h3>
                <p>You requested a secure link to review your past contributions to the Turkana Wellspring Initiative.</p>
                <p style="margin: 20px 0;">
                  <a href="${magicLinkUrl}" style="background-color: #0D5C3A; color: #FFFFFF; padding: 12px 20px; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block;">
                    Open My Giving History
                  </a>
                </p>
                <p style="font-size: 13px; color: #78716C;">
                  This link expires in 15 minutes and can only be used once. If you did not request this link, you can safely ignore this email.
                </p>
              </div>
            `
          })
        }).catch((e) => console.warn("[Resend Magic Link Warning]", e));
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: "If donations exist for this email address, a secure private access link has been sent to your inbox."
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --------------------------------------------------------------------------
    // ACTION: verify_token
    // --------------------------------------------------------------------------
    if (action === "verify_token") {
      const rawToken = String(body.token || "").trim();
      if (!rawToken) {
        return new Response(JSON.stringify({ error: "Missing token" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const tokenHash = await hashToken(rawToken);
      const nowIso = new Date().toISOString();

      const { data: linkRow, error: linkErr } = await supabase
        .from("donor_magic_links")
        .select("*")
        .eq("token_hash", tokenHash)
        .eq("used", false)
        .gte("expires_at", nowIso)
        .maybeSingle();

      if (linkErr || !linkRow) {
        return new Response(
          JSON.stringify({ error: "Invalid or expired link. Please request a fresh giving history link." }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Mark token as used
      await supabase
        .from("donor_magic_links")
        .update({ used: true })
        .eq("id", linkRow.id);

      // Query past donations for this donor email
      const { data: donations, error: donErr } = await supabase
        .from("donations")
        .select("id, amount, currency, frequency, status, payment_source, paystack_reference, is_anonymous, created_at")
        .eq("donor_email", linkRow.email)
        .order("created_at", { ascending: false });

      if (donErr) {
        return new Response(JSON.stringify({ error: "Failed to retrieve donations" }), {
          status: 500,
          headers: corsHeaders
        });
      }

      return new Response(
        JSON.stringify({
          success: true,
          donor_email: linkRow.email,
          donations: donations || []
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400, headers: corsHeaders });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
