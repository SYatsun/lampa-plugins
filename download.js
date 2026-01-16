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
    function showDownloadMenu(url, quality, fromPlayer) {
        if (!url || typeof url !== 'string') {
            Lampa.Noty.show('ERROR: URL is ' + (typeof url));
            return;
        }

        if (url.indexOf('http') !== 0) {
            Lampa.Noty.show('ERROR: URL not http: ' + url.substring(0, 40));
            return;
        }

        var androidAvailable = Lampa.Android && Lampa.Android.openPlayer;
        var filename = getFilename(quality);

        // Determine where to return on back
        var returnTo = fromPlayer ? 'player' : 'content';

        var items = [];

        items.push({
            title: '🔗 Show URL',
            subtitle: url.substring(0, 45) + '...',
            id: 'showurl'
        });

        if (androidAvailable) {
            items.push({ title: '📥 ADM / 1DM / DVGet', subtitle: filename + '.mp4', id: 'download' });
            items.push({ title: '▶️ External Player', subtitle: 'VLC, MX...', id: 'external' });
        }

        items.push({ title: '📋 Copy URL', id: 'copy' });

        Lampa.Select.show({
            title: 'Download: ' + filename.substring(0, 25),
            items: items,
            onSelect: function(item) {
                Lampa.Select.close();

                if (item.id === 'showurl') {
                    Lampa.Select.show({
                        title: 'URL',
                        items: [
                            { title: url.substring(0, 60) },
                            { title: url.substring(60, 120) || '(end)' },
                            { title: 'Filename: ' + filename },
                            { title: '📋 Copy', id: 'copy' }
                        ],
                        onSelect: function(sel) {
                            if (sel.id === 'copy') {
                                copyToClipboard(url);
                                Lampa.Noty.show('Copied!');
                            }
                            Lampa.Select.close();
                            Lampa.Controller.toggle(returnTo);
                        },
                        onBack: function() { Lampa.Controller.toggle(returnTo); },
                        _dlDone: true
                    });
                } else if (item.id === 'download') {
                    var dlUrl = url + '#filename=' + encodeURIComponent(filename + '.mp4');
                    Lampa.Android.openPlayer(dlUrl, JSON.stringify({ title: filename }));
                    Lampa.Noty.show('Opening: ' + filename);
                    Lampa.Controller.toggle(returnTo);
                } else if (item.id === 'external') {
                    Lampa.Android.openPlayer(url, JSON.stringify({ title: filename }));
                    Lampa.Noty.show('Opening player...');
                    Lampa.Controller.toggle(returnTo);
                } else if (item.id === 'copy') {
                    copyToClipboard(url);
                    Lampa.Noty.show('URL copied!');
                    Lampa.Controller.toggle(returnTo);
                }
            },
            onBack: function() { Lampa.Controller.toggle(returnTo); },
            _dlDone: true
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
        var url = getVideoUrl();
        if (!url) {
            Lampa.Noty.show('No URL. Start playing first!');
            return;
        }
        showDownloadMenu(url, '', true);
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

    // ========== MAIN PLUGIN ==========
    function startPlugin() {
        window.lampa_download_helper = true;

        // Capture card
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

        // ========== INTERCEPT "Действие" MENU ==========
        var originalSelectShow = Lampa.Select.show;

        Lampa.Select.show = function(params) {
            if (params && params.items && Array.isArray(params.items) && !params._dlDone) {
                params._dlDone = true;

                var menuTitle = (params.title || '').toLowerCase();
                var isActionMenu = menuTitle.indexOf('действие') > -1 || menuTitle === 'действие';

                if (isActionMenu) {
                    // Collect ALL info for debug
                    var debug = [];
                    var urls = [];

                    debug.push('Title: ' + params.title);
                    debug.push('Items: ' + params.items.length);
                    debug.push('Params keys: ' + Object.keys(params).join(', '));

                    // Check params-level properties for file/url
                    if (typeof params.file === 'function') {
                        try {
                            var pUrl = params.file();
                            debug.push('params.file() = ' + (pUrl || '').substring(0, 50));
                            if (pUrl && pUrl.indexOf('http') === 0) {
                                urls.push({ label: 'params.file', url: pUrl });
                            }
                        } catch(e) { debug.push('params.file() error: ' + e); }
                    }

                    params.items.forEach(function(item, i) {
                        var keys = Object.keys(item);
                        debug.push('---');
                        debug.push(i + ': ' + (item.title || '?').substring(0, 30));
                        debug.push('Keys: ' + keys.join(', '));

                        // Check EVERY property for URL
                        keys.forEach(function(key) {
                            var val = item[key];
                            var type = typeof val;

                            if (type === 'string') {
                                if (val.length > 5) {
                                    debug.push('  ' + key + ' [str]: ' + val.substring(0, 50));
                                }
                                // Check for URL
                                if (val.indexOf('http') === 0) {
                                    urls.push({ label: item.title || key, url: val });
                                    debug.push('    ^ VALID URL ^');
                                }
                                // Check copylink specifically (might be stored differently)
                                if (key === 'copylink' || key === 'copy_link' || key === 'link') {
                                    debug.push('    ^ Found ' + key + ': ' + val);
                                    if (val && val.indexOf('http') !== 0 && val.length > 5) {
                                        // Might be relative URL or special format
                                        debug.push('    ^ Non-http link, saving anyway');
                                        urls.push({ label: item.title + ' (link)', url: val });
                                    }
                                }
                            } else if (type === 'function') {
                                debug.push('  ' + key + ' [func]');
                                // Try calling ALL functions (except onSelect/onBack)
                                if (key !== 'onSelect' && key !== 'onBack' && key !== 'onFocus') {
                                    try {
                                        var result = val();
                                        var resultStr = (result === null || result === undefined) ? 'null' : String(result).substring(0, 50);
                                        debug.push('    called ' + key + '() = ' + resultStr);
                                        if (result && typeof result === 'string' && result.indexOf('http') === 0) {
                                            urls.push({ label: item.title || key, url: result });
                                            debug.push('    ^ VALID URL from func ^');
                                        }
                                    } catch(e) { debug.push('    ' + key + '() error: ' + e.message); }
                                }
                            } else if (type === 'object' && val !== null) {
                                var objKeys = Object.keys(val);
                                debug.push('  ' + key + ' [obj]: ' + objKeys.join(','));
                                // Check nested URL properties
                                objKeys.forEach(function(oKey) {
                                    var oVal = val[oKey];
                                    if (typeof oVal === 'string' && oVal.indexOf('http') === 0) {
                                        debug.push('    ' + key + '.' + oKey + ' = ' + oVal.substring(0, 40));
                                        urls.push({ label: item.title + ' (' + oKey + ')', url: oVal });
                                    }
                                });
                            }
                        });
                    });

                    debug.push('---');
                    debug.push('Total URLs found: ' + urls.length);

                    // Find "Копировать ссылку" item for triggering
                    var copyItem = null;
                    params.items.forEach(function(item) {
                        if (item.title && item.title.toLowerCase().indexOf('копировать') > -1) {
                            copyItem = item;
                        }
                    });

                    // Add DEBUG button
                    params.items.push({
                        title: '🔍 DEBUG (' + urls.length + ' urls)',
                        _debug: debug,
                        onSelect: function() {
                            Lampa.Select.close();
                            var items = this._debug.map(function(d) { return { title: d }; });
                            Lampa.Select.show({
                                title: 'Debug',
                                items: items,
                                onBack: function() { Lampa.Controller.toggle('content'); },
                                _dlDone: true
                            });
                        }
                    });

                    // Add "Trigger Copy" button to see what URL Lampa copies
                    if (copyItem) {
                        params.items.push({
                            title: '🔗 Trigger Copy & Capture',
                            subtitle: copyItem.title,
                            _copyItem: copyItem,
                            onSelect: function() {
                                var ci = this._copyItem;
                                // Intercept clipboard
                                var origWrite = navigator.clipboard && navigator.clipboard.writeText;
                                var capturedUrl = null;

                                if (origWrite) {
                                    navigator.clipboard.writeText = function(text) {
                                        capturedUrl = text;
                                        Lampa.Noty.show('Captured: ' + text.substring(0, 50));
                                        return origWrite.call(navigator.clipboard, text);
                                    };
                                }

                                // Also intercept execCommand
                                var origExec = document.execCommand;
                                document.execCommand = function(cmd) {
                                    if (cmd === 'copy') {
                                        var sel = window.getSelection();
                                        if (sel && sel.toString()) {
                                            capturedUrl = sel.toString();
                                            Lampa.Noty.show('Captured (exec): ' + capturedUrl.substring(0, 50));
                                        }
                                    }
                                    return origExec.apply(document, arguments);
                                };

                                // Trigger the copy item
                                if (ci.onSelect) {
                                    ci.onSelect(ci);
                                }

                                // Restore after short delay
                                setTimeout(function() {
                                    if (origWrite) navigator.clipboard.writeText = origWrite;
                                    document.execCommand = origExec;

                                    if (capturedUrl && capturedUrl.indexOf('http') === 0) {
                                        Lampa.Select.close();
                                        showDownloadMenu(capturedUrl, 'Captured');
                                    }
                                }, 500);
                            }
                        });
                    }

                    // Add DOWNLOAD button
                    params.items.push({
                        title: '⬇️ Download',
                        subtitle: urls.length > 0 ? urls.length + ' качеств' : 'Немає URL',
                        _urls: urls,
                        onSelect: function() {
                            Lampa.Select.close();

                            if (this._urls.length === 0) {
                                Lampa.Noty.show('No URLs found');
                                return;
                            }

                            if (this._urls.length === 1) {
                                showDownloadMenu(this._urls[0].url, this._urls[0].label);
                                return;
                            }

                            // Multiple - show selector
                            var items = this._urls.map(function(u) {
                                return { title: u.label, url: u.url };
                            });

                            Lampa.Select.show({
                                title: 'Вибери якість',
                                items: items,
                                onSelect: function(sel) {
                                    Lampa.Select.close();
                                    showDownloadMenu(sel.url, sel.title);
                                },
                                onBack: function() { Lampa.Controller.toggle('content'); },
                                _dlDone: true
                            });
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
