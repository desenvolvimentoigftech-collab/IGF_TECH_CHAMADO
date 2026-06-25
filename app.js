const labels = {
  falha: "Falha", intervencao: "Intervencao", instalacao: "Instalacao", remocao: "Remocao",
  baixa: "Baixa", media: "Media", alta: "Alta", critica: "Critica",
  aberto: "Aberto", em_atendimento: "Em atendimento", resolvido: "Resolvido", paliativo: "Paliativo", equipamento_condenado: "Equipamento condenado",
  aguardando_peca: "Aguardando peca", aguardando_parada_maquina: "Aguardando parada da maquina", aguardando_ferramenta: "Aguardando ferramenta",
  aguardando_informacao: "Aguardando informacao", causa_raiz_em_observacao: "Causa raiz em estudo/observacao", aguardando_acesso: "Aguardando acesso",
  aguardando_aprovacao: "Aguardando aprovacao", risco_operacional_para_intervencao: "Risco operacional para intervencao", dependencia_de_terceiro: "Dependencia de terceiro", outros: "Outros",
  admin: "Administrador", gestor: "Gestor", tecnico: "Tecnico", solicitante: "Solicitante"
};

const DEFAULT_API_URL = "https://script.google.com/macros/s/AKfycbzR7Ofl7zp4TTmsqh8xiLmNSAA1AxUp6x4pMWrk6pBZvc2ZMsiu8rLFlNh2wPhxFxt4/exec";

let apiUrl = localStorage.getItem("chamadosApiUrl") || DEFAULT_API_URL;
let token = localStorage.getItem("chamadosToken") || "";
let currentUser = null;
let users = [];
let companies = [];
let failureTypes = [];
let locations = [];
let selectedTicketId = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
$("#apiUrl").value = apiUrl;

async function api(action, data = {}) {
  apiUrl = $("#apiUrl").value.trim() || apiUrl;
  if (!apiUrl) throw new Error("Informe a URL do Web App Apps Script.");
  localStorage.setItem("chamadosApiUrl", apiUrl);
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

function showView(id) {
  $$(".view").forEach((view) => view.classList.toggle("hidden", view.id !== id));
  $$(".nav").forEach((button) => button.classList.toggle("active", button.dataset.view === id));
  if (id === "dashboard") loadDashboard();
  if (id === "tickets") loadTickets();
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
  $$(".nav[data-view='dashboard'], .nav[data-view='tickets']").forEach((el) => el.classList.toggle("hidden", currentUser.role === "solicitante"));
  $("#ticketCompanySelect").required = currentUser.role === "admin";
  $("#locationCompanySelect").required = currentUser.role === "admin";
}

async function afterLogin(user, newToken) {
  currentUser = user;
  token = newToken || token;
  localStorage.setItem("chamadosToken", token);
  $("#loginView").classList.add("hidden");
  $("#appView").classList.remove("hidden");
  applyRoleUi();
  await Promise.all([loadCompanies(), loadFailureTypes(), loadLocations(), loadAssignableUsers()]);
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
  const data = await api("listTickets", { q: $("#searchInput").value.trim(), status: $("#statusFilter").value, type: $("#typeFilter").value });
  $("#ticketList").innerHTML = data.tickets.map(ticketCard).join("") || "<p class='muted'>Nenhum chamado encontrado.</p>";
}

function ticketCard(ticket) {
  return `<article class="ticket-card"><div><span class="badge">${ticket.protocol}</span><h3>${escapeHtml(ticket.title)}</h3><div class="ticket-meta"><span>${labels[ticket.type]}</span><span>${escapeHtml(ticket.failureTypeName || ticket.failureOther || "Falha nao classificada")}</span><span>${escapeHtml(ticket.companyName || "")}</span><span class="badge ${ticket.priority}">${labels[ticket.priority]}</span><span class="badge ${ticket.status}">${labels[ticket.status]}</span><span>${escapeHtml(ticket.locationName || "")}</span><span>${ticket.attachmentCount || 0} evidencia(s)</span></div></div><button class="primary" type="button" onclick="openTicket('${ticket.id}')">Detalhes</button></article>`;
}

async function openTicket(id) {
  selectedTicketId = id;
  const data = await api("getTicket", { id });
  const ticket = data.ticket;
  $("#detailProtocol").textContent = ticket.protocol;
  $("#detailTitle").textContent = ticket.title;
  const canManage = ["admin", "gestor", "tecnico"].includes(currentUser.role);
  $("#ticketDetail").innerHTML = `
    <section class="facts">
      <div class="fact"><span>Status</span><strong>${labels[ticket.status]}</strong></div>
      <div class="fact"><span>Tipo</span><strong>${labels[ticket.type]}</strong></div>
      <div class="fact"><span>Falha</span><strong>${escapeHtml(ticket.failureTypeName || ticket.failureOther || "-")}</strong></div>
      <div class="fact"><span>Local</span><strong>${escapeHtml(ticket.locationName || "-")}</strong></div>
      <div class="fact"><span>Serie</span><strong>${escapeHtml(ticket.serialNumber || "-")}</strong></div>
      <div class="fact"><span>Empresa</span><strong>${escapeHtml(ticket.companyName || "-")}</strong></div>
      <div class="fact"><span>Tecnico</span><strong>${escapeHtml(ticket.assigneeName || "-")}</strong></div>
      <div class="fact"><span>Criado em</span><strong>${formatDate(ticket.createdAt)}</strong></div>
      ${ticket.status === "paliativo" ? `<div class="fact"><span>Motivo</span><strong>${labels[ticket.palliativeReason] || ticket.palliativeReason}</strong></div><div class="fact"><span>Plano</span><strong>${escapeHtml(ticket.palliativePlan || "-")}</strong></div><div class="fact"><span>Prazo</span><strong>${escapeHtml(ticket.palliativeDeadline || "-")}</strong></div>` : ""}
      <p>${escapeHtml(ticket.description)}</p>
      ${canManage ? manageHtml(ticket) : ""}
      ${canManage ? `<form id="commentForm" class="form-grid"><label>Comentario<textarea name="body" rows="3" required></textarea></label><button class="primary" type="submit">Adicionar comentario</button></form>` : ""}
    </section>
    <aside class="facts">
      <section class="photos"><h3>Evidencias</h3><div class="photo-grid">${data.attachments.map((a) => `<a href="${a.url}" target="_blank"><img src="${a.url}" alt="${escapeHtml(a.fileName)}"></a>`).join("") || "<p class='muted'>Nenhuma foto anexada.</p>"}</div></section>
      <section class="comments"><h3>Comentarios</h3>${data.comments.map((c) => `<div class="comment"><strong>${escapeHtml(c.userName)}</strong><p>${escapeHtml(c.body)}</p><small>${formatDate(c.createdAt)}</small></div>`).join("") || "<p class='muted'>Sem comentarios.</p>"}</section>
      <section class="timeline"><h3>Historico</h3>${data.events.map((e) => `<div class="event"><strong>${escapeHtml(e.eventType)}</strong><p>${escapeHtml(e.details)}</p><small>${formatDate(e.createdAt)}</small></div>`).join("")}</section>
    </aside>`;
  const commentForm = $("#commentForm");
  if (commentForm) commentForm.addEventListener("submit", submitComment);
  const manageForm = $("#manageForm");
  if (manageForm) manageForm.addEventListener("submit", submitManage);
  if (!$("#ticketDialog").open) $("#ticketDialog").showModal();
}

function manageHtml(ticket) {
  const techOptions = users.filter((u) => u.role === "tecnico" && u.companyId === ticket.companyId).map((u) => `<option value="${u.id}" ${ticket.assigneeId === u.id ? "selected" : ""}>${escapeHtml(u.name)}</option>`).join("");
  return `<form id="manageForm" class="action-grid">
    <label>Status<select name="status">${["aberto","em_atendimento","resolvido","paliativo","equipamento_condenado"].map((s) => `<option value="${s}" ${ticket.status === s ? "selected" : ""}>${labels[s]}</option>`).join("")}</select></label>
    <label>Prioridade<select name="priority">${["baixa","media","alta","critica"].map((p) => `<option value="${p}" ${ticket.priority === p ? "selected" : ""}>${labels[p]}</option>`).join("")}</select></label>
    <label>Tecnico<select name="assigneeId"><option value="">Nao atribuido</option>${techOptions}</select></label>
    <label>Motivo paliativo<select name="palliativeReason"><option value="">Selecione</option>${["aguardando_peca","aguardando_parada_maquina","aguardando_ferramenta","aguardando_informacao","causa_raiz_em_observacao","aguardando_acesso","aguardando_aprovacao","risco_operacional_para_intervencao","dependencia_de_terceiro","outros"].map((r) => `<option value="${r}" ${ticket.palliativeReason === r ? "selected" : ""}>${labels[r]}</option>`).join("")}</select></label>
    <label>Outro motivo<input name="palliativeReasonOther" value="${escapeHtml(ticket.palliativeReasonOther || "")}"></label>
    <label>Plano<textarea name="palliativePlan" rows="3">${escapeHtml(ticket.palliativePlan || "")}</textarea></label>
    <label>Prazo<input name="palliativeDeadline" type="date" value="${escapeHtml(ticket.palliativeDeadline || "")}"></label>
    <button class="primary" type="submit">Atualizar</button>
  </form>`;
}

async function submitManage(event) {
  event.preventDefault();
  await api("updateTicket", { id: selectedTicketId, ...Object.fromEntries(new FormData(event.target).entries()) });
  await openTicket(selectedTicketId);
  await loadTickets();
  await loadDashboard();
}

async function submitComment(event) {
  event.preventDefault();
  await api("addComment", { ticketId: selectedTicketId, body: new FormData(event.target).get("body") });
  await openTicket(selectedTicketId);
}

async function loadCompanies() {
  const data = await api("listCompanies");
  companies = data.companies;
  renderCompanySelects();
  const list = $("#companyList");
  if (list) list.innerHTML = companies.map((c) => `<article class="user-card"><strong>${escapeHtml(c.name)}</strong><div class="ticket-meta"><span>${escapeHtml(c.document || "-")}</span><span>${escapeHtml(c.contactName || "-")}</span><span>${c.active === "TRUE" || c.active === true ? "Ativa" : "Inativa"}</span></div></article>`).join("") || "<p class='muted'>Nenhuma empresa cadastrada.</p>";
}

function renderCompanySelects() {
  const options = `<option value="">Selecione a empresa</option>` + companies.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
  ["userCompanySelect", "ticketCompanySelect", "locationCompanySelect"].forEach((id) => { if ($(`#${id}`)) $(`#${id}`).innerHTML = options; });
}

async function loadFailureTypes() {
  const data = await api("listFailureTypes");
  failureTypes = data.failureTypes;
  $("#ticketFailureSelect").innerHTML = `<option value="">Outros</option>` + failureTypes.map((f) => `<option value="${f.id}">${escapeHtml(f.name)}</option>`).join("");
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
  try {
    const data = await api("login", Object.fromEntries(new FormData(event.target).entries()));
    await afterLogin(data.user, data.token);
  } catch (error) {
    $("#loginError").textContent = error.message;
  }
});

$("#logoutBtn").addEventListener("click", () => {
  token = "";
  localStorage.removeItem("chamadosToken");
  $("#appView").classList.add("hidden");
  $("#loginView").classList.remove("hidden");
});

$$(".nav").forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
$$("[data-view-jump]").forEach((button) => button.addEventListener("click", () => showView(button.dataset.viewJump)));
$("#closeDialog").addEventListener("click", () => $("#ticketDialog").close());
["searchInput", "statusFilter", "typeFilter"].forEach((id) => $(`#${id}`).addEventListener("input", loadTickets));
["dashboardKind", "reportStart", "reportEnd", "reportBucket"].forEach((id) => $(`#${id}`).addEventListener("input", loadDashboardChart));
$("#ticketCompanySelect").addEventListener("change", loadLocations);
$("#locationCompanySelect").addEventListener("change", loadLocations);

$("#ticketForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#ticketFormMessage").textContent = "Enviando...";
  try {
    const form = new FormData(event.target);
    const photos = await Promise.all([...form.getAll("photos")].filter((file) => file.size).map(fileToPayload));
    const fields = Object.fromEntries(form.entries());
    delete fields.photos;
    const data = await api("createTicket", { ticket: fields, photos });
    event.target.reset();
    $("#ticketFormMessage").textContent = `Chamado ${data.protocol} registrado.`;
    if (currentUser.role !== "solicitante") await loadDashboard();
  } catch (error) {
    $("#ticketFormMessage").textContent = error.message;
  }
});

$("#companyForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  await api("createCompany", Object.fromEntries(new FormData(event.target).entries()));
  event.target.reset();
  $("#companyFormMessage").textContent = "Empresa criada.";
  await loadCompanies();
});

$("#failureTypeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  await api("createFailureType", Object.fromEntries(new FormData(event.target).entries()));
  event.target.reset();
  $("#failureTypeFormMessage").textContent = "Falha criada.";
  await loadFailureTypes();
});

$("#locationForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  await api("createLocation", Object.fromEntries(new FormData(event.target).entries()));
  event.target.reset();
  $("#locationFormMessage").textContent = "Local criado.";
  await loadLocations();
});

$("#userForm [name='role']").addEventListener("change", (event) => {
  const isAdmin = event.target.value === "admin";
  $("#userCompanyField").classList.toggle("hidden", isAdmin);
  $("#userCompanySelect").required = !isAdmin;
});

$("#userForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  await api("createUser", Object.fromEntries(new FormData(event.target).entries()));
  event.target.reset();
  $("#userFormMessage").textContent = "Usuario criado.";
  await loadUsers();
});
