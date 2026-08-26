/**
 * Fixed roster of mandatory briefings shown on the "Мои мероприятия" (Events)
 * screen — every entry here always renders a card, even before a coordinator
 * has actually created/sent the invitation (see events.js: unmatched roster
 * items render as a dimmed "Ожидается" placeholder). Matching to a real
 * invitation is by `key`, NOT by title text — admin-events.html writes this
 * same key into Events.briefing_key when a coordinator picks it from the
 * "Тип брифинга" dropdown, so a typo in the free-text title never breaks the
 * roster (see Events.gs). Any invitation with no matching key (or none at
 * all) is an ad-hoc briefing and renders below the roster instead.
 *
 * Order here is display order on the Events screen — NOT tied to roadmap
 * order or to when a coordinator actually sends each one (see the
 * CIEE-registration-vs-briefing season discussion: amoCRM stage progress and
 * Events invitations are intentionally independent of each other).
 */
export const BRIEFING_ROSTER = [
  { key: "brief_1_intro", title: "Брифинг 1 — What is Work & Travel USA" },
  { key: "brief_2_sponsor", title: "Брифинг 2 — Sponsor CIEE, Jobs, States & Housing" },
  { key: "brief_3_resume", title: "Брифинг 3 — Resume & Job Search" },
  { key: "brief_4_joboffer", title: "Брифинг 4 — Job Offer & Documents" },
  { key: "visa_briefing_1", title: "Visa Briefing 1" },
  { key: "visa_briefing_2", title: "Visa Briefing 2" },
  { key: "visa_individual", title: "Visa Individual" },
  { key: "visa_last_call", title: "Visa Last Call" },
  { key: "pre_departure", title: "Pre-Departure" },
];
