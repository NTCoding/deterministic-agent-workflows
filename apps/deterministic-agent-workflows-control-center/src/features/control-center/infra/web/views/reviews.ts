import type { ReviewDto } from '../api-client'
import { api } from '../api-client'
import {
  esc,
  formatTimestamp,
  html,
} from '../render'

type ReviewFiltersState = {
  repository: string
  branch: string
  pullRequestNumber: string
  reviewType: string
  verdict: string
}

function countBlockingFindings(review: ReviewDto): number {
  return review.findings.filter((finding) => finding.status === 'blocking').length
}

function summarizeFindings(review: ReviewDto): string {
  if (review.findings.length === 0) return 'No findings'
  const statusSummary = review.findings
    .map((finding) => finding.status)
    .filter((status): status is string => typeof status === 'string' && status.length > 0)
  if (statusSummary.length === 0) return `${review.findings.length} finding(s)`
  return statusSummary.join(' │ ')
}

function renderControls(filters: ReviewFiltersState): string {
  return html`<div class="session-controls">` +
    html`<input class="session-search" data-filter="repository" type="text" placeholder="Repository" value="${esc(filters.repository)}" />` +
    html`<input class="session-search" data-filter="branch" type="text" placeholder="Branch" value="${esc(filters.branch)}" />` +
    html`<input class="session-search" data-filter="pullRequestNumber" type="text" placeholder="PR number" value="${esc(filters.pullRequestNumber)}" />` +
    html`<input class="session-search" data-filter="reviewType" type="text" placeholder="Review type" value="${esc(filters.reviewType)}" />` +
    html`<select class="filter-btn" data-filter="verdict"><option value="">All verdicts</option><option value="PASS"${filters.verdict === 'PASS' ? ' selected' : ''}>PASS</option><option value="FAIL"${filters.verdict === 'FAIL' ? ' selected' : ''}>FAIL</option></select>` +
    `</div>`
}

function renderRows(reviews: ReadonlyArray<ReviewDto>): string {
  if (reviews.length === 0) {
    return '<div class="loading">No reviews match the current filters</div>'
  }
  const rows = reviews.map((review) => {
    const blockingFindings = countBlockingFindings(review)
    const pullRequestLabel = review.pullRequestNumber === undefined ? '—' : `#${review.pullRequestNumber}`
    return html`<tr>` +
      html`<td>${esc(review.repository ?? '—')}</td>` +
      html`<td>${esc(review.branch ?? '—')}</td>` +
      html`<td>${pullRequestLabel}</td>` +
      html`<td>${esc(review.reviewType)}</td>` +
      html`<td><span class="badge ${review.verdict === 'PASS' ? 'badge-ok' : 'badge-bad'}">${esc(review.verdict)}</span></td>` +
      html`<td><a href="#/session/${esc(review.sessionId)}">${esc(review.sessionId.slice(0, 8))}</a></td>` +
      html`<td>${esc(formatTimestamp(review.createdAt))}</td>` +
      html`<td>${esc(review.summary ?? summarizeFindings(review))}</td>` +
      html`<td>${blockingFindings}</td>` +
      `</tr>`
  }).join('')
  return html`<table class="data-table"><thead><tr><th>Repository</th><th>Branch</th><th>PR</th><th>Review Type</th><th>Verdict</th><th>Session</th><th>Recorded</th><th>Summary</th><th>Blocking</th></tr></thead><tbody>${rows}</tbody></table>`
}

function readPullRequestNumber(value: string): number | undefined {
  if (value.length === 0) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isNaN(parsed) ? undefined : parsed
}

/** @riviere-role web-tbc */
export async function renderReviews(container: HTMLElement): Promise<void> {
  container.innerHTML = html`<div class="loading">Loading reviews...</div>`
  const filters: ReviewFiltersState = {
    repository: '',
    branch: '',
    pullRequestNumber: '',
    reviewType: '',
    verdict: '',
  }

  const render = async (): Promise<void> => {
    const result = await api.getReviews(buildReviewParams(filters))

    container.innerHTML = html`<div class="section"><h2 style="margin:0 0 12px">Reviews</h2>${renderControls(filters)}${renderRows(result.reviews)}</div>`
    container.querySelectorAll('[data-filter]').forEach((element) => {
      if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement)) {
        return
      }
      element.addEventListener('input', () => {
        const filterName = element.getAttribute('data-filter')
        if (filterName === 'repository' || filterName === 'branch' || filterName === 'pullRequestNumber' || filterName === 'reviewType' || filterName === 'verdict') {
          filters[filterName] = element.value
          void render()
        }
      })
      element.addEventListener('change', () => {
        const filterName = element.getAttribute('data-filter')
        if (filterName === 'repository' || filterName === 'branch' || filterName === 'pullRequestNumber' || filterName === 'reviewType' || filterName === 'verdict') {
          filters[filterName] = element.value
          void render()
        }
      })
    })
  }

  await render()
}

function buildReviewParams(filters: ReviewFiltersState): Parameters<typeof api.getReviews>[0] {
  const pullRequestNumber = readPullRequestNumber(filters.pullRequestNumber)
  return {
    ...(filters.repository.length === 0 ? {} : { repository: filters.repository }),
    ...(filters.branch.length === 0 ? {} : { branch: filters.branch }),
    ...(pullRequestNumber === undefined ? {} : { pullRequestNumber }),
    ...(filters.reviewType.length === 0 ? {} : { reviewType: filters.reviewType }),
    ...(filters.verdict.length === 0 ? {} : { verdict: filters.verdict }),
  }
}
