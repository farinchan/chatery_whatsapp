/**
 * Chatery theme bootstrap (light / dark).
 *
 * Load this synchronously in <head>, right after the Tailwind CDN script and
 * before `tailwind.config`, so the theme class is applied before first paint.
 *
 * Colors are exposed as CSS-variable backed Tailwind tokens (see theme.css), so
 * every existing utility (bg-white, text-slate-800, border-emerald-200, ...)
 * switches palette automatically when <html> gets the `dark` class.
 */
(function () {
    const STORAGE_KEY = 'chatery-theme';
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

    function getStoredTheme() {
        try {
            return localStorage.getItem(STORAGE_KEY);
        } catch {
            return null;
        }
    }

    function applyTheme(theme) {
        document.documentElement.classList.toggle('dark', theme === 'dark');
    }

    applyTheme(getStoredTheme() || (systemDark.matches ? 'dark' : 'light'));

    // Follow the OS setting until the user picks a theme explicitly
    systemDark.addEventListener('change', (e) => {
        if (!getStoredTheme()) applyTheme(e.matches ? 'dark' : 'light');
    });

    window.toggleTheme = function () {
        const next = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
        applyTheme(next);
        try {
            localStorage.setItem(STORAGE_KEY, next);
        } catch {}
    };

    const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;
    const scale = (name, shades) => Object.fromEntries(shades.map((shade) => [shade, token(`${name}-${shade}`)]));
    const tintShades = [50, 100, 200, 300, 600, 700];

    window.chateryTheme = {
        token,
        colors: {
            slate: scale('slate', [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]),
            emerald: scale('emerald', tintShades),
            rose: scale('rose', tintShades),
            amber: scale('amber', tintShades),
            indigo: scale('indigo', tintShades),
            cyan: scale('cyan', tintShades),
            purple: scale('purple', tintShades),
            // blue-600 stays fixed: it is only used in the brand logo gradient
            blue: scale('blue', [50, 100, 200, 300, 700]),
            // Fixed slate values for surfaces that stay dark/light in both themes
            // (code blocks, modal overlays, QR code frames)
            ink: {
                50: '#F8FAFC',
                100: '#F1F5F9',
                200: '#E2E8F0',
                700: '#334155',
                900: '#0F172A',
                950: '#020617'
            }
        }
    };
})();
