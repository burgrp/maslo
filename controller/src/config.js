const logError = require("debug")("app:config:error");
const logInfo = require("debug")("app:config:info");
const fs = require("fs").promises;

module.exports = async ({ file, defaults }) => {

    let data;

    try {
        data = JSON.parse(await fs.readFile(file));
    } catch (e) {
        if (e.code !== "ENOENT") {
            throw e;
        }
        data = {};
    }

    data = {
        ...defaults,
        ...data
    };

    let dataChangedListeners = [];

    let prevDataJson = JSON.stringify(data);
    let prevChanged = false;

    async function save() {
        await fs.writeFile(file, JSON.stringify(data, null, 2));
    }

    async function saveConfigLoop() {
        while (true) {
            let dataJson = JSON.stringify(data);
            if (dataJson !== prevDataJson) {
                prevChanged = true;
                prevDataJson = dataJson;
            } else {
                if (prevChanged) {
                    prevChanged = false;
                    logInfo("Saving configuration");
                    await save();
                    try {
                        for (listener of dataChangedListeners) {
                            await listener(data);
                        }
                    } catch(e) {
                        logError("Error in config data changed listener:", e);
                    }
                }
            }
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    saveConfigLoop().catch(e => logError("Error in save config loop:", e));

    return {
        data,

        onDataChanged(listener) {
            dataChangedListeners.push(listener);
        },
    };
}