-- ==============================================================================
-- PHASE 2: SUPABASE SCHEMA MIGRATION
-- Project: Turkana Wellspring Initiative
-- Additions: Admin RBAC, Audit Logging, CMS Campaign Updates, Donor Magic Links,
-- Rate Limiting, Milestone Deduplication, and Multi-Currency / Channel Support.
-- ==============================================================================

-- 1. ADMINS TABLE (Role-Based Access Control: 'admin' | 'viewer')
CREATE TABLE IF NOT EXISTS public.admins (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'viewer')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;

-- Admins can view their own admin profile
CREATE POLICY "Admins can view their own record"
    ON public.admins
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

-- 2. AUDIT LOG TABLE
CREATE TABLE IF NOT EXISTS public.audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    admin_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    admin_email TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON public.audit_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON public.audit_log(action);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Admins and viewers can read the audit log
CREATE POLICY "Admins and viewers can read audit log"
    ON public.audit_log
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.admins
            WHERE admins.user_id = auth.uid()
        )
    );

-- 3. CMS CAMPAIGN UPDATES / BLOG POSTS TABLE
CREATE TABLE IF NOT EXISTS public.campaign_updates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    author_name TEXT NOT NULL DEFAULT 'WaterHarvest Field Team',
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_updates_published ON public.campaign_updates(published_at DESC);

ALTER TABLE public.campaign_updates ENABLE ROW LEVEL SECURITY;

-- Public can read published posts
CREATE POLICY "Public can view published campaign updates"
    ON public.campaign_updates
    FOR SELECT
    TO anon, authenticated
    USING (published_at IS NOT NULL AND published_at <= NOW());

-- Admins can view all posts (including drafts)
CREATE POLICY "Admins can view all campaign updates"
    ON public.campaign_updates
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.admins
            WHERE admins.user_id = auth.uid()
        )
    );

-- 4. DONATIONS TABLE EXPANSIONS FOR PHASE 2
ALTER TABLE public.donations 
    ADD COLUMN IF NOT EXISTS payment_source TEXT NOT NULL DEFAULT 'paystack' CHECK (payment_source IN ('paystack', 'manual_bank', 'manual_cash')),
    ADD COLUMN IF NOT EXISTS paystack_plan_code TEXT,
    ADD COLUMN IF NOT EXISTS paystack_subscription_code TEXT,
    ADD COLUMN IF NOT EXISTS paystack_customer_code TEXT,
    ADD COLUMN IF NOT EXISTS paystack_channel TEXT,
    ADD COLUMN IF NOT EXISTS notes TEXT,
    ADD COLUMN IF NOT EXISTS opt_in_leaderboard BOOLEAN NOT NULL DEFAULT true;

-- Update currency check on donations to allow USD, NGN, GBP
ALTER TABLE public.donations DROP CONSTRAINT IF EXISTS donations_currency_check;
ALTER TABLE public.donations ADD CONSTRAINT donations_currency_check CHECK (currency IN ('USD', 'NGN', 'GBP', 'KES', 'EUR'));

-- 5. RATE LIMITING TABLE (For Edge Function Abuse Prevention)
CREATE TABLE IF NOT EXISTS public.rate_limits (
    key TEXT PRIMARY KEY,
    request_count INTEGER NOT NULL DEFAULT 1,
    reset_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_reset ON public.rate_limits(reset_at);

-- 6. DONOR MAGIC LINKS (For Secure "My Giving History" Without Account Password)
CREATE TABLE IF NOT EXISTS public.donor_magic_links (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_donor_magic_links_hash ON public.donor_magic_links(token_hash);
CREATE INDEX IF NOT EXISTS idx_donor_magic_links_email ON public.donor_magic_links(email);

ALTER TABLE public.donor_magic_links ENABLE ROW LEVEL SECURITY;
-- No public SELECT or INSERT; managed only by Edge Functions with service_role key

-- 7. MILESTONES SENT LOG (Deduplication for 25%, 50%, 75%, 100% blast emails)
CREATE TABLE IF NOT EXISTS public.milestones_sent (
    milestone_percentage INTEGER PRIMARY KEY CHECK (milestone_percentage IN (25, 50, 75, 100)),
    total_raised_at_time NUMERIC(12, 2) NOT NULL,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. RECREATE & EXPAND PUBLIC VIEWS
-- Drop and replace public_verified_donations with leaderboard opt-in info
DROP VIEW IF EXISTS public.public_verified_donations CASCADE;
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
    d.opt_in_leaderboard,
    d.payment_source,
    d.created_at
FROM public.donations d
WHERE d.status = 'success';

GRANT SELECT ON public.public_verified_donations TO anon, authenticated;

-- Public Wall of Supporters / Leaderboard View
CREATE OR REPLACE VIEW public.public_leaderboard
WITH (security_invoker = false) AS
SELECT
    CASE 
        WHEN is_anonymous = true THEN 'Anonymous Supporter'
        ELSE donor_display_name
    END AS donor_display_name,
    SUM(amount)::NUMERIC(12, 2) AS total_contributed,
    currency,
    COUNT(id)::INTEGER AS donations_count,
    MAX(created_at) AS latest_donation_at
FROM public.public_verified_donations
WHERE opt_in_leaderboard = true
GROUP BY donor_display_name, currency, is_anonymous
ORDER BY total_contributed DESC
LIMIT 50;

GRANT SELECT ON public.public_leaderboard TO anon, authenticated;

-- Public Campaign Summary View (Updated for Multi-Currency & Offline sources)
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

-- Referral code aggregate view for admins
CREATE OR REPLACE VIEW public.referral_stats_summary AS
SELECT 
    COALESCE(NULLIF(TRIM(referred_by), ''), 'Direct / Unreferred') AS referral_code,
    COUNT(id)::INTEGER AS total_donations,
    COUNT(CASE WHEN status = 'success' THEN 1 END)::INTEGER AS successful_donations,
    COALESCE(SUM(CASE WHEN status = 'success' THEN amount ELSE 0 END), 0)::NUMERIC(12, 2) AS total_raised,
    currency
FROM public.donations
GROUP BY referral_code, currency
ORDER BY total_raised DESC;

-- Sample Seed for CMS Campaign Updates
INSERT INTO public.campaign_updates (title, body, author_name, published_at)
VALUES 
    (
        'Hydrological Survey Completed at Lorugum Site #2',
        'Our technical partner and local geophysicists completed deep resistivity profiling across the Upper Turkwel aquifer basin today. Aquifer depths have been confirmed at 178 meters, with expected flow rates exceeding 22,000 liters per hour. Mobilization of rotary drilling rigs will initiate upon crossing the 50% funding threshold.',
        'Eng. Brian Njoroge',
        NOW() - INTERVAL '3 days'
    ),
    (
        'Community Water Committee Elects 50% Female Leadership',
        'In line with our sustainable community stewardship mandate, Lorugum village elders held a general assembly to elect the seven-member Water Governance Committee. Four women have been selected to lead financial auditing and maintenance oversight.',
        'Amina Chebet',
        NOW() - INTERVAL '1 day'
    )
ON CONFLICT DO NOTHING;
