import * as api from "../services/api.js";
import { docTagHtml } from "../components/statusBadge.js";

const UPLOAD_LABEL = {
  ok: "Заменить файл",
  review: "Заменить файл",
  need: "Загрузить новый файл",
  miss: "Загрузить документ",
};

export async function render(container) {
  const documents = await api.getDocuments();

  const rowsHtml = documents
    .map(
      (doc) => `
      <div class="doc">
        <div>
          <b>${doc.type}</b>
          <div class="small">${doc.note}</div>
          ${doc.coordinatorComment ? `<div class="small" style="color:var(--danger);margin-top:4px">💬 ${doc.coordinatorComment}</div>` : ""}
        </div>
        ${docTagHtml(doc.status)}
      </div>`
    )
    .join("");

  container.innerHTML = `
    <section class="screen active">
      <div class="card">
        <div class="kicker">Документы</div>
        <h1>Мои документы</h1>
        <div class="sub">Статусы проверки ABC Universe.</div>
      </div>
      <div class="card">${rowsHtml}</div>
      <div class="card">
        <h3>Загрузить документ</h3>
        <div class="sub" style="margin-bottom:10px">Выберите документ, который хотите загрузить или заменить.</div>
        <select id="doc-select" class="btn secondary" style="text-align:left;appearance:none">
          ${documents.map((d) => `<option value="${d.id}">${d.type} — ${UPLOAD_LABEL[d.status]}</option>`).join("")}
        </select>
        <input type="file" id="doc-file-input" style="display:none" accept="image/*,.pdf" />
        <button class="btn" id="doc-upload-btn" style="margin-top:10px">Выбрать файл</button>
        <div class="sub" id="doc-upload-status" style="margin-top:8px"></div>
      </div>
    </section>`;

  const select = container.querySelector("#doc-select");
  const fileInput = container.querySelector("#doc-file-input");
  const uploadBtn = container.querySelector("#doc-upload-btn");
  const uploadStatus = container.querySelector("#doc-upload-status");

  uploadBtn.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    uploadStatus.textContent = "Загрузка…";
    const docId = select.value;
    await api.uploadDocument(docId, file);
    uploadStatus.textContent = `Готово — «${file.name}» отправлен на проверку.`;
    render(container); // refresh statuses
  });
}
