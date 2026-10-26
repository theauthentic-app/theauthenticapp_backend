export const TERMS_VERSION = '2026-09-10';

export type PlanCode = 'STARTER' | 'GROWTH' | 'ENTERPRISE';

export type PlanDefinition = {
  code: PlanCode;
  name: string;
  audience: string;
  monthlyNgn: number | null;
  identityQuota: number | null;
  verificationQuota: number | null;
  brandQuota: number | null;
  apiKeys: boolean;
  webhooks: boolean;
  sla: boolean;
  highlights: string[];
};

export const PLANS: Record<PlanCode, PlanDefinition> = {
  STARTER: {
    code: 'STARTER',
    name: 'Starter',
    audience: 'Early manufacturers serializing a first catalog',
    monthlyNgn: 75_000,
    identityQuota: 10_000,
    verificationQuota: 50_000,
    brandQuota: 1,
    apiKeys: false,
    webhooks: false,
    sla: false,
    highlights: [
      '10,000 product identities / month',
      '50,000 consumer verifications / month',
      'Recalls, reports, and product passports',
      'Email support',
    ],
  },
  GROWTH: {
    code: 'GROWTH',
    name: 'Growth',
    audience: 'Brands with active distribution and partner APIs',
    monthlyNgn: 250_000,
    identityQuota: 100_000,
    verificationQuota: 500_000,
    brandQuota: 10,
    apiKeys: true,
    webhooks: true,
    sla: false,
    highlights: [
      '100,000 product identities / month',
      '500,000 verifications / month',
      'API keys and signed webhooks',
      'Supply-chain events and warranty register',
    ],
  },
  ENTERPRISE: {
    code: 'ENTERPRISE',
    name: 'Enterprise',
    audience: 'Regulated, multi-country, or high-volume programs',
    monthlyNgn: null,
    identityQuota: null,
    verificationQuota: null,
    brandQuota: null,
    apiKeys: true,
    webhooks: true,
    sla: true,
    highlights: [
      'Negotiated identity and scan volume',
      'Uptime SLA and named support',
      'Custom retention and data residency options',
      'SSO and procurement paperwork',
    ],
  },
};

export const CONSUMER_TERMS = {
  priceNgn: 0,
  name: 'Consumer Verify',
  summary:
    'Anyone can scan a product at no cost. AUTHENTIC never charges consumers to check an identity.',
};

export const OVERAGE = {
  identityNgn: 12,
  apiVerificationNgn: 1,
};

export function trialCreateInput() {
  const start = new Date();
  const end = new Date(start.getTime() + 14 * 86_400_000);
  return {
    planCode: 'STARTER' as PlanCode,
    status: 'TRIALING',
    trialEndsAt: end,
    currentPeriodStart: start,
    currentPeriodEnd: end,
  };
}

export const LEGAL_TERMS = {
  version: TERMS_VERSION,
  effectiveDate: TERMS_VERSION,
  jurisdiction: 'Federal Republic of Nigeria',
  currency: 'NGN',
  sections: [
    {
      title: 'What AUTHENTIC is',
      body: 'AUTHENTIC is a product-identity and evidence platform. A verification result describes the digital identity and related signals available at the time of the scan. It is not a declaration that a physical item is original or fake, and it is not insurance, a laboratory assay, or a government certificate.',
    },
    {
      title: 'Consumer verification',
      body: 'Public scanning is free. Consumers do not need an account to verify a code. Location is used only to evaluate travel and frequency risk. AUTHENTIC does not sell consumer scan identities to advertisers.',
    },
    {
      title: 'Manufacturer accounts',
      body: 'Paid plans cover digital identity issuance, verification processing, and brand-protection tools. A 14-day Starter trial begins when a manufacturer organization is created. Continuing after the trial requires accepting these terms and selecting a plan. When PAYSTACK_SECRET_KEY is configured, checkout is charged in NGN. Otherwise AUTHENTIC records an invoice and a platform admin activates the plan.',
    },
    {
      title: 'Quotas and overage',
      body: 'Identity generation and billed API verification volume are metered per billing period. Starter and Growth quotas are listed on the pricing page. Excess identities are billed at ₦12 each unless an Enterprise schedule says otherwise. Safety actions such as recalls are never gated by unpaid invoices.',
    },
    {
      title: 'Data and NDPA',
      body: 'Organization catalog data remains the organization’s. AUTHENTIC processes verification events to operate the service and detect abuse. Personal data is handled in line with the Nigeria Data Protection Act. Platform operators may review reports of counterfeiting or harm.',
    },
    {
      title: 'Acceptable use',
      body: 'You may not issue identities for goods you do not control, scrape verification endpoints, or present AUTHENTIC results as a counterfeit verdict. We may suspend credentials that are cloned, recalled, or used to deceive the public.',
    },
    {
      title: 'Limitation of liability',
      body: 'To the extent permitted by Nigerian law, AUTHENTIC is not liable for indirect loss, lost profits, or damages arising from counterfeit goods in the market. Our liability for a paid subscription period is capped at fees paid for that period.',
    },
  ],
};

export const PRIVACY_NOTICE = {
  version: TERMS_VERSION,
  summary:
    'We store hashed credentials, verification metadata (time, coarse location, device hash), and account data needed to run AUTHENTIC. We do not sell consumer profiles. Manufacturers see aggregate and event-level activity for products they issued.',
  retention:
    'Verification events are retained for 24 months by default, longer where a recall or legal hold applies. You may request account deletion; issued public identities remain so already-sold goods can still be checked.',
};

export function publicPricingCatalog() {
  return {
    currency: 'NGN',
    country: 'NG',
    consumer: CONSUMER_TERMS,
    overage: OVERAGE,
    trialDays: 14,
    termsVersion: TERMS_VERSION,
    plans: Object.values(PLANS),
    notes: [
      'Prices exclude VAT where applicable.',
      'Enterprise pricing is quoted in NGN or USD.',
      'Consumer Verify remains free regardless of manufacturer plan.',
    ],
  };
}
