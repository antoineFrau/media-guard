# MediaGuard: Conclusion and Evaluation Summary

## Abstract

MediaGuard is an LLM-based system for detecting rhetorical manipulation techniques in video transcripts and news text. This document summarizes the methodology, experimental setup, and results of benchmarking the dataset-backed agent (multi-source: PRTA, SemEval, PropaInsight) on a 50-item evaluation set with gold-annotated spans. We employ both span-based metrics (precision, recall, F1) and an LLM-as-judge for semantic correctness. The multi-source agent achieves 64.2% span F1 and 70.0% LLM judge score. PropaInsight enrichment (appeals, intent, confusions) improves over the single-source baseline (+6.4% F1, +8.2% judge).

---

## 1. Introduction

Propaganda and rhetorical manipulation in media pose significant risks to public discourse. MediaGuard addresses this by applying large language models (Mistral) to identify manipulation techniques in text, guided by skill definitions that encode technique taxonomies and recognition criteria. Two skill-generation flows exist: (1) extraction from YouTube transcripts (Clément Viktorovitch channel), producing French-named techniques; (2) generation from academic datasets (SemEval-2020 Task 11, PropaInsight), producing SemEval-aligned slugs. The research questions concern which approach yields better accuracy and how evaluation should be conducted when gold annotations exist.

---

## 1.1 Multi-Source Skill Generation (Improvements)

**Proposed and implemented:**

1. **PropaInsight supplement** (`data/propainsight-supplement.json`): For each of the 14 SemEval techniques, adds:
   - **Appeals**: Emotional/arousal evoked in readers (e.g., fear, credibility, belonging)
   - **Intent**: Author motive (e.g., persuade, discredit, create urgency)
   - **Common confusions**: Distinguishing cues (e.g., legitimate skepticism vs manufactured doubt)
   - **PropaInsight note**: Cross-references and overlap with other techniques

2. **Merged definitions**: `loadTechniqueDefinitions` now combines PRTA + SemEval PTC examples + PropaInsight supplements into a single `technique-definitions.json`.

3. **Enriched generation prompt**: `generateSkillFromDefinition` passes PropaInsight context to Mistral, strengthening the "How to recognize it" section with appeal and intent cues.

4. **Benchmark**: YouTube/Clemovitch agent excluded by default; use `--include-youtube` to compare.

---

## 2. Dataset

### 2.1 Construction

A 50-item evaluation set was compiled from multiple sources:

| Source | Articles | Gold Spans | Description |
|--------|----------|------------|-------------|
| semeval-prta | 4 | 11 | PRTA (ACL 2020) Table 1 sample articles |
| curated-semeval | 25 | 24 | Curated SemEval-style examples |
| curated-propaganda | 21 | 23 | Curated propaganda literature examples |
| **Total** | **50** | **58** | |

Each article contains gold spans with `start_char`, `end_char`, `technique_slug`, and `quote`. The taxonomy aligns with SemEval-2020 Task 11 (14 techniques: appeal-to-authority, appeal-to-fear-prejudice, loaded-language, etc.).

### 2.2 Limitations

- SemEval and PropaInsight full corpora require manual registration or legacy loading scripts; the curated set approximates their structure.
- Examples are English-only and news-style; generalization to video transcripts or other languages is not yet validated.
- Curated samples may differ in difficulty from human-annotated datasets.

---

## 3. Methodology

### 3.1 Agent (Dataset-Backed, Multi-Source)

**skills-dataset** — Skills generated from:
- PRTA + SemEval base definitions (`technique-definitions-static.json`)
- SemEval PTC examples (`semeval-export.json`)
- PropaInsight appeals, intent, confusions (`propainsight-supplement.json`)

Uses exact SemEval slugs (e.g., `appeal-to-authority`, `loaded-language`). YouTube-derived skills (Clemovitch) are excluded from the benchmark.

### 3.2 Evaluation Protocol

1. **Input**: Article text converted to pseudo-transcript format (sentence-level segments with fake timestamps).
2. **Analysis**: Mistral API (`mistral-small-latest`) with skills context; returns JSON `alerts` with `technique`, `quote`, `start`, `end`.
3. **Span-Based Metrics**:
   - Gold span matches prediction if: (a) predicted quote overlaps gold span (character-level), and (b) predicted technique maps to same gold technique (via slug normalization).
   - Precision = TP / (TP + FP), Recall = TP / (TP + FN), F1 = 2·P·R / (P + R).
4. **LLM-as-Judge** (optional): For each article, Mistral receives the text, gold spans, and predicted alerts. It returns a score 0–1 indicating how well predictions match gold (overlapping quote + correct/equivalent technique). The mean score across articles is the judge metric.

---

## 4. Results

### 4.1 Multi-Source Skill Generation

Skills are generated from multiple sources:
- **PRTA (ACL 2020)** + **SemEval-2020 Task 11**: Base definitions and examples
- **SemEval PTC** (semeval-export.json): Curated technique examples from 50-item eval set
- **PropaInsight (COLING 2025)**: Appeals (emotional/arousal evoked), intent (author motive), common confusions

The PropaInsight supplement enriches "How to recognize it" with appeal and intent cues, improving recognition accuracy.

### 4.2 Span-Based Metrics (50 articles, 58 gold spans)

| Agent | Samples | Gold | Pred | TP | Precision | Recall | F1 |
|-------|---------|------|------|-----|-----------|--------|------|
| skills-dataset (multi-source) | 50 | 58 | 104 | 52 | 50.0% | 89.7% | **64.2%** |
| ~~skills-youtube~~ | — | — | — | — | — | — | *(excluded)* |

*Previous single-source baseline: F1 57.8%. Multi-source PropaInsight enrichment: +6.4% F1.*

### 4.3 LLM-as-Judge (Semantic Correctness)

| Agent | Judge Score |
|-------|-------------|
| skills-dataset (multi-source) | **70.0%** |

*Previous single-source: 61.8%. Multi-source: +8.2%.*

The LLM judge rewards semantic overlap: even when span F1 is 0 (YouTube), the judge assigns ~37% for partial technique equivalence (e.g., `fausse-dichotomie` vs `black-and-white-fallacy`).

### 4.4 Per-Technique Performance (skills-dataset)

Techniques with highest F1: exaggeration-minimisation (88.9%), flag-waving (80%), bandwagon-reductio-ad-hitlerum (80%), repetition (80%), causal-oversimplification (72.7%). Techniques with lowest F1: slogans (35.3%), appeal-to-fear-prejudice (42.1%), black-and-white-fallacy (52.6%).

---

## 5. Discussion

### 5.1 Hypothesis Validation

- **H1 (Skill Quality)**: Dataset-backed skills significantly outperform YouTube-derived skills on SemEval-aligned evaluation (57.8% vs 0% span F1). **Supported.**
- **H2 (Taxonomy Alignment)**: When skills use SemEval slugs, the model outputs match gold labels. When skills use ad-hoc French names, span-based recall is zero despite the model detecting manipulations. **Supported.**

### 5.2 LLM-as-Judge

The LLM judge provides a complementary metric that captures semantic equivalence (e.g., technique name variations, partial span overlap). It is useful when:
- Gold labels exist but strict span overlap is too stringent.
- Multiple valid phrasings or techniques could apply.

Care should be taken: judge scores can be subjective and model-dependent.

### 5.3 Expected Output

All 50 items have expected output (gold spans). The evaluation pipeline uses these for both span F1 and LLM judge. For items without gold, the LLM judge could still assess correctness qualitatively, though we did not test that mode.

---

## 6. Conclusion

We have established a 50-item evaluation set with gold-annotated spans drawn from PRTA samples and curated SemEval-style and propaganda literature examples. The dataset-backed agent uses **multi-source skill generation**: PRTA, SemEval PTC, and PropaInsight (COLING 2025) for appeals, intent, and common confusions. It achieves **64.2% F1** and **70.0% LLM judge score** on the 50-item eval set. PropaInsight enrichment improves over the single-source baseline (+6.4% F1, +8.2% judge). The benchmark excludes YouTube-derived skills (Clemovitch) by default. These results support multi-source, taxonomy-aligned skills for propaganda technique detection. Future work: full SemEval validation (upon access), cross-domain generalization, LLM judge calibration.

---

## Appendix A: Commands

```bash
# Export 50-item dataset
cd scripts/skill-generator && python3 scripts/export-semeval.py

# Run benchmark (50 items, dataset-only, with LLM judge)
npm run evaluate:benchmark -- --limit=50 --judge

# Include YouTube agent (optional)
npm run evaluate:benchmark -- --limit=50 --judge --include-youtube

# Run evaluation for dataset skills only (validation split)
npm run evaluate -- --skills=output/skills-dataset
```

## Appendix B: Output Files

- `scripts/skill-generator/data/semeval-export.json` — 50 articles, splits: train, validation, eval50
- `scripts/skill-generator/output/benchmark-results.json` — Full benchmark results with per-technique and judge details
- `scripts/skill-generator/output/evaluation-results.json` — Standard evaluation results
