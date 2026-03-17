/**
 * Estimate Anthropic vision token cost for an image.
 *
 * Claude processes images using a tile grid (768×768 per tile).
 * Cost = 85 base tokens + 170 tokens per tile.
 *
 * When only base64 byte length is known (no pixel dimensions), we estimate
 * the decoded JPEG file size and derive approximate dimensions using
 * empirical bytes-per-pixel ratios for the given JPEG quality.
 */

const TILE_SIZE = 768;
const BASE_TOKENS = 85;
const TOKENS_PER_TILE = 170;

/** Maximum dimension Claude will accept without internal downscaling. */
const MAX_LONG_EDGE = 1568;

/**
 * Estimate vision tokens from known pixel dimensions.
 * If either dimension exceeds MAX_LONG_EDGE, the image is downscaled
 * proportionally (matching Claude's internal behavior).
 */
export function estimateImageTokensFromDimensions(width: number, height: number): number {
  if (width <= 0 || height <= 0) return 0;

  // Downscale proportionally if either dimension exceeds the cap
  const scale = Math.min(1, MAX_LONG_EDGE / Math.max(width, height));
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);

  const tilesX = Math.ceil(w / TILE_SIZE);
  const tilesY = Math.ceil(h / TILE_SIZE);

  return BASE_TOKENS + tilesX * tilesY * TOKENS_PER_TILE;
}

/**
 * Rough bytes-per-pixel for JPEG at various quality levels (empirical).
 * JPEG quality 60 on typical web content: ~0.3–0.6 bytes/pixel.
 * We use 0.4 as a middle estimate for quality 60.
 */
const JPEG_BYTES_PER_PIXEL: Record<number, number> = {
  30: 0.2,
  40: 0.25,
  50: 0.3,
  60: 0.4,
  70: 0.55,
  80: 0.8,
  90: 1.2
};

/**
 * Estimate vision tokens from base64 byte length and JPEG quality.
 * Uses an empirical bytes/pixel ratio to guess pixel count, then
 * assumes a 3:2 aspect ratio (typical browser viewport) to derive dimensions.
 */
export function estimateImageTokensFromBase64Length(
  base64Length: number,
  jpegQuality: number = 60
): number {
  if (base64Length <= 0) return 0;

  // Base64 encodes 3 bytes as 4 chars
  const fileBytes = Math.floor((base64Length * 3) / 4);

  // Find closest quality bracket
  const qualities = Object.keys(JPEG_BYTES_PER_PIXEL).map(Number).sort((a, b) => a - b);
  let bpp = JPEG_BYTES_PER_PIXEL[60]!;
  for (const q of qualities) {
    if (q >= jpegQuality) {
      bpp = JPEG_BYTES_PER_PIXEL[q]!;
      break;
    }
    bpp = JPEG_BYTES_PER_PIXEL[q]!;
  }

  const estimatedPixels = fileBytes / bpp;

  // Assume 3:2 aspect ratio (1200×800 style)
  const height = Math.round(Math.sqrt(estimatedPixels / 1.5));
  const width = Math.round(height * 1.5);

  return estimateImageTokensFromDimensions(width, height);
}
