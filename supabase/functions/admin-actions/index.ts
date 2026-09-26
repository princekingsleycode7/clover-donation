// ==============================================================================
// SUPABASE EDGE FUNCTION: admin-actions
// Purpose: Gated administrative operations. Enforces Supabase Auth session,
// validates role against public.admins table, and writes every action to audit_log.
// ==============================================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const paystackSecretKey = Deno.env.get("PAYSTACK_SECRET_KEY") || "";

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(JSON.stringify({ error: "Missing Supabase credentials" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 1. Verify Supabase Auth Header
    const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized: Missing Bearer Token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const token = authHeader.replace("Bearer ", "").trim();
    const adminSupabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify User Session via Supabase Auth
    const { data: userData, error: authError } = await adminSupabase.auth.getUser(token);
    if (authError || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized: Invalid or expired token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const user = userData.user;

    // 2. Query Role from public.admins table
    const { data: adminRecord, error: roleError } = await adminSupabase
      .from("admins")
      .select("id, role, email")
      .eq("user_id", user.id)
      .maybeSingle();

    if (roleError || !adminRecord) {
      return new Response(
        JSON.stringify({ error: "Access Denied: Your account is not registered in the admins table" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userRole = adminRecord.role; // 'admin' | 'viewer'
    const adminEmail = adminRecord.email || user.email || "unknown_admin";

    const body = await req.json().catch(() => ({}));
    const { action, payload = {} } = body;

    if (!action) {
      return new Response(JSON.stringify({ error: "Missing action field" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Helper: Log to audit_log
    const logAudit = async (act: string, target: string, meta: any) => {
      await adminSupabase.from("audit_log").insert({
        admin_id: user.id,
        admin_email: adminEmail,
        action: act,
        target: target,
        metadata: meta
      });
    };

    // --------------------------------------------------------------------------
    // ACTION: get_profile
    // --------------------------------------------------------------------------
    if (action === "get_profile") {
      return new Response(
        JSON.stringify({
          success: true,
          user_id: user.id,
          email: adminEmail,
          role: userRole
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --------------------------------------------------------------------------
    // ACTION: list_donations (Filtered list)
    // --------------------------------------------------------------------------
    if (action === "list_donations") {
      const {
        status,
        currency,
        search,
        date_from,
        date_to,
        limit = 50,
        offset = 0
      } = payload;

      let query = adminSupabase
        .from("donations")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false });

      if (status && status !== "all") {
        query = query.eq("status", status);
      }
      if (currency && currency !== "all") {
        query = query.eq("currency", currency);
      }
      if (date_from) {
        query = query.gte("created_at", date_from);
      }
      if (date_to) {
        query = query.lte("created_at", date_to);
      }
      if (search) {
        const s = `%${search}%`;
        query = query.or(`donor_email.ilike.${s},donor_name.ilike.${s},paystack_reference.ilike.${s},referred_by.ilike.${s}`);
      }

      query = query.range(offset, offset + limit - 1);

      const { data, count, error } = await query;
      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      return new Response(
        JSON.stringify({ success: true, donations: data, total_count: count }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --------------------------------------------------------------------------
    // ACTION: export_csv
    // --------------------------------------------------------------------------
    if (action === "export_csv") {
      const { status, currency } = payload;
      let query = adminSupabase.from("donations").select("*").order("created_at", { ascending: false });

      if (status && status !== "all") query = query.eq("status", status);
      if (currency && currency !== "all") query = query.eq("currency", currency);

      const { data, error } = await query;
      if (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
      }

      // Convert to CSV
      const headers = [
        "id",
        "created_at",
        "donor_name",
        "donor_email",
        "amount",
        "currency",
        "frequency",
        "status",
        "payment_source",
        "paystack_channel",
        "paystack_reference",
        "referred_by",
        "is_anonymous",
        "notes"
      ];

      const csvRows = [headers.join(",")];
      for (const row of data || []) {
        const values = headers.map(h => {
          let val = row[h];
          if (val === null || val === undefined) return '""';
          const str = String(val).replace(/"/g, '""');
          return `"${str}"`;
        });
        csvRows.push(values.join(","));
      }

      await logAudit("csv_export", "donations", { count: data?.length || 0, filters: payload });

      return new Response(JSON.stringify({ success: true, csv: csvRows.join("\n") }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // --------------------------------------------------------------------------
    // ACTION: manual_donation_entry (Admin Only)
    // --------------------------------------------------------------------------
    if (action === "manual_donation_entry") {
      if (userRole !== "admin") {
        return new Response(
          JSON.stringify({ error: "Permission Denied: Only users with 'admin' role can record offline donations" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const {
        donor_name,
        donor_email,
        amount,
        currency = "USD",
        frequency = "one_time",
        payment_source = "manual_bank",
        notes,
        is_anonymous = false
      } = payload;

      const parsedAmount = Number(amount);
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        return new Response(JSON.stringify({ error: "Invalid amount" }), { status: 400, headers: corsHeaders });
      }

      const manualRef = `OFFLINE_${payment_source.toUpperCase()}_${Date.now()}`;

      // Insert directly with status='success' because verified by admin
      const { data: inserted, error: insertErr } = await adminSupabase
        .from("donations")
        .insert({
          donor_name: donor_name || "Offline Benefactor",
          donor_email: donor_email || "offline-donor@wellspring.internal",
          amount: parsedAmount,
          currency: currency.toUpperCase(),
          frequency: frequency,
          paystack_reference: manualRef,
          status: "success",
          payment_source: payment_source,
          notes: notes || "Recorded manually by administrator",
          is_anonymous: Boolean(is_anonymous)
        })
        .select()
        .single();

      if (insertErr) {
        return new Response(JSON.stringify({ error: insertErr.message }), { status: 500, headers: corsHeaders });
      }

      await logAudit("manual_donation_entry", inserted.id, {
        amount: parsedAmount,
        currency,
        payment_source,
        notes
      });

      return new Response(JSON.stringify({ success: true, donation: inserted }), {
        status: 201,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // --------------------------------------------------------------------------
    // ACTION: cms_create_post (Admin Only)
    // --------------------------------------------------------------------------
    if (action === "cms_create_post") {
      if (userRole !== "admin") {
        return new Response(JSON.stringify({ error: "Permission Denied: Viewers cannot create CMS posts" }), {
          status: 403,
          headers: corsHeaders
        });
      }

      const { title, body: postBody, author_name, published_at } = payload;
      if (!title || !postBody) {
        return new Response(JSON.stringify({ error: "Title and body are required" }), { status: 400, headers: corsHeaders });
      }

      const { data: post, error: postErr } = await adminSupabase
        .from("campaign_updates")
        .insert({
          title,
          body: postBody,
          author_name: author_name || "WaterHarvest Team",
          published_at: published_at || new Date().toISOString()
        })
        .select()
        .single();

      if (postErr) {
        return new Response(JSON.stringify({ error: postErr.message }), { status: 500, headers: corsHeaders });
      }

      await logAudit("cms_create_post", post.id, { title });
      return new Response(JSON.stringify({ success: true, post }), { status: 201, headers: corsHeaders });
    }

    // --------------------------------------------------------------------------
    // ACTION: cms_delete_post (Admin Only)
    // --------------------------------------------------------------------------
    if (action === "cms_delete_post") {
      if (userRole !== "admin") {
        return new Response(JSON.stringify({ error: "Permission Denied: Viewers cannot delete CMS posts" }), {
          status: 403,
          headers: corsHeaders
        });
      }

      const { id } = payload;
      const { error: delErr } = await adminSupabase.from("campaign_updates").delete().eq("id", id);
      if (delErr) {
        return new Response(JSON.stringify({ error: delErr.message }), { status: 500, headers: corsHeaders });
      }

      await logAudit("cms_delete_post", id, {});
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
    }

    // --------------------------------------------------------------------------
    // ACTION: list_cms_posts (Admin & Viewer)
    // --------------------------------------------------------------------------
    if (action === "list_cms_posts") {
      const { data, error } = await adminSupabase
        .from("campaign_updates")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
      }

      return new Response(JSON.stringify({ success: true, posts: data }), { status: 200, headers: corsHeaders });
    }

    // --------------------------------------------------------------------------
    // ACTION: list_audit_logs (Admin & Viewer)
    // --------------------------------------------------------------------------
    if (action === "list_audit_logs") {
      const { data, error } = await adminSupabase
        .from("audit_log")
        .select("*")
        .order("timestamp", { ascending: false })
        .limit(100);

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
      }

      return new Response(JSON.stringify({ success: true, audit_logs: data }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // --------------------------------------------------------------------------
    // ACTION: list_referrals (Admin & Viewer)
    // --------------------------------------------------------------------------
    if (action === "list_referrals") {
      const { data, error } = await adminSupabase
        .from("referral_stats_summary")
        .select("*");

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
      }

      return new Response(JSON.stringify({ success: true, referrals: data }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // --------------------------------------------------------------------------
    // ACTION: trigger_reconciliation
    // --------------------------------------------------------------------------
    if (action === "trigger_reconciliation") {
      if (userRole !== "admin") {
        return new Response(JSON.stringify({ error: "Only admins can trigger reconciliation" }), {
          status: 403,
          headers: corsHeaders
        });
      }

      // Query Paystack transactions
      let mismatchCount = 0;
      let reconciledCount = 0;

      if (paystackSecretKey) {
        try {
          const pRes = await fetch("https://api.paystack.co/transaction?perPage=50", {
            headers: { Authorization: `Bearer ${paystackSecretKey}` }
          });
          if (pRes.ok) {
            const pJson = await pRes.json();
            const transactions = pJson.data || [];

            for (const tx of transactions) {
              if (tx.status === "success") {
                const { data: matched } = await adminSupabase
                  .from("donations")
                  .select("id, status")
                  .eq("paystack_reference", tx.reference)
                  .maybeSingle();

                if (!matched) {
                  mismatchCount++;
                } else if (matched.status !== "success") {
                  await adminSupabase
                    .from("donations")
                    .update({ status: "success" })
                    .eq("id", matched.id);
                  reconciledCount++;
                }
              }
            }
          }
        } catch (e) {
          console.warn("[Reconciliation warning]", e);
        }
      }

      await logAudit("reconcile_transactions", "all", { mismatchCount, reconciledCount });

      return new Response(
        JSON.stringify({ success: true, mismatches: mismatchCount, updated: reconciledCount }),
        { status: 200, headers: corsHeaders }
      );
    }

    // --------------------------------------------------------------------------
    // ACTION: list_volunteers (Admin & Viewer)
    // --------------------------------------------------------------------------
    if (action === "list_volunteers") {
      const { status } = payload;
      let query = adminSupabase.from("volunteers").select("*").order("created_at", { ascending: false });
      if (status && status !== "all") {
        query = query.eq("status", status);
      }
      const { data, error } = await query;
      if (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
      }
      return new Response(JSON.stringify({ success: true, volunteers: data }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // --------------------------------------------------------------------------
    // ACTION: update_volunteer_status (Admin Only)
    // --------------------------------------------------------------------------
    if (action === "update_volunteer_status") {
      if (userRole !== "admin") {
        return new Response(JSON.stringify({ error: "Only admins can update volunteer status" }), {
          status: 403,
          headers: corsHeaders
        });
      }
      const { volunteer_id, status } = payload;
      const { error } = await adminSupabase
        .from("volunteers")
        .update({ status })
        .eq("id", volunteer_id);

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
      }

      await logAudit("update_volunteer_status", volunteer_id, { status });
      return new Response(JSON.stringify({ success: true, volunteer_id, status }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // --------------------------------------------------------------------------
    // ACTION: list_subscribers (Admin & Viewer)
    // --------------------------------------------------------------------------
    if (action === "list_subscribers") {
      const { data, error, count } = await adminSupabase
        .from("newsletter_subscribers")
        .select("*", { count: "exact" })
        .order("subscribed_at", { ascending: false });

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
      }
      return new Response(JSON.stringify({ success: true, subscribers: data, total_count: count }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // --------------------------------------------------------------------------
    // ACTION: list_matching_sponsors (Admin & Viewer)
    // --------------------------------------------------------------------------
    if (action === "list_matching_sponsors") {
      const { data, error } = await adminSupabase
        .from("matching_sponsors")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
      }
      return new Response(JSON.stringify({ success: true, sponsors: data }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // --------------------------------------------------------------------------
    // ACTION: update_matching_sponsor (Admin Only)
    // --------------------------------------------------------------------------
    if (action === "update_matching_sponsor") {
      if (userRole !== "admin") {
        return new Response(JSON.stringify({ error: "Only admins can update matching sponsors" }), {
          status: 403,
          headers: corsHeaders
        });
      }
      const { sponsor_id, max_cap, is_active, match_ratio } = payload;
      const updates: any = {};
      if (max_cap !== undefined) updates.max_cap = max_cap;
      if (is_active !== undefined) updates.is_active = is_active;
      if (match_ratio !== undefined) updates.match_ratio = match_ratio;

      const { error } = await adminSupabase
        .from("matching_sponsors")
        .update(updates)
        .eq("id", sponsor_id);

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
      }

      await logAudit("update_matching_sponsor", sponsor_id, updates);
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // --------------------------------------------------------------------------
    // ACTION: list_utm_stats (Admin & Viewer)
    // --------------------------------------------------------------------------
    if (action === "list_utm_stats") {
      const { data, error } = await adminSupabase
        .from("donations")
        .select("utm_source, utm_medium, utm_campaign, amount, currency, status")
        .not("utm_source", "is", null);

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
      }

      // Aggregate by campaign & source
      const aggMap: Record<string, { source: string; campaign: string; total_initiated: number; total_success: number; funds_usd: number }> = {};
      for (const d of data || []) {
        const key = `${d.utm_source || "unknown"}:${d.utm_campaign || "direct"}`;
        if (!aggMap[key]) {
          aggMap[key] = {
            source: d.utm_source || "unknown",
            campaign: d.utm_campaign || "direct",
            total_initiated: 0,
            total_success: 0,
            funds_usd: 0
          };
        }
        aggMap[key].total_initiated += 1;
        if (d.status === "success") {
          aggMap[key].total_success += 1;
          aggMap[key].funds_usd += Number(d.amount) || 0;
        }
      }

      return new Response(JSON.stringify({ success: true, utm_stats: Object.values(aggMap) }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400,
      headers: corsHeaders
    });

  } catch (err: any) {
    console.error("[admin-actions Error]", err);
    return new Response(JSON.stringify({ error: err.message || "Admin action failure" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
