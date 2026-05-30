// UASerials.com — плагін для Lampa v4.0
(function () {
    'use strict';

    var SITE  = 'https://uaserials.com';
    var TAG   = 'uaserials';
    var TITLE = 'UASerials';
    var PROXY = 'https://api.codetabs.com/v1/proxy/?quest=';

    // ════════════════════════════
    // Утиліти
    // ════════════════════════════

    function px(url) {
        return PROXY + encodeURIComponent(url);
    }

    function clean(s) {
        return (s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }

    function norm(s) {
        return (s || '').toLowerCase().replace(/ё/g, 'е')
            .replace(/[\s\-\u2013\u2014:,!?.'"«»]+/g, ' ').trim();
    }

    function isLatin(s) {
        return /^[a-zA-Z0-9\s\-\.,:!?'&]+$/.test(s || '');
    }

    function translit(s) {
        var m = {'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'yo','ж':'zh',
            'з':'z','и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p',
            'р':'r','с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch',
            'ш':'sh','щ':'sch','ы':'y','э':'e','ю':'yu','я':'ya','і':'i','ї':'yi',
            'є':'ye','ґ':'g','ъ':'','ь':''};
        return (s||'').toLowerCase().split('').map(function(c){return m[c]!==undefined?m[c]:c;}).join('').trim();
    }

    function get(url, ok, fail) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', px(url), true);
        xhr.timeout = 20000;
        xhr.onload = function () {
            if (xhr.status >= 200 && xhr.status < 400) ok(xhr.responseText || '');
            else { if (fail) fail(); }
        };
        xhr.onerror = xhr.ontimeout = function () { if (fail) fail(); };
        xhr.send();
    }

    // ════════════════════════════
    // Парсинг
    // ════════════════════════════

    function parseSearch(html) {
        var results = [], seen = {};
        var re = /<a[^>]+class="[^"]*uas-card[^"]*"[^>]+href="([^"]+)"[^>]+data-uas-id="(\d+)"[^>]*>([\s\S]*?)<\/a>/gi;
        var m;
        while ((m = re.exec(html)) !== null) {
            var url = m[1], id = m[2], inner = m[3];
            if (seen[id]) continue;
            seen[id] = true;
            if (url.indexOf('/') === 0) url = SITE + url;
            var tm = inner.match(/<span[^>]*uas-card__title[^>]*>([^<]+)<\/span>/i);
            var om = inner.match(/<span[^>]*uas-card__orig[^>]*>([\s\S]*?)<\/span>/i);
            var ym = inner.match(/<span[^>]*uas-card__year[^>]*>(\d{4})<\/span>/i);
            var rm = inner.match(/<span[^>]*uas-card__rating[^>]*>([\d.]+)<\/span>/i);
            var title = tm ? clean(tm[1]) : '';
            var orig  = om ? clean(om[1]) : '';
            var year  = ym ? ym[1] : '';
            var rating = rm ? rm[1] : '';
            if (!title && !orig) continue;
            results.push({ id: id, title: title || orig, orig: orig, url: url, year: year, rating: rating });
        }
        return results;
    }

    // Розшифрувати player-control через uasPlayer.js логіку
    // Повертає масив { title, file }
    function parseEpisodes(html) {
        var items = [];

        // Варіант 1: шукаємо playlist JSON у скриптах
        var pm = html.match(/['"]{0,1}playlist['"]{0,1}\s*[:=]\s*(\[[\s\S]{0,20000}?\])\s*[,;)]/);
        if (pm) {
            try {
                var pl = JSON.parse(pm[1]);
                if (Array.isArray(pl) && pl.length) {
                    flattenPlaylist(pl, items);
                    if (items.length) return items;
                }
            } catch(e) {}
        }

        // Варіант 2: Playerjs({file:...})
        var pj = html.match(/Playerjs\(\{[\s\S]{0,300}?file\s*:\s*["']([^"']+)["']/i);
        if (pj) return [{ title: 'Серія 1', file: pj[1] }];

        // Варіант 3: пряме m3u8
        var m3 = html.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
        if (m3) return [{ title: 'Серія 1', file: m3[1] }];

        // Варіант 4: player-control з зашифрованими даними — повертаємо encrypted об'єкт
        var pc = html.match(/<player-control[^>]+data-tag1='({[^']+})'[^>]*>/i);
        if (pc) {
            try {
                var enc = JSON.parse(pc[1]);
                items.push({ title: 'Серія 1', file: '', encrypted: enc, needsKey: true });
            } catch(e) {}
        }

        return items;
    }

    function flattenPlaylist(pl, out, sNum, eNum) {
        pl.forEach(function (node, i) {
            var title = (node.title || '').trim();
            if (node.playlist && Array.isArray(node.playlist)) {
                var num = parseInt(title.match(/\d+/)) || (i + 1);
                if (sNum === undefined) flattenPlaylist(node.playlist, out, num, undefined);
                else flattenPlaylist(node.playlist, out, sNum, num);
            } else {
                var label = sNum !== undefined
                    ? 'С' + sNum + (eNum !== undefined ? ' Е' + eNum : '') + (title ? ' / ' + title : '')
                    : (title || 'Серія ' + (i + 1));
                out.push({ title: label, file: node.file || '', season: sNum || 0, episode: eNum || 0 });
            }
        });
    }

    // ════════════════════════════
    // Компонент
    // ════════════════════════════

    function UaComponent(object) {
        var movie   = object.movie || object.card || {};
        var active  = false;
        var wrap    = $('<div class="uaserials-wrap" style="padding:1em"></div>');
        var history = []; // стек екранів для кнопки "назад"

        // --- UI helpers ---

        function loader(msg) {
            wrap.html(
                '<div style="text-align:center;padding:4em">' +
                '<div class="broadcast__scan"><div></div></div>' +
                '<div style="margin-top:1em;opacity:.6">' + (msg || 'Завантаження…') + '</div>' +
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

        // Побудувати рядок списку (використовуємо стандартний шаблон Lampa)
        function makeRow(title, sub, onEnter) {
            var item = $('<div class="torrent-item selector" style="padding:.6em 1em;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.05)">' +
                '<div class="torrent-item__title" style="font-size:1em;font-weight:600">' + title + '</div>' +
                (sub ? '<div class="torrent-item__info" style="opacity:.6;font-size:.85em;margin-top:.2em">' + sub + '</div>' : '') +
                '</div>');
            item.on('hover:enter', onEnter);
            return item;
        }

        // ── Екран 1: результати пошуку ──
        function showResults(results) {
            if (!active) return;
            wrap.empty();

            if (!results.length) { empty('Нічого не знайдено на ' + TITLE); return; }

            var header = $('<div style="padding:.5em 1em 1em;opacity:.5;font-size:.85em">Знайдено ' + results.length + ' результатів</div>');
            wrap.append(header);

            var list = $('<div></div>');
            results.forEach(function (r) {
                var sub = [r.orig, r.year, r.rating ? '★ ' + r.rating : ''].filter(Boolean).join(' · ');
                var row = makeRow(r.title, sub, function () {
                    history.push(function(){ showResults(results); });
                    loader('Завантажуємо…');
                    get(r.url, function (html) {
                        var eps = parseEpisodes(html);
                        showEpisodes(eps, r);
                    }, function () { empty('Помилка завантаження'); });
                });
                list.append(row);
            });

            wrap.append(list);
            setTimeout(function () { wrap.find('.selector').first().trigger('hover:focus'); }, 100);
        }

        // ── Екран 2: список епізодів ──
        function showEpisodes(eps, movieInfo) {
            if (!active) return;
            wrap.empty();

            if (!eps.length) { empty('Не вдалося знайти відео'); return; }

            var header = $('<div style="padding:.5em 1em 1em">' +
                '<div style="font-size:1.1em;font-weight:700">' + (movieInfo.title || '') + '</div>' +
                (movieInfo.year ? '<div style="opacity:.5;font-size:.85em">' + movieInfo.year + '</div>' : '') +
                '</div>');
            wrap.append(header);

            var list = $('<div></div>');
            eps.forEach(function (ep) {
                var row = makeRow(ep.title || 'Серія 1', ep.file ? '' : '🔒 Захищено', function () {
                    if (!ep.file && ep.needsKey) {
                        Lampa.Noty.show('Відео захищено шифруванням — потрібен ключ');
                        return;
                    }
                    if (!ep.file) { Lampa.Noty.show('Посилання не знайдено'); return; }
                    playEpisode(ep, eps, movieInfo);
                });
                list.append(row);
            });

            wrap.append(list);
            setTimeout(function () { wrap.find('.selector').first().trigger('hover:focus'); }, 100);
        }

        // ── Відтворення ──
        function playEpisode(ep, allEps, movieInfo) {
            if (movie.id) Lampa.Favorite.add('history', movie, 100);

            var viewed  = Lampa.Storage.cache('online_view', 5000, []);
            var hashKey = (ep.season ? [ep.season, ep.episode, movie.title].join(':') : (movie.title || '') + ep.title);
            var hash    = Lampa.Utils.hash(hashKey);
            var tl      = Lampa.Timeline.view(hash);

            var first = { url: ep.file, title: ep.title, timeline: tl };
            Lampa.Player.play(first);

            var playlist = allEps.filter(function(e){ return !!e.file; }).map(function (e) {
                var h = Lampa.Utils.hash(e.season ? [e.season, e.episode, movie.title].join(':') : (movie.title||'') + e.title);
                return { url: e.file, title: e.title, timeline: Lampa.Timeline.view(h) };
            });
            Lampa.Player.playlist(playlist.length ? playlist : [first]);

            if (viewed.indexOf(hash) === -1) {
                viewed.push(hash);
                Lampa.Storage.set('online_view', viewed);
            }
        }

        // ── Пошук ──
        function buildQueries() {
            var all = [movie.name, movie.title, movie.original_title, movie.original_name, object.search]
                .filter(function (q, i, a) { return q && a.indexOf(q) === i; });
            var latin = all.filter(isLatin);
            var cyr   = all.filter(function(q){ return !isLatin(q) && /[а-яёіїєґА-ЯЁІЇЄҐ]/.test(q); }).map(translit);
            return latin.concat(cyr.filter(function(q){ return latin.indexOf(q) === -1; }));
        }

        function search() {
            var queries = buildQueries();
            console.log('[UASerials] queries:', queries);
            if (!queries.length) { empty('Немає підходящого запиту'); return; }

            var allResults = [], tried = 0, seen = {};

            function tryNext() {
                if (!active) return;
                if (tried >= queries.length) {
                    if (allResults.length) showResults(allResults);
                    else empty('Не знайдено: ' + (movie.title || ''));
                    return;
                }
                var q = queries[tried++];
                loader('Шукаємо «' + q + '»…');
                get(SITE + '/?do=search&subaction=search&story=' + q, function (html) {
                    var res = parseSearch(html);
                    res.forEach(function(r){ if (!seen[r.id]) { seen[r.id] = true; allResults.push(r); } });
                    tryNext();
                }, function () { tryNext(); });
            }

            tryNext();
        }

        // ── Кнопка "Назад" ──
        this.back = function () {
            if (history.length) {
                var prev = history.pop();
                prev();
            } else {
                Lampa.Activity.backward();
            }
        };

        this.create  = function () { active = true; search(); return wrap; };
        this.render  = function () { return wrap; };
        this.pause   = function () {};
        this.resume  = function () {};
        this.start   = function () {};
        this.destroy = function () { active = false; wrap.remove(); };
    }

    // ════════════════════════════
    // Впровадження у "Источник"
    // ════════════════════════════

    var currentMovie = {};

    function patchSelect() {
        var _show = Lampa.Select.show.bind(Lampa.Select);
        Lampa.Select.show = function (params) {
            if (!params || !params.items) return _show(params);
            var isSource = params.items.some(function (i) {
                var t = (i.title || '').replace(/\s+/g, '');
                return t === 'Shots' || t === 'Трейлеры' || t === 'Трейлери';
            });
            if (!isSource) return _show(params);
            if (params.items.some(function (i) { return (i.title || '').replace(/\s+/g, '') === TITLE; }))
                return _show(params);

            var movie = currentMovie;
            var newItems = [{ title: TITLE, subtitle: 'Серіали та фільми українською' }].concat(params.items);
            var _onSelect = params.onSelect;
            var p = Object.assign({}, params, {
                items: newItems,
                onSelect: function (item) {
                    if ((item.title || '').replace(/\s+/g, '') === TITLE) {
                        setTimeout(function () {
                            Lampa.Activity.push({
                                url: '', title: TITLE + (movie.title ? ': ' + movie.title : ''),
                                component: TAG, movie: movie, card: movie, search: movie.title || '', page: 1
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

    // ════════════════════════════
    // Старт
    // ════════════════════════════

    function init() {
        Lampa.Component.add(TAG, UaComponent);

        // Зберігаємо movie при відкритті сторінки фільму
        var _push = Lampa.Activity.push.bind(Lampa.Activity);
        Lampa.Activity.push = function (obj) {
            var m = (obj && (obj.card || obj.movie));
            if (m && m.id) { currentMovie = m; }
            return _push(obj);
        };

        patchSelect();
        console.log('[UASerials] v4.0 ✓');
    }

    if (window.appready) init();
    else Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') init(); });

})();
