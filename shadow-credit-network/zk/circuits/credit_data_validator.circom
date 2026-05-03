pragma circom 2.1.6;

include "../node_modules/circomlib/circuits/comparators.circom";
include "../node_modules/circomlib/circuits/bitify.circom";

/**
 * CreditDataValidator
 * 
 * Validates credit data inputs are within acceptable ranges.
 * This circuit ensures:
 * - Payment history is between 0-10000 (basis points)
 * - Credit utilization is between 0-10000 (basis points)
 * - Account age is reasonable (0-100 years in days)
 * - Number of defaults is reasonable (0-100)
 * - Income >= Debt (solvency check)
 * 
 * The circuit does NOT prove the data is true, only that it's valid.
 * Real-world usage would combine this with additional oracle attestation.
 */
template CreditDataValidator() {
    // Public inputs (committed to blockchain)
    signal input commitment;
    
    // Private inputs (encrypted on-chain, revealed to circuit)
    signal input income;
    signal input totalDebt;
    signal input paymentHistory;      // 0-10000 basis points
    signal input creditUtilization;   // 0-10000 basis points
    signal input accountAge;          // days
    signal input numDefaults;          // count

    // Bit length for comparisons (we're dealing with values up to ~100000)
    var BITS = 17;  // 2^17 = 131072 > 100000

    // ===== Payment History Validation =====
    // Payment history must be 0-10000 (0%-100%)
    component paymentGteZero = GreaterEqThan(BITS);
    paymentGteZero.in[0] <== paymentHistory;
    paymentGteZero.in[1] <== 0;
    paymentGteZero.out === 1;

    component paymentLteMax = LessEqThan(BITS);
    paymentLteMax.in[0] <== paymentHistory;
    paymentLteMax.in[1] <== 10000;
    paymentLteMax.out === 1;

    // ===== Credit Utilization Validation =====
    // Utilization must be 0-10000 (0%-100%)
    component utilGteZero = GreaterEqThan(BITS);
    utilGteZero.in[0] <== creditUtilization;
    utilGteZero.in[1] <== 0;
    utilGteZero.out === 1;

    component utilLteMax = LessEqThan(BITS);
    utilLteMax.in[0] <== creditUtilization;
    utilLteMax.in[1] <== 10000;
    utilLteMax.out === 1;

    // ===== Account Age Validation =====
    // Account age must be 0-36500 days (0-100 years)
    component ageGteZero = GreaterEqThan(BITS);
    ageGteZero.in[0] <== accountAge;
    ageGteZero.in[1] <== 0;
    ageGteZero.out === 1;

    component ageLteMax = LessEqThan(BITS);
    ageLteMax.in[0] <== accountAge;
    ageLteMax.in[1] <== 36500;
    ageLteMax.out === 1;

    // ===== Defaults Validation =====
    // Defaults must be 0-100
    component defaultsGteZero = GreaterEqThan(BITS);
    defaultsGteZero.in[0] <== numDefaults;
    defaultsGteZero.in[1] <== 0;
    defaultsGteZero.out === 1;

    component defaultsLteMax = LessEqThan(BITS);
    defaultsLteMax.in[0] <== numDefaults;
    defaultsLteMax.in[1] <== 100;
    defaultsLteMax.out === 1;

    // ===== Solvency Check (Income >= Debt) =====
    // Income must be >= totalDebt
    component solvency = GreaterEqThan(BITS);
    solvency.in[0] <== income;
    solvency.in[1] <== totalDebt;
    solvency.out === 1;

    // ===== Non-Negativity Checks =====
    component incomeGteZero = GreaterEqThan(BITS);
    incomeGteZero.in[0] <== income;
    incomeGteZero.in[1] <== 0;
    incomeGteZero.out === 1;

    component debtGteZero = GreaterEqThan(BITS);
    debtGteZero.in[0] <== totalDebt;
    debtGteZero.in[1] <== 0;
    debtGteZero.out === 1;
}

component main {public [commitment]} = CreditDataValidator();
