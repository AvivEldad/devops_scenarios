/*
 * BreakFix Lab - catalog + scenario viewer.
 * No build step, no framework: open index.html through any static server.
 */
(function () {
  'use strict';

  var STORE_KEY = 'breakfix-progress-v1';

  /* ------------------------------------------------------------------ *
   * progress (localStorage)
   * ------------------------------------------------------------------ */
  function loadProgress() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function saveProgress(p) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(p)); } catch (e) {}
  }
  function isSolved(id) { return !!(loadProgress()[id] || {}).solved; }
  function setSolved(id, solved) {
    var p = loadProgress();
    p[id] = p[id] || {};
    p[id].solved = solved;
    p[id].at = solved ? new Date().toISOString() : null;
    saveProgress(p);
  }

  /* ------------------------------------------------------------------ *
   * scenario markdown parsing
   *
   * Sections are level-2 headings. Code fences are respected so that a
   * "## " inside a shell snippet never splits the document.
   * ------------------------------------------------------------------ */
  function splitSections(text, marker) {
    var lines = text.replace(/\r\n/g, '\n').split('\n');
    var out = [];
    var current = { title: null, body: [] };
    var inFence = false;
    var re = new RegExp('^' + marker + '\\s+(.*)$');

    lines.forEach(function (line) {
      if (/^\s*```/.test(line)) inFence = !inFence;
      var m = !inFence && line.match(re);
      if (m) {
        out.push(current);
        current = { title: m[1].trim(), body: [] };
      } else {
        current.body.push(line);
      }
    });
    out.push(current);
    return out.map(function (s) {
      return { title: s.title, body: s.body.join('\n').trim() };
    });
  }

  function parseScenario(text) {
    var doc = { title: '', sections: {}, files: [], hints: [] };
    var parts = splitSections(text, '##');

    var preamble = parts.shift();
    var h1 = preamble.body.match(/^#\s+(.*)$/m);
    doc.title = h1 ? h1[1].trim() : '';

    parts.forEach(function (sec) {
      var key = sec.title.toLowerCase();

      if (key.indexOf('starter files') === 0) {
        splitSections(sec.body, '###').forEach(function (f) {
          if (!f.title) {
            if (f.body) doc.sections.filesIntro = f.body;
            return;
          }
          var name = f.title.replace(/^file:\s*/i, '').trim();
          var fence = f.body.match(/```(\S*)\n([\s\S]*?)\n?```/);
          doc.files.push({
            name: name,
            lang: fence ? fence[1] : '',
            content: fence ? fence[2] : f.body,
            note: f.body.replace(/```[\s\S]*?```/, '').trim()
          });
        });
        return;
      }

      if (key.indexOf('hints') === 0) {
        splitSections(sec.body, '###').forEach(function (hn) {
          if (!hn.title) return;
          doc.hints.push({ title: hn.title, body: hn.body });
        });
        return;
      }

      doc.sections[sec.title] = sec.body;
    });

    return doc;
  }

  /* ------------------------------------------------------------------ *
   * shared helpers
   * ------------------------------------------------------------------ */
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
  }

  function attachCopy(btn, getText) {
    btn.addEventListener('click', function () {
      var text = getText();
      var done = function () {
        btn.textContent = 'copied';
        btn.classList.add('done');
        setTimeout(function () {
          btn.textContent = 'copy';
          btn.classList.remove('done');
        }, 1400);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { fallback(text, done); });
      } else {
        fallback(text, done);
      }
    });
  }

  function fallback(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) {}
    document.body.removeChild(ta);
  }

  function fetchJSON(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' -> HTTP ' + r.status);
      return r.json();
    });
  }

  function fetchText(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' -> HTTP ' + r.status);
      return r.text();
    });
  }

  function fileProtocolWarning(root) {
    root.innerHTML =
      '<div class="panel" style="margin-top:40px">' +
      '<div class="panel-head"><span class="dot"></span>Serve this over HTTP</div>' +
      '<div class="md"><p>You opened the page with the <code>file://</code> protocol, which blocks the ' +
      'browser from loading the scenario files.</p><p>Run a static server from the project root instead:</p>' +
      '<pre><code>cd ' + '/path/to/devops-scenarios\npython3 -m http.server 8080</code></pre>' +
      '<p>Then open <code>http://localhost:8080</code>.</p></div></div>';
  }

  /* ------------------------------------------------------------------ *
   * index page
   * ------------------------------------------------------------------ */
  function initIndex() {
    var catalogEl = document.getElementById('catalog');
    var state = { topic: 'all', level: 'all', hideSolved: false, data: null };

    if (location.protocol === 'file:') { fileProtocolWarning(catalogEl); return; }

    fetchJSON('data/scenarios.json').then(function (data) {
      state.data = data;
      buildChips(data);
      render();
      wire();
    }).catch(function (err) {
      catalogEl.innerHTML = '<p class="empty">Could not load the catalog: ' +
        md.escapeHtml(err.message) + '</p>';
    });

    function buildChips(data) {
      var topics = document.getElementById('topicChips');
      var levels = document.getElementById('levelChips');

      var topicList = [{ id: 'all', name: 'All' }].concat(data.topics);
      topicList.forEach(function (t) {
        var count = t.id === 'all'
          ? data.scenarios.length
          : data.scenarios.filter(function (s) { return s.topic === t.id; }).length;
        var b = el('button', 'chip' + (t.id === 'all' ? ' active' : ''),
          md.escapeHtml(t.name) + '<span class="count">' + count + '</span>');
        b.dataset.topic = t.id;
        topics.appendChild(b);
      });

      [['all', 'All'], ['beginner', 'Beginner'], ['intermediate', 'Intermediate'], ['expert', 'Expert']]
        .forEach(function (pair) {
          var count = pair[0] === 'all'
            ? data.scenarios.length
            : data.scenarios.filter(function (s) { return s.level === pair[0]; }).length;
          var b = el('button', 'chip' + (pair[0] === 'all' ? ' active' : ''),
            pair[1] + '<span class="count">' + count + '</span>');
          b.dataset.level = pair[0];
          levels.appendChild(b);
        });
    }

    function wire() {
      document.getElementById('topicChips').addEventListener('click', function (e) {
        var b = e.target.closest('.chip');
        if (!b) return;
        state.topic = b.dataset.topic;
        [].forEach.call(this.children, function (c) { c.classList.toggle('active', c === b); });
        render();
      });
      document.getElementById('levelChips').addEventListener('click', function (e) {
        var b = e.target.closest('.chip');
        if (!b) return;
        state.level = b.dataset.level;
        [].forEach.call(this.children, function (c) { c.classList.toggle('active', c === b); });
        render();
      });
      document.getElementById('hideSolved').addEventListener('change', function () {
        state.hideSolved = this.checked;
        render();
      });
      document.getElementById('resetProgress').addEventListener('click', function () {
        if (confirm('Clear your solved marks for every scenario?')) {
          saveProgress({});
          render();
        }
      });
    }

    function render() {
      var data = state.data;
      var progress = loadProgress();
      var solvedCount = data.scenarios.filter(function (s) {
        return (progress[s.id] || {}).solved;
      }).length;
      document.getElementById('globalProgress').textContent =
        solvedCount + ' / ' + data.scenarios.length + ' solved';

      var list = data.scenarios.filter(function (s) {
        if (state.topic !== 'all' && s.topic !== state.topic) return false;
        if (state.level !== 'all' && s.level !== state.level) return false;
        if (state.hideSolved && (progress[s.id] || {}).solved) return false;
        return true;
      });

      catalogEl.innerHTML = '';
      if (!list.length) {
        catalogEl.appendChild(el('p', 'empty', 'No scenarios match those filters.'));
        return;
      }

      var order = ['beginner', 'intermediate', 'expert'];
      data.topics.forEach(function (topic) {
        var mine = list.filter(function (s) { return s.topic === topic.id; });
        if (!mine.length) return;
        mine.sort(function (a, b) { return order.indexOf(a.level) - order.indexOf(b.level); });

        var block = el('div', 'topic-block');
        var head = el('div', 'topic-head');
        head.appendChild(el('h2', null, md.escapeHtml(topic.name)));
        head.appendChild(el('span', 'topic-desc', md.escapeHtml(topic.desc || '')));
        block.appendChild(head);

        var cards = el('div', 'cards');
        mine.forEach(function (s) {
          var solved = !!(progress[s.id] || {}).solved;
          var a = el('a', 'card' + (solved ? ' solved' : ''));
          a.href = 'scenario.html?id=' + encodeURIComponent(s.id);

          var top = el('div', 'card-top');
          top.appendChild(el('span', 'badge badge-' + s.level, s.level));
          if (s.kind === 'drill') top.appendChild(el('span', 'badge badge-drill', 'drill'));
          if (solved) top.appendChild(el('span', 'card-solved-mark', '&#10003; solved'));
          a.appendChild(top);

          a.appendChild(el('h3', null, md.escapeHtml(s.title)));
          a.appendChild(el('p', null, md.escapeHtml(s.summary)));

          var meta = el('div', 'card-meta');
          meta.appendChild(el('span', null, '&#9201; ' + md.escapeHtml(s.time)));
          (s.prereqs || []).forEach(function (p) {
            meta.appendChild(el('span', 'prereq', md.escapeHtml(p)));
          });
          a.appendChild(meta);

          cards.appendChild(a);
        });

        block.appendChild(cards);
        catalogEl.appendChild(block);
      });
    }
  }

  /* ------------------------------------------------------------------ *
   * scenario page
   * ------------------------------------------------------------------ */
  function initScenario() {
    var root = document.getElementById('scenarioRoot');
    if (location.protocol === 'file:') { fileProtocolWarning(root); return; }

    var id = new URLSearchParams(location.search).get('id');
    if (!id) {
      root.innerHTML = '<p class="empty">No scenario selected. <a href="index.html">Back to the catalog</a>.</p>';
      return;
    }

    fetchJSON('data/scenarios.json').then(function (data) {
      var meta = data.scenarios.filter(function (s) { return s.id === id; })[0];
      if (!meta) throw new Error('Unknown scenario id: ' + id);
      var topic = data.topics.filter(function (t) { return t.id === meta.topic; })[0] || { name: meta.topic };
      return fetchText(meta.path).then(function (text) {
        renderScenario(root, data, meta, topic, parseScenario(text));
      });
    }).catch(function (err) {
      root.innerHTML = '<p class="empty">Could not load this scenario: ' +
        md.escapeHtml(err.message) + '</p>';
    });
  }

  function panel(title, body, extraClass) {
    var p = el('div', 'panel' + (extraClass ? ' ' + extraClass : ''));
    var head = el('div', 'panel-head');
    head.appendChild(el('span', 'dot'));
    head.appendChild(document.createTextNode(title));
    p.appendChild(head);
    var content = el('div', 'md', md.render(body));
    p.appendChild(content);
    return p;
  }

  function renderScenario(root, data, meta, topic, doc) {
    document.title = doc.title + ' — BreakFix Lab';
    root.innerHTML = '';

    /* header */
    var header = el('div', 'sc-header');
    header.appendChild(el('div', 'sc-crumbs',
      '<a href="index.html">All scenarios</a> / ' + md.escapeHtml(topic.name)));
    header.appendChild(el('h1', null, md.escapeHtml(doc.title)));
    var badges = el('div', 'sc-badges');
    badges.appendChild(el('span', 'badge badge-topic', md.escapeHtml(topic.name)));
    badges.appendChild(el('span', 'badge badge-' + meta.level, meta.level));
    if (meta.kind === 'drill') badges.appendChild(el('span', 'badge badge-drill', 'drill'));
    badges.appendChild(el('span', 'card-meta', '&#9201; ' + md.escapeHtml(meta.time)));
    (meta.prereqs || []).forEach(function (p) {
      badges.appendChild(el('span', 'prereq card-meta', md.escapeHtml(p)));
    });
    header.appendChild(badges);
    root.appendChild(header);

    var body = el('div', 'sc-body');
    root.appendChild(body);

    var S = doc.sections;
    var pick = function (names) {
      for (var i = 0; i < names.length; i++) {
        for (var k in S) {
          if (k.toLowerCase() === names[i]) return S[k];
        }
      }
      return null;
    };

    if (pick(['briefing'])) body.appendChild(panel('Briefing', pick(['briefing'])));
    if (pick(['your task', 'task'])) body.appendChild(panel('Your task', pick(['your task', 'task'])));

    /* starter files */
    if (doc.files.length) {
      var fp = el('div', 'panel');
      var fh = el('div', 'panel-head');
      fh.appendChild(el('span', 'dot'));
      fh.appendChild(document.createTextNode('Starter files (broken on purpose)'));
      fp.appendChild(fh);
      if (doc.sections.filesIntro) {
        fp.appendChild(el('div', 'md', md.render(doc.sections.filesIntro)));
      }
      doc.files.forEach(function (f) {
        var block = el('div', 'file-block');
        var head = el('div', 'file-head');
        head.appendChild(el('span', 'file-name', md.escapeHtml(f.name)));
        var btn = el('button', 'copy-btn', 'copy');
        attachCopy(btn, function () { return f.content; });
        head.appendChild(btn);
        block.appendChild(head);
        block.appendChild(el('div', 'md',
          '<pre><code class="lang-' + md.escapeHtml(f.lang) + '">' +
          md.escapeHtml(f.content) + '</code></pre>'));
        if (f.note) block.appendChild(el('div', 'md', md.render(f.note)));
        fp.appendChild(block);
      });
      body.appendChild(fp);
    }

    var fail = pick(['expected failure', 'what you should see', 'the failure']);
    if (fail) body.appendChild(panel('What failure looks like', fail, 'panel-fail'));

    var expected = pick(['expected outcome', 'expected outcome (when fixed)', 'definition of done']);
    if (expected) body.appendChild(panel('Expected outcome — self-check', expected, 'panel-expected'));

    /* hints */
    if (doc.hints.length) {
      var hp = el('div', 'panel');
      var hh = el('div', 'panel-head');
      hh.appendChild(el('span', 'dot'));
      hh.appendChild(document.createTextNode('Hints (' + doc.hints.length + ') — try without them first'));
      hp.appendChild(hh);
      doc.hints.forEach(function (hint, i) {
        var wrap = el('div', 'hint');
        var btn = el('button', 'hint-head');
        btn.appendChild(el('span', 'hint-num', 'Hint ' + (i + 1)));
        btn.appendChild(document.createTextNode(hint.title.replace(/^hint\s*\d+\s*[-–—:]?\s*/i, '')));
        btn.appendChild(el('span', 'chev', '&#9654;'));
        btn.addEventListener('click', function () { wrap.classList.toggle('open'); });
        wrap.appendChild(btn);
        wrap.appendChild(el('div', 'hint-body md', md.render(hint.body)));
        hp.appendChild(wrap);
      });
      body.appendChild(hp);
    }

    /* solution */
    var solution = pick(['solution']);
    if (solution) {
      var sp = el('div', 'panel');
      var sh = el('div', 'panel-head');
      sh.appendChild(el('span', 'dot'));
      sh.appendChild(document.createTextNode('Solution'));
      sp.appendChild(sh);

      var guard = el('div', 'solution-guard');
      guard.appendChild(el('p', null,
        'Spoilers. Open this only after you have made the system fail and tried to fix it.'));
      var reveal = el('button', 'btn btn-accent', 'Reveal the solution');
      guard.appendChild(reveal);
      sp.appendChild(guard);

      var solBody = el('div', 'solution-body md', md.render(solution));
      sp.appendChild(solBody);

      reveal.addEventListener('click', function () {
        solBody.classList.add('revealed');
        guard.style.display = 'none';
      });
      body.appendChild(sp);
    }

    var learned = pick(['what you learned', 'why this matters', 'takeaway']);
    if (learned) body.appendChild(panel('Why this matters on the job', learned));

    /* mark complete */
    var bar = el('div', 'complete-bar');
    var txt = el('div', 'cb-text');
    bar.appendChild(txt);
    var spacer = el('div', 'spacer');
    bar.appendChild(spacer);
    var toggle = el('button', 'btn btn-green');
    bar.appendChild(toggle);

    function paint() {
      var solved = isSolved(meta.id);
      txt.innerHTML = solved
        ? '<strong>Marked solved.</strong> Your fix matched the expected outcome.'
        : 'Ran the checks in <strong>Expected outcome</strong> and they all pass?';
      toggle.textContent = solved ? 'Unmark' : 'Mark as solved';
      toggle.className = 'btn ' + (solved ? 'btn-ghost' : 'btn-green');
    }
    toggle.addEventListener('click', function () {
      setSolved(meta.id, !isSolved(meta.id));
      paint();
    });
    paint();
    body.appendChild(bar);

    /* prev / next within the same topic */
    var order = ['beginner', 'intermediate', 'expert'];
    var siblings = data.scenarios.filter(function (s) { return s.topic === meta.topic; })
      .sort(function (a, b) { return order.indexOf(a.level) - order.indexOf(b.level); });
    var idx = siblings.map(function (s) { return s.id; }).indexOf(meta.id);
    var nav = el('div', 'sc-nav');
    if (idx > 0) {
      var prev = el('a', 'btn', '&larr; ' + md.escapeHtml(siblings[idx - 1].title));
      prev.href = 'scenario.html?id=' + encodeURIComponent(siblings[idx - 1].id);
      nav.appendChild(prev);
    } else {
      nav.appendChild(el('span'));
    }
    if (idx > -1 && idx < siblings.length - 1) {
      var next = el('a', 'btn', md.escapeHtml(siblings[idx + 1].title) + ' &rarr;');
      next.href = 'scenario.html?id=' + encodeURIComponent(siblings[idx + 1].id);
      nav.appendChild(next);
    }
    body.appendChild(nav);
  }

  /* ------------------------------------------------------------------ */
  if (document.getElementById('catalog')) initIndex();
  else if (document.getElementById('scenarioRoot')) initScenario();
})();
