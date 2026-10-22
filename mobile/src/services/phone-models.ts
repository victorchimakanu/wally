export type PhoneModel = 'qwen3-600m' | 'qwen3-1.7b';
export type PhoneBackend = 'cpu' | 'gpu';
// Pinned to the checksummed descriptors in @qvac/sdk 0.21.0.
export const PHONE_MODELS = {
  'qwen3-600m': {
    label: 'Qwen3 0.6B Q4', bytes: 382156480,
    url: 'https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/resolve/50968a4468ef4233ed78cd7c3de230dd1d61a56b/Qwen3-0.6B-Q4_0.gguf',
    sha256: '33bcc57074ec7b6eada5a90651ee546ec0c2b271002c22baf9f1b2dd1e8f75cb',
  },
  'qwen3-1.7b': {
    label: 'Qwen3 1.7B Q4', bytes: 1056782912,
    url: 'https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/d7f544eead698dbd1f15126ef60b45a1e1933222/Qwen3-1.7B-Q4_0.gguf',
    sha256: 'c876f159707a4e4f70e045106c69db15bfc935a4981706fd4f65c6e7ea1e81c5',
  },
} as const;
