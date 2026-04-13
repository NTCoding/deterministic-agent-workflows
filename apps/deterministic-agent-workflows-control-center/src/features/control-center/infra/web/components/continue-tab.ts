import {
  html, esc 
} from '../render'
import {
  asHtmlElement, getTextContent 
} from '../dom'

type PromptSource = {
  title: string
  prompt: string
}

type InsightInput = {
  severity: string;
  title: string;
  evidence: string;
  prompt?: string | undefined
}
type SuggestionInput = {
  title: string;
  rationale: string;
  change: string;
  tradeoff: string;
  prompt?: string | undefined
}

function resetCopyButtonLabel(button: HTMLElement): void {
  setTimeout(() => {
    button.textContent = 'Continue with Claude'
  }, 1200)
}

/** @riviere-role web-tbc */
export function renderContinueTab(
  insights: Array<InsightInput>,
  suggestions: Array<SuggestionInput> = [],
): string {
  const insightPrompts: Array<PromptSource> = insights
    .filter((i): i is typeof i & { prompt: string } => typeof i.prompt === 'string' && i.prompt.length > 0)
    .map((i) => ({
      title: i.title,
      prompt: i.prompt 
    }))

  const suggestionPrompts: Array<PromptSource> = suggestions
    .filter((s): s is typeof s & { prompt: string } => typeof s.prompt === 'string' && s.prompt.length > 0)
    .map((s) => ({
      title: s.title,
      prompt: s.prompt 
    }))

  const withPrompts = [...insightPrompts, ...suggestionPrompts]

  if (withPrompts.length === 0) {
    return html`<div class="loading">No actionable prompts from insights or suggestions</div>`
  }

  const blocks = withPrompts.map((p) =>
    html`<div class="prompt-block"><div class="prompt-q">${esc(p.title)}</div>` +
    html`<div class="prompt-cmd"><button class="copy-btn" data-copy-prompt>Continue with Claude</button>${esc(p.prompt)}</div></div>`,
  ).join('')

  return html`<p style="font-size:13px;color:#666;margin-bottom:16px">Copy a prompt into Claude Code to continue analysis.</p>` +
    html`<div class="prompts">${blocks}</div>`
}

/** @riviere-role web-tbc */
export function attachContinueListeners(container: HTMLElement): void {
  container.querySelectorAll('[data-copy-prompt]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!asHtmlElement(btn)) return
      const cmdEl = btn.parentElement
      if (!cmdEl) return
      const text = getTextContent(cmdEl).replace('Continue with Claude', '').trim()
      void navigator.clipboard.writeText(text).then(() => {
        btn.textContent = 'Copied!'
        resetCopyButtonLabel(btn)
      })
    })
  })
}
