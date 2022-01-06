const fs = require("fs");
const childProcess = require("child_process");
const { resolve } = require("path");
const { pid } = require("process");
const readline = require("readline");
const { start } = require("repl");

//const logError = require("debug")("app:router:error");
const logInfo = require("debug")("app:router:info");

let { round, ceil, hypot, min, max, abs, sign } = Math;

module.exports = ({ machine, config }) => {

    let job = [];
    let jobChangedListeners = [];

    let machineState = machine.state;

    function convertFromSvg(svgPath) {
        let converter = childProcess.spawn(config.gcodeplot.executable, [...Object.entries(config.gcodeplot.options).map(([k, v]) => `--${k}=${v}`), svgPath]);
        return converter.stdout;
    }

    async function* parseLines(linesAsyncIter) {
        let svgStream;
        let svgPath = "/tmp/svg";

        try {
            for await (let line of linesAsyncIter) {

                if (line.trim().startsWith("<") && !svgStream) {
                    svgStream = fs.createWriteStream(svgPath);
                }

                if (svgStream) {
                    svgStream.write(line + "\n");
                } else {
                    line = line.replace(/;.*/, "").trim();
                    if (line) {
                        let tokens = line.split(/ +/);
                        let code = tokens.shift();
                        let match = code.match(/^(?<l>[A-Z])(?<n>[0-9.]*)/);
                        code = match && match.groups.l + parseFloat(match.groups.n) || code;
                        let parsed = tokens.map(token => /(.)(.*)/.exec(token)).reduce((acc, match) => ({ ...acc, [match[1].toLowerCase()]: parseFloat(match[2]) }), { code });
                        yield parsed;
                    }
                }
            }
        } finally {
            if (svgStream) {
                svgStream.close();
            }
        }

        if (svgStream) {
            let stream = convertFromSvg(svgPath);
            for await (let parsed of parseStream(stream)) {
                yield parsed;
            }
        }

    }

    function parseStream(stream) {
        const lines = readline.createInterface({
            input: stream,
            crlfDelay: Infinity,
            terminal: false
        });
        return parseLines(lines);
    }

    function parseLocalFile(fileName) {
        return parseStream(fs.createReadStream(fileName));
    }

    async function loadJob(gcodeAsyncIter) {
        await machine.doJob(async () => {

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
        });
    }

    let lastErrors = {};

    async function doMove(from, to, future) {

        logInfo(from, to, future);

        if (!to.f) {
            throw new Error(`Zero feed rate for move ${JSON.stringify(to)}`);
        }

        let moveDistanceAbsMm = hypot(to.x - from.x, to.y - from.y, to.z - from.z);

        if (moveDistanceAbsMm > 0) {

            let moveTimeMs = 60000 * moveDistanceAbsMm / to.f;

            let t0 = new Date().getTime();
            while (true) {

                let position = (new Date().getTime() - t0) / moveTimeMs;
                if (position >= 1) {
                    break;
                }

                let target = {
                    xMm: from.x + position * (to.x - from.x),
                    yMm: from.y + position * (to.y - from.y),
                    zMm: from.z + position * (to.z - from.z)
                };

                machine.setTarget(target);

                await machine.synchronizeJob();
            }

            //machine.setMotorDuty("z", 0);
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
            await loadJob(parseStream(stream));
        },

        async runJob() {
            await this.run(job);
        },

        async deleteJob() {
            await loadJob([]);
        },

        async run(code) {

            await machine.doJob(async () => {

                try {

                    if (!Number.isFinite(machineState.sled.xMm) || !Number.isFinite(machineState.sled.yMm)) {
                        throw new Error("Unknown sled position");
                    }

                    if (!Number.isFinite(machineState.spindle.zMm)) {
                        throw new Error("Unknown spindle position");
                    }

                    let queue = [{
                        x: machineState.sled.xMm,
                        y: machineState.sled.yMm,
                        z: machineState.spindle.zMm,
                        f: min(config.speed.xyRapidMmPerMin, config.speed.xyDefaultMmPerMin, config.speed.zMmPerMin)
                    }];

                    async function enqueueMove(params) {

                        if (params) {

                            let lastParams = queue[queue.length - 1];
                            let newParams = {};
                            for (let key in lastParams) {
                                newParams[key] = Number.isFinite(params[key]) ? params[key] : lastParams[key];
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

                    for (let command of code) {
                        if (!(handler[command.code] instanceof Function)) {
                            throw new Error(`Unsupported GCODE ${command.code}`);
                        }
                        logInfo(command);
                        await handler[command.code](command);
                    }
                    await enqueueMove();

                } finally {
                    for (let motor of ["a", "b", "z"]) {
                        machine.setMotorDuty(motor, 0);
                    }
                }

            });
        }

    };
}




