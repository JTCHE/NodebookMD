export function revealDetails(element: Element | null) {
  for (let detail = element?.closest("details"); detail; detail = detail.parentElement?.closest("details")) {
    detail.open = true;
  }
}
