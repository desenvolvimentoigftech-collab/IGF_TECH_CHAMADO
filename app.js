const labels = {
  falha: "Falha", intervencao: "Intervencao", instalacao: "Instalacao", remocao: "Remocao",
  baixa: "Baixa", media: "Media", alta: "Alta", critica: "Critica",
  aberto: "Aberto", em_atendimento: "Em atendimento", resolvido: "Resolvido", paliativo: "Paliativo", equipamento_condenado: "Equipamento condenado",
  aguardando_peca: "Aguardando peca", aguardando_parada_maquina: "Aguardando parada da maquina", aguardando_ferramenta: "Aguardando ferramenta",
  aguardando_informacao: "Aguardando informacao", causa_raiz_em_observacao: "Causa raiz em estudo/observacao", aguardando_acesso: "Aguardando acesso",
  aguardando_aprovacao: "Aguardando aprovacao", risco_operacional_para_intervencao: "Risco operacional para intervencao", dependencia_de_terceiro: "Dependencia de terceiro", outros: "Outros",
  admin: "Administrador", gestor: "Gestor", tecnico: "Tecnico", solicitante: "Solicitante"
};

const DEFAULT_API_URL = atob("aHR0cHM6Ly9zY3JpcHQuZ29vZ2xlLmNvbS9tYWNyb3Mvcy9BS2Z5Y2J6UjdPZmw3enA0VFRtc3FoOHhpTG1OU0FBMUF4VXA2eDRwTVdyazZwQlp2YzJaTXNpdThyTEZsTmgyd1BoeEZ4dDQvZXhlYw==");

let apiUrl = DEFAULT_API_URL;
let token = localStorage.getItem("chamadosToken") || "";
let currentUser = null;
let users = [];
let companies = [];
let failureTypes = [];
let locations = [];
let selectedTicketId = null;
let ticketFormDataLoaded = false;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
$("#apiUrl").value = DEFAULT_API_URL;

async function api(action, data = {}) {
  apiUrl = DEFAULT_API_URL;
  if (!apiUrl) throw new Error("Servico indisponivel. Contate o administrador.");
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, token, ...data })
  });
  const payload = await response.json();
  if (!payload.ok) throw new Error(payload.error || "Erro na operacao.");
  return payload;
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString("pt-BR") : "-";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function setFormBusy(form, busy, label) {
  const button = form.querySelector("button[type='submit']");
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = label;
    button.disabled = true;
    form.classList.add("is-busy");
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
    form.classList.remove("is-busy");
  }
}

function setMessage(selector, message, isError = false) {
  const element = $(selector);
  element.textContent = message;
  element.classList.toggle("error", isError);
  element.classList.toggle("success", !isError);
}

function syncFailureOtherVisibility() {
  const isOther = !$("#ticketFailureSelect").value;
  $("#ticketFailureOtherField").classList.toggle("hidden", !isOther);
  $("#ticketFailureOther").required = isOther;
  if (!isOther) $("#ticketFailureOther").value = "";
}

function showView(id) {
  $$(".view").forEach((view) => view.classList.toggle("hidden", view.id !== id));
  $$(".nav").forEach((button) => button.classList.toggle("active", button.dataset.view === id));
  if (id === "dashboard") loadDashboard();
  if (id === "tickets") loadTickets();
  if (id === "newTicket") ensureTicketFormData();
  if (id === "companies") loadCompanies();
  if (id === "failureTypes") loadFailureTypes();
  if (id === "locations") loadLocations();
  if (id === "users") loadUsers();
}

function applyRoleUi() {
  $("#currentUser").textContent = currentUser.name;
  $("#currentRole").textContent = currentUser.companyName ? `${labels[currentUser.role]} - ${currentUser.companyName}` : labels[currentUser.role];
  $$(".admin-only").forEach((el) => el.classList.toggle("hidden", currentUser.role !== "admin"));
  $$(".manager-only").forEach((el) => el.classList.toggle("hidden", !["admin", "gestor"].includes(currentUser.role)));
  $$(".nav[data-view='dashboard']").forEach((el) => el.classList.toggle("hidden", currentUser.role === "solicitante"));
  $("#ticketCompanySelect").required = currentUser.role === "admin";
  $("#locationCompanySelect").required = currentUser.role === "admin";
}

async function afterLogin(user, newToken) {
  currentUser = user;
  token = newToken || token;
  ticketFormDataLoaded = false;
  localStorage.setItem("chamadosToken", token);
  $("#loginView").classList.add("hidden");
  $("#appView").classList.remove("hidden");
  applyRoleUi();
  showView(currentUser.role === "solicitante" ? "newTicket" : "dashboard");
}

async function loadDashboard() {
  const data = await api("dashboard");
  $("#metricTotal").textContent = data.total;
  $("#metricCritical").textContent = data.critical;
  $("#metricProgress").textContent = data.byStatus.em_atendimento || 0;
  $("#metricResolved").textContent = data.byStatus.resolvido || 0;
  renderBars("#statusBars", data.byStatus);
  renderBars("#typeBars", data.byType);
  await loadDashboardChart();
}

function renderBars(selector, values) {
  const max = Math.max(1, ...Object.values(values));
  $(selector).innerHTML = Object.entries(values).map(([key, count]) => `
    <div class="bar-row"><div class="bar-label"><span>${labels[key] || key}</span><strong>${count}</strong></div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(8, count / max * 100)}%"></div></div></div>
  `).join("") || "<p class='muted'>Sem dados.</p>";
}

async function loadDashboardChart() {
  const kind = $("#dashboardKind").value;
  if (kind === "overview") {
    $("#dashboardChart").innerHTML = "<p class='muted'>Selecione Pareto de falhas ou Ocorrencias no tempo para analisar tendencias.</p>";
    $("#reportBucket").disabled = true;
    return;
  }
  $("#reportBucket").disabled = kind !== "occurrences";
  const data = await api(kind === "pareto" ? "reportFailures" : "reportOccurrences", {
    start: $("#reportStart").value,
    end: $("#reportEnd").value,
    bucket: $("#reportBucket").value
  });
  kind === "pareto" ? renderPareto(data.items) : renderLineChart(data.items);
}

function renderPareto(items) {
  if (!items.length) return $("#dashboardChart").innerHTML = "<p class='muted'>Sem ocorrencias no periodo.</p>";
  const max = Math.max(...items.map((item) => item.total));
  let cumulative = 0;
  const total = items.reduce((sum, item) => sum + item.total, 0);
  $("#dashboardChart").innerHTML = items.map((item) => {
    cumulative += item.total;
    return `<div class="bar-row"><div class="bar-label"><span>${escapeHtml(item.label)}</span><strong>${item.total} (${Math.round(cumulative / total * 100)}%)</strong></div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(5, item.total / max * 100)}%"></div></div></div>`;
  }).join("");
}

function renderLineChart(items) {
  if (!items.length) return $("#dashboardChart").innerHTML = "<p class='muted'>Sem ocorrencias no periodo.</p>";
  const width = 680, height = 260, pad = 34, max = Math.max(1, ...items.map((item) => item.total));
  const points = items.map((item, index) => ({
    ...item,
    x: items.length === 1 ? width / 2 : pad + index * (width - pad * 2) / (items.length - 1),
    y: height - pad - item.total / max * (height - pad * 2)
  }));
  const path = points.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" ");
  $("#dashboardChart").innerHTML = `<svg viewBox="0 0 ${width} ${height}"><line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" stroke="#dce3e7"/><line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height - pad}" stroke="#dce3e7"/><path d="${path}" fill="none" stroke="#146c5c" stroke-width="3"/>${points.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="5" fill="#146c5c"><title>${escapeHtml(p.label)}: ${p.total}</title></circle><text x="${p.x}" y="${p.y - 10}" text-anchor="middle" font-size="12">${p.total}</text>`).join("")}</svg>`;
}

async function loadTickets() {
  const list = $("#ticketList");
  list.innerHTML = "<p class='muted'>Carregando chamados existentes...</p>";
  try {
    const data = await api("listTicketQueue", { q: $("#searchInput").value.trim(), status: $("#statusFilter").value, type: $("#typeFilter").value });
    list.innerHTML = data.tickets.map(ticketCard).join("") || "<p class='muted'>Nenhum chamado cadastrado.</p>";
  } catch (error) {
    list.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
  }
}

function ticketCard(ticket) {
  const canManage = ["admin", "gestor", "tecnico"].includes(currentUser.role);
  const canClaim = canManage && ticket.status === "aberto" && !ticket.assigneeId;
  const canContinue = canManage && ["em_atendimento", "paliativo"].includes(ticket.status) && (currentUser.role !== "tecnico" || !ticket.assigneeId || ticket.assigneeId === currentUser.id);
  const primaryAction = canClaim
    ? `<button class="primary" type="button" onclick="claimTicket('${ticket.id}')">Atender chamado</button>`
    : canContinue
      ? `<button class="primary" type="button" onclick="openAttendance('${ticket.id}')">${ticket.status === "paliativo" ? "Alterar status" : "Continuar atendimento"}</button>`
      : `<button class="secondary" type="button" onclick="openAttendance('${ticket.id}')">Ver detalhes</button>`;
  return `<article class="ticket-card">
    <div class="ticket-summary">
      <div>
        <div class="ticket-topline"><span class="badge">${ticket.protocol}</span><span class="badge ${ticket.status}">${labels[ticket.status]}</span><span class="badge ${ticket.priority}">${labels[ticket.priority]}</span></div>
        <h3>${escapeHtml(ticket.title)}</h3>
        <p class="ticket-description">${escapeHtml(shortText(ticket.description || ticket.title, 150))}</p>
        <div class="ticket-meta">${ticketMeta(ticket).join("")}</div>
      </div>
      <div class="ticket-actions">${primaryAction}</div>
    </div>
  </article>`;
}

function ticketMeta(ticket) {
  const items = [
    `Aberto em ${formatDate(ticket.createdAt)}`,
    `Solicitante: ${escapeHtml(ticket.requesterName || "-")}`,
    `Local: ${escapeHtml(ticket.locationName || "-")}`,
    `Equipamento: ${escapeHtml(equipmentLabel(ticket))}`
  ];
  if (ticket.assigneeName) items.push(`Responsavel: ${escapeHtml(ticket.assigneeName)}`);
  if (ticket.status === "paliativo") {
    items.push(`Prazo: ${escapeHtml(ticket.palliativeDeadline || "-")}`);
    if (ticket.palliativePlan) items.push(`Plano: ${escapeHtml(shortText(ticket.palliativePlan, 90))}`);
  }
  if (["resolvido", "equipamento_condenado"].includes(ticket.status)) items.push(`Resolvido em ${formatDate(ticket.resolvedAt)}`);
  if (ticket.attachmentCount) items.push(`${ticket.attachmentCount} evidencia(s)`);
  return items.map((item) => `<span>${item}</span>`);
}

function shortText(value, max) {
  const text = String(value || "").trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function equipmentLabel(ticket) {
  return `${ticket.equipmentName || "-"} - Serie: ${ticket.serialNumber || "-"}`;
}

async function openAttendance(id) {
  selectedTicketId = id;
  showView("ticketAttendance");
  $("#attendanceTitle").textContent = "Carregando...";
  $("#attendanceContent").innerHTML = "<p class='muted'>Carregando detalhes do chamado...</p>";
  await renderTicketDetail(id);
}

async function renderTicketDetail(id) {
  selectedTicketId = id;
  const data = await api("getTicketDetail", { id });
  const ticket = data.ticket;
  const canManage = ["admin", "gestor", "tecnico"].includes(currentUser.role);
  const canClaim = canManage && ticket.status === "aberto" && !ticket.assigneeId;
  const detail = $("#attendanceContent");
  if (!detail) return;
  $("#attendanceTitle").textContent = `${ticket.protocol} - ${ticket.title}`;
  detail.innerHTML = `
    <section class="panel facts">
      <h2>Resumo</h2>
      <div class="fact"><span>Status</span><strong>${labels[ticket.status]}</strong></div>
      <div class="fact"><span>Prioridade</span><strong>${labels[ticket.priority]}</strong></div>
      <div class="fact"><span>Solicitante</span><strong>${escapeHtml(ticket.requesterName || "-")}</strong></div>
      <div class="fact"><span>Responsavel</span><strong>${escapeHtml(ticket.assigneeName || "-")}</strong></div>
      <div class="fact"><span>Empresa/local</span><strong>${escapeHtml(ticket.companyName || "-")} / ${escapeHtml(ticket.locationName || "-")}</strong></div>
      <div class="fact"><span>Equipamento</span><strong>${escapeHtml(equipmentLabel(ticket))}</strong></div>
      <div class="fact"><span>Criado em</span><strong>${formatDate(ticket.createdAt)}</strong></div>
      ${ticket.status === "paliativo" ? `<div class="fact"><span>Motivo</span><strong>${labels[ticket.palliativeReason] || ticket.palliativeReason}</strong></div><div class="fact"><span>Prazo</span><strong>${escapeHtml(ticket.palliativeDeadline || "-")}</strong></div>` : ""}
      <h2>Descricao</h2>
      <p>${escapeHtml(ticket.description)}</p>
      ${canClaim ? `<button class="primary" type="button" onclick="claimTicket('${ticket.id}')">Atender chamado</button>` : ""}
      ${canManage ? attendanceActionsHtml(ticket) : ""}
      ${canManage ? `<form id="commentForm" class="form-grid"><label>Comentario<textarea name="body" rows="3" required></textarea></label><button class="primary" type="submit">Adicionar comentario</button></form>` : ""}
    </section>
    <aside class="panel facts">
      <section class="photos"><h3>Evidencias</h3><div class="photo-grid">${data.attachments.map((a) => `<a href="${a.url}" target="_blank"><img src="${a.url}" alt="${escapeHtml(a.fileName)}"></a>`).join("") || "<p class='muted'>Nenhuma foto anexada.</p>"}</div></section>
      <section class="comments"><h3>Comentarios</h3>${data.comments.map((c) => `<div class="comment"><strong>${escapeHtml(c.userName)}</strong><p>${escapeHtml(c.body)}</p><small>${formatDate(c.createdAt)}</small></div>`).join("") || "<p class='muted'>Sem comentarios.</p>"}</section>
      <section class="timeline"><h3>Historico</h3>${data.events.map((e) => `<div class="event"><strong>${eventLabel(e.eventType)}</strong><p>${escapeHtml(e.details)}</p><small>${formatDate(e.createdAt)}</small></div>`).join("")}</section>
    </aside>`;
  const commentForm = $("#commentForm");
  if (commentForm) commentForm.addEventListener("submit", submitComment);
  const resolveForm = $("#resolveForm");
  if (resolveForm) resolveForm.addEventListener("submit", submitResolve);
  const palliativeForm = $("#palliativeForm");
  if (palliativeForm) palliativeForm.addEventListener("submit", submitPalliative);
}

function attendanceActionsHtml(ticket) {
  if (ticket.status === "em_atendimento") {
    return `<section class="status-actions">
      <h2>Alterar status</h2>
      <details><summary>Solucionado</summary>${resolveFormHtml()}</details>
      <details><summary>Solucionado de forma paliativa</summary>${palliativeFormHtml(ticket)}</details>
    </section>`;
  }
  if (ticket.status === "paliativo") {
    return `<section class="status-actions">
      <h2>Alterar status</h2>
      <details open><summary>Solucionado</summary>${resolveFormHtml()}</details>
    </section>`;
  }
  return "";
}

function resolveFormHtml() {
  return `<form id="resolveForm" class="form-grid">
    <label>Descricao da solucao<textarea name="comment" rows="4" required></textarea></label>
    <button class="primary" type="submit">Salvar como solucionado</button>
  </form>`;
}

function palliativeFormHtml(ticket) {
  return `<form id="palliativeForm" class="form-grid two">
    <label>Motivo<select name="palliativeReason" required><option value="">Selecione</option>${["aguardando_peca","aguardando_parada_maquina","aguardando_ferramenta","aguardando_informacao","causa_raiz_em_observacao","aguardando_acesso","aguardando_aprovacao","risco_operacional_para_intervencao","dependencia_de_terceiro","outros"].map((r) => `<option value="${r}" ${ticket.palliativeReason === r ? "selected" : ""}>${labels[r]}</option>`).join("")}</select></label>
    <label>Prazo<input name="palliativeDeadline" type="date" value="${escapeHtml(ticket.palliativeDeadline || "")}" required></label>
    <label class="wide">Descricao da solucao paliativa<textarea name="palliativePlan" rows="4" required>${escapeHtml(ticket.palliativePlan || "")}</textarea></label>
    <label class="wide">Outro motivo<input name="palliativeReasonOther" value="${escapeHtml(ticket.palliativeReasonOther || "")}"></label>
    <button class="primary" type="submit">Salvar solucao paliativa</button>
  </form>`;
}

function eventLabel(type) {
  return ({ created: "Criacao", updated: "Atualizacao", claimed: "Chamado assumido", comment: "Comentario" }[type] || type);
}

async function submitResolve(event) {
  event.preventDefault();
  setFormBusy(event.target, true, "Salvando...");
  try {
    const comment = new FormData(event.target).get("comment");
    await api("updateTicket", { id: selectedTicketId, status: "resolvido" });
    if (comment) await api("addComment", { ticketId: selectedTicketId, body: comment });
    await renderTicketDetail(selectedTicketId);
    await loadTickets();
  } catch (error) {
    alert(error.message);
  } finally {
    setFormBusy(event.target, false);
  }
}

async function submitPalliative(event) {
  event.preventDefault();
  setFormBusy(event.target, true, "Salvando...");
  try {
    await api("updateTicket", { id: selectedTicketId, status: "paliativo", ...Object.fromEntries(new FormData(event.target).entries()) });
    await renderTicketDetail(selectedTicketId);
    await loadTickets();
  } catch (error) {
    alert(error.message);
  } finally {
    setFormBusy(event.target, false);
  }
}

async function claimTicket(id) {
  try {
    await api("claimTicket", { id });
    await openAttendance(id);
    await loadTickets();
  } catch (error) {
    alert(error.message);
    await loadTickets();
  }
}

async function submitComment(event) {
  event.preventDefault();
  setFormBusy(event.target, true, "Comentando...");
  try {
    await api("addComment", { ticketId: selectedTicketId, body: new FormData(event.target).get("body") });
    await renderTicketDetail(selectedTicketId);
  } catch (error) {
    alert(error.message);
  } finally {
    setFormBusy(event.target, false);
  }
}

async function loadCompanies() {
  const data = await api("listCompanies");
  companies = data.companies;
  renderCompanySelects();
  const list = $("#companyList");
  if (list) list.innerHTML = companies.map((c) => `<article class="user-card"><strong>${escapeHtml(c.name)}</strong><div class="ticket-meta"><span>${escapeHtml(c.document || "-")}</span><span>${escapeHtml(c.contactName || "-")}</span><span>${c.active === "TRUE" || c.active === true ? "Ativa" : "Inativa"}</span></div></article>`).join("") || "<p class='muted'>Nenhuma empresa cadastrada.</p>";
}

async function ensureTicketFormData() {
  if (ticketFormDataLoaded) return;
  await Promise.all([loadCompanies(), loadFailureTypes()]);
  await loadLocations();
  ticketFormDataLoaded = true;
}

function renderCompanySelects() {
  const options = `<option value="">Selecione a empresa</option>` + companies.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
  ["userCompanySelect", "ticketCompanySelect", "locationCompanySelect"].forEach((id) => { if ($(`#${id}`)) $(`#${id}`).innerHTML = options; });
}

async function loadFailureTypes() {
  const data = await api("listFailureTypes");
  failureTypes = data.failureTypes;
  $("#ticketFailureSelect").innerHTML = `<option value="">Outros</option>` + failureTypes.map((f) => `<option value="${f.id}">${escapeHtml(f.name)}</option>`).join("");
  syncFailureOtherVisibility();
  const list = $("#failureTypeList");
  if (list) list.innerHTML = failureTypes.map((f) => `<article class="user-card"><strong>${escapeHtml(f.name)}</strong><div class="ticket-meta"><span>${escapeHtml(f.description || "-")}</span></div></article>`).join("");
}

async function loadLocations() {
  const companyId = currentUser?.role === "admin" ? ($("#ticketCompanySelect").value || $("#locationCompanySelect").value || "") : currentUser?.companyId;
  const data = await api("listLocations", { companyId });
  locations = data.locations;
  $("#ticketLocationSelect").innerHTML = `<option value="">Selecione o local</option>` + locations.map((l) => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join("");
  const list = $("#locationList");
  if (list) list.innerHTML = locations.map((l) => `<article class="user-card"><strong>${escapeHtml(l.name)}</strong><div class="ticket-meta"><span>${escapeHtml(l.companyName || "")}</span><span>${escapeHtml(l.description || "-")}</span></div></article>`).join("") || "<p class='muted'>Nenhum local cadastrado.</p>";
}

async function loadAssignableUsers() {
  if (currentUser.role === "solicitante") return;
  const data = await api("listUsers");
  users = data.users;
}

async function loadUsers() {
  const data = await api("listUsers");
  users = data.users;
  $("#userList").innerHTML = users.map((u) => `<article class="user-card"><strong>${escapeHtml(u.name)}</strong><div class="ticket-meta"><span>${escapeHtml(u.email)}</span><span class="badge">${labels[u.role]}</span><span>${escapeHtml(u.companyName || "Global")}</span><span>${u.active === "TRUE" || u.active === true ? "Ativo" : "Inativo"}</span></div></article>`).join("");
}

function fileToPayload(file) {
  return new Promise((resolve, reject) => {
    if (file.size > 4 * 1024 * 1024) {
      reject(new Error(`A foto ${file.name} passa de 4 MB. Reduza a imagem antes de enviar.`));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, mimeType: file.type, size: file.size, data: String(reader.result).split(",")[1] });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#loginError").textContent = "";
  setFormBusy(event.target, true, "Validando credenciais...");
  try {
    const data = await api("login", Object.fromEntries(new FormData(event.target).entries()));
    await afterLogin(data.user, data.token);
  } catch (error) {
    $("#loginError").textContent = error.message;
  } finally {
    setFormBusy(event.target, false);
  }
});

$("#logoutBtn").addEventListener("click", () => {
  token = "";
  ticketFormDataLoaded = false;
  localStorage.removeItem("chamadosToken");
  $("#appView").classList.add("hidden");
  $("#loginView").classList.remove("hidden");
});

$$(".nav").forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
$$("[data-view-jump]").forEach((button) => button.addEventListener("click", () => showView(button.dataset.viewJump)));
["searchInput", "statusFilter", "typeFilter"].forEach((id) => $(`#${id}`).addEventListener("input", loadTickets));
["dashboardKind", "reportStart", "reportEnd", "reportBucket"].forEach((id) => $(`#${id}`).addEventListener("input", loadDashboardChart));
$("#ticketCompanySelect").addEventListener("change", loadLocations);
$("#locationCompanySelect").addEventListener("change", loadLocations);
$("#ticketFailureSelect").addEventListener("change", syncFailureOtherVisibility);

$("#ticketForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("#ticketFormMessage", "Cadastrando chamado...");
  setFormBusy(event.target, true, "Cadastrando chamado...");
  try {
    const form = new FormData(event.target);
    const photos = await Promise.all([...form.getAll("photos")].filter((file) => file.size).map(fileToPayload));
    const fields = Object.fromEntries(form.entries());
    delete fields.photos;
    const data = await api("createTicket", { ticket: fields, photos });
    event.target.reset();
    syncFailureOtherVisibility();
    setMessage("#ticketFormMessage", `Chamado ${data.protocol} registrado.`);
    if (currentUser.role !== "solicitante") await loadDashboard();
  } catch (error) {
    setMessage("#ticketFormMessage", error.message, true);
  } finally {
    setFormBusy(event.target, false);
  }
});

$("#companyForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("#companyFormMessage", "Criando empresa...");
  setFormBusy(event.target, true, "Criando empresa...");
  try {
    await api("createCompany", Object.fromEntries(new FormData(event.target).entries()));
    event.target.reset();
    setMessage("#companyFormMessage", "Empresa criada.");
    await loadCompanies();
  } catch (error) {
    setMessage("#companyFormMessage", error.message, true);
  } finally {
    setFormBusy(event.target, false);
  }
});

$("#failureTypeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("#failureTypeFormMessage", "Criando falha...");
  setFormBusy(event.target, true, "Criando falha...");
  try {
    await api("createFailureType", Object.fromEntries(new FormData(event.target).entries()));
    event.target.reset();
    setMessage("#failureTypeFormMessage", "Falha criada.");
    await loadFailureTypes();
  } catch (error) {
    setMessage("#failureTypeFormMessage", error.message, true);
  } finally {
    setFormBusy(event.target, false);
  }
});

$("#locationForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("#locationFormMessage", "Criando novo local...");
  setFormBusy(event.target, true, "Criando local...");
  try {
    await api("createLocation", Object.fromEntries(new FormData(event.target).entries()));
    event.target.reset();
    setMessage("#locationFormMessage", "Local criado.");
    await loadLocations();
  } catch (error) {
    setMessage("#locationFormMessage", error.message, true);
  } finally {
    setFormBusy(event.target, false);
  }
});

$("#userForm [name='role']").addEventListener("change", (event) => {
  const isAdmin = event.target.value === "admin";
  $("#userCompanyField").classList.toggle("hidden", isAdmin);
  $("#userCompanySelect").required = !isAdmin;
});

$("#userForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("#userFormMessage", "Criando usuario...");
  setFormBusy(event.target, true, "Criando usuario...");
  try {
    await api("createUser", Object.fromEntries(new FormData(event.target).entries()));
    event.target.reset();
    setMessage("#userFormMessage", "Usuario criado.");
    await loadUsers();
  } catch (error) {
    setMessage("#userFormMessage", error.message, true);
  } finally {
    setFormBusy(event.target, false);
  }
});
