const Jimp = require("jimp");

const config = {
    width: 300,
    height: 200
};

async function save({ data, width, height }, fileName) {
    let jimpImage = await Jimp.create(width, height);
    jimpImage.scan(0, 0, width, height, (x, y, idx) => {
        let color = data[x + y * width];
        color = 0x000000FF | (color << 8) | (color << 16) | (color << 24);
        jimpImage.bitmap.data.writeInt32BE(color, idx);
    });
    await jimpImage.writeAsync(fileName);
}

function rotate(srcData, srcWidth, srcHeight, dstWidth, dstHeight, angle) {
    let dstData = new Uint8Array(new ArrayBuffer(dstWidth * dstHeight));

    for (let dstX = 0; dstX < dstWidth; dstX++) {
        for (let dstY = 0; dstY < dstHeight; dstY++) {
            //x´= x cos a + y sin a.
            let srcX = Math.round(srcWidth / 2 + dstX - dstWidth / 2);
            //y´= -x sina + y cosa.
            let srcY = Math.round(srcHeight / 2 + dstY - dstHeight / 2);
            console.info(dstX, dstY, "<=", srcX, srcY);
            dstData[dstX + dstY * dstWidth] = srcData[srcX + srcY * srcWidth];
        }
    }

    return dstData;

}

function generate(shape) {
    
    let size = Math.max(config.width, config.height);
    let data = new Uint8Array(new ArrayBuffer(size * size));

    let thick = 20;

    let directions = [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0]
    ];

    for (let dir = 0; dir < 4; dir++) {
        if (shape.lines[dir]) {
            for (let pos = -thick / 2; pos < size / 2; pos++) {
                for (let line = -thick / 2; line <= thick / 2; line++) {
                    let x = size / 2 + pos * directions[dir][0] + line * directions[dir][1];
                    let y = size / 2 + pos * directions[dir][1] + line * directions[dir][0];
                    data[x + y * size] = 255;
                }
            }
        }
    }

    let rotated = rotate(data, size, size, config.width, config.height, 30);

    return {
        data: rotated,
        width: config.width,
        height: config.height,
        shape: shape.name
    };
}

async function start() {

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

    let image = generate(shapes[3]);
    await save(image, "sample.jpg");
}


start().catch(e => console.error(e));

