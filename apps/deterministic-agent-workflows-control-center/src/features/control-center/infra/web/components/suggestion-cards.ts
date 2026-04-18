import {
  html, esc 
} from '../render'
import {
  asHtmlElement, getTextContent 
} from '../dom'

type SuggestionData = {
  title: string
  rationale: string
  change: string
  tradeoff: string
  prompt?: string | undefined
}

function renderPromptBlock(prompt: string): string {
  return html`<div class="insight-prompt"><button class="copy-btn" data-copy-prompt>Continue with Claude</button>${esc(prompt)}</div>`
}

function resetCopyButtonLabel(button: HTMLElement): void {
  setTimeout(() => {
    button.textContent = 'Continue with Claude'
  }, 1200)
}

function renderSuggestionCard(suggestion: SuggestionData): string {
  const changeHtml = suggestion.change
    ? html`<div class="suggestion-change"><strong>Change:</strong> ${esc(suggestion.change)}</div>`
    : ''
  const tradeoffHtml = suggestion.tradeoff
    ? html`<div class="suggestion-tradeoff">⚖ Trade-off: ${esc(suggestion.tradeoff)}</div>`
    : ''
  const promptHtml = suggestion.prompt ? renderPromptBlock(suggestion.prompt) : ''

  return html`<div class="suggestion">` +
    html`<div class="suggestion-head"><span class="suggestion-title">${esc(suggestion.title)}</span><span class="suggestion-arrow">▶</span></div>` +
    html`<div class="suggestion-body"><div class="suggestion-rationale">${esc(suggestion.rationale)}</div>${changeHtml}${tradeoffHtml}${promptHtml}</div>` +
    `</div>`
}

/** @riviere-role web-tbc */
export function renderSuggestions(suggestions: Array<SuggestionData>): string {
  if (suggestions.length === 0) return ''
  return suggestions.map(renderSuggestionCard).join('')
}

/** @riviere-role web-tbc */
export function attachSuggestionListeners(container: HTMLElement): void {
  container.querySelectorAll('.suggestion-head').forEach((head) => {
    head.addEventListener('click', () => {
      const body = head.nextElementSibling
      if (body) {
        body.classList.toggle('open')
        const arrow = head.querySelector('.suggestion-arrow')
        if (arrow) arrow.textContent = body.classList.contains('open') ? '▼' : '▶'
      }
    })
  })

  container.querySelectorAll('.suggestion [data-copy-prompt]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      if (!asHtmlElement(btn)) return
      e.stopPropagation()
      const prompt = btn.parentElement
      if (!prompt) return
      const text = getTextContent(prompt).replace('Continue with Claude', '').trim()
      void navigator.clipboard.writeText(text).then(() => {
        btn.textContent = 'Copied!'
        resetCopyButtonLabel(btn)
      })
    })
  })
}
