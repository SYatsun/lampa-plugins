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

    function getTitle() {
        // Try player info (includes episode info)
        var el = document.querySelector('.player-info__name');
        if (el && el.textContent.trim()) {
            return el.textContent.trim();
        }

        // Try full player info with season/episode
        try {
            var pd = Lampa.Player.playdata();
            if (pd) {
                var parts = [];
                if (pd.title) parts.push(pd.title);
                if (pd.season) parts.push('S' + pd.season);
                if (pd.episode) parts.push('E' + pd.episode);
                if (parts.length) return parts.join(' ');
            }
        } catch (e) {}

        // Try activity card
        try {
            var a = Lampa.Activity.active();
            if (a && a.card) {
                var title = a.card.title || a.card.name;
                if (title) return title;
            }
        } catch (e) {}

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
        var safeTitle = videoTitle.replace(/[<>:"/\\|?*]/g, '_') + ' ' + qualityLabel;

        var items = [];

        if (androidAvailable) {
            items.push({ title: 'Open in 1DM', subtitle: safeTitle, id: '1dm' });
            items.push({ title: 'Open in DVGet', subtitle: safeTitle, id: 'dvget' });
            items.push({ title: 'Open in External App', subtitle: 'VLC, MX Player...', id: 'external' });
        }

        items.push({ title: 'Copy URL', subtitle: qualityLabel + ' stream', id: 'copy' });

        Lampa.Select.show({
            title: qualityLabel + ' - What to do?',
            items: items,
            onSelect: function(item) {
                Lampa.Select.close();

                if (item.id === '1dm') {
                    var urlWith1DM = selectedUrl + '#filename=' + encodeURIComponent(safeTitle + '.mp4');
                    Lampa.Android.openPlayer(urlWith1DM, JSON.stringify({ title: safeTitle }));
                    Lampa.Noty.show('Opening ' + qualityLabel + ' in 1DM...');
                } else if (item.id === 'dvget') {
                    var urlWithDV = selectedUrl + '#filename=' + encodeURIComponent(safeTitle + '.mp4');
                    Lampa.Android.openPlayer(urlWithDV, JSON.stringify({ title: safeTitle }));
                    Lampa.Noty.show('Opening ' + qualityLabel + ' in DVGet...');
                } else if (item.id === 'external') {
                    Lampa.Android.openPlayer(selectedUrl, JSON.stringify({ title: safeTitle }));
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
                        // 1DM supports #filename= fragment for custom filename
                        var safeTitle = title.replace(/[<>:"/\\|?*]/g, '_');
                        var urlWith1DM = url + '#filename=' + encodeURIComponent(safeTitle + '.mp4');
                        Lampa.Android.openPlayer(urlWith1DM, JSON.stringify({ title: title }));
                        Lampa.Noty.show('Opening in 1DM...');
                    } catch (e) {
                        copyToClipboard(url);
                        Lampa.Noty.show('Error: ' + e.message);
                    }
                } else if (item.id === 'dvget') {
                    try {
                        // DVGet supports #filename= fragment like 1DM
                        var safeTitle = title.replace(/[<>:"/\\|?*]/g, '_');
                        var urlWithDV = url + '#filename=' + encodeURIComponent(safeTitle + '.mp4');
                        Lampa.Android.openPlayer(urlWithDV, JSON.stringify({ title: title }));
                        Lampa.Noty.show('Opening in DVGet...');
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

        // Capture quality data when source loads
        Lampa.Listener.follow('full', function (e) {
            if (e.type === 'complite') {
                setTimeout(addButton, 500);
            }
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
