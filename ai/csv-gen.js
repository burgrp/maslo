const fs = require("fs").promises;

async function start() {

    let json = process.argv[2];

    if (!json) {
        throw new Error("Use: csv-gen <json-params-file>");
    }

    let metaList = JSON.parse(await fs.readFile(json, "utf-8"));

    for (let meta of metaList) {

        function add(label, xMin, yMin, xMax, yMax) {
            console.info(`gs://maslowcnc-grid/${meta.name},${label},${Math.max(0, xMin)},${Math.max(0, yMin)},,,${Math.min(xMax, 1)},${Math.min(yMax, 1)},,`);
        }

        add(meta.shape, 0, 0, 1, 1);

        let center = {
            x: 0.5 + meta.center.x / meta.width,
            y: 0.5 + meta.center.y / meta.width
        };
        let thick = {
            x: Math.max((meta.thick + 8) / meta.width, 0.01),
            y: Math.max((meta.thick + 8) / meta.height)
        };

        if (meta.shape === "ud") {
            add("line", center.x - 1/4, 0, center.x + 1/4, 1);
        } else if (meta.shape === "lr") {
            add("line", 0, center.y - 1/4, 1, center.y + 1/4);
        } else {
            add("junction", center.x - thick.x, center.y - thick.y, center.x + thick.x, center.y + thick.y);
        }
    }


}

start().catch(e => console.error(e));

