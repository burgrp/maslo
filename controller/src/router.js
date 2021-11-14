const fs = require("fs");
const readline = require("readline");
const { start } = require("repl");

//const logError = require("debug")("app:router:error");
const logInfo = require("debug")("app:router:info");

let { round, ceil, hypot, min, max, abs, sign } = Math;

module.exports = ({ stepLengthMm, machine }) => {

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

    function asyncWait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    let lastErrors = {};

    async function doMove(from, to, future) {

        console.info(from, to, future);

        let moveDistanceMm = hypot(to.x - from.x, to.y - from.y);

        if (moveDistanceMm > 0) {

            let moveTimeMs = 60000 * moveDistanceMm / to.f;

            let t0 = new Date().getTime();
            while (true) {

                let position = (new Date().getTime() - t0) / moveTimeMs;
                if (position >= 1) {
                    break;
                }

                let target = {
                    xMm: from.x + position * (to.x - from.x),
                    yMm: from.y + position * (to.y - from.y)
                };

                machine.setTarget(target);

                let state = machine.getState();
                let distance = hypot(state.sled.position.xMm - to.x, state.sled.position.yMm - to.y);

                let targetChains = machine.getChainLengths(target);
                let sledChains = machine.getChainLengths(state.sled.position);

                for (let m of ["a", "b"]) {
                    let lastError = lastErrors[m];
                    let error = targetChains[m + "Mm"] - sledChains[m + "Mm"];

                    let p = error / 50;
                    let d = isFinite(lastError) ? (error - lastError) / 10 : 0;

                    let duty = state.motors[m].duty + p + d;

                    state.motors[m].error = error;
                    state.motors[m].duty = sign(duty) * min(1, abs(duty));
                    lastErrors[m] = error;
                }

                console.info(`(${target.xMm.toFixed(1)},${target.yMm.toFixed(1)}) A:${state.motors.a.duty.toFixed(3)} ${lastErrors.a < 0 ? "" : "+"}${lastErrors.a.toFixed(3)}, B:${state.motors.b.duty.toFixed(3)} ${lastErrors.b < 0 ? "" : "+"}${lastErrors.b.toFixed(3)}`);

                await machine.waitForNextCheck();
                lastDistance = distance;
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

            let state = machine.getState();

            if (!state.sled.position) {
                throw new Error("Unknown sled position");
            }

            if (!isFinite(state.spindle.zMm)) {
                throw new Error("Unknown spindle position");
            }

            let queue = [{
                x: state.sled.position.xMm,
                y: state.sled.position.yMm,
                z: state.spindle.zMm,
                f: 0
            }];

            async function enqueueMove(params) {

                if (params) {

                    let lastParams = queue[queue.length - 1];
                    let newParams = {};
                    for (let key in lastParams) {
                        newParams[key] = isFinite(params[key]) ? params[key] : lastParams[key];
                    }

                    queue.push(newParams);
                }

                if (queue.length > 2 || (!params && queue.length > 1)) {
                    await doMove(queue.shift(), queue[0], queue[1]);
                }

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
                async G0(params) {
                    await enqueueMove(params);
                },
                /**
                 * Linear Move
                 */
                async G1(params) {
                    await enqueueMove(params);
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
                    await handler[command.code](command);
                }
                await enqueueMove();

            } finally {
                machine.setMotorDuty("a", 0);
                machine.setMotorDuty("b", 0);
                machine.setMotorDuty("z", 0);
                machine.setTarget(undefined);
            }
        }

    };
}




