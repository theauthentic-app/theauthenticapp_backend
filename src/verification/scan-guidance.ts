import { VerificationStatus } from '@prisma/client';

export function scanGuidance(
  status: VerificationStatus,
  hasIdentity: boolean,
) {
  const reportRecommended = status !== VerificationStatus.AUTHENTICATED;
  const nextSteps: string[] = [];
  if (status === VerificationStatus.AUTHENTICATED) {
    nextSteps.push('You can save this identity to your wallet if you own the product.');
  }
  if (
    status === VerificationStatus.SUSPICIOUS ||
    status === VerificationStatus.COMPROMISED
  ) {
    nextSteps.push('Treat this as a risk signal, not a final verdict.');
    nextSteps.push('If the packaging, seller, or code looks wrong, file a report.');
  }
  if (status === VerificationStatus.RECALLED) {
    nextSteps.push('Follow the manufacturer recall instructions before use.');
  }
  if (status === VerificationStatus.EXPIRED) {
    nextSteps.push('Do not rely on this unit past its expiry date.');
  }
  if (status === VerificationStatus.REVOKED) {
    nextSteps.push('The issuer has withdrawn this identity. Do not trust the marking alone.');
  }
  if (
    status === VerificationStatus.UNVERIFIED ||
    status === VerificationStatus.NOT_FOUND
  ) {
    nextSteps.push(
      'A missing identity is not proof of a counterfeit. It means AUTHENTIC has no serialized record for this code.',
    );
  }
  return {
    reportRecommended,
    saveToWallet: hasIdentity && status === VerificationStatus.AUTHENTICATED,
    nextSteps,
  };
}
