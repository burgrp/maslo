const fs = require("fs").promises;

module.exports = async ({configFile}) => {

    let data;
    
    try {
        data = JSON.parse(await fs.readFile(configFile));
    } catch(e) {
        if (e.code !== "ENOENT") {
            throw e;
        }
        data = {};
    }
    
    // DEBUG ///////////////////////////////////////////////
    // data.lastPosition = {xMm: -200, yMm: -200, zMm: -10};


    let config = {
        data,
        async save() {
            await fs.writeFile(configFile, JSON.stringify(data, null, 2));
        }
    }

    return config;
}