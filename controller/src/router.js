const fs = require("fs");
const readline = require("readline");
const { start } = require("repl");

//const logError = require("debug")("app:router:error");
const logInfo = require("debug")("app:router:info");

let { round, ceil, hypot } = Math;

module.exports = ({ moveLengthMm, machine }) => {

    let code = [];



    async function* parseGcodeLines(linesAsyncIter) {
        for await (let line of linesAsyncIter) {
            line = line.replace(/;.*/, "").trim();
            if (line) {
                let tokens = line.split(/ +/);
                let code = tokens.shift();
                let parsed = tokens.map(token => /(.)(.*)/.exec(token)).reduce((acc, match) => ({ ...acc, [match[1].toLowerCase()]: parseFloat(match[2]) }), { code });
                yield parsed;
            }
        }
    }

    // async loadGCodeText(text) {
    //     this.loadGCodeLines(text.split(/\r?\n/));
    // },

    function parseGcodeStream(stream) {
        const lines = readline.createInterface({
            input: stream,
            crlfDelay: Infinity,
            terminal: false
        });
        return parseGcodeLines(lines);
    }

    function parseLocalFile(fileName) {
        return parseGcodeStream(fs.createReadStream(fileName));
    }

    function sweep(segments) {

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

    }

    async function loadGcode(gcodeAsyncIter) {
        code = [];
        for await (let command of gcodeAsyncIter) {
            code.push(command);
        }
    }

    return {

        getCode() {
            return code;
        },

        async loadLocalFile(fileName) {
            await loadGcode(parseLocalFile(fileName));
        },

        async start() {

            let machineState = machine.getState();

            if (!machineState.sledPosition) {
                throw new Error("Unknown sled position.");
            }

            let xyFeedMmPerMin;
            let firstMoveXY = true;
            let posXY = {
                xMm: machineState.sledPosition.xMm,
                yMm: machineState.sledPosition.yMm
            };

            async function moveXY(xMm, yMm, feedMmPerMin, rapid) {

                if (isFinite(feedMmPerMin)) {
                    xyFeedMmPerMin = feedMmPerMin;
                }

                xMm = isFinite(xMm) ? xMm - machineState.workspace.widthMm / 2 : pos.x;
                yMm = isFinite(yMm) ? (machineState.workspace.heightMm + machineState.motorsToWorkspaceVerticalMm) - yMm : pos.y;

                let lengthMm = hypot(xMm - posXY.xMm, yMm - posXY.yMm);

                if (lengthMm > 1) {

                    let moveCount = ceil(lengthMm / moveLengthMm);

                    for (let move = 0; move < moveCount; move++) {
                        await machine.moveXY({
                            xMm: posXY.xMm + (xMm - posXY.xMm) * move / moveCount,
                            yMm: posXY.yMm + (yMm - posXY.yMm) * move / moveCount,
                            speedMmPerMin: rapid ? undefined : xyFeedMmPerMin,
                            firstMove: firstMoveXY
                        });

                    }

                } else {
                    await machine.moveXY({
                        xMm,
                        yMm,
                        speedMmPerMin: rapid ? undefined : xyFeedMmPerMin,
                        firstMove: firstMoveXY
                    });
                }

                posXY = { xMm, yMm };
                firstMoveXY = false;
            }

            let handler = {
                /**
                 * Use millimeters for length units
                 */
                async G21() { },
                /**
                 * Absolute position mode
                 */
                async G90() { },
                /**
                 * Tool Change
                 */
                async M6({ t }) { },
                /**
                 * Rapid Move
                 */
                async G0({ x, y, z, f }) {
                    if (isFinite(x) && isFinite(y)) {
                        await moveXY(x, y, f, true);
                    }
                },
                /**
                 * Linear Move
                 */
                async G1({ x, y, z, f }) {
                    if (isFinite(x) && isFinite(y)) {
                        await moveXY(x, y, f, false);
                    }
                },
                /**
                 * Program End
                 */
                async M2() { },
                /**
                 * Program End
                 */
                async M30() { }
            };

            for (let command of code) {
                if (!(handler[command.code] instanceof Function)) {
                    throw new Error(`Unsupported GCODE ${command.code}`);
                }
                await handler[command.code](command);
            }
        }

    };
}




