-- CreateTable
CREATE TABLE "request_spans" (
    "id" UUID NOT NULL,
    "sessionId" VARCHAR(64) NOT NULL,
    "tenantId" UUID NOT NULL,
    "parentRequestId" UUID,
    "requestId" UUID NOT NULL,
    "userLabel" VARCHAR(255),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_spans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "request_spans_tenantId_sessionId_idx" ON "request_spans"("tenantId", "sessionId");

-- CreateIndex
CREATE INDEX "request_spans_requestId_idx" ON "request_spans"("requestId");

-- AddForeignKey
ALTER TABLE "request_spans" ADD CONSTRAINT "request_spans_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
