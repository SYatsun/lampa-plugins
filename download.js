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
    var capturedStreams = null; // Store streams object from player

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

    // ========== DOWNLOAD ACTION ==========
    function doDownload(url, quality) {
        var filename = getFilename(quality);
        var dlUrl = url + '#filename=' + encodeURIComponent(filename + '.mp4');
        Lampa.Android.openPlayer(dlUrl, JSON.stringify({ title: filename }));
        Lampa.Noty.show('Downloading: ' + filename);
    }

    function doExternal(url, quality) {
        var filename = getFilename(quality);
        Lampa.Android.openPlayer(url, JSON.stringify({ title: filename }));
        Lampa.Noty.show('Opening player...');
    }

    // ========== DOWNLOAD MENU ==========
    function showDownloadMenu(url, quality, returnTo) {
        if (!url || url.indexOf('http') !== 0) {
            Lampa.Noty.show('Invalid URL');
            return;
        }

        returnTo = returnTo || 'content';
        var androidAvailable = Lampa.Android && Lampa.Android.openPlayer;
        var filename = getFilename(quality);

        var items = [
            { title: '🔗 Show URL', subtitle: url.substring(0, 45) + '...', id: 'showurl' }
        ];

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
                if (item.id === 'download') {
                    doDownload(url, quality);
                } else if (item.id === 'external') {
                    doExternal(url, quality);
                } else if (item.id === 'copy') {
                    copyToClipboard(url);
                    Lampa.Noty.show('Copied!');
                } else if (item.id === 'showurl') {
                    Lampa.Noty.show(url.substring(0, 80));
                    copyToClipboard(url);
                }
                Lampa.Controller.toggle(returnTo);
            },
            onBack: function() { Lampa.Controller.toggle(returnTo); },
            _dlHelper: true
        });
    }

    // ========== QUALITY SELECTOR ==========
    function getQualityLabel(stream) {
        var label = stream.quality || stream.label || stream.title || 'Video';
        // Handle object - try to get a string from it
        if (typeof label === 'object' && label !== null) {
            label = label.title || label.name || label.quality || label.label || JSON.stringify(label).substring(0, 30);
        }
        return String(label);
    }

    function formatBytes(bytes) {
        if (!bytes || bytes <= 0) return '';
        var sizes = ['B', 'KB', 'MB', 'GB'];
        var i = Math.floor(Math.log(bytes) / Math.log(1024));
        return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + sizes[i];
    }

    function fetchFileSize(url, callback) {
        var xhr = new XMLHttpRequest();
        xhr.open('HEAD', url, true);
        xhr.timeout = 5000;
        xhr.onreadystatechange = function() {
            if (xhr.readyState === 4) {
                var size = xhr.getResponseHeader('Content-Length');
                callback(size ? parseInt(size, 10) : 0);
            }
        };
        xhr.onerror = function() { callback(0); };
        xhr.ontimeout = function() { callback(0); };
        xhr.send();
    }

    function showQualitySelector(streams, returnTo) {
        if (!streams || streams.length === 0) {
            Lampa.Noty.show('No streams available');
            return;
        }

        if (streams.length === 1) {
            showDownloadMenu(streams[0].url, getQualityLabel(streams[0]), returnTo);
            return;
        }

        // Create items with loading subtitle
        var items = streams.map(function(s, i) {
            return {
                title: getQualityLabel(s) || ('Quality ' + (i + 1)),
                subtitle: 'Loading size...',
                url: s.url
            };
        });

        // Show menu immediately
        Lampa.Select.show({
            title: 'Select Quality',
            items: items,
            onSelect: function(item) {
                Lampa.Select.close();
                showDownloadMenu(item.url, item.title, returnTo);
            },
            onBack: function() { Lampa.Controller.toggle(returnTo); },
            _dlHelper: true
        });

        // Fetch sizes in background and update
        items.forEach(function(item, index) {
            fetchFileSize(item.url, function(size) {
                var sizeText = size > 0 ? formatBytes(size) : 'Unknown size';
                // Update the item subtitle
                items[index].subtitle = sizeText;
                // Try to update displayed element
                try {
                    var elements = document.querySelectorAll('.selectbox .selectbox-item');
                    if (elements[index]) {
                        var subtitle = elements[index].querySelector('.selectbox-item__subtitle');
                        if (subtitle) subtitle.textContent = sizeText;
                    }
                } catch(e) {}
            });
        });
    }

    // ========== HELPER: Parse URL/Quality ==========
    function parseStreamData(data, defaultQuality) {
        var results = [];

        // If it's a string URL
        if (typeof data === 'string' && data.indexOf('http') === 0) {
            results.push({ url: data, quality: defaultQuality || 'Video' });
        }
        // If it's an object with quality -> URL mapping
        else if (typeof data === 'object' && data !== null) {
            Object.keys(data).forEach(function(key) {
                var val = data[key];
                if (typeof val === 'string' && val.indexOf('http') === 0) {
                    results.push({ url: val, quality: key });
                }
            });
        }

        return results;
    }

    // ========== PLAYER BUTTON ==========
    function getPlayerStreams() {
        var streams = [];

        try {
            var pd = Lampa.Player.playdata();
            if (pd) {
                // Parse pd.url - might be string or object
                if (pd.url) {
                    var parsed = parseStreamData(pd.url, pd.quality || 'Current');
                    parsed.forEach(function(p) {
                        if (streams.every(function(s) { return s.url !== p.url; })) {
                            streams.push(p);
                        }
                    });
                }

                // Check for urls object
                if (pd.urls) {
                    var parsed2 = parseStreamData(pd.urls, 'Video');
                    parsed2.forEach(function(p) {
                        if (streams.every(function(s) { return s.url !== p.url; })) {
                            streams.push(p);
                        }
                    });
                }

                // Check for playlist
                if (pd.playlist && Array.isArray(pd.playlist)) {
                    pd.playlist.forEach(function(item) {
                        var parsed3 = parseStreamData(item.url || item, item.title || item.quality || 'Video');
                        parsed3.forEach(function(p) {
                            if (streams.every(function(s) { return s.url !== p.url; })) {
                                streams.push(p);
                            }
                        });
                    });
                }
            }
        } catch (e) {}

        // Fallback: video element
        if (streams.length === 0) {
            try {
                var v = document.querySelector('video');
                if (v && v.src && v.src.indexOf('http') === 0) {
                    streams.push({ url: v.src, quality: 'Current' });
                }
            } catch (e) {}
        }

        // Add captured streams
        if (capturedStreams && capturedStreams.length > 0) {
            capturedStreams.forEach(function(s) {
                if (s.url && typeof s.url === 'string' && streams.every(function(x) { return x.url !== s.url; })) {
                    streams.push({ url: s.url, quality: typeof s.quality === 'string' ? s.quality : 'Captured' });
                }
            });
        }

        return streams;
    }

    function showPlayerMenu() {
        var streams = getPlayerStreams();

        if (streams.length === 0) {
            Lampa.Noty.show('No URL. Play video first!');
            return;
        }

        showQualitySelector(streams, 'player');
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

        // Capture card and reset streams on new content
        Lampa.Listener.follow('full', function (e) {
            if (e.type === 'complite') setTimeout(addPlayerButton, 500);
            try {
                var a = Lampa.Activity.active();
                if (a && a.card) {
                    // If different card, reset captured streams
                    if (!savedCard || savedCard.id !== a.card.id) {
                        capturedStreams = null;
                    }
                    savedCard = a.card;
                }
            } catch(e) {}
        });

        // Player events
        if (Lampa.Player && Lampa.Player.listener) {
            Lampa.Player.listener.follow('start', function () {
                setTimeout(addPlayerButton, 500);
            });
        }

        // ========== INTERCEPT Select.show ==========
        var originalSelectShow = Lampa.Select.show;

        Lampa.Select.show = function(params) {
            if (params && params._dlHelper) {
                return originalSelectShow.call(this, params);
            }

            if (params && params.items && Array.isArray(params.items)) {
                var menuTitle = (params.title || '').toLowerCase();
                var isActionMenu = menuTitle.indexOf('действие') > -1 || menuTitle.indexOf('action') > -1;

                // Only extract streams from menus that look like quality selectors
                // (items with file() functions that return URLs)
                var streams = [];
                var hasFileFunction = false;

                params.items.forEach(function(item) {
                    // Check for file() function - this is the main indicator of a quality menu
                    if (typeof item.file === 'function') {
                        hasFileFunction = true;
                        try {
                            var result = item.file();

                            // Result is a direct URL string
                            if (typeof result === 'string' && result.indexOf('http') === 0) {
                                streams.push({ url: result, quality: item.title || 'Video' });
                            }
                            // Result is an object with quality -> URL mapping
                            else if (typeof result === 'object' && result !== null && !Array.isArray(result)) {
                                Object.keys(result).forEach(function(quality) {
                                    var url = result[quality];
                                    if (typeof url === 'string' && url.indexOf('http') === 0) {
                                        streams.push({ url: url, quality: quality });
                                    }
                                });
                            }
                        } catch(e) {}
                    }
                });

                // Only store if we found actual streams from file() functions
                // This avoids capturing episode lists or other menus
                if (hasFileFunction && streams.length > 0) {
                    capturedStreams = streams;
                }

                // Add download button to action menu
                if (isActionMenu) {
                    params.items.push({
                        title: '⬇️ Download',
                        subtitle: (capturedStreams && capturedStreams.length > 0) ? capturedStreams.length + ' qualities' : 'Current only',
                        onSelect: function() {
                            Lampa.Select.close();
                            var toDownload = (capturedStreams && capturedStreams.length > 0) ? capturedStreams : getPlayerStreams();
                            if (toDownload.length === 0) {
                                Lampa.Noty.show('No URLs. Play video first!');
                                return;
                            }
                            showQualitySelector(toDownload, 'content');
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
