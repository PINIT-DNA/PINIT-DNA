/**
 * One-off quality numbers for DNA-B Patchwork (not part of the test runner).
 */
const sharp = require('sharp');
const path = require('path');

async function main() {
  const {
    embedRobustProvenanceWatermark,
  } = require(path.join(__dirname, '..', 'src', 'services', 'dna-vnext', 'robust-watermark.ts'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
