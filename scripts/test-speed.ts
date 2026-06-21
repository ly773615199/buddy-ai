import { TextEncoder } from '../src/brain/right/features/text-encoder.js';

const encoder = new TextEncoder({
  byteEmbedDim: 32,
  outputDim: 128,
  numLayers: 2,
  numHeads: 4,
  ffnDim: 256,
});

const text = `function hello() {
  // This is a longer test string
  const x = 1;
  const y = 2;
  return x + y;
}`;

// Warmup
encoder.forwardPooled(text);

// Benchmark with longer text
const start = Date.now();
const N = 3;
for (let i = 0; i < N; i++) {
  encoder.forwardPooled(text);
}
const elapsed = Date.now() - start;
console.log(`Text length: ${text.length} chars`);
console.log(`${N} forward passes: ${elapsed}ms (${(elapsed/N).toFixed(1)}ms/pass)`);
