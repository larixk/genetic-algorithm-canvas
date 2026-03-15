const MIN_ALPHA = 0.5;
const GENERATION_SIZE = 100;
const SURVIVORS = 10;
export const MAX_SHAPES = 128;

export const rand = (from = 1, to = 0) => from + Math.random() * (to - from);
const vary = (spread, original) => original + rand(-spread, spread);
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const mutateShape = (shape, width, height, temperature) => ({
  ...shape,
  size: rand() < 0.5 ? shape.size : clamp(shape.size * vary(0.1 * temperature, 1), 6, Math.max(height, width) / 2),
  x: rand() < 0.5 ? shape.x : clamp(vary((width / 10) * temperature, shape.x), 0, width),
  y: rand() < 0.5 ? shape.y : clamp(vary((height / 10) * temperature, shape.y), 0, height),
  r: rand() < 0.5 ? shape.r : clamp(vary(16 * temperature, shape.r), 0, 255),
  g: rand() < 0.5 ? shape.g : clamp(vary(16 * temperature, shape.g), 0, 255),
  b: rand() < 0.5 ? shape.b : clamp(vary(16 * temperature, shape.b), 0, 255),
  a: rand() < 0.5 ? shape.a : clamp(vary(0.05 * temperature, shape.a), MIN_ALPHA, 1),
});

export const mutate = (gene, width, height, temperature) => {
  const shapes = gene.shapes.slice(0);
  if (rand() < 0.2 && shapes.length > 0) {
    shapes.splice(Math.floor(rand(shapes.length)), 1);
  }
  const mutateCount = Math.min(shapes.length, 2 + (rand() < 0.3 ? 1 : 0));
  for (let m = 0; m < mutateCount; m++) {
    const idx = Math.floor(rand(shapes.length));
    shapes[idx] = mutateShape(shapes[idx], width, height, temperature);
  }
  if (shapes.length < MAX_SHAPES) {
    shapes.push({
      x: rand(width),
      y: rand(height),
      size: clamp((Math.pow(rand(), 2) * Math.max(height, width)) / 2, 3, Math.max(height, width) / 2),
      r: rand(256),
      g: rand(256),
      b: rand(256),
      a: rand(MIN_ALPHA, 1),
    });
  }
  shapes.sort((a, b) => b.a - a.a);
  return { ...gene, shapes, error: false };
};

export const crossover = (geneA, geneB) => {
  const shapes = [];
  const maxLen = Math.max(geneA.shapes.length, geneB.shapes.length);
  for (let i = 0; i < maxLen; i++) {
    const fromA = i < geneA.shapes.length ? geneA.shapes[i] : null;
    const fromB = i < geneB.shapes.length ? geneB.shapes[i] : null;
    if (fromA && fromB) shapes.push(Math.random() < 0.5 ? fromA : fromB);
    else if (fromA) shapes.push(fromA);
    else if (fromB) shapes.push(fromB);
  }
  return { shapes: shapes.slice(0, MAX_SHAPES) };
};

export const procreate = (results, width, height, temperature) => {
  const survivors = [...results].sort((a, b) => a.error - b.error).slice(0, SURVIVORS);
  const genes = [];
  survivors.forEach((result) => {
    genes.push(result.gene);
    const offspringCount = GENERATION_SIZE / SURVIVORS - 1;
    const crossoverCount = Math.floor(offspringCount / 2);
    for (let j = 0; j < crossoverCount; j++) {
      const otherIdx = Math.floor(Math.random() * survivors.length);
      genes.push(mutate(crossover(result.gene, survivors[otherIdx].gene), width, height, temperature));
    }
    for (let j = crossoverCount; j < offspringCount; j++) {
      genes.push(mutate(result.gene, width, height, temperature));
    }
  });
  return genes;
};

export const computeRawGradient = (imageData, w, h) => {
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    gray[i] = 0.299 * imageData[i * 4] + 0.587 * imageData[i * 4 + 1] + 0.114 * imageData[i * 4 + 2];
  }
  const gradient = new Float32Array(w * h);
  let gradientMax = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const gx =
        -gray[(y - 1) * w + (x - 1)] + gray[(y - 1) * w + (x + 1)]
        - 2 * gray[y * w + (x - 1)] + 2 * gray[y * w + (x + 1)]
        - gray[(y + 1) * w + (x - 1)] + gray[(y + 1) * w + (x + 1)];
      const gy =
        -gray[(y - 1) * w + (x - 1)] - 2 * gray[(y - 1) * w + x] - gray[(y - 1) * w + (x + 1)]
        + gray[(y + 1) * w + (x - 1)] + 2 * gray[(y + 1) * w + x] + gray[(y + 1) * w + (x + 1)];
      gradient[y * w + x] = Math.sqrt(gx * gx + gy * gy);
      if (gradient[y * w + x] > gradientMax) gradientMax = gradient[y * w + x];
    }
  }
  return { gradient, gradientMax };
};

export const gradientToWeights = (gradient, gradientMax, gamma) => {
  const MIN_WEIGHT = 0.01;
  const weights = new Float32Array(gradient.length);
  for (let i = 0; i < weights.length; i++) {
    const normalized = gradientMax > 0 ? gradient[i] / gradientMax : 1.0;
    weights[i] = MIN_WEIGHT + (1 - MIN_WEIGHT) * Math.pow(normalized, gamma);
  }
  return weights;
};
