# Skill Generator

Extracts manipulation techniques from Clément Viktorovitch's YouTube channel, backs them with scientific research, and generates Cursor SKILL.md files.

## Flow

1. **YouTube** — Fetch last N videos from @Clemovitch and their transcripts (youtubei.js)
2. **Mistral** — Extract manipulation techniques (rhetoric, bias, framing, etc.)
3. **Semantic Scholar** — Search for supporting papers per technique
4. **Mistral** — Generate SKILL.md for each technique with examples and citations
5. **Output** — `output/problems.json` and `output/skills/{slug}/SKILL.md`

## Setup

```bash
cp .env.example .env
```

Edit `.env` and set `MISTRAL_API_KEY` (required). Optionally add `S2_API_KEY` for higher Semantic Scholar rate limits.

## Usage

```bash
npm install
npm run generate           # Last 10 videos (default)
npm run generate -- --last=5   # Custom count
```

## Output

- **output/problems.json** — Database of techniques with examples, sources, and skill paths
- **output/skills/{slug}/SKILL.md** — Cursor skill file per technique (frontmatter, instructions, research backing)

## Dependencies

- youtubei.js — Channel and transcript fetching
- @mistralai/mistralai — Technique extraction and SKILL generation
- Semantic Scholar REST API — Paper search (no extra deps)
