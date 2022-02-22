const Jimp = require("jimp");
const fs = require("fs").promises;

async function save({ data, width, height }, fileName) {
    let jimpImage = await Jimp.create(width, height);
    jimpImage.scan(0, 0, width, height, (x, y, idx) => {
        let color = data[x + y * width];
        color = 0x000000FF | (color << 8) | (color << 16) | (color << 24);
        jimpImage.bitmap.data.writeInt32BE(color, idx);
    });
    await jimpImage.writeAsync(fileName);
}

function translate(srcData, srcWidth, srcHeight, dstWidth, dstHeight, angle, shiftX, shiftY) {

    let dstData = new Uint8Array(new ArrayBuffer(dstWidth * dstHeight));

    angle = Math.PI * angle / 180;

    shiftX = Math.round(srcWidth * shiftX / 400);
    shiftY = Math.round(srcHeight * shiftY / 400);

    for (let dstX = 0; dstX < dstWidth; dstX++) {
        for (let dstY = 0; dstY < dstHeight; dstY++) {

            let dx = dstX - dstWidth / 2 - shiftX;
            let dy = dstY - dstHeight / 2 - shiftY;

            let sx = dx * Math.cos(angle) + dy * Math.sin(angle);
            let sy = dy * Math.cos(angle) - dx * Math.sin(angle);

            let srcX = Math.round(srcWidth / 2 + sx);
            let srcY = Math.round(srcHeight / 2 + sy);

            if (srcX > 0 && srcX < srcWidth && srcY > 0 && srcY < srcHeight) {
                dstData[dstX + dstY * dstWidth] = srcData[srcX + srcY * srcWidth];
            }
        }
    }

    return dstData;
}

function generate(params) {

    let size = Math.max(params.width, params.height) * 2;
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
                    data[x + y * size] = 255 - Math.round(Math.random() * 100);
                }
            }
        }
    }

    for (let c = 0; c < 100000; c++) {
        let index = Math.floor(Math.random() * size * size);
        data[index] = Math.min(255, 50 + data[index]);
    }

    let final = translate(data, size, size, params.width, params.height, params.rotate, params.shiftX, params.shiftY);

    return {
        ...params,
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


async function start() {

    directory = "./samples";

    for (let dataset of [
        {
            name: "train",
            count: 3
        },
        {
            name: "test",
            count: 5
        }
    ]) {

        width = 224;
        height = 224;

        let id = 0;
        let paramsList = [];
        
        for (let shapeIndex = 0; shapeIndex < shapes.length; shapeIndex++) {
            for (let imageIndex = 0; imageIndex < dataset.count; imageIndex++) {
                
                let params = {
                    name: ("000000000000" + (id++)).slice(-10) + ".jpg",
                    width,
                    height,
                    shape: shapes[shapeIndex],                        
                    thick: 2 * (1 + Math.round(Math.random() * 20)),
                    rotate: Math.round(Math.random() * 60 - 30),
                    shiftX: Math.round(Math.random() * 100 - 50),
                    shiftY: Math.round(Math.random() * 100 - 50)
                };

                paramsList.push(params);

                let image = generate(params);
                await save(image, `${directory}/${dataset.name}/${params.name}`);
            }

            await fs.writeFile(`${directory}/${dataset.name}.json`, JSON.stringify(paramsList, null, 2), "utf-8");

        }

    }

}

start().catch(e => console.error(e));

