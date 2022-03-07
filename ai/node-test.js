const Jimp = require("jimp");
const recognize = require("../controller/src/grid-reco.js")();

let font;

async function save(data, size, fileName, debug) {

    if (!font) {
        font = await Jimp.loadFont(Jimp.FONT_SANS_12_BLACK);
    }

    let jimpImage = await Jimp.create(size, size);

    jimpImage.scan(0, 0, size, size, (x, y, idx) => {
        let color = data[x + y * size];
        color = 0x000000FF | (color << 8) | (color << 16) | (color << 24);
        jimpImage.bitmap.data.writeInt32BE(color, idx);
    });

    if (debug) {

        if (debug.center) {
            jimpImage.scan(Math.floor(debug.center.x * size) - 3, Math.floor(debug.center.y * size) - 3, 7, 7, (x, y, idx) => {
                if (idx >= 0 && idx < size * size * 4 && x >= 0 && y >= 0 && x < size && y < size) {
                    jimpImage.bitmap.data.writeUInt32BE(0x0050FFFF, idx);
                }
            });
        }

        if (debug.histograms) {
            for (let histogram of debug.histograms) {
                let color = histogram.params.depth === histogram.params.size ? 0xFF0000FF : 0x00FF00FF;
                for (let i = 0; i < histogram.length; i++) {

                    let mirror = (histogram.params.depth !== histogram.params.size && histogram.params.shift === 0) ? 1 : -1;

                    let v = Math.round(size / 2 - mirror * (size / 2 - size * histogram[i] / 500));

                    let dir = histogram.params.dir;

                    let x = dir * v + Math.abs(dir - 1) * i;
                    let y = dir * i + Math.abs(dir - 1) * v;

                    jimpImage.scan(x - 1, y - 1, 3, 3, (x, y, idx) => {
                        if (idx >= 0 && idx < size * size * 4 && x >= 0 && y >= 0 && x < size && y < size) {
                            jimpImage.bitmap.data.writeUInt32BE(color, idx);
                        }
                    });

                }
            }
        }

        let text = `${debug.shape} ${debug.timeMs}ms`
        jimpImage.scan(0, 0, Jimp.measureText(font, text), Jimp.measureTextHeight(font, text), (x, y, idx) => {
            if (idx >= 0 && idx < size * size) {
                jimpImage.bitmap.data.writeUInt32BE(0xB0B0B0FF, idx);
            }
        });
        jimpImage.print(font, 0, 0, text);

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
    let thick = Math.round(params.thick / 2) * 2;

    let background = Math.round(Math.random() * 100);
    let data = new Uint8Array(new ArrayBuffer(size * size)).fill(background);

    let directions = [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0]
    ];

    let foreground = 255 - Math.round(Math.random() * 100);

    for (let dir = 0; dir < 4; dir++) {
        if (params.shape.lines[dir]) {
            for (let pos = -thick / 2; pos < size / 2; pos++) {
                for (let line = -thick / 2; line <= thick / 2; line++) {
                    let x = size / 2 + pos * directions[dir][0] + line * directions[dir][1];
                    let y = size / 2 + pos * directions[dir][1] + line * directions[dir][0];
                    data[x + y * size] = foreground;
                }
            }
        }
    }

    let noise = (foreground - background) / 10;

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
            data[index] = Math.max(0, Math.min(255, data[index] + noise - Math.random() * noise * 2));
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


async function start() {

    let directory = "./samples";

    let size = 150;
    let count = 2;
    let id = 0;

    let shapes = Object.entries({
        empty: [0, 0, 0, 0],
        horizontal: [0, 1, 0, 1],
        vertical: [1, 0, 1, 0],
        cross: [1, 1, 1, 1],
        west: [1, 1, 1, 0],
        north: [0, 1, 1, 1],
        east: [1, 0, 1, 1],
        south: [1, 1, 0, 1],
        southwest: [1, 1, 0, 0],
        northwest: [0, 1, 1, 0],
        southeast: [1, 0, 0, 1],
        northeast: [0, 0, 1, 1]
    }).map(([k, v]) => ({ name: k, lines: v }));


    for (let shapeIndex = 0; shapeIndex < shapes.length; shapeIndex++) {
        for (let imageIndex = 0; imageIndex < count; imageIndex++) {

            let params = {
                name: ("000000000000" + (id++)).slice(-10) + ".jpg",
                size,
                shape: shapes[shapeIndex],
                thick: size / 50 + Math.round(Math.random() * size / 5),
                rotate: Math.round((Math.random() - 0.5) * 20),
                center: {
                    x: shapes[shapeIndex].name === "horizontal" ? 0 : Math.round((Math.random() - 0.5) * size / 3),
                    y: shapes[shapeIndex].name === "vertical" ? 0 : Math.round((Math.random() - 0.5) * size / 3)
                }
            };

            let image = generate(params);
            let result = recognize(image.data, image.meta.size, true);
            await save(image.data, image.meta.size, `${directory}/${params.name}`, result.debug);

        }
    }

}

start().catch(e => console.error(e));

