/**
 * Roadmap configuration — the single source of truth for stage copy, severity,
 * CTAs and ordering. Mirrors ТЗ §53 (SELF pipeline) and §54/§73 (config-driven
 * mapping). When the real backend exists, amoCRM stage IDs map 1:1 to the
 * `id` values here; the Backend "mapping" layer described in §54 becomes this
 * file (or its server-side twin) — screens never hardcode stage copy.
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
  { id: "preparation", order: 2, title: "Подготовка", weight: 5 },
  { id: "ciee", order: 3, title: "CIEE", weight: 15 },
  { id: "job_offer", order: 4, title: "Job Offer", weight: 25 },
  { id: "ds2019", order: 5, title: "DS-2019", weight: 10 },
  { id: "visa", order: 6, title: "Visa", weight: 30 },
  { id: "pre_departure", order: 7, title: "Перед вылетом", weight: 8 },
  { id: "usa", order: 8, title: "USA", weight: 2 },
];

// `order` is global and strictly increasing — used to derive done/current/upcoming.
export const STAGES = [
  // ---------------------------------------------------------------- ОФОРМЛЕНИЕ
  {
    id: "CONTRACT_SIGNED",
    group: "enrollment",
    order: 1,
    title: "Договор подписан",
    shortTitle: "Договор",
    actionRequired: false,
    severity: "ok",
    icon: "📄",
    description: "Договор на участие в программе SELF подписан.",
    detail: {
      whatsHappening: "Вы официально стали участником программы Work & Travel USA SELF 2027.",
      whatRequired: "Ничего — этот шаг уже пройден.",
      whatsNext: "Предоставить первоначальный комплект документов и внести Payment #1.",
    },
    cta: null,
  },
  {
    id: "INITIAL_SETUP",
    group: "enrollment",
    order: 2,
    title: "Стартовые документы и Payment #1",
    shortTitle: "Старт. документы",
    actionRequired: false,
    severity: "ok",
    icon: "🧾",
    description: "Первоначальные документы приняты, Payment #1 оплачен.",
    detail: {
      whatsHappening: "ABC Universe получила ваши стартовые документы и первую оплату.",
      whatRequired: "Ничего — этот шаг уже пройден.",
      whatsNext: "Регистрация в CIEE и запись на первый брифинг — эти процессы идут параллельно.",
    },
    cta: null,
  },

  // ---------------------------------------------------------------- ПОДГОТОВКА
  {
    id: "BRIEFING_WELCOME",
    group: "preparation",
    order: 3,
    title: "Welcome Briefing",
    shortTitle: "Welcome Briefing",
    actionRequired: false,
    severity: "ok",
    icon: "🎤",
    description: "Вводный брифинг о программе пройден.",
    detail: {
      whatsHappening: "Вы прошли вводный брифинг с общей информацией о программе SELF.",
      whatRequired: "Ничего — этот шаг уже пройден.",
      whatsNext: "Продолжайте заполнение CIEE и следите за расписанием следующих брифингов.",
    },
    cta: null,
  },
  {
    id: "PROGRAM_BASICS",
    group: "preparation",
    order: 4,
    title: "Базовые инструкции программы",
    shortTitle: "Базовые инструкции",
    actionRequired: false,
    severity: "ok",
    icon: "📘",
    description: "Базовые материалы и инструкции программы изучены.",
    detail: {
      whatsHappening: "Вы получили базовые инструкции: что такое CIEE, как искать работодателя, как устроен Roadmap.",
      whatRequired: "Ничего — этот шаг уже пройден.",
      whatsNext: "Активировать аккаунт CIEE после получения Welcome Email.",
    },
    cta: null,
  },

  // ---------------------------------------------------------------------- CIEE
  {
    id: "CIEE_REGISTRATION",
    group: "ciee",
    order: 5,
    title: "Регистрация CIEE",
    shortTitle: "Регистрация CIEE",
    actionRequired: true,
    severity: "danger",
    icon: "📩",
    description: "Мы зарегистрировали вас в CIEE. Активируйте аккаунт по Welcome Email — на это 5 дней.",
    detail: {
      whatsHappening: "ABC Universe зарегистрировала вас в системе CIEE. На указанный email отправлено Welcome Email.",
      whatRequired: "Найдите Welcome Email от CIEE, перейдите по ссылке, используйте данные, указанные ABC Universe, и активируйте аккаунт.",
      whatsNext: "После активации нужно будет заполнить личный кабинет CIEE согласно инструкции.",
    },
    cta: { label: "Открыть инструкцию", action: "openInstruction" },
    secondaryCta: { label: "Не пришло письмо?", action: "writeCoordinator" },
    deadlineDays: 5,
  },
  {
    id: "CIEE_FILLING",
    group: "ciee",
    order: 6,
    title: "Заполнение CIEE",
    shortTitle: "Заполнение CIEE",
    actionRequired: true,
    severity: "danger",
    icon: "📝",
    description: "Заполните обязательные разделы вашего профиля CIEE согласно инструкции ABC Universe.",
    detail: {
      whatsHappening: "Аккаунт CIEE активирован. Теперь нужно заполнить обязательные разделы профиля.",
      whatRequired: "Следуйте инструкции ABC Universe и заполните все обязательные разделы CIEE Account.",
      whatsNext: "После заполнения профиль автоматически передаётся ABC Universe на проверку.",
    },
    cta: { label: "Открыть инструкцию", action: "openInstruction" },
  },
  {
    id: "CIEE_REVIEW",
    group: "ciee",
    order: 7,
    title: "Проверка CIEE",
    shortTitle: "Проверка CIEE",
    actionRequired: false,
    severity: "active",
    icon: "🔎",
    description: "Мы проверяем корректность заполнения вашего CIEE Account. Сейчас от вас ничего не требуется.",
    detail: {
      whatsHappening: "ABC Universe проверяет корректность заполнения вашего личного кабинета CIEE.",
      whatRequired: "Пока ничего.",
      whatsNext: "Если найдём неточности — попросим их исправить. Если всё в порядке — CIEE Account будет готов.",
    },
    cta: null,
    changesRequiredVariant: {
      severity: "warn",
      title: "Требуются исправления",
      description: "В вашем CIEE Account необходимо исправить несколько пунктов.",
      coordinatorComment: "Проверьте раздел Emergency Contact — не указан второй номер телефона.",
    },
  },
  {
    id: "CIEE_READY",
    group: "ciee",
    order: 8,
    title: "CIEE Account готов",
    shortTitle: "CIEE готов",
    actionRequired: false,
    severity: "ok",
    icon: "✅",
    description: "Ваш личный кабинет CIEE проверен ABC Universe.",
    detail: {
      whatsHappening: "Ваш CIEE Account полностью готов и проверен ABC Universe.",
      whatRequired: "Ничего — этот шаг пройден. Теперь самостоятельно найдите работодателя и оформите Job Offer.",
      whatsNext: "Когда вы получите и оформите Job Offer, загрузите его в CIEE — ABC Universe подключится к процессу с момента его поступления на проверку.",
    },
    cta: null,
  },

  // ----------------------------------------------------------------- JOB OFFER
  {
    id: "JOB_OFFER_SUBMITTED",
    group: "job_offer",
    order: 9,
    title: "Job Offer получен",
    shortTitle: "Job Offer получен",
    actionRequired: false,
    severity: "active",
    icon: "📥",
    description: "Мы получили ваш Job Offer. ABC Universe начинает проверку документа.",
    detail: {
      whatsHappening: "Ваш Job Offer поступил в ABC Universe.",
      whatRequired: "Пока ничего.",
      whatsNext: "ABC Universe проверит документ перед передачей Sponsor (CIEE).",
    },
    cta: null,
  },
  {
    id: "ABC_REVIEW",
    group: "job_offer",
    order: 10,
    title: "ABC Review",
    shortTitle: "ABC Review",
    actionRequired: false,
    severity: "active",
    icon: "🔵",
    description: "Мы проверяем ваш Job Offer перед передачей Sponsor. Сейчас от вас ничего не требуется.",
    detail: {
      whatsHappening: "ABC Universe проверяет ваш Job Offer перед передачей Sponsor.",
      whatRequired: "Пока ничего.",
      whatsNext: "После проверки документ будет передан CIEE (Sponsor Review).",
    },
    cta: null,
  },
  {
    id: "SPONSOR_REVIEW",
    group: "job_offer",
    order: 11,
    title: "Sponsor Review",
    shortTitle: "Sponsor Review",
    actionRequired: false,
    severity: "active",
    icon: "🔵",
    description: "Ваш Job Offer проверен ABC Universe и передан CIEE. Sponsor проводит проверку.",
    detail: {
      whatsHappening: "Sponsor проверяет Job Offer и соответствие требованиям программы.",
      whatRequired: "Пока ничего.",
      whatsNext: "После успешной проверки документ будет направлен работодателю на подтверждение.",
    },
    cta: null,
  },
  {
    id: "JOB_PROBLEM",
    group: "job_offer",
    order: 11.5,
    branch: true,
    title: "Требуется ваше внимание",
    shortTitle: "Job Problem",
    actionRequired: true,
    severity: "danger",
    icon: "⚠️",
    description: "По вашему Job Offer появились замечания.",
    detail: {
      whatsHappening: "Sponsor или ABC Universe обнаружили проблему в вашем Job Offer.",
      whatRequired: "Свяжитесь с координатором — он передаст, что именно нужно исправить работодателю.",
      whatsNext: "После исправления Job Offer вернётся на проверку Sponsor.",
    },
    coordinatorComment: "Работодателю необходимо исправить даты работы.",
    cta: { label: "Написать координатору", action: "writeCoordinator" },
    escalationHours: 48,
  },
  {
    id: "EMPLOYER_SIGNATURE",
    group: "job_offer",
    order: 12,
    title: "Employer Signature",
    shortTitle: "Employer Signature",
    actionRequired: false,
    severity: "active",
    icon: "🔵",
    description: "Job Offer прошёл проверку и отправлен вашему работодателю. Сейчас ожидается подпись работодателя.",
    detail: {
      whatsHappening: "Job Offer отправлен работодателю на подпись.",
      whatRequired: "Обычно ничего — можете при желании напомнить работодателю о подписи.",
      whatsNext: "После подписи работодателя потребуется ваша подпись.",
    },
    cta: null,
  },
  {
    id: "STUDENT_SIGNATURE",
    group: "job_offer",
    order: 13,
    title: "Ваша очередь",
    shortTitle: "Student Signature",
    actionRequired: true,
    severity: "danger",
    icon: "✍️",
    description: "Работодатель подписал Job Offer. Теперь необходимо зайти в CIEE и поставить свою подпись.",
    detail: {
      whatsHappening: "Работодатель подписал Job Offer.",
      whatRequired: "Зайдите в CIEE и поставьте свою подпись на Job Offer.",
      whatsNext: "После вашей подписи Sponsor проведёт Final Check.",
    },
    cta: { label: "Открыть CIEE", action: "openCiee" },
    reminderSchedule: ["сразу", "+24 часа", "+48 часов"],
  },
  {
    id: "FINAL_CHECK",
    group: "job_offer",
    order: 14,
    title: "Final Check",
    shortTitle: "Final Check",
    actionRequired: false,
    severity: "active",
    icon: "🔵",
    description: "Все необходимые подписи получены. Sponsor проводит финальную проверку Job Offer.",
    detail: {
      whatsHappening: "Sponsor проводит финальную проверку подписанного Job Offer.",
      whatRequired: "Пока ничего.",
      whatsNext: "После завершения проверки статус изменится на Placed 🎉",
    },
    cta: null,
  },
  {
    id: "PLACED",
    group: "job_offer",
    order: 15,
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
    id: "DS2019_PROCESSING",
    group: "ds2019",
    order: 16,
    title: "Оформляем DS-2019",
    shortTitle: "DS-2019 processing",
    actionRequired: false,
    severity: "active",
    icon: "🔵",
    description: "ABC Universe готовит необходимые документы и передаёт их Sponsor. Сейчас от вас ничего не требуется.",
    detail: {
      whatsHappening: "ABC Universe проводит финальную проверку и готовит пакет документов для Sponsor.",
      whatRequired: "Пока ничего.",
      whatsNext: "Sponsor оформит вашу форму DS-2019.",
    },
    cta: null,
  },
  {
    id: "DS2019_ISSUED",
    group: "ds2019",
    order: 17,
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
      whatsNext: "Начинается визовый этап: Visa Briefing, SEVIS Fee, Visa Fee, DS-160.",
    },
    cta: null,
  },

  // ---------------------------------------------------------------------- VISA
  {
    id: "VISA_PREPARATION",
    group: "visa",
    order: 18,
    title: "Подготовка к визе",
    shortTitle: "Visa Preparation",
    actionRequired: true,
    severity: "danger",
    icon: "🛂",
    description: "Пройдите Visa Briefing, оплатите SEVIS и Visa Fee, заполните DS-160 согласно инструкции.",
    detail: {
      whatsHappening: "Начался визовый этап программы.",
      whatRequired: "Пройдите Visa Briefing, оплатите обязательные визовые сборы (SEVIS Fee, Visa Fee) и заполните форму DS-160.",
      whatsNext: "После заполнения DS-160 ABC Universe проверит форму перед подачей.",
    },
    cta: { label: "Открыть инструкцию", action: "openInstruction" },
  },
  {
    id: "DS160_REVIEW",
    group: "visa",
    order: 19,
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
    changesRequiredVariant: {
      severity: "warn",
      title: "Требуются исправления DS-160",
      description: "В форме DS-160 необходимо исправить несколько пунктов.",
      coordinatorComment: "Проверьте раздел Travel History — не указана предыдущая поездка в США.",
    },
  },
  {
    id: "DS160_SUBMITTED",
    group: "visa",
    order: 20,
    title: "DS-160 Submitted",
    shortTitle: "DS-160 Submitted",
    actionRequired: false,
    severity: "active",
    icon: "🔵",
    description: "Форма DS-160 подана. Теперь можно записываться на собеседование.",
    detail: {
      whatsHappening: "Ваша форма DS-160 успешно подана.",
      whatRequired: "Пока ничего.",
      whatsNext: "Запись на интервью в посольство/консульство США.",
    },
    cta: null,
  },
  {
    id: "VISA_APPOINTMENT",
    group: "visa",
    order: 21,
    title: "Visa Appointment",
    shortTitle: "Visa Appointment",
    actionRequired: false,
    severity: "warn",
    icon: "📅",
    description: "Запись на визовое интервью подтверждена.",
    detail: {
      whatsHappening: "Вы записаны на собеседование по визе J-1.",
      whatRequired: "Начните готовиться к интервью заранее.",
      whatsNext: "В день интервью — визовое собеседование в посольстве/консульстве США.",
    },
    cta: { label: "Подготовиться", action: "openInstruction" },
    reminderSchedule: ["за 7 дней", "за 3 дня", "за 1 день", "утром в день интервью"],
  },
  {
    id: "VISA_INTERVIEW",
    group: "visa",
    order: 22,
    title: "Visa Interview",
    shortTitle: "Visa Interview",
    actionRequired: true,
    severity: "danger",
    icon: "🎤",
    description: "Сегодня ваше визовое интервью. Не забудьте все документы.",
    detail: {
      whatsHappening: "У вас запланировано визовое интервью.",
      whatRequired: "Явиться на интервью со всеми необходимыми документами.",
      whatsNext: "После интервью — ожидание решения по визе (Visa Result) и статуса паспорта.",
    },
    cta: { label: "Чек-лист документов", action: "openInstruction" },
  },
  {
    id: "PASSPORT_READY",
    group: "visa",
    order: 23,
    title: "Ожидаем паспорт",
    shortTitle: "Passport",
    actionRequired: false,
    severity: "active",
    icon: "📕",
    description: "Решение по визе принято, паспорт находится в посольстве/консульстве.",
    detail: {
      whatsHappening: "Ваш паспорт с визой находится на обработке в посольстве/консульстве.",
      whatRequired: "Пока ничего — мы сообщим, когда паспорт будет готов к получению.",
      whatsNext: "Получение паспорта с визой.",
    },
    cta: null,
  },
  {
    id: "VISA_APPROVED",
    group: "visa",
    order: 24,
    title: "VISA APPROVED",
    shortTitle: "Visa Approved",
    actionRequired: false,
    severity: "ok",
    icon: "🇺🇸",
    celebration: true,
    description: "Ваша J-1 Visa одобрена. Остался последний этап — подготовка к поездке.",
    detail: {
      whatsHappening: "Ваша J-1 Visa одобрена — паспорт получен.",
      whatRequired: "Ничего — этот шаг пройден.",
      whatsNext: "Финальный брифинг Pre-Departure и чек-лист подготовки к вылету.",
    },
    cta: null,
  },

  // ----------------------------------------------------------- ПЕРЕД ВЫЛЕТОМ
  {
    id: "PRE_DEPARTURE",
    group: "pre_departure",
    order: 25,
    title: "Pre-Departure",
    shortTitle: "Pre-Departure",
    actionRequired: true,
    severity: "danger",
    icon: "🧳",
    description: "Пройдите финальный брифинг и завершите чек-лист подготовки к вылету.",
    detail: {
      whatsHappening: "Начался финальный этап подготовки к поездке.",
      whatRequired: "Пройдите Pre-Departure Briefing и отметьте пункты чек-листа подготовки.",
      whatsNext: "Когда все пункты чек-листа закрыты — вы готовы к вылету.",
    },
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
  {
    id: "READY_TO_FLY",
    group: "pre_departure",
    order: 26,
    title: "READY TO FLY",
    shortTitle: "Ready to Fly",
    actionRequired: false,
    severity: "ok",
    icon: "✈️",
    celebration: true,
    description: "Все пункты чек-листа закрыты. Вы готовы к вылету в США!",
    detail: {
      whatsHappening: "Чек-лист подготовки полностью закрыт.",
      whatRequired: "Ничего — просто дождитесь дня вылета.",
      whatsNext: "Вылет и сопровождение после прибытия в США.",
    },
    cta: null,
  },

  // ----------------------------------------------------------------------- USA
  {
    id: "USA_ARRIVED",
    group: "usa",
    order: 27,
    title: "USA",
    shortTitle: "USA",
    actionRequired: false,
    severity: "wait",
    icon: "🗽",
    description: "Добро пожаловать в США! Сопровождение на месте продолжается.",
    detail: {
      whatsHappening: "Вы на месте в США и проходите программу.",
      whatRequired: "Ничего особенного — при необходимости обращайтесь к координатору.",
      whatsNext: "Раздел будет расширен в следующей версии приложения (адаптация, поддержка, возвращение).",
    },
    cta: null,
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
  // JOB_PROBLEM sits at order 11.5 — anchor it to SPONSOR_REVIEW (order 11) for comparisons.
  const candidates = MAIN_LINE.filter((s) => s.order < branchStage.order);
  return candidates.length ? candidates[candidates.length - 1].order : 0;
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
  const candidates = MAIN_LINE.filter((s) => s.order < branchStage.order && s.group === branchStage.group);
  return candidates.length ? candidates[candidates.length - 1].id : null;
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
