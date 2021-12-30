import testImage from "./test.jpg";

const CALCULATION_WIDTH = 200;
let DRAW_WIDTH = window.innerWidth - 80;
const MAX_SHAPES = 32;
const USE_TEST_IMG = false;

const MIN_ALPHA = 0.5;

let waitForPause;

const GENERATION_SIZE = 100;
const SURVIVORS = 10;

const previewElement = new Image();
document.body.appendChild(previewElement);

const scoreElement = document.createElement("p");
document.body.appendChild(scoreElement);

document.addEventListener("keydown", (event) => {
  if (event.key === "=") {
    DRAW_WIDTH *= 1.1;
  }
  if (event.key === "-") {
    DRAW_WIDTH /= 1.1;
  }
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

const evaluateGenes = (genes, calculateError) =>
  Promise.all(
    genes.map((gene) =>
      geneToImageData(gene, 1)
        .then(calculateError)
        .then((error) => ({
          gene,
          error,
        }))
    )
  );

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

const mutateShape = (shape) =>
  Object.assign({}, shape, {
    size:
      rand() > 0.9
        ? shape.size
        : clamp(shape.size * vary(0.1, 1), 4, Math.max(height, width) / 2),
    x: rand() < 0.9 ? shape.x : clamp(vary(width / 10, shape.x), 0, width),
    y: rand() < 0.9 ? shape.y : clamp(vary(height / 10, shape.y), 0, height),
    r: rand() < 0.9 ? shape.r : clamp(vary(16, shape.r), 0, 255),
    g: rand() < 0.9 ? shape.g : clamp(vary(16, shape.g), 0, 255),
    b: rand() < 0.9 ? shape.b : clamp(vary(16, shape.b), 0, 255),
    a: rand() < 0.9 ? shape.a : clamp(vary(0.05, shape.a), MIN_ALPHA, 1),
  });

const sortBySize = (a, b) => (a.a > b.a ? -1 : 1);

const mutate = (gene) => {
  const shapes = gene.shapes.slice(0);
  const newGene = Object.assign({}, gene, { error: false });
  while (rand() < 0.2 && shapes.length > 0) {
    shapes.splice(Math.floor(rand(shapes.length)), 1);
  }
  if (shapes.length) {
    const mutateIndex = Math.floor(rand(shapes.length));
    shapes[mutateIndex] = mutateShape(shapes[mutateIndex]);
  }
  if (shapes.length < MAX_SHAPES) {
    shapes.push({
      x: rand(width),
      y: rand(height),
      size: clamp(
        (Math.pow(rand(), 2) * Math.max(height, width)) / 2,
        4,
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

const procreate = (results) => {
  const genes = [];
  results
    .sort(sortByError)
    .slice(0, SURVIVORS)
    .forEach((result) => {
      genes.push(result.gene);
      for (let j = 0; j < GENERATION_SIZE / SURVIVORS - 1; j++) {
        genes.push(mutate(result.gene));
      }
    });
  return genes;
};

let bestOfRun;
const drawPreview = (best) => {
  if (!bestOfRun || best.error < bestOfRun.error) {
    scoreElement.innerHTML = best.error;
    bestOfRun = best;
    geneToDataURL(best.gene, DRAW_WIDTH / CALCULATION_WIDTH).then((src) => {
      previewElement.src = src;
    });
  }
  return best;
};

const drawPreviewOfBestResult = (results) =>
  findBest(results)
    .then(drawPreview)
    .then(() => Promise.resolve(results));

const iterate = (genes, calculateError) =>
  evaluateGenes(genes, calculateError)
    .then(drawPreviewOfBestResult)
    .then(procreate)
    .then(waitForFrame)
    .then((newGenes) => iterate(newGenes, calculateError));

const startIteratingWithImage = (srcImg) => {
  width = CALCULATION_WIDTH;
  height = (CALCULATION_WIDTH / srcImg.naturalWidth) * srcImg.naturalHeight;
  imageToDataURL(srcImg, CALCULATION_WIDTH / srcImg.naturalWidth).then(
    (srcData) => {
      iterate([{ shapes: [] }], (imageData) => compare(srcData, imageData));
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
