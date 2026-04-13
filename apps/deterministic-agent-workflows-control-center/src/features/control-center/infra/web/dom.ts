/** @riviere-role web-tbc */
export class MissingElementError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MissingElementError'
  }
}

const EMPTY_STRING = ''

declare global { interface Window { __events?: unknown } }

/** @riviere-role web-tbc */
export function getRequiredElement<T extends HTMLElement>(
  root: ParentNode,
  selector: string,
  guard: (value: Element) => value is T,
): T {
  const element = root.querySelector(selector)
  if (element === null || !guard(element)) {
    throw new MissingElementError(`Missing required element for selector: ${selector}`)
  }
  return element
}

/** @riviere-role web-tbc */
export function getOptionalElement<T extends HTMLElement>(
  root: ParentNode,
  selector: string,
  guard: (value: Element) => value is T,
): T | null {
  const element = root.querySelector(selector)
  return element !== null && guard(element) ? element : null
}

/** @riviere-role web-tbc */
export function asHtmlElement(value: Element): value is HTMLElement {
  return value instanceof HTMLElement
}

/** @riviere-role web-tbc */
export function asInputElement(value: Element): value is HTMLInputElement {
  return value instanceof HTMLInputElement
}

/** @riviere-role web-tbc */
export function getDatasetValue(element: HTMLElement, key: string): string | undefined {
  const value = element.dataset[key]
  return value !== undefined && value !== '' ? value : undefined
}

/** @riviere-role web-tbc */
export function getTextContent(node: Node): string {
  return node.textContent ?? EMPTY_STRING
}

/** @riviere-role web-tbc */
export function storeWindowValue(key: '__events', value: unknown): void {
  window[key] = value
}

/** @riviere-role web-tbc */
export function readWindowValue<T>(key: '__events', predicate: (value: unknown) => value is T): T | undefined {
  const value = window[key]
  return predicate(value) ? value : undefined
}
