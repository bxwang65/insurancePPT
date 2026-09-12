-- CreateTable
CREATE TABLE "TransactionBerlue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transaction_id" TEXT NOT NULL,
    "beneficiary_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "direct_pct" DECIMAL,
    "indirect_pct" DECIMAL,
    "investor" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "computed_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TransactionBerlue_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "Transaction" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TransactionBerlue_beneficiary_id_fkey" FOREIGN KEY ("beneficiary_id") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TransactionBerlue_beneficiary_id_computed_at_idx" ON "TransactionBerlue"("beneficiary_id", "computed_at");

-- CreateIndex
CREATE INDEX "TransactionBerlue_transaction_id_idx" ON "TransactionBerlue"("transaction_id");
