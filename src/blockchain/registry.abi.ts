/** Minimal AUTHENTIC registry — deploy once per chain, then set BLOCKCHAIN_REGISTRY_ADDRESS. */
export const AUTHENTIC_REGISTRY_ABI = [
  'function anchorRoot(bytes32 root, uint256 leafCount) external',
  'event RootAnchored(bytes32 indexed root, uint256 leafCount, address indexed submitter, uint256 timestamp)',
] as const;

/**
 * Example Solidity (for your deployer / Foundry / Remix):
 *
 * ```solidity
 * // SPDX-License-Identifier: MIT
 * pragma solidity ^0.8.20;
 * contract AuthenticRegistry {
 *   event RootAnchored(bytes32 indexed root, uint256 leafCount, address indexed submitter, uint256 timestamp);
 *   function anchorRoot(bytes32 root, uint256 leafCount) external {
 *     emit RootAnchored(root, leafCount, msg.sender, block.timestamp);
 *   }
 * }
 * ```
 */
