const fs = require("fs");
const readline = require("readline");

//const logError = require("debug")("app:router:error");
const logInfo = require("debug")("app:router:info");

module.exports = ({ moveLengthMm }) => {

    function roughSizeOfObject(object) {

        var objectList = [];

        var recurse = function (value) {
            var bytes = 0;

            if (typeof value === 'boolean') {
                bytes = 4;
            }
            else if (typeof value === 'string') {
                bytes = value.length * 2;
            }
            else if (typeof value === 'number') {
                bytes = 8;
            }
            else if
                (
                typeof value === 'object'
                && objectList.indexOf(value) === -1
            ) {
                objectList[objectList.length] = value;

                for (i in value) {
                    bytes += 8; // an assumed existence overhead
                    bytes += recurse(value[i])
                }
            }

            return bytes;
        }

        return recurse(object);
    }

    return {
        sweep(segments) {

            let t0 = new Date().getTime();

            try {

                for (let { sweep, lengthMm, speedMmPerMin } of segments) {

                    let moveCount = ceil(lengthMm / moveLengthMm);

                    for (let posMm = 0; posMm <= lengthMm; posMm = posMm + lengthMm / moveCount) {

                        let { x: xMm, y: yMm } = sweep(posMm / lengthMm);
                        logInfo(`segment ${crdStr({ xMm, yMm })} ------------------------------------------------------`);
                        // await moveXY({ xMm, yMm, speedMmPerMin });
                    }

                }

                let t1 = new Date().getTime();

                let sMm = segments.reduce((acc, segment) => acc + segment.lengthMm, 0);
                let tSec = (t1 - t0) / 1000;

                logInfo(`run ${centRound(sMm)}mm took ${centRound(tSec)}s => ${round(60 * sMm / tSec)}mm/min`);

            } finally {
                //await stopAB();
            }

        },

        async * loadGCodeLines(linesAsyncIter) {
            for await (let line of linesAsyncIter) {
                line = line.replace(/;.*/, "").trim();
                if (line) {
                    let tokens = line.split(/ +/);
                    let code = tokens.shift();
                    let parsed = tokens.map(token => /(.)(.*)/.exec(token)).reduce((acc, match) => ({ ...acc, [match[1].toLowerCase()]: parseFloat(match[2]) }), { code });
                    yield parsed;
                }
            }
        },

        // async loadGCodeText(text) {
        //     this.loadGCodeLines(text.split(/\r?\n/));
        // },

        loadGCodeStream(stream) {
            const lines = readline.createInterface({
                input: stream,
                crlfDelay: Infinity,
                terminal: false
            });
            return this.loadGCodeLines(lines);
        },

        loadLocalFile(fileName) {
            return this.loadGCodeStream(fs.createReadStream(fileName));
        }

    };
}



            let handler = {
                /**
                 * Use millimeters for length units
                 */
                 G21() { },
                 /**
                  * Absolute position mode
                  */
                 G90() { },
                 /**
                  * Tool Change
                  */
                 M6({ t }) { },
                 /**
                  * Rapid Move
                  */
                 G0({ x, y, z, f }) {
                     if (isFinite(x) && isFinite(y)) {
                         move(x, y, true);
                     }
                 },
                 /**
                  * Linear Move
                  */
                 G1({ x, y, z, f }) {
                     if (isFinite(x) && isFinite(y)) {
                         move(x, y, false);
                     }
                 },
                 /**
                  * Program End
                  */
                 M2() { },
                 /**
                  * Program End
                  */
                 M30() { }
             };
