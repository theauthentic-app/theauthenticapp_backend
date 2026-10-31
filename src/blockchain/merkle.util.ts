import { createHash } from 'node:crypto';

export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256')
    .update(typeof input === 'string' ? input : input)
    .digest('hex');
}

/** Commitment for an AUTHENTIC unit — never put raw PII on-chain. */
export function identityCommitment(input: {
  publicId: string;
  signature: string;
  organizationPublicId: string;
  issuedAt: string;
}): string {
  return sha256Hex(
    `authentic:v1:${input.publicId}|${input.signature}|${input.organizationPublicId}|${input.issuedAt}`,
  );
}

function pairHash(left: string, right: string): string {
  const [a, b] = left <= right ? [left, right] : [right, left];
  return sha256Hex(Buffer.concat([Buffer.from(a, 'hex'), Buffer.from(b, 'hex')]));
}

export type MerkleTree = {
  root: string;
  leaves: string[];
  layers: string[][];
};

export function buildMerkleTree(leaves: string[]): MerkleTree {
  if (leaves.length === 0) {
    return { root: sha256Hex('authentic:empty'), leaves: [], layers: [] };
  }
  const normalized = leaves.map((leaf) => leaf.replace(/^0x/i, '').toLowerCase());
  const layers: string[][] = [normalized];
  let current = normalized;
  while (current.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < current.length; i += 2) {
      const left = current[i];
      const right = current[i + 1] ?? left;
      next.push(pairHash(left, right));
    }
    layers.push(next);
    current = next;
  }
  return { root: current[0], leaves: normalized, layers };
}

export function merkleProof(tree: MerkleTree, leafIndex: number): string[] {
  if (leafIndex < 0 || leafIndex >= tree.leaves.length) return [];
  const proof: string[] = [];
  let index = leafIndex;
  for (let layer = 0; layer < tree.layers.length - 1; layer += 1) {
    const nodes = tree.layers[layer];
    const pairIndex = index % 2 === 0 ? index + 1 : index - 1;
    const sibling = nodes[pairIndex] ?? nodes[index];
    proof.push(sibling);
    index = Math.floor(index / 2);
  }
  return proof;
}

export function verifyMerkleProof(
  leaf: string,
  proof: string[],
  root: string,
): boolean {
  let hash = leaf.replace(/^0x/i, '').toLowerCase();
  for (const sibling of proof) {
    hash = pairHash(hash, sibling.replace(/^0x/i, '').toLowerCase());
  }
  return hash === root.replace(/^0x/i, '').toLowerCase();
}
