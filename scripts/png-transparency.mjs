import { PNG } from 'pngjs';

function isNearWhite({ data }, pixel) {
  const offset = pixel * 4;
  return data[offset + 3] > 0 && data[offset] >= 240 && data[offset + 1] >= 240 && data[offset + 2] >= 240;
}

/** Removes only the near-white area connected to the canvas edge, preserving internal white highlights. */
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
  const add = (pixel) => {
    if (visited[pixel] || !isNearWhite(image, pixel)) return;
    visited[pixel] = 1;
    pending[tail++] = pixel;
  };

  for (let x = 0; x < width; x += 1) { add(x); add((height - 1) * width + x); }
  for (let y = 1; y < height - 1; y += 1) { add(y * width); add(y * width + width - 1); }
  while (head < tail) {
    const pixel = pending[head++];
    data[pixel * 4 + 3] = 0;
    removedPixels += 1;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    if (x > 0) add(pixel - 1);
    if (x < width - 1) add(pixel + 1);
    if (y > 0) add(pixel - width);
    if (y < height - 1) add(pixel + width);
  }
  return { pngData: PNG.sync.write(image), removedPixels };
}
