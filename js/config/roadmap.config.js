/**
 * Roadmap configuration — the single source of truth for stage copy, severity,
 * CTAs and ordering. Mirrors ТЗ §53 (SELF pipeline) and §54/§73 (config-driven
 * mapping). Every `id` below corresponds 1:1 to a real amoCRM status in the
 * "Сопровождение self" pipeline (id=9881242) — pulled via listAmoPipelineStatuses()
 * (Setup.gs) on 2026-08-23. Do NOT add a stage here unless a matching amoCRM
 * status actually exists — a stage with no real status can never be reached,
 * because nothing on the backend can ever set current_stage_id to it.
 *
 * Two things intentionally do NOT appear as stages, by design:
 *   - Briefings (Welcome + up to 4 more) run in PARALLEL with these CRM
 *     stages, not as steps in the linear path — see "Мои мероприятия"
 *     (js/screens/events.js) and Events.gs. A briefing CAN still be tied to
 *     one of these stages via Events.roadmap_stage_id for the few that
 *     should visually gate progress; most shouldn't.
 *   - Pre-Departure checklist / Ready-to-fly / USA: amoCRM has no status
 *     after "VISA APPROVE" (the deal is simply won from there), so that
 *     whole tail is folded into VISA_APPROVED's own detail screen instead
 *     of being separate stages nothing could ever move a deal into.
 *
 * severity: 'ok' | 'active' | 'wait' | 'warn' | 'danger'
 *   ok      — completed (🟢)
 *   active  — processing, current, no action needed (🔵)
 *   wait    — upcoming, not started yet (⚪️)
 *   warn    — attention / deadline approaching (🟡)
 *   danger  — action required / problem (🔴)
 */

export const GROUPS = [
  { id: "enrollment", order: 1, title: "Оформление", weight: 5 },
  { id: "ciee", order: 2, title: "CIEE", weight: 20 },
  { id: "job_offer", order: 3, title: "Job Offer", weight: 30 },
  { id: "ds2019", order: 4, title: "DS-2019", weight: 10 },
  { id: "visa", order: 5, title: "Visa", weight: 35 },
];

// `order` is global and strictly increasing — used to derive done/current/upcoming.
export const STAGES = [
  // ---------------------------------------------------------------- ОФОРМЛЕНИЕ
  {
    id: "ENROLLED",
    group: "enrollment",
    order: 1,
    title: "Оформились",
    shortTitle: "Оформление",
    actionRequired: false,
    severity: "ok",
    icon: "📄",
    description: "Договор подписан, стартовые документы и Payment #1 приняты — вы официально в программе SELF.",
    detail: {
      whatsHappening: "Вы официально стали участником программы Work & Travel USA SELF 2027.",
      whatRequired: "Ничего — этот шаг уже пройден.",
      whatsNext: "Регистрация в CIEE — ABC Universe зарегистрирует вас и пришлёт Welcome Email.",
    },
    cta: null,
  },

  // ---------------------------------------------------------------------- CIEE
  {
    id: "CIEE_REGISTRATION",
    group: "ciee",
    order: 2,
    title: "Регистрация CIEE",
    shortTitle: "Регистрация CIEE",
    actionRequired: true,
    severity: "danger",
    icon: "📩",
    description: "Мы зарегистрировали вас в CIEE. Активируйте аккаунт по Welcome Email и заполните анкету — на это 5 дней.",
    detail: {
      whatsHappening: "ABC Universe зарегистрировала вас в системе CIEE. На указанный email отправлено Welcome Email.",
      whatRequired: "Найдите Welcome Email от CIEE, активируйте аккаунт и заполните анкету, следуя инструкции ABC Universe.",
      whatsNext: "ABC Universe проверит вашу анкету.",
    },
    cta: { label: "Открыть инструкцию", action: "openInstruction" },
    secondaryCta: { label: "Не пришло письмо?", action: "writeCoordinator" },
    deadlineDays: 5,
  },
  {
    id: "CIEE_ANKETA_REVIEW",
    group: "ciee",
    order: 3,
    title: "Проверка анкеты CIEE",
    shortTitle: "Проверка анкеты",
    actionRequired: false,
    severity: "active",
    icon: "🔎",
    description: "Мы проверяем вашу анкету CIEE. Сейчас от вас ничего не требуется.",
    detail: {
      whatsHappening: "ABC Universe проверяет данные, которые вы указали при регистрации в CIEE.",
      whatRequired: "Пока ничего.",
      whatsNext: "После проверки личный кабинет CIEE будет полностью готов.",
    },
    cta: null,
  },
  {
    id: "CIEE_FILLED",
    group: "ciee",
    order: 4,
    title: "Личный кабинет CIEE заполнен",
    shortTitle: "CIEE готов",
    actionRequired: false,
    severity: "ok",
    icon: "✅",
    description: "Ваш личный кабинет CIEE заполнен и проверен ABC Universe.",
    detail: {
      whatsHappening: "Личный кабинет CIEE полностью готов.",
      whatRequired: "Ничего — этот шаг пройден. Теперь самостоятельно найдите работодателя и оформите Job Offer.",
      whatsNext: "Когда получите Job Offer, загрузите его — он автоматически уйдёт на проверку.",
    },
    cta: null,
  },

  // ----------------------------------------------------------------- JOB OFFER
  {
    id: "JOB_OFFER_UPLOADED",
    group: "job_offer",
    order: 5,
    title: "Job Offer загружен",
    shortTitle: "Job Offer загружен",
    actionRequired: false,
    severity: "active",
    icon: "📥",
    description: "Мы получили ваш Job Offer. ABC Universe начинает проверку документа.",
    detail: {
      whatsHappening: "Ваш Job Offer поступил в ABC Universe.",
      whatRequired: "Пока ничего.",
      whatsNext: "ABC Universe проверит документ перед передачей CIEE (Sponsor).",
    },
    cta: null,
  },
  {
    id: "JOB_OFFER_CIEE_REVIEW",
    group: "job_offer",
    order: 6,
    title: "Job Offer на проверке CIEE",
    shortTitle: "Проверка CIEE",
    actionRequired: false,
    severity: "active",
    icon: "🔵",
    description: "Ваш Job Offer проверен ABC Universe и передан CIEE. Sponsor проводит проверку.",
    detail: {
      whatsHappening: "CIEE (Sponsor) проверяет Job Offer и соответствие требованиям программы.",
      whatRequired: "Пока ничего.",
      whatsNext: "После успешной проверки — Placed 🎉. Если найдутся замечания, координатор свяжется с вами.",
    },
    cta: null,
  },
  {
    id: "JOB_PROBLEM",
    group: "job_offer",
    order: 6.5,
    branch: true,
    branchOf: "JOB_OFFER_CIEE_REVIEW",
    title: "Требуется ваше внимание",
    shortTitle: "Job Problem",
    actionRequired: true,
    severity: "danger",
    icon: "⚠️",
    description: "По вашему Job Offer появились замечания.",
    detail: {
      whatsHappening: "CIEE или ABC Universe обнаружили проблему в вашем Job Offer.",
      whatRequired: "Свяжитесь с координатором — он передаст, что именно нужно исправить работодателю.",
      whatsNext: "После исправления Job Offer вернётся на проверку CIEE.",
    },
    coordinatorComment: "Работодателю необходимо исправить даты работы.",
    cta: { label: "Написать координатору", action: "writeCoordinator" },
    escalationHours: 48,
  },
  {
    id: "PLACED",
    group: "job_offer",
    order: 7,
    title: "YOU'RE PLACED!",
    shortTitle: "Placed",
    actionRequired: false,
    severity: "ok",
    icon: "🇺🇸",
    celebration: true,
    description: "Ваш Job Offer полностью подтверждён CIEE. Один из главных этапов программы завершён.",
    detail: {
      whatsHappening: "Ваш Job Offer полностью подтверждён CIEE — один из главных этапов программы завершён.",
      whatRequired: "Ничего — можно выдохнуть и отпраздновать 🎉",
      whatsNext: "DS-2019: ABC Universe соберёт и передаст Sponsor необходимые документы.",
    },
    cta: null,
  },

  // -------------------------------------------------------------------- DS2019
  {
    id: "DS2019_ISSUED",
    group: "ds2019",
    order: 8,
    title: "DS-2019 ISSUED",
    shortTitle: "DS-2019 issued",
    actionRequired: false,
    severity: "ok",
    icon: "🇺🇸",
    celebration: true,
    description: "Ваша форма DS-2019 выпущена. Теперь начинается визовый этап.",
    detail: {
      whatsHappening: "Sponsor выпустил вашу форму DS-2019.",
      whatRequired: "Ничего — этот шаг пройден.",
      whatsNext: "Начинается визовый этап — заполнение формы DS-160.",
    },
    cta: null,
  },

  // ---------------------------------------------------------------------- VISA
  {
    id: "DS160_STARTED",
    group: "visa",
    order: 9,
    title: "DS-160",
    shortTitle: "DS-160",
    actionRequired: true,
    severity: "danger",
    icon: "🛂",
    description: "Заполните форму DS-160 согласно инструкции ABC Universe.",
    detail: {
      whatsHappening: "Начался визовый этап программы.",
      whatRequired: "Заполните форму DS-160, следуя инструкции ABC Universe.",
      whatsNext: "После заполнения ABC Universe проверит форму перед подачей.",
    },
    cta: { label: "Открыть инструкцию", action: "openInstruction" },
  },
  {
    id: "DS160_REVIEW",
    group: "visa",
    order: 10,
    title: "DS-160 Review",
    shortTitle: "DS-160 Review",
    actionRequired: false,
    severity: "active",
    icon: "🔵",
    description: "Мы проверяем заполненную форму DS-160 перед подачей.",
    detail: {
      whatsHappening: "ABC Universe проверяет корректность заполнения DS-160.",
      whatRequired: "Пока ничего — если найдём неточности, сообщим, что исправить.",
      whatsNext: "После проверки форма будет отправлена (Submitted).",
    },
    cta: null,
  },
  {
    id: "DS160_SUBMITTED",
    group: "visa",
    order: 11,
    title: "DS-160 Submitted",
    shortTitle: "DS-160 Submitted",
    actionRequired: false,
    severity: "active",
    icon: "🔵",
    description: "Форма DS-160 подана. Теперь можно записываться на собеседование.",
    detail: {
      whatsHappening: "Ваша форма DS-160 успешно подана.",
      whatRequired: "Пока ничего.",
      whatsNext: "Запись на интервью в посольство/консульстве США.",
    },
    cta: null,
  },
  {
    id: "VISA_FINAL_CALL",
    group: "visa",
    order: 12,
    title: "Final Call перед визой",
    shortTitle: "Final Call",
    actionRequired: true,
    severity: "danger",
    icon: "📞",
    description: "Финальная проверка готовности к визовому интервью — сверьте документы и детали записи.",
    detail: {
      whatsHappening: "Вы записаны на визовое интервью.",
      whatRequired: "Проверьте дату и время интервью, соберите документы по чек-листу.",
      whatsNext: "В день интервью — визовое собеседование в посольстве/консульстве США. После — Passport ready и решение по визе.",
    },
    cta: { label: "Чек-лист документов", action: "openInstruction" },
    reminderSchedule: ["за 7 дней", "за 3 дня", "за 1 день", "утром в день интервью"],
  },
  {
    id: "PASSPORT_READY",
    group: "visa",
    order: 13,
    title: "Ожидаем паспорт",
    shortTitle: "Passport",
    actionRequired: false,
    severity: "active",
    icon: "📕",
    description: "Решение по визе принято, паспорт находится в посольстве/консульстве.",
    detail: {
      whatsHappening: "Ваш паспорт с визой находится на обработке в посольстве/консульстве.",
      whatRequired: "Пока ничего — мы сообщим, когда паспорт будет готов к получению.",
      whatsNext: "Получение паспорта с визой — VISA APPROVE.",
    },
    cta: null,
  },
  {
    id: "VISA_APPROVED",
    group: "visa",
    order: 14,
    title: "VISA APPROVE",
    shortTitle: "Visa Approved",
    actionRequired: true,
    severity: "ok",
    icon: "🇺🇸",
    celebration: true,
    description: "Ваша J-1 Visa одобрена! Это последний статус в CRM — дальше пройдите чек-лист подготовки к вылету прямо в приложении.",
    detail: {
      whatsHappening: "Ваша J-1 Visa одобрена — паспорт получен. Это финальный статус сделки в CRM.",
      whatRequired: "Закройте чек-лист подготовки к вылету ниже.",
      whatsNext: "Когда все пункты чек-листа закрыты — вы готовы к вылету ✈️",
    },
    // No amoCRM status exists after VISA APPROVE (the deal is simply won from
    // here), so Pre-Departure / Ready-to-fly, previously separate stages
    // nothing could ever move a deal into, live inside this stage's own
    // detail screen instead (see statusDetail.js) — checklist progress is
    // tracked in the PreDepartureChecklist sheet, not by advancing current_stage_id.
    checklist: [
      "Visa",
      "DS-2019",
      "Passport",
      "Flight",
      "Insurance / необходимые документы",
      "Необходимые деньги",
      "Документы распечатаны",
      "Pre-Departure Briefing",
    ],
    cta: { label: "Открыть чек-лист", action: "openChecklist" },
  },
];

const STAGE_BY_ID = new Map(STAGES.map((s) => [s.id, s]));
const GROUP_BY_ID = new Map(GROUPS.map((g) => [g.id, g]));

// Linear order excludes branch stages (e.g. JOB_PROBLEM) — used for done/current/upcoming.
const MAIN_LINE = STAGES.filter((s) => !s.branch).sort((a, b) => a.order - b.order);

export function getStage(id) {
  return STAGE_BY_ID.get(id) || null;
}

export function getGroup(id) {
  return GROUP_BY_ID.get(id) || null;
}

export function getStagesByGroup(groupId) {
  return STAGES.filter((s) => s.group === groupId && !s.branch).sort((a, b) => a.order - b.order);
}

/**
 * Status of `stageId` relative to `currentStageId`: 'done' | 'current' | 'upcoming'.
 * Branch stages (JOB_PROBLEM) are only ever 'current' when actively selected.
 */
export function stageStatus(stageId, currentStageId) {
  if (stageId === currentStageId) return "current";
  const stage = getStage(stageId);
  const current = getStage(currentStageId);
  if (!stage || !current) return "upcoming";
  if (stage.branch) return "upcoming";
  const effectiveCurrentOrder = current.branch ? findParentOrder(current) : current.order;
  return stage.order < effectiveCurrentOrder ? "done" : "upcoming";
}

function findParentOrder(branchStage) {
  // Every branch stage (currently just JOB_PROBLEM) declares branchOf
  // explicitly — e.g. branchOf: "JOB_OFFER_CIEE_REVIEW" anchors it there for
  // done/current/upcoming comparisons, instead of inferring the nearest
  // lower-order stage (which broke the moment a branch's real parent lived
  // in a different group than the branch stage itself).
  const parent = getStage(branchStage.branchOf);
  return parent ? parent.order : 0;
}

/**
 * Weighted-milestone progress (ТЗ §36, option 1): each group has a fixed weight;
 * within the current group, progress is the fraction of that group's stages
 * already reached.
 */
export function computeProgress(currentStageId) {
  const current = getStage(currentStageId);
  if (!current) return 0;
  const currentGroupOrder = getGroup(current.group).order;
  let pct = 0;
  for (const g of GROUPS) {
    if (g.order < currentGroupOrder) {
      pct += g.weight;
    } else if (g.order === currentGroupOrder) {
      const stagesInGroup = getStagesByGroup(g.id);
      const idx = stagesInGroup.findIndex((s) => s.id === (current.branch ? findParentStageId(current) : current.id));
      const fraction = stagesInGroup.length ? Math.max(idx, 0) / stagesInGroup.length : 0;
      pct += g.weight * fraction;
    }
  }
  return Math.round(Math.min(pct, 100));
}

function findParentStageId(branchStage) {
  return branchStage.branchOf || null;
}

export function nextStage(stageId) {
  const stage = getStage(stageId);
  if (!stage) return null;
  const idx = MAIN_LINE.findIndex((s) => s.id === stageId);
  if (idx === -1 || idx === MAIN_LINE.length - 1) return null;
  return MAIN_LINE[idx + 1];
}

export const CELEBRATION_STAGE_IDS = STAGES.filter((s) => s.celebration).map((s) => s.id);
export const SELECTABLE_STAGE_IDS = MAIN_LINE.map((s) => s.id);
