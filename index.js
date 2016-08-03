const CALCULATION_WIDTH = 100;
let DRAW_WIDTH = 200;
const MAX_SHAPES = 50;
const GENERATION_SIZE = 100;
const SURVIVORS = 20;

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
  .data
;

const convertImageToData = (image, scale) => convertImageToCanvas(image, scale)
  .then(canvasToImageData)
;

const generateImage = (gene, scale) => generateCanvas(gene, scale)
  .then(canvasToDataUri)
;
const generateImageData = (gene, scale) => generateCanvas(gene, scale)
  .then(canvasToImageData)
;

const compare = (srcData, resultData) => {
  let error = 0;
  for (let i = 0; i < srcData.length; i++) {
    error += Math.pow((srcData[i] - resultData[i]) / 256, 2);
  }
  return error / srcData.length;
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
  requestAnimationFrame(() => resolve(value));
});

const findBest = (options) => new Promise((resolve) => resolve(options.reduce((best, option) => (
  (option.error < best.error) ? option : best
))));

const mutate = (gene) => {
  let grownShapes = gene.shapes.map((shape) => Object.assign({}, shape, {
      size: Math.max(1, shape.size * (1 + (0.01 * (Math.random() - 0.5)))),
      x: shape.x + (0.1 * (Math.random() - 0.5)),
      y: shape.y + (0.1 * (Math.random() - 0.5)),
      r: Math.min(255, Math.max(0, shape.r + (1 * (Math.random() - 0.5)))),
      g: Math.min(255, Math.max(0, shape.g + (1 * (Math.random() - 0.5)))),
      b: Math.min(255, Math.max(0, shape.b + (1 * (Math.random() - 0.5)))),
      a: Math.min(1, Math.max(0, shape.a + (0.1 * (Math.random() - 0.5)))),
    })
  );
  if (grownShapes.length >= MAX_SHAPES) {
    grownShapes.splice(Math.floor(Math.random() * grownShapes.length), 1);
  }
  const r = Math.floor(Math.random() * 256);
  const g = Math.floor(Math.random() * 256);
  const b = Math.floor(Math.random() * 256);
  const a = Math.random();
  grownShapes.push({
    x: Math.random() * width,
    y: Math.random() * height,
    size: (Math.pow(Math.random(), 2) * Math.max(height, width)),
    r,
    g,
    b,
    a,
  });
  grownShapes.sort((a, b) => {
    if (a.size > b.size) {
      return -1;
    }
    return 1;
  });
  return Object.assign({}, gene, {
    shapes: grownShapes,
  });
};

const procreate = (results) => {
  const genes = [];
  results.sort((a, b) => {
    if (a.error > b.error) {
      return 1;
    }
    return -1;
  }).slice(0, SURVIVORS).forEach((result) => {
    genes.push(result.gene);
    for (let j = 0; j < (GENERATION_SIZE / SURVIVORS) - 1; j++) {
      genes.push(mutate(result.gene));
    }
  });

  return genes;
};

let lowestErrorEver = Number.POSITIVE_INFINITY;
const drawPreview = (best) => {
  if (best.error < lowestErrorEver) {
    lowestErrorEver = best.error;
    scoreElement.innerHTML = 1 - Math.sqrt(best.error);
    window.best = best;
    generateImage(best.gene, DRAW_WIDTH / CALCULATION_WIDTH)
      .then((src) => {
        previewElement.src = src;
      });
  }
  return best;
};

const iterate = (genes, srcData) => runGeneration(genes, srcData)
  .then((results) => new Promise((resolve) => {
    findBest(results)
      .then(drawPreview)
      .then(() => resolve(results));
  }))
  .then(procreate)
  .then(waitForFrame)
  .then((newGenes) => iterate(newGenes, srcData))
;

const srcImgLoaded = (srcImg) => {
  width = CALCULATION_WIDTH;
  height = (CALCULATION_WIDTH / srcImg.naturalWidth) * srcImg.naturalHeight;
  convertImageToData(srcImg, CALCULATION_WIDTH / srcImg.naturalWidth).then((srcData) => {
    iterate([{ shapes: [] }], srcData);
  });
};

const init = () => {
  const filePicker = document.createElement('input');
  filePicker.type = 'file';
  document.body.appendChild(filePicker);
  filePicker.addEventListener('change', () => {
    const reader = new FileReader();
    reader.onload = () => {
      const srcImg = new Image();
      srcImg.src = reader.result;
      srcImg.addEventListener('load', () => srcImgLoaded(srcImg));
    };
    document.body.removeChild(filePicker);
    reader.readAsDataURL(filePicker.files[0]);
  });
  filePicker.click();
};

init();
