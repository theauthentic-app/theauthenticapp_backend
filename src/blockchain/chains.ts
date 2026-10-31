export type ChainDefinition = {
  key: string;
  chainId: number;
  name: string;
  /** Native gas token — not a wallet product, just chain metadata */
  nativeCurrency: string;
  explorerTx: string;
  explorerAddress: string;
  testnet: boolean;
};

/** Supported EVM networks for identity commitment anchoring. */
export const SUPPORTED_CHAINS: Record<string, ChainDefinition> = {
  ethereum: {
    key: 'ethereum',
    chainId: 1,
    name: 'Ethereum',
    nativeCurrency: 'ETH',
    explorerTx: 'https://etherscan.io/tx/',
    explorerAddress: 'https://etherscan.io/address/',
    testnet: false,
  },
  sepolia: {
    key: 'sepolia',
    chainId: 11155111,
    name: 'Ethereum Sepolia',
    nativeCurrency: 'ETH',
    explorerTx: 'https://sepolia.etherscan.io/tx/',
    explorerAddress: 'https://sepolia.etherscan.io/address/',
    testnet: true,
  },
  polygon: {
    key: 'polygon',
    chainId: 137,
    name: 'Polygon',
    nativeCurrency: 'POL',
    explorerTx: 'https://polygonscan.com/tx/',
    explorerAddress: 'https://polygonscan.com/address/',
    testnet: false,
  },
  'polygon-amoy': {
    key: 'polygon-amoy',
    chainId: 80002,
    name: 'Polygon Amoy',
    nativeCurrency: 'POL',
    explorerTx: 'https://amoy.polygonscan.com/tx/',
    explorerAddress: 'https://amoy.polygonscan.com/address/',
    testnet: true,
  },
  base: {
    key: 'base',
    chainId: 8453,
    name: 'Base',
    nativeCurrency: 'ETH',
    explorerTx: 'https://basescan.org/tx/',
    explorerAddress: 'https://basescan.org/address/',
    testnet: false,
  },
  'base-sepolia': {
    key: 'base-sepolia',
    chainId: 84532,
    name: 'Base Sepolia',
    nativeCurrency: 'ETH',
    explorerTx: 'https://sepolia.basescan.org/tx/',
    explorerAddress: 'https://sepolia.basescan.org/address/',
    testnet: true,
  },
  bsc: {
    key: 'bsc',
    chainId: 56,
    name: 'BNB Smart Chain',
    nativeCurrency: 'BNB',
    explorerTx: 'https://bscscan.com/tx/',
    explorerAddress: 'https://bscscan.com/address/',
    testnet: false,
  },
  'bsc-testnet': {
    key: 'bsc-testnet',
    chainId: 97,
    name: 'BNB Smart Chain Testnet',
    nativeCurrency: 'tBNB',
    explorerTx: 'https://testnet.bscscan.com/tx/',
    explorerAddress: 'https://testnet.bscscan.com/address/',
    testnet: true,
  },
  arbitrum: {
    key: 'arbitrum',
    chainId: 42161,
    name: 'Arbitrum One',
    nativeCurrency: 'ETH',
    explorerTx: 'https://arbiscan.io/tx/',
    explorerAddress: 'https://arbiscan.io/address/',
    testnet: false,
  },
  optimism: {
    key: 'optimism',
    chainId: 10,
    name: 'Optimism',
    nativeCurrency: 'ETH',
    explorerTx: 'https://optimistic.etherscan.io/tx/',
    explorerAddress: 'https://optimistic.etherscan.io/address/',
    testnet: false,
  },
};

export function chainOf(key?: string | null): ChainDefinition | null {
  if (!key) return null;
  return SUPPORTED_CHAINS[key] ?? null;
}

export function listChains(includeTestnets = true): ChainDefinition[] {
  return Object.values(SUPPORTED_CHAINS).filter(
    (chain) => includeTestnets || !chain.testnet,
  );
}
