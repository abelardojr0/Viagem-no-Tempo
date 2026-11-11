/* Viagem no Tempo — companheiro de partida
   Organização:
   1. Estado e constantes
   2. DOM seguro (sem innerHTML)
   3. Cálculos e validação
   4. Armazenamento local
   5. Feedback (toast e diálogos)
   6. Plaquinha
   7. Placar, ranking e backup
   8. Inicialização

   A plaquinha não conhece a resposta da carta.
   O placar não avança a rodada sozinho.
   Não há comunicação entre aparelhos. */

(function () {
  'use strict';

  var STORAGE_KEY = 'viagem-no-tempo-companheiro-v1';
  var MAX_PLAYERS = 40;
  var MAX_ROUNDS = 30;
  var INITIAL_ROUNDS = 5;
  var VIEW_TITLES = {
    home: 'Viagem no Tempo — Companheiro de partida',
    board: 'Minha linha do tempo — Viagem no Tempo',
    score: 'Placar da partida — Viagem no Tempo'
  };

  var state = defaultState();
  var ui = {
    flash: null,
    popEvents: [],
    scrollRoundsToEnd: false
  };
  var modalState = {
    open: false,
    onKey: null,
    onClose: null,
    lastFocus: null,
    returnSelector: null
  };
  var picker = null;
  var storageAvailable = false;
  var saveErrorShown = false;
  var didBoot = false;
  var toastTimer = 0;

  function defaultState() {
    return {
      version: 1,
      view: 'home',
      plaquinha: { positions: [null, null, null, null, null, null] },
      match: {
        phase: 'setup',
        roundCount: INITIAL_ROUNDS,
        players: []
      }
    };
  }

  function qs(id) {
    return document.getElementById(id);
  }

  /* Cria elementos sem innerHTML. Texto de usuário entra só por textContent. */
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var value = attrs[key];
        if (value === false || value === null || value === undefined) return;
        if (key === 'class') {
          node.className = value;
        } else if (key === 'text') {
          node.textContent = value;
        } else if (key === 'value' && (tag === 'input' || tag === 'textarea')) {
          node.value = value;
        } else if (value === true) {
          node.setAttribute(key, '');
        } else {
          node.setAttribute(key, String(value));
        }
      });
    }
    (children || []).forEach(function (child) {
      if (child === null || child === undefined || child === false) return;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }

  function clearNode(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(String(value));
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '');
  }

  function normalizeName(raw) {
    return String(raw || '')
      .replace(/[\u0000-\u001F\u007F]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 32);
  }

  function createId() {
    return 'j' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  }

  function integerInRange(value, min, max) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'boolean') return null;
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    var number = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(number) || number < min || number > max) return null;
    return number;
  }

  function sanitizeScore(value) {
    return integerInRange(value, 0, 6);
  }

  function sanitizePosition(value) {
    return integerInRange(value, 1, 6);
  }

  function sanitizePositions(list) {
    if (!Array.isArray(list) || list.length !== 6) return null;
    var used = Object.create(null);
    return list.map(function (value) {
      var position = sanitizePosition(value);
      if (position === null || used[position]) return null;
      used[position] = true;
      return position;
    });
  }

  function emptyScores(count) {
    var scores = [];
    for (var i = 0; i < count; i += 1) scores.push(null);
    return scores;
  }

  function sanitizeScores(scores, roundCount) {
    var result = emptyScores(roundCount);
    if (!Array.isArray(scores)) return result;
    for (var i = 0; i < roundCount && i < scores.length; i += 1) {
      result[i] = sanitizeScore(scores[i]);
    }
    return result;
  }

  function sanitizeMatch(match) {
    if (!match || typeof match !== 'object' || !Array.isArray(match.players)) return null;
    var phase = match.phase === 'playing' || match.phase === 'finished' ? match.phase : 'setup';
    var declared = Number(match.roundCount);
    if (!Number.isInteger(declared) || declared < 1) declared = INITIAL_ROUNDS;
    if (declared > MAX_ROUNDS) declared = MAX_ROUNDS;

    var longest = declared;
    match.players.forEach(function (player) {
      if (player && Array.isArray(player.scores)) {
        longest = Math.max(longest, Math.min(MAX_ROUNDS, player.scores.length));
      }
    });

    var roundCount = longest;
    var ids = Object.create(null);
    var players = [];
    match.players.slice(0, MAX_PLAYERS).forEach(function (raw) {
      if (!raw || typeof raw !== 'object') return;
      var name = normalizeName(raw.name);
      if (!name) return;
      var id = typeof raw.id === 'string' ? raw.id.replace(/[^\w-]/g, '').slice(0, 40) : '';
      if (!id || ids[id]) id = createId();
      ids[id] = true;
      players.push({
        id: id,
        name: name,
        scores: sanitizeScores(raw.scores, roundCount)
      });
    });

    if (phase !== 'setup' && players.length === 0) {
      return { phase: 'setup', roundCount: INITIAL_ROUNDS, players: [] };
    }
    return { phase: phase, roundCount: roundCount, players: players };
  }

  function sanitizeState(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    var next = defaultState();
    if (data.view === 'home' || data.view === 'board' || data.view === 'score') {
      next.view = data.view;
    }
    var positions = data.plaquinha ? sanitizePositions(data.plaquinha.positions) : null;
    if (positions) next.plaquinha.positions = positions;
    var match = sanitizeMatch(data.match);
    if (match) next.match = match;
    return next;
  }

  function playerTotal(player) {
    return player.scores.reduce(function (sum, score) {
      return sum + (typeof score === 'number' ? score : 0);
    }, 0);
  }

  function matchHasScores(players) {
    return players.some(function (player) {
      return player.scores.some(function (score) { return score !== null; });
    });
  }

  function hasPendingScores() {
    return state.match.players.some(function (player) {
      return player.scores.some(function (score) { return score === null; });
    });
  }

  /* Empates compartilham a posição. A seguinte é a próxima,
     sem desempate por nome, ordem ou qualquer outro critério.
     A ordem de cadastro só organiza a exibição de quem está empatado. */
  function buildRanking(players) {
    var rows = players.map(function (player, index) {
      return {
        id: player.id,
        name: player.name,
        total: playerTotal(player),
        order: index,
        place: 0
      };
    });
    rows.sort(function (a, b) {
      return (b.total - a.total) || (a.order - b.order);
    });
    var place = 0;
    var previous;
    rows.forEach(function (row) {
      if (row.total !== previous) {
        place += 1;
        previous = row.total;
      }
      row.place = place;
    });
    return rows;
  }

  function joinNames(names) {
    if (names.length <= 1) return names[0] || '';
    if (names.length === 2) return names[0] + ' e ' + names[1];
    return names.slice(0, -1).join(', ') + ' e ' + names[names.length - 1];
  }

  function pointsLabel(total) {
    return total + (total === 1 ? ' ponto' : ' pontos');
  }

  function countLabel(count, singular, plural) {
    return count + ' ' + (count === 1 ? singular : plural);
  }

  function scoreLabel(name, roundIndex, value) {
    var round = 'Rodada ' + (roundIndex + 1);
    if (value === null) return name + ', ' + round + ', sem pontuação';
    if (value === 0) return name + ', ' + round + ', zero pontos';
    return name + ', ' + round + ', ' + pointsLabel(value);
  }

  function scoreCellClass(value, flash) {
    var classes = ['score-cell'];
    if (value === null) classes.push('is-empty');
    else if (value === 0) classes.push('is-zero');
    else classes.push('is-scored');
    if (flash) classes.push('is-flash');
    return classes.join(' ');
  }

  function filledCount() {
    return state.plaquinha.positions.filter(function (position) {
      return position !== null;
    }).length;
  }

  function persistable() {
    return {
      version: 1,
      view: state.view,
      plaquinha: { positions: state.plaquinha.positions.slice() },
      match: {
        phase: state.match.phase,
        roundCount: state.match.roundCount,
        players: state.match.players.map(function (player) {
          return {
            id: player.id,
            name: player.name,
            scores: player.scores.slice()
          };
        })
      }
    };
  }

  function loadState() {
    var result = { state: defaultState(), available: false, restored: false, corrupt: false };
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      result.available = true;
      storageAvailable = true;
      if (!raw) return result;
      var parsed = JSON.parse(raw);
      var clean = sanitizeState(parsed);
      if (!clean) {
        result.corrupt = true;
        return result;
      }
      result.state = clean;
      result.restored = true;
      return result;
    } catch (error) {
      try {
        localStorage.getItem(STORAGE_KEY);
        result.available = true;
        storageAvailable = true;
        result.corrupt = true;
      } catch (storageError) {
        result.available = false;
        storageAvailable = false;
      }
      return result;
    }
  }

  function setSaveStatus(text) {
    document.querySelectorAll('[data-save-status]').forEach(function (node) {
      node.textContent = text;
    });
  }

  function saveState() {
    if (!storageAvailable) {
      setSaveStatus('Sem armazenamento neste navegador');
      return false;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persistable()));
      setSaveStatus('Salvo neste aparelho');
      return true;
    } catch (error) {
      setSaveStatus('Não foi possível salvar');
      if (!saveErrorShown) {
        saveErrorShown = true;
        toast('Não foi possível salvar neste navegador. Você ainda pode exportar um backup.', 'error');
      }
      return false;
    }
  }

  function toast(message, tone) {
    var node = qs('toast');
    node.className = 'toast is-' + (tone === 'error' ? 'error' : 'ok');
    node.textContent = message;
    node.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      node.hidden = true;
    }, 3200);
  }

  function openModal(options) {
    if (modalState.open) closeModal();
    var root = qs('modal');
    var title = qs('modal-title');
    var message = qs('modal-message');
    var custom = qs('modal-custom');
    var actions = qs('modal-actions');
    var panel = root.querySelector('.modal-panel');

    title.textContent = options.title || '';
    message.textContent = options.message || '';
    message.hidden = !options.message;
    if (options.message) panel.setAttribute('aria-describedby', 'modal-message');
    else panel.removeAttribute('aria-describedby');

    clearNode(custom);
    if (options.body) custom.appendChild(options.body);
    clearNode(actions);
    (options.actions || []).forEach(function (action) {
      var button = el('button', {
        type: 'button',
        class: action.className,
        text: action.label,
        'data-autofocus': action.autofocus || false
      });
      button.addEventListener('click', action.onClick);
      actions.appendChild(button);
    });

    modalState.onKey = options.onKey || null;
    modalState.onClose = options.onClose || null;
    modalState.lastFocus = document.activeElement;
    modalState.returnSelector = options.returnSelector || null;
    modalState.open = true;
    root.hidden = false;
    document.body.classList.add('modal-open');

    var preferred = root.querySelector('[data-autofocus]')
      || firstEnabled(custom)
      || firstEnabled(actions);
    if (preferred && typeof preferred.focus === 'function') preferred.focus();
  }

  function firstEnabled(container) {
    var nodes = container.querySelectorAll('button, input, textarea, select');
    for (var i = 0; i < nodes.length; i += 1) {
      if (!nodes[i].disabled) return nodes[i];
    }
    return null;
  }

  function closeModal() {
    if (!modalState.open) return;
    var root = qs('modal');
    root.hidden = true;
    document.body.classList.remove('modal-open');
    clearNode(qs('modal-custom'));
    clearNode(qs('modal-actions'));
    var onClose = modalState.onClose;
    var returnSelector = modalState.returnSelector;
    var lastFocus = modalState.lastFocus;
    modalState.open = false;
    modalState.onKey = null;
    modalState.onClose = null;
    modalState.returnSelector = null;
    modalState.lastFocus = null;
    picker = null;
    if (onClose) onClose();
    var target = returnSelector ? document.querySelector(returnSelector) : null;
    if (target && typeof target.focus === 'function') target.focus();
    else if (lastFocus && document.contains(lastFocus) && typeof lastFocus.focus === 'function') lastFocus.focus();
  }

  function trapFocus(event) {
    var panel = document.querySelector('.modal-panel');
    var nodes = panel.querySelectorAll('button, input, textarea, select');
    var items = [];
    for (var i = 0; i < nodes.length; i += 1) {
      if (!nodes[i].disabled && !nodes[i].hidden) items.push(nodes[i]);
    }
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function askConfirm(options) {
    return new Promise(function (resolve) {
      var settled = false;
      function finish(value) {
        if (settled) return;
        settled = true;
        resolve(value);
      }
      openModal({
        title: options.title,
        message: options.message,
        onClose: function () { finish(false); },
        actions: [
          {
            label: 'Cancelar',
            className: 'btn btn-secondary',
            autofocus: true,
            onClick: function () { finish(false); closeModal(); }
          },
          {
            label: options.confirmLabel || 'Confirmar',
            className: options.danger ? 'btn btn-danger' : 'btn btn-primary',
            onClick: function () { finish(true); closeModal(); }
          }
        ]
      });
    });
  }

  function askText(options) {
    return new Promise(function (resolve) {
      var settled = false;
      function finish(value) {
        if (settled) return;
        settled = true;
        resolve(value);
      }
      var input = el('input', {
        id: 'modal-text-input',
        class: 'text-input',
        type: 'text',
        maxlength: '32',
        autocomplete: 'off',
        autocapitalize: 'words',
        spellcheck: 'false',
        value: options.initial || '',
        'data-autofocus': true,
        'aria-describedby': 'modal-text-error'
      });
      var error = el('p', { id: 'modal-text-error', class: 'field-error', role: 'alert' });
      var body = el('div', { class: 'stack' }, [
        el('label', { class: 'field-label', for: 'modal-text-input', text: 'Nome do jogador' }),
        input,
        error
      ]);
      function submit() {
        var clean = normalizeName(input.value);
        if (!clean) {
          error.textContent = 'Digite um nome.';
          input.focus();
          return;
        }
        finish(clean);
        closeModal();
      }
      input.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          submit();
        }
      });
      openModal({
        title: options.title,
        message: options.message,
        body: body,
        onClose: function () { finish(null); },
        actions: [
          { label: 'Cancelar', className: 'btn btn-secondary', onClick: function () { finish(null); closeModal(); } },
          { label: options.confirmLabel || 'Salvar', className: 'btn btn-primary', onClick: submit }
        ]
      });
      input.focus();
      input.select();
    });
  }

  function isTypingTarget(target) {
    if (!target || !target.tagName) return false;
    var tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  function applyView() {
    ['home', 'board', 'score'].forEach(function (name) {
      qs('view-' + name).hidden = state.view !== name;
    });
    document.title = VIEW_TITLES[state.view] || VIEW_TITLES.home;
  }

  function navigate(name) {
    if (name !== 'home' && name !== 'board' && name !== 'score') return;
    if (modalState.open) closeModal();
    state.view = name;
    applyView();
    saveState();
    var heading = document.querySelector('#view-' + name + ' h1');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
    if (name === 'score') scheduleScrollHint();
  }

  function commit() {
    ensureScoreShape();
    saveState();
    renderHome();
    renderBoard();
    renderScore();
  }

  function renderAll() {
    renderHome();
    renderBoard();
    renderScore();
    applyView();
  }

  function renderHome() {
    var filled = filledCount();
    qs('home-board-note').textContent = filled
      ? filled + ' de 6 preenchidas'
      : 'Ordene os 6 acontecimentos da carta.';
    var note = qs('home-match-note');
    if (state.match.phase === 'playing') note.textContent = 'Partida em andamento';
    else if (state.match.phase === 'finished') note.textContent = 'Partida encerrada. Ver resultado.';
    else if (state.match.players.length) note.textContent = countLabel(state.match.players.length, 'jogador na preparação', 'jogadores na preparação');
    else note.textContent = 'Cadastre os jogadores e anote os pontos.';
  }

  function renderBoard() {
    var positions = state.plaquinha.positions;
    var filled = filledCount();
    var progress = qs('board-progress');
    progress.textContent = filled === 6
      ? '6 de 6 preenchidas · resposta completa'
      : filled + ' de 6 preenchidas';
    qs('board-progress-bar').style.width = ((filled / 6) * 100) + '%';
    qs('board-complete').hidden = filled !== 6;
    qs('view-board').classList.toggle('is-complete', filled === 6);

    var mount = qs('board-rows');
    clearNode(mount);
    positions.forEach(function (position, index) {
      var popping = ui.popEvents.indexOf(index) !== -1;
      var badge = el('span', {
        class: 'pos-badge' + (position ? ' is-set' : '') + (popping ? ' is-pop' : ''),
        text: position ? String(position) : '–',
        'aria-hidden': true
      });
      var button = el('button', {
        type: 'button',
        class: 'board-row' + (position ? ' is-set' : ''),
        'data-event': String(index),
        'aria-label': 'Acontecimento ' + (index + 1) + (position ? ', ordem ' + position : ', sem ordem')
      }, [
        el('span', { class: 'event-index', text: String(index + 1), 'aria-hidden': true }),
        el('span', { class: 'event-copy' }, [
          el('span', { class: 'event-title', text: 'Acontecimento ' + (index + 1) }),
          el('span', { class: 'event-hint', text: position ? 'Ordem no tempo' : 'Toque para escolher' })
        ]),
        badge
      ]);
      mount.appendChild(button);
    });
    ui.popEvents = [];
  }

  /* Cada ordem cronológica só pode aparecer uma vez.
     Se já estiver em outra linha, as duas posições são trocadas. */
  function assignPosition(eventIndex, position) {
    if (eventIndex < 0 || eventIndex > 5 || position < 1 || position > 6) return;
    var positions = state.plaquinha.positions.slice();
    if (positions[eventIndex] === position) return;
    var other = -1;
    for (var i = 0; i < positions.length; i += 1) {
      if (positions[i] === position && i !== eventIndex) other = i;
    }
    var displaced = positions[eventIndex];
    if (other >= 0) positions[other] = displaced;
    positions[eventIndex] = position;
    state.plaquinha.positions = positions;
    ui.popEvents = other >= 0 ? [eventIndex, other] : [eventIndex];
    commit();
    if (other >= 0) {
      toast(displaced
        ? 'Posições trocadas entre os acontecimentos ' + (eventIndex + 1) + ' e ' + (other + 1) + '.'
        : 'A posição ' + position + ' saiu do acontecimento ' + (other + 1) + ' e foi para o ' + (eventIndex + 1) + '.');
    }
  }

  function clearPositions() {
    state.plaquinha.positions = [null, null, null, null, null, null];
    commit();
  }

  async function clearBoard() {
    if (modalState.open) return;
    if (filledCount() === 0) {
      toast('A plaquinha já está vazia.');
      return;
    }
    var ok = await askConfirm({
      title: 'Limpar respostas?',
      message: 'Todas as posições escolhidas serão apagadas.',
      confirmLabel: 'Limpar',
      danger: true
    });
    if (!ok) return;
    clearPositions();
    toast('Respostas limpas.');
  }

  async function newRound() {
    if (modalState.open) return;
    if (filledCount() === 0) {
      toast('A plaquinha já está pronta para a próxima rodada.');
      return;
    }
    var ok = await askConfirm({
      title: 'Nova rodada?',
      message: 'A ordem atual será apagada para a próxima carta.',
      confirmLabel: 'Nova rodada',
      danger: true
    });
    if (!ok) return;
    clearPositions();
    toast('Plaquinha pronta para a nova rodada.');
  }

  function openPositionPicker(eventIndex) {
    if (modalState.open) return;
    if (eventIndex < 0 || eventIndex > 5) return;
    var grid = el('div', { class: 'choice-grid', id: 'position-grid' });
    for (var number = 1; number <= 6; number += 1) {
      (function (position) {
        var holder = state.plaquinha.positions.indexOf(position);
        var mine = holder === eventIndex;
        var taken = holder >= 0 && !mine;
        var note = mine ? 'Atual' : taken ? 'Carta ' + (holder + 1) : 'Livre';
        var button = el('button', {
          type: 'button',
          class: 'choice-btn' + (mine ? ' is-current' : '') + (taken ? ' is-taken' : ''),
          'data-autofocus': mine,
          'aria-pressed': mine ? 'true' : 'false'
        }, [
          el('span', { class: 'choice-num', text: String(position) }),
          el('small', { text: note })
        ]);
        button.addEventListener('click', function () {
          if (!mine) assignPosition(eventIndex, position);
          closeModal();
        });
        grid.appendChild(button);
      })(number);
    }
    var clearButton = el('button', {
      type: 'button',
      class: 'btn btn-secondary btn-block',
      text: 'Deixar em branco'
    });
    clearButton.disabled = state.plaquinha.positions[eventIndex] === null;
    clearButton.addEventListener('click', function () {
      state.plaquinha.positions[eventIndex] = null;
      commit();
      closeModal();
    });
    openModal({
      title: 'Acontecimento ' + (eventIndex + 1),
      message: 'Escolha a ordem cronológica. 1 é o mais antigo e 6 é o mais recente. Um número usado em outra linha troca de lugar.',
      body: el('div', { class: 'stack' }, [grid, clearButton]),
      returnSelector: '#board-rows [data-event="' + eventIndex + '"]',
      onKey: function (event) {
        if (/^[1-6]$/.test(event.key)) {
          event.preventDefault();
          assignPosition(eventIndex, Number(event.key));
          closeModal();
        }
      },
      actions: [
        { label: 'Fechar', className: 'btn btn-ghost btn-block', onClick: closeModal }
      ]
    });
  }

  function ensureScoreShape() {
    var count = state.match.roundCount;
    state.match.players.forEach(function (player) {
      if (!Array.isArray(player.scores)) player.scores = [];
      while (player.scores.length < count) player.scores.push(null);
      if (player.scores.length > count) player.scores.length = count;
    });
  }

  function renderScore() {
    var setup = state.match.phase === 'setup';
    qs('score-setup').hidden = !setup;
    qs('score-play').hidden = setup;
    var lede = qs('score-lede');
    if (setup) {
      lede.textContent = 'Cadastre quem vai jogar. A quantidade pode ser qualquer uma, a partir de duas pessoas.';
      renderSetup();
    } else if (state.match.phase === 'finished') {
      lede.textContent = 'A partida está encerrada. Reabra se precisar corrigir algum ponto.';
    } else {
      lede.textContent = 'Lance os pontos depois de conferir as cartas. A rodada não avança sozinha.';
    }
    if (!setup) {
      renderPlayStatus();
      renderResult();
      renderScoreTable();
      renderRanking();
      renderPlayActions();
    }
    refreshScorePicker();
    scheduleScrollHint();
  }

  function renderSetup() {
    var players = state.match.players;
    var list = qs('player-list');
    clearNode(list);
    qs('player-count').textContent = players.length
      ? countLabel(players.length, 'jogador', 'jogadores')
      : 'Nenhum jogador ainda';
    qs('player-empty').hidden = players.length > 0;
    list.hidden = players.length === 0;
    players.forEach(function (player, index) {
      list.appendChild(el('li', { class: 'player-item' }, [
        el('span', { class: 'player-order', text: String(index + 1) }),
        el('span', { class: 'player-name', text: player.name }),
        el('span', { class: 'player-actions' }, [
          el('button', {
            type: 'button',
            class: 'btn btn-small btn-secondary',
            'data-rename': player.id,
            'aria-label': 'Editar nome de ' + player.name,
            text: 'Renomear'
          }),
          el('button', {
            type: 'button',
            class: 'btn btn-small btn-danger-ghost',
            'data-remove': player.id,
            'aria-label': 'Remover ' + player.name,
            text: 'Remover'
          })
        ])
      ]));
    });
    var start = qs('btn-start');
    start.disabled = players.length < 2;
    qs('start-hint').textContent = players.length < 2
      ? 'Adicione pelo menos 2 jogadores para iniciar.'
      : 'Tudo pronto para começar.';
    qs('btn-clear-players').hidden = players.length === 0;
  }

  function addPlayer(name) {
    var clean = normalizeName(name);
    if (!clean) return 'Digite o nome do jogador.';
    if (state.match.players.length >= MAX_PLAYERS) {
      return 'O placar comporta até ' + MAX_PLAYERS + ' jogadores.';
    }
    var rounds = state.match.phase === 'setup' ? INITIAL_ROUNDS : state.match.roundCount;
    state.match.players.push({ id: createId(), name: clean, scores: emptyScores(rounds) });
    commit();
    return '';
  }

  async function removePlayer(id) {
    if (modalState.open) return;
    var player = findPlayer(id);
    if (!player) return;
    var ok = await askConfirm({
      title: 'Remover jogador?',
      message: state.match.phase === 'setup'
        ? 'Remover ' + player.name + ' da lista?'
        : 'Remover ' + player.name + ' e os pontos já lançados?',
      confirmLabel: 'Remover',
      danger: true
    });
    if (!ok) return;
    state.match.players = state.match.players.filter(function (item) { return item.id !== id; });
    if (!state.match.players.length && state.match.phase !== 'setup') {
      state.match.phase = 'setup';
      state.match.roundCount = INITIAL_ROUNDS;
    }
    commit();
    toast(player.name + ' foi removido.');
  }

  async function renamePlayer(id) {
    if (modalState.open) return;
    var player = findPlayer(id);
    if (!player) return;
    var next = await askText({
      title: 'Editar jogador',
      message: 'O nome novo aparece no placar e na classificação.',
      initial: player.name,
      confirmLabel: 'Salvar'
    });
    if (!next) return;
    player.name = next;
    commit();
    toast('Nome atualizado.');
  }

  async function promptAddPlayer() {
    if (modalState.open || state.match.phase === 'finished') return;
    var name = await askText({
      title: 'Novo jogador',
      message: 'A pessoa entra em todas as rodadas atuais, ainda sem pontuação.',
      confirmLabel: 'Adicionar'
    });
    if (!name) return;
    var error = addPlayer(name);
    if (error) toast(error, 'error');
    else toast(name + ' entrou na partida.');
  }

  async function clearPlayers() {
    if (modalState.open || !state.match.players.length) return;
    var ok = await askConfirm({
      title: 'Limpar a lista?',
      message: 'Todos os nomes desta preparação serão removidos.',
      confirmLabel: 'Limpar lista',
      danger: true
    });
    if (!ok) return;
    state.match.players = [];
    commit();
    toast('Lista de jogadores limpa.');
  }

  function findPlayer(id) {
    for (var i = 0; i < state.match.players.length; i += 1) {
      if (state.match.players[i].id === id) return state.match.players[i];
    }
    return null;
  }

  function startMatch() {
    if (state.match.players.length < 2) {
      toast('Adicione pelo menos 2 jogadores.', 'error');
      return;
    }
    state.match.phase = 'playing';
    state.match.roundCount = INITIAL_ROUNDS;
    state.match.players.forEach(function (player) {
      player.scores = emptyScores(INITIAL_ROUNDS);
    });
    commit();
    toast('Partida iniciada.');
  }

  function setScore(playerId, roundIndex, value) {
    if (state.match.phase !== 'playing') return;
    var player = findPlayer(playerId);
    if (!player) return;
    if (roundIndex < 0 || roundIndex >= player.scores.length) return;
    if (value !== null && sanitizeScore(value) !== value) return;
    if (player.scores[roundIndex] === value) return;
    player.scores[roundIndex] = value;
    ui.flash = { playerId: playerId, roundIndex: roundIndex };
    commit();
  }

  function stepScore(delta) {
    if (!picker || state.match.phase !== 'playing') return;
    var player = findPlayer(picker.playerId);
    if (!player) return;
    var current = player.scores[picker.roundIndex];
    if (delta > 0) {
      var increased = current === null ? 1 : current + 1;
      if (increased <= 6) setScore(picker.playerId, picker.roundIndex, increased);
      return;
    }
    if (typeof current === 'number' && current > 0) {
      setScore(picker.playerId, picker.roundIndex, current - 1);
    }
  }

  function openScorePicker(playerId, roundIndex) {
    if (modalState.open) return;
    if (state.match.phase === 'finished') {
      toast('Reabra a partida para corrigir a pontuação.');
      return;
    }
    var player = findPlayer(playerId);
    if (!player) return;
    picker = { playerId: playerId, roundIndex: roundIndex };

    var minus = el('button', { type: 'button', class: 'step-btn', id: 'step-minus', 'aria-label': 'Diminuir um ponto', text: '−' });
    var plus = el('button', { type: 'button', class: 'step-btn', id: 'step-plus', 'aria-label': 'Aumentar um ponto', text: '+' });
    var value = el('span', { class: 'stepper-value', id: 'picker-value', 'aria-live': 'polite' });
    minus.addEventListener('click', function () { stepScore(-1); });
    plus.addEventListener('click', function () { stepScore(1); });

    var grid = el('div', { class: 'choice-grid choice-grid-scores', id: 'score-grid' });
    for (var number = 0; number <= 6; number += 1) {
      (function (score) {
        var button = el('button', {
          type: 'button',
          class: 'choice-btn',
          'data-value': String(score),
          'aria-label': score === 0 ? 'Zero pontos' : pointsLabel(score),
          text: String(score)
        });
        button.addEventListener('click', function () {
          setScore(playerId, roundIndex, score);
          closeModal();
        });
        grid.appendChild(button);
      })(number);
    }

    var clearButton = el('button', {
      type: 'button',
      class: 'btn btn-secondary btn-block',
      id: 'picker-clear',
      text: 'Deixar sem pontuação'
    });
    clearButton.addEventListener('click', function () {
      setScore(playerId, roundIndex, null);
      closeModal();
    });

    openModal({
      title: player.name,
      message: 'Rodada ' + (roundIndex + 1) + '. O zero conta no total. Sem pontuação deixa a rodada em branco.',
      body: el('div', { class: 'stack' }, [
        el('div', { class: 'stepper' }, [minus, value, plus]),
        grid,
        clearButton
      ]),
      returnSelector: '#table-scroll [data-player="' + cssEscape(playerId) + '"][data-round="' + roundIndex + '"]',
      onKey: function (event) {
        if (/^[0-6]$/.test(event.key)) {
          event.preventDefault();
          setScore(playerId, roundIndex, Number(event.key));
          closeModal();
          return;
        }
        if (event.key === '+' || event.key === '=') {
          event.preventDefault();
          stepScore(1);
        } else if (event.key === '-' || event.key === '_') {
          event.preventDefault();
          stepScore(-1);
        }
      },
      actions: [
        { label: 'Fechar', className: 'btn btn-ghost btn-block', onClick: closeModal }
      ]
    });
    refreshScorePicker();
  }

  function refreshScorePicker() {
    if (!picker) return;
    var player = findPlayer(picker.playerId);
    var display = qs('picker-value');
    if (!player || state.match.phase !== 'playing' || !display) {
      closeModal();
      return;
    }
    var value = player.scores[picker.roundIndex];
    display.textContent = value === null ? '–' : String(value);
    var minus = qs('step-minus');
    var plus = qs('step-plus');
    var clearButton = qs('picker-clear');
    if (minus) minus.disabled = value === null || value === 0;
    if (plus) plus.disabled = value === 6;
    if (clearButton) clearButton.disabled = value === null;
    document.querySelectorAll('#score-grid .choice-btn').forEach(function (button) {
      var selected = Number(button.getAttribute('data-value')) === value;
      button.classList.toggle('is-current', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
  }

  function renderPlayStatus() {
    var players = state.match.players.length;
    var rounds = state.match.roundCount;
    var phase = state.match.phase === 'finished' ? 'Encerrada' : 'Em andamento';
    qs('play-status').textContent = phase + ' · ' + countLabel(players, 'jogador', 'jogadores') + ' · ' + countLabel(rounds, 'rodada', 'rodadas');
  }

  function renderResult() {
    var banner = qs('result-banner');
    if (state.match.phase !== 'finished') {
      banner.hidden = true;
      clearNode(banner);
      return;
    }
    var ranking = buildRanking(state.match.players);
    var leaders = ranking.filter(function (row) { return row.place === 1; });
    var title = 'Partida encerrada';
    var detail = '';
    if (!ranking.length) {
      title = 'Sem jogadores';
    } else if (!matchHasScores(state.match.players)) {
      title = 'Nenhum ponto lançado';
      detail = 'A partida foi encerrada sem pontuação.';
    } else if (leaders.length === 1) {
      title = leaders[0].name + ' venceu';
      detail = pointsLabel(leaders[0].total) + '.';
    } else {
      title = 'Empate';
      detail = joinNames(leaders.map(function (row) { return row.name; })) + ' terminaram com ' + pointsLabel(leaders[0].total) + '.';
    }
    clearNode(banner);
    banner.hidden = false;
    banner.appendChild(el('p', { class: 'result-kicker', text: 'Resultado' }));
    banner.appendChild(el('p', { class: 'result-title', text: title }));
    if (detail) banner.appendChild(el('p', { class: 'result-detail', text: detail }));
    if (hasPendingScores() && matchHasScores(state.match.players)) {
      banner.appendChild(el('p', { class: 'result-note', text: 'Há rodadas sem lançamento. Elas não entraram na soma.' }));
    }
  }

  function renderScoreTable() {
    var scroller = qs('table-scroll');
    var keepLeft = scroller.scrollLeft;
    clearNode(scroller);
    var players = state.match.players;
    var rounds = state.match.roundCount;
    var finished = state.match.phase === 'finished';
    var ranking = buildRanking(players);
    var scored = matchHasScores(players);
    var leaderIds = Object.create(null);
    ranking.forEach(function (row) {
      if (scored && row.place === 1) leaderIds[row.id] = true;
    });

    var table = el('table', { class: 'score-table' });
    table.appendChild(el('caption', {
      class: 'visually-hidden',
      text: 'Pontuação por jogador e rodada, de 0 a 6 pontos.'
    }));
    var headRow = el('tr');
    headRow.appendChild(el('th', { class: 'name-col', scope: 'col', text: 'Jogador' }));
    for (var round = 0; round < rounds; round += 1) {
      var heading = el('th', { scope: 'col' });
      heading.appendChild(el('span', { class: 'round-short', text: 'R' + (round + 1) }));
      heading.appendChild(el('span', { class: 'round-long', text: 'Rodada ' + (round + 1) }));
      headRow.appendChild(heading);
    }
    headRow.appendChild(el('th', { class: 'total-col', scope: 'col', text: 'Total' }));
    table.appendChild(el('thead', null, [headRow]));

    var body = el('tbody');
    players.forEach(function (player) {
      var row = el('tr', { class: leaderIds[player.id] ? 'is-leader' : '' });
      var nameCell = el('th', { class: 'name-col', scope: 'row' }, [
        el('span', { class: 'name-label', text: player.name })
      ]);
      if (!finished) {
        nameCell.appendChild(el('span', { class: 'name-tools' }, [
          el('button', {
            type: 'button',
            class: 'btn btn-small btn-ghost',
            'data-rename': player.id,
            'aria-label': 'Editar nome de ' + player.name,
            text: 'Editar'
          }),
          el('button', {
            type: 'button',
            class: 'btn btn-small btn-danger-ghost',
            'data-remove': player.id,
            'aria-label': 'Remover ' + player.name,
            text: 'Remover'
          })
        ]));
      }
      row.appendChild(nameCell);

      player.scores.forEach(function (value, roundIndex) {
        var flash = ui.flash && ui.flash.playerId === player.id && ui.flash.roundIndex === roundIndex;
        var button = el('button', {
          type: 'button',
          class: scoreCellClass(value, flash),
          'data-player': player.id,
          'data-round': String(roundIndex),
          'aria-label': scoreLabel(player.name, roundIndex, value),
          title: scoreLabel(player.name, roundIndex, value),
          text: value === null ? '–' : String(value)
        });
        if (finished) button.disabled = true;
        row.appendChild(el('td', null, [button]));
      });

      var hasNumber = player.scores.some(function (score) { return score !== null; });
      row.appendChild(el('td', { class: 'total-col' }, [
        el('span', {
          class: 'total-value' + (hasNumber ? '' : ' is-muted'),
          text: String(playerTotal(player))
        })
      ]));
      body.appendChild(row);
    });
    table.appendChild(body);
    scroller.appendChild(table);
    ui.flash = null;

    if (ui.scrollRoundsToEnd) {
      ui.scrollRoundsToEnd = false;
      scroller.scrollLeft = scroller.scrollWidth;
    } else {
      scroller.scrollLeft = keepLeft;
    }
  }

  function renderRanking() {
    var mount = qs('ranking-region');
    clearNode(mount);
    mount.appendChild(el('h2', { class: 'ranking-region-title', id: 'ranking-title', text: 'Classificação' }));
    var ranking = buildRanking(state.match.players);
    if (!ranking.length) {
      mount.appendChild(el('p', { class: 'empty-state', text: 'Nenhum jogador na partida.' }));
      return;
    }
    if (!matchHasScores(state.match.players)) {
      mount.appendChild(el('p', { class: 'hint', text: 'Todos começam empatados, sem pontos. A lista segue a ordem de inclusão.' }));
    } else if (ranking.filter(function (row) { return row.place === 1; }).length > 1) {
      mount.appendChild(el('p', { class: 'hint', text: 'Há empate na liderança. Nenhum critério de desempate é aplicado.' }));
    }
    var list = el('ol', { class: 'ranking-list' });
    var scored = matchHasScores(state.match.players);
    ranking.forEach(function (row) {
      list.appendChild(el('li', {
        class: 'ranking-item' + (scored && row.place === 1 ? ' is-first' : '')
      }, [
        el('span', { class: 'place', text: row.place + 'º' }),
        el('span', { class: 'ranking-name', text: row.name }),
        el('span', { class: 'ranking-score' }, [
          el('span', { class: 'ranking-points', text: String(row.total) }),
          el('small', { text: 'pts' })
        ])
      ]));
    });
    mount.appendChild(list);
    updateRankingLive(ranking);
  }

  function updateRankingLive(ranking) {
    if (!didBoot) return;
    var node = qs('ranking-live');
    var text = 'Nenhuma pontuação lançada.';
    if (matchHasScores(state.match.players) && ranking.length) {
      var leaders = ranking.filter(function (row) { return row.place === 1; });
      text = 'Liderança: ' + joinNames(leaders.map(function (row) { return row.name; })) + ', ' + pointsLabel(leaders[0].total) + '.';
    }
    if (node.textContent !== text) node.textContent = text;
  }

  function renderPlayActions() {
    var finished = state.match.phase === 'finished';
    qs('btn-add-player-play').disabled = finished;
    var addRound = qs('btn-add-round');
    addRound.disabled = finished || state.match.roundCount >= MAX_ROUNDS;
    addRound.textContent = state.match.roundCount >= MAX_ROUNDS
      ? 'Limite de rodadas atingido'
      : '+ Adicionar rodada ' + (state.match.roundCount + 1);
    qs('btn-finish').hidden = finished;
    qs('btn-reopen').hidden = !finished;
  }

  function addRound() {
    if (state.match.phase !== 'playing') return;
    if (state.match.roundCount >= MAX_ROUNDS) {
      toast('O placar comporta até ' + MAX_ROUNDS + ' rodadas.', 'error');
      return;
    }
    state.match.roundCount += 1;
    state.match.players.forEach(function (player) {
      player.scores.push(null);
    });
    ui.scrollRoundsToEnd = true;
    commit();
    toast('Rodada ' + state.match.roundCount + ' adicionada.');
  }

  async function finishMatch() {
    if (modalState.open || state.match.phase !== 'playing') return;
    var pending = hasPendingScores();
    var ok = await askConfirm({
      title: 'Finalizar partida?',
      message: pending
        ? 'Ainda há rodadas sem pontuação. O resultado usará apenas os pontos já lançados.'
        : 'O resultado será exibido. Você pode reabrir a partida se precisar corrigir algo.',
      confirmLabel: 'Finalizar'
    });
    if (!ok) return;
    state.match.phase = 'finished';
    commit();
    toast('Partida encerrada.');
  }

  function reopenMatch() {
    if (state.match.phase !== 'finished') return;
    state.match.phase = 'playing';
    commit();
    toast('Partida reaberta para correções.');
  }

  async function newMatch() {
    if (modalState.open) return;
    var ok = await askConfirm({
      title: 'Começar nova partida?',
      message: 'As pontuações e as rodadas extras serão apagadas. Os nomes permanecem para você ajustar antes de iniciar de novo.',
      confirmLabel: 'Nova partida',
      danger: true
    });
    if (!ok) return;
    state.match.phase = 'setup';
    state.match.roundCount = INITIAL_ROUNDS;
    state.match.players.forEach(function (player) {
      player.scores = emptyScores(INITIAL_ROUNDS);
    });
    commit();
    toast('Nomes mantidos. Confira a lista e inicie quando quiser.');
  }

  function buildBackup() {
    return {
      app: 'viagem-no-tempo',
      version: 1,
      exportedAt: new Date().toISOString(),
      plaquinha: { positions: state.plaquinha.positions.slice() },
      match: persistable().match
    };
  }

  function openExport() {
    if (modalState.open) return;
    var json = JSON.stringify(buildBackup(), null, 2);
    var area = el('textarea', {
      id: 'export-text',
      readonly: 'readonly',
      'aria-label': 'Backup da partida em JSON',
      'data-autofocus': true
    });
    area.value = json;
    openModal({
      title: 'Exportar backup',
      message: 'Guarde o arquivo neste aparelho. Se o download não começar, copie o texto. Nada é enviado à internet.',
      body: area,
      actions: [
        { label: 'Fechar', className: 'btn btn-secondary', onClick: closeModal },
        { label: 'Copiar', className: 'btn btn-secondary', onClick: function () { copyText(area.value, area); } },
        { label: 'Baixar JSON', className: 'btn btn-primary', onClick: function () { downloadBackup(json); } }
      ]
    });
    area.focus();
    area.select();
  }

  function copyText(text, area) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () {
        toast('Backup copiado.');
      }).catch(function () {
        fallbackCopy(area);
      });
      return;
    }
    fallbackCopy(area);
  }

  function fallbackCopy(area) {
    area.focus();
    area.select();
    var copied = false;
    try {
      copied = document.execCommand('copy');
    } catch (error) {
      copied = false;
    }
    toast(copied ? 'Backup copiado.' : 'Selecione o texto e copie manualmente.', copied ? 'ok' : 'error');
  }

  function downloadBackup(json) {
    try {
      var blob = new Blob([json], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var link = el('a', { href: url, download: 'viagem-no-tempo-partida.json' });
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
      toast('Download iniciado. Se ele não aparecer, copie o texto.');
    } catch (error) {
      toast('Não foi possível baixar. Copie o texto do backup.', 'error');
    }
  }

  function openImport() {
    if (modalState.open) return;
    var file = el('input', { type: 'file', id: 'import-file', accept: 'application/json,.json' });
    var area = el('textarea', {
      id: 'import-text',
      placeholder: 'Ou cole aqui o JSON do backup'
    });
    var error = el('p', { id: 'import-error', class: 'field-error', role: 'alert' });
    openModal({
      title: 'Importar backup',
      message: 'Isso substitui a partida e a plaquinha guardadas neste aparelho.',
      body: el('div', { class: 'stack' }, [
        el('label', { class: 'field-label', for: 'import-file', text: 'Arquivo JSON' }),
        file,
        el('label', { class: 'field-label', for: 'import-text', text: 'Ou cole o conteúdo' }),
        area,
        error
      ]),
      actions: [
        { label: 'Cancelar', className: 'btn btn-secondary', autofocus: true, onClick: closeModal },
        {
          label: 'Substituir dados',
          className: 'btn btn-primary',
          onClick: function () { runImport(file, area, error); }
        }
      ]
    });
  }

  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsText(file);
    });
  }

  async function runImport(fileInput, area, error) {
    error.textContent = '';
    try {
      var text = area.value.trim();
      if (!text && fileInput.files && fileInput.files[0]) {
        text = (await readFile(fileInput.files[0])).trim();
      }
      if (!text) {
        error.textContent = 'Escolha um arquivo ou cole o JSON.';
        return;
      }
      if (text.length > 200000) {
        error.textContent = 'Esse arquivo é grande demais para o placar.';
        return;
      }
      var data = JSON.parse(text);
      if (!applyBackup(data)) {
        error.textContent = 'Esse JSON não é um backup válido desta aplicação.';
        return;
      }
      closeModal();
      toast('Backup importado neste aparelho.');
    } catch (importError) {
      error.textContent = 'Não foi possível ler o JSON.';
    }
  }

  function applyBackup(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
    if (data.app && data.app !== 'viagem-no-tempo') return false;
    var match = sanitizeMatch(data.match);
    if (!match) return false;
    if (data.plaquinha && data.plaquinha.positions) {
      var positions = sanitizePositions(data.plaquinha.positions);
      if (!positions) return false;
      state.plaquinha.positions = positions;
    }
    state.match = match;
    state.view = 'score';
    ensureScoreShape();
    saveState();
    renderAll();
    return true;
  }

  function syncTableScroll() {
    var scroller = qs('table-scroll');
    var hint = qs('scroll-hint');
    if (!scroller || !hint || state.view !== 'score' || state.match.phase === 'setup') return;
    var overflow = scroller.scrollWidth > scroller.clientWidth + 8;
    scroller.classList.toggle('is-scrolled', scroller.scrollLeft > 8);
    scroller.classList.toggle('can-scroll-right', overflow && (scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 8));
    hint.hidden = !overflow;
  }

  function scheduleScrollHint() {
    window.requestAnimationFrame(syncTableScroll);
  }

  function handleGlobalKeys(event) {
    if (state.view !== 'board' || isTypingTarget(event.target)) return;
    var row = document.activeElement && document.activeElement.closest
      ? document.activeElement.closest('[data-event]')
      : null;
    if (!row) return;
    if (/^[1-6]$/.test(event.key)) {
      event.preventDefault();
      assignPosition(Number(row.getAttribute('data-event')), Number(event.key));
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    var rows = document.querySelectorAll('#board-rows [data-event]');
    var index = -1;
    for (var i = 0; i < rows.length; i += 1) {
      if (rows[i] === row) index = i;
    }
    var next = event.key === 'ArrowDown' ? rows[index + 1] : rows[index - 1];
    if (next) {
      event.preventDefault();
      next.focus();
    }
  }

  function bindEvents() {
    document.body.addEventListener('click', function (event) {
      var go = event.target.closest ? event.target.closest('[data-go]') : null;
      if (!go) return;
      navigate(go.getAttribute('data-go'));
    });

    qs('board-rows').addEventListener('click', function (event) {
      var row = event.target.closest ? event.target.closest('[data-event]') : null;
      if (!row) return;
      openPositionPicker(Number(row.getAttribute('data-event')));
    });

    qs('btn-clear-board').addEventListener('click', clearBoard);
    qs('btn-new-round').addEventListener('click', newRound);

    qs('add-player-form').addEventListener('submit', function (event) {
      event.preventDefault();
      var input = qs('player-name');
      var errorNode = qs('player-name-error');
      var error = addPlayer(input.value);
      if (error) {
        errorNode.textContent = error;
        input.setAttribute('aria-invalid', 'true');
        input.focus();
        return;
      }
      errorNode.textContent = '';
      input.removeAttribute('aria-invalid');
      input.value = '';
      input.focus();
      toast('Jogador adicionado.');
    });

    qs('player-name').addEventListener('input', function () {
      qs('player-name-error').textContent = '';
      qs('player-name').removeAttribute('aria-invalid');
    });

    qs('view-score').addEventListener('click', function (event) {
      var rename = event.target.closest ? event.target.closest('[data-rename]') : null;
      if (rename) {
        renamePlayer(rename.getAttribute('data-rename'));
        return;
      }
      var remove = event.target.closest ? event.target.closest('[data-remove]') : null;
      if (remove) removePlayer(remove.getAttribute('data-remove'));
    });

    qs('table-scroll').addEventListener('click', function (event) {
      var cell = event.target.closest ? event.target.closest('[data-player]') : null;
      if (!cell || cell.disabled) return;
      openScorePicker(cell.getAttribute('data-player'), Number(cell.getAttribute('data-round')));
    });
    qs('table-scroll').addEventListener('scroll', syncTableScroll);

    qs('btn-start').addEventListener('click', startMatch);
    qs('btn-clear-players').addEventListener('click', clearPlayers);
    qs('btn-add-player-play').addEventListener('click', promptAddPlayer);
    qs('btn-add-round').addEventListener('click', addRound);
    qs('btn-finish').addEventListener('click', finishMatch);
    qs('btn-reopen').addEventListener('click', reopenMatch);
    qs('btn-new-match').addEventListener('click', newMatch);
    qs('btn-export').addEventListener('click', openExport);
    qs('btn-import').addEventListener('click', openImport);

    qs('modal').addEventListener('click', function (event) {
      if (event.target.closest && event.target.closest('[data-modal-dismiss]')) closeModal();
    });

    document.addEventListener('keydown', function (event) {
      if (!modalState.open) {
        handleGlobalKeys(event);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        closeModal();
        return;
      }
      if (event.key === 'Tab') trapFocus(event);
      if (modalState.onKey) modalState.onKey(event);
    });

    window.addEventListener('resize', scheduleScrollHint);
  }

  function init() {
    var loaded = loadState();
    state = loaded.state;
    bindEvents();
    renderAll();
    didBoot = true;
    if (!loaded.available) {
      setSaveStatus('Sem armazenamento neste navegador');
      toast('O armazenamento local não está disponível. Dá para jogar, mas os dados somem ao fechar a página.', 'error');
    } else if (loaded.corrupt) {
      toast('Os dados salvos estavam inválidos e foram recomeçados.', 'error');
      saveState();
    } else if (loaded.restored) {
      setSaveStatus('Dados recuperados neste aparelho');
    } else {
      setSaveStatus('Os dados serão salvos neste aparelho');
    }
    scheduleScrollHint();
  }

  init();
})();
