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


function detect(image, size) {

    let points = [];

    for (let x = 0; x < size; x++) {

        let sum = 0;
        for (let y = 0; y < size; y++) {
            sum += image[x + y * size];
        }

        let avg = sum / size;

        let start;
        let spots = [];

        for (let y = 0; y < size; y++) {
            let v = image[x + y * size];
            if (v > avg && start === undefined) {
                start = y;
            }
            if (v <= avg && start !== undefined) {
                spots.push({ start, stop: y });
                start = undefined;
            }
        }

        let max = spots.length && spots.reduce((acc, s) => (!s || s.stop - s.start > acc.stop - acc.start ? s : acc));

        if (max) {
            points.push({
                x,
                y: (max.stop + max.start) / 2
            });
        }
    }

    return {
        points,
        text: 'ul'
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

