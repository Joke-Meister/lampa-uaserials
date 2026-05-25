// UASerials.com — standalone плагін для Lampa
// Версія: 2.1.0

(function () {
    'use strict';

    var SITE       = 'https://uaserials.com';
    var PLUGIN_TAG = 'uaserials';
    var TITLE      = 'UASerials';

    // --------------------------------------------------
    // Утиліти
    // --------------------------------------------------

    function proxyUrl(url) {
        if (Lampa.Storage.field(PLUGIN_TAG + '_proxy') === true) {
            return 'https://cors.nb557.workers.dev/' + url;
        }
        return url;
    }

    function cleanText(s) {
        return (s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    }

    function norm(s) {
        return (s || '').toLowerCase()
            .replace(/[\s\-\u2013\u2014:,!?.'"«»]+/g, ' ')
            .replace(/ё/g, 'е').trim();
    }

    function httpGet(url, onOk, onErr) {
        var net = new Lampa.Reguest();
        net.timeout(15000);
        net.native(proxyUrl(url), function (html) {
            onOk(html || '');
        }, function (a, c) {
            if (onErr) onErr(net.errorDecode ? net.errorDecode(a, c) : 'error');
        }, false, { dataType: 'text' });
        return net;
    }

    // --------------------------------------------------
    // Парсинг
    // --------------------------------------------------

    function parseSearchResults(html) {
        var results = [];
        var seen    = {};
        var re = /href=["'](https?:\/\/uaserials\.com\/(\d+)-([^"'#?]+)\.html)["'][^>]*>\s*([^<]{2,80})/gi;
        var m;
        while ((m = re.exec(html)) !== null) {
            var id = m[2];
            if (seen[id]) continue;
            seen[id] = true;
            var rawTitle = cleanText(m[4]);
            if (!rawTitle || rawTitle.length < 2) continue;
            var chunk = html.substring(m.index, m.index + 300);
            var yr    = chunk.match(/\b(19|20)\d{2}\b/);
            results.push({ id: id, title: rawTitle, url: m[1], year: yr ? yr[0] : '' });
        }
        return results;
    }

    function extractPlayerUrl(html) {
        var m;
        m = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
        if (m) return m[1];
        m = html.match(/(?:player_url|playerUrl|file)\s*[:=]\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i);
        if (m) return m[1];
        m = html.match(/(https?:\/\/[^\s"'<>]*hdvb[^\s"'<>]*)/i);
        if (m) return m[1];
        m = html.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
        if (m) return m[1];
        return null;
    }

    function parsePlaylist(html) {
        var m;
        // Playerjs формат
        m = html.match(/Playerjs\(\{[\s\S]{0,200}?file\s*:\s*["']([^"']+)["']/i);
        if (m) return [{ title: 'Дивитись', file: m[1] }];

        // JSON масив playlist
        m = html.match(/['"]{0,1}playlist['"]{0,1}\s*[:=]\s*(\[[\s\S]{0,10000}?\])\s*[,;)]/);
        if (m) {
            try {
                var pl = JSON.parse(m[1]);
                if (Array.isArray(pl) && pl.length) return pl;
            } catch(e) {}
        }
        return [];
    }

    function bestResult(results, movie) {
        var year = parseInt(((movie.release_date || movie.first_air_date || '') + '').slice(0, 4)) || 0;
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
        var best = results[0];
        return (best && score(best) >= 1) ? best : null;
    }

    // --------------------------------------------------
    // Компонент — відображення результатів
    // --------------------------------------------------

    function UaSerialsComponent(object) {
        var self    = this;
        var movie   = object.movie || {};
        var net     = new Lampa.Reguest();
        var active  = false;

        // Кореневий елемент
        var wrap = $('<div class="uaserials-wrap" style="padding:1em"></div>');

        // Лоадер
        function showLoader() {
            wrap.html(
                '<div style="text-align:center;padding:3em">' +
                    '<div class="broadcast__scan"><div></div></div>' +
                    '<div style="margin-top:1em;opacity:.7">Шукаємо на ' + TITLE + '…</div>' +
                '</div>'
            );
        }

        // Порожньо
        function showEmpty(msg) {
            wrap.html(
                '<div class="empty" style="text-align:center;padding:3em">' +
                    '<div class="empty__title">' + (msg || 'Нічого не знайдено') + '</div>' +
                '</div>'
            );
        }

        // Показати список файлів
        function showItems(fileItems) {
            if (!active) return;
            wrap.empty();

            if (!fileItems || !fileItems.length) {
                showEmpty('Нічого не знайдено на ' + TITLE);
                return;
            }

            var list = $('<div class="torrent-list"></div>');

            fileItems.forEach(function (element) {
                var viewed  = Lampa.Storage.cache('online_view', 5000, []);
                var hashKey = element.season
                    ? [element.season, element.episode, movie.original_title || movie.title, element.voice || ''].join(':')
                    : (movie.original_title || movie.title || '') + (element.title || '');
                var hash    = Lampa.Utils.hash(hashKey);
                var view    = Lampa.Timeline.view(hash);

                var tmpl = Lampa.Template.get('online_mod', {
                    title  : element.title || TITLE,
                    quality: element.quality || 'HD',
                    info   : element.info || (' / ' + TITLE),
                    season : element.season  || 0,
                    episode: element.episode || 0
                });

                element.timeline = view;
                tmpl.append(Lampa.Timeline.render(view));

                if (viewed.indexOf(hash) !== -1) {
                    tmpl.append('<div class="torrent-item__viewed">' + Lampa.Template.get('icon_star', {}, true) + '</div>');
                }

                tmpl.on('hover:enter', function () {
                    if (!element.file) {
                        Lampa.Noty.show('Посилання не знайдено');
                        return;
                    }
                    if (movie.id) Lampa.Favorite.add('history', movie, 100);

                    var first = {
                        url     : element.file,
                        title   : element.title || movie.title,
                        timeline: element.timeline
                    };

                    Lampa.Player.play(first);

                    if (element.season && fileItems.length > 1) {
                        var playlist = fileItems.map(function (el) {
                            return { url: el.file || '', title: el.title, timeline: el.timeline };
                        });
                        Lampa.Player.playlist(playlist);
                    } else {
                        Lampa.Player.playlist([first]);
                    }

                    if (viewed.indexOf(hash) === -1) {
                        viewed.push(hash);
                        tmpl.append('<div class="torrent-item__viewed">' + Lampa.Template.get('icon_star', {}, true) + '</div>');
                        Lampa.Storage.set('online_view', viewed);
                    }
                });

                list.append(tmpl);
            });

            wrap.append(list);

            // Фокус на перший елемент
            setTimeout(function () {
                wrap.find('.selector').first().trigger('hover:focus');
            }, 100);
        }

        // Завантажити та розпарсити сторінку фільму
        function loadPage(url, onDone, onFail) {
            httpGet(url, function (html) {
                var fileItems = [];
                var pl = parsePlaylist(html);

                if (pl.length) {
                    pl.forEach(function (item, i) {
                        if (item.playlist && Array.isArray(item.playlist)) {
                            var sNum = parseInt((item.title || '').match(/\d+/)) || (i + 1);
                            item.playlist.forEach(function (ep) {
                                var eNum = parseInt((ep.title || '').match(/\d+/)) || 1;
                                var voices = (ep.playlist && Array.isArray(ep.playlist)) ? ep.playlist : [ep];
                                voices.forEach(function (v) {
                                    fileItems.push({
                                        title  : 'Сезон ' + sNum + ' / Серія ' + eNum + (v.title && v.title !== ep.title ? ' / ' + v.title : ''),
                                        quality: 'HD',
                                        info   : ' / ' + TITLE,
                                        season : sNum,
                                        episode: eNum,
                                        voice  : v.title || '',
                                        file   : v.file || ep.file || ''
                                    });
                                });
                            });
                        } else {
                            fileItems.push({
                                title  : item.title || movie.title || TITLE,
                                quality: 'HD',
                                info   : ' / ' + TITLE,
                                file   : item.file || ''
                            });
                        }
                    });
                }

                if (!fileItems.length) {
                    var playerUrl = extractPlayerUrl(html);
                    if (playerUrl) {
                        if (playerUrl.indexOf('//') === 0) playerUrl = 'https:' + playerUrl;
                        else if (playerUrl.indexOf('/') === 0) playerUrl = SITE + playerUrl;
                        fileItems.push({
                            title  : movie.title || TITLE,
                            quality: 'HD',
                            info   : ' / ' + TITLE,
                            file   : playerUrl
                        });
                    }
                }

                onDone(fileItems);
            }, onFail);
        }

        function doSearch(query, onFound, onEmpty) {
            var url = SITE + '/?do=search&subaction=search&story=' + encodeURIComponent(query);
            httpGet(url, function (html) {
                var results = parseSearchResults(html);
                if (results.length) onFound(results);
                else onEmpty();
            }, function () { onEmpty(); });
        }

        function startSearch() {
            var queries = [];
            if (movie.original_title) queries.push(movie.original_title);
            if (movie.original_name && queries.indexOf(movie.original_name) === -1)
                queries.push(movie.original_name);
            if (movie.title && queries.indexOf(movie.title) === -1)
                queries.push(movie.title);
            if (!queries.length) queries.push(object.search || '');

            var tried = 0;

            function tryNext() {
                if (!active) return;
                if (tried >= queries.length) {
                    showEmpty('Не знайдено: ' + (movie.title || ''));
                    return;
                }
                var q = queries[tried++];
                doSearch(q, function (results) {
                    var best = bestResult(results, movie);
                    if (!best) { tryNext(); return; }
                    loadPage(best.url, function (fileItems) {
                        if (fileItems.length) showItems(fileItems);
                        else tryNext();
                    }, tryNext);
                }, tryNext);
            }

            tryNext();
        }

        // --------------------------------------------------
        // Інтерфейс компонента (Lampa очікує ці методи)
        // --------------------------------------------------

        this.create = function () {
            active = true;
            showLoader();
            startSearch();
            return wrap;
        };

        this.render = function () {
            return wrap;
        };

        this.back = function () {
            Lampa.Activity.backward();
        };

        this.pause   = function () {};
        this.resume  = function () {};
        this.start   = function () {};

        this.destroy = function () {
            active = false;
            net.clear();
            wrap.remove();
        };
    }

    // --------------------------------------------------
    // Перехоплення вікна "Источник"
    // --------------------------------------------------

    function patchSelect() {
        var _show = Lampa.Select.show.bind(Lampa.Select);

        Lampa.Select.show = function (params) {
            if (!params || !params.items) return _show(params);

            // Визначаємо чи це вікно "Источник" — шукаємо пункти Shots або Трейлеры
            var isSource = params.items.some(function (i) {
                return i.title === 'Shots' || i.title === 'Трейлеры' || i.title === 'Трейлери';
            });

            if (!isSource) return _show(params);

            // Вже додано?
            if (params.items.some(function (i) { return i.id === PLUGIN_TAG; })) {
                return _show(params);
            }

            var uaItem = {
                id      : PLUGIN_TAG,
                title   : TITLE,
                subtitle: 'Серіали та фільми українською',
                call    : function () {
                    // Закриваємо Select і відкриваємо наш компонент
                    var activity = Lampa.Activity.active();
                    var movie    = (activity && activity.movie) ? activity.movie : {};

                    setTimeout(function () {
                        Lampa.Activity.push({
                            url      : '',
                            title    : TITLE + (movie.title ? ': ' + movie.title : ''),
                            component: PLUGIN_TAG,
                            movie    : movie,
                            search   : movie.title || '',
                            page     : 1
                        });
                    }, 10);
                }
            };

            // Вставити першим
            var newItems = [uaItem].concat(params.items);
            var newParams = {};
            for (var k in params) newParams[k] = params[k];
            newParams.items = newItems;

            return _show(newParams);
        };
    }

    // --------------------------------------------------
    // Ініціалізація
    // --------------------------------------------------

    function init() {
        // Реєстрація Activity-компонента
        Lampa.Component.add(PLUGIN_TAG, UaSerialsComponent);

        // Патчимо Select
        patchSelect();

        console.log('[UASerials] плагін підключено ✓');
    }

    if (window.appready) {
        init();
    } else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') init();
        });
    }

})();
