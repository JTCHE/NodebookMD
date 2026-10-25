/**
 * Releases before 0.3.0 kept the reader's tabs, theme and sidebar width
 * under `houdinimd.` keys. They move to `nodebookmd.` once. `main.tsx`
 * imports this first, before any module reads a key.
 */
try {
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith("houdinimd.")) continue;
    const name = `nodebookmd.${key.slice("houdinimd.".length)}`;
    if (localStorage.getItem(name) === null) localStorage.setItem(name, localStorage.getItem(key)!);
    localStorage.removeItem(key);
  }
} catch {
  // No storage: nothing to move.
}
