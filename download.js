(function () {
    'use strict';

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

    function getVideoUrl() {
        try {
            var pd = Lampa.Player.playdata();
            if (pd && pd.url) {
                var videoUrl = pd.url;
                // Ensure we have a string
                if (typeof videoUrl === 'string' && videoUrl.indexOf('http') === 0) {
                    return videoUrl;
                }
            }
        } catch (e) {}
        try {
            var v = document.querySelector('video');
            if (v && v.src && typeof v.src === 'string' && v.src.indexOf('blob:') !== 0) {
                return v.src;
            }
        } catch (e) {}
        return null;
    }

    // Store available qualities from Lampa events
    var availableQualities = [];

    // Store card data when source is selected (before player starts)
    var savedCard = null;

    // Try to get all available quality URLs
    function getQualities() {
        var qualities = [];

        try {
            // Try to get from player data
            var pd = Lampa.Player.playdata();
            if (pd) {
                console.log('[DLHelper] playdata keys:', Object.keys(pd).join(', '));

                // Check for quality/qualities array
                if (pd.qualities && Array.isArray(pd.qualities)) {
                    pd.qualities.forEach(function(q) {
                        if (q.url) qualities.push({ label: q.label || q.quality || 'Unknown', url: q.url });
                    });
                }

                // Check for quality object with URLs
                if (pd.quality && typeof pd.quality === 'object') {
                    for (var key in pd.quality) {
                        if (pd.quality[key] && typeof pd.quality[key] === 'string') {
                            qualities.push({ label: key, url: pd.quality[key] });
                        }
                    }
                }

                // Check for streams array
                if (pd.streams && Array.isArray(pd.streams)) {
                    pd.streams.forEach(function(s) {
                        if (s.url) qualities.push({ label: s.label || s.quality || 'Stream', url: s.url });
                    });
                }
            }
        } catch (e) {
            console.log('[DLHelper] Error getting qualities:', e);
        }

        // Also check stored qualities from events
        if (availableQualities.length > 0) {
            qualities = qualities.concat(availableQualities);
        }

        // Remove duplicates
        var seen = {};
        qualities = qualities.filter(function(q) {
            if (seen[q.url]) return false;
            seen[q.url] = true;
            return true;
        });

        return qualities;
    }

    // Hook to capture quality data when source loads
    function captureQualities(data) {
        availableQualities = [];
        try {
            if (data && data.quality) {
                for (var key in data.quality) {
                    if (data.quality[key]) {
                        availableQualities.push({ label: key, url: data.quality[key] });
                    }
                }
            }
            if (data && data.file) {
                // Sometimes qualities are in 'file' as comma-separated or array
                if (typeof data.file === 'string' && data.file.indexOf(',') > -1) {
                    // Parse "[720p]url,[480p]url" format
                    var parts = data.file.split(',');
                    parts.forEach(function(p) {
                        var match = p.match(/\[([^\]]+)\](.*)/);
                        if (match) {
                            availableQualities.push({ label: match[1], url: match[2] });
                        }
                    });
                }
            }
            console.log('[DLHelper] Captured qualities:', availableQualities.length);
        } catch (e) {
            console.log('[DLHelper] Error capturing qualities:', e);
        }
    }

    // Generate filename based on content type
    // Movies:  Movie Name - 2024 - 720p.mp4
    // Series:  Series Name - S01E05 - Episode Name - 720p.mp4
    function getFilename(quality) {
        var parts = [];
        var card = null;
        var pd = null;

        // Get card data from multiple sources
        try {
            // 1. Try saved card (captured when source was selected)
            if (savedCard) {
                card = savedCard;
            }
            // 2. Try Activity.active()
            if (!card) {
                var a = Lampa.Activity.active();
                if (a && a.card) card = a.card;
            }
            // 3. Try Lampa.Storage.get('activity')
            if (!card) {
                var act = Lampa.Storage.get('activity', {});
                if (act && act.card) card = act.card;
            }
        } catch (e) {}

        // Get player data
        try {
            pd = Lampa.Player.playdata();
        } catch (e) {}

        // Check if it's a series (has season/episode)
        var season = pd && pd.season;
        var episode = pd && pd.episode;
        var isSeries = season || episode;

        // Get series/movie name from card
        var seriesName = '';
        if (card) {
            seriesName = card.title || card.name || '';
        }

        // Get episode name from playdata
        var episodeName = '';
        if (pd && pd.title) {
            episodeName = pd.title;
        }

        if (isSeries) {
            // Series: "Series Name - S01E05 - Episode Name - 720p"
            if (seriesName) parts.push(seriesName);

            // Add S01E05 format
            var se = 'S' + String(season || 1).padStart(2, '0') + 'E' + String(episode || 1).padStart(2, '0');
            parts.push(se);

            // Add episode name if different from series name
            if (episodeName && episodeName !== seriesName) {
                parts.push(episodeName);
            }
        } else {
            // Movie: "Movie Name - 2024 - 720p"
            var title = seriesName || episodeName || '';
            if (title) parts.push(title);

            // Add year if available
            var year = card && (card.year || card.release_date);
            if (year) {
                if (typeof year === 'string' && year.length > 4) {
                    year = year.substring(0, 4);
                }
                parts.push(year);
            }
        }

        // Add quality
        if (quality) {
            parts.push(quality);
        }

        // Clean each part, then join with " - "
        var filename = parts
            .map(function(p) {
                return String(p).replace(/[<>:"/\\|?*]/g, '').trim();
            })
            .filter(function(p) { return p.length > 0; })
            .join(' - ');

        return filename || 'video';
    }

    // Simple title for menu display
    function getTitle() {
        try {
            var a = Lampa.Activity.active();
            if (a && a.card) {
                return a.card.title || a.card.name || 'video';
            }
        } catch (e) {}

        var el = document.querySelector('.player-info__name');
        if (el && el.textContent.trim()) {
            return el.textContent.trim();
        }

        return 'video';
    }

    function openExternal(url, title) {
        // Use Lampa.Android.openPlayer
        if (Lampa.Android && Lampa.Android.openPlayer) {
            // Try passing title as JSON object
            Lampa.Android.openPlayer(url, JSON.stringify({ title: title }));
            return true;
        }
        return false;
    }

    // Show actions for selected quality
    function showQualityActions(selectedUrl, qualityLabel, videoTitle) {
        var androidAvailable = Lampa.Android && Lampa.Android.openPlayer;
        var filename = getFilename(qualityLabel);

        var items = [];

        if (androidAvailable) {
            items.push({ title: 'Open in 1DM', subtitle: filename + '.mp4', id: '1dm' });
            items.push({ title: 'Open in DVGet', subtitle: filename + '.mp4', id: 'dvget' });
            items.push({ title: 'Open in External App', subtitle: 'VLC, MX Player...', id: 'external' });
        }

        items.push({ title: 'Copy URL', subtitle: qualityLabel + ' stream', id: 'copy' });

        Lampa.Select.show({
            title: qualityLabel + ' - What to do?',
            items: items,
            onSelect: function(item) {
                Lampa.Select.close();

                if (item.id === '1dm') {
                    var urlWith1DM = selectedUrl + '#filename=' + encodeURIComponent(filename + '.mp4');
                    Lampa.Android.openPlayer(urlWith1DM, JSON.stringify({ title: filename }));
                    Lampa.Noty.show('1DM: ' + filename);
                } else if (item.id === 'dvget') {
                    var urlWithDV = selectedUrl + '#filename=' + encodeURIComponent(filename + '.mp4');
                    Lampa.Android.openPlayer(urlWithDV, JSON.stringify({ title: filename }));
                    Lampa.Noty.show('DVGet: ' + filename);
                } else if (item.id === 'external') {
                    Lampa.Android.openPlayer(selectedUrl, JSON.stringify({ title: filename }));
                    Lampa.Noty.show('Opening ' + qualityLabel + '...');
                } else {
                    copyToClipboard(selectedUrl);
                    Lampa.Noty.show(qualityLabel + ' URL copied!');
                }
            },
            onBack: function() {
                showMenu(); // Go back to main menu
            }
        });
    }

    function showMenu() {
        var url = getVideoUrl();
        if (!url) {
            Lampa.Noty.show('URL not found. Start playing first!');
            return;
        }

        var title = getTitle();
        var androidAvailable = Lampa.Android && Lampa.Android.openPlayer;

        var items = [];

        // Debug option to see what data is available
        items.push({ title: '🔍 Debug Info', subtitle: 'Show available data', id: 'debug' });

        // Always show quality selector first
        items.push({ title: 'Select Quality', subtitle: 'Choose resolution before download', id: 'quality' });

        if (androidAvailable) {
            items.push({ title: 'Download with 1DM', subtitle: 'Current quality + filename', id: '1dm' });
            items.push({ title: 'Download with DVGet', subtitle: 'Current quality + filename', id: 'dvget' });
            items.push({ title: 'Open with External App', subtitle: 'VLC, MX Player...', id: 'external' });
        }

        items.push({ title: 'Copy URL (current quality)', subtitle: 'Manual paste', id: 'copy' });

        Lampa.Select.show({
            title: 'Download: ' + title.substring(0, 25),
            items: items,
            onSelect: function (item) {
                Lampa.Select.close();

                if (item.id === 'debug') {
                    // Show debug info
                    var debugInfo = [];

                    // Check savedCard (captured when source selected)
                    debugInfo.push('SAVED: ' + (savedCard ? (savedCard.title || savedCard.name || 'obj') : 'null'));

                    // Check Activity.active()
                    try {
                        var a = Lampa.Activity.active();
                        debugInfo.push('ACT: ' + (a ? a.component : 'null'));
                        if (a && a.card) {
                            debugInfo.push('ACT.card: ' + (a.card.title || a.card.name));
                        }
                    } catch(e) {}

                    // Check playdata
                    try {
                        var pd = Lampa.Player.playdata();
                        if (pd) {
                            debugInfo.push('PD.keys: ' + Object.keys(pd).join(','));
                            debugInfo.push('PD.title: ' + (pd.title || 'none'));
                            debugInfo.push('PD.season: ' + (pd.season || 'none'));
                        }
                    } catch(e) {}

                    // Check Lampa.Storage
                    var storageKeys = ['activity', 'movie', 'card'];
                    storageKeys.forEach(function(key) {
                        try {
                            var val = Lampa.Storage.get(key, null);
                            if (val) {
                                if (val.card) {
                                    debugInfo.push('STOR.' + key + '.card: ' + (val.card.title || val.card.name));
                                } else if (val.title || val.name) {
                                    debugInfo.push('STOR.' + key + ': ' + (val.title || val.name));
                                }
                            }
                        } catch(e) {}
                    });

                    debugInfo.push('FILENAME: ' + getFilename('720p'));

                    // Show in select menu
                    var debugItems = debugInfo.map(function(info) {
                        return { title: info };
                    });

                    Lampa.Select.show({
                        title: 'Debug Info',
                        items: debugItems,
                        onBack: function() { showMenu(); }
                    });
                    return;
                }

                if (item.id === 'quality') {
                    // Show quality selector
                    var qualities = getQualities();
                    console.log('[DLHelper] Found qualities:', qualities.length, qualities);

                    if (qualities.length === 0) {
                        // No qualities found, copy current URL
                        copyToClipboard(url);
                        Lampa.Noty.show('No qualities found. Current URL copied!');
                        return;
                    }

                    // Show quality selection menu
                    var qualityItems = qualities.map(function(q) {
                        return { title: q.label, url: q.url };
                    });

                    Lampa.Select.show({
                        title: 'Select Quality',
                        items: qualityItems,
                        onSelect: function(selected) {
                            Lampa.Select.close();
                            // Show action menu for selected quality
                            showQualityActions(selected.url, selected.title, title);
                        },
                        onBack: function() {
                            showMenu(); // Go back to main menu
                        }
                    });
                } else if (item.id === 'external') {
                    try {
                        // Copy title to clipboard for manual paste
                        copyToClipboard(title);
                        var opened = openExternal(url, title);
                        if (opened) {
                            Lampa.Noty.show('"' + title.substring(0, 20) + '" copied! Paste as filename');
                        } else {
                            copyToClipboard(url);
                            Lampa.Noty.show('No method found. URL copied!');
                        }
                    } catch (e) {
                        copyToClipboard(url);
                        Lampa.Noty.show('Error: ' + e.message + '. URL copied!');
                    }
                } else if (item.id === '1dm') {
                    try {
                        var filename = getFilename();
                        var urlWith1DM = url + '#filename=' + encodeURIComponent(filename + '.mp4');
                        Lampa.Android.openPlayer(urlWith1DM, JSON.stringify({ title: filename }));
                        Lampa.Noty.show('1DM: ' + filename);
                    } catch (e) {
                        copyToClipboard(url);
                        Lampa.Noty.show('Error: ' + e.message);
                    }
                } else if (item.id === 'dvget') {
                    try {
                        var filename = getFilename();
                        var urlWithDV = url + '#filename=' + encodeURIComponent(filename + '.mp4');
                        Lampa.Android.openPlayer(urlWithDV, JSON.stringify({ title: filename }));
                        Lampa.Noty.show('DVGet: ' + filename);
                    } catch (e) {
                        copyToClipboard(url);
                        Lampa.Noty.show('Error: ' + e.message);
                    }
                } else {
                    copyToClipboard(url);
                    Lampa.Noty.show('URL copied! Paste in Seal/YTDLnis');
                }
            },
            onBack: function () {
                Lampa.Controller.toggle('player');
            }
        });
    }

    function addButton() {
        if (document.querySelector('.dlhelper-btn')) return;
        var panel = document.querySelector('.player-panel__right');
        if (!panel) return;

        var btn = document.createElement('div');
        btn.className = 'player-panel__item selector dlhelper-btn';
        btn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" style="width:1.5em;height:1.5em;"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>';
        btn.addEventListener('click', showMenu);
        $(btn).on('hover:enter', showMenu);

        var settings = panel.querySelector('.player-panel__settings');
        if (settings) panel.insertBefore(btn, settings);
        else panel.appendChild(btn);
    }

    function startPlugin() {
        window.lampa_download_helper = true;

        // Capture card data when full page loads (before player)
        Lampa.Listener.follow('full', function (e) {
            if (e.type === 'complite') {
                setTimeout(addButton, 500);
            }
            // Capture card from full activity
            try {
                var a = Lampa.Activity.active();
                if (a && a.card) {
                    savedCard = a.card;
                    console.log('[DLHelper] Saved card:', savedCard.title || savedCard.name);
                }
            } catch(err) {}
            // Try to capture quality data from various event types
            if (e.data) {
                captureQualities(e.data);
            }
        });

        // Also try to capture from player events
        if (Lampa.Player && Lampa.Player.listener) {
            Lampa.Player.listener.follow('start', function (data) {
                setTimeout(addButton, 500);
                if (data) captureQualities(data);
            });

            // Capture quality change events
            Lampa.Player.listener.follow('quality', function (data) {
                console.log('[DLHelper] Quality event:', data);
                if (data) captureQualities(data);
            });
        }

        // Hook into video source selection
        Lampa.Listener.follow('video', function (e) {
            console.log('[DLHelper] Video event:', e.type, e.data ? Object.keys(e.data) : 'no data');
            if (e.data) captureQualities(e.data);
        });

    }

    if (!window.lampa_download_helper) startPlugin();
})();
