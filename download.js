(function () {
    'use strict';

    // ========== UTILITIES ==========
    function copyToClipboard(text) {
        if (navigator.clipboard) {
            navigator.clipboard.writeText(text);
            return true;
        }
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        return true;
    }

    function formatBytes(bytes) {
        if (!bytes || bytes <= 0) return '';
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + sizes[i];
    }

    // ========== STORAGE ==========
    let savedCard = null;
    const downloadQueue = [];
    const sizeCache = {};

    // ========== FILENAME GENERATOR ==========
    function normalizeQuality(quality) {
        if (!quality) return null;
        // Convert "1920x1080" → "1080p", "1280x720" → "720p", etc.
        const resMatch = quality.match(/(\d+)x(\d+)/);
        if (resMatch) {
            return resMatch[2] + 'p';
        }
        // Already in good format like "1080p" or "720p"
        if (/^\d{3,4}p$/i.test(quality)) {
            return quality.toLowerCase();
        }
        // "1080" → "1080p"
        if (/^\d{3,4}$/.test(quality)) {
            return quality + 'p';
        }
        return quality;
    }

    function getFilename(quality, customCard, customEpisode) {
        const parts = [];
        const card = customCard || savedCard || getActiveCard();

        if (card) {
            parts.push(card.title || card.name || '');
        }

        const episode = customEpisode || getEpisodeInfo();
        if (episode) {
            parts.push(episode.code);
            if (episode.title && episode.title !== card?.title) {
                parts.push(episode.title);
            }
        }

        const normalizedQuality = normalizeQuality(quality);
        if (normalizedQuality) parts.push(normalizedQuality);

        const filename = parts
            .filter(p => p && p.length > 0)
            .join(' - ')
            .replace(/[<>:"/\\|?*]/g, '')
            .trim();

        return filename || 'video';
    }

    function getActiveCard() {
        try {
            const a = Lampa.Activity.active();
            return a?.card || null;
        } catch (_) { return null; }
    }

    function getEpisodeInfo() {
        // Try multiple sources for episode info
        let season, episode, title;

        // Source 1: Lampa.Player.playdata()
        try {
            const pd = Lampa.Player.playdata();
            if (pd) {
                season = pd.season ?? pd.s ?? pd.seas;
                episode = pd.episode ?? pd.e ?? pd.ep ?? pd.seria;
                title = pd.title ?? pd.episode_title ?? pd.name;
            }
        } catch (_) { /* ignore */ }

        // Source 2: Activity data
        if (!season && !episode) {
            try {
                const a = Lampa.Activity.active();
                if (a?.component === 'full' && a?.card) {
                    // For TV shows, check if we're watching an episode
                    const card = a.card;
                    if (card.number_of_seasons || card.seasons) {
                        // This is a TV show, try to get current episode from player
                        const pd = Lampa.Player.playdata();
                        season = pd?.season ?? pd?.s ?? 1;
                        episode = pd?.episode ?? pd?.e ?? pd?.seria ?? 1;
                        title = pd?.title ?? pd?.episode_title;
                    }
                }
            } catch (_) { /* ignore */ }
        }

        // Source 3: Try Lampa.PlayerVideo or Lampa.PlayerPlaylist
        if (!season && !episode) {
            try {
                const video = Lampa.PlayerVideo?.video?.() || Lampa.Player?.video?.();
                if (video?.season || video?.episode) {
                    season = video.season;
                    episode = video.episode;
                    title = video.title;
                }
            } catch (_) { /* ignore */ }
        }

        // Source 4: Check URL for episode patterns like S01E05
        if (!season && !episode) {
            try {
                const url = getCurrentUrl();
                if (url) {
                    const match = url.match(/[sS](\d{1,2})[eE](\d{1,2})/);
                    if (match) {
                        season = parseInt(match[1], 10);
                        episode = parseInt(match[2], 10);
                    }
                }
            } catch (_) { /* ignore */ }
        }

        if (season || episode) {
            return {
                code: 'S' + String(season || 1).padStart(2, '0') + 'E' + String(episode || 1).padStart(2, '0'),
                title: title || null,
                season: season || 1,
                episode: episode || 1
            };
        }

        return null;
    }

    // ========== GET CURRENT URL ==========
    function getCurrentUrl() {
        try {
            const pd = Lampa.Player.playdata();
            if (pd?.url && typeof pd.url === 'string' && pd.url.startsWith('http')) {
                return pd.url;
            }
        } catch (_) { /* ignore */ }

        try {
            const v = document.querySelector('video');
            if (v?.src?.startsWith('http')) {
                return v.src;
            }
        } catch (_) { /* ignore */ }

        return null;
    }

    // ========== GET SUBTITLES ==========
    function getSubtitles() {
        try {
            const pd = Lampa.Player.playdata();
            const subs = [];

            // Check subtitles array
            if (Array.isArray(pd?.subtitles)) {
                pd.subtitles.forEach((sub, i) => {
                    if (sub?.url?.startsWith('http')) {
                        subs.push({
                            url: sub.url,
                            label: sub.label || sub.language || `Subtitle ${i + 1}`,
                            lang: sub.language || sub.lang || ''
                        });
                    }
                });
            }

            // Check subtitle object
            if (pd?.subtitle && typeof pd.subtitle === 'object') {
                Object.entries(pd.subtitle).forEach(([key, val]) => {
                    if (typeof val === 'string' && val.startsWith('http')) {
                        subs.push({ url: val, label: key, lang: key });
                    }
                });
            }

            // Check tracks
            if (Array.isArray(pd?.tracks)) {
                pd.tracks.filter(t => t?.kind === 'subtitles' && t?.url?.startsWith('http')).forEach(t => {
                    subs.push({ url: t.url, label: t.label || t.language || 'Subtitle', lang: t.language || '' });
                });
            }

            return subs;
        } catch (_) { return []; }
    }

    // ========== EXTRACT QUALITY FROM URL ==========
    function extractQualityFromUrl(url) {
        if (!url) return null;
        const patterns = [
            /[_/\-](\d{3,4}p)[_/.]/i,
            /quality[=_]?(\d{3,4})/i,
            /[_/\-](\d{3,4})[_/.]/
        ];
        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match) {
                const q = match[1];
                return q.toLowerCase().includes('p') ? q : q + 'p';
            }
        }
        return null;
    }

    // ========== GET QUALITIES FROM PLAYDATA ==========
    function getQualitiesFromPlaydata() {
        try {
            const pd = Lampa.Player.playdata();
            if (!pd) return null;

            if (pd.quality && typeof pd.quality === 'object' && !Array.isArray(pd.quality)) {
                const qualities = Object.entries(pd.quality)
                    .filter(([_, val]) => typeof val === 'string' && val.startsWith('http'))
                    .map(([key, val]) => ({ url: val, quality: key, bandwidth: 0 }));

                if (qualities.length > 1) {
                    qualities.sort((a, b) => (parseInt(b.quality) || 0) - (parseInt(a.quality) || 0));
                    return qualities;
                }
            }

            if (Array.isArray(pd.playlist) && pd.playlist.length > 1) {
                const qualities = pd.playlist
                    .filter(item => item?.url)
                    .map((item, i) => ({
                        url: item.url,
                        quality: item.quality || item.title || extractQualityFromUrl(item.url) || `Quality ${i + 1}`,
                        bandwidth: 0
                    }));
                if (qualities.length > 1) return qualities;
            }
        } catch (_) { /* ignore */ }
        return null;
    }

    // ========== DOWNLOAD ACTIONS ==========
    function doDownload(url, filename) {
        const ext = url.includes('.m3u8') ? '.m3u8' : '.mp4';
        const dlUrl = url + '#filename=' + encodeURIComponent(filename + ext);
        Lampa.Android.openPlayer(dlUrl, JSON.stringify({ title: filename }));
        Lampa.Noty.show('Downloading: ' + filename);
    }

    function doDownloadSubtitle(url, label) {
        const filename = getFilename(null) + ' - ' + label;
        const ext = url.includes('.srt') ? '.srt' : url.includes('.ass') ? '.ass' : '.vtt';
        const dlUrl = url + '#filename=' + encodeURIComponent(filename + ext);
        Lampa.Android.openPlayer(dlUrl, JSON.stringify({ title: filename }));
        Lampa.Noty.show('Downloading: ' + filename + ext);
    }

    function doExternal(url, filename) {
        Lampa.Android.openPlayer(url, JSON.stringify({ title: filename }));
        Lampa.Noty.show('Opening player...');
    }

    // ========== GET FILE SIZE (with cache) ==========
    function getFileSize(url, callback) {
        if (sizeCache[url] !== undefined) {
            callback(sizeCache[url]);
            return;
        }

        const xhr = new XMLHttpRequest();
        xhr.open('HEAD', url, true);
        xhr.timeout = 5000;
        xhr.onreadystatechange = function() {
            if (xhr.readyState === 4) {
                const size = xhr.status === 200 ? parseInt(xhr.getResponseHeader('Content-Length'), 10) || 0 : 0;
                sizeCache[url] = size;
                callback(size);
            }
        };
        xhr.onerror = () => { sizeCache[url] = 0; callback(0); };
        xhr.ontimeout = () => { sizeCache[url] = 0; callback(0); };
        xhr.send();
    }

    // ========== DOWNLOAD QUEUE ==========
    function addToQueue(url, quality, size) {
        const card = savedCard || getActiveCard();
        const episode = getEpisodeInfo();
        const filename = getFilename(quality, card, episode);

        const item = {
            url,
            quality,
            size,
            filename,
            card: card ? { title: card.title || card.name } : null,
            episode: episode ? { ...episode } : null,
            addedAt: Date.now()
        };

        // Check for duplicates
        const exists = downloadQueue.some(q => q.url === url);
        if (exists) {
            Lampa.Noty.show('Already in queue');
            return false;
        }

        downloadQueue.push(item);
        Lampa.Noty.show(`Added to queue (${downloadQueue.length}): ${filename}`);
        return true;
    }

    function showQueueMenu(returnTo) {
        if (downloadQueue.length === 0) {
            Lampa.Noty.show('Queue is empty');
            return;
        }

        const items = downloadQueue.map((q, i) => ({
            title: q.filename,
            subtitle: q.size ? formatBytes(q.size) : q.quality,
            index: i
        }));

        items.push({ title: '--- Actions ---', subtitle: '', index: -1 });
        items.push({ title: 'Download All (' + downloadQueue.length + ')', subtitle: 'Send to ADM', index: -2 });
        items.push({ title: 'Clear Queue', subtitle: '', index: -3 });

        Lampa.Select.show({
            title: 'Download Queue (' + downloadQueue.length + ')',
            items,
            onSelect: function(item) {
                Lampa.Select.close();

                if (item.index === -1) {
                    // Separator, reshow menu
                    setTimeout(() => showQueueMenu(returnTo), 100);
                } else if (item.index === -2) {
                    // Download all
                    downloadAllFromQueue();
                    Lampa.Controller.toggle(returnTo);
                } else if (item.index === -3) {
                    // Clear queue
                    downloadQueue.length = 0;
                    Lampa.Noty.show('Queue cleared');
                    Lampa.Controller.toggle(returnTo);
                } else {
                    // Show item options
                    showQueueItemMenu(item.index, returnTo);
                }
            },
            onBack: () => Lampa.Controller.toggle(returnTo),
            _dlHelper: true
        });
    }

    function showQueueItemMenu(index, returnTo) {
        const item = downloadQueue[index];
        if (!item) return;

        Lampa.Select.show({
            title: item.filename,
            items: [
                { title: 'Download Now', id: 'download' },
                { title: 'Remove from Queue', id: 'remove' },
                { title: 'Back to Queue', id: 'back' }
            ],
            onSelect: function(sel) {
                Lampa.Select.close();
                if (sel.id === 'download') {
                    doDownload(item.url, item.filename);
                    downloadQueue.splice(index, 1);
                    Lampa.Controller.toggle(returnTo);
                } else if (sel.id === 'remove') {
                    downloadQueue.splice(index, 1);
                    Lampa.Noty.show('Removed from queue');
                    if (downloadQueue.length > 0) {
                        setTimeout(() => showQueueMenu(returnTo), 100);
                    } else {
                        Lampa.Controller.toggle(returnTo);
                    }
                } else {
                    setTimeout(() => showQueueMenu(returnTo), 100);
                }
            },
            onBack: () => setTimeout(() => showQueueMenu(returnTo), 100),
            _dlHelper: true
        });
    }

    function downloadAllFromQueue() {
        if (downloadQueue.length === 0) {
            Lampa.Noty.show('Queue is empty');
            return;
        }

        // Send all to ADM with 500ms delay between each
        let i = 0;
        const sendNext = () => {
            if (i >= downloadQueue.length) {
                Lampa.Noty.show(`Sent ${downloadQueue.length} downloads to ADM`);
                downloadQueue.length = 0;
                return;
            }
            const item = downloadQueue[i];
            doDownload(item.url, item.filename);
            i++;
            setTimeout(sendNext, 500);
        };
        sendNext();
    }

    // ========== DOWNLOAD MENU ==========
    function showDownloadMenu(url, quality, returnTo, fileSize) {
        if (!url?.startsWith('http')) {
            Lampa.Noty.show('Invalid URL');
            return;
        }

        returnTo = returnTo || 'player';
        const androidAvailable = Lampa.Android?.openPlayer;
        const filename = getFilename(quality);
        const sizeText = fileSize ? ' (' + formatBytes(fileSize) + ')' : '';
        const subtitles = getSubtitles();

        const items = [];

        if (androidAvailable) {
            items.push({ title: 'Download', subtitle: filename + '.mp4' + sizeText, id: 'download' });
            items.push({ title: 'Add to Queue', subtitle: `Queue: ${downloadQueue.length} items`, id: 'queue' });
            items.push({ title: 'External Player', subtitle: 'VLC, MX...', id: 'external' });

            if (subtitles.length > 0) {
                items.push({ title: 'Download Subtitles', subtitle: `${subtitles.length} available`, id: 'subtitles' });
            }
        }

        if (downloadQueue.length > 0) {
            items.push({ title: 'View Queue', subtitle: `${downloadQueue.length} items`, id: 'viewqueue' });
        }

        items.push({ title: 'Copy URL', subtitle: url.substring(0, 40) + '...', id: 'copy' });

        Lampa.Select.show({
            title: quality + sizeText,
            items,
            onSelect: function(item) {
                Lampa.Select.close();
                switch (item.id) {
                    case 'download':
                        doDownload(url, filename);
                        Lampa.Controller.toggle(returnTo);
                        break;
                    case 'queue':
                        addToQueue(url, quality, fileSize);
                        Lampa.Controller.toggle(returnTo);
                        break;
                    case 'external':
                        doExternal(url, filename);
                        Lampa.Controller.toggle(returnTo);
                        break;
                    case 'subtitles':
                        showSubtitlesMenu(subtitles, returnTo);
                        break;
                    case 'viewqueue':
                        showQueueMenu(returnTo);
                        break;
                    case 'copy':
                        copyToClipboard(url);
                        Lampa.Noty.show('Copied!');
                        Lampa.Controller.toggle(returnTo);
                        break;
                }
            },
            onBack: () => Lampa.Controller.toggle(returnTo),
            _dlHelper: true
        });
    }

    function showSubtitlesMenu(subtitles, returnTo) {
        const items = subtitles.map((sub, i) => ({
            title: sub.label,
            subtitle: sub.lang || sub.url.split('/').pop(),
            index: i
        }));

        Lampa.Select.show({
            title: 'Subtitles (' + subtitles.length + ')',
            items,
            onSelect: function(item) {
                Lampa.Select.close();
                const sub = subtitles[item.index];
                doDownloadSubtitle(sub.url, sub.label);
                Lampa.Controller.toggle(returnTo);
            },
            onBack: () => Lampa.Controller.toggle(returnTo),
            _dlHelper: true
        });
    }

    function showDownloadMenuWithSize(url, quality, returnTo) {
        if (url.includes('.m3u8')) {
            showDownloadMenu(url, quality, returnTo, 0);
            return;
        }
        getFileSize(url, size => showDownloadMenu(url, quality, returnTo, size));
    }

    // ========== HLS PARSER ==========
    function parseHlsMaster(m3u8Text, baseUrl) {
        const streams = [];
        const lines = m3u8Text.split('\n');
        let currentInfo = null;

        for (const line of lines) {
            const trimmed = line.trim();

            if (trimmed.startsWith('#EXT-X-STREAM-INF:')) {
                currentInfo = {};
                const bwMatch = trimmed.match(/BANDWIDTH=(\d+)/);
                if (bwMatch) currentInfo.bandwidth = parseInt(bwMatch[1], 10);
                const resMatch = trimmed.match(/RESOLUTION=(\d+x\d+)/);
                if (resMatch) currentInfo.resolution = resMatch[1];
            } else if (currentInfo && trimmed && !trimmed.startsWith('#')) {
                let streamUrl = trimmed;
                if (!streamUrl.startsWith('http')) {
                    const baseParts = baseUrl.split('/');
                    baseParts.pop();
                    streamUrl = baseParts.join('/') + '/' + streamUrl;
                }

                streams.push({
                    url: streamUrl,
                    quality: currentInfo.resolution || (currentInfo.bandwidth ? Math.round(currentInfo.bandwidth / 1000) + 'kbps' : 'Stream'),
                    bandwidth: currentInfo.bandwidth || 0
                });
                currentInfo = null;
            }
        }

        streams.sort((a, b) => b.bandwidth - a.bandwidth);
        return streams;
    }

    function fetchHlsVariants(url, callback) {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.timeout = 10000;

        const fallback = () => callback([{ url, quality: 'Default', bandwidth: 0 }]);

        xhr.onreadystatechange = function() {
            if (xhr.readyState === 4) {
                if (xhr.status === 200 && xhr.responseText?.includes('#EXT-X-STREAM-INF')) {
                    callback(parseHlsMaster(xhr.responseText, url));
                } else {
                    fallback();
                }
            }
        };
        xhr.onerror = fallback;
        xhr.ontimeout = fallback;
        xhr.send();
    }

    // ========== QUALITY SELECTOR ==========
    function fetchAllSizes(streams, callback) {
        const results = [];
        let completed = 0;
        const total = streams.length;

        if (total === 0) {
            callback([]);
            return;
        }

        streams.forEach((stream, index) => {
            if (stream.url.includes('.m3u8')) {
                results[index] = { stream, size: 0 };
                if (++completed === total) callback(results);
            } else {
                getFileSize(stream.url, size => {
                    results[index] = { stream, size };
                    if (++completed === total) callback(results);
                });
            }
        });
    }

    function showQualitySelector(streams, returnTo) {
        if (!streams?.length) {
            Lampa.Noty.show('No streams available');
            return;
        }

        if (streams.length === 1) {
            showDownloadMenuWithSize(streams[0].url, streams[0].quality || 'Video', returnTo);
            return;
        }

        Lampa.Noty.show('Fetching sizes...');

        fetchAllSizes(streams, results => {
            const items = results.map(r => ({
                title: r.stream.quality || 'Video',
                subtitle: r.size ? formatBytes(r.size) : (r.stream.bandwidth ? '~' + formatBytes(r.stream.bandwidth / 8 * 3600) + '/hour' : ''),
                url: r.stream.url,
                quality: r.stream.quality || 'Video',
                size: r.size
            }));

            Lampa.Select.show({
                title: 'Select Quality (' + streams.length + ')',
                items,
                onSelect: function(item) {
                    Lampa.Select.close();
                    showDownloadMenu(item.url, item.quality, returnTo, item.size);
                },
                onBack: () => Lampa.Controller.toggle(returnTo),
                _dlHelper: true
            });
        });
    }

    // ========== PLAYER MENU ==========
    function showPlayerMenu() {
        const url = getCurrentUrl();

        if (!url) {
            Lampa.Noty.show('No URL. Play video first!');
            return;
        }

        Lampa.Noty.show('Loading...');

        const pdQualities = getQualitiesFromPlaydata();
        if (pdQualities?.length > 1) {
            showQualitySelector(pdQualities, 'player');
            return;
        }

        if (url.includes('.m3u8') || url.includes('m3u8')) {
            fetchHlsVariants(url, streams => {
                if (streams.length > 1) {
                    showQualitySelector(streams, 'player');
                } else {
                    showDownloadMenuWithSize(url, extractQualityFromUrl(url) || 'Video', 'player');
                }
            });
        } else {
            showDownloadMenuWithSize(url, extractQualityFromUrl(url) || 'Video', 'player');
        }
    }

    // ========== PLAYER BUTTON ==========
    function addPlayerButton() {
        if (document.querySelector('.dlhelper-btn')) return;
        const panel = document.querySelector('.player-panel__right');
        if (!panel) return;

        const btn = document.createElement('div');
        btn.className = 'player-panel__item selector dlhelper-btn';
        btn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" style="width:1.5em;height:1.5em;"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>';
        btn.addEventListener('click', showPlayerMenu);
        $(btn).on('hover:enter', showPlayerMenu);

        const settings = panel.querySelector('.player-panel__settings');
        panel.insertBefore(btn, settings || null);
    }

    // ========== MAIN PLUGIN ==========
    function startPlugin() {
        window.lampa_download_helper = true;

        Lampa.Listener.follow('full', function(e) {
            if (e.type === 'complite') setTimeout(addPlayerButton, 500);
            try {
                const a = Lampa.Activity.active();
                if (a?.card) savedCard = a.card;
            } catch (_) { /* ignore */ }
        });

        Lampa.Player?.listener?.follow('start', () => setTimeout(addPlayerButton, 500));

        // Intercept Select.show for "Действие" menu
        const originalSelectShow = Lampa.Select.show;

        Lampa.Select.show = function(params) {
            if (params?._dlHelper) {
                return originalSelectShow.call(this, params);
            }

            if (params?.items && Array.isArray(params.items)) {
                const menuTitle = (params.title || '').toLowerCase();
                if (menuTitle.includes('действие') || menuTitle.includes('action')) {
                    params.items.push({
                        title: 'Download',
                        subtitle: downloadQueue.length > 0 ? `Queue: ${downloadQueue.length}` : 'Current stream',
                        onSelect: function() {
                            Lampa.Select.close();
                            showPlayerMenu();
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
