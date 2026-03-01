-- CreateTable
CREATE TABLE "AnnotationVote" (
    "id" TEXT NOT NULL,
    "annotationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "vote" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnnotationVote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnnotationVote_annotationId_idx" ON "AnnotationVote"("annotationId");

-- CreateIndex
CREATE INDEX "AnnotationVote_clientId_idx" ON "AnnotationVote"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "AnnotationVote_annotationId_clientId_key" ON "AnnotationVote"("annotationId", "clientId");

-- AddForeignKey
ALTER TABLE "AnnotationVote" ADD CONSTRAINT "AnnotationVote_annotationId_fkey" FOREIGN KEY ("annotationId") REFERENCES "Annotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
