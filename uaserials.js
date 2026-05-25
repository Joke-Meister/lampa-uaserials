// UASerials.com — standalone плагін для Lampa
// Версія: 2.2.2

(function () {
    'use strict';

    var SITE       = 'https://uaserials.com';
    var PLUGIN_TAG = 'uaserials';
    var TITLE      = 'UASerials';

    function proxyUrl(url) {
        return 'https://cors.nb557.workers.dev/' + url;
        if (Lampa.Storage.field(PLUGIN_TAG + '_proxy') === true)
            return 'https://cors.nb557.workers.dev/' + url;
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
    
    function httpPost(url, data, onOk, onErr) {
        var net = new Lampa.Reguest();
        net.timeout(15000);
    
        console.log('POST request to:', url); // для отладки
    
        net.native(proxyUrl(url), function (html) {
            console.log('POST success, length:', html ? html.length : 0);
            onOk(html || '');
        }, function (a, c) {
            console.error('POST error:', a, c);
            if (onErr) onErr(net.errorDecode ? net.errorDecode(a, c) : 'error');
        }, true, {
            dataType: 'text',
            postData: data,
            headers: {
                'Content-Type': data instanceof FormData ? undefined : 'application/x-www-form-urlencoded'
            }
        });
    
        return net;
    }
    
    // --------------------------------------------------
    // Парсинг
    // --------------------------------------------------

    function parseSearchResults(html) {
        var results = [], seen = {};
        var re = /href=["'](https?:\/\/uaserials\.com\/(\d+)-([^"'#?]+)\.html)["'][^>]*>\s*([^<]{2,80})/gi;
        var m;
        while ((m = re.exec(html)) !== null) {
            var id = m[2];
            if (seen[id]) continue;
            seen[id] = true;
            var rawTitle = cleanText(m[4]);
            if (!rawTitle || rawTitle.length < 2) continue;
            var chunk = html.substring(m.index, m.index + 300);
            var yr = chunk.match(/\b(19|20)\d{2}\b/);
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
        m = html.match(/Playerjs\(\{[\s\S]{0,200}?file\s*:\s*["']([^"']+)["']/i);
        if (m) return [{ title: 'Дивитись', file: m[1] }];
        m = html.match(/['"]{0,1}playlist['"]{0,1}\s*[:=]\s*(\[[\s\S]{0,10000}?\])\s*[,;)]/);
        if (m) {
            try {
                var pl = JSON.parse(m[1]);
                if (Array.isArray(pl) && pl.length) return pl;
            } catch (e) {}
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
    // Компонент
    // --------------------------------------------------

    function UaSerialsComponent(object) {
        var self   = this;
        var movie  = object.movie || {};
        var active = false;
        var wrap   = $('<div class="uaserials-wrap" style="padding:1em"></div>');

        function showLoader() {
            wrap.html(
                '<div style="text-align:center;padding:3em">' +
                '<div class="broadcast__scan"><div></div></div>' +
                '<div style="margin-top:1em;opacity:.7">Шукаємо на ' + TITLE + '…</div>' +
                '</div>'
            );
        }

        function showEmpty(msg) {
            wrap.html(
                '<div class="empty" style="text-align:center;padding:3em">' +
                '<div class="empty__title">' + (msg || 'Нічого не знайдено') + '</div>' +
                '</div>'
            );
        }

        function showItems(fileItems) {
            if (!active) return;
            wrap.empty();
            if (!fileItems || !fileItems.length) { showEmpty(); return; }

            var list = $('<div class="torrent-list"></div>');
            fileItems.forEach(function (element) {
                var viewed  = Lampa.Storage.cache('online_view', 5000, []);
                var hashKey = element.season
                    ? [element.season, element.episode, movie.original_title || movie.title, element.voice || ''].join(':')
                    : (movie.original_title || movie.title || '') + (element.title || '');
                var hash   = Lampa.Utils.hash(hashKey);
                var view   = Lampa.Timeline.view(hash);

                var tmpl = Lampa.Template.get('online_mod', {
                    title  : element.title || TITLE,
                    quality: element.quality || 'HD',
                    info   : element.info || (' / ' + TITLE),
                    season : element.season  || 0,
                    episode: element.episode || 0
                });

                element.timeline = view;
                tmpl.append(Lampa.Timeline.render(view));

                if (viewed.indexOf(hash) !== -1)
                    tmpl.append('<div class="torrent-item__viewed">' + Lampa.Template.get('icon_star', {}, true) + '</div>');

                tmpl.on('hover:enter', function () {
                    if (!element.file) { Lampa.Noty.show('Посилання не знайдено'); return; }
                    if (movie.id) Lampa.Favorite.add('history', movie, 100);

                    var first = { url: element.file, title: element.title || movie.title, timeline: element.timeline };
                    Lampa.Player.play(first);

                    var playlist = element.season && fileItems.length > 1
                        ? fileItems.map(function (el) { return { url: el.file || '', title: el.title, timeline: el.timeline }; })
                        : [first];
                    Lampa.Player.playlist(playlist);

                    if (viewed.indexOf(hash) === -1) {
                        viewed.push(hash);
                        tmpl.append('<div class="torrent-item__viewed">' + Lampa.Template.get('icon_star', {}, true) + '</div>');
                        Lampa.Storage.set('online_view', viewed);
                    }
                });

                list.append(tmpl);
            });

            wrap.append(list);
            setTimeout(function () { wrap.find('.selector').first().trigger('hover:focus'); }, 100);
        }

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
                                        quality: 'HD', info: ' / ' + TITLE,
                                        season: sNum, episode: eNum, voice: v.title || '',
                                        file: v.file || ep.file || ''
                                    });
                                });
                            });
                        } else {
                            fileItems.push({ title: item.title || movie.title || TITLE, quality: 'HD', info: ' / ' + TITLE, file: item.file || '' });
                        }
                    });
                }

                if (!fileItems.length) {
                    var pu = extractPlayerUrl(html);
                    if (pu) {
                        if (pu.indexOf('//') === 0) pu = 'https:' + pu;
                        else if (pu.indexOf('/') === 0) pu = SITE + pu;
                        fileItems.push({ title: movie.title || TITLE, quality: 'HD', info: ' / ' + TITLE, file: pu });
                    }
                }

                onDone(fileItems);
            }, onFail);
        }

        function doSearch(query, onFound, onEmpty) {
            const url = SITE + '/';  // чистый URL без параметров
        
            const formData = new FormData();
            formData.append('do', 'search');
            formData.append('subaction', 'search');
            formData.append('story', query);
        
            httpPost(url, formData, function (html) {
                var r = parseSearchResults(html);
                if (r.length) onFound(r);
                else onEmpty();
            }, function () {
                onEmpty();
            });
        }

        function startSearch() {
            var queries = [];
            if (movie.original_title) queries.push(movie.original_title);
            if (movie.original_name && queries.indexOf(movie.original_name) === -1) queries.push(movie.original_name);
            if (movie.title && queries.indexOf(movie.title) === -1) queries.push(movie.title);
            if (!queries.length) queries.push(object.search || '');

            var tried = 0;
            function tryNext() {
                if (!active) return;
                if (tried >= queries.length) { showEmpty('Не знайдено: ' + (movie.title || '')); return; }
                var q = queries[tried++];
                doSearch(q, function (results) {
                    var best = bestResult(results, movie);
                    if (!best) { tryNext(); return; }
                    loadPage(best.url, function (items) {
                        if (items.length) showItems(items); else tryNext();
                    }, tryNext);
                }, tryNext);
            }
            tryNext();
        }

        this.create  = function () { active = true; showLoader(); startSearch(); return wrap; };
        this.render  = function () { return wrap; };
        this.back    = function () { Lampa.Activity.backward(); };
        this.pause   = function () {};
        this.resume  = function () {};
        this.start   = function () {};
        this.destroy = function () { active = false; wrap.remove(); };
    }

    // --------------------------------------------------
    // Перехоплення Select — правильний спосіб через onSelect
    // --------------------------------------------------

    function patchSelect() {
        var _show = Lampa.Select.show.bind(Lampa.Select);

        Lampa.Select.show = function (params) {
            if (!params || !params.items) return _show(params);

            // Це вікно "Источник"?
            var isSource = params.items.some(function (i) {
                var t = (i.title || '').replace(/\s+/g, '');
                return t === 'Shots' || t === 'Трейлеры' || t === 'Трейлери';
            });
            if (!isSource) return _show(params);

            // Вже є наш пункт?
            if (params.items.some(function (i) {
                return (i.title || '').replace(/\s+/g, '') === TITLE;
            })) return _show(params);

            // Додаємо пункт
            var uaItem = { title: TITLE, subtitle: 'Серіали та фільми українською' };
            var newItems = [uaItem].concat(params.items);

            // Обгортаємо onSelect
            var _onSelect = params.onSelect;
            var newParams = {};
            for (var k in params) { if (params.hasOwnProperty(k)) newParams[k] = params[k]; }
            newParams.items = newItems;
            newParams.onSelect = function (item) {
                if ((item.title || '').replace(/\s+/g, '') === TITLE) {
                    // Наш пункт — відкриваємо компонент
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
                    }, 100);
                    return;
                }
                // Інший пункт — передаємо далі
                if (_onSelect) _onSelect(item);
            };

            return _show(newParams);
        };
    }

    // --------------------------------------------------
    // Ініціалізація
    // --------------------------------------------------

    function init() {
        Lampa.Component.add(PLUGIN_TAG, UaSerialsComponent);
        patchSelect();
        console.log('[UASerials] v2.2 підключено ✓');
    }

    if (window.appready) {
        init();
    } else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') init();
        });
    }

})();
