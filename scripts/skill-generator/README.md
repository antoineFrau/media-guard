# Skill Generator

Extracts manipulation techniques from Clément Viktorovitch's YouTube channel or from academic datasets (SemEval, PropaInsight), backs them with scientific research, and generates Cursor SKILL.md files.

## Two Flows

### 1. YouTube flow (original)

1. **YouTube** — Fetch last N videos from @Clemovitch and their transcripts (youtubei.js)
2. **Mistral** — Extract manipulation techniques (rhetoric, bias, framing, etc.)
3. **Semantic Scholar** — Search for supporting papers per technique
4. **Mistral** — Generate SKILL.md for each technique with examples and citations
5. **Output** — `output/problems.json` and `output/skills/{slug}/SKILL.md`

### 2. Dataset flow (multi-source: SemEval + PropaInsight)

1. **Definitions** — Load technique definitions from:
   - `data/technique-definitions-static.json` (PRTA, SemEval base)
   - `data/semeval-export.json` (curated examples)
   - `data/propainsight-supplement.json` (appeals, intent, confusions)
2. **Mistral** — Generate SKILL.md for each technique with multi-source context
3. **Output** — `output/skills-dataset/{slug}/SKILL.md`

## Setup

```bash
cp .env.example .env
```

Edit `.env` and set `MISTRAL_API_KEY` (required). Optionally add `S2_API_KEY` for higher Semantic Scholar rate limits.

For Langfuse benchmarking, add `LANGFUSE_SECRET_KEY` (and optionally `LANGFUSE_PUBLIC_KEY`).

For the dataset flow, export the evaluation set (required for eval/benchmark):

```bash
python scripts/export-semeval.py   # Creates data/semeval-export.json (50 items: PRTA + curated)
```

## Usage

```bash
npm install

# YouTube flow
npm run generate           # Last 10 videos (default)
npm run generate -- --last=5   # Custom count

# Dataset flow (multi-source)
npm run definitions        # Build technique-definitions.json (PRTA + SemEval + PropaInsight)
npm run generate:datasets  # Generate skills from multi-source definitions

# Evaluation
npm run evaluate                    # Eval with dataset skills (default)
npm run evaluate -- --skills=output/skills   # Eval with YouTube skills
npm run evaluate:benchmark         # Benchmark dataset agent on 50-item eval set (YouTube excluded)
npm run evaluate:benchmark -- --limit=50 --judge   # With LLM-as-judge
npm run evaluate:benchmark -- --include-youtube    # Include Clemovitch/YouTube agent

# Langfuse Benchmark
npm run benchmark:sync   # Sync semeval-export to Langfuse datasets (requires LANGFUSE_SECRET_KEY)
npm run benchmark        # Run experiment on validation dataset
```

## Output

- **output/problems.json** — Database of YouTube techniques
- **output/skills/{slug}/SKILL.md** — Skills from YouTube flow
- **output/skills-dataset/{slug}/SKILL.md** — Skills from dataset flow (SemEval taxonomy)
- **output/technique-definitions.json** — Unified technique registry
- **output/evaluation-results.json** — Precision, recall, F1 per technique
- **output/benchmark-results.json** — Comparison of dataset vs YouTube agents (50-item eval)

## Evaluation

The evaluator runs the Mistral analyzer on SemEval-style samples and computes metrics. See `docs/HYPOTHESES.md` for research questions and `docs/CONCLUSION.md` for the full 50-item benchmark and paper-style summary.

## Langfuse Benchmarking

Benchmarks run the full analysis workflow on the Langfuse dataset `media-guard/semeval-validation`:

1. **Sync dataset** — `npm run benchmark:sync` uploads `semeval-export.json` to Langfuse with input (transcript, articleText) and expected output (gold spans).
2. **Run benchmark** — `npm run benchmark` executes the experiment: task = Mistral analysis, evaluators = span F1 (precision/recall).
3. **View results** — Dataset runs, traces, and scores appear in the Langfuse UI.

## Dependencies

- youtubei.js — Channel and transcript fetching
- @mistralai/mistralai — Technique extraction and SKILL generation
- Semantic Scholar REST API — Paper search (no extra deps)
