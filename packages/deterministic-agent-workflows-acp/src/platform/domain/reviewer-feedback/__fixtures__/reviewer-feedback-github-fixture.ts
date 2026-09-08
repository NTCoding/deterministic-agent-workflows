import type {
  IncomingMessage, Server, ServerResponse 
} from 'node:http'
import { createServer } from 'node:http'
import { z } from 'zod'

/** @riviere-role value-object */
export interface FixtureReviewComment {
  readonly id: number
  readonly path: string
  readonly line: number
  readonly side: 'LEFT' | 'RIGHT'
  readonly body: string
}

/** @riviere-role value-object */
export interface FixtureReview {
  readonly id: number
  readonly body: string
  readonly commitId: string
  readonly event: string
  readonly comments: FixtureReviewComment[]
}

/** @riviere-role value-object */
export interface FixtureThread {
  readonly id: string
  isResolved: boolean
  comments: {
    readonly databaseId: number;
    readonly authorLogin: string;
    readonly body: string 
  }[]
}

/** @riviere-role value-object */
export interface FixtureGithubState {
  headRevision: string
  diff: string
  readonly reviews: FixtureReview[]
  readonly threads: FixtureThread[]
  authRequired: boolean
  failNextPostWith: number | undefined
  malformedJson: boolean
}

/** @riviere-role value-object */
export interface FixtureGithubServer {
  readonly state: FixtureGithubState
  readonly restBaseUrl: string
  readonly graphqlBaseUrl: string
  readonly requests: readonly {
    readonly method: string;
    readonly path: string 
  }[]
  readonly reset: () => void
  readonly close: () => Promise<void>
}

const repositoryPath = '/repos/example-repo/example-project/pulls/42'

const createReviewBodySchema = z.object({
  event: z.string(),
  body: z.string(),
  commit_id: z.string(),
  comments: z.array(z.object({
    path: z.string(),
    line: z.number(),
    side: z.enum(['LEFT', 'RIGHT']),
    body: z.string(),
  })),
})

const replyBodySchema = z.object({ body: z.string() })

const graphqlBodySchema = z.object({
  query: z.string(),
  variables: z.record(z.unknown()).default({}),
})

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: string[] = []
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => chunks.push(chunk))
    request.on('end', () => resolve(chunks.join('')))
  })
}

function respond(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(payload))
}

/** @riviere-role external-client-model */
class FixtureGithubApi {
  readonly state: FixtureGithubState
  readonly requests: {
    method: string;
    path: string 
  }[] = []
  private readonly initialHeadRevision: string
  private readonly initialThreads: FixtureThread[]
  private counters = {
    reviewId: 100,
    commentId: 1000,
  }

  constructor(initial: {
    readonly headRevision: string;
    readonly diff: string;
    readonly threads?: FixtureThread[] 
  }) {
    this.initialHeadRevision = initial.headRevision
    this.initialThreads = structuredClone(initial.threads ?? [])
    this.state = {
      headRevision: initial.headRevision,
      diff: initial.diff,
      reviews: [],
      threads: initial.threads ?? [],
      authRequired: true,
      failNextPostWith: undefined,
      malformedJson: false,
    }
  }

  reset(): void {
    this.state.reviews.splice(0, this.state.reviews.length)
    this.state.threads.splice(0, this.state.threads.length, ...structuredClone(this.initialThreads))
    this.state.headRevision = this.initialHeadRevision
    this.state.authRequired = true
    this.state.failNextPostWith = undefined
    this.state.malformedJson = false
    this.requests.splice(0, this.requests.length)
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method === undefined || request.url === undefined) {
      respond(response, 400, { message: 'Malformed fixture request' })
      return
    }
    const method = request.method
    const path = request.url.split('?')[0]
    this.requests.push({
      method,
      path 
    })
    if (this.state.authRequired && request.headers['authorization'] !== 'Bearer fixture-token') {
      respond(response, 401, { message: 'Bad credentials' })
      return
    }
    if (this.injectFailure(method, response)) return
    if (this.state.malformedJson) {
      this.respondMalformed(response)
      return
    }
    await this.route(method, path, request, response)
  }

  private injectFailure(method: string, response: ServerResponse): boolean {
    if (this.state.failNextPostWith === undefined || method !== 'POST') return false
    const status = this.state.failNextPostWith
    this.state.failNextPostWith = undefined
    respond(response, status, { message: `Fixture failure ${String(status)}` })
    return true
  }

  private respondMalformed(response: ServerResponse): void {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end('{not-json')
  }

  private async route(method: string, path: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (method === 'GET') return this.routeGet(path, request, response)
    if (method === 'POST') return this.routePost(path, request, response)
    respond(response, 404, { message: 'Not Found' })
  }

  private routeGet(path: string, request: IncomingMessage, response: ServerResponse): void {
    if (path === repositoryPath && request.headers['accept'] === 'application/vnd.github.v3.diff') {
      response.writeHead(200, { 'Content-Type': 'text/plain' })
      response.end(this.state.diff)
      return
    }
    if (path === repositoryPath) {
      respond(response, 200, {
        head: { sha: this.state.headRevision },
        number: 42,
      })
      return
    }
    if (path === `${repositoryPath}/reviews`) {
      this.listReviews(response)
      return
    }
    const reviewCommentsMatch = /\/reviews\/(\d+)\/comments$/u.exec(path)
    if (reviewCommentsMatch !== null) {
      this.listReviewComments(response, Number(reviewCommentsMatch[1]))
      return
    }
    respond(response, 404, { message: 'Not Found' })
  }

  private async routePost(path: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (path === `${repositoryPath}/reviews`) {
      await this.createReview(request, response)
      return
    }
    const replyMatch = /\/pulls\/42\/comments\/(\d+)\/replies$/u.exec(path)
    if (replyMatch !== null) {
      await this.createReply(request, response, Number(replyMatch[1]))
      return
    }
    if (path === '/graphql') {
      await this.respondGraphql(response, await readBody(request))
      return
    }
    respond(response, 404, { message: 'Not Found' })
  }

  private listReviews(response: ServerResponse): void {
    respond(response, 200, this.state.reviews.map((review) => ({
      id: review.id,
      body: review.body,
      commit_id: review.commitId,
    })))
  }

  private listReviewComments(response: ServerResponse, reviewId: number): void {
    const review = this.state.reviews.find((candidate) => candidate.id === reviewId)
    const comments = review === undefined ? [] : review.comments.map((comment) => ({ id: comment.id }))
    respond(response, 200, comments)
  }

  private async createReview(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const parsed = createReviewBodySchema.parse(JSON.parse(await readBody(request)))
    const reviewId = this.counters.reviewId
    this.counters.reviewId = reviewId + 1
    const comments = parsed.comments.map((comment) => {
      const commentId = this.counters.commentId
      this.counters.commentId = commentId + 1
      return {
        id: commentId,
        ...comment 
      }
    })
    this.state.reviews.push({
      id: reviewId,
      body: parsed.body,
      commitId: parsed.commit_id,
      event: parsed.event,
      comments,
    })
    for (const comment of comments) {
      this.state.threads.push({
        id: `PRRT_inline-${String(comment.id)}`,
        isResolved: false,
        comments: [{
          databaseId: comment.id,
          authorLogin: 'review-bot',
          body: comment.body 
        }],
      })
    }
    respond(response, 200, {
      id: reviewId,
      body: parsed.body,
      commit_id: parsed.commit_id 
    })
  }

  private async createReply(request: IncomingMessage, response: ServerResponse, parentCommentId: number): Promise<void> {
    const parsed = replyBodySchema.parse(JSON.parse(await readBody(request)))
    const commentId = this.counters.commentId
    this.counters.commentId = commentId + 1
    const thread = this.state.threads.find((candidate) =>
      candidate.comments.some((existing) => existing.databaseId === parentCommentId))
    if (thread !== undefined) {
      thread.comments.push({
        databaseId: commentId,
        authorLogin: 'review-bot',
        body: parsed.body,
      })
    }
    respond(response, 200, { id: commentId })
  }

  private async respondGraphql(response: ServerResponse, rawBody: string): Promise<void> {
    const parsed = graphqlBodySchema.parse(JSON.parse(rawBody))
    if (parsed.query.includes('resolveReviewThread')) {
      this.resolveThread(response, String(parsed.variables['threadId']))
      return
    }
    respond(response, 200, {
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: this.state.threads.map((thread) => ({
                id: thread.id,
                isResolved: thread.isResolved,
                comments: {
                  nodes: thread.comments.map((comment) => ({
                    databaseId: comment.databaseId,
                    author: { login: comment.authorLogin },
                    body: comment.body,
                  })),
                },
              })),
              pageInfo: {
                hasNextPage: false,
                endCursor: null 
              },
            },
          },
        },
      },
    })
  }

  private resolveThread(response: ServerResponse, threadId: string): void {
    const thread = this.state.threads.find((candidate) => candidate.id === threadId)
    if (thread === undefined) {
      respond(response, 200, { errors: [{ message: `Could not resolve to a node: ${threadId}` }] })
      return
    }
    thread.isResolved = true
    respond(response, 200, {
      data: {
        resolveReviewThread: {
          thread: {
            id: threadId,
            isResolved: true 
          } 
        } 
      } 
    })
  }
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose) => {
    server.close(() => resolveClose())
  })
}

/** @riviere-role domain-service */
export function startFixtureGithubServer(initial: {
  readonly headRevision: string
  readonly diff: string
  readonly threads?: FixtureThread[]
}): Promise<FixtureGithubServer> {
  const api = new FixtureGithubApi(initial)
  const server: Server = createServer((request, response) => {
    void api.handle(request, response).catch((error: unknown) => {
      respond(response, 500, { message: String(error) })
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = z.object({ port: z.number() }).parse(server.address())
      const base = `http://127.0.0.1:${String(address.port)}`
      resolve({
        state: api.state,
        restBaseUrl: base,
        graphqlBaseUrl: `${base}/graphql`,
        requests: api.requests,
        reset: () => api.reset(),
        close: () => closeServer(server),
      })
    })
  })
}
