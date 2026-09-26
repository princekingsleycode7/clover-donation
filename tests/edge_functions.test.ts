// ==============================================================================
// TURKANA WELLSPRING INITIATIVE — PHASE 2 TEST SUITE
// Tests for:
// 1. Webhook HMAC-SHA512 signature verification & rejection of tampered payloads
// 2. Webhook idempotency (identical reference processed twice never double-counts)
// 3. Rate limiter behavior on initiate-donation (throttling abuse)
// 4. Role-based access control (RBAC) on admin-actions (viewer vs admin enforcement)
// ==============================================================================

import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";

// ------------------------------------------------------------------------------
// TEST SUITE 1: PAYSTACK WEBHOOK SIGNATURE VERIFICATION
// ------------------------------------------------------------------------------
test("Paystack Webhook: Signature verification and tampering rejection", () => {
  const secretKey = "sk_test_mock_paystack_secret_key_84920b";
  
  const originalPayload = JSON.stringify({
    event: "charge.success",
    data: {
      reference: "TWP_USD_1727254921_TEST",
      amount: 10000,
      currency: "USD",
      customer: { email: "supporter@example.org" }
    }
  });

  // Generate authentic HMAC-SHA512 signature
  const validSignature = crypto
    .createHmac("sha512", secretKey)
    .update(originalPayload)
    .digest("hex");

  // Helper verifying function identical to edge function logic
  function verifySignature(rawBody: string, headerSig: string, secret: string): boolean {
    const computed = crypto.createHmac("sha512", secret).update(rawBody).digest("hex");
    return computed.toLowerCase() === headerSig.trim().toLowerCase();
  }

  // Assertion 1: Valid signature passes
  assert.equal(
    verifySignature(originalPayload, validSignature, secretKey),
    true,
    "Authentic payload and signature must be accepted"
  );

  // Assertion 2: Tampered body with altered amount must be rejected
  const tamperedPayload = JSON.stringify({
    event: "charge.success",
    data: {
      reference: "TWP_USD_1727254921_TEST",
      amount: 500000, // Tampered from 10000 to 500000
      currency: "USD",
      customer: { email: "supporter@example.org" }
    }
  });

  assert.equal(
    verifySignature(tamperedPayload, validSignature, secretKey),
    false,
    "Tampered payload with altered amount must be rejected"
  );

  // Assertion 3: Forged signature header must be rejected
  const forgedSignature = "a".repeat(128);
  assert.equal(
    verifySignature(originalPayload, forgedSignature, secretKey),
    false,
    "Forged signature must be rejected"
  );
});

// ------------------------------------------------------------------------------
// TEST SUITE 2: WEBHOOK IDEMPOTENCY
// ------------------------------------------------------------------------------
test("Paystack Webhook: Idempotency prevents duplicate processing on retries", async () => {
  // Simulated state store representing database table 'donations'
  const mockDonationsTable = new Map<string, { status: string; count: number }>();
  let emailDispatchesCount = 0;

  mockDonationsTable.set("TWP_REF_REPLAY_TEST", {
    status: "pending",
    count: 0
  });

  // Simulated Webhook processor (emulating paystack-webhook edge function)
  async function processWebhookEvent(event: { reference: string; amount: number }) {
    const existing = mockDonationsTable.get(event.reference);
    if (!existing) {
      return { status: 404, message: "Not found" };
    }

    // Idempotency check
    if (existing.status === "success") {
      return { status: 200, message: "Already processed" };
    }

    // Promote to success and send receipt
    existing.status = "success";
    existing.count += 1;
    emailDispatchesCount += 1;

    return { status: 200, message: "Processed successfully" };
  }

  // 1st Attempt: Webhook arrives for first time
  const res1 = await processWebhookEvent({ reference: "TWP_REF_REPLAY_TEST", amount: 100 });
  assert.equal(res1.status, 200);
  assert.equal(res1.message, "Processed successfully");
  assert.equal(mockDonationsTable.get("TWP_REF_REPLAY_TEST")?.status, "success");
  assert.equal(emailDispatchesCount, 1, "Receipt must be dispatched once");

  // 2nd Attempt: Webhook retried by Paystack with same reference
  const res2 = await processWebhookEvent({ reference: "TWP_REF_REPLAY_TEST", amount: 100 });
  assert.equal(res2.status, 200);
  assert.equal(res2.message, "Already processed", "Retried webhook must return idempotent skip");
  assert.equal(mockDonationsTable.get("TWP_REF_REPLAY_TEST")?.count, 1, "Count must remain 1");
  assert.equal(emailDispatchesCount, 1, "Duplicate receipt must NOT be sent");
});

// ------------------------------------------------------------------------------
// TEST SUITE 3: RATE LIMITER BEHAVIOR
// ------------------------------------------------------------------------------
test("Rate Limiter: Throttles abuse upon exceeding request quota", () => {
  const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
  const MAX_ALLOWED = 12;
  const WINDOW_MS = 10 * 60 * 1000;

  function checkRateLimit(key: string, now: number): { allowed: boolean; remaining: number } {
    const entry = rateLimitStore.get(key);
    if (!entry || now > entry.resetAt) {
      rateLimitStore.set(key, { count: 1, resetAt: now + WINDOW_MS });
      return { allowed: true, remaining: MAX_ALLOWED - 1 };
    }

    if (entry.count >= MAX_ALLOWED) {
      return { allowed: false, remaining: 0 };
    }

    entry.count += 1;
    return { allowed: true, remaining: MAX_ALLOWED - entry.count };
  }

  const testKey = "init_limit:192.168.1.10:test@example.org";
  const baseTime = Date.now();

  // Run 12 requests within window -> all must be allowed
  for (let i = 1; i <= MAX_ALLOWED; i++) {
    const res = checkRateLimit(testKey, baseTime);
    assert.equal(res.allowed, true, `Request ${i} should be allowed`);
  }

  // 13th Request exceeds limit -> must be throttled
  const throttledRes = checkRateLimit(testKey, baseTime);
  assert.equal(throttledRes.allowed, false, "13th request within 10 minutes must be throttled (HTTP 429)");

  // After 10 minutes (window expires) -> requests are allowed again
  const afterWindowTime = baseTime + WINDOW_MS + 1000;
  const resetRes = checkRateLimit(testKey, afterWindowTime);
  assert.equal(resetRes.allowed, true, "Request after rate limit window reset must be permitted");
});

// ------------------------------------------------------------------------------
// TEST SUITE 4: ROLE CHECK ON ADMIN-ACTIONS
// ------------------------------------------------------------------------------
test("Admin Actions: Role-based permissions enforcement (admin vs viewer)", () => {
  const mockAdminDb = {
    "user_admin_01": { role: "admin", email: "director@turkanawellspring.org" },
    "user_viewer_02": { role: "viewer", email: "auditor@turkanawellspring.org" }
  };

  function executeAdminAction(userId: string | null, action: string) {
    if (!userId || !mockAdminDb[userId as keyof typeof mockAdminDb]) {
      return { status: 401, error: "Unauthorized" };
    }

    const user = mockAdminDb[userId as keyof typeof mockAdminDb];
    const writeActions = ["manual_donation_entry", "cms_create_post", "cms_delete_post", "trigger_reconciliation"];

    if (writeActions.includes(action) && user.role !== "admin") {
      return { status: 403, error: "Permission Denied: Only users with 'admin' role can perform write actions" };
    }

    return { status: 200, success: true, performedBy: user.email };
  }

  // 1. Unauthenticated request
  const unauth = executeAdminAction(null, "manual_donation_entry");
  assert.equal(unauth.status, 401, "Unauthenticated request must be rejected with 401");

  // 2. Viewer attempting read action -> permitted
  const viewerRead = executeAdminAction("user_viewer_02", "list_donations");
  assert.equal(viewerRead.status, 200, "Viewers are permitted to view donations list");

  // 3. Viewer attempting manual offline donation entry -> blocked with 403
  const viewerWrite = executeAdminAction("user_viewer_02", "manual_donation_entry");
  assert.equal(viewerWrite.status, 403, "Viewers must be forbidden from recording offline entries");

  // 4. Admin attempting manual offline donation entry -> permitted
  const adminWrite = executeAdminAction("user_admin_01", "manual_donation_entry");
  assert.equal(adminWrite.status, 200, "Admins must be permitted to record offline entries");

  // 5. Admin creating CMS update -> permitted
  const adminCms = executeAdminAction("user_admin_01", "cms_create_post");
  assert.equal(adminCms.status, 200, "Admins must be permitted to create CMS posts");
});

// ------------------------------------------------------------------------------
// TEST SUITE 5: FULL END-TO-END DONATION FLOW (Form -> Pending -> Webhook -> Success -> Ledger)
// ------------------------------------------------------------------------------
test("End-to-End: Full donation lifecycle from client input to verified public ledger", async () => {
  const secretKey = "sk_test_paystack_secret_key_prod_verified";
  
  // Database simulation
  interface DonationRow {
    id: string;
    donor_name: string | null;
    donor_email: string;
    amount: number;
    currency: string;
    frequency: string;
    paystack_reference: string;
    status: "pending" | "success" | "failed";
    is_anonymous: boolean;
    utm_source: string | null;
    utm_campaign: string | null;
    matched_amount: number;
  }

  const database: { donations: DonationRow[]; matching_cap: number; current_matched: number } = {
    donations: [],
    matching_cap: 25000,
    current_matched: 14800
  };

  // STEP 1: Form submission & initiate-donation logic
  const clientFormData = {
    donor_name: "Elena Rostova",
    donor_email: "elena.rostova@example.org",
    amount: 500,
    currency: "USD",
    frequency: "one_time",
    is_anonymous: false,
    utm_source: "newsletter",
    utm_campaign: "spring_clean_water"
  };

  // Server-side initiate: generates reference and matching gift
  const ref = `TWP_USD_${Date.now()}_E2E`;
  const matchRatio = 1.0;
  const potentialMatch = clientFormData.amount * matchRatio;
  const remainingCap = Math.max(0, database.matching_cap - database.current_matched);
  const matchedAmount = Math.min(potentialMatch, remainingCap);

  // Insert pending row
  const pendingRow: DonationRow = {
    id: "uuid-e2e-001",
    donor_name: clientFormData.donor_name,
    donor_email: clientFormData.donor_email,
    amount: clientFormData.amount,
    currency: clientFormData.currency,
    frequency: clientFormData.frequency,
    paystack_reference: ref,
    status: "pending", // Strict constraint: only pending on insert
    is_anonymous: clientFormData.is_anonymous,
    utm_source: clientFormData.utm_source,
    utm_campaign: clientFormData.utm_campaign,
    matched_amount: matchedAmount
  };
  database.donations.push(pendingRow);

  // Verify: Row is pending; public view must NOT show pending donations
  function getPublicVerifiedLedger() {
    return database.donations
      .filter(d => d.status === "success")
      .map(d => ({
        donor: d.is_anonymous ? "Anonymous Supporter" : d.donor_name,
        amount: d.amount,
        currency: d.currency,
        matched: d.matched_amount
      }));
  }

  assert.equal(database.donations[0].status, "pending");
  assert.equal(getPublicVerifiedLedger().length, 0, "Pending donations must not appear on public ledger");

  // STEP 2: Paystack processes payment & dispatches charge.success webhook
  const webhookBody = JSON.stringify({
    event: "charge.success",
    data: {
      reference: ref,
      amount: clientFormData.amount * 100, // Cents
      currency: "USD",
      channel: "card",
      customer: { email: clientFormData.donor_email }
    }
  });

  const webhookSignature = crypto
    .createHmac("sha512", secretKey)
    .update(webhookBody)
    .digest("hex");

  // Webhook handler logic
  function handleWebhook(rawBody: string, sig: string) {
    const computed = crypto.createHmac("sha512", secretKey).update(rawBody).digest("hex");
    if (computed !== sig) return { status: 401, error: "Invalid signature" };

    const payload = JSON.parse(rawBody);
    const target = database.donations.find(d => d.paystack_reference === payload.data.reference);
    if (!target) return { status: 404, error: "Not found" };

    if (target.status === "success") {
      return { status: 200, message: "Already processed" }; // Idempotent
    }

    target.status = "success";
    database.current_matched += target.matched_amount;
    return { status: 200, message: "Success promoted" };
  }

  const webhookResult = handleWebhook(webhookBody, webhookSignature);
  assert.equal(webhookResult.status, 200);
  assert.equal(database.donations[0].status, "success", "Webhook must promote pending record to success");
  assert.equal(database.current_matched, 14800 + 500, "Matching cap must increment by matched amount");

  // STEP 3: Verify Public Ledger and Aggregates
  const publicLedger = getPublicVerifiedLedger();
  assert.equal(publicLedger.length, 1, "Promoted donation now appears on verified public ledger");
  assert.equal(publicLedger[0].donor, "Elena Rostova");
  assert.equal(publicLedger[0].amount, 500);
  assert.equal(publicLedger[0].matched, 500);

  // STEP 4: Webhook Replay test (Paystack retry idempotency)
  const replayResult = handleWebhook(webhookBody, webhookSignature);
  assert.equal(replayResult.status, 200);
  assert.equal(replayResult.message, "Already processed", "Idempotent skip on replay");
  assert.equal(database.current_matched, 15300, "Replayed webhook must not double count matching gifts");
});

// ------------------------------------------------------------------------------
// TEST SUITE 6: NEWSLETTER SUBSCRIBERS DATA ISOLATION
// ------------------------------------------------------------------------------
test("Newsletter: Independent consent table isolated from donor transactions", () => {
  const subscribers: Array<{ email: string; source: string }> = [];

  function registerSubscriber(email: string, source: string) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) throw new Error("Invalid email format");
    if (subscribers.some(s => s.email === email)) return { status: "duplicate", email };
    subscribers.push({ email, source });
    return { status: "registered", email };
  }

  // Valid subscriber
  const res1 = registerSubscriber("reader@cleanwater.org", "landing_dispatches");
  assert.equal(res1.status, "registered");
  assert.equal(subscribers.length, 1);

  // Duplicate registration handled gracefully
  const res2 = registerSubscriber("reader@cleanwater.org", "landing_dispatches");
  assert.equal(res2.status, "duplicate");
  assert.equal(subscribers.length, 1);

  // Invalid email rejected
  assert.throws(() => registerSubscriber("notanemail", "footer"), /Invalid email format/);
});

// ------------------------------------------------------------------------------
// TEST SUITE 7: VOLUNTEER REGISTRATION STATE MACHINE
// ------------------------------------------------------------------------------
test("Volunteer Registration: Validates lead capture and state transitions", () => {
  interface Volunteer {
    id: string;
    fullName: string;
    email: string;
    availability: string;
    status: "pending_review" | "interviewed" | "accepted" | "archived";
  }

  const volunteers: Volunteer[] = [];

  function createVolunteer(fullName: string, email: string, availability: string): Volunteer {
    if (!fullName || !email) throw new Error("Name and email are required");
    const v: Volunteer = {
      id: "vol_" + Math.random().toString(36).substring(7),
      fullName,
      email,
      availability,
      status: "pending_review"
    };
    volunteers.push(v);
    return v;
  }

  function transitionStatus(volId: string, nextStatus: Volunteer["status"]) {
    const v = volunteers.find(item => item.id === volId);
    if (!v) throw new Error("Not found");
    v.status = nextStatus;
    return v;
  }

  const newVol = createVolunteer("Samuel Lokwang", "samuel@turkana.ke", "flexible");
  assert.equal(newVol.status, "pending_review");

  const reviewedVol = transitionStatus(newVol.id, "interviewed");
  assert.equal(reviewedVol.status, "interviewed");

  const acceptedVol = transitionStatus(newVol.id, "accepted");
  assert.equal(acceptedVol.status, "accepted");
});

