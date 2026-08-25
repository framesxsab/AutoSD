# RESEARCHER — ROUND 3 (defend / refine / concede)

## vs Pragmatist — REFINE (partial concede)
Concede: CDC/versioning/freshness as *built infrastructure* contradicts weeks-not-months. Refine: gap #5 splits into **schema-now, pipeline-later**. v0.1 = one frozen corpus snapshot with provenance fields on every chunk (source URL, capture date, publisher authority tier, doc version string). That's an afternoon of scripting, not a sync subsystem. It preserves the differentiator that matters at v0.1 — every citation carries a checkable date/version — while CDC incremental sync, freshness scoring, and deprecation flags move to v0.2, gated on user pull.

On RRF: my own report's rollout checklist already answers this — "build ~100-item golden set first; baseline BM25-only (often sufficient on technical text); add dense+RRF after." BM25 degrades gracefully on small corpora; dense retrieval is what needs scale. So v0.1 retrieval = BM25 + metadata pre-filters. RRF was always stage 3; I wrongly presented the end-state as the plan. Presentation error, not substance error.

## vs Architect — CONCEDE chunk→IR vagueness; here is the spec
Chunks never map to IR elements directly — that would be copy-paste architecture. Pipeline: requirements → LLM-drafted design → deterministic validation (Structurizr DSL parse + typed-relation checks, gap #7) → artifacts where retrieved evidence attaches as **justification edges**: element → ADR → cited chunk(s) → traceability row (req → element). Retrieval constrains and cites decisions; it does not instantiate components. CDC+versioning: same split as above — `source_version` is a schema field from day one (free); sync machinery deferred. RRF: see Pragmatist.

## vs Strategist — CONCEDE over-claim; reposition
Two concessions. (1) "Empty intersection" holds only for **public OSS scaffolds**; I did not survey commercial SaaS (Eraser AI, IcePanel, LeanIX copilots, etc.). Corrected claim: no *public, inspectable, self-hostable* implementation does grounded + validated + traceable bundles. For an OSS deliverable that's the relevant class — auditability is the product — but I will stop saying "nobody." (2) Gaps #6–7 demoted from headline claims to **mechanisms**. ADR synthesis isn't something anyone buys; it's what makes output reviewable — a diagram without decision rationale is unverifiable boxes-and-prose. DSL validation isn't engineering elegance; it's the cheapest deterministic gate against the empirically dominant failure mode (R2ABench: edge hallucination #1). Headline claims shrink to #1–#5; #6–7 become implementation details of #2/#4.

## v0.1 vs deferred
- **v0.1:** #1 grounding (BM25-only, citations mandatory); #2 bundle emission (C4/Structurizr + arc42 + MADR, schema-validated); #4 traceability matrix; #7 as validator; #3 partial (deterministic structural checks + judge panel with order-swapping and length control; human calibration set n≈50).
- **Deferred v0.2+:** #5 full (CDC, freshness scoring, conflict resolution); hybrid+rerank; GraphRAG-style thematic queries; benchmark publication.

## Minimum corpus proving value
Three sources, one snapshot: AWS Well-Architected (6 pillars), Azure Architecture Center decision guides + cloud design patterns, C4/Structurizr/arc42/MADR documentation. Order ~1–3k chunks. Value proof is NOT recall numbers; it is: on ~30 seeded requirement→design cases, (a) ≥80% of generated components carry valid citations; (b) grounded-vs-parametric ablation shows measurable difference in constraint compliance (e.g., picks managed queue over hand-rolled, citing the page); (c) zero invalid typed relations survive validation. If grounding changes no decisions across 30 cases, the thesis dies cheaply — that is precisely the experiment v0.1 runs.

## Net revision
7 claims → 5 headline + 2 mechanisms. Corpus plan downgraded from subsystem to snapshot + schema. Retrieval staged per my own checklist. The intersection is smaller than advertised — and still empty exactly where we're standing.
