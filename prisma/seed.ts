import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const VIDEO_IDS = ["dQw4w9WgXcQ", "jNQXAC9IVRw"] as const;

async function main() {
  // Video 1: rhetorical manipulation + fact-check
  const analysis1 = await prisma.videoAnalysis.upsert({
    where: { videoId: VIDEO_IDS[0] },
    create: {
      videoId: VIDEO_IDS[0],
      transcriptHash: "abc123hash",
      alerts: [
        {
          type: "rhetorical_manipulation",
          technique: "Appeal to Fear",
          quote: "If we don't act now, everything will collapse.",
          explanation: "Uses fear-based framing to pressure immediate action without evidence.",
          severity: "medium",
          start: 45.2,
          end: 52.8,
        },
        {
          type: "rhetorical_manipulation",
          technique: "Loaded Language",
          quote: "The radical left agenda",
          explanation: "Emotionally charged language to vilify opposition.",
          severity: "low",
          start: 120.5,
          end: 135.2,
        },
      ],
      factChecks: [
        {
          claim: "Crime increased 500% last year",
          verdict: "misleading",
          context: "Official statistics show a 3% increase; 500% figure is not sourced.",
          sources: ["https://www.insee.fr/fr/statistiques"],
          start: 200,
          end: 210,
        },
      ],
    },
    update: {},
  });

  // Annotations for video 1 (derived from alerts and fact_checks)
  const ann1a = await prisma.annotation.upsert({
    where: { id: "seed-ann-1a" },
    create: {
      id: "seed-ann-1a",
      videoId: VIDEO_IDS[0],
      timestampStart: 45.2,
      timestampEnd: 52.8,
      type: "MANIPULATION",
      content: "Appeal to Fear",
      explanation:
        "Uses fear-based framing to pressure immediate action without evidence.",
      sources: [],
      version: 1,
    },
    update: {},
  });

  const ann1b = await prisma.annotation.upsert({
    where: { id: "seed-ann-1b" },
    create: {
      id: "seed-ann-1b",
      videoId: VIDEO_IDS[0],
      timestampStart: 200,
      timestampEnd: 210,
      type: "FACT_CHECK",
      content: "Crime increased 500% last year",
      explanation:
        "Official statistics show a 3% increase; 500% figure is not sourced.",
      sources: ["https://www.insee.fr/fr/statistiques"],
      version: 2,
    },
    update: {},
  });

  // Annotation comment for video 1 - one applied improvement
  await prisma.annotationComment.upsert({
    where: { id: "seed-comment-1" },
    create: {
      id: "seed-comment-1",
      annotationId: ann1b.id,
      userContent: "INSEE data shows different: https://www.insee.fr/fr/statistiques/2024",
      mistralImprovedContent: {
        updatedExplanation:
          "Official INSEE statistics for 2024 show a 3% increase in reported crimes. The 500% figure appears to be unsourced or from a non-official source.",
        updatedSources: [
          "https://www.insee.fr/fr/statistiques",
          "https://www.insee.fr/fr/statistiques/2024",
        ],
      },
      status: "APPLIED",
    },
    update: {},
  });

  // Video 2: different video with mix of content
  const analysis2 = await prisma.videoAnalysis.upsert({
    where: { videoId: VIDEO_IDS[1] },
    create: {
      videoId: VIDEO_IDS[1],
      transcriptHash: "def456hash",
      alerts: [
        {
          type: "rhetorical_manipulation",
          technique: "Straw Man",
          quote: "They want to destroy our economy",
          explanation: "Misrepresents opposing position to make it easier to attack.",
          severity: "high",
          start: 88,
          end: 95,
        },
      ],
      factChecks: [
        {
          claim: "Unemployment is at record lows",
          verdict: "accurate",
          context: "Supported by national employment agency data.",
          sources: ["https://www.service-public.fr/emploi"],
          start: 150,
          end: 158,
        },
      ],
    },
    update: {},
  });

  const ann2a = await prisma.annotation.upsert({
    where: { id: "seed-ann-2a" },
    create: {
      id: "seed-ann-2a",
      videoId: VIDEO_IDS[1],
      timestampStart: 88,
      timestampEnd: 95,
      type: "MANIPULATION",
      content: "Straw Man - They want to destroy our economy",
      explanation:
        "Misrepresents opposing position to make it easier to attack.",
      sources: [],
      version: 1,
    },
    update: {},
  });

  const ann2b = await prisma.annotation.upsert({
    where: { id: "seed-ann-2b" },
    create: {
      id: "seed-ann-2b",
      videoId: VIDEO_IDS[1],
      timestampStart: 150,
      timestampEnd: 158,
      type: "FACT_CHECK",
      content: "Unemployment is at record lows",
      explanation: "Supported by national employment agency data.",
      sources: ["https://www.service-public.fr/emploi"],
      version: 1,
    },
    update: {},
  });

  // Pending comment for video 2
  await prisma.annotationComment.upsert({
    where: { id: "seed-comment-2" },
    create: {
      id: "seed-comment-2",
      annotationId: ann2a.id,
      userContent: "The OECD report from 2024 gives more context on this.",
      mistralImprovedContent: null,
      status: "PENDING",
    },
    update: {},
  });

  console.log("Seed completed:");
  console.log(`  - ${VIDEO_IDS.length} VideoAnalyses`);
  console.log(`  - 4 Annotations`);
  console.log(`  - 2 AnnotationComments`);
  console.log(`\nTest with: GET /video/${VIDEO_IDS[0]}/analysis`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
