# dasDocker UI/UX Specification

**Document ID:** UIUX-SPEC-001  
**Version:** 1.0  
**Phase:** 1 — Research & Architecture  
**Owner:** UX Architect & Design System Lead (Agent 14)  
**Consumers:** Frontend Squad — Agents **15**, **16**, **17** (implementation); Agent **20** (UI/accessibility testing)  
**Status:** Defines all primary views, design tokens, component contracts, Zero Trust UI constraints (**Rule 1 — ZTA**), and WCAG/test obligations (**Rule 2**).

---

## Purpose

The dasDocker web interface is a **security tool first**, development convenience second. It must surface **complex real-time telemetry** (process trees, network flows, IDS alerts, console I/O) with **progressive disclosure** and **constant session posture legibility**: whether the session is **live**, **time-to-self-destruct**, and **whether any alerts have fired**.

This document is the **single source of truth** for information architecture, low-fidelity layout, design tokens, and per-component contracts for Phase 2+ frontend work.

---

## Rule 1 — ZTA: UI & Session Isolation Contract

The operator UI **must not** become a cross-tenant leakage channel or a DOM bridge for sandboxed application code.

| Requirement | Specification |
|-------------|---------------|
| **No cross-session data in UI state** | The client **must only** render session data returned for the **authenticated operator’s current session context** server-side validated. No client-side cache (IndexedDB, `localStorage`, shared workers) may store another user’s session payloads. |
| **Session identifiers in URLs** | **Prohibited:** sequential, enumerable, or short guessable IDs in path or query (e.g. `/session/1`, `/s?sid=00042`). **Required:** opaque, high-entropy tokens **or** server-only session binding (e.g. POST-established session + HTTP-only cookie; routes like `/workspace` with **no** raw session id in the bar). If a path segment is unavoidable, it **must** be a **non-guessable** opaque string (≥128 bits entropy) issued by the orchestrator, not derived from user input. |
| **Deep links & sharing** | Operators **must not** be able to craft URLs that enumerate other sessions. Any “copy link” affordance **must** be disabled or limited to **time-limited, signed** capability URLs if product requires sharing (Phase 2 product decision). |
| **Proxied Web View isolation** | `ProxiedWebView` **must** embed sandboxed content **only** via `<iframe sandbox="..." ...>` with the **strictest practical** token set (see component spec), **`allow-same-origin` only** when required for basic rendering and **never** combined with unnecessary `allow-top-navigation` / `allow-popups` without threat review. **CSP** enforced at proxy and parent page. **Parent and iframe origins must differ** (e.g. operator UI on `app.dasdocker…`, proxy on `sandbox.dasdocker…`) so sandbox JS **cannot** read operator `document.cookie` or operator DOM. |
| **postMessage** | Disabled by default. Any future `postMessage` channel requires **explicit allowlist** of origin + message schema + STRIDE sign-off. |

Frontend agents **15–17** treat this table as **non-negotiable** alongside functional requirements.

---

## A. Information Architecture

### A.1 Site map (all pages / primary views)

```text
dasDocker Web App
│
├── 1. Landing / Submit
│       ├── GitHub URL input (clone source)
│       ├── ZIP upload (alternative source)
│       ├── Constraints / warnings (ephemeral session, TTL, monitoring)
│       └── Primary action: Start session → routes to provisioning
│
├── 2. Session loading / provisioning
│       ├── Determinate progress (steps: queue → pull/build → sandbox start → attach streams)
│       ├── Cancellation (where supported by orchestrator)
│       └── On success → Active session workspace (opaque route per § ZTA)
│
├── 3. Active session (main workspace)
│       ├── Persistent session posture header (live, TTL, alert summary)
│       ├── Split: Live console | Telemetry dashboard
│       ├── Proxied web view panel (sandboxed iframe)
│       └── Destructive: Kill session
│
├── 4. Session history (list)
│       ├── Paginated/filtered list of **this operator’s** past sessions (metadata only)
│       ├── Row actions: open read-only summary / audit (Phase 2 scope note) or “new session from template” (if product adds)
│       └── No cross-user listings
│
└── 5. Error / FAILED
        ├── Terminal failure states (build fail, policy violation, quota, crash)
        ├── Clear remediation (“retry”, “contact admin”, error reference id)
        └── Never exposes internal stack traces to unprivileged operators in production builds
```

### A.2 Primary navigation model

| Context | Navigation |
|---------|-------------|
| Unauthenticated | Landing only + sign-in/up (if IAM present in Phase 2). |
| Session starting | Automatic transition **Loading → Active**; back navigation **discouraged** mid-provision (confirm dialog). |
| Active session | **No competitor navigation** except **History** and **global Home** / **logout**; **KILL** is destructive confirm. |

### A.3 Security-first information priority (content hierarchy)

1. **Session posture** — LIVE / draining / expired; countdown; aggregate alert severity.  
2. **IDS / policy alerts** — human-readable, actionable.  
3. **Process tree** — anomaly highlights (unexpected child, privilege change).  
4. **Network timeline** — recent egress, denied attempts (where available).  
5. **Console** — full fidelity for power users **without** starving (2)–(4) of viewport.  
6. **Proxied app** — **lowest trust** visually bracketed (“untrusted sandbox content”) **below** telemetry.

---

## B. Active Session View — ASCII Wireframe

Layout is **desktop-first** (≥1280px); responsive rules: stack **telemetry above** proxied iframe on narrow widths; console **collapsible** drawer on small breakpoints (Phase 2 responsive spec references this).

```text
┌─────────────────────────────────────────────────────────────────────┐
│  dasDocker  │  Session: abc123  │  🔴 LIVE  │  ⏱ 14:32 remaining  │
├──────────────────────────┬──────────────────────────────────────────┤
│                          │                                          │
│   LIVE CONSOLE           │   TELEMETRY DASHBOARD                    │
│   (xterm.js terminal)    │   ┌─────────────────────────────────┐   │
│                          │   │ PROCESS TREE                    │   │
│   $ npm install          │   │ ▼ node (pid:1)                  │   │
│   > express@4.18.2       │   │   ▼ npm (pid:47)                │   │
│   > installing...        │   │     └─ sh (pid:89) ⚠️            │   │
│                          │   └─────────────────────────────────┘   │
│                          │   ┌─────────────────────────────────┐   │
│                          │   │ NETWORK TRAFFIC TIMELINE        │   │
│                          │   │ 14:31 DNS → registry.npmjs.org  │   │
│                          │   │ 14:31 TCP → 104.20.x.x:443      │   │
│                          │   └─────────────────────────────────┘   │
│                          │   ┌─────────────────────────────────┐   │
│                          │   │ IDS ALERTS                      │   │
│                          │   │ ⚠️ WARN: Unexpected subprocess  │   │
│                          │   └─────────────────────────────────┘   │
├──────────────────────────┴──────────────────────────────────────────┤
│  PROXIED WEB VIEW (iframe — sandboxed, CSP enforced)                │
│  http://sandbox → proxied → [App running on :3000]                  │
└─────────────────────────────────────────────────────────────────────┘
                        [ 🔴 KILL SESSION ]
```

**Notes for implementers**

- **“Session: abc123”** in the wireframe is a **display handle** only; real UI **must** show a **truncated opaque id** or **non-enumerable label** and **must not** mirror a guessable URL parameter (see ZTA table).  
- Icons (🔴 ⏱ ⚠️) are **stand-ins**; production uses **`StatusBadge`**, **`CountdownTimer`**, and severity tokens from §C.  
- **KILL SESSION** is **full-width** on mobile; **destructive** styling; **two-step** or typed confirm in Phase 2 per STRIDE.

---

## C. Design System Token Specification

### C.1 Colour palette (semantic CSS custom properties)

All components **must** reference **semantic** tokens only in application code; raw hex values live in a single theme layer.

| Token | Role | Example value (dark theme baseline) |
|-------|------|-------------------------------------|
| `--color-danger` | Destructive actions, critical alerts, **KILL** | `#F14B4B` |
| `--color-warning` | WARN IDS, suspicious process highlight | `#F5A524` |
| `--color-success` | Healthy state, allowed policy outcome | `#12B76A` |
| `--color-surface` | App background | `#0B0F14` |
| `--color-surface-raised` | Cards, panels, iframe chrome | `#121826` |
| `--color-border-subtle` | Dividers | `#243044` |
| `--color-text-primary` | Primary copy | `#E6EAF2` |
| `--color-text-muted` | Secondary / timestamps | `#8B95A8` |
| `--color-accent` | Focus rings, links (non-destructive) | `#6C8CFF` |
| `--color-live` | “Session live” pulse / badge | `#F14B4B` or distinct `#FF5C5C` (document in theme; must meet contrast on surface) |

**WCAG:** Text on surfaces **must** meet **4.5:1** for normal text, **3:1** for large text (18px+ or 14px+ bold). **Danger/warning** on `--color-surface-raised` need verified contrast for **badge + label** pairs.

### C.2 Typography scale

| Role | Font | Size | Weight | Line height | Usage |
|------|------|------|--------|-------------|--------|
| **Heading / page title** | `Inter`, system-ui fallback | 20px / 1.25rem | 600 | 1.3 | Top bar product name, page headers |
| **Subheading / panel title** | `Inter` | 14px / 0.875rem | 600 | 1.35 | PROCESS TREE, IDS ALERTS |
| **Body** | `Inter` | 14px | 400 | 1.5 | Descriptions, empty states |
| **Label / metadata** | `Inter` | 12px | 500 | 1.4 | Timestamps, table headers |
| **Console monospace** | `JetBrains Mono`, `ui-monospace` | 13px | 400 | 1.45 | xterm.js / `ConsolePanel` |
| **Code / IDS detail** | `JetBrains Mono` | 12px | 400 | 1.45 | Raw alert detail drawers |

**Rules:** Minimum **14px body** unless WCAG-large-text exception; **never** rely on colour alone for alert severity (pair with icon + text).

### C.3 Spacing scale — 4px base grid

| Token | Value |
|-------|-------|
| `--space-1` | 4px |
| `--space-2` | 8px |
| `--space-3` | 12px |
| `--space-4` | 16px |
| `--space-5` | 24px |
| `--space-6` | 32px |
| `--space-7` | 40px |

Component padding/radii **snap** to multiples of **4px**. Recommended **card padding:** `--space-4`; **panel gap:** `--space-3`.

### C.4 Component library (Phase 2 build list)

1. `Button`  
2. `StatusBadge`  
3. `CountdownTimer`  
4. `AlertFeed`  
5. `ProcessTree`  
6. `NetworkTimeline`  
7. `ConsolePanel`  
8. `ProxiedWebView`

---

## D. Component Specification

**Convention:** Each component lists **props**, **states**, **accessibility (WCAG 2.1 AA minimum)**, **Agent 20 interaction test cases**, and **owning implementer** (Agents **15** / **16** / **17**).

---

### D.1 `Button`

| Field | Detail |
|-------|--------|
| **Owner** | Agent **15** |
| **Props** | `variant`: `"primary" \| "secondary" \| "ghost" \| "destructive"`; `size`: `"sm" \| "md" \| "lg"`; `disabled`: boolean; `loading`: boolean; `type`: `"button" \| "submit"`; `onClick`; `children`; optional `iconStart` / `iconEnd`; `ariaLabel` when text insufficient. |
| **States** | default, hover, focus-visible, active, disabled, loading (spinner + `aria-busy="true"`). |
| **Accessibility** | Native `<button>`; focus ring **visible** (`:focus-visible`, min **2px** contrast **3:1** against adjacent colours); **disabled** exposed in a11y tree; destructive actions **not** sole reliance on colour; `Space`/`Enter` activation. |
| **Agent 20 — interaction tests** | Keyboard focus lands on button; activates on Enter/Space; `disabled` prevents activation and hover pointer; loading state blocks double-submit; destructive variant opens confirmation when wired (integration test parent). |

---

### D.2 `StatusBadge`

| Field | Detail |
|---------|--------|
| **Owner** | Agent **15** |
| **Props** | `status`: `"live" \| "provisioning" \| "draining" \| "expired" \| "failed"`; `alertLevel`: `"none" \| "info" \| "warn" \| "critical"` optional overlay; `compact`: boolean; optional `label` override. |
| **States** | default; **live** may use polite `aria-live` summary when status changes (see below). |
| **Accessibility** | Role `status` **or** `img` + `aria-label` with full text (**“Session live”**, **“Session ended”**); colour + icon + text; **avoid** seizure-inducing flashing (if pulse animation: `prefers-reduced-motion` → static). |
| **Agent 20 — interaction tests** | SR announces status change when `live` → `expired`; labels readable at 200% zoom; motion reduced OS disables pulse. |

---

### D.3 `CountdownTimer`

| Field | Detail |
|---------|--------|
| **Owner** | Agent **15** |
| **Props** | `endsAt`: ISO-8601 / epoch ms; `onExpire` callback; `ariaCriticalThresholdSec` optional (e.g. 60s); `showSeconds`: boolean. |
| **States** | running; **critical** (low time); expired (shows **00:00** + `expired` state); clock skew handling **documented** (trust server tick). |
| **Accessibility** | Expose as `role="timer"` with **`aria-live="polite"`** updates at **sane intervals** (e.g. every 60s, or every 10s in critical — avoid per-second spam); include **visible** remaining time; provide **textual** relative summary. |
| **Agent 20 — interaction tests** | Announcement occurs on crossing critical threshold; at expiry, session posture region updates coherently with `StatusBadge`; tab order does not trap. |

---

### D.4 `AlertFeed`

| Field | Detail |
|---------|--------|
| **Owner** | Agent **17** |
| **Props** | `alerts`: array of `{ id, ts, severity, title, detail?, ruleId? }`; `maxVisible`; `onSelectAlert`; `dense`: boolean; `pollIntervalMs?` **(prefer SSE/WebSocket — push primary)**. |
| **States** | empty (“No IDS alerts”), loading skeleton, populated, **error** (stream disconnected with retry). |
| **Accessibility** | Landmark `region` + `aria-label="IDS alerts"`; list `role="log"` **or** `role="feed"` + roving tabindex for rows; severity **icon + text**; keyboard navigation **↑↓** between items; Escape closes detail drawer if open. |
| **Agent 20 — interaction tests** | New alert appears and is announced appropriately (`aria-live` policy verified); keyboard user can traverse and open detail; empty and error states have focusable retry when applicable; no horizontal scroll at 320px unless intentional carousel. |

---

### D.5 `ProcessTree`

| Field | Detail |
|---------|--------|
| **Owner** | Agent **16** |
| **Props** | `nodes`: tree `{ pid, ppid?, cmd, argv?, flagged?: boolean }[]`; `onNodeFocus`; `expandDepth` default; highlight rules from backend **flag** IDs. |
| **States** | empty, loading, populated; node **flagged** uses `--color-warning` + icon; virtualization for large trees (Phase 2). |
| **Accessibility** | `role="tree"`; `aria-expanded` per group; **`aria-selected`** for focused node; type-ahead optional; SR reads **pid + command + flag state** in one concise string. |
| **Agent 20 — interaction tests** | Expand/collapse via Arrow keys per WAI-ARIA tree pattern; flagged node discoverable via SR; focus visible on keyboard nav; performance smoke with **deep** mocked tree remains operable (arrow nav within time budget — set NFR in Phase 2). |

---

### D.6 `NetworkTimeline`

| Field | Detail |
|---------|--------|
| **Owner** | Agent **16** |
| **Props** | `events`: `{ id, ts, proto, summary, outcome: "allowed" \| "denied", dest }[]`; `onSelect`; timezone display. |
| **States** | empty, loading, live tail, error; **denied** rows distinct by **icon + text + pattern** (not colour alone). |
| **Accessibility** | `role="list"` or table with **column headers**; each row **one line summary** + expandable detail; **readable timestamps** (localised). |
| **Agent 20 — interaction tests** | Screen reader can list recent events; denied events perceivable without colour; selection returns focus to list on drawer close; scroll region has keyboard access. |

---

### D.7 `ConsolePanel`

| Field | Detail |
|---------|--------|
| **Owner** | Agent **16** |
| **Props** | `sessionRef` (opaque); `wsUrl` (from orchestrator, **not** user-composed); `fontScale`; `readOnly` default **false** if PTY interactive. |
| **States** | connecting, connected, reconnecting, **disconnected** (with reason), **paste warning** (if product enables paste-to-PTY). |
| **Accessibility** | xterm **must** expose **terminal container** with **label** (`aria-label="Sandbox console"`); focus enters terminal **documented**; screen reader **limitations** of terminal emulators mitigated by **optional “plain log”** side channel (Phase 2 toggle) — **minimum:** focus ring on wrapper, keyboard trap **avoided** (Escape returns focus to page — define behaviour). |
| **Agent 20 — interaction tests** | Focus can move into and out of terminal; connection states reflected in text for assistive tech; no uncaught focus trap; **reduced motion** does not break cursor blink policy. |

---

### D.8 `ProxiedWebView`

| Field | Detail |
|---------|--------|
| **Owner** | Agent **17** |
| **Props** | `src` (HTTPS **proxy URL** on **dedicated origin**); `title` for `aria-label`; optional `allowedMime` note; `onLoadError`. |
| **States** | loading spinner in chrome, ready, error (XSS/CSP/nav blocked messaging **generic**). |
| **Accessibility** | `iframe` with **`title="Sandbox application preview"`** (or localized); **`sandbox`** attribute **required** — minimum: **omit** `allow-same-origin` **unless** required; **never** combine unsafe pairs; block `allow-top-navigation-by-user-activation` except if explicitly approved; surrounding **banner** warns “Untrusted sandbox content”. Parent page **referrer-policy** restrictive. |
| **Agent 20 — interaction tests** | Iframe exposes name/title to SR; sandbox attribute present in DOM snapshot; keyboard focus **does not** leak cookies to child (automated security suite **separate** from a11y); error state readable and focusable **Back to dashboard** fallback. |

**ZTA remediation:** Proxied origin **≠** operator UI origin; HttpOnly cookies on operator domain inaccessible from sandbox; **no** `document.domain` hacks.

---

## E. Cross-Cutting Accessibility & Testing (**Rule 2**)

### E.1 Global WCAG 2.1 AA checklist (applies to all views)

| Criterion | Application |
|-----------|--------------|
| **1.4.3 Contrast (minimum)** | All text/UI components per §C.1 verification matrix. |
| **2.1.1 Keyboard** | Full functionality without mouse except **where impossible** (e.g. PTY quirks mitigated per `ConsolePanel`). |
| **2.4.3 Focus order** | Header posture → primary workspace → proxied iframe chrome → destructive footer. |
| **2.4.7 Focus visible** | Matches tokenised focus ring. |
| **4.1.2 Name, Role, Value** | All interactive widgets; tree/list/log regions as specified. |
| **Timing adjustable** | Countdown communicates expiry; sessions may allow **grace** requests server-side — UI does not shorten silently. |

### E.2 Agent 20 mandatory suite (summarised)

1. **Landing / Submit** — validate labels, errors, ZIP/GitHub mutual exclusivity rules, keyboard submit.  
2. **Provisioning** — progress `%` or steps exposed to SR; cancellation path.  
3. **Active session** — posture region **programmatic landmark** (`header`/`region` labelled “Session overview”).  
4. **History** — list semantics; **no session id sniffing via URL**.  
5. **FAILED view** — error reference + retry; focus management on route transition.  

Automated tooling: axe-core in CI; manual **NVDA/VoiceOver** sweep each release candidate.

---

## F. Ownership Matrix — Frontend Agents

| Agent | Responsibility |
|-------|----------------|
| **15** | Shell & global patterns: typography/spacing tokens, navigation pages (Landing, Loading, History shell, FAILED), **`Button`**, **`StatusBadge`**, **`CountdownTimer`**, top bar layout integration. |
| **16** | Real-time workspaces: **`ConsolePanel`**, **`ProcessTree`**, **`NetworkTimeline`**, split-pane layout wiring. |
| **17** | Trust-boundary UI: **`ProxiedWebView`**, **`AlertFeed`**, isolation/CSP coordination hooks, **KILL** confirm wiring with Agent 15. |

---

## G. References

- `dasdocker/docs/security/STRIDE-threat-model.md` — especially spoofing/tampering/information disclosure for **UI ↔ sandbox** boundaries.  
- `dasdocker/docs/architecture/network-isolation-spec.md` — telemetry and IDS assumptions.  

---

**End of Phase 1 UI/UX specification** — Deliverable **1.7** (Agent 14).
