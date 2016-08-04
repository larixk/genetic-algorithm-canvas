const CALCULATION_WIDTH = 100;
let DRAW_WIDTH = 200;
const MAX_SHAPES = 32;
const USE_TEST_IMG = true;

let waitForPause;

let geneticOptions = {
  generationSize: 30,
  survivors: 10,
};


const previewElement = new Image();
document.body.appendChild(previewElement);

const scoreElement = document.createElement('p');
document.body.appendChild(scoreElement);

const averageElement = document.createElement('p');
document.body.appendChild(averageElement);

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

const convertImageToCanvas = (image, scale) => new Promise((resolve) => {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth * scale;
  canvas.height = image.naturalHeight * scale;

  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  resolve(canvas);
});

const drawShape = (shape, scale, ctx) => {
  ctx.fillStyle = `rgba(${Math.round(shape.r)}, ${Math.round(shape.g)}, ${Math.round(shape.b)}, ${shape.a})`;
  ctx.beginPath();
  ctx.arc(shape.x * scale, shape.y * scale, shape.size * scale, 0, 2 * Math.PI);
  ctx.fill();
};

const generateCanvas = (gene, scale) => new Promise((resolve) => {
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;

  const ctx = canvas.getContext('2d');
  gene.shapes.forEach((shape) => {
    drawShape(shape, scale, ctx);
  });

  resolve(canvas);
});

const canvasToDataUri = (canvas) => canvas.toDataURL();

const canvasToImageData = (canvas) => canvas
  .getContext('2d')
  .getImageData(0, 0, canvas.width, canvas.height)
  .data;

const convertImageToData = (image, scale) => convertImageToCanvas(image, scale)
  .then(canvasToImageData);

const generateImage = (gene, scale) => generateCanvas(gene, scale)
  .then(canvasToDataUri);

const generateImageData = (gene, scale) => generateCanvas(gene, scale)
  .then(canvasToImageData);

const compare = (srcData, resultData) => {
  let error = 0, len = srcData.length;
  for (let i = 0; i < len; i++) {
    error += Math.pow((srcData[i] - resultData[i]) / 256, 2);
  }
  return error / len;
};

const runGeneration = (genes, srcData) => Promise.all(
  genes.map((gene) => generateImageData(gene, 1)
    .then((imageData) => ({
      gene,
      error: compare(srcData, imageData),
    }))
  )
);

const waitForFrame = (value) => new Promise((resolve) => {
  if (waitForPause) {
    waitForPause();
    return new Error();
  }
  requestAnimationFrame(() => resolve(value));
});

const findBest = (options) => new Promise((resolve) => resolve(options.reduce((best, option) => (
  (option.error < best.error) ? option : best
))));

const rand = (from = 1, to = 0) => from + (Math.random() * (to - from));
const vary = (spread = 1, original = 0) => original + rand(-spread, spread);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const mutateShape = (shape) => Object.assign({}, {
  size: clamp(shape.size * vary(0.01, 1), 2, Math.max(height, width)),
  x: vary(0.5, shape.x),
  y: vary(0.5, shape.y),
  r: clamp(vary(1, shape.r), 0, 255),
  g: clamp(vary(1, shape.g), 0, 255),
  b: clamp(vary(1, shape.b), 0, 255),
  a: clamp(vary(0.01, shape.a), 0.8, 1),
});

const sortBySize = (a, b) => (a.size > b.size ? -1 : 1);

const mutate = (gene) => {
  const grownShapes = gene.shapes.map(mutateShape);
  if (rand() < 0.2 && grownShapes.length >= MAX_SHAPES) {
    grownShapes.splice(Math.floor(rand(grownShapes.length)), 1);
  }
  while (grownShapes.length < MAX_SHAPES) {
    grownShapes.push({
      x: rand(width),
      y: rand(height),
      size: clamp((Math.pow(rand(), 2) * Math.max(height, width)), 2, Math.max(height, width)),
      r: Math.floor(rand(256)),
      g: Math.floor(rand(256)),
      b: Math.floor(rand(256)),
      a: rand(0.8, 1),
    });
  }
  grownShapes.sort(sortBySize);
  return Object.assign({}, gene, {
    shapes: grownShapes,
  });
};

const sortByError = (a, b) => (a.error > b.error ? 1 : -1);

const procreate = (results) => {
  const genes = [];
  results
    .sort(sortByError)
    .slice(0, geneticOptions.survivors)
    .forEach((result) => {
      genes.push(result.gene);
      for (let j = 0; j < (geneticOptions.generationSize / geneticOptions.survivors) - 1; j++) {
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
    generateImage(best.gene, DRAW_WIDTH / CALCULATION_WIDTH)
      .then((src) => {
        previewElement.src = src;
      });
  }
  return best;
};

const iterate = (genes, srcData) => runGeneration(genes, srcData)
  .then((results) => new Promise((resolve) => {
    const avg = 1 - Math.sqrt(results.reduce((total, b) => total + b.error, 0) / results.length);
    averageElement.innerHTML = avg;
    findBest(results)
      .then(drawPreview)
      .then(() => resolve(results));
  }))
  .then(procreate)
  .then(waitForFrame)
  .then((newGenes) => iterate(newGenes, srcData))
  .catch(() => {
    console.log('finished');
  });

const startIteratingWithImage = (srcImg) => {
  width = CALCULATION_WIDTH;
  height = (CALCULATION_WIDTH / srcImg.naturalWidth) * srcImg.naturalHeight;
  convertImageToData(srcImg, CALCULATION_WIDTH / srcImg.naturalWidth).then((srcData) => {
    iterate([{ shapes: [] }], srcData);
  });
};

const srcToImage = (src) => new Promise((resolve) => {
  const srcImg = new Image();
  srcImg.src = src;
  srcImg.addEventListener('load', () => resolve(srcImg));
});

const fileToDataUrl = (file) => new Promise((resolve) => {
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

const init = () => {
  let waitForImage;
  bestOfRun = null;
  if (USE_TEST_IMG) {
    waitForImage = srcToImage('test.jpg');
  } else {
    waitForImage = askForFile()
      .then(fileToDataUrl)
      .then(srcToImage);
  }
  waitForImage.then(startIteratingWithImage);
};

init();

const startEvaluator = () => {
  let bestOptions;
  let bestError;

  const end = () => {
    waitForPause = () => {
      console.log('done');
      console.log(bestOfRun.error);
      if (!bestError || bestOfRun.error < bestError) {
        bestError = bestOfRun.error;
        bestOptions = geneticOptions;
        console.log(bestOptions);
      }
      waitForPause = null;
      start();
    };
  };

  let attempt = 0;
  const start = () => {
    geneticOptions = Object.assign({}, geneticOptions);
    if (attempt % 2) {
      geneticOptions.generationSize += 5;
    } else {
      geneticOptions.survivors += 1;
    }
    init();

    attempt++;
    setTimeout(end, 15000);
  };

  start();
};
// startEvaluator();
