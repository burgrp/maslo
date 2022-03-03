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

    for (let c = 0; c < size * size * 2; c++) {
        let index = Math.floor(Math.random() * size * size);
        data[index] = Math.max(0, Math.min(255, data[index] + 50 - Math.random() * 100));
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


function detect(hrImage, hrSize) {

    let t0 = new Date().getTime();

    let size = 50;
    let dsRatio = hrSize / size;
    let dsQuadrantSize = Math.ceil(dsRatio);

    let image = new Uint8Array(new ArrayBuffer(size * size));

    // down sample image
    for (let y = 0; y < size; y++) {
        let hrCenterY = Math.round(y * dsRatio);
        for (let x = 0; x < size; x++) {
            let hrCenterX = Math.round(x * dsRatio);
            let sum = 0;
            let count = 0;
            for (let hrY = Math.max(0, hrCenterY - dsQuadrantSize); hrY <= Math.min(hrSize, hrCenterY + dsQuadrantSize); hrY++) {
                for (let hrX = Math.max(0, hrCenterX - dsQuadrantSize); hrX <= Math.min(hrSize, hrCenterX + dsQuadrantSize); hrX++) {
                    sum += hrImage[hrX + hrSize * hrY];
                    count++;
                }
            }
            image[x + size * y] = sum / count;
        }
    }

    // count average
    let sum = 0;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            sum += image[x + size * y];
        }
    }
    let avg = sum / (size * size);

    // 100% contrast
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            image[x + size * y] = image[x + size * y] >= avg ? 255 : 0;
            //hrImage[20 + x + hrSize * (20 + y)] = image[x + size * y];
        }
    }

    let lines = {};

    // find lines
    for (let y1 = 0; y1 < size; y1++) {
        for (let x1 = 0; x1 < size; x1++) {
            if (image[x1 + size * y1]) {
                for (let y2 = 0; y2 < size; y2++) {
                    for (let x2 = 0; x2 < size; x2++) {

                        if (image[x2 + size * y2]) {

                            let line = true;

                            let len = Math.round(Math.hypot(x2 - x1, y2 - y1));
                            for (let posPix = 0; posPix < len; posPix++) {
                                let posNorm = posPix / len;
                                let x = Math.round(x1 + (x2 - x1) * posNorm);
                                let y = Math.round(y1 + (y2 - y1) * posNorm);
                                if (!image[x + size * y]) {
                                    line = false;
                                    break;
                                }
                            }

                            if (line && len) {
                                let dir = Math.abs(x1 - x2) > Math.abs(y1 - y2) ? "horizontal" : "vertical";
                                if (!lines[dir] || lines[dir].len < len) {
                                    lines[dir] = { x1, y1, x2, y2, len };
                                }
                            }

                        }

                    }
                }
            }
        }
    }

    let points = [];

    for (let line of Object.values(lines)) {
        if (line) {
            points.push({
                x: Math.round(dsRatio / 2 + line.x1 * dsRatio),
                y: Math.round(dsRatio / 2 + line.y1 * dsRatio),
            });
            points.push({
                x: Math.round(dsRatio / 2 + line.x2 * dsRatio),
                y: Math.round(dsRatio / 2 + line.y2 * dsRatio),
            });
        }
    }

    let t1 = new Date().getTime();
    return {
        points: points,
        text: `ul ${t1 - t0}ms`
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
                rotate: Math.round((Math.random() - 0.5) * 40),
                center: {
                    x: shapes[shapeIndex].name === "lr" ? 0 : Math.round((Math.random() - 0.5) * size / 1.5),
                    y: shapes[shapeIndex].name === "ud" ? 0 : Math.round((Math.random() - 0.5) * size / 1.5)
                }
            };

            let image = generate(params);
            let mark = detect(image.data, image.meta.size);
            await save(image.data, image.meta.size, `${directory}/${params.name}`, mark);

        }
    }

}

start().catch(e => console.error(e));

