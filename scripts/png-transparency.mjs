import { PNG } from 'pngjs';

export const PNG_TRANSPARENCY_VERSION = 6;

function isEdgeMattePixel({ data }, pixel) {
  const offset = pixel * 4;
  const alpha = data[offset + 3];
  if (alpha === 0) return true;
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  const lightest = Math.max(red, green, blue);
  const darkest = Math.min(red, green, blue);
  // Flux anti-aliases an opaque white canvas into a light, almost-neutral halo.
  // Its final fringe can be medium grey (for example #B7B9BA), so key that
  // neutral outer-edge matte while leaving coloured fire and dark outlines intact.
  return darkest >= 150 && lightest - darkest <= 45;
}

function isWhiteBackdropIsland({ data }, pixel) {
  const offset = pixel * 4;
  if (data[offset + 3] === 0) return false;
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  // Flux often produces a slightly warm white canvas (for example #FAFCE9),
  // so this intentionally keys light, low-saturation backdrop pixels rather
  // than only exact neutral white.
  return Math.min(red, green, blue) >= 210 && Math.max(red, green, blue) - Math.min(red, green, blue) <= 48;
}

function isLightExteriorFringe({ data }, pixel) {
  const offset = pixel * 4;
  if (data[offset + 3] === 0) return false;
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  const lightest = Math.max(red, green, blue);
  const darkest = Math.min(red, green, blue);
  return (red + green + blue) / 3 >= 150 && lightest - darkest <= 90;
}

/** Removes white backdrop islands anywhere, then strips the light anti-aliasing matte from the outer edge. */
export function makeWhiteBackgroundTransparent(pngData) {
  let image;
  try {
    image = PNG.sync.read(pngData);
  } catch (error) {
    throw new Error(`Flux returned an unreadable PNG: ${error.message}`);
  }
  const { width, height, data } = image;
  const visited = new Uint8Array(width * height);
  const pending = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  let removedPixels = 0;
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    if (!isWhiteBackdropIsland(image, pixel)) continue;
    data[pixel * 4 + 3] = 0;
    removedPixels += 1;
  }
  const add = (pixel) => {
    if (visited[pixel] || !isEdgeMattePixel(image, pixel)) return;
    visited[pixel] = 1;
    pending[tail++] = pixel;
  };

  for (let x = 0; x < width; x += 1) { add(x); add((height - 1) * width + x); }
  for (let y = 1; y < height - 1; y += 1) { add(y * width); add(y * width + width - 1); }
  while (head < tail) {
    const pixel = pending[head++];
    const offset = pixel * 4;
    if (data[offset + 3] !== 0) {
      data[offset + 3] = 0;
      removedPixels += 1;
    }
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
      for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
        if (xOffset === 0 && yOffset === 0) continue;
        const nextX = x + xOffset;
        const nextY = y + yOffset;
        if (nextX >= 0 && nextX < width && nextY >= 0 && nextY < height) add(nextY * width + nextX);
      }
    }
  }
  // Trim one remaining light pixel from the exterior only. This removes the
  // warm outline left by Flux's opaque-canvas anti-aliasing without eroding
  // interior details or the darker graphic outline behind it.
  const exteriorFringe = new Set();
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    if (!visited[pixel]) continue;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
      for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
        if (xOffset === 0 && yOffset === 0) continue;
        const nextX = x + xOffset;
        const nextY = y + yOffset;
        if (nextX >= 0 && nextX < width && nextY >= 0 && nextY < height) {
          const neighbour = nextY * width + nextX;
          if (isLightExteriorFringe(image, neighbour)) exteriorFringe.add(neighbour);
        }
      }
    }
  }
  for (const pixel of exteriorFringe) {
    data[pixel * 4 + 3] = 0;
    removedPixels += 1;
  }
  return { pngData: PNG.sync.write(image), removedPixels };
}
