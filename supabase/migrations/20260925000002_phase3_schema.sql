-- ==============================================================================
-- PHASE 3: SUPABASE SCHEMA MIGRATION
-- Project: Turkana Wellspring Initiative
-- Additions: Newsletter Subscribers, Volunteer Leads, Matching Gift Sponsors,
-- UTM Campaign Attribution, and Progress View Matching Calculation.
-- ==============================================================================

-- 1. NEWSLETTER SUBSCRIBERS TABLE
-- Kept strictly separate from donors table to respect explicit marketing consent
CREATE TABLE IF NOT EXISTS public.newsletter_subscribers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT NOT NULL UNIQUE CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
    source TEXT NOT NULL DEFAULT 'landing_footer',
    is_confirmed BOOLEAN NOT NULL DEFAULT true,
    subscribed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_newsletter_email ON public.newsletter_subscribers(email);

ALTER TABLE public.newsletter_subscribers ENABLE ROW LEVEL SECURITY;

-- Public can subscribe
DROP POLICY IF EXISTS "Public can subscribe to newsletter" ON public.newsletter_subscribers;
CREATE POLICY "Public can subscribe to newsletter"
    ON public.newsletter_subscribers
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (email IS NOT NULL);

-- Only admins can read subscriber lists
DROP POLICY IF EXISTS "Admins can view newsletter subscribers" ON public.newsletter_subscribers;
CREATE POLICY "Admins can view newsletter subscribers"
    ON public.newsletter_subscribers
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.admins
            WHERE admins.user_id = auth.uid()
        )
    );

-- 2. VOLUNTEER REGISTRATION TABLE
CREATE TABLE IF NOT EXISTS public.volunteers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    full_name TEXT NOT NULL,
    email TEXT NOT NULL CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
    phone TEXT,
    availability TEXT NOT NULL CHECK (availability IN ('weekends', 'full_time', 'flexible', 'remote_only')),
    skills TEXT[] DEFAULT '{}'::text[],
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'interviewed', 'accepted', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_volunteers_created ON public.volunteers(created_at DESC);

ALTER TABLE public.volunteers ENABLE ROW LEVEL SECURITY;

-- Public can submit volunteer applications
DROP POLICY IF EXISTS "Public can submit volunteer application" ON public.volunteers;
CREATE POLICY "Public can submit volunteer application"
    ON public.volunteers
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (full_name IS NOT NULL AND email IS NOT NULL);

-- Admins can view and update volunteer leads
DROP POLICY IF EXISTS "Admins can view volunteers" ON public.volunteers;
CREATE POLICY "Admins can view volunteers"
    ON public.volunteers
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.admins
            WHERE admins.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Admins can update volunteers" ON public.volunteers;
CREATE POLICY "Admins can update volunteers"
    ON public.volunteers
    FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.admins
            WHERE admins.user_id = auth.uid()
        )
    );

-- 3. MATCHING GIFT SPONSORS TABLE
CREATE TABLE IF NOT EXISTS public.matching_sponsors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sponsor_name TEXT NOT NULL,
    match_ratio NUMERIC(3, 2) NOT NULL DEFAULT 1.00, -- 1:1 matching
    max_cap NUMERIC(12, 2) NOT NULL DEFAULT 25000.00,
    current_matched NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    is_active BOOLEAN NOT NULL DEFAULT true,
    badge_text TEXT NOT NULL DEFAULT 'Double Your Impact: 1:1 Match Active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.matching_sponsors ENABLE ROW LEVEL SECURITY;

-- Public can view active matching sponsor info
DROP POLICY IF EXISTS "Public can view matching sponsors" ON public.matching_sponsors;
CREATE POLICY "Public can view matching sponsors"
    ON public.matching_sponsors
    FOR SELECT
    TO anon, authenticated
    USING (true);

-- 4. DONATIONS TABLE EXPANSIONS FOR PHASE 3 (UTM Tracking & Matching)
ALTER TABLE public.donations
    ADD COLUMN IF NOT EXISTS utm_source TEXT,
    ADD COLUMN IF NOT EXISTS utm_medium TEXT,
    ADD COLUMN IF NOT EXISTS utm_campaign TEXT,
    ADD COLUMN IF NOT EXISTS utm_content TEXT,
    ADD COLUMN IF NOT EXISTS matched_by_sponsor_id UUID REFERENCES public.matching_sponsors(id),
    ADD COLUMN IF NOT EXISTS matched_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00;

-- 5. SEED INITIAL MATCHING SPONSOR
INSERT INTO public.matching_sponsors (
    sponsor_name,
    match_ratio,
    max_cap,
    current_matched,
    currency,
    is_active,
    badge_text
)
VALUES (
    'The Kestrel Global Water Fund',
    1.00,
    25000.00,
    14800.00,
    'USD',
    true,
    'Double Your Impact: Every dollar is matched 1:1 up to $25,000 by The Kestrel Global Water Fund'
)
ON CONFLICT DO NOTHING;

-- 6. UPDATE CAMPAIGN PROGRESS SUMMARY VIEW WITH MATCHING SUPPORT
DROP VIEW IF EXISTS public.campaign_progress_summary CASCADE;
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
    COALESCE(SUM(d.matched_amount), 0)::NUMERIC(12, 2) AS total_matched,
    (COALESCE(SUM(d.amount), 0) + COALESCE(SUM(d.matched_amount), 0))::NUMERIC(12, 2) AS effective_total_raised,
    COUNT(d.id)::INTEGER AS verified_donors_count,
    ROUND(
        LEAST(100.0, (
            (COALESCE(SUM(d.amount), 0) + COALESCE(SUM(d.matched_amount), 0)) 
            / NULLIF(s.goal_amount, 0)
        ) * 100),
        1
    )::NUMERIC(5, 1) AS percentage_funded
FROM public.campaign_settings s
LEFT JOIN public.donations d 
    ON d.status = 'success' AND d.currency = s.currency
GROUP BY s.id, s.cause_title, s.cause_description, s.goal_amount, s.currency, s.org_reg_number;

GRANT SELECT ON public.campaign_progress_summary TO anon, authenticated;
