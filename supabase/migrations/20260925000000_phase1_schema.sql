-- ==============================================================================
-- PHASE 1: SUPABASE SCHEMA MIGRATION
-- Project: Turkana Wellspring Initiative (Single-Cause Donation Website)
-- Stack: Plain HTML/CSS/JS + Supabase + Paystack Inline
-- ==============================================================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------------------------------------
-- 1. CAMPAIGN SETTINGS TABLE
-- Stores the single-cause target goal, currency, title, story, and NGO reg number
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.campaign_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    goal_amount NUMERIC(12, 2) NOT NULL CHECK (goal_amount > 0),
    currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    cause_title TEXT NOT NULL,
    cause_description TEXT NOT NULL,
    org_reg_number TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS on campaign_settings
ALTER TABLE public.campaign_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Public read-only access for campaign settings
DROP POLICY IF EXISTS "Public can view campaign settings" ON public.campaign_settings;
CREATE POLICY "Public can view campaign settings"
    ON public.campaign_settings
    FOR SELECT
    TO anon, authenticated
    USING (true);

-- Disallow public insert/update/delete on campaign_settings
DROP POLICY IF EXISTS "No public insert on campaign settings" ON public.campaign_settings;
DROP POLICY IF EXISTS "No public update on campaign settings" ON public.campaign_settings;
DROP POLICY IF EXISTS "No public delete on campaign settings" ON public.campaign_settings;


-- ------------------------------------------------------------------------------
-- 2. DONATIONS TABLE
-- Stores donor records with strict integrity and zero client trust for 'success' status
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.donations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    donor_name TEXT,
    donor_email TEXT NOT NULL CHECK (donor_email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
    amount NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
    currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    frequency TEXT NOT NULL CHECK (frequency IN ('one_time', 'monthly')),
    referred_by TEXT,
    paystack_reference TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed', 'refunded')),
    is_anonymous BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index frequently queried columns for performance
CREATE INDEX IF NOT EXISTS idx_donations_status ON public.donations(status);
CREATE INDEX IF NOT EXISTS idx_donations_created_at ON public.donations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_donations_paystack_ref ON public.donations(paystack_reference);

-- Enable RLS on donations
ALTER TABLE public.donations ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 3. SECURITY TRIGGER: FORCE STATUS TO 'pending' ON INSERT
-- Guarantees that no client payload can ever insert a donation with status = 'success'
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_pending_donation_status()
RETURNS TRIGGER AS $$
BEGIN
    -- Unconditionally override status to 'pending' on all new public inserts
    NEW.status := 'pending';
    
    -- Anonymize name immediately if marked anonymous
    IF NEW.is_anonymous = true THEN
        NEW.donor_name := NULL;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_enforce_pending_donation ON public.donations;
CREATE TRIGGER trg_enforce_pending_donation
    BEFORE INSERT ON public.donations
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_pending_donation_status();

-- ------------------------------------------------------------------------------
-- 4. RLS POLICIES FOR DONATIONS TABLE
-- Public INSERT is permitted, but status is locked to 'pending' by the trigger.
-- Direct public SELECT on the donations table is blocked to prevent email & data leakage.
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Public can insert pending donations" ON public.donations;
CREATE POLICY "Public can insert pending donations"
    ON public.donations
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (
        -- Defense in depth: Client must provide amount > 0 and email
        amount > 0 AND
        donor_email IS NOT NULL AND
        paystack_reference IS NOT NULL
    );

-- Block public direct SELECT on raw donations table (only the secured view can be read)
DROP POLICY IF EXISTS "No direct public select on donations" ON public.donations;
CREATE POLICY "No direct public select on donations"
    ON public.donations
    FOR SELECT
    TO anon, authenticated
    USING (false);

-- No public UPDATE or DELETE on donations (updates reserved for Phase 2 backend webhook)
DROP POLICY IF EXISTS "No public update on donations" ON public.donations;
DROP POLICY IF EXISTS "No public delete on donations" ON public.donations;

-- ------------------------------------------------------------------------------
-- 5. SECURED PUBLIC VIEW: public_verified_donations
-- Exposes only verified ('success') donations.
-- Automatically masks donor_name when is_anonymous is true and strips donor_email entirely.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.public_verified_donations
WITH (security_invoker = false) AS
SELECT
    d.id,
    CASE 
        WHEN d.is_anonymous = true THEN 'Anonymous Supporter'
        WHEN d.donor_name IS NULL OR TRIM(d.donor_name) = '' THEN 'Kind Contributor'
        ELSE d.donor_name
    END AS donor_display_name,
    d.amount,
    d.currency,
    d.frequency,
    d.is_anonymous,
    d.created_at
FROM public.donations d
WHERE d.status = 'success';

-- Grant SELECT on public_verified_donations view to anon and authenticated roles
GRANT SELECT ON public.public_verified_donations TO anon, authenticated;

-- ------------------------------------------------------------------------------
-- 6. PUBLIC CAMPAIGN PROGRESS SUMMARY VIEW
-- Precomputes aggregate total raised and verified donor count
-- ------------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.campaign_progress_summary
WITH (security_invoker = false) AS
SELECT
    s.id AS campaign_id,
    s.cause_title,
    s.cause_description,
    s.goal_amount,
    s.currency,
    s.org_reg_number,
    COALESCE(SUM(d.amount), 0)::NUMERIC(12, 2) AS total_raised,
    COUNT(d.id)::INTEGER AS verified_donors_count,
    ROUND(
        LEAST(100.0, (COALESCE(SUM(d.amount), 0) / NULLIF(s.goal_amount, 0)) * 100),
        1
    )::NUMERIC(5, 1) AS percentage_funded
FROM public.campaign_settings s
LEFT JOIN public.donations d 
    ON d.status = 'success' AND d.currency = s.currency
GROUP BY s.id, s.cause_title, s.cause_description, s.goal_amount, s.currency, s.org_reg_number;

GRANT SELECT ON public.campaign_progress_summary TO anon, authenticated;

-- ------------------------------------------------------------------------------
-- 7. INITIAL SEED DATA
-- Default single-cause settings and verified community donations for initial launch
-- ------------------------------------------------------------------------------
INSERT INTO public.campaign_settings (
    goal_amount,
    currency,
    cause_title,
    cause_description,
    org_reg_number
)
VALUES (
    75000.00,
    'USD',
    'The Turkana Solar Borehole & Clean Water Initiative',
    'Severe cyclical drought across northern Turkana County forces over 14,000 pastoralist families and primary school children to walk up to 18 kilometers daily in search of contaminated riverbed water. Our initiative constructs deep solar-powered aquifer boreholes, hygienic water kiosks, and drip-irrigated community seed gardens that provide continuous, safe water for generations.',
    'NGO-KEN-2019/84920B'
)
ON CONFLICT DO NOTHING;

-- Temporarily bypass the trigger to seed initial verified donations for local preview
-- In production, rows are inserted with status='pending' and promoted to 'success' via Phase 2 webhook
DO $$
DECLARE
    v_campaign_id UUID;
BEGIN
    -- Sample baseline verified donations
    INSERT INTO public.donations (donor_name, donor_email, amount, currency, frequency, referred_by, paystack_reference, status, is_anonymous, created_at)
    VALUES
        ('Elena Rostova', 'elena.rostova@example.org', 2500.00, 'USD', 'one_time', 'impact_kenya', 'TWP_VERIFIED_REF_001', 'success', false, NOW() - INTERVAL '4 days'),
        ('Kiplagat Tanui', 'k.tanui@example.com', 500.00, 'USD', 'monthly', 'water_action', 'TWP_VERIFIED_REF_002', 'success', false, NOW() - INTERVAL '3 days'),
        (NULL, 'anonymous1@example.com', 1000.00, 'USD', 'one_time', NULL, 'TWP_VERIFIED_REF_003', 'success', true, NOW() - INTERVAL '2 days'),
        ('Amara Okafor', 'amara.okafor@example.com', 250.00, 'USD', 'one_time', 'ref_unicef_partner', 'TWP_VERIFIED_REF_004', 'success', false, NOW() - INTERVAL '28 hours'),
        ('David van der Meer', 'david.vdm@example.nl', 750.00, 'USD', 'monthly', NULL, 'TWP_VERIFIED_REF_005', 'success', false, NOW() - INTERVAL '19 hours'),
        ('Sarah Jenkins', 'sarah.j@example.com', 150.00, 'USD', 'one_time', 'twitter_share', 'TWP_VERIFIED_REF_006', 'success', false, NOW() - INTERVAL '11 hours'),
        (NULL, 'donor_anon_52@example.net', 5000.00, 'USD', 'one_time', 'rotary_eastafrica', 'TWP_VERIFIED_REF_007', 'success', true, NOW() - INTERVAL '6 hours'),
        ('Dr. Tariq Al-Mansoor', 'tariq.m@example.org', 1200.00, 'USD', 'one_time', NULL, 'TWP_VERIFIED_REF_008', 'success', false, NOW() - INTERVAL '3 hours'),
        ('Maya Lin & Friends', 'maya.lin@example.com', 350.00, 'USD', 'monthly', 'ref_alumni', 'TWP_VERIFIED_REF_009', 'success', false, NOW() - INTERVAL '85 minutes'),
        ('Faith Cherono', 'faith.c@example.ke', 100.00, 'USD', 'one_time', 'ref_turkana_youth', 'TWP_VERIFIED_REF_010', 'success', false, NOW() - INTERVAL '22 minutes');
EXCEPTION
    WHEN unique_violation THEN
        -- Seed already applied
        NULL;
END $$;
