const objectHash = require("object-hash");
const logError = require("debug")("app:models:error");
const logDebug = require("debug")("app:models:debug");

module.exports = ({
    models = {},
    listeners = {},
    checkMs = 100
}) => {

    let modelHashes = {};

    function start() {

        async function loop() {

            while (true) {

                for (let name in models) {
                    let model = models[name];
                    let newHash = objectHash(model);
                    if (newHash !== modelHashes[name]) {
                        modelHashes[name] = newHash;
                        logDebug(`Model ${name} changed`);
                        for (let listener of listeners[name] || []) {
                            try {
                                await listener(model, name);
                            } catch(e) {
                                logError(`Error in ${name} model listener:`, e);
                            }
                        }
                    }
                }

                await new Promise(resolve => setTimeout(resolve, checkMs));
            }
        }

        loop().catch(e => logError("Unhandled error in model loop:", e));
    }

    return {
        start,
        models
    }
}
