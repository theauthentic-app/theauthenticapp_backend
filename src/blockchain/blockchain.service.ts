import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AnchorStatus, Prisma } from '@prisma/client';
import { Contract, JsonRpcProvider, Wallet, getBytes, hexlify } from 'ethers';
import { AppError } from '../common/errors/app-error';
import { publicId } from '../common/utils/crypto.util';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SUPPORTED_CHAINS, chainOf, listChains } from './chains';
import {
  buildMerkleTree,
  identityCommitment,
  merkleProof,
  verifyMerkleProof,
} from './merkle.util';
import { AUTHENTIC_REGISTRY_ABI } from './registry.abi';

export type AnchorPublicView = {
  status: AnchorStatus | 'DISABLED';
  commitment: string | null;
  chainKey: string | null;
  chainId: number | null;
  chainName: string | null;
  nativeCurrency: string | null;
  txHash: string | null;
  blockNumber: string | null;
  merkleRoot: string | null;
  merkleProof: string[] | null;
  leafIndex: number | null;
  explorerUrl: string | null;
  anchoredAt: Date | null;
  verifiedLocally: boolean | null;
};

@Injectable()
export class BlockchainService {
  private readonly logger = new Logger(BlockchainService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  enabled(): boolean {
    const flag = (
      this.config.get<string>('BLOCKCHAIN_ENABLED') ?? ''
    ).toLowerCase();
    if (flag === 'false' || flag === '0') return false;
    return (
      flag === 'true' ||
      flag === '1' ||
      Boolean(this.config.get('BLOCKCHAIN_RPC_URL'))
    );
  }

  liveSubmitEnabled(): boolean {
    return (
      this.enabled() &&
      Boolean(this.config.get('BLOCKCHAIN_RPC_URL')) &&
      Boolean(this.config.get('BLOCKCHAIN_PRIVATE_KEY')) &&
      Boolean(this.config.get('BLOCKCHAIN_REGISTRY_ADDRESS'))
    );
  }

  activeChain() {
    const key =
      this.config.get<string>('BLOCKCHAIN_CHAIN_KEY') ?? 'polygon-amoy';
    return chainOf(key) ?? SUPPORTED_CHAINS['polygon-amoy'];
  }

  status() {
    const chain = this.activeChain();
    return {
      enabled: this.enabled(),
      liveSubmit: this.liveSubmitEnabled(),
      chain: {
        key: chain.key,
        chainId: chain.chainId,
        name: chain.name,
        nativeCurrency: chain.nativeCurrency,
        testnet: chain.testnet,
      },
      registryAddress:
        this.config.get<string>('BLOCKCHAIN_REGISTRY_ADDRESS') ?? null,
      supportedChains: listChains(true).map((item) => ({
        key: item.key,
        chainId: item.chainId,
        name: item.name,
        nativeCurrency: item.nativeCurrency,
        testnet: item.testnet,
      })),
      note: this.liveSubmitEnabled()
        ? 'Identity commitments are batched into Merkle roots and anchored on-chain.'
        : 'Commitments are computed and queued. Set RPC + signer + registry to submit live.',
    };
  }

  async queueForIdentities(
    identities: Array<{
      id: string;
      publicId: string;
      signature: string;
      organizationId: string;
      createdAt: Date;
    }>,
  ) {
    if (!this.enabled() || identities.length === 0) return { queued: 0 };

    const orgIds = [...new Set(identities.map((row) => row.organizationId))];
    const orgs = await this.prisma.organization.findMany({
      where: { id: { in: orgIds } },
      select: { id: true, publicId: true },
    });
    const orgPublic = new Map(orgs.map((org) => [org.id, org.publicId]));
    const chain = this.activeChain();
    let queued = 0;

    for (const identity of identities) {
      const commitment = identityCommitment({
        publicId: identity.publicId,
        signature: identity.signature,
        organizationPublicId: orgPublic.get(identity.organizationId) ?? 'org',
        issuedAt: identity.createdAt.toISOString(),
      });
      await this.prisma.identityAnchor.upsert({
        where: { productIdentityId: identity.id },
        create: {
          publicId: publicId('anc'),
          productIdentityId: identity.id,
          organizationId: identity.organizationId,
          commitment,
          status: AnchorStatus.PENDING,
          chainKey: chain.key,
          chainId: chain.chainId,
          nativeCurrency: chain.nativeCurrency,
        },
        update: {
          commitment,
          status: AnchorStatus.PENDING,
          errorMessage: null,
          chainKey: chain.key,
          chainId: chain.chainId,
          nativeCurrency: chain.nativeCurrency,
        },
      });
      queued += 1;
    }
    return { queued };
  }

  async proofForIdentityPublicId(
    identityPublicId: string,
  ): Promise<AnchorPublicView> {
    if (!this.enabled()) {
      return this.disabledView();
    }
    const identity = await this.prisma.productIdentity.findUnique({
      where: { publicId: identityPublicId },
      include: { blockchainAnchor: true },
    });
    if (!identity?.blockchainAnchor) {
      return {
        ...this.disabledView(),
        status: 'PENDING',
        commitment: null,
      };
    }
    return this.toPublic(identity.blockchainAnchor);
  }

  async proofForIdentityId(productIdentityId: string) {
    if (!this.enabled()) return this.disabledView();
    const anchor = await this.prisma.identityAnchor.findUnique({
      where: { productIdentityId },
    });
    return anchor ? this.toPublic(anchor) : this.disabledView();
  }

  async flushPending(limit = 64) {
    if (!this.enabled()) return { processed: 0, anchored: false };

    const pending = await this.prisma.identityAnchor.findMany({
      where: { status: { in: [AnchorStatus.PENDING, AnchorStatus.FAILED] } },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    if (pending.length === 0) return { processed: 0, anchored: false };

    const leaves = pending.map((row) => row.commitment);
    const tree = buildMerkleTree(leaves);
    const chain = this.activeChain();

    await this.prisma.identityAnchor.updateMany({
      where: { id: { in: pending.map((row) => row.id) } },
      data: { status: AnchorStatus.QUEUED, merkleRoot: tree.root },
    });

    for (let i = 0; i < pending.length; i += 1) {
      const proof = merkleProof(tree, i);
      await this.prisma.identityAnchor.update({
        where: { id: pending[i].id },
        data: {
          leafIndex: i,
          merkleProof: proof as Prisma.InputJsonValue,
          merkleRoot: tree.root,
        },
      });
    }

    if (!this.liveSubmitEnabled()) {
      this.logger.log(
        `Queued Merkle root ${tree.root.slice(0, 12)}… for ${pending.length} identities (live submit off).`,
      );
      return { processed: pending.length, anchored: false, root: tree.root };
    }

    try {
      const receipt = await this.submitRoot(tree.root, pending.length);
      const explorerUrl = `${chain.explorerTx}${receipt.txHash}`;
      await this.prisma.identityAnchor.updateMany({
        where: { id: { in: pending.map((row) => row.id) } },
        data: {
          status: AnchorStatus.ANCHORED,
          txHash: receipt.txHash,
          blockNumber: receipt.blockNumber,
          explorerUrl,
          anchoredAt: new Date(),
          chainKey: chain.key,
          chainId: chain.chainId,
          nativeCurrency: chain.nativeCurrency,
          errorMessage: null,
        },
      });
      await this.audit.record({
        action: 'IDENTITY_ANCHORED',
        organizationId: pending[0]?.organizationId,
        entity: 'IdentityAnchor',
        metadata: {
          root: tree.root,
          count: pending.length,
          txHash: receipt.txHash,
          chainKey: chain.key,
        },
      });
      return {
        processed: pending.length,
        anchored: true,
        root: tree.root,
        txHash: receipt.txHash,
      };
    } catch (error) {
      const message = String(error);
      this.logger.error(`On-chain anchor failed: ${message}`);
      await this.prisma.identityAnchor.updateMany({
        where: { id: { in: pending.map((row) => row.id) } },
        data: { status: AnchorStatus.FAILED, errorMessage: message.slice(0, 500) },
      });
      return { processed: pending.length, anchored: false, error: message };
    }
  }

  private async submitRoot(rootHex: string, leafCount: number) {
    const rpc = this.config.getOrThrow<string>('BLOCKCHAIN_RPC_URL');
    const key = this.config.getOrThrow<string>('BLOCKCHAIN_PRIVATE_KEY');
    const registry = this.config.getOrThrow<string>(
      'BLOCKCHAIN_REGISTRY_ADDRESS',
    );
    const provider = new JsonRpcProvider(rpc, this.activeChain().chainId);
    const wallet = new Wallet(key, provider);
    const contract = new Contract(registry, AUTHENTIC_REGISTRY_ABI, wallet);
    const rootBytes = hexlify(getBytes(`0x${rootHex.replace(/^0x/i, '')}`));
    const tx = await contract.anchorRoot(rootBytes, leafCount);
    const receipt = await tx.wait();
    return {
      txHash: receipt.hash as string,
      blockNumber: BigInt(receipt.blockNumber ?? 0),
    };
  }

  private toPublic(anchor: {
    status: AnchorStatus;
    commitment: string;
    chainKey: string | null;
    chainId: number | null;
    nativeCurrency: string | null;
    txHash: string | null;
    blockNumber: bigint | null;
    merkleRoot: string | null;
    merkleProof: Prisma.JsonValue | null;
    leafIndex: number | null;
    explorerUrl: string | null;
    anchoredAt: Date | null;
  }): AnchorPublicView {
    const chain = chainOf(anchor.chainKey);
    const proof = Array.isArray(anchor.merkleProof)
      ? (anchor.merkleProof as string[])
      : null;
    const verifiedLocally =
      anchor.merkleRoot && proof
        ? verifyMerkleProof(anchor.commitment, proof, anchor.merkleRoot)
        : null;
    return {
      status: anchor.status,
      commitment: anchor.commitment,
      chainKey: anchor.chainKey,
      chainId: anchor.chainId,
      chainName: chain?.name ?? null,
      nativeCurrency: anchor.nativeCurrency,
      txHash: anchor.txHash,
      blockNumber:
        anchor.blockNumber == null ? null : anchor.blockNumber.toString(),
      merkleRoot: anchor.merkleRoot,
      merkleProof: proof,
      leafIndex: anchor.leafIndex,
      explorerUrl: anchor.explorerUrl,
      anchoredAt: anchor.anchoredAt,
      verifiedLocally,
    };
  }

  private disabledView(): AnchorPublicView {
    return {
      status: 'DISABLED',
      commitment: null,
      chainKey: null,
      chainId: null,
      chainName: null,
      nativeCurrency: null,
      txHash: null,
      blockNumber: null,
      merkleRoot: null,
      merkleProof: null,
      leafIndex: null,
      explorerUrl: null,
      anchoredAt: null,
      verifiedLocally: null,
    };
  }

  async requireOrgIdentity(
    organizationId: string,
    identityPublicId: string,
  ) {
    const identity = await this.prisma.productIdentity.findFirst({
      where: { organizationId, publicId: identityPublicId },
    });
    if (!identity) {
      throw new AppError('IDENTITY_NOT_FOUND', 'Identity not found.', 404);
    }
    return identity;
  }
}
