/**
 * Used to prefix the info message in IPartialRewardClaim when generating reward claims.
 */
export enum RewardTypePrefix {
  MEDIAN = "Median",
  SIGNING = "Signing",
  FINALIZATION = "Finalization",
  DOUBLE_SIGNERS = "Double signers",
  REVEAL_OFFENDERS = "Reveal offenders",
  FAST_UPDATES_ACCURACY = "Fast updates accuracy",
  FULL_OFFER_CLAIM_BACK = "Full offer claim back",
  PARTIAL_FDC_OFFER_CLAIM_BACK = "Partial FDC offer claim back",
  PARTIAL_FDC_OFFER_FIRE = "Partial FDC offer to FIRE",
  FDC_SIGNING = "FDC signing",
  FDC_FINALIZATION = "FDC finalization",
  FDC_OFFENDERS = "FDC offenders",
  // FCC fees redirected to FCC_FEES_ADDRESS. Kept as two tags so the sources stay separable once the TEE
  // rewarding logic replaces the redirection; they merge into a single DIRECT claim in the final claims.
  FCC_TEE_FEES = "FCC TEE fees",
  FCC_FDC2_FEES = "FCC FDC2 fees",
}
