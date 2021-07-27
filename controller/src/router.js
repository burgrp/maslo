const fs = require("fs");
const readline = require("readline");
const { start } = require("repl");

//const logError = require("debug")("app:router:error");
const logInfo = require("debug")("app:router:info");

let { round, ceil, hypot } = Math;

module.exports = ({ moveLengthMm, machine }) => {

    let job = [];
    let jobChangedListeners = [];

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

    async function loadJob(gcodeAsyncIter) {
        job = [];
        for await (let command of gcodeAsyncIter) {
            job.push(command);
        }
        for (let listener of jobChangedListeners) {
            try {
                listener(job);
            } catch (error) {
                logError("Error in job change listener:", error);
            }
        }
    }

    return {

        onJobChanged(listener) {
            jobChangedListeners.push(listener);
        },

        getCode() {
            return job;
        },

        async loadJobFromLocalFile(fileName) {
            await loadJob(parseLocalFile(fileName));
        },

        async loadJobFromStream(stream) {
            await loadJob(parseGcodeStream(stream));
        },

        async runJob() {
            let prevMode = await machine.setMode("JOB");
            try {
                await this.run(job);
            } finally {
                await machine.setMode(prevMode);
            }
        },

        async deleteJob() {
            await loadJob([]);
        },

        async run(code) {

            let machineState = machine.getState();

            if (!machineState.sledPosition) {
                throw new Error("Unknown sled position.");
            }

            let xyFeedMmPerMin;
            let xyPos = {
                xMm: machineState.sledPosition.xMm,
                yMm: machineState.sledPosition.yMm
            };

            let nextStepCheck;

            async function moveXY(xMm, yMm, feedMmPerMin) {

                if (isFinite(feedMmPerMin)) {
                    xyFeedMmPerMin = feedMmPerMin;
                }

                xMm = isFinite(xMm) ? xMm - machineState.workspace.widthMm / 2 : xyPos.xMm;
                yMm = isFinite(yMm) ? (machineState.workspace.heightMm + machineState.motorsToWorkspaceVerticalMm) - yMm : xyPos.yMm;

                let lengthMm = hypot(xMm - xyPos.xMm, yMm - xyPos.yMm);

                let moveCount = ceil(lengthMm / moveLengthMm);

                for (let move = 0; move < moveCount; move++) {
                    await machine.moveXY({
                        xMm: xyPos.xMm + (xMm - xyPos.xMm) * move / moveCount,
                        yMm: xyPos.yMm + (yMm - xyPos.yMm) * move / moveCount,
                        speedMmPerMin: xyFeedMmPerMin
                    });
                }

                xyPos = { xMm, yMm };

                nextStepCheck = async ({ code, x, y }) => {
                    if (!(
                        (code === "G0" || code === "G1") &&
                        (isFinite(x) || isFinite(y))
                    )) {
                        await machine.stopAB();
                    }
                };
            }

            let zFeedMmPerMin;

            async function moveZ(zMm, feedMmPerMin) {

                if (isFinite(feedMmPerMin)) {
                    zFeedMmPerMin = feedMmPerMin;
                }

                await machine.moveZ({
                    zMm,
                    speedMmPerMin: zFeedMmPerMin
                });

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
                    let xyMove = isFinite(x) || isFinite(y);
                    let zMove = isFinite(z);
                    if (xyMove && zMove) {
                        throw new Error("XYZ move is not supported yet.");
                    }
                    if (xyMove) {
                        await moveXY(x, y, f);
                    }
                    if (zMove) {
                        await moveZ(z, f);
                    }
                },
                /**
                 * Linear Move
                 */
                async G1(params) {
                    await this.G0(params);
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

            try {
                for (let command of code) {
                    if (!(handler[command.code] instanceof Function)) {
                        throw new Error(`Unsupported GCODE ${command.code}`);
                    }
                    logInfo(command);
                    if (nextStepCheck) {
                        await nextStepCheck(command);
                        nextStepCheck = undefined;
                    }
                    await handler[command.code](command);
                }

            } finally {
                await machine.stopAB();
            }
        }

    };
}




