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

    function getAndroidMethods() {
        if (typeof Android === 'undefined') return [];
        var methods = [];
        for (var key in Android) {
            if (typeof Android[key] === 'function') methods.push(key);
        }
        return methods;
    }

    function hasAndroid() {
        return typeof Android !== 'undefined';
    }

    function openExternal(url, title) {
        if (typeof Android === 'undefined') return false;

        // Try different methods
        if (Android.openPlayer) {
            Android.openPlayer(url, JSON.stringify({ title: title }));
            return true;
        }
        if (Android.openInBrowser) {
            Android.openInBrowser(url);
            return true;
        }
        if (Android.openBrowser) {
            Android.openBrowser(url);
            return true;
        }
        if (Android.share) {
            Android.share(url, title);
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
        var androidAvailable = hasAndroid();

        var items = [];

        if (androidAvailable) {
            items.push({ title: 'Open with External App', subtitle: 'Seal, YTDLnis, VLC...', id: 'external' });
        }

        items.push({ title: 'Copy URL', subtitle: 'Paste in download app', id: 'copy' });

        Lampa.Select.show({
            title: 'Download: ' + title.substring(0, 25),
            items: items,
            onSelect: function (item) {
                Lampa.Select.close();

                if (item.id === 'external') {
                    try {
                        var opened = openExternal(url, title);
                        if (opened) {
                            Lampa.Noty.show('Choose Seal or YTDLnis');
                        } else {
                            copyToClipboard(url);
                            Lampa.Noty.show('No method found. URL copied!');
                        }
                    } catch (e) {
                        copyToClipboard(url);
                        Lampa.Noty.show('Error: ' + e.message + '. URL copied!');
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

        // Log available APIs
        setTimeout(function() {
            var lampaKeys = Object.keys(Lampa).join(', ');
            console.log('[DLHelper] Lampa keys:', lampaKeys);

            // Check for Platform or Android-related Lampa APIs
            var platformInfo = [];
            if (Lampa.Platform) platformInfo.push('Platform');
            if (Lampa.Android) platformInfo.push('Android');
            if (Lampa.Device) platformInfo.push('Device');
            if (Lampa.Utils && Lampa.Utils.openPlayer) platformInfo.push('Utils.openPlayer');

            Lampa.Noty.show('[DLHelper] Lampa: ' + (platformInfo.length ? platformInfo.join(', ') : 'checking...'));

            // Show first 10 Lampa keys
            setTimeout(function() {
                Lampa.Noty.show('[DLHelper] Keys: ' + Object.keys(Lampa).slice(0, 8).join(', '));
            }, 2000);
        }, 3000);
    }

    if (!window.lampa_download_helper) startPlugin();
})();
