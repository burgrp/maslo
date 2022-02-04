

let calib = [
    /* 0 */ { x: -1173, y: +519, a: 970, b: 2987 },
    /* 1 */ { x: +1164, y: +497, a: 2985, b: 993 },
    /* 2 */ { x: +1072, y: -524, a: 3337, b: 1961 },
    /* 3 */ { x: -1151, y: -561, a: 1972, b: 3424 },

    // /* 0 */ { x: -248, y: +136, a: 1883, b: 2288 },
    // /* 1 */ { x: +124, y: +116, a: 2194, b: 1992 },
    // /* 2 */ { x: +144, y: -202, a: 2400, b: 2186 },
    // /* 3 */ { x: -174, y: -210, a: 2171, b: 2428 },

];

let x = -1162;
let y = 77;


let data = [
    { x: 0, y: 100 },
    { x: 100, y: 200 },
    { x: 200, y: 150 }
];

function polynom(multipliers, x) {
    return multipliers.map((m, i) => multipliers[i] * Math.pow(x, i)).reduce((acc, y) => acc + y, 0);
}

let powers = [0, 1, 2];
let maxS = [500, 5, 0.05];
let solution;

function sweep(multipliers) {

    let ms = maxS[multipliers.length];
    for (let s = -ms; s <= ms; s = s + ms / 100) {
        let m = [...multipliers, s];
        if (m.length < powers.length) {
            sweep(m);
        } else {
            let errors = [];
            for (let i in data) {
                let result = polynom(m, data[i].x);
                errors[i] = data[i].y - result;
            }
            let error = errors.map(e => e * e).reduce((acc, e) => acc + e, 0);
            //console.info(m.map(n => n.toFixed(4)), errors, error);
            if (!solution || solution.error > error) {
                solution = {error, multipliers: m};
            }
        }
    }
}

let t0 = new Date().getTime();
sweep([]);
let t1 = new Date().getTime();

console.info("Min:", solution);
console.info("Check:");
for (let i in data) {
    let result = polynom(solution.multipliers, data[i].x);
    console.info(`${i}: [${data[i].x},${data[i].y}]: ${result} (${((data[i].y - result) / data[i].y * 100).toFixed(2)}% error)`);
}
console.info(`${(t1 - t0) / 1000} sec.`);
console.info("plot "+solution.multipliers.map((m,i) => `${m}*x^${i}`).join("+"));
