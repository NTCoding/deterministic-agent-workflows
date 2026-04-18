import type { ReflectionDto } from '../api-client'
import {
  esc,
  formatTimestamp,
  html,
} from '../render'

function renderEvidence(evidence: ReflectionDto['reflection']['findings'][number]['evidence'][number]): string {
  const detail = (() => {
    switch (evidence.kind) {
      case 'state-period':
        return evidence.state
      case 'event':
        return `seq ${evidence.seq}`
      case 'event-range':
        return `seq ${evidence.startSeq}–${evidence.endSeq}`
      case 'journal-entry':
        return evidence.agentName ? `${evidence.agentName} @ ${evidence.at}` : evidence.at
      case 'transcript-range':
        return `entries ${evidence.startIndex}–${evidence.endIndex}`
      case 'tool-activity':
        return [evidence.state, evidence.toolName, evidence.metric].filter(Boolean).join(' · ') || 'tool activity'
    }
  })()
  const detailSuffix = detail.length === 0 ? '' : ` — ${esc(detail)}`
  return html`<li><strong>${esc(evidence.label ?? evidence.kind)}</strong>${detailSuffix}</li>`
}

function renderFinding(reflection: ReflectionDto, finding: ReflectionDto['reflection']['findings'][number]): string {
  const confidence = finding.confidence ? html`<span class="sep">│</span><span>${esc(finding.confidence)} confidence</span>` : ''
  return html`<div class="insight info">` +
    html`<div class="insight-head"><span class="insight-title">${esc(finding.title)}</span><span class="insight-arrow">▼</span></div>` +
    html`<div class="insight-body open">` +
    html`<div class="insight-evidence"><strong>Category:</strong> ${esc(finding.category)}</div>` +
    html`<div class="insight-evidence"><strong>Opportunity:</strong> ${esc(finding.opportunity)}</div>` +
    html`<div class="insight-evidence"><strong>Likely cause:</strong> ${esc(finding.likelyCause)}</div>` +
    html`<div class="insight-evidence"><strong>Suggested change:</strong> ${esc(finding.suggestedChange)}</div>` +
    html`<div class="insight-evidence"><strong>Expected impact:</strong> ${esc(finding.expectedImpact)}</div>` +
    html`<div class="insight-evidence"><strong>Run:</strong> ${esc(reflection.label ?? 'Reflection')}<span class="sep">│</span><span>${esc(formatTimestamp(reflection.createdAt))}</span>${confidence}</div>` +
    html`<div class="insight-evidence"><strong>Evidence</strong><ul style="margin:8px 0 0 18px">${finding.evidence.map(renderEvidence).join('')}</ul></div>` +
    `</div></div>`
}

function renderReflectionRun(reflection: ReflectionDto): string {
  const summary = reflection.reflection.summary
    ? html`<div class="suggestion-rationale" style="margin-bottom:12px">${esc(reflection.reflection.summary)}</div>`
    : ''
  const meta = [
    reflection.label,
    reflection.agentName,
    reflection.sourceState,
    formatTimestamp(reflection.createdAt),
  ].filter((value): value is string => typeof value === 'string' && value.length > 0)
  return html`<section style="margin-bottom:28px">` +
    html`<h3 style="margin:0 0 8px">${esc(reflection.label ?? 'Reflection')}</h3>` +
    html`<div style="font-size:12px;color:#666;margin-bottom:10px">${esc(meta.join(' │ '))}</div>` +
    summary +
    reflection.reflection.findings.map((finding) => renderFinding(reflection, finding)).join('') +
    `</section>`
}

/** @riviere-role web-tbc */
export function renderReflectionPanel(reflections: ReadonlyArray<ReflectionDto>): string {
  if (reflections.length === 0) {
    return '<div class="loading">No reflections recorded for this session</div>'
  }
  return reflections.map(renderReflectionRun).join('')
}
