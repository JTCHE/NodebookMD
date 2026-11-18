/**
 * Light or dark, decided the way the app decides it (`src/lib/ui/theme.ts` in
 * the app): the reader's stored choice, else the system. The key is the app's
 * own, so the theme button in the app on the landing page also turns the page
 * around it; the app writes the key, and the `storage` event carries it here.
 *
 * Inline in the head, so the page never paints the other theme first.
 */
export const THEME_KEY = "nodebookmd.theme";

export const THEME_HEAD_SCRIPT =
  `(function(){var k=${JSON.stringify(THEME_KEY)},m=matchMedia("(prefers-color-scheme: dark)");` +
  `function p(){var v=null;try{v=localStorage.getItem(k)}catch(e){}` +
  `document.documentElement.dataset.theme=v==="light"||v==="dark"?v:m.matches?"dark":"light"}` +
  `p();m.addEventListener("change",p);addEventListener("storage",function(e){if(e.key===k)p()})})()`;
