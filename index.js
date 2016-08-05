const CALCULATION_WIDTH = 100;
let DRAW_WIDTH = 200;
const MAX_SHAPES = 32;
const USE_TEST_IMG = true;

const MIN_ALPHA = 0.2;

let waitForPause;

const GENERATION_SIZE = 20;
const SURVIVORS = 4;

const previewElement = new Image();
document.body.appendChild(previewElement);

const scoreElement = document.createElement('p');
document.body.appendChild(scoreElement);

document.addEventListener('keydown', (event) => {
  if (event.key === '=') {
    DRAW_WIDTH *= 1.1;
  }
  if (event.key === '-') {
    DRAW_WIDTH /= 1.1;
  }
});

let width;
let height;

const convertImageToCanvas = (image, scale) => {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth * scale;
  canvas.height = image.naturalHeight * scale;

  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  return Promise.resolve(canvas);
};

const drawShape = (shape, scale, ctx) => {
  const rgb = ['r', 'g', 'b'].map((c) => Math.round(shape[c])).join(',');
  ctx.fillStyle = `rgba(${rgb},${shape.a})`;
  ctx.beginPath();
  ctx.arc(shape.x * scale, shape.y * scale, shape.size * scale, 0, 2 * Math.PI);
  ctx.fill();
};

const geneToCanvas = (gene, scale) => {
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;

  const ctx = canvas.getContext('2d');
  gene.shapes.forEach((shape) => {
    drawShape(shape, scale, ctx);
  });

  return Promise.resolve(canvas);
};

const canvasToDataURL = (canvas) => canvas.toDataURL();

const canvasToImageData = (canvas) => canvas
  .getContext('2d')
  .getImageData(0, 0, canvas.width, canvas.height)
  .data;

const imageToDataURL = (image, scale) => convertImageToCanvas(image, scale)
  .then(canvasToImageData);

const geneToDataURL = (gene, scale) => geneToCanvas(gene, scale)
  .then(canvasToDataURL);

const geneToImageData = (gene, scale) => geneToCanvas(gene, scale)
  .then(canvasToImageData);

const compare = (srcData, resultData) => {
  let error = 0;
  const len = srcData.length;
  for (let i = 0; i < len; i++) {
    error = error + Math.pow((srcData[i] - resultData[i]) / 256, 2);
  }
  return error / len;
};


const evaluateGenes = (genes, calculateError) => Promise.all(
  genes.map((gene) => geneToImageData(gene, 1)
    .then(calculateError)
    .then((error) => ({
      gene,
      error,
    }))
  )
);

const waitForFrame = (value) => new Promise((resolve) => {
  if (waitForPause) {
    waitForPause();
    return new Error();
  }
  return requestAnimationFrame(() => resolve(value));
});

const findBest = (options) => Promise.resolve(options.reduce((best, option) => (
  (option.error < best.error) ? option : best
)));

const rand = (from = 1, to = 0) => from + (Math.random() * (to - from));
const vary = (spread = 1, original = 0) => original + rand(-spread, spread);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const mutateShape = (shape) => Object.assign({}, shape, {
  size: clamp(shape.size * vary(0.1, 1), 2, Math.max(height, width)),
  x: vary(1, shape.x),
  y: vary(1, shape.y),
  r: clamp(vary(16, shape.r), 0, 255),
  g: clamp(vary(16, shape.g), 0, 255),
  b: clamp(vary(16, shape.b), 0, 255),
  a: clamp(vary(0.01, shape.a), MIN_ALPHA, 1),
});

const sortBySize = (a, b) => (a.size > b.size ? -1 : 1);

const mutate = (gene) => {
  const shapes = gene.shapes.slice(0);
  const newGene = Object.assign({}, gene, { error: false });
  if (rand() < 0.5 && shapes.length >= MAX_SHAPES) {
    shapes.splice(Math.floor(rand(shapes.length)), 1);
  } else if (shapes.length) {
    const mutateIndex = Math.floor(rand(shapes.length));
    shapes[mutateIndex] = mutateShape(shapes[mutateIndex]);
  }
  while (shapes.length < MAX_SHAPES) {
    shapes.push({
      x: rand(width),
      y: rand(height),
      size: clamp((Math.pow(rand(), 2) * Math.max(height, width)), 2, Math.max(height, width)),
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

const procreate = (results) => {
  const genes = [];
  results
    .sort(sortByError)
    .slice(0, SURVIVORS)
    .forEach((result) => {
      genes.push(result.gene);
      for (let j = 0; j < (GENERATION_SIZE / SURVIVORS) - 1; j++) {
        genes.push(mutate(result.gene));
      }
    });
  return genes;
};

let bestOfRun;
const drawPreview = (best) => {
  if (!bestOfRun || best.error < bestOfRun.error) {
    scoreElement.innerHTML = 1 - Math.sqrt(best.error);
    bestOfRun = best;
    geneToDataURL(best.gene, DRAW_WIDTH / CALCULATION_WIDTH)
      .then((src) => {
        previewElement.src = src;
      });
  }
  return best;
};

const drawPreviewOfBestResult = (results) => findBest(results)
  .then(drawPreview)
  .then(() => Promise.resolve(results));

const iterate = (genes, calculateError) => evaluateGenes(genes, calculateError)
  .then(drawPreviewOfBestResult)
  .then(procreate)
  .then(waitForFrame)
  .then((newGenes) => iterate(newGenes, calculateError));

const startIteratingWithImage = (srcImg) => {
  width = CALCULATION_WIDTH;
  height = (CALCULATION_WIDTH / srcImg.naturalWidth) * srcImg.naturalHeight;
  imageToDataURL(srcImg, CALCULATION_WIDTH / srcImg.naturalWidth).then((srcData) => {
    iterate([{ shapes: [] }], (imageData) => compare(srcData, imageData));
  });
};

const fileToDataURL = (file) => new Promise((resolve) => {
  const reader = new FileReader();
  reader.onload = () => {
    resolve(reader.result);
  };
  reader.readAsDataURL(file);
});

const askForFile = () => new Promise((resolve) => {
  const filePicker = document.createElement('input');
  filePicker.type = 'file';
  document.body.appendChild(filePicker);
  filePicker.addEventListener('change', () => {
    document.body.removeChild(filePicker);
    resolve(filePicker.files[0]);
  });
});

const srcToImage = (src) => new Promise((resolve) => {
  const srcImg = new Image();
  srcImg.src = src;
  srcImg.addEventListener('load', () => resolve(srcImg));
});

const init = () => {
  let waitForImage;
  bestOfRun = null;
  if (USE_TEST_IMG) {
    waitForImage = srcToImage('test.jpg');
  } else {
    waitForImage = askForFile()
      .then(fileToDataURL)
      .then(srcToImage);
  }
  waitForImage.then(startIteratingWithImage);
};

init();
