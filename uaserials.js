// UASerials.com — плагін для Lampa
// Версія: 3.0.0

(function () {
    'use strict';

    var SITE  = 'https://uaserials.com';
    var TAG   = 'uaserials';
    var TITLE = 'UASerials';
    var PROXY = 'https://cors.nb557.workers.dev/';

    // Зберігаємо поточний movie коли відкривається сторінка фільму
    var currentMovie = {};

    // ════════════════════════════════════════
    // Утиліти
    // ════════════════════════════════════════

    function px(url) {
        return PROXY + url;
    }

    function clean(s) {
        return (s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    }

    function norm(s) {
        return (s || '').toLowerCase()
            .replace(/ё/g, 'е')
            .replace(/[\s\-\u2013\u2014:,!?.'"«»]+/g, ' ')
            .trim();
    }

    function get(url, ok, fail) {
        var net = new Lampa.Reguest();
        net.timeout(20000);
        net.native(px(url), function (html) {
            ok(html || '');
        }, function (a, c) {
            console.warn('[UASerials] GET error:', url, a, c);
            if (fail) fail();
        }, false, { dataType: 'text' });
        return net;
    }

    function post(url, body, ok, fail) {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', px(url), true);
        xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
        xhr.timeout = 20000;
        xhr.onload = function () {
            if (xhr.status >= 200 && xhr.status < 400) ok(xhr.responseText || '');
            else { console.warn('[UASerials] POST status:', xhr.status); if (fail) fail(); }
        };
        xhr.onerror   = function () { console.warn('[UASerials] POST onerror'); if (fail) fail(); };
        xhr.ontimeout = function () { console.warn('[UASerials] POST timeout'); if (fail) fail(); };
        xhr.send(body);
        return xhr;
    }

    // ════════════════════════════════════════
    // Парсинг HTML
    // ════════════════════════════════════════

    // Результати пошуку → [{id, title, url, year}]
    function parseSearch(html) {
        var out = {}, re = /href=["'](https?:\/\/uaserials\.com\/(\d+)-[^"'#?]+\.html)["'][^>]*>\s*([^<]{2,80})/gi, m;
        while ((m = re.exec(html)) !== null) {
            var id = m[2];
            if (out[id]) continue;
            var t = clean(m[3]);
            if (t.length < 2) continue;
            var yr = html.substring(m.index, m.index + 300).match(/\b(19|20)\d{2}\b/);
            out[id] = { id: id, title: t, url: m[1], year: yr ? yr[0] : '' };
        }
        return Object.values(out);
    }

    // Playerjs playlist JSON зі сторінки фільму
    function parsePage(html) {
        var items = [];

        // Варіант 1: Playerjs({file: "..."})
        var m = html.match(/Playerjs\(\{[\s\S]{0,300}?file\s*:\s*["']([^"']+)["']/i);
        if (m) return [{ title: 'Дивитись', file: m[1] }];

        // Варіант 2: playlist = [...]
        m = html.match(/['"]{0,1}playlist['"]{0,1}\s*[:=]\s*(\[[\s\S]{0,15000}?\])\s*[,;)]/);
        if (m) {
            try {
                var pl = JSON.parse(m[1]);
                if (Array.isArray(pl)) flatten(pl, items);
            } catch (e) {}
        }

        // Варіант 3: iframe або m3u8
        if (!items.length) {
            var pu = (html.match(/<iframe[^>]+src=["']([^"']+)["']/i) ||
                      html.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i) ||
                      html.match(/(https?:\/\/[^\s"'<>]*hdvb[^\s"'<>]*)/i));
            if (pu) {
                var u = pu[1];
                if (u.indexOf('//') === 0) u = 'https:' + u;
                if (u.indexOf('/') === 0)  u = SITE + u;
                items.push({ title: 'Дивитись', file: u });
            }
        }

        return items;
    }

    // Рекурсивно розгортаємо дерево playlist
    function flatten(pl, out, sNum, eNum) {
        pl.forEach(function (node, i) {
            var hasChildren = node.playlist && Array.isArray(node.playlist);
            var title = (node.title || '').trim();

            if (hasChildren) {
                // Це сезон або серія з озвученнями
                var numMatch = title.match(/\d+/);
                var num = numMatch ? parseInt(numMatch[0]) : i + 1;
                if (sNum === undefined) {
                    flatten(node.playlist, out, num, undefined);
                } else {
                    flatten(node.playlist, out, sNum, num);
                }
            } else {
                // Листовий вузол — реальний файл
                var label = sNum !== undefined
                    ? 'С' + sNum + (eNum !== undefined ? ' Е' + eNum : '') + (title ? ' / ' + title : '')
                    : (title || 'Дивитись');
                out.push({
                    title  : label,
                    quality: 'HD',
                    info   : ' / ' + TITLE,
                    season : sNum  || 0,
                    episode: eNum  || 0,
                    voice  : (sNum !== undefined && eNum !== undefined) ? title : '',
                    file   : node.file || ''
                });
            }
        });
    }

    // Найкращий результат пошуку
    function best(results, movie) {
        var year   = parseInt(((movie.release_date || movie.first_air_date || '') + '').slice(0, 4)) || 0;
        var titles = [movie.title, movie.original_title, movie.original_name, movie.name]
            .filter(Boolean).map(norm);

        function score(r) {
            var s = 0, n = norm(r.title);
            titles.forEach(function (t) {
                if (n === t) s += 10;
                else if (n.indexOf(t) !== -1 || t.indexOf(n) !== -1) s += 4;
            });
            if (year && r.year && parseInt(r.year) === year) s += 3;
            return s;
        }

        results.sort(function (a, b) { return score(b) - score(a); });
        return (results[0] && score(results[0]) >= 1) ? results[0] : null;
    }

    // ════════════════════════════════════════
    // Компонент Activity
    // ════════════════════════════════════════

    function UaComponent(object) {
        var movie  = object.movie || object.card || {};
        var active = false;
        var wrap   = $('<div style="padding:1em"></div>');

        // --- UI ---

        function loader() {
            wrap.html(
                '<div style="text-align:center;padding:4em">' +
                '<div class="broadcast__scan"><div></div></div>' +
                '<div style="margin-top:1em;opacity:.6">Шукаємо на ' + TITLE + '…</div>' +
                '</div>'
            );
        }

        function empty(msg) {
            wrap.html(
                '<div class="empty" style="text-align:center;padding:4em">' +
                '<div class="empty__title">' + (msg || 'Нічого не знайдено') + '</div>' +
                '</div>'
            );
        }

        function render(fileItems) {
            if (!active) return;
            if (!fileItems.length) { empty(); return; }

            wrap.empty();
            var list = $('<div class="torrent-list"></div>');

            fileItems.forEach(function (el) {
                var viewed  = Lampa.Storage.cache('online_view', 5000, []);
                var hkey    = el.season
                    ? [el.season, el.episode, movie.original_title || movie.title, el.voice || ''].join(':')
                    : (movie.original_title || movie.title || '') + el.title;
                var hash    = Lampa.Utils.hash(hkey);
                var tl      = Lampa.Timeline.view(hash);

                var row = Lampa.Template.get('online_mod', {
                    title  : el.title || TITLE,
                    quality: el.quality || 'HD',
                    info   : el.info   || (' / ' + TITLE),
                    season : el.season  || 0,
                    episode: el.episode || 0
                });

                el.timeline = tl;
                row.append(Lampa.Timeline.render(tl));

                if (viewed.indexOf(hash) !== -1)
                    row.append('<div class="torrent-item__viewed">' + Lampa.Template.get('icon_star', {}, true) + '</div>');

                row.on('hover:enter', function () {
                    if (!el.file) { Lampa.Noty.show('Посилання не знайдено'); return; }
                    if (movie.id) Lampa.Favorite.add('history', movie, 100);

                    var first = { url: el.file, title: el.title || movie.title, timeline: el.timeline };
                    Lampa.Player.play(first);
                    Lampa.Player.playlist(
                        el.season && fileItems.length > 1
                            ? fileItems.map(function (x) { return { url: x.file || '', title: x.title, timeline: x.timeline }; })
                            : [first]
                    );

                    if (viewed.indexOf(hash) === -1) {
                        viewed.push(hash);
                        row.append('<div class="torrent-item__viewed">' + Lampa.Template.get('icon_star', {}, true) + '</div>');
                        Lampa.Storage.set('online_view', viewed);
                    }
                });

                list.append(row);
            });

            wrap.append(list);
            setTimeout(function () { wrap.find('.selector').first().trigger('hover:focus'); }, 100);
        }

        // --- Пошук ---

        function search() {
            var queries = [movie.original_title, movie.original_name, movie.title, movie.name, object.search]
                .filter(function (q, i, a) { return q && a.indexOf(q) === i; });

            var i = 0;
            function next() {
                if (!active) return;
                if (i >= queries.length) { empty('Не знайдено: ' + (movie.title || '')); return; }
                var q = queries[i++];

                var body = 'do=search&subaction=search&story=' + encodeURIComponent(q);
                post(SITE + '/', body, function (html) {
                        var r = parseSearch(html);
                        var b = best(r, movie);
                        if (!b) { next(); return; }

                        get(b.url, function (html2) {
                            var items = parsePage(html2);
                            if (items.length) render(items); else next();
                        }, next);
                    }, next);
            }
            next();
        }

        // --- Інтерфейс компонента ---

        this.create  = function () { active = true; loader(); search(); return wrap; };
        this.render  = function () { return wrap; };
        this.back    = function () { Lampa.Activity.backward(); };
        this.pause   = function () {};
        this.resume  = function () {};
        this.start   = function () {};
        this.destroy = function () { active = false; wrap.remove(); };
    }

    // ════════════════════════════════════════
    // Впровадження у вікно "Источник"
    // ════════════════════════════════════════

    function patchSelect() {
        var _show = Lampa.Select.show.bind(Lampa.Select);

        Lampa.Select.show = function (params) {
            if (!params || !params.items) return _show(params);

            // Перевіряємо чи це вікно вибору джерела
            var isSource = params.items.some(function (i) {
                var t = (i.title || '').replace(/\s+/g, '');
                return t === 'Shots' || t === 'Трейлеры' || t === 'Трейлери';
            });
            if (!isSource) return _show(params);

            // Не дублюємо
            if (params.items.some(function (i) {
                return (i.title || '').replace(/\s+/g, '') === TITLE;
            })) return _show(params);

            // Використовуємо movie збережений при відкритті сторінки фільму
            var movie = currentMovie;
            console.log('[UASerials] movie:', movie.title || '(empty)');

            // Наш пункт
            var newItems = [{ title: TITLE, subtitle: 'Серіали та фільми українською' }]
                .concat(params.items);

            var _onSelect = params.onSelect;
            var p = Object.assign({}, params, {
                items: newItems,
                onSelect: function (item) {
                    if ((item.title || '').replace(/\s+/g, '') === TITLE) {
                        setTimeout(function () {
                            Lampa.Activity.push({
                                url      : '',
                                title    : TITLE + (movie.title ? ': ' + movie.title : ''),
                                component: TAG,
                                movie    : movie,
                                search   : movie.title || '',
                                page     : 1
                            });
                        }, 100);
                        return;
                    }
                    if (_onSelect) _onSelect(item);
                }
            });

            return _show(p);
        };
    }

    // ════════════════════════════════════════
    // Старт
    // ════════════════════════════════════════

    function init() {
        Lampa.Component.add(TAG, UaComponent);

        // Перехоплюємо Activity.push — найнадійніший спосіб зловити movie
        // Lampa завжди викликає push коли відкриває сторінку фільму
        var _push = Lampa.Activity.push.bind(Lampa.Activity);
        Lampa.Activity.push = function (object) {
            // Lampa зберігає фільм в object.card, не object.movie
            var m = object.card || object.movie;
            if (m && m.id) {
                currentMovie = m;
                console.log('[UASerials] saved movie:', currentMovie.title);
            }
            return _push(object);
        };

        patchSelect();
        console.log('[' + TITLE + '] v3.2 ✓');
    }

    if (window.appready) init();
    else Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') init(); });

})();
