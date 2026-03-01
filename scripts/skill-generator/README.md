# Skill Generator

Extracts manipulation techniques from Clément Viktorovitch's YouTube channel or from academic datasets (SemEval, PropaInsight), backs them with scientific research, and generates Cursor SKILL.md files.

## Two Flows

### 1. YouTube flow (original)

1. **YouTube** — Fetch last N videos from @Clemovitch and their transcripts (youtubei.js)
2. **Mistral** — Extract manipulation techniques (rhetoric, bias, framing, etc.)
3. **Semantic Scholar** — Search for supporting papers per technique
4. **Mistral** — Generate SKILL.md for each technique with examples and citations
5. **Output** — `output/problems.json` and `output/skills/{slug}/SKILL.md`

### 2. Dataset flow (SemEval/PTC)

1. **Definitions** — Load technique definitions from `data/technique-definitions-static.json` + optional `data/semeval-export.json`
2. **Mistral** — Generate SKILL.md for each technique with dataset examples
3. **Output** — `output/skills-dataset/{slug}/SKILL.md`

## Setup

```bash
cp .env.example .env
```

Edit `.env` and set `MISTRAL_API_KEY` (required). Optionally add `S2_API_KEY` for higher Semantic Scholar rate limits.

For the dataset flow, export SemEval samples (optional):

```bash
python scripts/export-semeval.py   # Creates data/semeval-export.json (sample set)
```

## Usage

```bash
npm install

# YouTube flow
npm run generate           # Last 10 videos (default)
npm run generate -- --last=5   # Custom count

# Dataset flow
npm run definitions        # Build technique-definitions.json
npm run generate:datasets  # Generate skills from SemEval/PTC definitions

# Evaluation
npm run evaluate                    # Eval with dataset skills (default)
npm run evaluate -- --skills=output/skills   # Eval with YouTube skills
```

## Output

- **output/problems.json** — Database of YouTube techniques
- **output/skills/{slug}/SKILL.md** — Skills from YouTube flow
- **output/skills-dataset/{slug}/SKILL.md** — Skills from dataset flow (SemEval taxonomy)
- **output/technique-definitions.json** — Unified technique registry
- **output/evaluation-results.json** — Precision, recall, F1 per technique

## Evaluation

The evaluator runs the Mistral analyzer on SemEval validation samples and computes metrics. See `docs/HYPOTHESES.md` for research questions and results.

## Dependencies

- youtubei.js — Channel and transcript fetching
- @mistralai/mistralai — Technique extraction and SKILL generation
- Semantic Scholar REST API — Paper search (no extra deps)
