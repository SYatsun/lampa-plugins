(function () {
    'use strict';

    // ========== UTILITIES ==========
    function copyToClipboard(text) {
        if (navigator.clipboard) {
            navigator.clipboard.writeText(text);
            return true;
        }
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        return true;
    }

    // ========== STORAGE ==========
    var savedCard = null;
    var capturedUrls = []; // Store captured URLs globally

    // ========== FILENAME GENERATOR ==========
    function getFilename(quality) {
        var parts = [];
        var card = savedCard;

        if (!card) {
            try {
                var a = Lampa.Activity.active();
                if (a && a.card) card = a.card;
            } catch (e) {}
        }

        if (card) {
            parts.push(card.title || card.name || '');
        }

        try {
            var pd = Lampa.Player.playdata();
            if (pd && (pd.season || pd.episode)) {
                var se = 'S' + String(pd.season || 1).padStart(2, '0') + 'E' + String(pd.episode || 1).padStart(2, '0');
                parts.push(se);
                if (pd.title && pd.title !== (card && card.title)) {
                    parts.push(pd.title);
                }
            }
        } catch (e) {}

        if (quality) parts.push(quality);

        var filename = parts
            .filter(function(p) { return p && p.length > 0; })
            .join(' - ')
            .replace(/[<>:"/\\|?*]/g, '')
            .trim();

        return filename || 'video';
    }

    // ========== DOWNLOAD MENU ==========
    function showDownloadMenu(urls, fromPlayer) {
        // urls can be: string (single URL), or array of {url, label/quality}
        var urlList = [];
        if (typeof urls === 'string') {
            urlList = [{ url: urls, label: '' }];
        } else if (Array.isArray(urls)) {
            urlList = urls;
        } else {
            Lampa.Noty.show('ERROR: Invalid URLs');
            return;
        }

        if (urlList.length === 0) {
            Lampa.Noty.show('No URLs available');
            return;
        }

        var androidAvailable = Lampa.Android && Lampa.Android.openPlayer;
        var returnTo = fromPlayer ? 'player' : 'content';

        // Function to do actual download
        function doDownload(url, quality) {
            var filename = getFilename(quality);
            var dlUrl = url + '#filename=' + encodeURIComponent(filename + '.mp4');
            Lampa.Android.openPlayer(dlUrl, JSON.stringify({ title: filename }));
            Lampa.Noty.show('Downloading: ' + filename);
            Lampa.Controller.toggle(returnTo);
        }

        // Function to open in external player
        function doExternal(url, quality) {
            var filename = getFilename(quality);
            Lampa.Android.openPlayer(url, JSON.stringify({ title: filename }));
            Lampa.Noty.show('Opening player...');
            Lampa.Controller.toggle(returnTo);
        }

        // Function to show quality selector then action
        function selectQualityThen(action) {
            if (urlList.length === 1) {
                action(urlList[0].url, urlList[0].label || urlList[0].quality || '');
                return;
            }

            var items = urlList.map(function(u) {
                return { title: u.label || u.quality || 'Video', url: u.url };
            });

            Lampa.Select.show({
                title: 'Вибери якість',
                items: items,
                onSelect: function(sel) {
                    Lampa.Select.close();
                    action(sel.url, sel.title);
                },
                onBack: function() { Lampa.Controller.toggle(returnTo); },
                _dlHelper: true
            });
        }

        // Main menu
        var items = [];
        var firstUrl = urlList[0].url;
        var qualityInfo = urlList.length > 1 ? urlList.length + ' qualities' : '';

        items.push({
            title: '🔗 Show URL',
            subtitle: firstUrl.substring(0, 45) + '...',
            id: 'showurl'
        });

        if (androidAvailable) {
            items.push({
                title: '📥 ADM / 1DM / DVGet',
                subtitle: qualityInfo || getFilename('') + '.mp4',
                id: 'download'
            });
            items.push({
                title: '▶️ External Player',
                subtitle: 'VLC, MX...',
                id: 'external'
            });
        }

        items.push({ title: '📋 Copy URL', id: 'copy' });

        Lampa.Select.show({
            title: 'Download',
            items: items,
            onSelect: function(item) {
                Lampa.Select.close();

                if (item.id === 'showurl') {
                    selectQualityThen(function(url, quality) {
                        Lampa.Select.show({
                            title: 'URL (' + quality + ')',
                            items: [
                                { title: url.substring(0, 60) },
                                { title: url.substring(60, 120) || '(end)' },
                                { title: '📋 Copy', id: 'copy', _url: url }
                            ],
                            onSelect: function(sel) {
                                if (sel.id === 'copy') {
                                    copyToClipboard(sel._url);
                                    Lampa.Noty.show('Copied!');
                                }
                                Lampa.Select.close();
                                Lampa.Controller.toggle(returnTo);
                            },
                            onBack: function() { Lampa.Controller.toggle(returnTo); },
                            _dlHelper: true
                        });
                    });
                } else if (item.id === 'download') {
                    selectQualityThen(doDownload);
                } else if (item.id === 'external') {
                    selectQualityThen(doExternal);
                } else if (item.id === 'copy') {
                    selectQualityThen(function(url) {
                        copyToClipboard(url);
                        Lampa.Noty.show('URL copied!');
                        Lampa.Controller.toggle(returnTo);
                    });
                }
            },
            onBack: function() { Lampa.Controller.toggle(returnTo); },
            _dlHelper: true
        });
    }

    // ========== PLAYER BUTTON ==========
    function getVideoUrl() {
        try {
            var pd = Lampa.Player.playdata();
            if (pd && pd.url && typeof pd.url === 'string' && pd.url.indexOf('http') === 0) {
                return pd.url;
            }
        } catch (e) {}
        try {
            var v = document.querySelector('video');
            if (v && v.src && typeof v.src === 'string' && v.src.indexOf('http') === 0) {
                return v.src;
            }
        } catch (e) {}
        return null;
    }

    function showPlayerMenu() {
        // Build list of available URLs
        var urlList = [];

        // Add captured URLs
        if (capturedUrls.length > 0) {
            capturedUrls.forEach(function(u) {
                urlList.push({ url: u.url, label: u.label || u.quality || '' });
            });
        }

        // Add current playing URL if not already in list
        var currentUrl = getVideoUrl();
        if (currentUrl) {
            var alreadyHas = urlList.some(function(u) { return u.url === currentUrl; });
            if (!alreadyHas) {
                urlList.unshift({ url: currentUrl, label: 'Current' });
            }
        }

        if (urlList.length === 0) {
            Lampa.Noty.show('No URL. Play video first!');
            return;
        }

        showDownloadMenu(urlList, true);
    }

    function addPlayerButton() {
        if (document.querySelector('.dlhelper-btn')) return;
        var panel = document.querySelector('.player-panel__right');
        if (!panel) return;

        var btn = document.createElement('div');
        btn.className = 'player-panel__item selector dlhelper-btn';
        btn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" style="width:1.5em;height:1.5em;"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>';
        btn.addEventListener('click', showPlayerMenu);
        $(btn).on('hover:enter', showPlayerMenu);

        var settings = panel.querySelector('.player-panel__settings');
        if (settings) panel.insertBefore(btn, settings);
        else panel.appendChild(btn);
    }

    // ========== EXTRACT URLs FROM MENU ITEMS ==========
    function extractUrlsFromItems(items, debug) {
        var urls = [];

        items.forEach(function(item, i) {
            var keys = Object.keys(item);
            if (debug) debug.push('--- Item ' + i + ': ' + (item.title || '?').substring(0, 30));
            if (debug) debug.push('Keys: ' + keys.join(', '));

            keys.forEach(function(key) {
                var val = item[key];
                var type = typeof val;

                // String properties
                if (type === 'string' && val.length > 5) {
                    if (debug) debug.push('  ' + key + ': ' + val.substring(0, 50));
                    if (val.indexOf('http') === 0) {
                        urls.push({ label: item.title || key, url: val, quality: item.quality || item.title });
                        if (debug) debug.push('    ^ URL FOUND ^');
                    }
                }

                // Function properties - try to call them
                if (type === 'function' && key !== 'onSelect' && key !== 'onBack' && key !== 'onFocus' && key !== 'callback') {
                    if (debug) debug.push('  ' + key + ' [func]');
                    try {
                        var result = val();
                        if (result && typeof result === 'string') {
                            if (debug) debug.push('    ' + key + '() = ' + result.substring(0, 50));
                            if (result.indexOf('http') === 0) {
                                urls.push({ label: item.title || key, url: result, quality: item.quality || item.title });
                                if (debug) debug.push('    ^ URL FROM FUNC ^');
                            }
                        }
                    } catch(e) {
                        if (debug) debug.push('    ' + key + '() error: ' + e.message);
                    }
                }

                // Object properties - check nested
                if (type === 'object' && val !== null && !Array.isArray(val)) {
                    var objKeys = Object.keys(val);
                    if (debug) debug.push('  ' + key + ' [obj]: ' + objKeys.slice(0, 5).join(','));
                    objKeys.forEach(function(oKey) {
                        var oVal = val[oKey];
                        if (typeof oVal === 'string' && oVal.indexOf('http') === 0) {
                            urls.push({ label: item.title + '.' + oKey, url: oVal, quality: item.title });
                            if (debug) debug.push('    ' + key + '.' + oKey + ' URL FOUND');
                        }
                    });
                }
            });
        });

        return urls;
    }

    // ========== MAIN PLUGIN ==========
    function startPlugin() {
        window.lampa_download_helper = true;

        // Capture card on full event
        Lampa.Listener.follow('full', function (e) {
            if (e.type === 'complite') setTimeout(addPlayerButton, 500);
            try {
                var a = Lampa.Activity.active();
                if (a && a.card) savedCard = a.card;
            } catch(e) {}
        });

        // Player button
        if (Lampa.Player && Lampa.Player.listener) {
            Lampa.Player.listener.follow('start', function () {
                setTimeout(addPlayerButton, 500);
            });
        }

        // ========== INTERCEPT Lampa.Player.play() ==========
        // Capture URL when video starts playing
        if (Lampa.Player && Lampa.Player.play) {
            var originalPlay = Lampa.Player.play;
            Lampa.Player.play = function(params) {
                if (params && params.url) {
                    capturedUrls = [{ label: 'Current', url: params.url, quality: params.quality || '' }];
                    console.log('[DLHelper] Captured play URL:', params.url);
                }
                return originalPlay.apply(this, arguments);
            };
        }

        // ========== INTERCEPT ALL Select.show menus ==========
        var originalSelectShow = Lampa.Select.show;

        Lampa.Select.show = function(params) {
            // Skip our own menus
            if (params && params._dlHelper) {
                return originalSelectShow.call(this, params);
            }

            if (params && params.items && Array.isArray(params.items)) {
                var menuTitle = (params.title || '').toLowerCase();

                // Check if this menu has file() functions (quality menu)
                var hasFileFunctions = params.items.some(function(item) {
                    return typeof item.file === 'function';
                });

                // Check if this is "Действие" menu
                var isActionMenu = menuTitle.indexOf('действие') > -1;

                // Check if this looks like a quality menu
                var isQualityMenu = menuTitle.indexOf('качеств') > -1 ||
                                    menuTitle.indexOf('quality') > -1 ||
                                    menuTitle.indexOf('вибер') > -1 ||
                                    hasFileFunctions;

                // Extract URLs from items
                var debug = [];
                debug.push('Menu: ' + params.title);
                debug.push('Items: ' + params.items.length);
                debug.push('Has file(): ' + hasFileFunctions);

                var urls = extractUrlsFromItems(params.items, debug);

                // Also check params-level file function
                if (typeof params.file === 'function') {
                    try {
                        var pUrl = params.file();
                        debug.push('params.file() = ' + (pUrl || '').substring(0, 50));
                        if (pUrl && pUrl.indexOf('http') === 0) {
                            urls.push({ label: 'Default', url: pUrl, quality: '' });
                        }
                    } catch(e) {}
                }

                debug.push('---');
                debug.push('URLs found: ' + urls.length);

                // Store captured URLs
                if (urls.length > 0) {
                    capturedUrls = urls;
                    console.log('[DLHelper] Captured ' + urls.length + ' URLs from menu:', menuTitle);
                }

                // Add download button to action menu OR quality menu
                if (isActionMenu || isQualityMenu) {
                    // Add DEBUG button
                    params.items.push({
                        title: '🔍 DEBUG (' + urls.length + ' urls)',
                        _debug: debug,
                        onSelect: function() {
                            Lampa.Select.close();
                            var items = this._debug.map(function(d) { return { title: d }; });
                            Lampa.Select.show({
                                title: 'Debug Info',
                                items: items,
                                onBack: function() { Lampa.Controller.toggle('content'); },
                                _dlHelper: true
                            });
                        }
                    });

                    // Add DOWNLOAD button
                    var dlUrls = urls.length > 0 ? urls : capturedUrls;
                    params.items.push({
                        title: '⬇️ Download',
                        subtitle: dlUrls.length > 0 ? dlUrls.length + ' qualities' : 'No URLs',
                        _urls: dlUrls,
                        onSelect: function() {
                            Lampa.Select.close();

                            if (this._urls.length === 0) {
                                Lampa.Noty.show('No URLs found. Try playing video first.');
                                return;
                            }

                            // Pass all URLs to download menu - quality selection happens there
                            showDownloadMenu(this._urls, false);
                        }
                    });
                }
            }

            return originalSelectShow.call(this, params);
        };
    }

    // ========== INIT ==========
    if (!window.lampa_download_helper) {
        startPlugin();
    }
})();
