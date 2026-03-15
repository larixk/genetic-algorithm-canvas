import { useRef, useState, useCallback, useEffect } from 'react';
import { mutate, crossover, procreate, computeRawGradient, gradientToWeights, MAX_SHAPES } from './algorithm';

const CALCULATION_WIDTH = 128;
const WORKER_COUNT = navigator.hardwareConcurrency || 4;
const GENERATION_SIZE = 100;
const SURVIVORS = 10;
const BRUSH_RADIUS = 3;
const MASK_MIN_WEIGHT = 0.05;

function renderMaskToCanvas(canvas, weights, w, h) {
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(w, h);
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < weights.length; i++) {
    if (weights[i] < min) min = weights[i];
    if (weights[i] > max) max = weights[i];
  }
  const range = max - min || 1;
  for (let i = 0; i < weights.length; i++) {
    const v = Math.round(((weights[i] - min) / range) * 255);
    imgData.data[i * 4] = v;
    imgData.data[i * 4 + 1] = v;
    imgData.data[i * 4 + 2] = v;
    imgData.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
}

function downloadGeneSVG(gene, w, h) {
  const shapes = gene.shapes.map((s) =>
    `<circle cx="${s.x.toFixed(2)}" cy="${s.y.toFixed(2)}" r="${s.size.toFixed(2)}" fill="rgba(${Math.round(s.r)},${Math.round(s.g)},${Math.round(s.b)},${s.a.toFixed(3)})" />`
  ).join('\n  ');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n  ${shapes}\n</svg>`;
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'evolution.svg';
  a.click();
  URL.revokeObjectURL(url);
}

function drawGeneToDataURL(gene, w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  gene.shapes.forEach((shape) => {
    ctx.fillStyle = `rgba(${Math.round(shape.r)},${Math.round(shape.g)},${Math.round(shape.b)},${shape.a})`;
    ctx.beginPath();
    ctx.arc(shape.x, shape.y, shape.size, 0, 2 * Math.PI);
    ctx.fill();
  });
  return canvas.toDataURL();
}

export default function App() {
  const [phase, setPhase] = useState('idle'); // 'idle' | 'ready' | 'running'
  const [isPaused, setIsPaused] = useState(false);
  const [sourceImgSrc, setSourceImgSrc] = useState(null);
  const [previewImgSrc, setPreviewImgSrc] = useState(null);
  const [stats, setStats] = useState(null);
  const [grayscale, setGrayscale] = useState(false);
  const [gamma, setGamma] = useState(1.0);
  const [isDragging, setIsDragging] = useState(false);
  const [pendingImage, setPendingImage] = useState(null);

  const workersRef = useRef([]);
  const sessionRef = useRef(0);
  const bestGeneRef = useRef(null);
  const bestErrorRef = useRef(Infinity);
  const generationRef = useRef(0);
  const temperatureRef = useRef(1.0);
  const widthRef = useRef(0);
  const heightRef = useRef(0);
  const rawGradientRef = useRef(null);
  const gradientMaxRef = useRef(1);
  const gammaRef = useRef(1.0);
  const pendingBestRef = useRef(null);
  const animFrameRef = useRef(null);
  const lastStatsUpdateRef = useRef(0);
  const isPausedRef = useRef(false);
  const pausedGenesRef = useRef(null);
  const doIterateRef = useRef(null);
  const weightsRef = useRef(null);
  const maskCanvasNode = useRef(null);
  const isDrawingRef = useRef(false);
  const drawModeRef = useRef(1);

  // Initialize workers once
  useEffect(() => {
    workersRef.current = Array.from({ length: WORKER_COUNT }, () =>
      new Worker(new URL('./eval.worker.js', import.meta.url), { type: 'module' })
    );
    return () => workersRef.current.forEach((w) => w.terminate());
  }, []);

  // Mask canvas callback ref — renders weights when canvas mounts
  const maskCanvasRef = useCallback((canvas) => {
    maskCanvasNode.current = canvas;
    if (canvas && weightsRef.current && widthRef.current > 0) {
      renderMaskToCanvas(canvas, weightsRef.current, widthRef.current, heightRef.current);
    }
  }, []);

  const evaluateGenes = useCallback(
    (genes, session) =>
      new Promise((resolve) => {
        const workers = workersRef.current;
        const chunkSize = Math.ceil(genes.length / WORKER_COUNT);
        let remaining = 0;
        const allResults = [];
        workers.forEach((worker, i) => {
          const chunk = genes.slice(i * chunkSize, (i + 1) * chunkSize);
          if (!chunk.length) return;
          remaining++;
          worker.onmessage = ({ data }) => {
            allResults.push(...data);
            if (--remaining === 0) resolve({ results: allResults, session });
          };
          worker.postMessage({ type: 'evaluate', genes: chunk });
        });
      }),
    []
  );

  // UI animation loop
  useEffect(() => {
    const loop = () => {
      if (pendingBestRef.current) {
        const gene = pendingBestRef.current;
        pendingBestRef.current = null;
        const w = widthRef.current;
        const h = heightRef.current;
        if (w > 0 && h > 0) {
          setPreviewImgSrc(drawGeneToDataURL(gene, w, h));
        }
      }

      const now = performance.now();
      if (now - lastStatsUpdateRef.current > 120 && bestErrorRef.current < Infinity) {
        lastStatsUpdateRef.current = now;
        const maxError = widthRef.current * heightRef.current * 4 * (255 * 255);
        const similarity = (1 - bestErrorRef.current / maxError) * 100;
        setStats({
          generation: generationRef.current,
          similarity: similarity.toFixed(4),
          shapes: bestGeneRef.current?.shapes.length ?? 0,
          temperature: temperatureRef.current.toFixed(3),
        });
      }

      animFrameRef.current = requestAnimationFrame(loop);
    };
    animFrameRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, []);

  const initImage = useCallback((srcImage) => {
    const scale = CALCULATION_WIDTH / srcImage.naturalWidth;
    const offscreen = document.createElement('canvas');
    offscreen.width = Math.round(srcImage.naturalWidth * scale);
    offscreen.height = Math.round(srcImage.naturalHeight * scale);
    offscreen.getContext('2d').drawImage(srcImage, 0, 0, offscreen.width, offscreen.height);

    const w = offscreen.width;
    const h = offscreen.height;
    widthRef.current = w;
    heightRef.current = h;

    setSourceImgSrc(offscreen.toDataURL());

    const srcData = offscreen.getContext('2d').getImageData(0, 0, w, h).data;
    const { gradient, gradientMax } = computeRawGradient(srcData, w, h);
    rawGradientRef.current = gradient;
    gradientMaxRef.current = gradientMax;

    const weights = gradientToWeights(gradient, gradientMax, gammaRef.current);
    weightsRef.current = weights;

    if (maskCanvasNode.current) {
      renderMaskToCanvas(maskCanvasNode.current, weights, w, h);
    }

    workersRef.current.forEach((worker) =>
      worker.postMessage({ type: 'init', srcData: new Uint8Array(srcData), width: w, height: h, weights })
    );
  }, []);

  const startLoop = useCallback(() => {
    bestGeneRef.current = null;
    bestErrorRef.current = Infinity;
    pendingBestRef.current = null;
    generationRef.current = 0;
    temperatureRef.current = 1.0;
    isPausedRef.current = false;
    setIsPaused(false);
    pausedGenesRef.current = null;

    const session = ++sessionRef.current;
    const w = widthRef.current;
    const h = heightRef.current;

    const doIterate = (genes) => {
      if (isPausedRef.current) {
        pausedGenesRef.current = genes;
        return;
      }
      evaluateGenes(genes, session).then(({ results, session: s }) => {
        if (s !== sessionRef.current) return;

        const best = results.reduce((b, r) => (r.error < b.error ? r : b));
        if (best.error < bestErrorRef.current) {
          bestErrorRef.current = best.error;
          bestGeneRef.current = best.gene;
          pendingBestRef.current = best.gene;
        }

        generationRef.current++;
        temperatureRef.current = Math.max(0.5, temperatureRef.current * 0.9998);
        const newGenes = procreate(results, w, h, temperatureRef.current);
        setTimeout(() => doIterate(newGenes), 0);
      });
    };
    doIterateRef.current = doIterate;
    doIterate([{ shapes: [] }]);
  }, [evaluateGenes]);

  // Process image when entering 'ready' phase
  useEffect(() => {
    if (pendingImage && phase === 'ready') {
      initImage(pendingImage);
      setPendingImage(null);
    }
  }, [pendingImage, phase, initImage]);

  // Start loop when entering 'running' phase
  useEffect(() => {
    if (phase === 'running') {
      startLoop();
    }
  }, [phase, startLoop]);

  const handleStart = useCallback(() => {
    setPhase('running');
  }, []);

  const handleTogglePause = useCallback(() => {
    if (isPausedRef.current) {
      isPausedRef.current = false;
      setIsPaused(false);
      if (pausedGenesRef.current) {
        const genes = pausedGenesRef.current;
        pausedGenesRef.current = null;
        doIterateRef.current?.(genes);
      }
    } else {
      isPausedRef.current = true;
      setIsPaused(true);
    }
  }, []);

  const handleFile = useCallback((file) => {
    if (!file || !file.type.startsWith('image/')) return;
    sessionRef.current++;
    isPausedRef.current = false;
    pausedGenesRef.current = null;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        setPreviewImgSrc(null);
        setStats(null);
        setIsPaused(false);
        setPendingImage(img);
        setPhase('ready');
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }, []);

  const handleGammaChange = useCallback((newGamma) => {
    gammaRef.current = newGamma;
    setGamma(newGamma);
    if (rawGradientRef.current && widthRef.current > 0) {
      const weights = gradientToWeights(rawGradientRef.current, gradientMaxRef.current, newGamma);
      weightsRef.current = weights;
      if (maskCanvasNode.current) {
        renderMaskToCanvas(maskCanvasNode.current, weights, widthRef.current, heightRef.current);
      }
      workersRef.current.forEach((w) => w.postMessage({ type: 'setWeights', weights }));
    }
  }, []);

  const handleGrayscaleChange = useCallback((newVal) => {
    setGrayscale(newVal);
    workersRef.current.forEach((w) => w.postMessage({ type: 'setGrayscale', value: newVal }));
  }, []);

  // Mask drawing
  const paintMask = useCallback((e) => {
    const canvas = maskCanvasNode.current;
    const weights = weightsRef.current;
    if (!canvas || !weights) return;

    const rect = canvas.getBoundingClientRect();
    const cx = Math.floor((e.clientX - rect.left) * (canvas.width / rect.width));
    const cy = Math.floor((e.clientY - rect.top) * (canvas.height / rect.height));
    const w = widthRef.current;
    const h = heightRef.current;
    const targetWeight = drawModeRef.current > 0 ? 1.0 : MASK_MIN_WEIGHT;

    let changed = false;
    for (let dy = -BRUSH_RADIUS; dy <= BRUSH_RADIUS; dy++) {
      for (let dx = -BRUSH_RADIUS; dx <= BRUSH_RADIUS; dx++) {
        if (dx * dx + dy * dy > BRUSH_RADIUS * BRUSH_RADIUS) continue;
        const px = cx + dx;
        const py = cy + dy;
        if (px < 0 || px >= w || py < 0 || py >= h) continue;
        weights[py * w + px] = targetWeight;
        changed = true;
      }
    }

    if (changed) {
      renderMaskToCanvas(canvas, weights, w, h);
      workersRef.current.forEach((worker) => worker.postMessage({ type: 'setWeights', weights }));
    }
  }, []);

  const handleMaskPointerDown = useCallback((e) => {
    e.preventDefault();
    isDrawingRef.current = true;
    drawModeRef.current = e.button === 2 ? -1 : 1;
    e.target.setPointerCapture(e.pointerId);
    paintMask(e);
  }, [paintMask]);

  const handleMaskPointerMove = useCallback((e) => {
    if (!isDrawingRef.current) return;
    paintMask(e);
  }, [paintMask]);

  const handleMaskPointerUp = useCallback(() => {
    isDrawingRef.current = false;
  }, []);

  const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    handleFile(e.dataTransfer.files[0]);
  };

  const showPanels = phase === 'ready' || phase === 'running';

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-gray-100 overflow-hidden select-none font-mono">

      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-gray-800 shrink-0">
        <h1 className="text-xs font-semibold tracking-[0.2em] text-gray-500 uppercase">
          Genetic Image Approximation
        </h1>
        <div className="flex items-center gap-4">
          {phase === 'ready' && (
            <button
              onClick={handleStart}
              className="px-3 py-1 text-xs bg-green-700 hover:bg-green-600 text-white rounded transition-colors"
            >
              Start
            </button>
          )}
          {bestGeneRef.current && (
            <button
              onClick={() => downloadGeneSVG(bestGeneRef.current, widthRef.current, heightRef.current)}
              className="px-3 py-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition-colors"
            >
              Download SVG
            </button>
          )}
          {phase === 'running' && (
            <button
              onClick={handleTogglePause}
              className={`px-3 py-1 text-xs rounded transition-colors ${
                isPaused
                  ? 'bg-green-700 hover:bg-green-600 text-white'
                  : 'bg-gray-700 hover:bg-gray-600 text-gray-200'
              }`}
            >
              {isPaused ? 'Resume' : 'Pause'}
            </button>
          )}
          {stats && phase === 'running' && !isPaused ? (
            <div className="text-xs flex gap-8 text-gray-500">
              <span>gen <span className="text-gray-200">{stats.generation.toLocaleString()}</span></span>
              <span>
                similarity{' '}
                <span className="text-green-400 font-semibold">{stats.similarity}%</span>
              </span>
              <span>circles <span className="text-gray-200">{stats.shapes}</span></span>
              <span>temp <span className="text-gray-200">{stats.temperature}</span></span>
            </div>
          ) : (
            <span className="text-xs text-gray-700">
              {phase === 'idle' && 'upload an image to begin'}
              {phase === 'ready' && 'image loaded — adjust mask, then start'}
              {phase === 'running' && isPaused && (
                <span className="text-gray-500">
                  paused · gen <span className="text-gray-300">{stats?.generation.toLocaleString()}</span>
                </span>
              )}
            </span>
          )}
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden min-h-0">

        {/* Sidebar */}
        <aside className="w-60 shrink-0 border-r border-gray-800 flex flex-col p-5 gap-6 overflow-y-auto">

          {/* Upload zone */}
          <div>
            <p className="text-[10px] text-gray-600 uppercase tracking-[0.15em] mb-2">Image</p>
            <label
              className={`flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-lg p-5 cursor-pointer transition-all ${
                isDragging
                  ? 'border-blue-500 bg-blue-950/20'
                  : 'border-gray-700 hover:border-gray-500 hover:bg-gray-900/40'
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <svg className="w-7 h-7 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
              <span className="text-xs text-gray-500 text-center leading-relaxed">
                {phase !== 'idle'
                  ? 'Drop or click to\nrestart with new image'
                  : 'Drop image here\nor click to browse'}
              </span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleFile(e.target.files[0])}
              />
            </label>
          </div>

          {/* Parameters */}
          <div className="flex flex-col gap-5">
            <p className="text-[10px] text-gray-600 uppercase tracking-[0.15em]">Parameters</p>

            {/* Grayscale toggle */}
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm text-gray-300 leading-tight">Grayscale</p>
                <p className="text-[10px] text-gray-600 mt-0.5 leading-relaxed">Compare luminance only</p>
              </div>
              <button
                onClick={() => handleGrayscaleChange(!grayscale)}
                className={`mt-0.5 relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                  grayscale ? 'bg-blue-600' : 'bg-gray-700'
                }`}
              >
                <span
                  className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${
                    grayscale ? 'translate-x-5' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* Gamma slider */}
            <div className="flex flex-col gap-2">
              <div className="flex justify-between items-baseline">
                <div>
                  <p className="text-sm text-gray-300 leading-tight">Contrast gamma</p>
                  <p className="text-[10px] text-gray-600 mt-0.5 leading-relaxed">Edge-weighted sampling</p>
                </div>
                <span className="text-sm text-gray-400 shrink-0 ml-2 tabular-nums">{gamma.toFixed(1)}</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="8"
                step="0.1"
                value={gamma}
                onChange={(e) => handleGammaChange(parseFloat(e.target.value))}
                className="w-full cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-gray-700">
                <span>uniform</span>
                <span>edges only</span>
              </div>
            </div>
          </div>

          {/* Algorithm constants */}
          <div className="mt-auto pt-4 border-t border-gray-800">
            <p className="text-[10px] text-gray-600 uppercase tracking-[0.15em] mb-3">Algorithm</p>
            <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 text-xs text-gray-600">
              <span>Population</span>
              <span className="text-gray-500 text-right">{GENERATION_SIZE}</span>
              <span>Survivors</span>
              <span className="text-gray-500 text-right">{SURVIVORS}</span>
              <span>Max shapes</span>
              <span className="text-gray-500 text-right">{MAX_SHAPES}</span>
              <span>Eval res.</span>
              <span className="text-gray-500 text-right">{CALCULATION_WIDTH} px</span>
              <span>Workers</span>
              <span className="text-gray-500 text-right">{WORKER_COUNT}</span>
            </div>
          </div>
        </aside>

        {/* Main content area */}
        <main className="flex-1 min-w-0 flex items-center justify-center p-6 overflow-hidden">
          {!showPanels ? (
            <div className="text-center space-y-2">
              <p className="text-sm text-gray-700">Upload an image to begin evolution</p>
              <p className="text-xs text-gray-800">
                The algorithm will approximate it using up to {MAX_SHAPES} translucent circles
              </p>
            </div>
          ) : (
            <div className="flex gap-4 h-full w-full">
              {/* Source */}
              <div className="flex-1 flex flex-col gap-2 min-w-0 min-h-0">
                <div className="flex items-baseline gap-2 shrink-0">
                  <span className="text-xs text-gray-400 uppercase tracking-wider">Source</span>
                  <span className="text-xs text-gray-600">original</span>
                </div>
                <div className="flex-1 min-h-0 bg-gray-900 rounded-lg flex items-center justify-center overflow-hidden border border-gray-800/50">
                  {sourceImgSrc ? (
                    <img
                      src={sourceImgSrc}
                      alt="Source"
                      style={{ imageRendering: 'pixelated', width: '100%', height: '100%', objectFit: 'contain' }}
                    />
                  ) : (
                    <span className="text-xs text-gray-800">—</span>
                  )}
                </div>
              </div>

              {/* Best candidate */}
              <div className="flex-1 flex flex-col gap-2 min-w-0 min-h-0">
                <div className="flex items-baseline gap-2 shrink-0">
                  <span className="text-xs text-gray-400 uppercase tracking-wider">Best candidate</span>
                  <span className="text-xs text-gray-600">
                    {stats ? `${stats.shapes} circles` : phase === 'ready' ? '—' : 'evolving…'}
                  </span>
                </div>
                <div className="flex-1 min-h-0 bg-gray-900 rounded-lg flex items-center justify-center overflow-hidden border border-gray-800/50">
                  {previewImgSrc ? (
                    <img
                      src={previewImgSrc}
                      alt="Best candidate"
                      style={{ imageRendering: 'pixelated', width: '100%', height: '100%', objectFit: 'contain' }}
                    />
                  ) : (
                    <span className="text-xs text-gray-800">—</span>
                  )}
                </div>
              </div>

              {/* Contrast mask — drawable canvas */}
              <div className="flex-1 flex flex-col gap-2 min-w-0 min-h-0">
                <div className="flex items-baseline gap-2 shrink-0">
                  <span className="text-xs text-gray-400 uppercase tracking-wider">Contrast mask</span>
                  <span className="text-xs text-gray-600">
                    γ = {gamma.toFixed(1)} · left=highlight · right=suppress
                  </span>
                </div>
                <div className="flex-1 min-h-0 bg-gray-900 rounded-lg flex items-center justify-center overflow-hidden border border-gray-800/50">
                  <canvas
                    ref={maskCanvasRef}
                    style={{ imageRendering: 'pixelated', maxWidth: '100%', maxHeight: '100%', cursor: 'crosshair' }}
                    onPointerDown={handleMaskPointerDown}
                    onPointerMove={handleMaskPointerMove}
                    onPointerUp={handleMaskPointerUp}
                    onPointerLeave={handleMaskPointerUp}
                    onContextMenu={(e) => e.preventDefault()}
                  />
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
