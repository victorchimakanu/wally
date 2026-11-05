/** Static Figma fixtures, never represented as live prices or wallet balances. */
export const MARKET_ASSETS = [
  { symbol: 'BTC', name: 'Bitcoin', price: 64280, change: 2.4, cap: '$1.27T', volume: '$28.4B', supply: '19.8M BTC', maximum: '21.0M BTC' },
  { symbol: 'ETH', name: 'Ethereum', price: 3140, change: 1.1, cap: '$377.3B', volume: '$12.8B', supply: '120.2M ETH', maximum: 'No fixed maximum' },
  { symbol: 'SOL', name: 'Solana', price: 148.83, change: 3.8, cap: '$68.9B', volume: '$2.6B', supply: '463M SOL', maximum: 'No fixed maximum' },
] as const;
export type MarketAsset = typeof MARKET_ASSETS[number];
export const price = (amount: number) => amount.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
