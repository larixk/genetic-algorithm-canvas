import testImage from "./test.jpg";

const CALCULATION_WIDTH = 128;
const MAX_SHAPES = 128;
const USE_TEST_IMG = false;

const MIN_ALPHA = 0.5;

let waitForPause;

const GENERATION_SIZE = 100;
const SURVIVORS = 10;

const style = document.createElement("style");
style.textContent = `
  body { margin: 0; padding: 16px; background: #111; color: #eee; font-family: monospace; font-size: 12px; }
  #previews { display: flex; gap: 8px; align-items: flex-start; margin-bottom: 12px; }
  .preview-block { display: flex; flex-direction: column; gap: 4px; }
  .preview-block label { color: #888; }
  .preview-block canvas, .preview-block img { display: block; image-rendering: pixelated; }
  #status { margin-bottom: 12px; line-height: 1.6; }
  #controls { display: flex; gap: 20px; align-items: center; flex-wrap: wrap; }
  #controls label { display: flex; align-items: center; gap: 6px; }
`;
document.head.appendChild(style);

const previewsDiv = document.createElement("div");
previewsDiv.id = "previews";
document.body.appendChild(previewsDiv);

const statusDiv = document.createElement("div");
statusDiv.id = "status";
document.body.appendChild(statusDiv);

const controlsDiv = document.createElement("div");
controlsDiv.id = "controls";
document.body.appendChild(controlsDiv);

const makePreviewBlock = (labelText, child) => {
  const block = document.createElement("div");
  block.className = "preview-block";
  const label = document.createElement("label");
  label.textContent = labelText;
  block.appendChild(child);
  block.appendChild(label);
  return block;
};

const previewElement = new Image();
previewsDiv.appendChild(makePreviewBlock("best", previewElement));

const scoreElement = document.createElement("div");
statusDiv.appendChild(scoreElement);

const grayscaleLabel = document.createElement("label");
const grayscaleToggle = document.createElement("input");
grayscaleToggle.type = "checkbox";
grayscaleToggle.id = "grayscale";
grayscaleLabel.htmlFor = "grayscale";
grayscaleLabel.appendChild(grayscaleToggle);
grayscaleLabel.appendChild(document.createTextNode("Grayscale"));
controlsDiv.appendChild(grayscaleLabel);

grayscaleToggle.addEventListener("change", () => {
  workers.forEach((w) => w.postMessage({ type: "setGrayscale", value: grayscaleToggle.checked }));
});


let width;
let height;

const convertImageToCanvas = (image, scale) => {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth * scale;
  canvas.height = image.naturalHeight * scale;

  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  return Promise.resolve(canvas);
};

const drawShape = (shape, scale, ctx) => {
  const rgb = ["r", "g", "b"].map((c) => Math.round(shape[c])).join(",");
  ctx.fillStyle = `rgba(${rgb},${shape.a})`;
  ctx.beginPath();
  ctx.arc(shape.x * scale, shape.y * scale, shape.size * scale, 0, 2 * Math.PI);
  ctx.fill();
};

const geneToCanvas = (gene, scale) => {
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;

  const ctx = canvas.getContext("2d");
  gene.shapes.forEach((shape) => {
    drawShape(shape, scale, ctx);
  });

  return Promise.resolve(canvas);
};

const canvasToDataURL = (canvas) => canvas.toDataURL();

const canvasToImageData = (canvas) =>
  canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;

const imageToDataURL = (image, scale) =>
  convertImageToCanvas(image, scale).then(canvasToImageData);

const geneToSVG = (gene, scale) =>
  Promise.resolve(`<svg width="${width * scale}" height="${
    height * scale
  }" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width * scale} ${
    height * scale
  }" >
  ${gene.shapes
    .map(
      (shape) =>
        `<circle cx="${shape.x * scale}" cy="${shape.y * scale}" r="${
          shape.size * scale
        }" fill="rgba(${shape.r},${shape.g},${shape.b},${shape.a})" />`
    )
    .join("")}
</svg>`);

const dataURLToCanvas = (dataURL) =>
  new Promise((resolve) => {
    const img = new Image();

    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d").drawImage(img, 0, 0);
      resolve(canvas);
    };
    img.src = dataURL;
  });

const geneToDataURL = (gene, scale) =>
  geneToSVG(gene, scale).then(
    (svgString) => `data:image/svg+xml;base64,${window.btoa(svgString)}`
  );

const geneToImageData = (gene, scale) =>
  geneToCanvas(gene, scale).then(canvasToImageData);

const compare = (srcData, resultData) => {
  let error = 0;
  const len = srcData.length;
  for (let i = 0; i < len; i++) {
    error = error + Math.pow(srcData[i] - resultData[i], 2);
  }
  return error;
};

const WORKER_COUNT = navigator.hardwareConcurrency || 4;
const workers = Array.from({ length: WORKER_COUNT }, () =>
  new Worker(new URL("./eval.worker.js", import.meta.url), { type: "module" })
);

const evaluateGenes = (genes) =>
  new Promise((resolve) => {
    const chunkSize = Math.ceil(genes.length / WORKER_COUNT);
    let remaining = WORKER_COUNT;
    const allResults = [];
    workers.forEach((worker, i) => {
      const chunk = genes.slice(i * chunkSize, (i + 1) * chunkSize);
      if (!chunk.length) {
        remaining--;
        return;
      }
      worker.onmessage = ({ data }) => {
        allResults.push(...data);
        if (--remaining === 0) resolve(allResults);
      };
      worker.postMessage({ type: "evaluate", genes: chunk });
    });
  });

const waitForFrame = (value) =>
  new Promise((resolve) => {
    if (waitForPause) {
      waitForPause();
      return new Error();
    }
    return requestAnimationFrame(() => resolve(value));
  });

const findBest = (options) =>
  Promise.resolve(
    options.reduce((best, option) =>
      option.error < best.error ? option : best
    )
  );

const rand = (from = 1, to = 0) => from + Math.random() * (to - from);
const vary = (spread = 1, original = 0) => original + rand(-spread, spread);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

let temperature = 1.0;

const mutateShape = (shape) =>
  Object.assign({}, shape, {
    size: rand() < 0.5 ? shape.size : clamp(shape.size * vary(0.1 * temperature, 1), 6, Math.max(height, width) / 2),
    x: rand() < 0.5 ? shape.x : clamp(vary(width / 10 * temperature, shape.x), 0, width),
    y: rand() < 0.5 ? shape.y : clamp(vary(height / 10 * temperature, shape.y), 0, height),
    r: rand() < 0.5 ? shape.r : clamp(vary(16 * temperature, shape.r), 0, 255),
    g: rand() < 0.5 ? shape.g : clamp(vary(16 * temperature, shape.g), 0, 255),
    b: rand() < 0.5 ? shape.b : clamp(vary(16 * temperature, shape.b), 0, 255),
    a: rand() < 0.5 ? shape.a : clamp(vary(0.05 * temperature, shape.a), MIN_ALPHA, 1),
  });

const sortBySize = (a, b) => (a.a > b.a ? -1 : 1);

const mutate = (gene) => {
  const shapes = gene.shapes.slice(0);
  const newGene = Object.assign({}, gene, { error: false });
  if (rand() < 0.2 && shapes.length > 0) {
    shapes.splice(Math.floor(rand(shapes.length)), 1);
  }
  const mutateCount = Math.min(shapes.length, 2 + Math.floor(rand() < 0.3 ? 1 : 0));
  for (let m = 0; m < mutateCount; m++) {
    const mutateIndex = Math.floor(rand(shapes.length));
    shapes[mutateIndex] = mutateShape(shapes[mutateIndex]);
  }
  if (shapes.length < MAX_SHAPES) {
    shapes.push({
      x: rand(width),
      y: rand(height),
      size: clamp(
        (Math.pow(rand(), 2) * Math.max(height, width)) / 2,
        3,
        Math.max(height, width) / 2
      ),
      r: rand(256),
      g: rand(256),
      b: rand(256),
      a: rand(MIN_ALPHA, 1),
    });
  }
  shapes.sort(sortBySize);
  newGene.shapes = shapes;
  return newGene;
};

const sortByError = (a, b) => (a.error > b.error ? 1 : -1);

let generationCount = 0;

const crossover = (geneA, geneB) => {
  const lenA = geneA.shapes.length;
  const lenB = geneB.shapes.length;
  const maxLen = Math.max(lenA, lenB);
  const shapes = [];
  for (let i = 0; i < maxLen; i++) {
    const fromA = i < lenA ? geneA.shapes[i] : null;
    const fromB = i < lenB ? geneB.shapes[i] : null;
    if (fromA && fromB) shapes.push(Math.random() < 0.5 ? fromA : fromB);
    else if (fromA) shapes.push(fromA);
    else if (fromB) shapes.push(fromB);
  }
  return { shapes: shapes.slice(0, MAX_SHAPES) };
};

const procreate = (results) => {
  generationCount++;
  const survivors = results.sort(sortByError).slice(0, SURVIVORS);
  const genes = [];
  survivors.forEach((result) => {
    genes.push(result.gene);
    const offspringCount = GENERATION_SIZE / SURVIVORS - 1;
    const crossoverCount = Math.floor(offspringCount / 2);
    for (let j = 0; j < crossoverCount; j++) {
      const otherIndex = Math.floor(Math.random() * survivors.length);
      const child = crossover(result.gene, survivors[otherIndex].gene);
      genes.push(mutate(child));
    }
    for (let j = crossoverCount; j < offspringCount; j++) {
      genes.push(mutate(result.gene));
    }
  });
  return genes;
};

let bestOfRun;
let pendingBest = null;

const drawPreview = (best) => {
  if (!bestOfRun || best.error < bestOfRun.error) {
    bestOfRun = best;
    pendingBest = best;
  }
  return best;
};

const uiLoop = () => {
  if (bestOfRun) {
    const maxError = width * height * 4 * (255 * 255);
    const similarity = (1 - bestOfRun.error / maxError) * 100;
    scoreElement.innerHTML = `gen ${generationCount} | ${similarity.toFixed(4)}% | ${bestOfRun.gene.shapes.length} circles | temp ${temperature.toFixed(3)}`;
  }
  if (pendingBest) {
    const best = pendingBest;
    pendingBest = null;
    geneToDataURL(best.gene, 1).then((src) => {
      previewElement.src = src;
    });
  }
  requestAnimationFrame(uiLoop);
};
requestAnimationFrame(uiLoop);

const drawPreviewOfBestResult = (results) =>
  findBest(results)
    .then(drawPreview)
    .then(() => Promise.resolve(results));

const iterate = (genes) =>
  evaluateGenes(genes)
    .then(drawPreviewOfBestResult)
    .then(procreate)
    .then((newGenes) => new Promise((resolve) => setTimeout(() => resolve(newGenes), 0)))
    .then((newGenes) => {
      temperature = Math.max(0.5, temperature * 0.9998);
      return iterate(newGenes);
    });

let rawGradient = null;
let gradientMax = 1;
let contrastGamma = 1;
let currentWeightCanvas = null;

const computeRawGradient = (imageData, w, h) => {
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    gray[i] = 0.299 * imageData[i * 4] + 0.587 * imageData[i * 4 + 1] + 0.114 * imageData[i * 4 + 2];
  }
  const gradient = new Float32Array(w * h);
  let maxG = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const gx =
        -gray[(y-1)*w+(x-1)] + gray[(y-1)*w+(x+1)]
        - 2*gray[y*w+(x-1)] + 2*gray[y*w+(x+1)]
        - gray[(y+1)*w+(x-1)] + gray[(y+1)*w+(x+1)];
      const gy =
        -gray[(y-1)*w+(x-1)] - 2*gray[(y-1)*w+x] - gray[(y-1)*w+(x+1)]
        + gray[(y+1)*w+(x-1)] + 2*gray[(y+1)*w+x] + gray[(y+1)*w+(x+1)];
      gradient[y*w+x] = Math.sqrt(gx*gx + gy*gy);
      if (gradient[y*w+x] > maxG) maxG = gradient[y*w+x];
    }
  }
  gradientMax = maxG;
  return gradient;
};

const gradientToWeights = (gradient, gamma) => {
  const MIN_WEIGHT = 0.01;
  const weights = new Float32Array(gradient.length);
  for (let i = 0; i < weights.length; i++) {
    const normalized = gradientMax > 0 ? gradient[i] / gradientMax : 1.0;
    weights[i] = MIN_WEIGHT + (1 - MIN_WEIGHT) * Math.pow(normalized, gamma);
  }
  return weights;
};

const updateWeightMapCanvas = (weights, w, h) => {
  const ctx = currentWeightCanvas.getContext("2d");
  const imgData = ctx.createImageData(w, h);
  const min = Math.min(...weights);
  const max = Math.max(...weights);
  const range = max - min || 1;
  for (let i = 0; i < weights.length; i++) {
    const v = Math.round(((weights[i] - min) / range) * 255);
    imgData.data[i * 4] = v;
    imgData.data[i * 4 + 1] = v;
    imgData.data[i * 4 + 2] = v;
    imgData.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
};

const applyWeights = () => {
  const weights = gradientToWeights(rawGradient, contrastGamma);
  updateWeightMapCanvas(weights, width, height);
  workers.forEach((w) => w.postMessage({ type: "setWeights", weights }));
};

const gammaSlider = document.createElement("input");
gammaSlider.type = "range";
gammaSlider.min = "0.1";
gammaSlider.max = "8";
gammaSlider.step = "0.1";
gammaSlider.value = "1";
const gammaLabel = document.createElement("label");
gammaLabel.appendChild(document.createTextNode("Contrast gamma: "));
const gammaValue = document.createTextNode("1.0");
gammaLabel.appendChild(gammaSlider);
gammaLabel.appendChild(gammaValue);
controlsDiv.appendChild(gammaLabel);
gammaSlider.addEventListener("input", () => {
  contrastGamma = parseFloat(gammaSlider.value);
  gammaValue.textContent = contrastGamma.toFixed(1);
  if (rawGradient) applyWeights();
});

const startIteratingWithImage = (srcImg) => {
  convertImageToCanvas(srcImg, CALCULATION_WIDTH / srcImg.naturalWidth).then(
    (srcCanvas) => {
      width = srcCanvas.width;
      height = srcCanvas.height;
      previewsDiv.insertBefore(makePreviewBlock("source", srcCanvas), previewsDiv.firstChild);
      const srcData = canvasToImageData(srcCanvas);
      rawGradient = computeRawGradient(srcData, width, height);
      const weights = gradientToWeights(rawGradient, contrastGamma);
      currentWeightCanvas = document.createElement("canvas");
      currentWeightCanvas.width = width;
      currentWeightCanvas.height = height;
      previewsDiv.insertBefore(makePreviewBlock("contrast mask", currentWeightCanvas), previewsDiv.lastChild);
      updateWeightMapCanvas(weights, width, height);
      workers.forEach((w) =>
        w.postMessage({ type: "init", srcData: new Uint8Array(srcData), width, height, weights })
      );
      temperature = 1.0;
      generationCount = 0;
      iterate([{ shapes: [] }]);
    }
  );
};

const fileToDataURL = (file) =>
  new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(reader.result);
    };
    reader.readAsDataURL(file);
  });

const askForFile = () =>
  new Promise((resolve) => {
    const filePicker = document.createElement("input");
    filePicker.type = "file";
    document.body.appendChild(filePicker);
    filePicker.addEventListener("change", () => {
      document.body.removeChild(filePicker);
      resolve(filePicker.files[0]);
    });
  });

const srcToImage = (src) =>
  new Promise((resolve) => {
    const srcImg = new Image();
    srcImg.src = src;
    srcImg.addEventListener("load", () => resolve(srcImg));
  });

const init = () => {
  console.log("?");
  let waitForImage;
  bestOfRun = null;
  if (USE_TEST_IMG) {
    waitForImage = srcToImage(testImage);
  } else {
    waitForImage = askForFile().then(fileToDataURL).then(srcToImage);
  }
  waitForImage.then(startIteratingWithImage);
};

init();
