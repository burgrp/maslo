

let calib = [
    /* 0 */ { x: -1300, y: +500, a: 1000, b: 2000 },
    /* 1 */ { x: +1200, y: +450, a: 2000, b: 1000 },
    /* 2 */ { x: +1250, y: -550, a: 3000, b: 1500 },
    /* 3 */ { x: -1100, y: -520, a: 1500, b: 3000 }
];

let x = -1100;
let y = -520;

let cnt = 0;
let sumA = 0;
let sumB = 0;

for (let c0 = 0; c0 < calib.length; c0++) {
    for (let c1 = 0; c1 < calib.length; c1++) {
        if (c0 !== c1) {

            let p = Math.hypot(x - calib[c0].x, y - calib[c0].y) / Math.hypot(calib[c1].x - calib[c0].x, calib[c1].y - calib[c0].y);
            let a = calib[c0].a + (calib[c1].a - calib[c0].a) * p;
            let b = calib[c0].b + (calib[c1].b - calib[c0].b) * p;
            console.info(`${c0} x ${c1} ${a.toFixed(0)} ${b.toFixed(0)}`);
            sumA += a;
            sumB += b;
            cnt++;
        }
    }
}

let a = sumA / cnt;
let b = sumB / cnt;
console.info(`${a.toFixed(0)} ${b.toFixed(0)}`);

