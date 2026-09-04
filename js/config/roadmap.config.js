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
 *
 * ИСКЛЮЧЕНИЕ ИЗ ПРАВИЛА ВЫШЕ (04.09.2026). Job Offer и Visa группы ниже
 * переписаны под новую воронку self (CLAUDE.md, п. "добавить сделки в
 * воронке self"), но эти статусы В AMOCRM ЕЩЁ НЕ СОЗДАНЫ — пользователь
 * только планирует их завести/переставить там. Это единственный момент в
 * истории файла, когда стадия добавлена ДО существования статуса в CRM.
 * Последствие: пока STATUS_ID_MAP_JSON не обновлён реальными status_id для
 * новых имён (JOB_OFFER_SENT_INTL_REP, JOB_OFFER_SUBMITTED_CIEE,
 * JOB_OFFER_HOST_REVIEW, JOB_OFFER_PARTICIPANT_REVIEW,
 * JOB_OFFER_CIEE_FINAL_REVIEW, PLACEMENT_COMPLETED, VISA_INTERVIEW_SCHEDULED),
 * ни один реальный deal не сможет попасть на эти этапы — backend просто не
 * умеет проставить сюда current_stage_id (см. предупреждение в Setup.gs над
 * wireUpSelfPipelineMapping()). Демо-режим (mockData.js) их уже видит.
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
    title: "Регистрация CIEE готова",
    shortTitle: "Регистрация CIEE",
    actionRequired: true,
    severity: "danger",
    icon: "📩",
    description: "Проверьте почту, активируйте аккаунт и заполните анкету в течение 5 дней. Инструкция по заполнению — в приложении.",
    detail: {
      whatsHappening: "ABC Universe зарегистрировала вас в системе CIEE. На указанный email отправлено Welcome Email.",
      whatRequired: "Найдите Welcome Email от CIEE, активируйте аккаунт и заполните анкету, следуя инструкции ABC Universe.",
      whatsNext: "ABC Universe проверит вашу анкету.",
    },
    cta: { label: "Открыть инструкцию", action: "openInstruction" },
    // Видео-инструкция по регистрации в CIEE (вставлено 04.09.2026 по
    // ссылке от владельца). Именно для этого этапа — DS160_STARTED и
    // VISA_FINAL_CALL ниже используют ту же кнопку/action, но со своим
    // содержанием, поэтому ссылка живёт здесь, а не в MOCK_INSTRUCTIONS_URL
    // (actions.js), который иначе применился бы ко всем трём сразу.
    instructionUrl: "https://drive.google.com/file/d/1qZyVkZPosrvxXZtkclmO0aaR7mp9YvKi/view?usp=drive_link",
    secondaryCta: { label: "Не пришло письмо?", action: "writeCoordinator" },
    deadlineDays: 5,
  },
  // ПОРЯДОК ЭТАПОВ CIEE (04.09.2026, ОТМЕНЯЕТ решение от 03.09.2026). Тогда
  // порядок был исправлен на «кабинет заполнен -> проверка анкеты», потому что
  // казалось нелогичным проверять анкету раньше, чем студент её заполнил.
  // Владелец явно подтвердил новый порядок «проверка анкеты -> кабинет
  // заполнен» (сообщение 04.09.2026, список из 17 этапов новой воронки self) —
  // возвращаем его сюда таким, каким он и был до 03.09.2026. Поиск
  // работодателя по-прежнему идёт ПАРАЛЛЕЛЬНО проверке — ждать её не нужно.
  {
    id: "CIEE_ANKETA_REVIEW",
    group: "ciee",
    order: 3,
    title: "Проверяем анкету CIEE",
    shortTitle: "Проверка анкеты",
    actionRequired: false,
    severity: "active",
    icon: "🔎",
    description: "Мы проверяем заполненные данные. Пока продолжайте поиск Job Offer.",
    detail: {
      whatsHappening: "ABC Universe проверяет данные, которые вы указали в анкете CIEE.",
      whatRequired: "По анкете — ничего. Продолжайте искать работодателя.",
      whatsNext: "Когда анкета будет проверена, начнётся поиск и загрузка Job Offer.",
    },
    cta: null,
  },
  {
    id: "CIEE_FILLED",
    group: "ciee",
    order: 4,
    title: "Анкета CIEE проверена",
    shortTitle: "CIEE проверена",
    actionRequired: true,
    severity: "active",
    icon: "✅",
    description: "Всё готово! Продолжайте поиск Job Offer. Как только получите офер — сообщите нам.",
    detail: {
      whatsHappening: "Анкета в личном кабинете CIEE проверена ABC Universe.",
      whatRequired: "Продолжайте искать работодателя. Как только получите Job Offer — загрузите его в приложении.",
      whatsNext: "Job Offer уйдёт на проверку международному представителю, затем в CIEE.",
    },
    cta: null,
  },

  // ----------------------------------------------------------------- JOB OFFER
  {
    id: "JOB_OFFER_SENT_INTL_REP",
    group: "job_offer",
    order: 5,
    title: "Job Offer на проверке",
    shortTitle: "Job Offer получен",
    actionRequired: false,
    severity: "active",
    icon: "📥",
    description: "Мы получили ваш офер и проверяем его перед отправкой в CIEE. Пока от вас ничего не требуется.",
    detail: {
      whatsHappening: "Ваш Job Offer поступил в ABC Universe и проверяется международным представителем.",
      whatRequired: "Пока ничего.",
      whatsNext: "После проверки офер будет отправлен спонсору CIEE.",
    },
    cta: null,
  },
  {
    id: "JOB_OFFER_SUBMITTED_CIEE",
    group: "job_offer",
    order: 6,
    title: "Job Offer передан в CIEE",
    shortTitle: "Передан в CIEE",
    actionRequired: false,
    severity: "active",
    icon: "🔵",
    description: "Офер отправлен спонсору. Будьте на связи с работодателем — CIEE может запросить у него дополнительные документы.",
    detail: {
      whatsHappening: "CIEE (Sponsor) получил ваш Job Offer и начинает проверку.",
      whatRequired: "Будьте на связи с работодателем — CIEE может запросить у него дополнительные документы.",
      whatsNext: "Работодателю нужно будет подтвердить офер в личном кабинете CIEE.",
    },
    cta: null,
  },
  {
    id: "JOB_OFFER_HOST_REVIEW",
    group: "job_offer",
    order: 7,
    title: "Работодателю нужно подтвердить Job Offer",
    shortTitle: "Host Review",
    actionRequired: true,
    severity: "warn",
    icon: "🏢",
    description: "Попросите работодателя зайти в личный кабинет CIEE и подписать ваш Job Offer.",
    detail: {
      whatsHappening: "CIEE ждёт, когда работодатель (Host) подтвердит условия Job Offer в своём личном кабинете.",
      whatRequired: "Свяжитесь с работодателем и попросите его зайти в личный кабинет CIEE и подписать офер.",
      whatsNext: "После подтверждения работодателем офер перейдёт к вам на подпись.",
    },
    cta: null,
  },
  {
    id: "JOB_OFFER_PARTICIPANT_REVIEW",
    group: "job_offer",
    order: 8,
    title: "Подтвердите Job Offer",
    shortTitle: "Ваша подпись",
    actionRequired: true,
    severity: "danger",
    icon: "✍️",
    description: "Зайдите в личный кабинет CIEE, проверьте условия и подпишите Job Offer.",
    detail: {
      whatsHappening: "Работодатель подтвердил Job Offer. Теперь очередь за вами.",
      whatRequired: "Зайдите в личный кабинет CIEE, внимательно проверьте условия и подпишите Job Offer.",
      whatsNext: "После вашей подписи офер уйдёт на финальную проверку CIEE.",
    },
    cta: null,
  },
  {
    id: "JOB_OFFER_CIEE_FINAL_REVIEW",
    group: "job_offer",
    order: 9,
    title: "Job Offer на финальной проверке",
    shortTitle: "Финальная проверка",
    actionRequired: false,
    severity: "active",
    icon: "🔵",
    description: "CIEE проверяет офер после подписания. Пока от вас ничего не требуется.",
    detail: {
      whatsHappening: "CIEE проверяет подписанный Job Offer в последний раз перед подтверждением.",
      whatRequired: "Пока ничего.",
      whatsNext: "После успешной проверки — Job Offer подтверждён 🎉. Если найдутся замечания, координатор свяжется с вами.",
    },
    cta: null,
  },
  {
    id: "JOB_PROBLEM",
    group: "job_offer",
    order: 9.5,
    branch: true,
    branchOf: "JOB_OFFER_CIEE_FINAL_REVIEW",
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
    // ЗДЕСЬ БЫЛ ВЫДУМАННЫЙ КОММЕНТАРИЙ (03.09.2026): «Работодателю необходимо
    // исправить даты работы». Он лежал в конфиге этапа, то есть показывался
    // ОДИНАКОВО каждому студенту со статусом JOB_PROBLEM — независимо от того,
    // что на самом деле не так с его Job Offer. Человек читал конкретную
    // причину, шёл с ней к работодателю, а причина была чужая.
    //
    // Настоящего источника у этого текста пока нет: coordinator_comment есть
    // только в листе Documents (по документам), а Job Offer отдельным
    // документом не заведён — чтобы показывать реальную причину, нужно новое
    // поле в amoCRM + колонка в Participants + синк в Webhooks.gs. Пока этого
    // нет, поле просто не задаём: statusDetail.js рисует карточку
    // «Комментарий координатора» только когда комментарий есть, а что делать,
    // и так написано в detail.whatRequired — связаться с координатором.
    // JOB_PROBLEM — редкий случай, ветка сохранена целиком, убран только
    // вымышленный текст. branchOf переставлен на JOB_OFFER_CIEE_FINAL_REVIEW
    // 04.09.2026 вместе с переработкой всей группы job_offer — старого
    // JOB_OFFER_CIEE_REVIEW, от которого ветка отходила раньше, больше нет.
    cta: { label: "Написать координатору", action: "writeCoordinator" },
    escalationHours: 48,
  },
  {
    id: "PLACEMENT_COMPLETED",
    group: "job_offer",
    order: 10,
    title: "Job Offer подтверждён 🎉",
    shortTitle: "Placement Completed",
    actionRequired: false,
    severity: "ok",
    icon: "🇺🇸",
    celebration: true,
    description: "Офер полностью подтверждён CIEE. Следующий этап — выпуск DS-2019.",
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
    order: 11,
    title: "DS-2019 готова",
    shortTitle: "DS-2019 issued",
    actionRequired: false,
    severity: "ok",
    icon: "🇺🇸",
    celebration: true,
    description: "Документ выпущен! Переходим к визовому этапу — следующий шаг DS-160.",
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
    order: 12,
    title: "Пора заполнить DS-160",
    shortTitle: "DS-160",
    actionRequired: true,
    severity: "danger",
    icon: "🛂",
    description: "Заполните визовую анкету по инструкции в приложении и отправьте нам на проверку.",
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
    order: 13,
    title: "Проверяем DS-160",
    shortTitle: "DS-160 Review",
    actionRequired: false,
    severity: "active",
    icon: "🔵",
    description: "Мы проверяем анкету перед подачей. Пока от вас ничего не требуется.",
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
    order: 14,
    title: "DS-160 подана",
    shortTitle: "DS-160 Submitted",
    actionRequired: false,
    severity: "active",
    icon: "🔵",
    description: "Анкета готова. Теперь можно переходить к записи на визовое интервью.",
    detail: {
      whatsHappening: "Ваша форма DS-160 успешно подана.",
      whatRequired: "Пока ничего.",
      whatsNext: "Запись на интервью в посольство/консульство США.",
    },
    cta: null,
  },
  {
    id: "VISA_INTERVIEW_SCHEDULED",
    group: "visa",
    order: 15,
    title: "Визовое интервью назначено 📅",
    shortTitle: "Интервью назначено",
    actionRequired: true,
    severity: "warn",
    icon: "📅",
    description: "Дата подтверждена. Проверьте дату и время записи и начинайте подготовку к интервью.",
    detail: {
      whatsHappening: "Вам назначена дата визового интервью в посольстве/консульстве США.",
      whatRequired: "Проверьте дату и время записи и начинайте собирать документы по чек-листу.",
      whatsNext: "Ближе к дате интервью — Final Call с финальной проверкой готовности.",
    },
    cta: null,
  },
  {
    id: "VISA_FINAL_CALL",
    group: "visa",
    order: 16,
    title: "Скоро визовое интервью",
    shortTitle: "Final Call",
    actionRequired: true,
    severity: "danger",
    icon: "📞",
    description: "Проверьте дату и время записи и подготовьте документы по чек-листу в приложении.",
    detail: {
      whatsHappening: "Вы записаны на визовое интервью.",
      whatRequired: "Проверьте дату и время интервью, соберите документы по чек-листу.",
      whatsNext: "В день интервью — визовое собеседование в посольстве/консульстве США. После — Passport ready и решение по визе.",
    },
    cta: { label: "Чек-лист документов", action: "openInstruction" },
    // ЗДЕСЬ БЫЛО ОБЕЩАНИЕ НАПОМИНАНИЙ (03.09.2026): reminderSchedule
    // ["за 7 дней", "за 3 дня", "за 1 день", "утром в день интервью"] —
    // statusDetail.js рисовал по нему карточку «Напоминания в Telegram».
    // Такой рассылки нет: в Reminders.gs есть только напоминания по платежам
    // (sendPaymentReminders_) и по активации CIEE (sendCieeActivationReminders_),
    // ничего про визовое интервью. Студент рассчитывал, что о дате ему
    // напомнят, напоминание не приходило — и это единственный этап, где цена
    // пропуска максимальная (интервью в посольстве не переносится по звонку).
    // Дата и обратный отсчёт до интервью на этом же экране показываются
    // по-настоящему — из VisaInfo, см. блок VISA_FINAL_CALL в statusDetail.js.
    // 04.09.2026: та же карточка VisaInfo теперь показывается и на
    // VISA_INTERVIEW_SCHEDULED выше — именно там дата становится известна
    // впервые, Final Call лишь напоминает о ней перед самим интервью.
  },
  {
    id: "PASSPORT_READY",
    group: "visa",
    order: 17,
    title: "Паспорт готов 🎉",
    shortTitle: "Passport",
    actionRequired: true,
    severity: "warn",
    icon: "📕",
    description: "Ваш паспорт с визовым решением готов к выдаче. Заберите его и сразу сообщите нам о результате.",
    detail: {
      whatsHappening: "Решение по визе принято, паспорт готов к выдаче в посольстве/консульстве.",
      whatRequired: "Заберите паспорт и сразу сообщите координатору о результате.",
      whatsNext: "Получение паспорта с визой — VISA APPROVE.",
    },
    cta: null,
  },
  {
    id: "VISA_APPROVED",
    group: "visa",
    order: 18,
    title: "Виза J-1 одобрена 🎉🇺🇸",
    shortTitle: "Visa Approved",
    actionRequired: true,
    severity: "ok",
    icon: "🇺🇸",
    celebration: true,
    description: "Поздравляем! Переходите к чек-листу подготовки к вылету в приложении.",
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
  // explicitly — e.g. branchOf: "JOB_OFFER_CIEE_FINAL_REVIEW" anchors it there for
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
