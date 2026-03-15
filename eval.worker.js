let srcData, width, height;

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
  const len = src.length;
  for (let i = 0; i < len; i++) {
    error = error + Math.pow(src[i] - resultData[i], 2);
  }
  return error;
};

self.onmessage = ({ data }) => {
  if (data.type === "init") {
    srcData = data.srcData;
    width = data.width;
    height = data.height;
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
