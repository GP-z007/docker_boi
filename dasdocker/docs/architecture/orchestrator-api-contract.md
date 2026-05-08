# dasDocker Orchestrator — HTTP API Contract (OpenAPI 3.0)

**Document type:** Normative API contract (YAML below).  
**Authentication:** All listed operations require **exactly one** of: **HTTP Bearer JWT (RS256)** or **mutual-TLS client certificate** bound to a service identity, unless a deployment-specific **Squad A–approved** exception is documented (default is **no exception**).  
**Rate limits:** Enforced at the edge/gateway; values below are **product defaults** and MAY be tuned per tenant.

The machine-readable contract is embedded in this file for single-source review with implementation. Validate the YAML in [Swagger Editor](https://editor.swagger.io).

---

## Endpoint-level test matrix (Phase 2 obligations)

| Operation | Unit | Integration | Red-team / negative |
|-----------|------|-------------|---------------------|
| `POST /api/v1/sessions` | Schema validation, TTL bounds, idempotency-key parsing | End-to-end create → `QUEUED` in Redis | Oversized payload, authZ bypass, ZIP bomb metadata, SSRF in `github_url` |
| `GET /api/v1/sessions` | Cursor encoding | Pagination + tenant scope | Enumeration, missing auth, header injection |
| `GET /api/v1/sessions/{session_id}` | ACL matrix unit | Read after write consistency | IDOR across tenants, caching leaks |
| `DELETE /api/v1/sessions/{session_id}` | Transition table for destroy | `RUNNING→DESTROYING` | Double-delete, terminal replay, forged identity |
| `GET /api/v1/health` | Flag composition | Redis + Docker ping | Unauthenticated access MUST fail when `ORCHESTRATOR_HEALTH_REQUIRE_AUTH=true` |

---

## OpenAPI 3.1.0 specification (YAML)

`mutualTLS` requires OpenAPI **3.1**; tooling MUST support 3.1 for full validation.

```yaml
openapi: 3.1.0
info:
  title: dasDocker Orchestrator API
  description: |
    Session lifecycle, queueing, and destroy API for the dasDocker platform.
    All endpoints require authentication (Bearer JWT RS256 or mTLS client identity)
    per Zero Trust Architecture unless an explicit Squad A exception is recorded.
  version: 0.1.0
  license:
    name: MIT
    url: https://opensource.org/licenses/MIT

servers:
  - url: https://orchestrator.dasdocker.internal/api
    description: Internal cluster URL (example)
  - url: http://localhost:8080/api
    description: Local development (TLS still required in production)

tags:
  - name: Sessions
    description: Create, list, read, and destroy sandbox sessions.
  - name: Health
    description: Liveness and dependency readiness (authenticated).

security:
  - bearerAuth: []
  - mTLSClientCert: []

paths:
  /v1/sessions:
    post:
      tags: [Sessions]
      summary: Create session
      description: |
        Accepts a new session; persists state `QUEUED` after policy validation.
        Permission (create session) MUST be asserted from JWT scopes or mTLS SAN.
      operationId: createSession
      x-rate-limit:
        requests_per_minute: 30
        burst: 60
      parameters:
        - name: Idempotency-Key
          in: header
          description: >-
            OPTIONAL. Unique key for retry-safe creates; SHOULD be UUID v4.
            Server stores mapping 24h to return same session id.
          required: false
          schema:
            type: string
            maxLength: 128
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateSessionRequest'
      responses:
        '201':
          description: Session accepted (state QUEUED).
          headers:
            Location:
              description: Canonical URL for the new session.
              schema:
                type: string
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Session'
        '400':
          $ref: '#/components/responses/BadRequest'
        '401':
          $ref: '#/components/responses/Unauthorized'
        '403':
          $ref: '#/components/responses/Forbidden'
        '409':
          $ref: '#/components/responses/Conflict'
        '422':
          $ref: '#/components/responses/UnprocessableEntity'
        '429':
          $ref: '#/components/responses/TooManyRequests'
    get:
      tags: [Sessions]
      summary: List sessions visible to caller
      description: |
        Returns paginated sessions filtered by tenant/scope derived from credential.
      operationId: listSessions
      x-rate-limit:
        requests_per_minute: 120
        burst: 200
      parameters:
        - $ref: '#/components/parameters/Cursor'
        - $ref: '#/components/parameters/Limit'
        - name: state
          in: query
          description: Filter by session state enum.
          schema:
            $ref: '#/components/schemas/SessionState'
      responses:
        '200':
          description: Page of sessions.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/SessionList'
        '401':
          $ref: '#/components/responses/Unauthorized'
        '403':
          $ref: '#/components/responses/Forbidden'
        '429':
          $ref: '#/components/responses/TooManyRequests'

  /v1/sessions/{session_id}:
    get:
      tags: [Sessions]
      summary: Get session
      description: |
        Returns current session including state machine field `state`.
        AuthZ MUST enforce tenant ownership or admin scope.
      operationId: getSession
      x-rate-limit:
        requests_per_minute: 600
        burst: 1200
      parameters:
        - $ref: '#/components/parameters/SessionId'
      responses:
        '200':
          description: Current session projection.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Session'
        '401':
          $ref: '#/components/responses/Unauthorized'
        '403':
          $ref: '#/components/responses/Forbidden'
        '404':
          $ref: '#/components/responses/NotFound'
        '429':
          $ref: '#/components/responses/TooManyRequests'
    delete:
      tags: [Sessions]
      summary: Destroy session
      description: |
        Requests transition toward `DESTROYING` when valid per state machine.
        Idempotent delete on terminal states returns **409** (`TerminalStateError`).
      operationId: destroySession
      x-rate-limit:
        requests_per_minute: 60
        burst: 100
      parameters:
        - $ref: '#/components/parameters/SessionId'
        - name: Force
          in: query
          description: Hint to escalate kill; MUST still honor policy ceilings.
          schema:
            type: boolean
            default: false
      responses:
        '202':
          description: Destroy accepted; async teardown started.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Session'
        '401':
          $ref: '#/components/responses/Unauthorized'
        '403':
          $ref: '#/components/responses/Forbidden'
        '404':
          $ref: '#/components/responses/NotFound'
        '409':
          description: Invalid or terminal transition.
          content:
            application/problem+json:
              schema:
                $ref: '#/components/schemas/Problem'
              examples:
                invalid_transition:
                  value:
                    type: https://dasdocker.dev/problems/invalid-transition
                    title: Invalid transition
                    status: 409
                    code: invalid_transition
                    detail: Transition not authorised for current state.
                terminal_state:
                  value:
                    type: https://dasdocker.dev/problems/terminal-state
                    title: Terminal state
                    status: 409
                    code: terminal_state
                    detail: Session is already in a terminal state.
        '429':
          $ref: '#/components/responses/TooManyRequests'

  /v1/health:
    get:
      tags: [Health]
      summary: Health check
      description: |
        Liveness and critical dependencies (Redis reachability, Docker API).
        **Authentication is required** in production; probes MUST present a
        service token or mTLS identity (see environment variables in handoff).
      operationId: getHealth
      x-rate-limit:
        requests_per_minute: 300
        burst: 600
      responses:
        '200':
          description: Service healthy enough to receive traffic.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/HealthStatus'
        '401':
          $ref: '#/components/responses/Unauthorized'
        '503':
          description: Dependency unhealthy.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/HealthStatus'

components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
      description: RS256 JWT; `iss` and `aud` validated; scopes include `sessions:read`, `sessions:write`, `sessions:destroy`, `health:read`.
    mTLSClientCert:
      type: mutualTLS
      description: Client certificate with SAN matching registered worker or orchestrator client identity.

  parameters:
    SessionId:
      name: session_id
      in: path
      required: true
      description: Session UUID (v4).
      schema:
        type: string
        format: uuid
    Cursor:
      name: cursor
      in: query
      schema:
        type: string
        nullable: true
      description: Opaque pagination cursor.
    Limit:
      name: limit
      in: query
      schema:
        type: integer
        minimum: 1
        maximum: 100
        default: 20

  schemas:
    SessionState:
      type: string
      enum:
        - QUEUED
        - PROVISIONING
        - INSTALLING_DEPS
        - RUNNING
        - DESTROYING
        - DESTROYED
        - FAILED

    SourceType:
      type: string
      enum: [github, zip]

    Session:
      type: object
      required:
        - session_id
        - state
        - source_type
        - created_at
        - ttl_seconds_remaining
      properties:
        session_id:
          type: string
          format: uuid
        state:
          $ref: '#/components/schemas/SessionState'
        source_type:
          $ref: '#/components/schemas/SourceType'
        created_at:
          type: string
          format: date-time
        expires_at:
          type: string
          format: date-time
          nullable: true
        correlation_id:
          type: string
        container_id:
          type: string
          nullable: true
        worker_id:
          type: string
          nullable: true
        ttl_seconds_remaining:
          type: integer
          minimum: 0
          description: Approximate client-facing countdown for RUNNING; null semantics as 0 when terminal.
        failure_reason:
          type: string
          nullable: true

    CreateSessionRequest:
      type: object
      required:
        - source_type
        - running_ttl_seconds
      properties:
        source_type:
          $ref: '#/components/schemas/SourceType'
        github_url:
          type: string
          format: uri
          nullable: true
          description: Required when source_type=github; MUST pass SSRF policy.
        zip_upload_id:
          type: string
          nullable: true
          description: Required when source_type=zip; pre-authenticated upload handle.
        install_commands:
          type: array
          items:
            type: string
            maxLength: 4096
          maxItems: 32
          description: Shell commands for INSTALLING_DEPS phase; empty skips the state.
        entrypoint:
          type: string
          maxLength: 4096
          description: Primary process command line inside sandbox.
        running_ttl_seconds:
          type: integer
          minimum: 60
          maximum: 3600
          description: RUNNING phase max duration (wall clock after reaching RUNNING).
        metadata:
          type: object
          additionalProperties:
            type: string
            maxLength: 256

    SessionList:
      type: object
      required:
        - items
        - next_cursor
      properties:
        items:
          type: array
          items:
            $ref: '#/components/schemas/Session'
        next_cursor:
          type: string
          nullable: true

    HealthStatus:
      type: object
      required: [status, checks]
      properties:
        status:
          type: string
          enum: [ok, degraded, unhealthy]
        checks:
          type: object
          additionalProperties:
            type: object
            required: [status]
            properties:
              status:
                type: string
                enum: [pass, fail]
              latency_ms:
                type: number

    Problem:
      type: object
      description: RFC 7807 Problem Details (application/problem+json).
      required: [title, status]
      properties:
        type:
          type: string
          format: uri
        title:
          type: string
        status:
          type: integer
        detail:
          type: string
        code:
          type: string
        instance:
          type: string
          format: uri

  responses:
    BadRequest:
      description: Malformed request.
      content:
        application/problem+json:
          schema:
            $ref: '#/components/schemas/Problem'
          example:
            title: Bad Request
            status: 400
            code: bad_request
    Unauthorized:
      description: Missing or invalid authentication.
      content:
        application/problem+json:
          schema:
            $ref: '#/components/schemas/Problem'
          example:
            title: Unauthorized
            status: 401
            code: unauthorized
    Forbidden:
      description: Authenticated but not authorised.
      content:
        application/problem+json:
          schema:
            $ref: '#/components/schemas/Problem'
          example:
            title: Forbidden
            status: 403
            code: forbidden
    NotFound:
      description: Resource not found or not visible.
      content:
        application/problem+json:
          schema:
            $ref: '#/components/schemas/Problem'
          example:
            title: Not Found
            status: 404
            code: not_found
    Conflict:
      description: Idempotency or state conflict.
      content:
        application/problem+json:
          schema:
            $ref: '#/components/schemas/Problem'
    UnprocessableEntity:
      description: Semantic validation failure (policy / STRIDE gate).
      content:
        application/problem+json:
          schema:
            $ref: '#/components/schemas/Problem'
          example:
            title: Unprocessable Entity
            status: 422
            code: policy_rejected
    TooManyRequests:
      description: Rate limit exceeded.
      headers:
        Retry-After:
          schema:
            type: integer
      content:
        application/problem+json:
          schema:
            $ref: '#/components/schemas/Problem'
          example:
            title: Too Many Requests
            status: 429
            code: rate_limited
```

---

## Error code catalogue (normative)

| HTTP | `code` | When |
|------|--------|------|
| 400 | `bad_request` | Schema / parser failure |
| 401 | `unauthorized` | Missing/invalid JWT or cert |
| 403 | `forbidden` | Valid identity, insufficient scope |
| 404 | `not_found` | Unknown `session_id` or wrong tenant |
| 409 | `invalid_transition` | State machine violation (non-terminal) |
| 409 | `terminal_state` | Destroy/read against terminal where disallowed |
| 409 | `idempotency_conflict` | Same `Idempotency-Key`, different body hash |
| 422 | `policy_rejected` | STRIDE / admission control |
| 429 | `rate_limited` | Quota exceeded |

---

*Orchestration Architect — Agent 05 · Phase 1 · Dispatch 05 of 08*
