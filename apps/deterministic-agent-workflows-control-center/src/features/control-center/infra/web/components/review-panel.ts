import type { ReviewDto } from '../api-client'
import {
  esc,
  formatTimestamp,
  html,
} from '../render'

function countBlockingFindings(review: ReviewDto): number {
  return review.findings.filter((finding) => finding.status === 'blocking').length
}

function renderLineRange(finding: ReviewDto['findings'][number]): string {
  if (finding.file === undefined) return ''
  if (finding.startLine === undefined) return esc(finding.file)
  const lineRange = finding.endLine === undefined || finding.endLine === finding.startLine
    ? `${finding.startLine}`
    : `${finding.startLine}-${finding.endLine}`
  return `${esc(finding.file)}:${esc(lineRange)}`
}

function renderFinding(review: ReviewDto, finding: ReviewDto['findings'][number]): string {
  const tone = resolveFindingTone(review, finding)
  const meta = [finding.severity, finding.status, finding.rule].filter((value): value is string => typeof value === 'string' && value.length > 0)
  const location = renderLineRange(finding)
  return html`<div class="insight ${tone}">` +
    html`<div class="insight-head"><span class="insight-title">${esc(finding.title ?? 'Finding')}</span><span class="insight-arrow">▼</span></div>` +
    html`<div class="insight-body open">` +
    (meta.length === 0 ? '' : html`<div class="insight-evidence"><strong>Meta:</strong> ${esc(meta.join(' │ '))}</div>`) +
    (location.length === 0 ? '' : html`<div class="insight-evidence"><strong>Location:</strong> ${location}</div>`) +
    (finding.details === undefined ? '' : html`<div class="insight-evidence"><strong>Details:</strong> ${esc(finding.details)}</div>`) +
    (finding.recommendation === undefined ? '' : html`<div class="insight-evidence"><strong>Recommendation:</strong> ${esc(finding.recommendation)}</div>`) +
    html`</div></div>`
}

function resolveFindingTone(review: ReviewDto, finding: ReviewDto['findings'][number]): 'warning' | 'success' | 'info' {
  if (finding.status === 'blocking') {
    return 'warning'
  }
  if (review.verdict === 'PASS') {
    return 'success'
  }
  return 'info'
}

function renderAttempt(review: ReviewDto, attemptNumber: number): string {
  const blockingCount = countBlockingFindings(review)
  const summary = review.summary === undefined ? '' : html`<div class="suggestion-rationale" style="margin-bottom:12px">${esc(review.summary)}</div>`
  const findings = review.findings.length === 0
    ? '<div class="loading" style="padding:12px 0">No findings recorded for this attempt</div>'
    : review.findings.map((finding) => renderFinding(review, finding)).join('')
  return html`<section class="iter${review.verdict === 'FAIL' ? ' flagged' : ''}" style="margin-bottom:12px">` +
    html`<div class="iter-head"><span class="iter-title">Attempt ${attemptNumber}</span><div class="iter-badges"><span class="badge ${review.verdict === 'PASS' ? 'badge-ok' : 'badge-bad'}">${esc(review.verdict)}</span></div></div>` +
    html`<div class="iter-body open">` +
    html`<div class="iter-metrics"><span>${esc(formatTimestamp(review.createdAt))}</span><span>${esc(review.reviewType)}</span><span>${review.findings.length} finding(s)</span><span class="${blockingCount > 0 ? 'warn' : ''}">${blockingCount} blocking</span></div>` +
    summary +
    findings +
    `</div></section>`
}

function groupReviewsByType(reviews: ReadonlyArray<ReviewDto>): Map<string, Array<ReviewDto>> {
  const groups = new Map<string, Array<ReviewDto>>()
  for (const review of reviews) {
    const existing = groups.get(review.reviewType)
    if (existing === undefined) {
      groups.set(review.reviewType, [review])
      continue
    }
    existing.push(review)
  }
  return groups
}

/** @riviere-role web-tbc */
export function renderReviewPanel(reviews: ReadonlyArray<ReviewDto>): string {
  if (reviews.length === 0) {
    return '<div class="loading">No reviews recorded for this session</div>'
  }

  const groups = groupReviewsByType(reviews)
  return [...groups.entries()].map(([reviewType, attempts]) => {
    return html`<section style="margin-bottom:28px">` +
      html`<h3 style="margin:0 0 10px">${esc(reviewType)}</h3>` +
      attempts.map((review, index) => renderAttempt(review, index + 1)).join('') +
      `</section>`
  }).join('')
}
