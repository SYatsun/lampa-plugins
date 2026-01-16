(function () {
    'use strict';

    // Format bytes to human readable
    function formatBytes(bytes) {
        if (!bytes || bytes === 0) return '';
        var sizes = ['B', 'KB', 'MB', 'GB'];
        var i = Math.floor(Math.log(bytes) / Math.log(1024));
        return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + sizes[i];
    }

    // Get file size via HEAD request
    function getFileSize(url, callback) {
        var xhr = new XMLHttpRequest();
        xhr.open('HEAD', url, true);
        xhr.timeout = 5000;
        xhr.onreadystatechange = function() {
            if (xhr.readyState === 4) {
                var size = xhr.getResponseHeader('Content-Length');
                callback(size ? parseInt(size, 10) : null);
            }
        };
        xhr.onerror = function() { callback(null); };
        xhr.ontimeout = function() { callback(null); };
        xhr.send();
    }

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

    // Store episodes list for batch download
    var availableEpisodes = [];

    // Store last stream URL for player menu
    var lastStreamUrl = '';
    var lastStreamTitle = '';

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

    // Capture episode list for batch download
    function captureEpisodes(data) {
        try {
            // Check for episodes array
            if (data.episodes && Array.isArray(data.episodes)) {
                availableEpisodes = data.episodes.map(function(ep, idx) {
                    return {
                        episode: ep.episode || idx + 1,
                        season: ep.season || data.season || 1,
                        title: ep.title || ep.name || '',
                        url: ep.url || ep.file || '',
                        quality: ep.quality || ''
                    };
                }).filter(function(ep) { return ep.url; });
                console.log('[DLHelper] Captured episodes:', availableEpisodes.length);
            }

            // Check for playlist format
            if (data.playlist && Array.isArray(data.playlist)) {
                availableEpisodes = data.playlist.map(function(ep, idx) {
                    return {
                        episode: ep.episode || idx + 1,
                        season: ep.season || data.season || 1,
                        title: ep.title || ep.name || '',
                        url: ep.url || ep.file || '',
                        quality: ep.quality || ''
                    };
                }).filter(function(ep) { return ep.url; });
                console.log('[DLHelper] Captured playlist:', availableEpisodes.length);
            }

            // Check for files array (common in Rezka-like sources)
            if (data.files && typeof data.files === 'object') {
                var eps = [];
                for (var key in data.files) {
                    if (data.files[key]) {
                        eps.push({
                            episode: parseInt(key) || eps.length + 1,
                            season: data.season || 1,
                            title: '',
                            url: data.files[key],
                            quality: ''
                        });
                    }
                }
                if (eps.length > 0) {
                    availableEpisodes = eps;
                    console.log('[DLHelper] Captured files:', availableEpisodes.length);
                }
            }
        } catch(e) {
            console.log('[DLHelper] Error capturing episodes:', e);
        }
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

    // Batch download - show episode selection
    function showBatchDownload() {
        if (availableEpisodes.length === 0) {
            Lampa.Noty.show('No episodes found for batch download');
            return;
        }

        var pd = null;
        try { pd = Lampa.Player.playdata(); } catch(e) {}
        var currentSeason = pd && pd.season || 1;

        // Create episode list items
        var items = [
            { title: 'Download ALL (' + availableEpisodes.length + ' eps)', id: 'all' },
            { title: 'Select Range...', id: 'range' }
        ];

        // Add individual episodes
        availableEpisodes.forEach(function(ep, idx) {
            items.push({
                title: 'E' + String(ep.episode).padStart(2, '0') + (ep.title ? ' - ' + ep.title : ''),
                subtitle: ep.quality || '',
                id: 'ep_' + idx,
                episode: ep
            });
        });

        Lampa.Select.show({
            title: 'Batch Download - S' + String(currentSeason).padStart(2, '0'),
            items: items,
            onSelect: function(item) {
                Lampa.Select.close();

                if (item.id === 'all') {
                    // Download all episodes
                    startBatchDownload(availableEpisodes);
                } else if (item.id === 'range') {
                    // Show range selector
                    showRangeSelector();
                } else if (item.episode) {
                    // Download single episode
                    startBatchDownload([item.episode]);
                }
            },
            onBack: function() {
                showMenu();
            }
        });
    }

    // Range selector for batch download
    function showRangeSelector() {
        var items = [];
        var maxEp = availableEpisodes.length;

        // Quick ranges
        if (maxEp >= 5) items.push({ title: 'Episodes 1-5', start: 1, end: 5 });
        if (maxEp >= 10) items.push({ title: 'Episodes 1-10', start: 1, end: 10 });
        if (maxEp >= 10) items.push({ title: 'Episodes 6-10', start: 6, end: 10 });
        if (maxEp > 10) items.push({ title: 'Episodes 11-' + maxEp, start: 11, end: maxEp });
        items.push({ title: 'All (' + maxEp + ' episodes)', start: 1, end: maxEp });

        Lampa.Select.show({
            title: 'Select Range',
            items: items,
            onSelect: function(item) {
                Lampa.Select.close();
                var selected = availableEpisodes.slice(item.start - 1, item.end);
                startBatchDownload(selected);
            },
            onBack: function() {
                showBatchDownload();
            }
        });
    }

    // Start downloading episodes one by one
    function startBatchDownload(episodes) {
        if (!episodes || episodes.length === 0) {
            Lampa.Noty.show('No episodes to download');
            return;
        }

        var androidAvailable = Lampa.Android && Lampa.Android.openPlayer;
        if (!androidAvailable) {
            // Copy all URLs
            var urls = episodes.map(function(ep) { return ep.url; }).join('\n');
            copyToClipboard(urls);
            Lampa.Noty.show(episodes.length + ' URLs copied!');
            return;
        }

        // Download with 1DM - open first episode, show list
        Lampa.Noty.show('Starting batch: ' + episodes.length + ' episodes');

        var delay = 0;
        episodes.forEach(function(ep) {
            setTimeout(function() {
                var filename = getFilenameForEpisode(ep);
                var dlUrl = ep.url + '#filename=' + encodeURIComponent(filename + '.mp4');
                Lampa.Android.openPlayer(dlUrl, JSON.stringify({ title: filename }));
            }, delay);
            delay += 1500; // 1.5 second delay between each
        });
    }

    // Generate filename for batch episode
    function getFilenameForEpisode(ep) {
        var parts = [];
        if (savedCard) {
            parts.push(savedCard.title || savedCard.name || '');
        }
        parts.push('S' + String(ep.season || 1).padStart(2, '0') + 'E' + String(ep.episode || 1).padStart(2, '0'));
        if (ep.title) {
            parts.push(ep.title);
        }
        if (ep.quality) {
            parts.push(ep.quality);
        }
        return parts.filter(function(p) { return p; }).join(' - ').replace(/[<>:"/\\|?*]/g, '') || 'video';
    }

    // Download menu for context menu (without player)
    function showDownloadMenu(url, title) {
        var androidAvailable = Lampa.Android && Lampa.Android.openPlayer;
        var filename = title.replace(/[<>:"/\\|?*]/g, '').trim() || 'video';

        var items = [];

        if (androidAvailable) {
            items.push({ title: 'Download with 1DM', subtitle: filename + '.mp4', id: '1dm' });
            items.push({ title: 'Download with DVGet', subtitle: filename + '.mp4', id: 'dvget' });
            items.push({ title: 'Open in External App', subtitle: 'VLC, MX Player...', id: 'external' });
        }

        items.push({ title: 'Copy URL', subtitle: 'Manual paste', id: 'copy' });

        Lampa.Select.show({
            title: 'Download: ' + title.substring(0, 30),
            items: items,
            onSelect: function(item) {
                Lampa.Select.close();

                if (item.id === '1dm') {
                    var dlUrl = url + '#filename=' + encodeURIComponent(filename + '.mp4');
                    Lampa.Android.openPlayer(dlUrl, JSON.stringify({ title: filename }));
                    Lampa.Noty.show('1DM: ' + filename);
                } else if (item.id === 'dvget') {
                    var dlUrl = url + '#filename=' + encodeURIComponent(filename + '.mp4');
                    Lampa.Android.openPlayer(dlUrl, JSON.stringify({ title: filename }));
                    Lampa.Noty.show('DVGet: ' + filename);
                } else if (item.id === 'external') {
                    Lampa.Android.openPlayer(url, JSON.stringify({ title: filename }));
                    Lampa.Noty.show('Opening...');
                } else {
                    copyToClipboard(url);
                    Lampa.Noty.show('URL copied!');
                }
            },
            onBack: function() {
                Lampa.Controller.toggle('content');
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

        // Check if this is a series - show batch option
        var pd = null;
        try { pd = Lampa.Player.playdata(); } catch(e) {}
        if (pd && pd.season) {
            items.push({
                title: 'Batch Download',
                subtitle: availableEpisodes.length > 0 ? availableEpisodes.length + ' episodes' : 'No episodes captured yet',
                id: 'batch'
            });
        }

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

                    // Episodes info
                    debugInfo.push('EPISODES: ' + availableEpisodes.length);
                    debugInfo.push('QUALITIES: ' + availableQualities.length);

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

                    if (qualities.length === 0) {
                        copyToClipboard(url);
                        Lampa.Noty.show('No qualities found. Current URL copied!');
                        return;
                    }

                    // Show menu immediately with "loading..." sizes
                    var qualityItems = qualities.map(function(q) {
                        return { title: q.label, subtitle: 'Loading size...', url: q.url, sizeLoaded: false };
                    });

                    Lampa.Select.show({
                        title: 'Select Quality',
                        items: qualityItems,
                        onSelect: function(selected) {
                            Lampa.Select.close();
                            showQualityActions(selected.url, selected.title, title);
                        },
                        onBack: function() {
                            showMenu();
                        }
                    });

                    // Fetch file sizes in background and update menu
                    qualities.forEach(function(q, idx) {
                        getFileSize(q.url, function(size) {
                            qualityItems[idx].subtitle = size ? formatBytes(size) : 'HLS stream';
                            qualityItems[idx].sizeLoaded = true;
                            // Re-render if select is still open
                            try {
                                var items = document.querySelectorAll('.selectbox-item');
                                if (items[idx]) {
                                    var sub = items[idx].querySelector('.selectbox-item__subtitle');
                                    if (sub) sub.textContent = qualityItems[idx].subtitle;
                                }
                            } catch(e) {}
                        });
                    });
                } else if (item.id === 'batch') {
                    // Show batch download options
                    showBatchDownload();
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

        // Hook into video source selection - capture URL before player menu shows
        Lampa.Listener.follow('video', function (e) {
            console.log('[DLHelper] Video event:', e.type, e.data ? Object.keys(e.data) : 'no data');
            if (e.data) {
                captureQualities(e.data);
                captureEpisodes(e.data);
                // Store URL for player menu
                if (e.data.url) {
                    lastStreamUrl = e.data.url;
                    lastStreamTitle = e.data.title || 'video';
                    console.log('[DLHelper] Captured stream URL:', lastStreamUrl.substring(0, 50));
                }
            }
        });

        // Hook into online sources to capture episode list
        Lampa.Listener.follow('online', function(e) {
            console.log('[DLHelper] Online event:', e.type, e.data ? Object.keys(e.data) : 'no data');
            if (e.data) captureEpisodes(e.data);
        });

        // Add download option to context menu (long-press on card)
        Lampa.Listener.follow('full', function(e) {
            if (e.type === 'complite' && e.object && e.object.activity) {
                // Hook into the full card menu
                var activity = e.object.activity;
                var card = activity.card;
                if (card) {
                    savedCard = card;
                }
            }
        });

        // Intercept Select.show to add download option to player action menu
        var originalSelectShow = Lampa.Select.show;

        Lampa.Select.show = function(params) {
            if (params && params.items && Array.isArray(params.items) && !params._dlHelperProcessed) {
                params._dlHelperProcessed = true;

                // Check if this is the "Действие" menu (player action menu)
                var menuTitle = (params.title || '').toLowerCase();
                var isActionMenu = menuTitle.indexOf('действие') > -1 ||
                                   menuTitle.indexOf('action') > -1 ||
                                   menuTitle === 'действие';

                if (isActionMenu) {
                    // Try to get URL from multiple sources
                    var streamUrl = params.url ||
                                    params.file ||
                                    params.stream ||
                                    lastStreamUrl;

                    // Also try to extract from items (some plugins store URL in item)
                    if (!streamUrl && params.items.length > 0) {
                        for (var i = 0; i < params.items.length; i++) {
                            var item = params.items[i];
                            if (item.url || item.file || item.stream || item.link) {
                                streamUrl = item.url || item.file || item.stream || item.link;
                                break;
                            }
                        }
                    }

                    var streamTitle = lastStreamTitle || params.title || 'video';

                    // Add Download option
                    params.items.push({
                        title: '⬇️ Download',
                        subtitle: streamUrl ? 'Save to device' : 'URL: check debug',
                        onSelect: function() {
                            Lampa.Select.close();
                            if (streamUrl) {
                                showDownloadMenu(streamUrl, streamTitle);
                            } else {
                                // Show debug info about params
                                var keys = Object.keys(params).join(', ');
                                Lampa.Noty.show('No URL. Keys: ' + keys);
                                console.log('[DLHelper] Action menu params:', params);
                            }
                        }
                    });
                }

                // Store URL for later use
                if (params.url) {
                    lastStreamUrl = params.url;
                    lastStreamTitle = params.title || 'video';
                }
            }
            return originalSelectShow.call(this, params);
        };

    }

    if (!window.lampa_download_helper) startPlugin();
})();
