const Jimp = require("jimp");
const fs = require("fs").promises;

let font;

async function save(data, size, fileName, mark) {

    if (!font) {
        font = await Jimp.loadFont(Jimp.FONT_SANS_12_BLACK);
    }

    let jimpImage = await Jimp.create(size, size);

    jimpImage.scan(0, 0, size, size, (x, y, idx) => {
        let color = data[x + y * size];
        color = 0x000000FF | (color << 8) | (color << 16) | (color << 24);
        jimpImage.bitmap.data.writeInt32BE(color, idx);
    });

    if (mark) {

        jimpImage.scan(0, 0, Jimp.measureText(font, mark.text), Jimp.measureTextHeight(font, mark.text), (x, y, idx) => {
            if (idx >= 0 && idx < size * size) {
                jimpImage.bitmap.data.writeUInt32BE(0xFFFFFFFF, idx);
            }
        });
        console.info();
        jimpImage.print(font, 0, 0, mark.text);

        for (let point of mark.points) {
            jimpImage.scan(point.x - 1, point.y - 1, 3, 3, (x, y, idx) => {
                if (idx >= 0 && idx < size * size * 4 && x >= 0 && y >= 0 && x < size && y < size) {
                    jimpImage.bitmap.data.writeUInt32BE(0xFF0000FF, idx);
                }
            });
        }
    }

    await jimpImage.writeAsync(fileName);
}

function translate(srcData, srcSize, dstSize, angle, center) {

    let dstData = new Uint8Array(new ArrayBuffer(dstSize * dstSize));

    angle = Math.PI * angle / 180;

    for (let dstX = 0; dstX < dstSize; dstX++) {
        for (let dstY = 0; dstY < dstSize; dstY++) {

            let dx = dstX - dstSize / 2 - center.x;
            let dy = dstY - dstSize / 2 - center.y;

            let sx = dx * Math.cos(angle) + dy * Math.sin(angle);
            let sy = dy * Math.cos(angle) - dx * Math.sin(angle);

            let srcX = Math.round(srcSize / 2 + sx);
            let srcY = Math.round(srcSize / 2 + sy);

            if (srcX > 0 && srcX < srcSize && srcY > 0 && srcY < srcSize) {
                dstData[dstX + dstY * dstSize] = srcData[srcX + srcY * srcSize];
            }
        }
    }

    return dstData;
}

function generate(params) {

    let size = params.size * 2;
    let data = new Uint8Array(new ArrayBuffer(size * size));

    let directions = [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0]
    ];

    for (let dir = 0; dir < 4; dir++) {
        if (params.shape.lines[dir]) {
            for (let pos = -params.thick / 2; pos < size / 2; pos++) {
                for (let line = -params.thick / 2; line <= params.thick / 2; line++) {
                    let x = size / 2 + pos * directions[dir][0] + line * directions[dir][1];
                    let y = size / 2 + pos * directions[dir][1] + line * directions[dir][0];
                    data[x + y * size] = 255;//Math.round(Math.random() * 200);
                }
            }
        }
    }

    for (let f = 0; f < 100; f++) {
        let center = {
            x: Math.floor(Math.random() * size),
            y: Math.floor(Math.random() * size)
        };
        let s = Math.floor(Math.random() * size / 3);
        for (let c = 0; c < 1000; c++) {
            let offset = {
                x: Math.floor(Math.random() * s / 2 - s),
                y: Math.floor(Math.random() * s / 2 - s)
            };
            let index = center.x + offset.x + size * (center.y + offset.y);
            data[index] = Math.max(0, Math.min(255, data[index] + 20 - Math.random() * 40));
        }
    }

    let final = translate(data, size, params.size, params.rotate, params.center);

    return {
        meta: {
            ...params,
            shape: params.shape.name
        },
        data: final
    };
}

let shapes = Object.entries({
    lr: [0, 1, 0, 1],
    ud: [1, 0, 1, 0],
    crs: [1, 1, 1, 1],
    udr: [1, 1, 1, 0],
    lrd: [0, 1, 1, 1],
    udl: [1, 0, 1, 1],
    lru: [1, 1, 0, 1],
    ur: [1, 1, 0, 0],
    dr: [0, 1, 1, 0],
    ul: [1, 0, 0, 1],
    dl: [0, 0, 1, 1]
}).map(([k, v]) => ({ name: k, lines: v }));


function detect(image, size) {

    let t0 = new Date().getTime();


    let histograms = [];

    // allocate histograms
    for (let dir = 0; dir <= 1; dir++) {
        histograms[dir] = new Uint32Array(new ArrayBuffer(size * 4));
    }

    // count histograms sums
    for (let x = 0; x < size; x++) {
        for (let y = 0; y < size; y++) {
            v = image[x + size * y];
            histograms[0][x] += v;
            histograms[1][y] += v;
        }
    }

    // normalize to 0..100
    for (let dir = 0; dir <= 1; dir++) {
        let max;
        for (let i = 0; i < size; i++) {
            if (max === undefined || max < histograms[dir][i]) {
                max = histograms[dir][i];
            }
        }
        let sum = 0;
        let min;
        for (let i = 0; i < size; i++) {
            histograms[dir][i] = 100 * histograms[dir][i] / max;
            if (min === undefined || min > histograms[dir][i]) {
                min = histograms[dir][i];
            }
            sum += histograms[dir][i];
        }
        histograms[dir].avg = sum / size;
        histograms[dir].min = min;
    }

    // identify flat histogram, find centers of maximum band if any 
    for (let dir = 0; dir <= 1; dir++) {

        let start;
        let stop;

        let sideLeft = {
            count: 0,
            sum: 0
        };
        let sideRight = {
            count: 0,
            sum: 0
        };

        if (histograms[dir].avg < 80) {

            for (let i = 0; i < size; i++) {
                let v = histograms[dir][i];
                if (v > (histograms[dir].avg + 100) / 2) {
                    if (start === undefined) {
                        start = i;
                    }
                } else {
                    if (start !== undefined && stop === undefined) {
                        stop = i;
                    }
                }
                if (start === undefined && stop === undefined) {
                    sideLeft.count++;
                    sideLeft.sum += v;
                }
                if (start !== undefined && stop !== undefined) {
                    sideRight.count++;
                    sideRight.sum += v;
                }
            }

            histograms[dir].peak = (start + stop) / 2;

            histograms[dir].sides = Math.sign(Math.round((
                (sideRight.count && sideRight.sum / sideRight.count) -
                (sideLeft.count && sideLeft.sum / sideLeft.count)
            ) / 5) * 5);

        }
    }

    let center = {
        x: Number.isFinite(histograms[0].peak) ? histograms[0].peak : size / 2,
        y: Number.isFinite(histograms[1].peak) ? histograms[1].peak : size / 2
    };

    let points = [];

    points.push(center);

    for (let dir = 0; dir <= 1; dir++) {
        for (let i = 0; i < size; i++) {
            points.push({ x: i, y: size - histograms[0][i] / 5 });
            points.push({ x: size - histograms[1][i] / 5, y: i });
        }
    }

    let t1 = new Date().getTime();
    return {
        points,
        center,
        text: `${t1 - t0}ms ${histograms.map(h => h.sides).flatMap(v => v).map(v => Number.isFinite(v) ? Math.round(v) : "-").join(",")}`
    };
}

async function start() {

    directory = "./samples";

    size = 150;
    count = 2;
    let id = 0;

    for (let shapeIndex = 0; shapeIndex < shapes.length; shapeIndex++) {
        for (let imageIndex = 0; imageIndex < count; imageIndex++) {

            let params = {
                name: ("000000000000" + (id++)).slice(-10) + ".jpg",
                size,
                shape: shapes[shapeIndex],
                thick: 2 * (1 + Math.round(Math.random() * 10)),
                rotate: Math.round((Math.random() - 0.5) * 20),
                center: {
                    x: shapes[shapeIndex].name === "lr" ? 0 : Math.round((Math.random() - 0.5) * size / 2),
                    y: shapes[shapeIndex].name === "ud" ? 0 : Math.round((Math.random() - 0.5) * size / 2)
                }
            };

            let image = generate(params);
            let mark = detect(image.data, image.meta.size);
            await save(image.data, image.meta.size, `${directory}/${params.name}`, mark);

        }
    }

}

start().catch(e => console.error(e));

