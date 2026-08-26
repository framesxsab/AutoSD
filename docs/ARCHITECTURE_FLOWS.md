# Architecture Flows

Concise flow diagrams for the five paths contributors ask about most. Every diagram is traceable to the cited files at the v1.0.0 tree (plus the documented post-v1.0 additions). For layer overview see [ARCHITECTURE.md](ARCHITECTURE.md); for claim statuses see [CAPABILITY_MATRIX.md](CAPABILITY_MATRIX.md).

## 1. Application flow

Boot → config → workspace → router. Source: `src/main.ts`, `src/app/bootstrap.ts`, `src/app/router.ts`, `src/app/Workspace.ts`, `src/app/views/*`.

```mermaid
flowchart TD
  M["main.ts mounts #app"] --> B["bootstrapApp()"]
  B --> C["config.ts: read + validate VITE_ env<br/>(invalid values fall back, secrets warn)"]
  B --> W["ResearchWorkflow (DI provider or MockEmbeddingProvider)"]
  B --> DM["DeviceManager + default devices registered"]
  B --> R["AppRouter: nine hash routes, lazy views"]
  R -->|"#/home"| ONB["OnboardingStore flag → Onboarding or Home"]
  R -->|"#/workspace"| WV["WorkspaceView → Workspace facade"]
  R -->|"#/research" and "#/sessions" and "#/devices" and "#/demo"| LV["Lazy-loaded views"]
  W --> WV
  DM --> DV["DevicesView render controls"]
```

## 2. Research / retrieval flow

One query through the hybrid pipeline. Source: `src/workflows/research.ts` (`run()`), `src/retrieval/pipeline.ts`, `bm25.ts`, `embedder.ts`, `snapshot.ts`.

```mermaid
sequenceDiagram
  participant U as Caller (UI/plugin)
  participant RW as ResearchWorkflow
  participant SI as SnapshotIndex
  participant RP as RetrievalPipeline
  participant BM as BM25Index
  participant EP as EmbeddingProvider

  U->>RW: run({ id, question })
  RW->>RP: search(question, topK=5)
  par lexical
    RP->>BM: score query terms
  and vector
    RP->>EP: embed(question)
    RP->>RP: cosine over chunk vectors
  end
  RP->>RP: RRF fuse (k=60) · optional reranker
  RP-->>RW: ranked chunks with scores
  RW-->>U: answer · citations[] · confidence (clamped score)
  RW->>RW: persist session (cap 100, sorted by createdAt)
```

Ingestion side (`ingest()`): documents are hashed against the snapshot manifest — unchanged docs are never re-embedded; added/changed docs are chunked and embedded into the pipeline; removed docs are dropped from the pipeline.

## 3. Plugin / device flow

Registration, dispatch, and hot-swap across both seams. Source: `src/plugins/PluginHost.ts`, `PluginRegistry.ts`, `types.ts`; `src/core/DeviceManager.ts`, `Registry.ts`; walkthrough example `src/examples/MinimalTactilePlugin.ts`.

```mermaid
sequenceDiagram
  participant Dev as Developer code
  participant H as PluginHost
  participant PR as PluginRegistry
  participant P as Plugin
  participant DMR as DeviceManager

  Dev->>DMR: register(deviceImpl)
  DMR-->>Dev: deviceAdded event (auto-setActive if first)
  Dev->>H: registry.register(plugin) → state "registered"
  Dev->>PR: activate(id)
  PR->>P: activate(ctx)
  P->>H: ctx.api.registerWorkflow(id, handler)
  PR-->>Dev: state "active"
  Dev->>H: runWorkflow(id, payload)
  H-->>Dev: handler(payload) result
  Dev->>PR: hotSwap(next)
  PR->>P: deactivate() (best effort)
  PR->>PR: replace entry · activate(next)
  Note over DMR: devices swap via DeviceManager.hotSwap(id, next)<br/>preserving listeners through Registry swap events
```

Device render isolation: `broadcast()` renders to every registered device; a per-device failure records a `DeviceErrorEvent` and never aborts the loop. `trySetActive()` is the non-throwing variant of `setActive()`.

## 4. Persistence flow

Plain JSON under `corpus/`; atomic writes everywhere. Source: `src/retrieval/persistence.ts`, `src/workflows/research.ts` (`saveToDisk`/`loadFromDisk`), `src/retrieval/snapshot.ts`.

```mermaid
flowchart LR
  subgraph Runtime
    WF["ResearchWorkflow<br/>history + documents"] --> SI["SnapshotIndex manifest"]
  end
  SI -->|"saveManifest (atomic tmp+rename)"| IJ["corpus/index.json"]
  WF -->|"sessions JSON (atomic tmp+rename)"| SJ["corpus/sessions.json"]
  IJ -->|"loadFromDisk(): rebuild docs + re-ingest pipeline"| WF
  SJ -->|"validate entries · cap 100 · sort by createdAt"| WF
  CD["corpus/docs/*.md txt json"] -.->|watched by LiveSync| WF
```

Guarantees: every write goes through `atomicWrite` (temp file + rename); loads are defensive (`safeJsonParse`, shape guards); sessions never exceed `MAX_SESSIONS = 100`. There is no database and no backend — state is inspectable plain JSON.

## 5. Live synchronization flow

File watching → incremental ingest → persisted index → UI status. Source: `src/app/LiveSync.ts`, `src/retrieval/CorpusWatcher.ts`.

```mermaid
stateDiagram-v2
  [*] --> Idle : liveSync.start()
  Idle --> Indexing : watcher event (added/modified/deleted, 150 ms debounce)
  Indexing --> Updated : ingest(docs) + saveToDisk() succeeded
  Indexing --> Error : ingest/save threw → onError listeners notified
  Updated --> Idle : after 1200 ms
  Error --> Idle : after 2000 ms (recover via rescan())
```

Details that matter:

- A cycle in flight sets `pending`; further events coalesce until it finishes.
- Deletions trigger a clear + re-ingest of remaining documents (simple and correct; not yet optimized).
- Status changes drive the accessible badge (`role="status"`) and a polite live-region announcement.
- Supported file types: `.md`, `.txt`, `.json`.
