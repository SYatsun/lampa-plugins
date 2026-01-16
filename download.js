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
            if (pd && pd.url && pd.url.indexOf('http') === 0) return pd.url;
        } catch (e) {}
        try {
            var v = document.querySelector('video');
            if (v && v.src && v.src.indexOf('blob:') !== 0) return v.src;
        } catch (e) {}
        return null;
    }

    // Try to get master playlist or original source URL for quality selection
    function getSourceUrl() {
        try {
            var pd = Lampa.Player.playdata();
            // Check for master/original URL in playdata
            if (pd) {
                // Try different possible locations for master URL
                if (pd.master) return pd.master;
                if (pd.original) return pd.original;
                if (pd.source) return pd.source;
                if (pd.playlist) return pd.playlist;
                // Log available keys for debugging
                console.log('[DLHelper] playdata keys:', Object.keys(pd).join(', '));
                console.log('[DLHelper] playdata:', JSON.stringify(pd).substring(0, 500));
            }
        } catch (e) {}

        // Try to get from active stream/source
        try {
            var activity = Lampa.Activity.active();
            if (activity && activity.stream) {
                console.log('[DLHelper] stream:', JSON.stringify(activity.stream).substring(0, 500));
                if (activity.stream.url) return activity.stream.url;
            }
        } catch (e) {}

        // Fallback to current playing URL
        return getVideoUrl();
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

    function showMenu() {
        var url = getVideoUrl();
        if (!url) {
            Lampa.Noty.show('URL not found. Start playing first!');
            return;
        }

        var title = getTitle();
        var androidAvailable = Lampa.Android && Lampa.Android.openPlayer;

        var items = [];

        if (androidAvailable) {
            items.push({ title: 'Download with 1DM', subtitle: 'With filename', id: '1dm' });
            items.push({ title: 'Download with DVGet', subtitle: 'With filename', id: 'dvget' });
            items.push({ title: 'Open with External App', subtitle: 'VLC, MX Player...', id: 'external' });
        }

        items.push({ title: 'Copy for YTDLnis/Seal', subtitle: 'Paste in app for quality select', id: 'ytdlnis' });
        items.push({ title: 'Copy URL only', subtitle: 'Manual paste', id: 'copy' });

        Lampa.Select.show({
            title: 'Download: ' + title.substring(0, 25),
            items: items,
            onSelect: function (item) {
                Lampa.Select.close();

                if (item.id === 'ytdlnis') {
                    // Copy source URL for YTDLnis/Seal - they handle quality selection
                    var sourceUrl = getSourceUrl() || url;
                    copyToClipboard(sourceUrl);
                    Lampa.Noty.show('URL copied! Open YTDLnis/Seal and paste');
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

        Lampa.Listener.follow('full', function (e) {
            if (e.type === 'complite') setTimeout(addButton, 500);
        });

        if (Lampa.Player && Lampa.Player.listener) {
            Lampa.Player.listener.follow('start', function () {
                setTimeout(addButton, 500);
            });
        }

    }

    if (!window.lampa_download_helper) startPlugin();
})();
