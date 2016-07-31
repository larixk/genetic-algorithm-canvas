const resemble = require('resemblejs');


// const generateImage = (gene) => new Promise((resolve, reject) => {
// 	const img = new Image()
// 	img.addEventListener('load', () => convertImageToDataUri(img).then(resolve));
// 	img.addEventListener('error', reject);
// 	img.src = gene;
// });

const convertImageToDataUri = (image, scale) => new Promise((resolve, reject) => {
	scale = scale || 1;
	const canvas = document.createElement('canvas');
	canvas.width = image.naturalWidth * scale;
	canvas.height = image.naturalHeight * scale;

	canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
	resolve(canvas.toDataURL());
});

const drawShape = (shape, scale, ctx) => {
	ctx.fillStyle = shape.color;
	ctx.beginPath();
	ctx.arc(shape.x * scale, shape.y * scale, shape.size * scale, 0, 2*Math.PI);
	ctx.fill();
}

const generateImage = (gene, scale) => new Promise((resolve, reject) => {
	scale = scale || 1;
	const canvas = document.createElement('canvas');
	canvas.width = width * scale;
	canvas.height = height * scale;

	const ctx = canvas.getContext('2d');

	ctx.fillStyle = 'rgb(255,255,255)';
	ctx.fillRect(0,0, canvas.width, canvas.height);

	gene.shapes.forEach((shape) => {
		drawShape(shape, scale, ctx);
	});

	resolve(canvas.toDataURL());
});

const runGeneration = (genes) => Promise.all(
	genes.slice(1).map((gene, index) => generateImage(gene, 1)
		.then((image) => compareToSrc(image)
			.then((similarity) => ({
				gene,
				similarity,
				image
			}))
		)
	).concat([new Promise((resolve) => {
		resolve(previousBest);
	})])
);

let previousBest = {
	gene: {shapes: []},
	similarity: -1
};

const log = (input) => {
	console.log(input.similarity);
	console.count('generation');
	return input;
};

const waitForFrame = (value) => new Promise((resolve) => {
	requestAnimationFrame(() => resolve(value));
});

const findBest = (options) => options.reduce((best, option) =>
	(option.similarity >= best.similarity) ? option : best
);

const procreate = (gene) => {
	const genes = [gene];

	// if (gene.shapes.length < 10) {
	for (var j = 0; j < 4; j++) {
		let grownShapes = gene.shapes.slice(0);
		var maxAdd = Math.random() * 1;
		for (var added = 0; added < maxAdd; added++) {
			const FORCE_GRAYSCALE = true;
			let grey = Math.floor(Math.random() * 255);
			const r = FORCE_GRAYSCALE ? grey : Math.floor(Math.random() * 255);
			const g = FORCE_GRAYSCALE ? grey : Math.floor(Math.random() * 255);
			const b = FORCE_GRAYSCALE ? grey : Math.floor(Math.random() * 255);
			grownShapes.push({
				x: Math.random() * width,
				y: Math.random() * height,
				size: (0.03 + 0.9 * Math.pow(Math.random(), 4)) * Math.min(height, width) / 2,
				color: `rgba(${r}, ${g}, ${b}, ${Math.random()})`
			});
		}
		// grownShapes.sort((a, b) => {
		// 	if (a.size > b.size) {
		// 		return -1
		// 	}
		// 	return 1;
		// })
		genes.push(Object.assign({}, gene, {
			shapes: grownShapes
		}));
	}

	for (var j = 0; j < 1; j++) {
	// if (gene.shapes.length > 10) {
		grownShapes = gene.shapes.slice(0);
		var maxRemove = Math.random() * 1;
		for (var removing = 0; removing < maxRemove; removing++) {
			grownShapes.splice(Math.floor(grownShapes.length * Math.random()), 1);
		}
		genes.push(Object.assign({}, gene, {
			shapes: grownShapes
		}));

	// }
	}

	return genes;
};


const drawPreview = (best) => {
	if (best.similarity > previousBest.similarity) {
		previousBest.similarity = best.similarity;
		generateImage(best.gene, 20).then((src) => previewElement.src = src);
		console.log(best.similarity);
	}
	return best;
};

const cacheBest = (best) => {
	previousBest = best;
	return best;
}

const iterate = (genes) => runGeneration(genes)
	.then(findBest)
	.then(drawPreview)
	// .then(log)
	.then(cacheBest)
	.then((best) => best.gene)
	.then(procreate)
	.then(waitForFrame)
	.then(iterate)
;


let src = 'img/foto.JPG';

const compare = (img1, img2) => (
	new Promise((resolve, reject) => (
		resemble(img1)
			.compareTo(img2)
			.ignoreColors()
			.onComplete((data) => {
				const similarity = (100 - data.misMatchPercentage) / 100;
				resolve(similarity);
			})
	))
);


const compareData = (data1, data2) => {
	let errors = 0;
	const threshold = 50;
	for (var i = 0; i < data1.length; i+= 4) {
		const d = Math.abs(data1[i] - data[i]);
		if (d > threshold) {
			errors += 1;
		}
	}
	return errors / (data1.length * 4);
}

const compareToSrc = (image) => compare(src, image);
let width, height;

const srcImg = new Image();
srcImg.addEventListener('load', () => {
	console.log('loaded');
	const scale = 0.05;
	width = srcImg.naturalWidth * scale;
	height = srcImg.naturalHeight * scale;
	convertImageToDataUri(srcImg, scale).then((srcData) => {
		src = srcData;
		iterate([previousBest.gene]);
	})
});
srcImg.src = src;

let previewElement = new Image();
document.body.appendChild(previewElement);
