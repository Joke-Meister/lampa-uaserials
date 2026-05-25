// UASerials.com plugin for Lampa
// Версія: 1.0.0

(function () {
    'use strict';

    var SITE_HOST = 'https://uaserials.com';
    var PLUGIN_NAME = 'uaserials';
    var PLUGIN_TITLE = 'UASerials';

    // ------------------------------------------------
    // Допоміжні функції
    // ------------------------------------------------

    function startsWith(str, search) {
        return str.lastIndexOf(search, 0) === 0;
    }

    function decodeHtml(html) {
        var txt = document.createElement('textarea');
        txt.innerHTML = html;
        return txt.value;
    }

    function cleanText(str) {
        return (str || '').replace(/<[^>]+>/g, '').trim();
    }

    // Вибрати proxy якщо потрібно
    function proxyUrl(url) {
        // Використовуємо публічний CORS-проксі якщо Lampa не може достукатись напряму
        var need_proxy = Lampa.Storage.field(PLUGIN_NAME + '_use_proxy') === true;
        if (need_proxy) {
            return 'https://cors.nb557.workers.dev/' + url;
        }
        return url;
    }

    // ------------------------------------------------
    // Джерело (Source) для online_mod
    // ------------------------------------------------

    function uaserials(component, _object) {
        var network = new Lampa.Reguest();
        var object = _object;
        var select_title = '';
        var found_items = [];   // результати пошуку на сайті

        var filter_items = {
            season: [],
            season_num: [],
            voice: []
        };
        var choice = {
            season: 0,
            voice: 0,
            voice_name: ''
        };

        // ------------------------------
        // Утиліти парсингу HTML
        // ------------------------------

        /**
         * Знайти iframe src у HTML сторінки фільму
         */
        function extractIframeSrc(html) {
            // Шукаємо <iframe src="..."> на сторінці
            var m = html.match(/<iframe[^>]+src=["']([^"']+)["'][^>]*>/i);
            if (m) return m[1];

            // Деякі плеєри підключаються через JS змінну player_url або playerUrl
            m = html.match(/player_url\s*[:=]\s*["']([^"']+)["']/i);
            if (m) return m[1];

            m = html.match(/playerUrl\s*[:=]\s*["']([^"']+)["']/i);
            if (m) return m[1];

            // Шукаємо hdvbua або uaserials CDN
            m = html.match(/(https?:\/\/[^"'\s]+hdvbua[^"'\s]*)/i);
            if (m) return m[1];

            m = html.match(/(https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)/i);
            if (m) return m[1];

            return null;
        }

        /**
         * Розпарсити результати пошуку з HTML
         * Повертає масив { title, url, poster, year }
         */
        function parseSearchResults(html) {
            var results = [];

            // Картки з результатами йдуть у вигляді посилань типу /1234-nazva.html
            // та мають назву і постер
            var re = /<a[^>]+href=["'](https?:\/\/uaserials\.com\/\d+-[^"']+\.html)["'][^>]*>[\s\S]*?<\/a>/gi;
            var block;

            // Спрощений підхід: знаходимо всі посилання на фільми та їх назви
            var linkRe = /href=["'](https?:\/\/uaserials\.com\/(\d+)-([^"']+)\.html)["'][^>]*>([^<]*)/gi;
            var seen = {};

            while ((block = linkRe.exec(html)) !== null) {
                var url = block[1];
                var id  = block[2];
                var slug = block[3];
                var rawTitle = cleanText(block[4]);

                if (!id || seen[id] || !rawTitle || rawTitle.length < 2) continue;
                seen[id] = true;

                // Пробуємо отримати poster url зі структури поблизу
                var posterMatch = html.substring(Math.max(0, block.index - 500), block.index + 500)
                    .match(/src=["'](https?:\/\/uaserials\.com\/posters\/(\d+)\.[^"']+)["']/i);
                var poster = posterMatch
                    ? posterMatch[1]
                    : (SITE_HOST + '/posters/' + id + '.jpg');

                // Рік
                var yearMatch = html.substring(block.index, block.index + 300).match(/\b(19|20)\d{2}\b/);
                var year = yearMatch ? yearMatch[0] : '';

                results.push({
                    id: id,
                    title: rawTitle,
                    url: url,
                    poster: poster,
                    year: year
                });
            }

            return results;
        }

        /**
         * Розпарсити сезони/серії/дубляж зі сторінки плеєра або сайту
         * Повертає масив елементів для відображення
         */
        function parseEpisodes(html, pageUrl) {
            var items = [];

            // Варіант 1: плеєр hdvbua передає дані у вигляді JSON у скрипті
            // Шукаємо playerjs або аналог
            var jsonMatch = html.match(/var\s+playlist\s*=\s*(\[[\s\S]*?\]);/i)
                || html.match(/playlist\s*[:=]\s*(\[[\s\S]*?\])\s*[,;]/i)
                || html.match(/"playlist"\s*:\s*(\[[\s\S]*?\])\s*[,}]/i);

            if (jsonMatch) {
                try {
                    var playlist = JSON.parse(jsonMatch[1]);
                    playlist.forEach(function (season) {
                        if (season.playlist && Array.isArray(season.playlist)) {
                            // Серіал: сезон > серії
                            var sNum = parseInt((season.title || '').match(/\d+/) || [1]);
                            season.playlist.forEach(function (ep) {
                                if (ep.playlist && Array.isArray(ep.playlist)) {
                                    // Серія > озвучення
                                    var eNum = parseInt((ep.title || '').match(/\d+/) || [1]);
                                    ep.playlist.forEach(function (voice) {
                                        items.push({
                                            title: component.formatEpisodeTitle(sNum, eNum),
                                            quality: '720p ~ 1080p',
                                            info: ' / ' + (voice.title || ''),
                                            season: sNum,
                                            episode: eNum,
                                            file: voice.file || ep.file || '',
                                            voice_name: voice.title || ''
                                        });
                                    });
                                } else {
                                    var eNum2 = parseInt((ep.title || '').match(/\d+/) || [1]);
                                    items.push({
                                        title: component.formatEpisodeTitle(sNum, eNum2),
                                        quality: '720p ~ 1080p',
                                        info: '',
                                        season: sNum,
                                        episode: eNum2,
                                        file: ep.file || ''
                                    });
                                }
                            });
                        } else {
                            // Фільм або одна серія
                            items.push({
                                title: season.title || select_title,
                                quality: '720p ~ 1080p',
                                info: '',
                                file: season.file || ''
                            });
                        }
                    });
                } catch(e) {}
            }

            // Варіант 2: iframe — повертаємо один item з iframe посиланням для відкриття
            if (!items.length) {
                var iframeSrc = extractIframeSrc(html);
                if (iframeSrc) {
                    // Підготуємо повну URL
                    if (startsWith(iframeSrc, '//')) iframeSrc = 'https:' + iframeSrc;
                    else if (startsWith(iframeSrc, '/')) iframeSrc = SITE_HOST + iframeSrc;

                    items.push({
                        title: select_title,
                        quality: '720p ~ 1080p',
                        info: ' / UASerials',
                        file: iframeSrc,
                        is_iframe: true
                    });
                }
            }

            // Варіант 3: пряме M3U8 у HTML
            if (!items.length) {
                var m3u8 = html.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
                if (m3u8) {
                    items.push({
                        title: select_title,
                        quality: '720p ~ 1080p',
                        info: ' / UASerials',
                        file: m3u8[1]
                    });
                }
            }

            return items;
        }

        // ------------------------------
        // Публічний API джерела
        // ------------------------------

        /**
         * Точка входу — Lampa викликає search() коли обирає це джерело
         */
        this.search = function (_object, kinopoisk_id) {
            object = _object;
            select_title = object.search || object.movie.title || object.movie.original_title || '';

            var empty = function () {
                component.emptyForQuery(select_title);
            };
            var error = component.empty.bind(component);

            // Шукаємо за оригінальною та локалізованою назвою
            var queries = [];
            if (object.movie.original_title) queries.push(object.movie.original_title);
            if (object.movie.title && object.movie.title !== object.movie.original_title) queries.push(object.movie.title);
            if (!queries.length) queries.push(select_title);

            searchSequential(queries, 0, empty, error);
        };

        function searchSequential(queries, idx, empty, error) {
            if (idx >= queries.length) {
                empty();
                return;
            }
            var q = queries[idx];
            doSearch(q, function (items) {
                if (items && items.length) {
                    handleSearchResults(items, empty, error);
                } else {
                    searchSequential(queries, idx + 1, empty, error);
                }
            }, function () {
                searchSequential(queries, idx + 1, empty, error);
            });
        }

        function doSearch(query, onSuccess, onError) {
            var url = proxyUrl(SITE_HOST + '/?do=search&subaction=search&story=' + encodeURIComponent(query));
            network.clear();
            network.timeout(15000);
            network.native(url, function (html) {
                var results = parseSearchResults(html || '');
                onSuccess(results);
            }, function (a, c) {
                if (onError) onError(network.errorDecode(a, c));
            }, false, { dataType: 'text' });
        }

        /**
         * Знайти найбільш відповідний результат і завантажити сторінку
         */
        function handleSearchResults(results, empty, error) {
            // Рік фільму з TMDB
            var movieYear = parseInt(
                ((object.movie.release_date || object.movie.first_air_date || '') + '').slice(0, 4)
            ) || 0;

            // Нормалізація назви для порівняння
            function norm(s) {
                return (s || '').toLowerCase()
                    .replace(/[\s\-–—:,!?.'"«»]+/g, ' ')
                    .replace(/ё/g, 'е')
                    .trim();
            }

            var titles = [
                object.movie.title,
                object.movie.original_title,
                object.movie.original_name,
                object.search
            ].filter(Boolean).map(norm);

            // Скорингова функція
            function score(item) {
                var s = 0;
                var n = norm(item.title);
                titles.forEach(function(t) {
                    if (n === t) s += 10;
                    else if (n.indexOf(t) !== -1 || t.indexOf(n) !== -1) s += 5;
                });
                if (movieYear && item.year && parseInt(item.year) === movieYear) s += 3;
                return s;
            }

            results.sort(function(a, b) { return score(b) - score(a); });

            var best = results[0];
            if (!best || score(best) < 1) {
                empty();
                return;
            }

            // Завантажуємо сторінку фільму
            loadMoviePage(best, empty, error);
        }

        function loadMoviePage(item, empty, error) {
            var url = proxyUrl(item.url);
            network.clear();
            network.timeout(15000);
            network.native(url, function (html) {
                html = html || '';
                var items = parseEpisodes(html, item.url);

                if (!items.length) {
                    empty();
                    return;
                }

                found_items = items;
                buildFilter();
                appendItems(filteredItems());

            }, function (a, c) {
                if (error) error(network.errorDecode(a, c));
            }, false, { dataType: 'text' });
        }

        // ------------------------------
        // Фільтр сезонів/озвучення
        // ------------------------------

        function buildFilter() {
            filter_items = { season: [], season_num: [], voice: [] };

            var seasons_seen = {};
            var voices_seen = {};

            found_items.forEach(function (el) {
                if (el.season && !seasons_seen[el.season]) {
                    seasons_seen[el.season] = true;
                    filter_items.season_num.push(el.season);
                    filter_items.season.push(Lampa.Lang.translate('torrent_serial_season') + ' ' + el.season);
                }
                var v = el.voice_name || '';
                if (v && !voices_seen[v]) {
                    voices_seen[v] = true;
                    filter_items.voice.push(v);
                }
            });

            filter_items.season_num.sort(function(a,b){ return a-b; });

            if (!filter_items.season[choice.season]) choice.season = 0;
            if (!filter_items.voice[choice.voice]) choice.voice = 0;

            if (choice.voice_name) {
                var inx = filter_items.voice.indexOf(choice.voice_name);
                if (inx === -1) choice.voice = 0;
                else choice.voice = inx;
            }

            component.filter(filter_items, choice);
        }

        function filteredItems() {
            var hasSeason = filter_items.season.length > 0;
            var hasVoice  = filter_items.voice.length > 0;

            return found_items.filter(function (el) {
                if (hasSeason) {
                    var sNum = filter_items.season_num[choice.season];
                    if (el.season !== sNum) return false;
                }
                if (hasVoice) {
                    var vName = filter_items.voice[choice.voice] || '';
                    if (el.voice_name && el.voice_name !== vName) return false;
                }
                return true;
            });
        }

        // ------------------------------
        // Відображення елементів
        // ------------------------------

        function appendItems(items) {
            component.reset();
            var viewed = Lampa.Storage.cache('online_view', 5000, []);
            var last_ep = component.getLastEpisode ? component.getLastEpisode(items) : null;

            items.forEach(function (element) {
                if (element.season && last_ep) element.translate_episode_end = last_ep;

                var hash = Lampa.Utils.hash(
                    element.season
                        ? [element.season, element.season > 10 ? ':' : '', element.episode, object.movie.original_title || object.movie.title].join('')
                        : (object.movie.original_title || object.movie.title || '') + (element.title || '')
                );
                var view = Lampa.Timeline.view(hash);
                var hash_file = Lampa.Utils.hash(
                    element.season
                        ? [element.season, element.season > 10 ? ':' : '', element.episode, object.movie.original_title || object.movie.title, element.voice_name || ''].join('')
                        : (object.movie.original_title || '') + element.title
                );

                // Дані для шаблону
                var tmpl_data = {
                    title: element.title || select_title,
                    quality: element.quality || '720p ~ 1080p',
                    info: element.info || (' / ' + PLUGIN_TITLE),
                    season: element.season || 0,
                    episode: element.episode || 0
                };

                element.timeline = view;
                var item = Lampa.Template.get('online_mod', tmpl_data);
                item.append(Lampa.Timeline.render(view));

                if (Lampa.Timeline.details) {
                    item.find('.online__quality').append(Lampa.Timeline.details(view, ' / '));
                }

                if (viewed.indexOf(hash_file) !== -1) {
                    item.append('<div class="torrent-item__viewed">' + Lampa.Template.get('icon_star', {}, true) + '</div>');
                }

                item.on('hover:enter', function () {
                    if (object.movie.id) Lampa.Favorite.add('history', object.movie, 100);

                    var fileUrl = element.file || '';

                    if (!fileUrl) {
                        Lampa.Noty.show(Lampa.Lang.translate('online_mod_nolink'));
                        return;
                    }

                    var first = {
                        url: fileUrl,
                        timeline: element.timeline,
                        title: element.season
                            ? element.title
                            : (select_title + (element.title && element.title !== select_title ? ' / ' + element.title : ''))
                    };

                    Lampa.Player.play(first);

                    // Плейліст для серіалів
                    if (element.season) {
                        var playlist = items.map(function (el) {
                            return {
                                url: el.file || '',
                                timeline: el.timeline,
                                title: el.title
                            };
                        });
                        Lampa.Player.playlist(playlist);
                    } else {
                        Lampa.Player.playlist([first]);
                    }

                    if (viewed.indexOf(hash_file) === -1) {
                        viewed.push(hash_file);
                        item.append('<div class="torrent-item__viewed">' + Lampa.Template.get('icon_star', {}, true) + '</div>');
                        Lampa.Storage.set('online_view', viewed);
                    }
                });

                component.append(item);

                if (component.contextmenu) {
                    component.contextmenu({
                        item: item,
                        view: view,
                        viewed: viewed,
                        hash_file: hash_file,
                        file: function (call) {
                            call({ file: element.file || '' });
                        }
                    });
                }
            });

            component.start(true);
        }

        // ------------------------------
        // Управління фільтром
        // ------------------------------

        this.filter = function (type, a, b) {
            choice[a.stype] = b.index;
            if (a.stype === 'voice') choice.voice_name = filter_items.voice[b.index] || '';
            component.reset();
            buildFilter();
            appendItems(filteredItems());
            component.saveChoice(choice);
        };

        this.reset = function () {
            component.reset();
            choice = { season: 0, voice: 0, voice_name: '' };
            buildFilter();
            appendItems(filteredItems());
            component.saveChoice(choice);
        };

        this.extendChoice = function (saved) {
            Lampa.Arrays.extend(choice, saved, true);
        };

        this.destroy = function () {
            network.clear();
        };
    }

    // ------------------------------------------------
    // Ініціалізація плагіна
    // ------------------------------------------------

    function initPlugin() {
        // Додаємо переклади
        Lampa.Lang.add({
            uaserials_source:   { uk: 'UASerials', ru: 'UASerials', en: 'UASerials' },
            uaserials_use_proxy:{ uk: 'Використовувати проксі', ru: 'Использовать прокси', en: 'Use proxy' }
        });

        // Реєструємо джерело в online_mod якщо він підключений
        // online_mod не надає публічного API реєстрації, тому інтегруємось
        // через Lampa.Listener та подію 'online' що викидається компонентом

        // Спосіб 1: Якщо online_mod вже є — додаємо джерело через глобальний хук
        if (window.online_mod_sources) {
            window.online_mod_sources.push({
                name: PLUGIN_NAME,
                title: PLUGIN_TITLE,
                source: uaserials,
                search: true,
                kp: false,
                imdb: false
            });
        }

        // Спосіб 2: Реєструємо окремий компонент Lampa (якщо online_mod недоступний)
        // Це standalone-режим — власна вкладка "Дивитись" в Lampa

        Lampa.Component.add(PLUGIN_NAME, function (object) {
            var comp = this;
            var source = null;
            var initialized = false;

            this.create = function () {
                this.activity.loader(true);
                source = new uaserials(comp, object);
                source.search(object, '');
                return this.render();
            };

            this.render = function () {
                if (!initialized) {
                    initialized = true;
                    this.elem = $('<div class="uaserials-component"></div>');
                }
                return this.elem;
            };

            this.destroy = function () {
                if (source) source.destroy();
            };

            // Обгортки методів компоненту що очікує джерело
            this.empty       = function () { this.activity.loader(false); Lampa.Noty.show('Нічого не знайдено на UASerials'); };
            this.emptyForQuery = function (q) { this.empty(); };
            this.loading     = function (s) { this.activity.loader(s); };
            this.reset       = function () {};
            this.append      = function (item) { this.elem && this.elem.append(item); };
            this.start       = function (ready) { if (ready) this.activity.loader(false); };
            this.filter      = function () {};
            this.saveChoice  = function () {};
            this.proxy       = function () { return ''; };
            this.proxyLink   = function (l) { return l; };
            this.fixLink     = function (l) { return l; };
            this.getLastEpisode = function (items) {
                var max = 0;
                (items || []).forEach(function(i){ if ((i.episode||0) > max) max = i.episode; });
                return max;
            };
            this.formatEpisodeTitle = function (s, e, extra) {
                return Lampa.Lang.translate('torrent_serial_season') + ' ' + s + ' / ' +
                       Lampa.Lang.translate('torrent_serial_episode') + ' ' + e + (extra ? ' ' + extra : '');
            };
            this.getDefaultQuality = function (qualitys, stream) { return stream; };
            this.renameQualityMap  = function (q) { return q; };
            this.contextmenu       = function () {};
        });

        // Додаємо налаштування
        addSettings();
    }

    function addSettings() {
        var template = '<div class="settings-param selector" data-name="' + PLUGIN_NAME + '_use_proxy" data-type="toggle">' +
            '<div class="settings-param__name">#{uaserials_use_proxy}</div>' +
            '<div class="settings-param__value"></div>' +
        '</div>';

        // Намагаємось підвісити налаштування до розділу online (якщо online_mod є)
        Lampa.Settings.listener.follow('open', function (e) {
            if (e.name === 'online' || e.name === 'online_mod') {
                // Додаємо наш toggle до відкритого вікна налаштувань
                var body = e.body;
                if (body && !body.find('[data-name="' + PLUGIN_NAME + '_use_proxy"]').length) {
                    body.append($(template));
                }
            }
        });
    }

    // ------------------------------------------------
    // Запуск
    // ------------------------------------------------

    function start() {
        if (window.appready) {
            initPlugin();
        } else {
            Lampa.Listener.follow('app', function (e) {
                if (e.type === 'ready') initPlugin();
            });
        }
    }

    start();

})();
