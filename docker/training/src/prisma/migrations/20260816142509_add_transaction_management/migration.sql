-- CreateTable
CREATE TABLE "TransactionManagement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transaction_id" TEXT NOT NULL,
    "beneficiary_id" TEXT NOT NULL,
    "chain_depth" INTEGER NOT NULL,
    "amount" DECIMAL NOT NULL,
    "manager_y1_pct" DECIMAL,
    "l1_y1_pct" DECIMAL,
    "investor" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "computed_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TransactionManagement_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "Transaction" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TransactionManagement_beneficiary_id_fkey" FOREIGN KEY ("beneficiary_id") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TransactionManagement_beneficiary_id_computed_at_idx" ON "TransactionManagement"("beneficiary_id", "computed_at");

-- CreateIndex
CREATE INDEX "TransactionManagement_transaction_id_idx" ON "TransactionManagement"("transaction_id");
