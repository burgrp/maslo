const Jimp = require("jimp");
const fs = require("fs").promises;

async function save(data, width, height, fileName) {
    let jimpImage = await Jimp.create(width, height);
    jimpImage.scan(0, 0, width, height, (x, y, idx) => {
        let color = data[x + y * width];
        color = 0x000000FF | (color << 8) | (color << 16) | (color << 24);
        jimpImage.bitmap.data.writeInt32BE(color, idx);
    });
    await jimpImage.writeAsync(fileName);
}

function translate(srcData, srcWidth, srcHeight, dstWidth, dstHeight, angle, center) {

    let dstData = new Uint8Array(new ArrayBuffer(dstWidth * dstHeight));

    angle = Math.PI * angle / 180;

    for (let dstX = 0; dstX < dstWidth; dstX++) {
        for (let dstY = 0; dstY < dstHeight; dstY++) {

            let dx = dstX - dstWidth / 2 - center.x;
            let dy = dstY - dstHeight / 2 - center.y;

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

    let final = translate(data, size, size, params.width, params.height, params.rotate, params.center);

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


async function start() {

    directory = "./samples";

    for (let dataset of [
        {
            name: "train",
            count: 100
        },
        {
            name: "test",
            count: 3
        }
    ]) {

        width = 224;
        height = 224;

        let id = 0;
        let metaList = [];

        for (let shapeIndex = 0; shapeIndex < shapes.length; shapeIndex++) {
            for (let imageIndex = 0; imageIndex < dataset.count; imageIndex++) {

                let params = {
                    name: ("000000000000" + (id++)).slice(-10) + ".jpg",
                    width,
                    height,
                    shape: shapes[shapeIndex],
                    thick: 2 * (1 + Math.round(Math.random() * 10)),
                    rotate: Math.round((Math.random() - 0.5) * 60),
                    center: {
                        x: shapes[shapeIndex].name === "lr"? 0: Math.round((Math.random() - 0.5) * width / 1.5),
                        y: shapes[shapeIndex].name === "ud"? 0: Math.round((Math.random() - 0.5) * height / 1.5)
                    }
                };

                let image = generate(params);
                await save(image.data, image.meta.width, image.meta.height, `${directory}/${dataset.name}/${params.name}`);

                metaList.push(image.meta);
            }

            await fs.writeFile(`${directory}/${dataset.name}.json`, JSON.stringify(metaList, null, 2), "utf-8");

        }

    }

}

start().catch(e => console.error(e));

