let srcData, width, height, weights, grayscale = false;

const drawShape = (shape, scale, ctx) => {
  const rgb = ["r", "g", "b"].map((c) => Math.round(shape[c])).join(",");
  ctx.fillStyle = `rgba(${rgb},${shape.a})`;
  ctx.beginPath();
  ctx.arc(shape.x * scale, shape.y * scale, shape.size * scale, 0, 2 * Math.PI);
  ctx.fill();
};

const geneToCanvas = (gene, scale) => {
  const canvas = new OffscreenCanvas(width * scale, height * scale);
  const ctx = canvas.getContext("2d");
  gene.shapes.forEach((shape) => {
    drawShape(shape, scale, ctx);
  });
  return canvas;
};

const canvasToImageData = (canvas) =>
  canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;


const compare = (src, resultData) => {
  let error = 0;
  const pixels = weights.length;
  for (let p = 0; p < pixels; p++) {
    const w = weights[p];
    const i = p * 4;
    if (grayscale) {
      const srcL = 0.299 * src[i] + 0.587 * src[i+1] + 0.114 * src[i+2];
      const resL = 0.299 * resultData[i] + 0.587 * resultData[i+1] + 0.114 * resultData[i+2];
      error += w * Math.pow(srcL - resL, 2);
    } else {
      error += w * (
        Math.pow(src[i]   - resultData[i],   2) +
        Math.pow(src[i+1] - resultData[i+1], 2) +
        Math.pow(src[i+2] - resultData[i+2], 2) +
        Math.pow(src[i+3] - resultData[i+3], 2)
      );
    }
  }
  return error;
};

self.onmessage = ({ data }) => {
  if (data.type === "init") {
    srcData = data.srcData;
    width = data.width;
    height = data.height;
    weights = data.weights;
    return;
  }

  if (data.type === "setWeights") {
    weights = data.weights;
    return;
  }

  if (data.type === "setGrayscale") {
    grayscale = data.value;
    return;
  }

  if (data.type === "evaluate") {
    const results = data.genes.map((gene) => {
      const canvas = geneToCanvas(gene, 1);
      const imageData = canvasToImageData(canvas);
      const error = compare(srcData, imageData);
      return { gene, error };
    });
    self.postMessage(results);
  }
};
