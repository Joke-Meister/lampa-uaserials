// UASerials.com — standalone плагін для Lampa
// Версія: 2.0.0

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
            .replace(/[\s\-–—:,!?.'"«»]+/g, ' ')
            .replace(/ё/g, 'е').trim();
    }

    // --------------------------------------------------
    // Парсинг сторінки
    // --------------------------------------------------

    function parseSearchResults(html) {
        var results = [];
        var seen    = {};
        // Шаблон URL сайту: /1234-slug.html
        var re = /href=["'](https?:\/\/uaserials\.com\/(\d+)-([^"'#?]+)\.html)["'][^>]*>\s*([^<]{2,80})/gi;
        var m;
        while ((m = re.exec(html)) !== null) {
            var id = m[2];
            if (seen[id]) continue;
            seen[id] = true;
            var rawTitle = cleanText(m[4]);
            if (!rawTitle || rawTitle.length < 2) continue;
            // Шукаємо рік поруч
            var chunk = html.substring(m.index, m.index + 300);
            var yr    = chunk.match(/\b(19|20)\d{2}\b/);
            results.push({
                id    : id,
                title : rawTitle,
                url   : m[1],
                year  : yr ? yr[0] : ''
            });
        }
        return results;
    }

    function extractPlayerUrl(html) {
        // iframe src
        var m = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
        if (m) return m[1];
        // JS змінна
        m = html.match(/(?:player_url|playerUrl|file)\s*[:=]\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i);
        if (m) return m[1];
        // hdvbua або схожий CDN
        m = html.match(/(https?:\/\/[^\s"'<>]*hdvb[^\s"'<>]*)/i);
        if (m) return m[1];
        // будь-який m3u8
        m = html.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
        if (m) return m[1];
        return null;
    }

    function parsePlaylist(html) {
        // Шукаємо playerjs playlist JSON у скрипті
        var variants = [
            /Playerjs\(\{[^}]*file\s*:\s*["']([^"']+)["']/i,
            /["']file["']\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i,
            /file\s*=\s*["']([^"']+\.m3u8[^"']*)["']/i,
        ];
        for (var i = 0; i < variants.length; i++) {
            var m = html.match(variants[i]);
            if (m) return [{ title: 'Українська', file: m[1] }];
        }

        // JSON playlist масив
        var pm = html.match(/playlist\s*[:=]\s*(\[[\s\S]{0,5000}?\])\s*[,;)]/);
        if (pm) {
            try {
                var pl = JSON.parse(pm[1]);
                if (Array.isArray(pl) && pl.length) return pl;
            } catch(e) {}
        }

        return [];
    }

    // --------------------------------------------------
    // Мережеві запити
    // --------------------------------------------------

    function httpGet(url, onOk, onErr) {
        var net = new Lampa.Reguest();
        net.timeout(15000);
        net.native(proxyUrl(url), function(html) {
            onOk(html || '');
        }, function(a, c) {
            if (onErr) onErr(net.errorDecode(a, c));
        }, false, { dataType: 'text' });
        return net;
    }

    // --------------------------------------------------
    // Головний компонент
    // --------------------------------------------------

    function UaSerialsComponent(object) {
        var self    = this;
        var network = new Lampa.Reguest();
        var scroll  = new Lampa.Scroll({ mask: true, over: true });
        var items   = [];
        var active  = false;

        // Пошук найкращого результату
        function bestResult(results, movie) {
            var year = parseInt(((movie.release_date || movie.first_air_date || '') + '').slice(0, 4)) || 0;
            var titles = [movie.title, movie.original_title, movie.original_name, movie.name]
                .filter(Boolean).map(norm);

            function score(r) {
                var s = 0, n = norm(r.title);
                titles.forEach(function(t) {
                    if (n === t) s += 10;
                    else if (n.indexOf(t) !== -1 || t.indexOf(n) !== -1) s += 4;
                });
                if (year && r.year && parseInt(r.year) === year) s += 3;
                return s;
            }

            results.sort(function(a, b) { return score(b) - score(a); });
            var best = results[0];
            return (best && score(best) >= 1) ? best : null;
        }

        // Відобразити один елемент (фільм або серія)
        function renderItem(element, allItems) {
            var viewed   = Lampa.Storage.cache('online_view', 5000, []);
            var hashKey  = element.season
                ? [element.season, element.episode, object.movie.original_title || object.movie.title, element.voice || ''].join(':')
                : (object.movie.original_title || object.movie.title || '') + (element.title || '');
            var hash     = Lampa.Utils.hash(hashKey);
            var timeview = Lampa.Timeline.view(hash);

            var tmpl = Lampa.Template.get('online_mod', {
                title  : element.title || TITLE,
                quality: element.quality || 'HD',
                info   : element.info   || (' / ' + TITLE),
                season : element.season  || 0,
                episode: element.episode || 0
            });

            element.timeline = timeview;
            tmpl.append(Lampa.Timeline.render(timeview));

            if (viewed.indexOf(hash) !== -1) {
                tmpl.append('<div class="torrent-item__viewed">' + Lampa.Template.get('icon_star', {}, true) + '</div>');
            }

            tmpl.on('hover:enter', function () {
                if (!element.file) {
                    Lampa.Noty.show('Посилання не знайдено');
                    return;
                }
                if (object.movie.id) Lampa.Favorite.add('history', object.movie, 100);

                var first = {
                    url     : element.file,
                    title   : element.title || object.movie.title,
                    timeline: element.timeline
                };

                Lampa.Player.play(first);

                if (element.season && allItems.length > 1) {
                    var playlist = allItems.map(function(el) {
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

            return tmpl;
        }

        // Показати знайдені файли
        function showItems(fileItems) {
            if (!active) return;
            scroll.clear();
            items = fileItems;

            if (!items.length) {
                showEmpty('Нічого не знайдено на ' + TITLE);
                return;
            }

            items.forEach(function(el) {
                scroll.append(renderItem(el, items));
            });

            // Показуємо scroll
            self.render().find('.uaserials-loader').remove();
            self.render().append(scroll.render());

            Lampa.Controller.enable('content');
            scroll.render().find('.selector').first().trigger('hover:focus');
        }

        function showEmpty(msg) {
            self.render().find('.uaserials-loader').remove();
            self.render().append(
                $('<div class="empty">' +
                    '<div class="empty__title">' + (msg || 'Нічого не знайдено') + '</div>' +
                  '</div>')
            );
        }

        function showLoader() {
            self.render().append(
                $('<div class="uaserials-loader" style="padding:2em;text-align:center;">' +
                    '<div class="broadcast__scan"><div></div></div>' +
                    '<div style="margin-top:1em;opacity:.7;">Шукаємо на ' + TITLE + '…</div>' +
                  '</div>')
            );
        }

        // Завантажити сторінку фільму і розпарсити плеєр
        function loadPage(url, onDone, onFail) {
            httpGet(url, function(html) {
                var fileItems = [];

                // Спробуємо JSON playlist
                var pl = parsePlaylist(html);
                if (pl.length) {
                    pl.forEach(function(item, i) {
                        if (item.playlist && Array.isArray(item.playlist)) {
                            // Серіал: Сезон → Серії
                            var sNum = parseInt((item.title || '').match(/\d+/) || [i+1]);
                            item.playlist.forEach(function(ep) {
                                var eNum = parseInt((ep.title || '').match(/\d+/) || [1]);
                                var voices = ep.playlist || [ep];
                                voices.forEach(function(v) {
                                    fileItems.push({
                                        title  : 'С' + sNum + ' Е' + eNum + (v.title && v.title !== ep.title ? ' / ' + v.title : ''),
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
                                title  : item.title || TITLE,
                                quality: 'HD',
                                info   : ' / ' + TITLE,
                                file   : item.file || ''
                            });
                        }
                    });
                }

                // Якщо JSON не знайшли — пробуємо iframe/m3u8
                if (!fileItems.length) {
                    var playerUrl = extractPlayerUrl(html);
                    if (playerUrl) {
                        if (playerUrl.indexOf('//') === 0) playerUrl = 'https:' + playerUrl;
                        else if (playerUrl.indexOf('/') === 0) playerUrl = SITE + playerUrl;
                        fileItems.push({
                            title  : object.movie.title || TITLE,
                            quality: 'HD',
                            info   : ' / ' + TITLE,
                            file   : playerUrl
                        });
                    }
                }

                onDone(fileItems);
            }, onFail);
        }

        // Старт пошуку
        function doSearch(query, onFound, onEmpty) {
            var searchUrl = SITE + '/?do=search&subaction=search&story=' + encodeURIComponent(query);
            httpGet(searchUrl, function(html) {
                var results = parseSearchResults(html);
                if (results.length) onFound(results);
                else onEmpty();
            }, onEmpty);
        }

        function startSearch() {
            var movie   = object.movie;
            var queries = [];
            if (movie.original_title) queries.push(movie.original_title);
            if (movie.original_name)  queries.push(movie.original_name);
            if (movie.title && queries.indexOf(movie.title) === -1) queries.push(movie.title);
            if (!queries.length) queries.push(object.search || '');

            var tried = 0;

            function tryNext() {
                if (tried >= queries.length) {
                    showEmpty('Не знайдено на ' + TITLE + ': ' + (movie.title || ''));
                    return;
                }
                var q = queries[tried++];
                doSearch(q, function(results) {
                    var best = bestResult(results, movie);
                    if (!best) { tryNext(); return; }

                    loadPage(best.url, function(fileItems) {
                        if (fileItems.length) showItems(fileItems);
                        else tryNext();
                    }, tryNext);
                }, tryNext);
            }

            tryNext();
        }

        // --------------------------------------------------
        // Публічний інтерфейс компонента
        // --------------------------------------------------

        var elem = $('<div class="uaserials-wrap"></div>');

        this.render = function() { return elem; };

        this.create = function() {
            active = true;
            showLoader();
            startSearch();
        };

        this.back = function() {
            Lampa.Activity.backward();
        };

        this.pause  = function() {};
        this.resume = function() {};

        this.destroy = function() {
            active = false;
            network.clear();
            scroll.destroy();
            elem.remove();
        };
    }

    // --------------------------------------------------
    // Реєстрація кнопки у меню фільму ("Источник")
    // --------------------------------------------------

    function addSource() {
        // Lampa.Source дозволяє додати свій пункт у вікно "Источник"
        if (Lampa.Source && Lampa.Source.add) {
            Lampa.Source.add({
                id    : PLUGIN_TAG,
                title : TITLE,
                icon  : '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z" fill="currentColor"/></svg>',
                // Lampa викличе launch() коли юзер обере це джерело
                launch: function(object) {
                    Lampa.Activity.push({
                        url       : '',
                        title     : TITLE,
                        component : PLUGIN_TAG,
                        movie     : object.movie,
                        search    : object.movie.title,
                        page      : 1
                    });
                }
            });
        } else {
            // Якщо Source API немає — вішаємо через Listener
            Lampa.Listener.follow('full', function(e) {
                if (e.type !== 'complite') return;

                var btnHtml =
                    '<div class="full-start__button selector" data-action="' + PLUGIN_TAG + '">' +
                        '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>' +
                        '<span>' + TITLE + '</span>' +
                    '</div>';

                var btn = $(btnHtml);
                // Додаємо після кнопки трейлера або в кінець кнопок
                var btns = e.object.activity.render().find('.full-start__buttons');
                if (btns.length) btns.append(btn);

                btn.on('hover:enter', function() {
                    Lampa.Activity.push({
                        url      : '',
                        title    : TITLE,
                        component: PLUGIN_TAG,
                        movie    : e.object.movie,
                        search   : e.object.movie.title,
                        page     : 1
                    });
                });
            });
        }
    }

    // --------------------------------------------------
    // Додати у меню "Источник" через стандартний Select
    // --------------------------------------------------

    function patchSelect() {
        // online_mod та інші плагіни відкривають Select через Lampa.Select
        // Перехоплюємо відкриття вікна "Источник" і додаємо свій пункт
        var originalSelect = Lampa.Select.show.bind(Lampa.Select);

        Lampa.Select.show = function(params) {
            if (params && params.title &&
                (params.title === 'Источник' || params.title === 'Джерело' ||
                 params.title === 'Source'   || (params.items && params.items.some(function(i){
                     return i.title === 'Трейлеры' || i.title === 'Трейлери';
                 })))) {

                // Перевіряємо чи вже є наш пункт
                var alreadyAdded = params.items && params.items.some(function(i) {
                    return i.id === PLUGIN_TAG;
                });

                if (!alreadyAdded) {
                    var uaItem = {
                        id      : PLUGIN_TAG,
                        title   : TITLE,
                        subtitle: 'Серіали та фільми українською',
                        icon    : '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>',
                        call    : function() {
                            var activity = Lampa.Activity.active();
                            var movie = activity && activity.movie ? activity.movie : {};
                            Lampa.Activity.push({
                                url      : '',
                                title    : TITLE,
                                component: PLUGIN_TAG,
                                movie    : movie,
                                search   : movie.title || '',
                                page     : 1
                            });
                        }
                    };

                    // Вставляємо перед "Трейлерами"
                    var items = (params.items || []).slice();
                    var trailerIdx = -1;
                    items.forEach(function(item, idx) {
                        if (item.title === 'Трейлеры' || item.title === 'Трейлери') trailerIdx = idx;
                    });
                    if (trailerIdx >= 0) items.splice(trailerIdx, 0, uaItem);
                    else items.unshift(uaItem);

                    params = Object.assign({}, params, { items: items });
                }
            }

            return originalSelect(params);
        };
    }

    // --------------------------------------------------
    // Налаштування
    // --------------------------------------------------

    function initSettings() {
        Lampa.Lang.add({
            uaserials_settings_title: { uk: 'UASerials', ru: 'UASerials', en: 'UASerials' },
            uaserials_proxy_label   : { uk: 'Використовувати CORS-проксі', ru: 'Использовать CORS-прокси', en: 'Use CORS proxy' },
            uaserials_proxy_info    : { uk: 'Якщо сайт не відповідає', ru: 'Если сайт не отвечает', en: 'If site does not respond' }
        });

        Lampa.Settings.listener.follow('open', function(e) {
            if (e.name !== 'main' && e.name !== 'plugins') return;
            var body = e.body;
            if (!body || body.find('[data-name="' + PLUGIN_TAG + '_proxy"]').length) return;

            var row = $(
                '<div class="settings-param selector" data-name="' + PLUGIN_TAG + '_proxy" data-type="toggle">' +
                    '<div class="settings-param__name">UASerials — #{uaserials_proxy_label}</div>' +
                    '<div class="settings-param__value"></div>' +
                '</div>'
            );
            body.append(row);
        });
    }

    // --------------------------------------------------
    // Запуск
    // --------------------------------------------------

    function init() {
        // Реєструємо компонент Activity
        Lampa.Component.add(PLUGIN_TAG, UaSerialsComponent);

        patchSelect();
        addSource();
        initSettings();

        console.log('[' + TITLE + '] плагін підключено ✓');
    }

    if (window.appready) {
        init();
    } else {
        Lampa.Listener.follow('app', function(e) {
            if (e.type === 'ready') init();
        });
    }

})();
