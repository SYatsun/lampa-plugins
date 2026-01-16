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
    const sizeCache = {};

    // ========== FILENAME GENERATOR ==========
    function normalizeQuality(quality) {
        if (!quality) return null;
        // Convert "1920x1080" → "1080p", "1280x720" → "720p"
        const resMatch = quality.match(/(\d+)x(\d+)/);
        if (resMatch) return resMatch[2] + 'p';
        // Already "1080p" or "720p"
        if (/^\d{3,4}p$/i.test(quality)) return quality.toLowerCase();
        // "1080" → "1080p"
        if (/^\d{3,4}$/.test(quality)) return quality + 'p';
        return quality;
    }

    function getFilename(quality) {
        const parts = [];
        const card = savedCard || getActiveCard();

        if (card) {
            parts.push(card.title || card.name || '');
        }

        const episode = getEpisodeInfo();
        if (episode) {
            parts.push(episode.code);
            if (episode.title && episode.title !== card?.title) {
                parts.push(episode.title);
            }
        }

        const normalizedQuality = normalizeQuality(quality);
        if (normalizedQuality) parts.push(normalizedQuality);

        return parts
            .filter(p => p && p.length > 0)
            .join(' - ')
            .replace(/[<>:"/\\|?*]/g, '')
            .trim() || 'video';
    }

    function getActiveCard() {
        try {
            return Lampa.Activity.active()?.card || null;
        } catch (_) { return null; }
    }

    function getEpisodeInfo() {
        let season, episode, title;

        // Source 1: playdata
        try {
            const pd = Lampa.Player.playdata();
            if (pd) {
                season = pd.season ?? pd.s ?? pd.seas;
                episode = pd.episode ?? pd.e ?? pd.ep ?? pd.seria;
                title = pd.title ?? pd.episode_title ?? pd.name;
            }
        } catch (_) { /* ignore */ }

        // Source 2: Activity for TV shows
        if (!season && !episode) {
            try {
                const a = Lampa.Activity.active();
                if (a?.card?.number_of_seasons || a?.card?.seasons) {
                    const pd = Lampa.Player.playdata();
                    season = pd?.season ?? pd?.s ?? 1;
                    episode = pd?.episode ?? pd?.e ?? pd?.seria ?? 1;
                    title = pd?.title ?? pd?.episode_title;
                }
            } catch (_) { /* ignore */ }
        }

        // Source 3: URL pattern S01E05
        if (!season && !episode) {
            try {
                const url = getCurrentUrl();
                const match = url?.match(/[sS](\d{1,2})[eE](\d{1,2})/);
                if (match) {
                    season = parseInt(match[1], 10);
                    episode = parseInt(match[2], 10);
                }
            } catch (_) { /* ignore */ }
        }

        if (season || episode) {
            return {
                code: 'S' + String(season || 1).padStart(2, '0') + 'E' + String(episode || 1).padStart(2, '0'),
                title: title || null
            };
        }
        return null;
    }

    // ========== GET CURRENT URL ==========
    function getCurrentUrl() {
        try {
            const pd = Lampa.Player.playdata();
            if (pd?.url?.startsWith?.('http')) return pd.url;
        } catch (_) { /* ignore */ }

        try {
            const v = document.querySelector('video');
            if (v?.src?.startsWith?.('http')) return v.src;
        } catch (_) { /* ignore */ }

        return null;
    }

    // ========== GET SUBTITLES ==========
    function getSubtitles() {
        try {
            const pd = Lampa.Player.playdata();
            const subs = [];

            if (Array.isArray(pd?.subtitles)) {
                for (const sub of pd.subtitles) {
                    if (sub?.url?.startsWith?.('http')) {
                        subs.push({
                            url: sub.url,
                            label: sub.label || sub.language || 'Subtitle',
                            lang: sub.language || sub.lang || ''
                        });
                    }
                }
            }

            if (pd?.subtitle && typeof pd.subtitle === 'object') {
                for (const [key, val] of Object.entries(pd.subtitle)) {
                    if (typeof val === 'string' && val.startsWith('http')) {
                        subs.push({ url: val, label: key, lang: key });
                    }
                }
            }

            if (Array.isArray(pd?.tracks)) {
                for (const t of pd.tracks) {
                    if (t?.kind === 'subtitles' && t?.url?.startsWith?.('http')) {
                        subs.push({ url: t.url, label: t.label || 'Subtitle', lang: t.language || '' });
                    }
                }
            }

            return subs;
        } catch (_) { return []; }
    }

    // ========== EXTRACT QUALITY FROM URL ==========
    function extractQualityFromUrl(url) {
        if (!url) return null;
        const patterns = [/[_/.-](\d{3,4}p)[_/.-]/i, /quality[=_]?(\d{3,4})/i];
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
    function doDownload(url, filename, subtitles) {
        const ext = url.includes('.m3u8') ? '.m3u8' : '.mp4';
        const dlUrl = url + '#filename=' + encodeURIComponent(filename + ext);
        Lampa.Android.openPlayer(dlUrl, JSON.stringify({ title: filename }));

        // Download subtitles too (with delay)
        if (subtitles?.length) {
            let count = 0;
            subtitles.forEach((sub, i) => {
                setTimeout(() => {
                    let subExt = '.vtt';
                    if (sub.url.includes('.srt')) subExt = '.srt';
                    else if (sub.url.includes('.ass')) subExt = '.ass';
                    const subFilename = filename + ' - ' + sub.label + subExt;
                    const subUrl = sub.url + '#filename=' + encodeURIComponent(subFilename);
                    Lampa.Android.openPlayer(subUrl, JSON.stringify({ title: subFilename }));
                    count++;
                }, (i + 1) * 500);
            });
            Lampa.Noty.show(`Downloading: ${filename} + ${subtitles.length} sub`);
        } else {
            Lampa.Noty.show('Downloading: ' + filename);
        }
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

    // ========== DOWNLOAD MENU ==========
    function showDownloadMenu(url, quality, returnTo, fileSize) {
        if (!url?.startsWith?.('http')) {
            Lampa.Noty.show('Invalid URL');
            return;
        }

        returnTo = returnTo || 'player';
        const androidAvailable = Lampa.Android?.openPlayer;
        const filename = getFilename(quality);
        const sizeText = fileSize ? ' (' + formatBytes(fileSize) + ')' : '';
        const subtitles = getSubtitles();
        const isHls = url.includes('.m3u8');

        const items = [];

        if (androidAvailable) {
            const subText = subtitles.length > 0 ? ` + ${subtitles.length} sub` : '';

            if (isHls) {
                // HLS options
                items.push({ title: 'ADM / 1DM (HLS)', subtitle: 'Може не працювати', id: 'download' });
                items.push({ title: 'External Player', subtitle: 'VLC, MX Player', id: 'external' });
                items.push({ title: 'Copy yt-dlp command', subtitle: 'Для Termux / Seal', id: 'ytdlp' });
            } else {
                // Direct MP4 options
                items.push({ title: 'Download', subtitle: filename + '.mp4' + sizeText + subText, id: 'download' });
                items.push({ title: 'External Player', subtitle: 'VLC, MX Player', id: 'external' });
            }
        }

        items.push({ title: 'Copy URL', subtitle: url.substring(0, 40) + '...', id: 'copy' });

        Lampa.Select.show({
            title: quality + sizeText + (isHls ? ' [HLS]' : ''),
            items,
            onSelect: function(item) {
                Lampa.Select.close();
                switch (item.id) {
                    case 'download':
                        doDownload(url, filename, subtitles);
                        break;
                    case 'external':
                        doExternal(url, filename);
                        break;
                    case 'ytdlp':
                        const cmd = `yt-dlp "${url}" -o "${filename}.mp4"`;
                        copyToClipboard(cmd);
                        Lampa.Noty.show('yt-dlp command copied!');
                        break;
                    case 'copy':
                        copyToClipboard(url);
                        Lampa.Noty.show('Copied!');
                        break;
                }
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
            const items = results.map(r => {
                let subtitle = '';
                if (r.size) {
                    subtitle = formatBytes(r.size);
                } else if (r.stream.bandwidth) {
                    subtitle = '~' + formatBytes(r.stream.bandwidth / 8 * 3600) + '/hour';
                }
                return {
                    title: r.stream.quality || 'Video',
                    subtitle,
                    url: r.stream.url,
                    quality: r.stream.quality || 'Video',
                    size: r.size
                };
            });

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
                        subtitle: 'Current stream',
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
