/**
 * Point at an argument of an open method, in its signature or in the list
 * under it, and both places light up. One listener on the document: the
 * rows come from the parser (`rehype-hom`), which names each argument with
 * `data-arg`.
 */
const LIT = "data-lit";

export function startArgumentHover() {
  document.addEventListener("pointerover", (event) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>(".hom-method [data-arg]") : null;
    for (const lit of document.querySelectorAll(`[${LIT}]`)) lit.removeAttribute(LIT);
    const method = target?.closest("details.hom-method[open]");
    if (!target || !method) return;
    for (const twin of method.querySelectorAll(`[data-arg="${CSS.escape(target.dataset.arg ?? "")}"]`)) twin.setAttribute(LIT, "");
  });
}
