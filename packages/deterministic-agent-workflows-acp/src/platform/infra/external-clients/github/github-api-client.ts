import { z } from 'zod'
import {
  ReviewerFeedbackError,
  reviewerFeedbackErrorFromStatus,
} from '../../../domain/reviewer-feedback/reviewer-feedback-types'

const pullRequestResponseSchema = z.object({head: z.object({ sha: z.string() }).passthrough(),}).passthrough()

const reviewResourceSchema = z.object({
  id: z.number().int().positive(),
  body: z.string(),
  commit_id: z.string().nullable(),
}).passthrough()

const reviewCommentResourceSchema = z.object({id: z.number().int().positive(),}).passthrough()

const reviewListResponseSchema = z.array(reviewResourceSchema)

const graphQlCommentNodeSchema = z.object({
  databaseId: z.number().int().positive().nullable(),
  author: z.object({ login: z.string().nullable() }).passthrough().nullable(),
  body: z.string(),
}).passthrough()

const graphQlThreadNodeSchema = z.object({
  id: z.string(),
  isResolved: z.boolean(),
  comments: z.object({nodes: z.array(graphQlCommentNodeSchema),}).passthrough(),
}).passthrough()

const graphQlThreadsConnectionSchema = z.object({
  nodes: z.array(graphQlThreadNodeSchema),
  pageInfo: z.object({ hasNextPage: z.boolean() }).passthrough(),
}).passthrough()

const graphQlThreadResponseSchema = z.object({
  data: z.object({repository: z.object({pullRequest: z.object({reviewThreads: graphQlThreadsConnectionSchema,}).passthrough(),}).passthrough(),}).passthrough(),
  errors: z.array(z.object({ message: z.string() }).passthrough()).optional(),
}).passthrough()

const graphQlMutationResponseSchema = z.object({
  data: z.record(z.unknown()).optional(),
  errors: z.array(z.object({ message: z.string() }).passthrough()).optional(),
}).passthrough()

/** @riviere-role external-client-model */
export interface GithubPullRequestReview {
  readonly id: number
  readonly body: string
  readonly commitId: string | null
}

/** @riviere-role external-client-model */
export interface GithubReviewThread {
  readonly id: string
  readonly isResolved: boolean
  readonly comments: readonly {
    readonly databaseId: number | null
    readonly authorLogin: string | null
    readonly body: string
  }[]
}

/** @riviere-role external-client-model */
export interface GithubApiClient {
  getPullRequestHeadRevision(): Promise<string>
  getPullRequestDiff(): Promise<string>
  listReviews(): Promise<readonly GithubPullRequestReview[]>
  listReviewComments(reviewId: number): Promise<readonly number[]>
  createReview(input: {
    readonly event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'
    readonly body: string
    readonly commitId: string
    readonly comments: readonly {
      readonly path: string;
      readonly line: number;
      readonly side: 'LEFT' | 'RIGHT';
      readonly body: string 
    }[]
  }): Promise<{
    readonly reviewId: number;
    readonly commentIds: readonly number[] 
  }>
  listReviewThreads(): Promise<readonly GithubReviewThread[]>
  createReply(input: {
    readonly commentDatabaseId: number;
    readonly body: string 
  }): Promise<{ readonly commentId: number }>
  resolveThread(threadNodeId: string): Promise<void>
}

/** @riviere-role external-client-model */
export interface GithubApiClientConfig {
  readonly token: string
  readonly repository: string
  readonly pullRequestNumber: number
  readonly restApiBaseUrl?: string
  readonly graphqlApiBaseUrl?: string
  readonly timeoutMs?: number
  readonly fetchImpl?: typeof fetch
}

const defaultTimeoutMs = 30_000

function requestTimeoutError(message: string): ReviewerFeedbackError {
  return new ReviewerFeedbackError('network', message)
}

/** @riviere-role external-client-service */
export function createGithubApiClient(config: GithubApiClientConfig): GithubApiClient {
  const fetchImpl = config.fetchImpl ?? fetch
  const restBase = config.restApiBaseUrl ?? 'https://api.github.com'
  const graphqlBase = config.graphqlApiBaseUrl ?? 'https://api.github.com/graphql'
  const timeoutMs = config.timeoutMs ?? defaultTimeoutMs

  async function requestJson(
    path: string,
    method: 'GET' | 'POST',
    body?: unknown,
    acceptHeader = 'application/vnd.github+json',
  ): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(`${restBase}${path}`, {
        method,
        headers: {
          'Accept': acceptHeader,
          'Authorization': `Bearer ${config.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      })
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw reviewerFeedbackErrorFromStatus(
          response.status,
          `GitHub API ${method} ${path} failed with status ${String(response.status)}: ${detail.slice(0, 500)}`,
        )
      }
      try {
        return await response.json()
      } catch (cause) {
        throw new ReviewerFeedbackError(
          'malformed',
          `GitHub API ${method} ${path} returned a malformed JSON response.`,
          { cause },
        )
      }
    } catch (error) {
      if (error instanceof ReviewerFeedbackError) throw error
      if (error instanceof Error && error.name === 'AbortError') {
        throw requestTimeoutError(`GitHub API ${method} ${path} timed out after ${String(timeoutMs)}ms.`)
      }
      throw new ReviewerFeedbackError(
        'network',
        `GitHub API ${method} ${path} failed before a response was received: ${String(error)}`,
        { cause: error },
      )
    } finally {
      clearTimeout(timer)
    }
  }

  async function requestText(path: string, acceptHeader: string): Promise<string> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(`${restBase}${path}`, {
        method: 'GET',
        headers: {
          'Accept': acceptHeader,
          'Authorization': `Bearer ${config.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: controller.signal,
      })
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw reviewerFeedbackErrorFromStatus(
          response.status,
          `GitHub API GET ${path} failed with status ${String(response.status)}: ${detail.slice(0, 500)}`,
        )
      }
      return await response.text()
    } catch (error) {
      if (error instanceof ReviewerFeedbackError) throw error
      if (error instanceof Error && error.name === 'AbortError') {
        throw requestTimeoutError(`GitHub API GET ${path} timed out after ${String(timeoutMs)}ms.`)
      }
      throw new ReviewerFeedbackError(
        'network',
        `GitHub API GET ${path} failed before a response was received: ${String(error)}`,
        { cause: error },
      )
    } finally {
      clearTimeout(timer)
    }
  }

  async function graphqlRequest(query: string, variables: Record<string, unknown>): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(graphqlBase, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          variables 
        }),
        signal: controller.signal,
      })
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw reviewerFeedbackErrorFromStatus(
          response.status,
          `GitHub GraphQL request failed with status ${String(response.status)}: ${detail.slice(0, 500)}`,
        )
      }
      try {
        return await response.json()
      } catch (cause) {
        throw new ReviewerFeedbackError(
          'malformed',
          'GitHub GraphQL returned a malformed JSON response.',
          { cause },
        )
      }
    } catch (error) {
      if (error instanceof ReviewerFeedbackError) throw error
      if (error instanceof Error && error.name === 'AbortError') {
        throw requestTimeoutError(`GitHub GraphQL request timed out after ${String(timeoutMs)}ms.`)
      }
      throw new ReviewerFeedbackError(
        'network',
        `GitHub GraphQL request failed before a response was received: ${String(error)}`,
        { cause: error },
      )
    } finally {
      clearTimeout(timer)
    }
  }

  const [owner, name] = config.repository.split('/')
  const prNumber = config.pullRequestNumber

  return {
    async getPullRequestHeadRevision() {
      const parsed = pullRequestResponseSchema.parse(
        await requestJson(`/repos/${owner}/${name}/pulls/${String(prNumber)}`, 'GET'),
      )
      return parsed.head.sha
    },
    async getPullRequestDiff() {
      return requestText(
        `/repos/${owner}/${name}/pulls/${String(prNumber)}`,
        'application/vnd.github.v3.diff',
      )
    },
    async listReviews() {
      return reviewListResponseSchema.parse(
        await requestJson(`/repos/${owner}/${name}/pulls/${String(prNumber)}/reviews?per_page=100`, 'GET'),
      ).map((review) => ({
        id: review.id,
        body: review.body,
        commitId: review.commit_id,
      }))
    },
    async listReviewComments(reviewId) {
      return z.array(reviewCommentResourceSchema).parse(await requestJson(
        `/repos/${owner}/${name}/pulls/${String(prNumber)}/reviews/${String(reviewId)}/comments?per_page=100`,
        'GET',
      )).map((comment) => comment.id)
    },
    async createReview(input) {
      const parsed = reviewResourceSchema.parse(await requestJson(
        `/repos/${owner}/${name}/pulls/${String(prNumber)}/reviews`,
        'POST',
        {
          event: input.event,
          body: input.body,
          commit_id: input.commitId,
          comments: input.comments.map((comment) => ({
            path: comment.path,
            line: comment.line,
            side: comment.side,
            body: comment.body,
          })),
        },
      ))
      const commentRows = z.array(reviewCommentResourceSchema).parse(
        await requestJson(
          `/repos/${owner}/${name}/pulls/${String(prNumber)}/reviews/${String(parsed.id)}/comments`,
          'GET',
        ),
      )
      return {
        reviewId: parsed.id,
        commentIds: commentRows.map((comment) => comment.id),
      }
    },
    async listReviewThreads() {
      const threads: GithubReviewThread[] = []
      const threadQuery = `
        query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
          repository(owner: $owner, name: $name) {
            pullRequest(number: $number) {
              reviewThreads(first: 100, after: $cursor) {
                nodes {
                  id
                  isResolved
                  comments(first: 50) {
                    nodes {
                      databaseId
                      author { login }
                      body
                    }
                  }
                }
                pageInfo { hasNextPage endCursor }
              }
            }
          }
        }
      `
      const pageBudget = 3
      const collect = async (
        cursor: string | undefined,
      ): Promise<{
        readonly endCursor: string | null;
        readonly hasNextPage: boolean 
      }> => {
        const parsed = graphQlThreadResponseSchema.parse(
          await graphqlRequest(threadQuery, {
            owner,
            name,
            number: prNumber,
            ...(cursor === undefined ? {} : { cursor }),
          }),
        )
        if (parsed.errors !== undefined && parsed.errors.length > 0) {
          throw new ReviewerFeedbackError(
            'malformed',
            `GitHub GraphQL returned errors: ${parsed.errors.map((issue) => issue.message).join('; ')}`,
          )
        }
        const connection = parsed.data.repository.pullRequest.reviewThreads
        for (const node of connection.nodes) {
          threads.push({
            id: node.id,
            isResolved: node.isResolved,
            comments: node.comments.nodes.map((comment) => ({
              databaseId: comment.databaseId,
              authorLogin: comment.author?.login ?? null,
              body: comment.body,
            })),
          })
        }
        return {
          endCursor: z.string().nullable().parse(
            z.object({ endCursor: z.unknown() }).passthrough().parse(connection.pageInfo).endCursor,
          ),
          hasNextPage: connection.pageInfo.hasNextPage,
        }
      }
      const firstPage = await collect(undefined)
      const cursor = { value: firstPage.hasNextPage ? firstPage.endCursor : null }
      const page = { number: 1 }
      while (cursor.value !== null && page.number < pageBudget) {
        const nextPage = await collect(cursor.value)
        page.number = page.number + 1
        cursor.value = nextPage.hasNextPage ? nextPage.endCursor : null
      }
      if (cursor.value !== null) {
        throw new ReviewerFeedbackError(
          'malformed',
          'GitHub review threads exceeded the supported page budget.',
        )
      }
      return threads
    },
    async createReply(input) {
      const parsed = reviewCommentResourceSchema.parse(await requestJson(
        `/repos/${owner}/${name}/pulls/${String(prNumber)}/comments/${String(input.commentDatabaseId)}/replies`,
        'POST',
        { body: input.body },
      ))
      return { commentId: parsed.id }
    },
    async resolveThread(threadNodeId) {
      const parsed = graphQlMutationResponseSchema.parse(await graphqlRequest(
        `mutation($threadId: ID!) {
          resolveReviewThread(input: { threadId: $threadId }) { thread { id isResolved } }
        }`,
        { threadId: threadNodeId },
      ))
      if (parsed.errors !== undefined && parsed.errors.length > 0) {
        throw new ReviewerFeedbackError(
          'malformed',
          `GitHub GraphQL resolve failed: ${parsed.errors.map((issue) => issue.message).join('; ')}`,
        )
      }
    },
  }
}
