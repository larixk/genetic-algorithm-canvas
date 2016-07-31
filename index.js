const resemble = require('resemblejs');

const src = 'img/ml.jpg';

const compare = (img2) => (
	new Promise((resolve, reject) => (
		res
			.compareTo(img2)
			.ignoreColors()
			.onComplete((data) => {
				const similarity = (100 - data.misMatchPercentage) / 100;
				resolve(similarity);
			})
	))
);

const res = resemble(src);
const compareToSrc = (image) => compare(image);

// const generateImage = (gene) => new Promise((resolve, reject) => {
// 	const img = new Image()
// 	img.addEventListener('load', () => convertImageToDataUri(img).then(resolve));
// 	img.addEventListener('error', reject);
// 	img.src = gene;
// });

const convertImageToDataUri = (image) => new Promise((resolve, reject) => {
	const canvas = document.createElement('canvas');
	canvas.width = image.naturalWidth;
	canvas.height = image.naturalHeight;

	canvas.getContext('2d').drawImage(image, 0, 0);
	resolve(canvas.toDataURL('image/png'));
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
	canvas.width = 300 * scale;
	canvas.height = 447 * scale;

	const ctx = canvas.getContext('2d');

	ctx.fillStyle = 'rgb(128,128,128)';
	ctx.fillRect(0,0, canvas.width, canvas.height);

	gene.shapes.forEach((shape) => {
		drawShape(shape, scale, ctx);
	});

	resolve(canvas.toDataURL('image/png'));
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
	for (var j = 0; j < 1; j++) {
		let grownShapes = gene.shapes.slice(0);
		var maxAdd = Math.random() * 1;
		for (var added = 0; added < maxAdd; added++) {
			const grey = Math.floor(Math.random() * 255);
			const r = grey; //Math.floor(Math.random() * 255);
			const g = grey; //Math.floor(Math.random() * 255);
			const b = grey; //Math.floor(Math.random() * 255);
			grownShapes.push({
				x: Math.random() * 300,
				y: Math.random() * 447,
				size: (0.03 + 0.9 * Math.pow(Math.random(), 4)) * Math.min(447, 300) / 2,
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
		generateImage(best.gene, 5).then((src) => previewElement.src = src);
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



let previewElement = new Image();
document.body.appendChild(previewElement);
iterate([previousBest.gene]);
