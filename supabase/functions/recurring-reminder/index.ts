// ==============================================================================
// SUPABASE EDGE FUNCTION: recurring-reminder (Scheduled)
// Purpose: Identifies monthly recurring donors whose next renewal occurs in ~3 days
// and dispatches a transparent advance notice receipt email via Resend.
// ==============================================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

serve(async (req: Request) => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const resendApiKey = Deno.env.get("RESEND_API_KEY") || "";
    const appUrl = Deno.env.get("APP_URL") || "https://ais-dev-nm2a5gjkuu3egwuujnnkry-104892317049.europe-west2.run.app";

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(JSON.stringify({ error: "Missing config" }), { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Query active monthly donors who donated ~27-28 days ago (3 days before monthly renewal)
    const twentySevenDaysAgo = new Date(Date.now() - 27 * 86400000).toISOString();
    const twentyEightDaysAgo = new Date(Date.now() - 28 * 86400000).toISOString();

    const { data: upcomingDonors, error } = await supabase
      .from("donations")
      .select("id, donor_name, donor_email, amount, currency, paystack_subscription_code")
      .eq("frequency", "monthly")
      .eq("status", "success")
      .gte("created_at", twentyEightDaysAgo)
      .lte("created_at", twentySevenDaysAgo);

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    let remindersSent = 0;

    for (const donor of upcomingDonors || []) {
      if (resendApiKey && donor.donor_email) {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendApiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            from: "Turkana Wellspring <donations@turkanawellspring.org>",
            to: [donor.donor_email],
            subject: `Notice: Your monthly clean water support renews in 3 days (${donor.currency} ${donor.amount})`,
            html: `
              <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; color: #1C1917; background: #FFF; border: 1px solid #E7E2DA; border-radius: 8px;">
                <h3 style="color: #0D5C3A;">Upcoming Monthly Sustainer Contribution</h3>
                <p>Hello <strong>${donor.donor_name || "Valued Supporter"}</strong>,</p>
                <p>This is a quick courtesy note that your recurring monthly contribution of <strong>${donor.currency} ${donor.amount}</strong> for the Turkana Solar Borehole Mission will renew in approximately 3 days.</p>
                <p>Because of your ongoing support, clean water is pumped daily without interruption at our Lorugum borehole kiosk.</p>
                <p style="margin: 20px 0;">
                  <a href="${appUrl}/history.html" style="color: #0D5C3A; font-weight: bold;">Manage or View Your Giving History</a>
                </p>
                <p style="font-size: 12px; color: #78716C;">
                  WaterHarvest International Foundation · Reg: NGO-KEN-2019/84920B
                </p>
              </div>
            `
          })
        }).catch((e) => console.warn("[Recurring Reminder Resend]", e));
        remindersSent++;
      }
    }

    return new Response(JSON.stringify({ success: true, reminders_sent: remindersSent }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
