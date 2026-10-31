import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrganizationMemberRole } from '@prisma/client';
import {
  ApiScopes,
  OrgRoles,
  Public,
} from '../common/decorators/auth.decorators';
import { OrganizationId } from '../common/decorators/current-user.decorator';
import { PartnerAuth } from '../common/decorators/partner-auth.decorator';
import { BlockchainService } from './blockchain.service';
import { listChains } from './chains';

@ApiTags('blockchain')
@Controller()
export class BlockchainController {
  constructor(private readonly blockchain: BlockchainService) {}

  @Public()
  @Get('public/blockchain/status')
  @ApiOperation({
    summary:
      'Blockchain anchoring status, active chain, and supported networks/currencies',
  })
  status() {
    return this.blockchain.status();
  }

  @Public()
  @Get('public/blockchain/chains')
  @ApiOperation({ summary: 'Supported EVM chains and native gas currencies' })
  chains() {
    return {
      items: listChains(true).map((chain) => ({
        key: chain.key,
        chainId: chain.chainId,
        name: chain.name,
        nativeCurrency: chain.nativeCurrency,
        testnet: chain.testnet,
      })),
    };
  }

  @Public()
  @Get('public/identities/:id/blockchain')
  @ApiOperation({
    summary:
      'On-chain proof for a product identity (commitment, Merkle proof, explorer link)',
  })
  proof(@Param('id') id: string) {
    return this.blockchain.proofForIdentityPublicId(id);
  }

  @PartnerAuth()
  @OrgRoles(
    OrganizationMemberRole.OWNER,
    OrganizationMemberRole.ADMIN,
    OrganizationMemberRole.MANAGER,
  )
  @ApiScopes('PRODUCT_WRITE')
  @Post('product-identities/:id/anchor')
  @ApiOperation({
    summary: 'Queue (or re-queue) a product identity for blockchain anchoring',
  })
  async requeue(
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
  ) {
    const identity = await this.blockchain.requireOrgIdentity(
      organizationId,
      id,
    );
    await this.blockchain.queueForIdentities([identity]);
    return this.blockchain.proofForIdentityPublicId(id);
  }
}
