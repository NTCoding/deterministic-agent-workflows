import {
  html, esc 
} from '../render'
import {
  asHtmlElement, getTextContent 
} from '../dom'

type InsightData = {
  severity: string
  title: string
  evidence: string
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

/** @riviere-role web-tbc */
export function renderInsightCard(insight: InsightData): string {
  const promptHtml = insight.prompt ? renderPromptBlock(insight.prompt) : ''
  return html`<div class="insight ${insight.severity}">` +
    html`<div class="insight-head"><span class="insight-title">${esc(insight.title)}</span><span class="insight-arrow">▶</span></div>` +
    html`<div class="insight-body"><div class="insight-evidence">${esc(insight.evidence)}</div>${promptHtml}</div>` +
    `</div>`
}

/** @riviere-role web-tbc */
export function renderInsights(insights: Array<InsightData>): string {
  if (insights.length === 0) {
    return html`<div class="loading">No insights</div>`
  }
  return insights.map(renderInsightCard).join('')
}

/** @riviere-role web-tbc */
export function attachInsightListeners(container: HTMLElement): void {
  container.querySelectorAll('.insight-head').forEach((head) => {
    head.addEventListener('click', () => {
      const body = head.nextElementSibling
      if (body) {
        body.classList.toggle('open')
        const arrow = head.querySelector('.insight-arrow')
        if (arrow) arrow.textContent = body.classList.contains('open') ? '▼' : '▶'
      }
    })
  })

  container.querySelectorAll('[data-copy-prompt]').forEach((btn) => {
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
