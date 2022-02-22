const fs = require("fs").promises;

async function start() {

    let json = process.argv[2];
    let kind = process.argv[3];

    if (!json || !kind) {
        throw new Error("Use: csv-gen <json-params-file> <kind>");
    }

    let paramList = JSON.parse(await fs.readFile(json, "utf-8"));

    for (let params of paramList) {

        centerBox = () => {
            let center = {
                x: (params.shiftX + 100) / 200,
                y: (params.shiftY + 100) / 200
            };
            let thick = {
                x: Math.max(params.thick / params.width, 0.01),
                y: Math.max(params.thick / params.height)
            };
            return `${center.x - thick.x},${center.y - thick.y},,,${center.x + thick.x},${center.y + thick.y}`;
        };

        let line = {
            classify: () => `gs://maslowcnc-grid/${params.name},${params.shape.name}`,
            center: () => `gs://maslowcnc-grid/${params.name},${params.shape.name},${centerBox()},,`
        }[kind]();
        console.info(line);
    }


}

start().catch(e => console.error(e));

