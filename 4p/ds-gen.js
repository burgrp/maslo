const Jimp = require("jimp");

let width = 640;
let height = 480;
let count = 1000;
let dir = "/home/paul/tmp/dataset";

async function start() {

    async function generate({ name, shape, id }) {

        let size = Math.ceil(2.5 * Math.max(width, height));

        let background = Math.round(0xFF * (1 - Math.random() * 0.3));
        background = 0x000000FF | background << 8 | (background << 16) | (background << 24);
        let image = await Jimp.create(size, size, background >>> 0);

        let thick = Math.round(size / 200 + Math.random() * size / 50);

        let dens = 0.5 + Math.random() / 2;

        let line2color = p => {
            let color = Math.round(0xFF - dens * 0xFF * (1 - Math.pow(2 * p / thick, 3)));
            color = 0xFF000000 | color | (color << 8) | (color << 16);
            return color;
        };

        for (let half = 0; half < 2; half++) {

            for (let mirror = 0; mirror < 2; mirror++) {

                for (let line = 0; line < thick / 2; line++) {

                    let color = line2color(line);

                    // vertical
                    if (shape[half * 2]) {
                        image.scan(
                            size / 2 - line * (mirror * 2 - 1),
                            size / 2 * half - thick * half / 2,
                            1,
                            size / 2 + thick / 2 - 1,
                            (x, y, index) => {
                                image.bitmap.data.writeInt32LE(Math.min(color, image.bitmap.data.readInt32LE(index)), index);
                            });
                    }

                    // horizontal
                    if (shape[(1 - half) * 2 + 1]) {
                        image.scan(
                            size / 2 * half - thick * half / 2,
                            size / 2 - line * (mirror * 2 - 1),
                            size / 2 + thick / 2 - 1,
                            1,
                            (x, y, index) => {
                                image.bitmap.data.writeInt32LE(Math.min(color, image.bitmap.data.readInt32LE(index)), index);
                            });
                    }

                }

            }
        }

        for (let i = 0; i < Math.round(Math.random() * 500); i++) {
            let sizeX = Math.round(size / 100 + Math.random() * size / 10);
            let sizeY = Math.round(size / 100 + Math.random() * size / 10);
            let origX = Math.round(Math.random() * (size - sizeX - 1));
            let origY = Math.round(Math.random() * (size - sizeY - 1));
            let dens = Math.random();
            image.scan(
                origX,
                origY,
                sizeX,
                sizeY,
                (x, y, index) => {
                    let color = Math.round(
                        0xFF *
                        (1 - dens * (
                            Math.cos(Math.PI * (0.5 + (x - origX) / sizeX)) *
                            Math.cos(Math.PI * (0.5 + (y - origY) / sizeY))
                        ))
                    );
                    color = 0xFF000000 | color | (color << 8) | (color << 16)
                    image.bitmap.data.writeInt32LE(
                        Math.min(image.bitmap.data.readInt32LE(index), color),
                        index
                    );
                });
        }

        image.rotate(Math.random() * 40 - 20, false);
        let shiftX = Math.round((Math.random() - 0.5) * 160);
        let shiftY = Math.round((Math.random() - 0.5) * 160);
        image.crop(
            Math.round(size / 2 - width / 2 - width * shiftX / 200),
            Math.round(size / 2 - height / 2 - height * shiftY / 200),
            width,
            height
        );

        let file = `${dir}/${("000000000000" + (id++)).slice(-10)},${name},${shiftX},${shiftY}.jpg`;
        console.info(file);
        await image.writeAsync(file);;
    }

    // shapes are defined as line visibility at headings 0, 90, 180 and 270 degrees
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
    }).map(([k, v]) => ({ name: k, shape: v }));


    for (let id = 0; id < count; id++) {
        let shape = shapes[Math.floor(Math.random() * shapes.length)];
        await generate({
            id,
            name: shape.name,
            shape: shape.shape
        });
    }
}


start().catch(e => console.error(e));