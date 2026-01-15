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

    function getTitle() {
        var el = document.querySelector('.player-info__name');
        if (el) return el.textContent.trim();
        try {
            var a = Lampa.Activity.active();
            if (a && a.card) return a.card.title || a.card.name || 'video';
        } catch (e) {}
        return 'video';
    }

    function tryWebShare(url, title) {
        if (navigator.share) {
            navigator.share({
                title: title,
                text: 'Download: ' + title,
                url: url
            }).then(function() {
                Lampa.Noty.show('Shared!');
            }).catch(function(e) {
                if (e.name !== 'AbortError') {
                    copyToClipboard(url);
                    Lampa.Noty.show('Share failed. URL copied!');
                }
            });
            return true;
        }
        return false;
    }

    function openInBrowser(url) {
        if (typeof Android !== 'undefined' && Android.openBrowser) {
            Android.openBrowser(url);
            Lampa.Noty.show('Opening in browser...');
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

        Lampa.Select.show({
            title: 'Download: ' + title.substring(0, 25),
            items: [
                { title: 'Share to App', subtitle: 'Seal, YTDLnis, ADM...', id: 'share' },
                { title: 'Open in Browser', subtitle: 'Download via browser', id: 'browser' },
                { title: 'Copy URL', subtitle: 'Manual paste', id: 'copy' }
            ],
            onSelect: function (item) {
                Lampa.Select.close();

                if (item.id === 'share') {
                    if (!tryWebShare(url, title)) {
                        copyToClipboard(url);
                        Lampa.Noty.show('URL copied! Open download app and paste');
                    }
                } else if (item.id === 'browser') {
                    if (!openInBrowser(url)) {
                        window.open(url, '_blank');
                    }
                } else if (item.id === 'copy') {
                    copyToClipboard(url);
                    Lampa.Noty.show('URL copied!');
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
