const CONFIG = {
  SPREADSHEET_ID: '',
  EVIDENCE_FOLDER_ID: '',
  SETUP_KEY: 'troque-esta-chave',
  INITIAL_ADMIN_EMAIL: 'admin@sistema.local',
  INITIAL_ADMIN_PASSWORD: 'admin123',
  SESSION_SECONDS: 21600
};

const SHEETS = {
  companies: ['id','name','document','contactName','contactEmail','contactPhone','active','createdAt','updatedAt'],
  users: ['id','name','email','role','companyId','department','phone','passwordSalt','passwordHash','active','createdAt','updatedAt'],
  failure_types: ['id','name','description','active','createdAt','updatedAt'],
  locations: ['id','companyId','name','description','active','createdAt','updatedAt'],
  tickets: ['id','protocol','companyId','type','title','description','priority','status','failureTypeId','failureOther','locationId','serialNumber','equipmentName','locationComplement','requesterId','assigneeId','palliativeReason','palliativeReasonOther','palliativePlan','palliativeDeadline','createdAt','updatedAt','resolvedAt'],
  attachments: ['id','ticketId','fileName','mimeType','sizeBytes','driveFileId','url','uploadedBy','createdAt'],
  comments: ['id','ticketId','userId','body','createdAt'],
  events: ['id','ticketId','userId','eventType','details','createdAt']
};

const ROLES = ['admin','gestor','tecnico','solicitante'];
const STATUSES = ['aberto','em_atendimento','resolvido','paliativo','equipamento_condenado'];
const TICKET_TYPES = ['falha','intervencao','instalacao','remocao'];
const PRIORITIES = ['baixa','media','alta','critica'];
const PALLIATIVE_REASONS = ['aguardando_peca','aguardando_parada_maquina','aguardando_ferramenta','aguardando_informacao','causa_raiz_em_observacao','aguardando_acesso','aguardando_aprovacao','risco_operacional_para_intervencao','dependencia_de_terceiro','outros'];

function doPost(e) {
  try {
    const body = JSON.parse(e.postData && e.postData.contents ? e.postData.contents : '{}');
    const result = route(body);
    return json({ ok: true, ...result });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function doGet() {
  return json({ ok: true, name: 'Sistema de Chamados Apps Script API' });
}

function json(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

function route(body) {
  if (body.action === 'setup') return setup(body.setupKey);
  if (body.action === 'login') return login(body.email, body.password);
  const user = requireUser(body.token);
  switch (body.action) {
    case 'me': return { user: publicUser(user) };
    case 'listCompanies': return { companies: listCompanies(user) };
    case 'createCompany': return createCompany(user, body);
    case 'listFailureTypes': return { failureTypes: activeRows('failure_types') };
    case 'createFailureType': return createFailureType(user, body);
    case 'listLocations': return { locations: listLocations(user, body.companyId) };
    case 'createLocation': return createLocation(user, body);
    case 'listUsers': return { users: listUsers(user) };
    case 'createUser': return createUser(user, body);
    case 'createTicket': return createTicket(user, body.ticket || {}, body.photos || []);
    case 'listTickets': return { tickets: listTickets(user, body) };
    case 'getTicket': return getTicket(user, body.id);
    case 'updateTicket': return updateTicket(user, body);
    case 'addComment': return addComment(user, body);
    case 'dashboard': return dashboard(user);
    case 'reportFailures': return { items: reportFailures(user, body) };
    case 'reportOccurrences': return { items: reportOccurrences(user, body) };
    case 'exportAll': return exportAll(user);
    default: throw new Error('Acao invalida.');
  }
}

function setupManual() {
  return setup(CONFIG.SETUP_KEY);
}

function setup(setupKey) {
  if (setupKey !== CONFIG.SETUP_KEY) throw new Error('Chave de setup invalida.');
  const ss = spreadsheet();
  Object.keys(SHEETS).forEach((name) => ensureSheet(ss, name, SHEETS[name]));
  seedFailureTypes();
  const users = rows('users');
  if (!users.length) {
    const salt = uuid();
    append('users', {
      id: uuid(), name: 'Administrador', email: CONFIG.INITIAL_ADMIN_EMAIL.toLowerCase(), role: 'admin',
      companyId: '', department: 'TI', phone: '', passwordSalt: salt, passwordHash: hash(CONFIG.INITIAL_ADMIN_PASSWORD, salt),
      active: true, createdAt: now(), updatedAt: now()
    });
  }
  const folder = evidenceFolder();
  return { spreadsheetUrl: ss.getUrl(), evidenceFolderUrl: folder.getUrl() };
}

function spreadsheet() {
  if (CONFIG.SPREADSHEET_ID) return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) throw new Error('Informe CONFIG.SPREADSHEET_ID ou vincule o script a uma planilha.');
  return active;
}

function ensureSheet(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  const current = sheet.getRange(1, 1, 1, Math.max(headers.length, sheet.getLastColumn() || 1)).getValues()[0];
  headers.forEach((header, index) => {
    if (current[index] !== header) sheet.getRange(1, index + 1).setValue(header);
  });
  sheet.setFrozenRows(1);
}

function sheet(name) {
  const s = spreadsheet().getSheetByName(name);
  if (!s) throw new Error('Aba ausente: ' + name + '. Execute setup.');
  return s;
}

function rows(name) {
  const s = sheet(name);
  const values = s.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1).filter((r) => r.some((v) => v !== '')).map((r, i) => {
    const item = { _row: i + 2 };
    headers.forEach((h, idx) => item[h] = r[idx]);
    return item;
  });
}

function append(name, object) {
  const headers = SHEETS[name];
  sheet(name).appendRow(headers.map((h) => object[h] === undefined ? '' : object[h]));
  return object;
}

function updateRow(name, rowNumber, patch) {
  const headers = SHEETS[name];
  const s = sheet(name);
  const current = s.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
  const next = headers.map((h, i) => patch[h] === undefined ? current[i] : patch[h]);
  s.getRange(rowNumber, 1, 1, headers.length).setValues([next]);
}

function uuid() {
  return Utilities.getUuid();
}

function now() {
  return new Date().toISOString();
}

function hash(password, salt) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + password);
  return bytes.map((b) => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

function login(email, password) {
  const user = rows('users').find((u) => String(u.email).toLowerCase() === String(email || '').toLowerCase() && truthy(u.active));
  if (!user || user.passwordHash !== hash(password || '', user.passwordSalt)) throw new Error('Email ou senha invalidos.');
  const token = Utilities.getUuid() + Utilities.getUuid();
  CacheService.getScriptCache().put('session:' + token, user.id, CONFIG.SESSION_SECONDS);
  return { token, user: publicUser(user) };
}

function requireUser(token) {
  const id = CacheService.getScriptCache().get('session:' + token);
  if (!id) throw new Error('Sessao expirada.');
  const user = rows('users').find((u) => u.id === id && truthy(u.active));
  if (!user) throw new Error('Usuario inativo.');
  return user;
}

function publicUser(user) {
  const company = user.companyId ? rows('companies').find((c) => c.id === user.companyId) : null;
  return {
    id: user.id, name: user.name, email: user.email, role: user.role, companyId: user.companyId || '',
    companyName: company ? company.name : '', department: user.department || '', phone: user.phone || '', active: truthy(user.active)
  };
}

function requireRole(user, roles) {
  if (!roles.includes(user.role)) throw new Error('Sem permissao.');
}

function truthy(value) {
  return value === true || value === 'TRUE' || value === 'true' || value === 1 || value === '1';
}

function listCompanies(user) {
  const all = activeRows('companies');
  return user.role === 'admin' ? all : all.filter((c) => c.id === user.companyId);
}

function createCompany(user, body) {
  requireRole(user, ['admin']);
  if (!body.name) throw new Error('Nome da empresa obrigatorio.');
  if (rows('companies').some((c) => String(c.name).toLowerCase() === String(body.name).toLowerCase())) throw new Error('Empresa ja cadastrada.');
  const item = append('companies', { id: uuid(), name: body.name, document: body.document || '', contactName: body.contactName || '', contactEmail: body.contactEmail || '', contactPhone: body.contactPhone || '', active: true, createdAt: now(), updatedAt: now() });
  return { id: item.id };
}

function activeRows(name) {
  return rows(name).filter((r) => truthy(r.active));
}

function seedFailureTypes() {
  const existing = rows('failure_types').map((f) => String(f.name).toLowerCase());
  ['Sem alimentacao','Sem comunicacao','Falha intermitente','Dano fisico','Mau funcionamento mecanico','Mau funcionamento eletrico','Erro de configuracao','Baixo desempenho','Leitura/sinal inconsistente','Superaquecimento','Ruido ou interferencia'].forEach((name) => {
    if (!existing.includes(name.toLowerCase())) append('failure_types', { id: uuid(), name, description: '', active: true, createdAt: now(), updatedAt: now() });
  });
}

function createFailureType(user, body) {
  requireRole(user, ['admin']);
  if (!body.name) throw new Error('Nome da falha obrigatorio.');
  const item = append('failure_types', { id: uuid(), name: body.name, description: body.description || '', active: true, createdAt: now(), updatedAt: now() });
  return { id: item.id };
}

function listLocations(user, companyId) {
  const cid = user.role === 'admin' ? (companyId || '') : user.companyId;
  if (!cid) return [];
  const companies = rows('companies');
  return activeRows('locations').filter((l) => l.companyId === cid).map((l) => ({ ...l, companyName: (companies.find((c) => c.id === l.companyId) || {}).name || '' }));
}

function createLocation(user, body) {
  requireRole(user, ['admin','gestor']);
  const companyId = user.role === 'admin' ? body.companyId : user.companyId;
  if (!companyId || !body.name) throw new Error('Empresa e nome do local sao obrigatorios.');
  const item = append('locations', { id: uuid(), companyId, name: body.name, description: body.description || '', active: true, createdAt: now(), updatedAt: now() });
  return { id: item.id };
}

function listUsers(user) {
  requireRole(user, ['admin','gestor','tecnico']);
  const companies = rows('companies');
  return rows('users')
    .filter((u) => user.role === 'admin' || u.companyId === user.companyId)
    .filter((u) => user.role !== 'tecnico' || u.role === 'tecnico')
    .map((u) => ({ ...publicUser(u), companyName: (companies.find((c) => c.id === u.companyId) || {}).name || '' }));
}

function createUser(user, body) {
  requireRole(user, ['admin']);
  if (!body.name || !body.email || !ROLES.includes(body.role) || !body.password || String(body.password).length < 6) throw new Error('Dados do usuario invalidos.');
  let companyId = body.role === 'admin' ? '' : body.companyId;
  if (body.role !== 'admin' && !companyId) throw new Error('Empresa obrigatoria.');
  if (rows('users').some((u) => String(u.email).toLowerCase() === String(body.email).toLowerCase())) throw new Error('Email ja cadastrado.');
  const salt = uuid();
  const item = append('users', { id: uuid(), name: body.name, email: String(body.email).toLowerCase(), role: body.role, companyId, department: body.department || '', phone: body.phone || '', passwordSalt: salt, passwordHash: hash(body.password, salt), active: true, createdAt: now(), updatedAt: now() });
  return { id: item.id };
}

function createTicket(user, ticket, photos) {
  if (!TICKET_TYPES.includes(ticket.type) || !PRIORITIES.includes(ticket.priority)) throw new Error('Tipo ou prioridade invalida.');
  const companyId = user.role === 'admin' ? ticket.companyId : user.companyId;
  if (!companyId) throw new Error('Empresa obrigatoria.');
  if (!ticket.title || !ticket.description || !ticket.serialNumber || !ticket.locationId) throw new Error('Titulo, descricao, serie e local sao obrigatorios.');
  if (!ticket.failureTypeId && !ticket.failureOther) throw new Error('Escolha uma falha ou informe outros.');
  if (ticket.failureTypeId && !activeRows('failure_types').some((f) => f.id === ticket.failureTypeId)) throw new Error('Falha invalida.');
  if (!activeRows('locations').some((l) => l.id === ticket.locationId && l.companyId === companyId)) throw new Error('Local invalido.');
  const protocol = nextProtocol();
  const item = append('tickets', {
    id: uuid(), protocol, companyId, type: ticket.type, title: ticket.title, description: ticket.description,
    priority: ticket.priority, status: 'aberto', failureTypeId: ticket.failureTypeId || '', failureOther: ticket.failureOther || '',
    locationId: ticket.locationId, serialNumber: ticket.serialNumber, equipmentName: ticket.equipmentName || '',
    locationComplement: ticket.locationComplement || '', requesterId: user.id, assigneeId: '',
    palliativeReason: '', palliativeReasonOther: '', palliativePlan: '', palliativeDeadline: '',
    createdAt: now(), updatedAt: now(), resolvedAt: ''
  });
  append('events', { id: uuid(), ticketId: item.id, userId: user.id, eventType: 'created', details: 'Chamado ' + protocol + ' aberto.', createdAt: now() });
  savePhotos(item, user, photos || []);
  return { id: item.id, protocol };
}

function nextProtocol() {
  const year = new Date().getFullYear();
  const total = rows('tickets').filter((t) => String(t.protocol).indexOf('CH-' + year + '-') === 0).length + 1;
  return 'CH-' + year + '-' + String(total).padStart(5, '0');
}

function evidenceFolder() {
  if (CONFIG.EVIDENCE_FOLDER_ID) return DriveApp.getFolderById(CONFIG.EVIDENCE_FOLDER_ID);
  const props = PropertiesService.getScriptProperties();
  const existing = props.getProperty('EVIDENCE_FOLDER_ID');
  if (existing) return DriveApp.getFolderById(existing);
  const folder = DriveApp.createFolder('Sistema Chamados - Evidencias');
  props.setProperty('EVIDENCE_FOLDER_ID', folder.getId());
  return folder;
}

function savePhotos(ticket, user, photos) {
  if (!photos.length) return;
  const root = evidenceFolder();
  const folder = root.createFolder(ticket.protocol + ' - ' + ticket.id);
  photos.forEach((photo) => {
    const bytes = Utilities.base64Decode(photo.data);
    const blob = Utilities.newBlob(bytes, photo.mimeType || 'application/octet-stream', photo.name || 'evidencia');
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    append('attachments', { id: uuid(), ticketId: ticket.id, fileName: file.getName(), mimeType: photo.mimeType || '', sizeBytes: photo.size || bytes.length, driveFileId: file.getId(), url: file.getUrl(), uploadedBy: user.id, createdAt: now() });
  });
}

function scopedTickets(user) {
  if (user.role === 'solicitante') throw new Error('Solicitante pode apenas abrir chamados.');
  return rows('tickets').filter((t) => user.role === 'admin' || t.companyId === user.companyId);
}

function enrichTicket(t) {
  const companies = rows('companies'), failures = rows('failure_types'), locs = rows('locations'), us = rows('users'), at = rows('attachments');
  return {
    ...t,
    companyName: (companies.find((c) => c.id === t.companyId) || {}).name || '',
    failureTypeName: (failures.find((f) => f.id === t.failureTypeId) || {}).name || '',
    locationName: (locs.find((l) => l.id === t.locationId) || {}).name || '',
    requesterName: (us.find((u) => u.id === t.requesterId) || {}).name || '',
    assigneeName: (us.find((u) => u.id === t.assigneeId) || {}).name || '',
    attachmentCount: at.filter((a) => a.ticketId === t.id).length
  };
}

function listTickets(user, body) {
  let list = scopedTickets(user).map(enrichTicket);
  if (body.status) list = list.filter((t) => t.status === body.status);
  if (body.type) list = list.filter((t) => t.type === body.type);
  if (body.q) {
    const q = String(body.q).toLowerCase();
    list = list.filter((t) => [t.protocol,t.title,t.serialNumber,t.locationName,t.companyName].join(' ').toLowerCase().includes(q));
  }
  return list.sort((a,b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 300);
}

function getTicket(user, id) {
  const ticket = enrichTicket(scopedTickets(user).find((t) => t.id === id) || {});
  if (!ticket.id) throw new Error('Chamado nao encontrado.');
  const us = rows('users');
  return {
    ticket,
    attachments: rows('attachments').filter((a) => a.ticketId === id),
    comments: rows('comments').filter((c) => c.ticketId === id).map((c) => ({ ...c, userName: (us.find((u) => u.id === c.userId) || {}).name || '' })),
    events: rows('events').filter((e) => e.ticketId === id).map((e) => ({ ...e, userName: (us.find((u) => u.id === e.userId) || {}).name || '' }))
  };
}

function updateTicket(user, body) {
  requireRole(user, ['admin','gestor','tecnico']);
  const all = rows('tickets');
  const old = all.find((t) => t.id === body.id);
  if (!old || (user.role !== 'admin' && old.companyId !== user.companyId)) throw new Error('Chamado nao encontrado.');
  if (user.role === 'tecnico' && old.assigneeId && old.assigneeId !== user.id) throw new Error('Tecnico so altera chamados atribuidos a ele.');
  if (body.status && !STATUSES.includes(body.status)) throw new Error('Status invalido.');
  if (body.priority && !PRIORITIES.includes(body.priority)) throw new Error('Prioridade invalida.');
  const nextStatus = body.status || old.status;
  if (nextStatus === 'paliativo') {
    const reason = body.palliativeReason || old.palliativeReason;
    const plan = body.palliativePlan || old.palliativePlan;
    const deadline = body.palliativeDeadline || old.palliativeDeadline;
    if (!PALLIATIVE_REASONS.includes(reason) || !plan || !deadline) throw new Error('Para paliativo, informe motivo, plano e prazo.');
    if (reason === 'outros' && !(body.palliativeReasonOther || old.palliativeReasonOther)) throw new Error('Descreva o motivo outros.');
  }
  updateRow('tickets', old._row, {
    status: body.status || old.status, priority: body.priority || old.priority, assigneeId: body.assigneeId || '',
    palliativeReason: body.palliativeReason || old.palliativeReason, palliativeReasonOther: body.palliativeReasonOther || old.palliativeReasonOther,
    palliativePlan: body.palliativePlan || old.palliativePlan, palliativeDeadline: body.palliativeDeadline || old.palliativeDeadline,
    updatedAt: now(), resolvedAt: ['resolvido','equipamento_condenado'].includes(nextStatus) ? now() : old.resolvedAt
  });
  append('events', { id: uuid(), ticketId: old.id, userId: user.id, eventType: 'updated', details: 'Chamado atualizado.', createdAt: now() });
  return { ok: true };
}

function addComment(user, body) {
  requireRole(user, ['admin','gestor','tecnico']);
  const ticket = scopedTickets(user).find((t) => t.id === body.ticketId);
  if (!ticket) throw new Error('Chamado nao encontrado.');
  append('comments', { id: uuid(), ticketId: ticket.id, userId: user.id, body: body.body || '', createdAt: now() });
  append('events', { id: uuid(), ticketId: ticket.id, userId: user.id, eventType: 'comment', details: 'Comentario adicionado.', createdAt: now() });
  return { ok: true };
}

function dashboard(user) {
  const tickets = scopedTickets(user);
  return {
    total: tickets.length,
    critical: tickets.filter((t) => t.priority === 'critica' && !['resolvido','equipamento_condenado'].includes(t.status)).length,
    byStatus: countBy(tickets, 'status'),
    byType: countBy(tickets, 'type')
  };
}

function reportFailures(user, body) {
  const failures = rows('failure_types');
  const tickets = filterPeriod(scopedTickets(user), body);
  return Object.entries(tickets.reduce((acc, t) => {
    const label = (failures.find((f) => f.id === t.failureTypeId) || {}).name || t.failureOther || 'Outros';
    acc[label] = (acc[label] || 0) + 1;
    return acc;
  }, {})).map(([label,total]) => ({ label, total })).sort((a,b) => b.total - a.total);
}

function reportOccurrences(user, body) {
  const bucket = ['day','week','month'].includes(body.bucket) ? body.bucket : 'day';
  const grouped = filterPeriod(scopedTickets(user), body).reduce((acc, t) => {
    const d = new Date(t.createdAt);
    const label = bucket === 'month' ? d.toISOString().slice(0,7) : bucket === 'week' ? weekLabel(d) : d.toISOString().slice(0,10);
    acc[label] = (acc[label] || 0) + 1;
    return acc;
  }, {});
  return Object.entries(grouped).map(([label,total]) => ({ label, total })).sort((a,b) => a.label.localeCompare(b.label));
}

function countBy(items, key) {
  return items.reduce((acc, item) => {
    acc[item[key]] = (acc[item[key]] || 0) + 1;
    return acc;
  }, {});
}

function filterPeriod(items, body) {
  return items.filter((t) => {
    const date = new Date(t.createdAt);
    if (body.start && date < new Date(body.start + 'T00:00:00')) return false;
    if (body.end && date > new Date(body.end + 'T23:59:59')) return false;
    return true;
  });
}

function weekLabel(date) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const days = Math.floor((date - start) / 86400000);
  return date.getUTCFullYear() + '-W' + String(Math.ceil((days + start.getUTCDay() + 1) / 7)).padStart(2, '0');
}

function exportAll(user) {
  requireRole(user, ['admin']);
  const data = {};
  Object.keys(SHEETS).forEach((name) => data[name] = rows(name).map((row) => {
    const copy = {};
    SHEETS[name].forEach((header) => copy[header] = row[header]);
    return copy;
  }));
  return { exportedAt: now(), data };
}
