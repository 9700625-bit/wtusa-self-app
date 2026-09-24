import * as api from "../services/api.js";
import { paymentTagHtml } from "../components/statusBadge.js";
import { formatDate, formatMoney, daysLabel, esc } from "../utils/format.js?v=3";

function timingText(p) {
  if (p.status === "paid" && p.paidDate) return `Оплачено ${formatDate(p.paidDate)}`;
  // Срок может быть ещё не известен: пока вебхук amoCRM не принёс дедлайны,
  // mergeWithDefaultPayments_ (Api.gs) отдаёт deadline: null. Без этой ветки
  // получалось «до » с висящим предлогом (а до правки formatDate — «до null»).
  if (!p.deadline) return "срок уточняется";
  if (p.daysUntilDeadline == null) return `до ${formatDate(p.deadline)}`;
  if (p.daysUntilDeadline >= 0) return `до ${formatDate(p.deadline)} · осталось ${daysLabel(p.daysUntilDeadline)}`;
  return `до ${formatDate(p.deadline)} · просрочено на ${daysLabel(p.daysUntilDeadline)}`;
}

export async function render(container) {
  const { paidTotal, paidTotalKzt, paidCount, paymentsCount, programCost, payments, visaFees, visaFeesUnlocked, fxRate } = await api.getPayments();
  // Наверху — что реально оплачено: доллары и/или тенге, либо «пока ничего».
  const paidParts = [];
  if (paidTotal > 0) paidParts.push(formatMoney(paidTotal, "USD"));
  if (paidTotalKzt > 0) paidParts.push(formatMoney(paidTotalKzt, "KZT"));
  const paidLabel = paidParts.length ? paidParts.join(" + ") : "пока нет";
  const paidCounter = paymentsCount ? ` · ${paidCount} из ${paymentsCount}` : "";
  // КУРС НАЦБАНКА (22.09.2026). Бэкенд отдаёт официальный курс USD/KZT НБ РК
  // (фид nationalbank.kz, обновляется раз в 6 часов). Для платежей в $ пишем
  // ориентировочную сумму в тенге на сегодня и даём ссылку на страницу курсов.
  // Точная сумма — по курсу на день оплаты, поэтому «≈». Нет курса — старая
  // подпись без чисел.
  const kzt = (usd) => Math.round(Number(usd) * fxRate.usdKzt).toLocaleString("ru-RU") + " ₸";
  const rateText = fxRate && fxRate.usdKzt
    ? `курс НБ РК ${fxRate.usdKzt.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₸/$` + (fxRate.date ? ` на ${esc(fxRate.date)}` : "")
    : "";

  // Was previously left as `` when payments.length === 0, rendering a
  // visibly empty <div class="card"> — matches the empty-state pattern
  // already used in events.js instead of showing a blank block.
  const paymentsHtml = payments.length
    ? payments
        .map((p) => {
          const currency = p.currency || "USD";
          // Payment 1 is quoted and paid in tenge directly — no conversion
          // involved. Payments 2/3 are quoted in $ but paid in tenge, so the
          // exact tenge amount depends on the National Bank of RK's rate on the
          // day of payment — we don't try to compute it ourselves.
          const showKzt = currency === "USD" && fxRate && fxRate.usdKzt && Number(p.amount) > 0 && p.status !== "paid";
          const rateNote =
            currency === "USD"
              ? `<div class="small" style="margin-top:2px">${
                  showKzt
                    ? `≈ ${kzt(p.amount)} сегодня · ${rateText}. Оплата в тенге по курсу Нацбанка РК на день оплаты.`
                    : "Оплата в тенге по курсу Нацбанка РК на день оплаты"
                }</div>`
              : "";
          return `
      <div class="pay">
        <div>
          <b>${p.label}</b>
          <div class="small">${timingText(p)} · ${
            // Сумма третьего платежа приходит из amoCRM и до синхронизации
            // равна нулю. Раньше это рисовалось как «Оплата 3 · $0» и читалось
            // студентом как «третий платёж не нужен» (02.09.2026).
            Number(p.amount) > 0 ? formatMoney(p.amount, currency) : "сумма уточняется"
          }</div>
          ${rateNote}
        </div>
        ${paymentTagHtml(p.status)}
      </div>`;
        })
        .join("")
    : `<div class="sub">График платежей пока не сформирован — появится после оформления сделки.</div>`;
  const rateLinkHtml = fxRate && fxRate.url
    ? `<a class="link-row" href="${esc(fxRate.url)}" target="_blank" rel="noopener">Официальные курсы Нацбанка РК<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></a>`
    : "";

  const feesHtml = visaFees
    .map((fee) => {
      // СУММУ ВИДНО, КАК ТОЛЬКО ЭТАП ОТКРЫТ (14.09.2026). Раньше строка
      // показывала сумму только при статусе "unpaid", а статус берётся из
      // листа VisaInfo — в который на сегодня не пишет ни один код: лист
      // пустой, бэкенд подставляет "locked", и сумма не показывалась НИКОМУ
      // и НИКОГДА, даже после визового этапа. Студент видел «Откроется на
      // визовом этапе» и на визовом этапе тоже.
      //
      // Теперь: до этапа — «откроется», после — сумма. Отметку «оплачено /
      // не оплачено» ставим, только если она реально есть в VisaInfo;
      // выдумывать её нельзя — сборы платятся мимо нас, мы не можем знать.
      //
      // СУММА — ВСЕГДА (22.09.2026, по просьбе владельца). Студент должен
      // заранее знать, сколько стоят сборы: SEVIS $35, Visa $185. До визового
      // этапа показываем сумму и «оплата позже, на визовом этапе»; после —
      // сумму и отметку, если она есть. Оба сбора платятся в тенге по курсу
      // посольства — пишем это явно, как у платежей 2/3 про курс Нацбанка.
      const status = visaFeesUnlocked ? fee.status : "locked";
      const известен = status === "paid" || status === "unpaid";
      const dot = status === "paid" ? "ok" : visaFeesUnlocked ? "warn" : "wait";
      const сумма = formatMoney(fee.amount, "USD");
      const note = !visaFeesUnlocked
        ? `${сумма} · оплата на визовом этапе`
        : status === "paid"
          ? `Оплачено · ${сумма}`
          : известен
            ? `Не оплачено · ${сумма}`
            : сумма;
      return `
        <div class="status">
          <span class="dot ${dot}"></span>
          <div><b>${fee.label}</b><div class="sub">${note}</div><div class="sub">Оплата в тенге по курсу посольства США</div></div>
        </div>`;
    })
    .join("");

  container.innerHTML = `
    <section class="screen active">
      <div class="card">
        <div class="kicker">Оплата</div>
        <h1>График платежей</h1>
        <div class="row">
          <div><div class="small">Оплачено${paidCounter}</div><div class="metric">${paidLabel}</div></div>
          ${
            // ЛУЧШЕ НИЧЕГО, ЧЕМ НЕВЕРНАЯ ЦЕНА (14.09.2026).
            //
            // Стоимость программы переезжает в поле сделки amoCRM — она
            // разная у Self и Full и будет меняться. Пока в сделке её не
            // проставили, бэкенд присылает null, и колонка просто не
            // рисуется: «Оплачено» занимает строку одно.
            //
            // Раньше на этом месте всегда стояло число. Бралось оно из
            // настройки PROGRAM_COST_USD, а настройка не была задана —
            // значит срабатывало запасное значение, зашитое в коде, и
            // каждый студент видел одну и ту же сумму независимо от своего
            // тарифа и договорённостей.
            programCost
              ? `<div style="text-align:right"><div class="small">Стоимость программы</div><div class="metric">${formatMoney(programCost, "USD")}</div></div>`
              : ""
          }
        </div>
      </div>
      <div class="card">${paymentsHtml}${rateLinkHtml}</div>
      <div class="card">
        <h3>Обязательные визовые сборы</h3>
        ${feesHtml}
        ${
          // В ЧЁМ И ПО КАКОМУ КУРСУ ПЛАТИТЬ (14.09.2026). Оба сбора указаны
          // в долларах, но платятся в тенге, и курс тут НЕ Нацбанка, как у
          // платежей выше, — у консульского сбора свой курс посольства США.
          // Без этой строки студент видел две суммы в долларах и не понимал
          // ни где платить, ни по какому курсу пересчитывать.
          //
          // Суммы намеренно не пересчитываем сами: курс посольства меняется,
          // а ошибиться в деньгах хуже, чем не назвать цифру.
          visaFeesUnlocked
            ? `<div class="small" style="margin-top:10px">Оба сбора платятся напрямую в структуры США, не через ABC Universe. Консульский сбор — в тенге по курсу посольства на день оплаты.</div>`
            : ""
        }
      </div>
    </section>`;
}
