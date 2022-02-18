const bicubic = require("bicubic-interpolate");

let options = {
    scaleX: 1.5 / 1050,
    scaleY: -1.5 / 525,
    translateX: 1.5,
    translateY: 1.5,
    extrapolate: true
};

function transpose(a) {
    let r = [];
    for (let x = 0; x < a.length; x++) {
        r[x] = [];
        for (let y = 0; y < a[x].length; y++) {
            r[x][y] = a[y][x];
        }
    }
    return r;
}

let interpolatorA = bicubic.createGridInterpolator(transpose([
    [971, 1552, 2203, 2877],
    [1241, 1733, 2334, 2979],
    [1544, 1961, 2508, 3117],
    [1863, 2221, 2716, 3287]
]), options);

let interpolatorB = bicubic.createGridInterpolator(transpose([
    [2944, 2290, 1673, 1155],
    [3072, 2452, 1888, 1450],
    [3232, 2650, 2140, 1765],
    [3421, 2878, 2416, 2091]
]), options);

let x = -10;
let y = -516;
console.info(interpolatorA(x, y), interpolatorB(x, y));

let buffer = new ArrayBuffer(2501*1251*4);
let intArray = new Int32Array(buffer);

let t0 = new Date().getTime();
for (let x = 0; x <= 2500; x++) {
    for (let y = 0; y <= 1250; y++) {
        intArray[x * 1250 + y] = interpolatorA(x - 1250, y - 625);
    }
}
console.info(new Date().getTime() - t0);