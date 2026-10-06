(() => {
  'use strict';

  const config = window.CENTRAL_CONFIG || {};
  const page = document.body.dataset.page === 'area' ? 'area' : 'home';
  const $ = (selector, root = document) => root.querySelector(selector);
  const escapeHTML = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const apiBase = String(config.apiBaseUrl || '').trim().replace(/\/+$/, '');
  const dateFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });
  const state = { token: sessionStorage.getItem('central-google-token') || '', user: null, items: [], filter: 'Todos', search: '' };
  const categories = ['Estratégia', 'Indicadores', 'Ferramentas', 'Processos', 'Mercado', 'Materiais', 'Geral'];
  const categoryIcons = { Estratégia: '⌁', Indicadores: '▥', Ferramentas: '↗', Processos: '≋', Mercado: '◎', Materiais: '▤', Geral: '＋' };
  const typeLabels = { link: 'Link rápido', document: 'Documento', notice: 'Aviso', quote: 'Frase' };
  let googleInitialized = false;

  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('central-revenue-theme', theme);
    const button = $('#themeToggle');
    if (button) button.setAttribute('aria-label', theme === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro');
  }

  function getToday() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }

  function displayToday() {
    return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(new Date());
  }

  function cleanLink(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' ? url.href : '';
    } catch { return ''; }
  }

  function expiryLabel(value) {
    if (!value) return '';
    const days = Math.round((new Date(`${value}T12:00:00`).getTime() - new Date(`${getToday()}T12:00:00`).getTime()) / 86400000);
    if (days < 0) return 'Expirado';
    if (days === 0) return 'Encerra hoje';
    if (days === 1) return 'Encerra amanhã';
    if (days <= 7) return `Mais ${days} dias`;
    return `Até ${dateFormatter.format(new Date(`${value}T12:00:00`))}`;
  }

  function showGate(message = '') {
    const gate = $('#accessGate');
    $('#app').hidden = true;
    gate.hidden = false;
    const configured = Boolean(apiBase && config.googleClientId);
    const status = !config.googleClientId
      ? 'O login Google ainda não está configurado neste projeto.'
      : !apiBase
        ? 'A camada protegida de conteúdo ainda precisa ser conectada. Quando a função Google Cloud estiver implantada, informe sua URL em config.js para ativar o acesso compartilhado.'
        : 'Entre com a mesma conta Google autorizada para a equipe Revenue.';
    gate.innerHTML = `
      <section class="gate-card">
        <div class="gate-brand"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span><span><strong>REVENUE</strong><small>INTELIGÊNCIA COMERCIAL</small></span></div>
        <h1>Conhecimento para<br /><span>decidir melhor.</span></h1>
        <p>Uma central da área para encontrar ferramentas, documentos, avisos e referências importantes.</p>
        <div class="google-slot"><div id="googleButton"></div></div>
        <div class="gate-message" role="status">${escapeHTML(message || status)}</div>
        <div class="gate-foot"><span>◆</span> Acesso restrito às contas autorizadas da equipe.</div>
      </section>`;
    if (configured) mountGoogleButton();
  }

  function mountGoogleButton(attempt = 0) {
    const holder = $('#googleButton');
    if (!holder || !config.googleClientId) return;
    if (!window.google?.accounts?.id) {
      if (attempt < 35) window.setTimeout(() => mountGoogleButton(attempt + 1), 120);
      else holder.textContent = 'Não foi possível carregar o login do Google.';
      return;
    }
    if (!googleInitialized) {
      window.google.accounts.id.initialize({
        client_id: config.googleClientId,
        callback: handleGoogleCredential,
        auto_select: false,
        cancel_on_tap_outside: true,
      });
      googleInitialized = true;
    }
    holder.innerHTML = '';
    window.google.accounts.id.renderButton(holder, {
      theme: document.documentElement.dataset.theme === 'dark' ? 'filled_black' : 'outline',
      size: 'large',
      shape: 'rectangular',
      text: 'signin_with',
      logo_alignment: 'left',
      locale: 'pt-BR',
      width: 290,
    });
  }

  async function handleGoogleCredential(response) {
    const message = $('.gate-message');
    if (!response?.credential || !apiBase) return;
    if (message) message.textContent = 'Validando sua conta…';
    state.token = response.credential;
    try {
      const result = await request('/api/v1/session');
      state.user = result.user;
      sessionStorage.setItem('central-google-token', state.token);
      await enterApp();
    } catch (error) {
      state.token = '';
      state.user = null;
      sessionStorage.removeItem('central-google-token');
      if (message) message.textContent = error.message || 'Esta conta não tem acesso à Central Revenue.';
      mountGoogleButton();
    }
  }

  async function request(path, options = {}) {
    if (!apiBase) throw new Error('A URL da função Google Cloud ainda não foi configurada.');
    const headers = new Headers(options.headers || {});
    if (state.token) headers.set('Authorization', `Bearer ${state.token}`);
    const response = await fetch(`${apiBase}${path}`, { ...options, headers, cache: 'no-store' });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      if (response.status === 401) throw new Error('Entre novamente com sua conta Google.');
      if (response.status === 403) throw new Error('Esta conta não tem acesso a essa ação.');
      throw new Error(body.error || 'Não foi possível concluir a solicitação.');
    }
    if (response.status === 204) return null;
    const contentType = response.headers.get('content-type') || '';
    return contentType.includes('application/json') ? response.json() : response.blob();
  }

  function showToast(message, kind = 'success') {
    document.querySelector('.toast')?.remove();
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.dataset.kind = kind;
    toast.setAttribute('role', 'status');
    toast.textContent = message;
    document.body.append(toast);
    window.setTimeout(() => toast.remove(), 3400);
  }

  function setProfile() {
    const name = state.user?.name || state.user?.email || 'Revenue';
    const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'R';
    $('#profileName').textContent = name;
    $('#profileInitials').textContent = initials;
    $('#profileEmail').textContent = state.user?.email || '';
    document.querySelectorAll('.admin-only').forEach((element) => { element.hidden = state.user?.role !== 'admin'; });
  }

  async function enterApp() {
    $('#accessGate').hidden = true;
    $('#app').hidden = false;
    document.querySelectorAll('[data-nav]').forEach((link) => {
      if (link.dataset.nav === page) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    setProfile();
    $('#pageContent').innerHTML = '<div class="loading-gate">Carregando a central…</div>';
    try {
      const result = await request('/api/v1/content');
      state.items = Array.isArray(result.items) ? result.items : [];
      renderPage();
    } catch (error) {
      if (/Entre novamente/.test(error.message)) return signOut(error.message);
      $('#pageContent').innerHTML = `<section class="library-empty"><span class="empty-symbol">↻</span><h2>Não foi possível abrir a central</h2><p>${escapeHTML(error.message)} Verifique a conexão com a função Google Cloud e tente novamente.</p><button class="button button-quiet" id="retryLoad" type="button">Tentar novamente</button></section>`;
      $('#retryLoad')?.addEventListener('click', enterApp);
    }
  }

  function renderPage() {
    if (page === 'area') renderArea();
    else renderHome();
  }

  function activeItems(items = state.items) {
    const today = getToday();
    return items.filter((item) => item.active !== false && (!item.expiresAt || item.expiresAt >= today));
  }

  function shortDate(value) {
    if (!value) return '';
    return dateFormatter.format(new Date(`${value}T12:00:00`));
  }

  function iconFor(item) {
    if (item.type === 'document') return (item.fileName || 'PDF').split('.').pop().slice(0, 4).toUpperCase();
    if (item.type === 'notice') return 'i';
    if (item.type === 'quote') return '“';
    return categoryIcons[item.category] || '↗';
  }

  function cardAction(item, text = 'Abrir') {
    if (item.type === 'link' && cleanLink(item.url)) return `<a class="text-link" href="${escapeHTML(cleanLink(item.url))}" target="_blank" rel="noopener noreferrer">${text} <span aria-hidden="true">↗</span></a>`;
    if (item.type === 'document' && item.fileId) return `<button class="text-link download-link" type="button" data-download="${escapeHTML(item.id)}">${text} <span aria-hidden="true">↓</span></button>`;
    return '';
  }

  function adminControls(item) {
    if (state.user?.role !== 'admin') return '';
    return `<span class="admin-controls"><button type="button" data-action="edit" data-id="${escapeHTML(item.id)}" aria-label="Editar">✎</button><button type="button" data-action="delete" data-id="${escapeHTML(item.id)}" aria-label="Remover">×</button></span>`;
  }

  function noticeMarkup(item) {
    const remaining = expiryLabel(item.expiresAt);
    const tone = item.expiresAt && item.expiresAt <= getToday() ? 'coral' : 'gold';
    return `<article class="notice-card" data-tone="${tone}">
      <div class="notice-copy"><div class="notice-meta"><span class="category">${escapeHTML(item.category || 'Aviso')}</span><span>${escapeHTML(item.updatedAt ? shortDate(item.updatedAt.slice(0, 10)) : 'Comunicado da área')}</span></div>
      <h3>${escapeHTML(item.title)}</h3><p>${escapeHTML(item.body || '')}</p></div>
      <span class="expire-badge">${escapeHTML(remaining || 'Importante')}</span>
      ${adminControls(item)}</article>`;
  }

  function resourceRow(item) {
    const meta = [item.category, item.fileName || typeLabels[item.type]].filter(Boolean).join(' · ');
    return `<article class="resource-row"><span class="file-icon">${escapeHTML(iconFor(item))}</span><div class="resource-row-copy"><strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(meta)}</small></div>${cardAction(item, item.type === 'document' ? 'Baixar' : 'Abrir')}${adminControls(item)}</article>`;
  }

  function emptyInline(message) {
    return `<div class="empty-inline"><i class="empty-dot" aria-hidden="true"></i><span>${escapeHTML(message)}</span></div>`;
  }

  function renderHome() {
    const items = activeItems().sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
    const notices = items.filter((item) => item.type === 'notice').sort((a, b) => String(a.expiresAt || '').localeCompare(String(b.expiresAt || ''))).slice(0, 3);
    const quick = items.filter((item) => item.type === 'link').slice(0, 4);
    const documents = items.filter((item) => item.type === 'document').slice(0, 3);
    const quotes = items.filter((item) => item.type === 'quote').slice(0, 2);
    const totalDocs = items.filter((item) => item.type === 'document').length;
    const totalNotices = items.filter((item) => item.type === 'notice').length;
    const quickMarkup = quick.length
      ? `<div class="quick-grid">${quick.map((item) => `<a class="quick-card" href="${escapeHTML(cleanLink(item.url) || './area.html')}" ${cleanLink(item.url) ? 'target="_blank" rel="noopener noreferrer"' : ''}><div class="quick-card-top"><span class="quick-icon">${escapeHTML(iconFor(item))}</span><span class="arrow" aria-hidden="true">↗</span></div><strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(item.category || 'Acesso rápido')}</small></a>`).join('')}</div>`
      : emptyInline(state.user?.role === 'admin'
        ? 'Comece incluindo os links usados com mais frequência pela área.'
        : 'Os atalhos da área aparecerão aqui quando forem publicados.');
    const noticeMarkupList = notices.length ? notices.map(noticeMarkup).join('') : emptyInline(state.user?.role === 'admin' ? 'Adicione um aviso e defina até quando ele deve ficar visível.' : 'Nenhum aviso ativo neste momento.');
    const documentsMarkup = documents.length ? documents.map(resourceRow).join('') : emptyInline('Documentos e materiais publicados pela área aparecem aqui.');
    const quotesMarkup = quotes.length ? quotes.map((item) => `<article class="quote-card"><span class="quote-mark">“</span><blockquote>${escapeHTML(item.body || item.title)}</blockquote>${item.body ? `<cite>${escapeHTML(item.title)}</cite>` : ''}${adminControls(item)}</article>`).join('') : emptyInline('Frases e princípios importantes da área aparecerão aqui quando forem publicados.');
    const categoryMarkup = categories.map((category) => {
      const count = items.filter((item) => item.category === category).length;
      return `<a class="category-pill" href="./area.html?categoria=${encodeURIComponent(category)}">${escapeHTML(category)} <b>${count}</b></a>`;
    }).join('');

    $('#pageContent').innerHTML = `
      <section class="welcome">
        <div class="welcome-copy"><span class="eyebrow">UM ESPAÇO DA ÁREA REVENUE</span>
          <h1>Inteligência para decisões <span>com contexto.</span></h1>
          <p>Ferramentas, materiais, avisos e ideias importantes da área — organizados para você encontrar o que precisa e seguir em frente.</p>
          <div class="welcome-actions"><a class="button button-primary" href="./area.html">Explorar minha área <span aria-hidden="true">→</span></a><span class="welcome-note">Uma fonte compartilhada para o time.</span></div>
        </div>
        <div class="welcome-seal" aria-hidden="true"><span class="seal-letter">R</span><span class="seal-caption">REVENUE · 2026</span></div>
      </section>
      <div class="overview-line"><span class="date-stamp">${escapeHTML(displayToday())}</span><span class="date-stamp">${items.length} conteúdos · ${totalDocs} materiais · ${totalNotices} avisos ativos</span></div>
      <section class="content-section"><div class="section-heading"><div><h2>Acesso rápido</h2><p>Os pontos de partida para o trabalho da área.</p></div><a class="text-link" href="./area.html?tipo=link">Ver todos <span aria-hidden="true">→</span></a></div>${quickMarkup}</section>
      <div class="content-grid">
        <section class="content-section"><div class="section-heading"><div><h2>Avisos em foco</h2><p>Informações importantes com prazo de validade.</p></div><a class="text-link" href="./area.html?tipo=notice">Todos os avisos <span aria-hidden="true">→</span></a></div><div class="notice-list">${noticeMarkupList}</div></section>
        <section class="content-section"><div class="section-heading"><div><h2>Materiais recentes</h2><p>Guias e arquivos publicados pela equipe.</p></div><a class="text-link" href="./area.html?tipo=document">Abrir repositório <span aria-hidden="true">→</span></a></div><div class="resource-list">${documentsMarkup}</div></section>
      </div>
      <section class="content-section"><div class="section-heading" style="margin-top:34px"><div><h2>Ideias que ficam</h2><p>Princípios e frases importantes para orientar as decisões.</p></div></div><div class="quote-strip">${quotesMarkup}</div></section>
      <section class="category-band"><div class="section-heading"><div><h2>Explore por assunto</h2><p>Encontre rapidamente o conteúdo certo para cada momento.</p></div><a class="text-link" href="./area.html">Ver repositório <span aria-hidden="true">→</span></a></div><div class="category-pills">${categoryMarkup}</div></section>`;
    wireItemActions($('#pageContent'));
  }

  function filterFromQuery() {
    const params = new URLSearchParams(location.search);
    const type = params.get('tipo');
    const category = params.get('categoria');
    if (type && Object.hasOwn(typeLabels, type)) state.filter = type;
    else if (category && categories.includes(category)) state.filter = category;
  }

  function renderArea() {
    const items = activeItems().sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
    const notices = items.filter((item) => item.type === 'notice');
    const filterTypes = [['Todos', 'Todos'], ['Avisos', 'notice'], ['Links', 'link'], ['Documentos', 'document'], ['Frases', 'quote']];
    const filters = [...filterTypes.map(([label, value]) => `<button class="filter-button" type="button" data-filter="${value}" aria-pressed="${state.filter === value}">${label}</button>`), ...categories.map((category) => `<button class="filter-button" type="button" data-filter="${escapeHTML(category)}" aria-pressed="${state.filter === category}">${escapeHTML(category)}</button>`)].join('');
    $('#pageContent').innerHTML = `
      <section class="content-header"><div><span class="eyebrow">REPOSITÓRIO DA ÁREA</span><h1>Minha área.</h1><p>Links, arquivos, referências e avisos em um só lugar. Use a busca ou filtre por tipo e assunto.</p></div><div class="library-tools"><label class="search-wrap"><span class="sr-only">Buscar materiais</span><input id="librarySearch" class="search-input" type="search" placeholder="Buscar na central" value="${escapeHTML(state.search)}" /></label><button class="button button-primary admin-only" id="areaAdd" type="button" ${state.user?.role === 'admin' ? '' : 'hidden'}>＋ Adicionar</button></div></section>
      ${notices.length ? `<section><div class="section-heading" style="margin-top:24px"><div><h2>Avisos com prazo</h2><p>Os avisos saem da central automaticamente na data indicada.</p></div></div><div class="notice-page-grid">${notices.map(noticeMarkup).join('')}</div></section>` : ''}
      <div class="filters" role="group" aria-label="Filtrar repositório">${filters}</div>
      <div id="libraryResults"></div>`;
    $('#librarySearch').addEventListener('input', (event) => { state.search = event.target.value; renderLibraryResults(); });
    document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => { state.filter = button.dataset.filter; renderArea(); }));
    $('#areaAdd')?.addEventListener('click', openNewItem);
    wireItemActions($('#pageContent'));
    renderLibraryResults();
  }

  function renderLibraryResults() {
    const target = $('#libraryResults');
    if (!target) return;
    const query = state.search.trim().toLocaleLowerCase('pt-BR');
    const matches = activeItems().filter((item) => {
      const typeMatch = state.filter === 'Todos' || item.type === state.filter || item.category === state.filter;
      const text = `${item.title || ''} ${item.body || ''} ${item.category || ''} ${item.fileName || ''}`.toLocaleLowerCase('pt-BR');
      return typeMatch && (!query || text.includes(query));
    });
    if (!matches.length) {
      target.innerHTML = `<section class="library-empty"><span class="empty-symbol">${state.search || state.filter !== 'Todos' ? '⌕' : '＋'}</span><h2>${state.search || state.filter !== 'Todos' ? 'Nada por aqui ainda' : 'O repositório está começando.'}</h2><p>${state.search || state.filter !== 'Todos' ? 'Tente outra busca ou escolha um filtro diferente.' : state.user?.role === 'admin' ? 'Adicione o primeiro material para deixar o conhecimento da área fácil de encontrar.' : 'Os materiais publicados pela área aparecerão aqui.'}</p>${state.user?.role === 'admin' && !state.search ? '<button class="button button-primary" id="emptyAdd" type="button">＋ Adicionar conteúdo</button>' : ''}</section>`;
      $('#emptyAdd')?.addEventListener('click', openNewItem);
      return;
    }
    target.innerHTML = `<div class="library-grid">${matches.map((item) => `<article class="library-card"><div class="library-card-head"><span class="type-label">${escapeHTML(typeLabels[item.type] || item.type)} · ${escapeHTML(item.category || 'Geral')}</span>${adminControls(item)}</div><h2>${escapeHTML(item.title)}</h2><p>${escapeHTML(item.body || item.fileName || '')}</p><div class="library-card-footer"><small>${escapeHTML(item.expiresAt ? expiryLabel(item.expiresAt) : item.updatedAt ? shortDate(item.updatedAt.slice(0, 10)) : 'Conteúdo da área')}</small>${cardAction(item, item.type === 'document' ? 'Baixar arquivo' : 'Abrir')}</div></article>`).join('')}</div>`;
    wireItemActions(target);
  }

  function wireItemActions(root) {
    root.querySelectorAll('[data-action="edit"]').forEach((button) => button.addEventListener('click', () => {
      const item = state.items.find((entry) => entry.id === button.dataset.id);
      if (item) openEditItem(item);
    }));
    root.querySelectorAll('[data-action="delete"]').forEach((button) => button.addEventListener('click', async () => {
      const item = state.items.find((entry) => entry.id === button.dataset.id);
      if (!item || !window.confirm(`Remover “${item.title}” da central?`)) return;
      try { await request(`/api/v1/content/${encodeURIComponent(item.id)}`, { method: 'DELETE' }); await refreshContent(); showToast('Conteúdo removido da central.'); }
      catch (error) { showToast(error.message, 'error'); }
    }));
    root.querySelectorAll('[data-download]').forEach((button) => button.addEventListener('click', () => downloadItem(button.dataset.download)));
  }

  async function downloadItem(id) {
    const item = state.items.find((entry) => entry.id === id);
    if (!item?.fileId) return;
    try {
      const blob = await request(`/api/v1/files/${encodeURIComponent(item.fileId)}`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = item.fileName || item.title || 'material';
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { showToast(error.message, 'error'); }
  }

  function syncFormType() {
    const type = $('#itemType').value;
    const isFile = type === 'document';
    const isQuote = type === 'quote';
    $('#urlField').hidden = !(type === 'link');
    $('#fileField').hidden = !isFile;
    $('#expiryField').hidden = type !== 'notice';
    $('#itemUrl').required = type === 'link';
    $('#itemFile').required = isFile && !$('#itemId').value;
    $('#itemExpiry').required = type === 'notice';
    $('#titleLabel').textContent = isQuote ? 'Referência / autoria' : 'Título';
    $('#itemTitle').placeholder = isQuote ? 'Ex.: Princípio de Revenue' : 'Ex.: Guia de gestão de receita';
    $('#itemBody').placeholder = isQuote ? 'Escreva a frase importante' : 'Uma linha para ajudar o time a entender o conteúdo';
  }

  function openNewItem() {
    $('#itemForm').reset();
    $('#itemId').value = '';
    $('#dialogTitle').textContent = 'Adicionar conteúdo';
    $('#saveItem').textContent = 'Publicar';
    $('#formMessage').textContent = '';
    syncFormType();
    $('#itemDialog').showModal();
  }

  function openEditItem(item) {
    $('#itemForm').reset();
    $('#itemId').value = item.id;
    $('#itemType').value = item.type;
    $('#itemCategory').value = item.category || 'Geral';
    $('#itemTitle').value = item.title || '';
    $('#itemBody').value = item.body || '';
    $('#itemUrl').value = item.url || '';
    $('#itemExpiry').value = item.expiresAt || '';
    $('#itemFeatured').value = String(Boolean(item.featured));
    $('#dialogTitle').textContent = 'Editar conteúdo';
    $('#saveItem').textContent = 'Salvar alterações';
    $('#formMessage').textContent = item.fileName ? `Arquivo atual: ${item.fileName}` : '';
    syncFormType();
    $('#itemDialog').showModal();
  }

  async function saveItem(event) {
    event.preventDefault();
    const type = $('#itemType').value;
    const id = $('#itemId').value;
    const message = $('#formMessage');
    const button = $('#saveItem');
    const title = $('#itemTitle').value.trim();
    const body = $('#itemBody').value.trim();
    const url = $('#itemUrl').value.trim();
    const expiresAt = $('#itemExpiry').value;
    if (!title || (type === 'notice' && !expiresAt) || (type === 'link' && !cleanLink(url))) {
      message.textContent = type === 'notice' && !expiresAt ? 'Informe até quando o aviso deve ficar ativo.' : type === 'link' ? 'Use um endereço HTTPS válido.' : 'Informe o título.';
      return;
    }
    button.disabled = true;
    message.textContent = 'Salvando…';
    try {
      let fileId;
      let fileName;
      const file = $('#itemFile').files[0];
      if (type === 'document' && file) {
        const form = new FormData();
        form.append('file', file);
        const uploaded = await request('/api/v1/uploads', { method: 'POST', body: form });
        fileId = uploaded.fileId;
        fileName = uploaded.fileName;
      } else if (type === 'document' && id) {
        const old = state.items.find((item) => item.id === id);
        fileId = old?.fileId;
        fileName = old?.fileName;
      }
      const payload = {
        type, category: $('#itemCategory').value, title,
        body: type === 'quote' && !body ? title : body,
        url: type === 'link' ? url : '', fileId: fileId || '', fileName: fileName || '',
        expiresAt: type === 'notice' ? expiresAt : '', featured: $('#itemFeatured').value === 'true',
      };
      await request(id ? `/api/v1/content/${encodeURIComponent(id)}` : '/api/v1/content', {
        method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      $('#itemDialog').close();
      await refreshContent();
      showToast(id ? 'Alterações salvas.' : 'Conteúdo publicado para a equipe.');
    } catch (error) { message.textContent = error.message; }
    finally { button.disabled = false; }
  }

  async function refreshContent() {
    const result = await request('/api/v1/content');
    state.items = Array.isArray(result.items) ? result.items : [];
    renderPage();
  }

  function signOut(message = '') {
    state.token = '';
    state.user = null;
    state.items = [];
    sessionStorage.removeItem('central-google-token');
    showGate(message);
  }

  function wireCommonControls() {
    $('#themeToggle').addEventListener('click', () => {
      const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      setTheme(nextTheme);
      if ($('#accessGate') && !$('#accessGate').hidden) mountGoogleButton();
    });
    $('#profileButton').addEventListener('click', () => { $('#profileMenu').hidden = !$('#profileMenu').hidden; });
    $('#signOut').addEventListener('click', () => signOut('Você saiu da Central Revenue.'));
    document.addEventListener('click', (event) => {
      if (!event.target.closest('.top-actions')) $('#profileMenu').hidden = true;
    });
    $('#adminAdd').addEventListener('click', openNewItem);
    $('#itemType').addEventListener('change', syncFormType);
    $('#itemForm').addEventListener('submit', saveItem);
    document.querySelectorAll('.dialog-close').forEach((button) => button.addEventListener('click', () => $('#itemDialog').close()));
    $('#itemDialog').addEventListener('click', (event) => { if (event.target === $('#itemDialog')) $('#itemDialog').close(); });
    $('#areaAdd')?.addEventListener('click', openNewItem);
  }

  async function start() {
    setTheme(localStorage.getItem('central-revenue-theme') || 'dark');
    wireCommonControls();
    if (!apiBase) {
      showGate('A página está pronta. Falta conectar a função privada do Google Cloud para validar os acessos e guardar conteúdo para toda a equipe.');
      return;
    }
    if (state.token) {
      try {
        const result = await request('/api/v1/session');
        state.user = result.user;
        await enterApp();
      } catch { signOut('Entre com sua conta Google para continuar.'); }
    } else showGate();
    filterFromQuery();
  }

  start();
})();
