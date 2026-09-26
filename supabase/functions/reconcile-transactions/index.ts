// ==============================================================================
// SUPABASE EDGE FUNCTION: reconcile-transactions (Scheduled via pg_cron)
// Purpose: Cross-checks Paystack's transaction register against Supabase donations.
// Identifies dropped webhooks, resolves inconsistencies, and records reconciliation logs.
// ==============================================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

serve(async (req: Request) => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const paystackSecretKey = Deno.env.get("PAYSTACK_SECRET_KEY") || "";

    if (!supabaseUrl || !supabaseServiceKey || !paystackSecretKey) {
      return new Response(JSON.stringify({ error: "Missing environment credentials" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch the latest 100 Paystack transactions
    const pRes = await fetch("https://api.paystack.co/transaction?perPage=100", {
      headers: {
        Authorization: `Bearer ${paystackSecretKey}`,
        "Content-Type": "application/json"
      }
    });

    if (!pRes.ok) {
      const errText = await pRes.text();
      return new Response(JSON.stringify({ error: "Paystack API failed: " + errText }), { status: 502 });
    }

    const pJson = await pRes.json();
    const paystackTransactions = pJson.data || [];

    let reconciledCount = 0;
    let missingReferences: string[] = [];

    for (const tx of paystackTransactions) {
      if (tx.status === "success") {
        const ref = tx.reference;
        const { data: matched } = await supabase
          .from("donations")
          .select("id, status")
          .eq("paystack_reference", ref)
          .maybeSingle();

        if (!matched) {
          // Transaction exists on Paystack but was never created in DB
          missingReferences.push(ref);
        } else if (matched.status !== "success") {
          // Webhook was missed or dropped; auto-resolve status
          await supabase
            .from("donations")
            .update({
              status: "success",
              paystack_channel: tx.channel || "card",
              paystack_customer_code: tx.customer?.customer_code || null
            })
            .eq("id", matched.id);
          reconciledCount++;
        }
      }
    }

    // Log the outcome in audit_log
    await supabase.from("audit_log").insert({
      admin_email: "system:pg_cron_reconcile",
      action: "scheduled_reconciliation",
      target: "paystack_transactions",
      metadata: {
        total_scanned: paystackTransactions.length,
        auto_reconciled: reconciledCount,
        unmatched_refs: missingReferences
      }
    });

    return new Response(
      JSON.stringify({
        success: true,
        scanned: paystackTransactions.length,
        auto_reconciled: reconciledCount,
        unmatched: missingReferences.length
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
