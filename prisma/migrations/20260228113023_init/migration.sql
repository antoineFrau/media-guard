-- CreateEnum
CREATE TYPE "AnnotationType" AS ENUM ('MANIPULATION', 'FACT_CHECK');

-- CreateEnum
CREATE TYPE "AnnotationCommentStatus" AS ENUM ('PENDING', 'APPLIED', 'REJECTED');

-- CreateTable
CREATE TABLE "VideoAnalysis" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "transcriptHash" TEXT,
    "alerts" JSONB NOT NULL DEFAULT '[]',
    "factChecks" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Annotation" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "timestampStart" DOUBLE PRECISION NOT NULL,
    "timestampEnd" DOUBLE PRECISION NOT NULL,
    "type" "AnnotationType" NOT NULL,
    "content" TEXT NOT NULL,
    "explanation" TEXT,
    "sources" JSONB NOT NULL DEFAULT '[]',
    "userComments" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Annotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnnotationComment" (
    "id" TEXT NOT NULL,
    "annotationId" TEXT NOT NULL,
    "userContent" TEXT NOT NULL,
    "mistralImprovedContent" JSONB,
    "status" "AnnotationCommentStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnnotationComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VideoAnalysis_videoId_key" ON "VideoAnalysis"("videoId");

-- CreateIndex
CREATE INDEX "Annotation_videoId_idx" ON "Annotation"("videoId");

-- CreateIndex
CREATE INDEX "AnnotationComment_annotationId_idx" ON "AnnotationComment"("annotationId");

-- AddForeignKey
ALTER TABLE "AnnotationComment" ADD CONSTRAINT "AnnotationComment_annotationId_fkey" FOREIGN KEY ("annotationId") REFERENCES "Annotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
