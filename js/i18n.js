/**
 * ==============================================================================
 * TURKANA WELLSPRING INITIATIVE — LIGHTWEIGHT i18n ENGINE (js/i18n.js)
 * Languages Supported: English (en), French (fr), Dutch (nl)
 * Zero external dependencies; persisted via localStorage & data-i18n attributes.
 * ==============================================================================
 */

(function (window) {
  'use strict';

  const DICTIONARY = {
    en: {
      // Header & Navigation
      "brand_wordmark": "Turkana <span>Wellspring</span>",
      "nav_story": "Story",
      "nav_transparency": "Transparency",
      "nav_impact": "Fund Allocation",
      "nav_dispatches": "Field Dispatches",
      "nav_wall": "Supporter Wall",
      "nav_history": "My Giving History",
      "nav_staff": "Staff Portal",
      "nav_faq": "FAQ",
      "nav_volunteer": "Volunteer",
      "cta_donate": "Donate Now",
      
      // Ribbon
      "ribbon_certified": "✓ Official NGO Initiative",
      "ribbon_target": "Target: $75,000 USD · 4 Solar Aquifer Boreholes",

      // Hero
      "hero_kicker": "Emergency Clean Water Mission · Turkana County",
      "hero_title": "Solar-Powered Clean Water for 14,000 Lives in Turkana",
      "hero_deck": "Severe cyclical drought across northern Kenya forces women and school children to walk up to 18 kilometers daily in search of contaminated riverbed water. We are constructing four deep solar-powered aquifer boreholes and community water kiosks to secure permanent, safe water.",
      "hero_metric_raised": "Total Verified Raised",
      "hero_metric_supporters": "Verified Supporters",
      "hero_metric_stations": "Target Infrastructure",

      // Donation Card
      "card_title": "Join the Mission",
      "card_subtitle": "Every dollar directly funds deep drilling and solar hardware.",
      "tab_onetime": "One-Time Contribution",
      "tab_monthly": "Monthly Sustainer",
      "monthly_notice": "Recurring Monthly Support: Automated via Paystack Subscription. Cancel anytime from your Giving History portal.",
      "currency_label": "Select Currency",
      "presets_label": "Select Amount",
      "tax_deductible": "Tax-Deductible",
      "custom_amount_placeholder": "Or enter custom amount",
      "name_label": "Donor Name (Optional)",
      "email_label": "Email Address *",
      "anonymous_label": "Keep my name anonymous (hidden on public ledger)",
      "leaderboard_optin": "Feature on public Supporter Wall & Community Roll",
      "referral_label": "Referral Code / Partner Tag (Optional)",
      "submit_btn": "Donate with Paystack",
      "security_note": "256-Bit SSL Encrypted · Direct NGO Disbursement via Paystack",
      
      // Matching Gift
      "matching_badge": "1:1 Matching Gift Active: Every dollar doubled up to $25,000 by The Kestrel Global Water Fund!",

      // FAQ
      "faq_title": "Frequently Asked Questions",
      "faq_deck": "Everything you need to know about our field operations, governance, and financial stewardship.",
      
      // Newsletter
      "newsletter_title": "Stay Connected to Field Progress",
      "newsletter_deck": "Subscribe to our monthly hydrogeological progress dispatch. Strictly no spam.",
      "newsletter_btn": "Subscribe to Field Dispatches",
      "newsletter_success": "Thank you for subscribing! You will receive our next quarterly dispatch."
    },

    fr: {
      // Header & Navigation
      "brand_wordmark": "Turkana <span>Source de Vie</span>",
      "nav_story": "Notre Histoire",
      "nav_transparency": "Transparence",
      "nav_impact": "Allocation des Fonds",
      "nav_dispatches": "Rapports de Terrain",
      "nav_wall": "Mur des Donateurs",
      "nav_history": "Historique des Dons",
      "nav_staff": "Portail Équipe",
      "nav_faq": "FAQ",
      "nav_volunteer": "Bénévolat",
      "cta_donate": "Faire un Don",

      // Ribbon
      "ribbon_certified": "✓ Initiative ONG Officielle",
      "ribbon_target": "Objectif : 75 000 $ USD · 4 Forages Solaires",

      // Hero
      "hero_kicker": "Mission Eau Potable d'Urgence · Comté de Turkana",
      "hero_title": "De l'Eau Potable Solaire pour 14 000 Vies à Turkana",
      "hero_deck": "Les sécheresses cycliques forcent femmes et enfants à parcourir jusqu'à 18 kilomètres par jour. Nous construisons quatre forages solaires profonds et des kiosques communautaires pour garantir une eau pure permanente.",
      "hero_metric_raised": "Total Vérifié Collecté",
      "hero_metric_supporters": "Donateurs Vérifiés",
      "hero_metric_stations": "Infrastructures Ciblées",

      // Donation Card
      "card_title": "Rejoignez la Mission",
      "card_subtitle": "Chaque don finance directement le forage profond et l'énergie solaire.",
      "tab_onetime": "Don Ponctuel",
      "tab_monthly": "Don Mensuel",
      "monthly_notice": "Soutien mensuel récurrent : géré en toute sécurité par Paystack. Annulable à tout moment.",
      "currency_label": "Devise du Don",
      "presets_label": "Choisir le Montant",
      "tax_deductible": "Déductible d'impôt",
      "custom_amount_placeholder": "Ou entrez un montant libre",
      "name_label": "Nom du Donateur (Optionnel)",
      "email_label": "Adresse Email *",
      "anonymous_label": "Garder mon don anonyme sur le grand livre public",
      "leaderboard_optin": "Figurer sur le Mur d'Honneur public des donateurs",
      "referral_label": "Code de Parrainage (Optionnel)",
      "submit_btn": "Donner avec Paystack",
      "security_note": "Chiffrement SSL 256 bits · Versement direct ONG via Paystack",

      // Matching Gift
      "matching_badge": "Don Jumelé 1:1 Actif : Chaque don est doublé jusqu'à 25 000 $ par Kestrel Global Water Fund !",

      // FAQ
      "faq_title": "Questions Fréquentes",
      "faq_deck": "Tout ce que vous devez savoir sur nos forages, notre gouvernance et l'utilisation des fonds.",

      // Newsletter
      "newsletter_title": "Suivez les Avancées du Terrain",
      "newsletter_deck": "Recevez nos rapports hydrologiques mensuels. Aucun pourriel, promis.",
      "newsletter_btn": "S'abonner aux Rapports",
      "newsletter_success": "Merci pour votre inscription ! Vous recevrez notre prochain rapport."
    },

    nl: {
      // Header & Navigation
      "brand_wordmark": "Turkana <span>Waterbron</span>",
      "nav_story": "Ons Verhaal",
      "nav_transparency": "Transparantie",
      "nav_impact": "Toewijzing Fondsen",
      "nav_dispatches": "Veldberichten",
      "nav_wall": "Donateursmuur",
      "nav_history": "Mijn Giften",
      "nav_staff": "Medewerkersportaal",
      "nav_faq": "Veelgestelde Vragen",
      "nav_volunteer": "Vrijwilligers",
      "cta_donate": "Doneer Nu",

      // Ribbon
      "ribbon_certified": "✓ Officieel NGO-Initiatief",
      "ribbon_target": "Doel: $75.000 USD · 4 Zonneboorgaten",

      // Hero
      "hero_kicker": "Noodmissie Schoon Water · Turkana County",
      "hero_title": "Schoon Drinkwater op Zonne-energie voor 14.000 Mensen",
      "hero_deck": "Aanhoudende droogte dwingt vrouwen en kinderen dagelijks tot 18 kilometer te lopen. Wij realiseren 4 diepe zonneboorgaten en waterkiosken voor blijvende watervoorziening.",
      "hero_metric_raised": "Totaal Geverifieerd Opgehaald",
      "hero_metric_supporters": "Geverifieerde Donateurs",
      "hero_metric_stations": "Doelinfrastructuur",

      // Donation Card
      "card_title": "Steun de Missie",
      "card_subtitle": "Elke bijdrage financiert direct diepboringen en zonnepanelen.",
      "tab_onetime": "Eenmalige Gift",
      "tab_monthly": "Maandelijkse Steun",
      "monthly_notice": "Maandelijkse automatische steun via Paystack. Op elk moment opzegbaar via uw giftenoverzicht.",
      "currency_label": "Selecteer Valuta",
      "presets_label": "Kies Bedrag",
      "tax_deductible": "Fiscaal Aftrekbaar",
      "custom_amount_placeholder": "Of voer een ander bedrag in",
      "name_label": "Naam Donateur (Optioneel)",
      "email_label": "E-mailadres *",
      "anonymous_label": "Maak mijn donatie anoniem op de openbare pagina",
      "leaderboard_optin": "Vermeld mij op de openbare Donateursmuur",
      "referral_label": "Referentiecode (Optioneel)",
      "submit_btn": "Doneer via Paystack",
      "security_note": "256-bit SSL-versleuteling · Directe overboeking naar NGO via Paystack",

      // Matching Gift
      "matching_badge": "1:1 Verdubbeling Actief: Elke dollar wordt verdubbeld tot $25.000 door Kestrel Global Water Fund!",

      // FAQ
      "faq_title": "Veelgestelde Vragen",
      "faq_deck": "Alles over onze veldoperaties, toezicht en transparante besteding van middelen.",

      // Newsletter
      "newsletter_title": "Blijf op de Hoogte van het Veldwerk",
      "newsletter_deck": "Ontvang onze maandelijkse voortgangsberichten over de boringen. Geen spam.",
      "newsletter_btn": "Aanmelden voor Updates",
      "newsletter_success": "Bedankt voor uw aanmelding! U ontvangt ons volgende veldbericht."
    }
  };

  class I18nEngine {
    constructor() {
      this.currentLang = localStorage.getItem('twp_lang') || 'en';
      if (!DICTIONARY[this.currentLang]) this.currentLang = 'en';
    }

    init() {
      this.bindSwitcher();
      this.applyTranslations(this.currentLang);
    }

    bindSwitcher() {
      const switcher = document.getElementById('languageSwitcher');
      if (!switcher) return;

      switcher.value = this.currentLang;
      switcher.addEventListener('change', (e) => {
        this.setLanguage(e.target.value);
      });
    }

    setLanguage(lang) {
      if (!DICTIONARY[lang]) return;
      this.currentLang = lang;
      localStorage.setItem('twp_lang', lang);
      document.documentElement.lang = lang;
      this.applyTranslations(lang);
      window.dispatchEvent(new CustomEvent('languageChanged', { detail: { lang } }));
    }

    applyTranslations(lang) {
      const strings = DICTIONARY[lang];
      if (!strings) return;

      // Translate text content
      document.querySelectorAll('[data-i18n]').forEach((el) => {
        const key = el.getAttribute('data-i18n');
        if (strings[key]) {
          if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
            el.value = strings[key];
          } else {
            el.innerHTML = strings[key];
          }
        }
      });

      // Translate placeholders
      document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (strings[key]) {
          el.setAttribute('placeholder', strings[key]);
        }
      });
    }

    t(key) {
      return DICTIONARY[this.currentLang]?.[key] || DICTIONARY.en[key] || key;
    }
  }

  window.I18nEngine = I18nEngine;
  window.i18n = new I18nEngine();

})(window);
