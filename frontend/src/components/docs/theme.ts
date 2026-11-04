export const THEME_KEY = 'vouch:docs-theme'

/** Runs inline before paint: the saved theme, else the system's, on the docs root. */
export const THEME_SCRIPT = `(function(){var d=document.currentScript.parentElement;try{var t=localStorage.getItem('${THEME_KEY}');if(t!=='light'&&t!=='dark'){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}d.dataset.theme=t}catch(e){d.dataset.theme='light'}})();`
